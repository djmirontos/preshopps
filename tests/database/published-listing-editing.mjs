/** Real PostgreSQL integration/concurrency tests, without production credentials.
 * PRESHOPPS_TEST_PSQL=/path/to/psql PRESHOPPS_TEST_PORT=55494 node tests/database/published-listing-editing.mjs
 * Requires a disposable LOCAL PostgreSQL 17 server. Host is hard-coded to
 * 127.0.0.1; a newly generated database is the only database migrated/dropped.
 * Replays every repository migration in order. The local PostgreSQL package
 * lacks Supabase's http, pg_cron, and pg_net extensions: only their extension
 * install statements are replaced by test-local http/cron shims. 0051's pinned
 * network response is synthetic; 0052's entire offline PSGC seed runs as-is.
 * No outbound HTTP, cron worker, or Storage HTTP service runs.
 */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const psql = process.env.PRESHOPPS_TEST_PSQL || 'psql';
const port = process.env.PRESHOPPS_TEST_PORT;
if (!port || !/^\d+$/.test(port)) throw new Error('Set PRESHOPPS_TEST_PORT for a disposable local server.');
const database = `preshopps_test_0093_upgrade_${process.pid}_${Date.now()}`;
const freshDatabase = `preshopps_test_0094_fresh_${process.pid}_${Date.now()}`;
const args = (db=database) => ['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',db];
const env = { ...process.env, PGCLIENTENCODING:'UTF8', PGOPTIONS:'-c search_path=public,extensions -c statement_timeout=120000 -c lock_timeout=10000' };
// Do not use connection URLs, project env files, or production credentials.
delete env.PGSERVICE; delete env.PGSERVICEFILE; delete env.PGHOST; delete env.PGDATABASE;
function sql(source,db=database) {
  try { return execFileSync(psql,args(db),{input:source,encoding:'utf8',env,maxBuffer:20*1024*1024}).trim(); }
  catch(error) { throw new Error(error.stderr?.toString() || error.message); }
}
const file = name => readFileSync(path.join(root,name),'utf8');
let count=0;
function check(name,source,db=database) { sql(source,db); console.log(`PASS ${++count}: ${name}`); }
function adaptedMigration(name) {
  let source=file(`supabase/migrations/${name}`);
  if(name.startsWith('0051_')) {
    const install='create extension if not exists http;';
    if(!source.includes(install)) throw new Error('0051 http installation anchor changed.');
    source=source.replace(install,'-- local test substitutes http extension only');
  }
  if(name.startsWith('0084_')) {
    for(const install of ['create extension if not exists pg_cron;','create extension if not exists pg_net;']) {
      if(!source.includes(install)) throw new Error(`0084 extension anchor changed: ${install}`);
      source=source.replace(install,'-- local test substitutes hosted extension only');
    }
  }
  return source;
}
function install0051HttpShim() {
  sql(`create type public.http_response as (content text);
    create function public.http_get(p_url text) returns public.http_response language sql as $q$
      select row(case when p_url like '%/province.json' then
        '[{"province_code":"9999","province_name":"Test Province"}]'
      when p_url like '%/city.json' then
        '[{"province_code":"9999","city_code":"999999","city_name":"Test City"}]'
      when p_url like '%/barangay.json' then
        '[{"city_code":"999999","brgy_name":"Test Barangay"}]'
      else '[]' end)::public.http_response
    $q$;`);
}
function install0084CronShim() {
  sql(`create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key,
      jobname text unique not null, schedule text not null, command text not null);
    create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint
      language plpgsql as $q$ declare v_id bigint; begin
        insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command)
        on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command
        returning jobid into v_id;
        return v_id;
      end $q$;`);
}
function session(name) {
  const child=spawn(psql,args(),{env:{...env,PGAPPNAME:name},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='',errors='';
  child.stdout.on('data',d=>{output+=d;}); child.stderr.on('data',d=>{errors+=d;});
  const done=new Promise((resolve,reject)=>child.on('close',code=>code===0?resolve(output):reject(new Error(errors))));
  // Register a handler immediately; the test still awaits/reports the rejection.
  done.catch(()=>{});
  return { child, done, send:s=>child.stdin.write(s+'\n'), output:()=>output };
}
async function until(predicate) {
  const deadline=Date.now()+8000;
  while(!predicate()) { if(Date.now()>deadline) throw new Error('Concurrent session did not reach its expected barrier.'); await new Promise(r=>setTimeout(r,30)); }
}
const seller='10000000-0000-0000-0000-000000000001';
const buyer='10000000-0000-0000-0000-000000000002';
const listing='30000000-0000-0000-0000-000000000001';
const asUser=(id,body)=>`set role authenticated; set request.jwt.claim.sub='${id}'; ${body}`;
const save=(revision,patch)=>`select public.update_published_listing('${listing}',${revision},'${JSON.stringify(patch)}');`;
let baselineCreated=false, freshCreated=false;
try {
  sql(`create database ${database};`,'postgres'); baselineCreated=true;
  sql(file('tests/database/bootstrap.sql'));
  const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  if(migrations.at(-1)!=='0094_published_listing_editing.sql' || migrations.some(f=>f.startsWith('0086_')))
    throw new Error('Unexpected migration sequence: 0094 must be latest and 0086 absent.');
  const prior=migrations.filter(f=>f<'0094');
  for(const name of prior) {
    if(name.startsWith('0051_')) install0051HttpShim();
    if(name.startsWith('0084_')) install0084CronShim();
    try { sql('begin;\n'+adaptedMigration(name)+'\ncommit;'); }
    catch(error) { throw new Error(`${name}: ${error.message}`); }
  }
  console.log(`REPLAY: ${prior.length} repository migrations through 0093 ran in order; 0051 HTTP and 0084 cron/net used documented test shims.`);
  const migration0094=file('supabase/migrations/0094_published_listing_editing.sql');

  // Fresh 0094 replay from a clean 0093 baseline, plus an injected failure in
  // an in-memory copy. The actual 0094 file is never changed for this test.
  sql(`create database ${freshDatabase} with template ${database};`,'postgres'); freshCreated=true;
  const marker='create or replace function public.update_listing_status(p_listing_id uuid, p_status listing_status_enum)';
  if(!migration0094.includes(marker)) throw new Error('0094 failure-injection anchor changed.');
  const originalPublishDefinition=sql("select md5(pg_get_functiondef('public.publish_listing(uuid)'::regprocedure));",freshDatabase);
  const failedCopy=migration0094.replace(marker,`select 1/0;\n${marker}`);
  let injectedFailure=false;
  try { sql(`begin;\n${failedCopy}\ncommit;`,freshDatabase); } catch(error) {
    injectedFailure=true;
    if(!/division by zero/i.test(error.message)) throw error;
  }
  if(!injectedFailure) throw new Error('The injected migration unexpectedly succeeded.');
  const rolledBack=sql(`select
    not exists(select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='revision'),
    (select count(*)=2 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname in ('listing_images_update_own','listing_images_delete_own')),
    to_regprocedure('public.guard_listing_revision()') is null,
    to_regprocedure('public.validate_published_listing(uuid,boolean)') is null,
    md5(pg_get_functiondef('public.publish_listing(uuid)'::regprocedure))='${originalPublishDefinition}';`,freshDatabase);
  if(rolledBack!=='t|t|t|t|t') throw new Error(`Failure injection left partial 0094 state: ${rolledBack}`);
  console.log('PASS failure injection: schema, policies, and functions rolled back under the test executor transaction.');
  sql(`begin;\n${migration0094}\ncommit;`,freshDatabase);
  check('fresh 0001-0094 replay has new schema, 0093 messaging, PSGC seed and test Cron schedules',`
      do $$ begin
        if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='revision')
          or to_regprocedure('public.update_published_listing(uuid,bigint,jsonb,jsonb)') is null
          or to_regprocedure('public.start_conversation_from_order(text,text)') is null
          or (select count(*) from public.barangays)<42000
          or (select count(*) from cron.job)<>2
          or exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
            and policyname in ('listing_images_update_own','listing_images_delete_own')) then
          raise exception 'Fresh replay invariant failed.';
        end if;
      end $$;`,freshDatabase);

  // Upgrade a separate 0093 database containing representative old listings,
  // gallery rows, a complete Draft, and an existing buyer order.
  sql(file('tests/database/published-listing-fixtures.sql'));
  check('0093 upgrade fixture has old order and images before migration',`
    select test_assert((select count(*) from public.listings)>=3 and
      (select count(*) from public.listing_images)>=4 and
      (select count(*) from public.order_items)>=1,
      'representative 0093 rows exist');`);
  sql(`begin;\n${migration0094}\ncommit;`);
  check('0093-0094 upgrade preserves rows, initializes revisions and leaves old snapshots unknown',`
    select test_assert((select revision=0 from public.listings where id='30000000-0000-0000-0000-000000000001'),
      'published listing initialized at revision zero');
    select test_assert((select count(*) from public.listing_images where listing_id='30000000-0000-0000-0000-000000000001')=2,
      'existing gallery preserved');
    select test_assert(not exists(select 1 from public.order_items where listing_type_snapshot is not null
      or listing_condition_snapshot is not null),'old orders remain unknown');
    select test_assert(to_regprocedure('public.start_conversation_from_order(text,text)') is not null,
      '0093 messaging function preserved');`);
  check('authorization, fields, revisions, statuses, inventory, images, snapshots, draft and Storage RLS',file('tests/database/published-listing-editing.sql'));

  // Each contender starts only after the holder has performed the competing
  // mutation and emitted HELD. pg_stat_activity confirms actual lock waiting.
  async function race(name,holderSql,contenderSql,verifySql) {
    const first=session(`0094-holder-${count}`); const second=session(`0094-contender-${count}`);
    try {
      first.send(`begin; ${holderSql} select 'HELD';`);
      await until(()=>first.output().includes('HELD'));
      second.send(`begin; ${contenderSql} commit;`); second.child.stdin.end();
      await until(()=>sql(`select count(*) from pg_stat_activity where application_name='0094-contender-${count}' and wait_event_type='Lock'`) === '1');
      first.send('commit;'); first.child.stdin.end();
      await first.done; await second.done;
      sql(verifySql); console.log(`PASS ${++count}: ${name} (observed lock wait)`);
    } finally { first.child.kill(); second.child.kill(); }
  }
  sql(`select test_reset_listing();`);
  let rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('two editors: second save conflicts',asUser(seller,save(rev,{title:'Editor one'})),
    asUser(seller,`select test_error($q$${save(rev,{title:'Editor two'})}$q$,'STALE_LISTING_REVISION');`),
    `select test_assert((select title='Editor one' from public.listings where id='${listing}'),'winner preserved');`);

  sql('select test_reset_listing();'); rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('edit then submission: coherent new terms',asUser(seller,save(rev,{title:'New terms',price_cents:1200,fulfillment_methods:['pickup']})),
    asUser(buyer,`select * from public.submit_buy_now_order('${listing}',1,'pickup',1200,null);`),
    `select test_assert(exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where oi.listing_title_snapshot='New terms' and oi.price_cents_snapshot=1200 and oi.listing_type_snapshot='brand_new' and oi.listing_condition_snapshot='brand_new' and o.fulfillment_method='pickup'),'coherent new snapshot');`);

  sql('select test_reset_listing();'); rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('submission then edit: old snapshot retained',asUser(buyer,`select * from public.submit_buy_now_order('${listing}',1,'meetup',1000,null);`),
    asUser(seller,save(rev,{title:'Later terms',price_cents:1300,fulfillment_methods:['pickup']})),
    `select test_assert(exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where oi.listing_title_snapshot='Test listing' and oi.price_cents_snapshot=1000 and o.fulfillment_method='meetup'),'old snapshot retained');`);

  sql('select test_reset_listing();');
  let order=sql(asUser(buyer,`select order_id from public.submit_buy_now_order('${listing}',2,'meetup',1000,null);`));
  let item=sql(`select id from public.order_items where order_id='${order}'`);
  rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('acceptance then edit: editor becomes stale',asUser(seller,`select * from public.accept_order_items('${order}',array['${item}'::uuid],'{}');`),
    asUser(seller,`select test_error($q$${save(rev,{available_quantity:8})}$q$,'STALE_LISTING_REVISION');`),
    `select test_assert((select reserved_quantity=2 and stock_quantity=10 from public.listings where id='${listing}'),'reservation preserved');`);
  check('active ledger blocks quantity even if cached reserved quantity is zero',`
    begin;
    update public.listings set reserved_quantity=0 where id='${listing}';
    set request.jwt.claim.sub='${seller}';
    select test_error(format('select public.update_published_listing(%L,%s,%L)',
      '${listing}',(select revision from public.listings where id='${listing}'),'{"available_quantity":5}'),
      'LISTING_HAS_ACTIVE_RESERVATION');
    rollback;`);
  // Drive the real lifecycle through completion; no synthetic stock UPDATE.
  sql(asUser(seller,`select * from public.mark_order_ready('${order}'); select * from public.mark_order_handed_over_or_shipped('${order}');`));
  rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('completion then edit: consumed units cannot be restored',asUser(buyer,`select * from public.confirm_order_received('${order}');`),
    asUser(seller,`select test_error($q$${save(rev,{available_quantity:10})}$q$,'STALE_LISTING_REVISION');`),
    `select test_assert((select stock_quantity=8 and reserved_quantity=0 from public.listings where id='${listing}'),'consumed stock preserved');`);

  sql('select test_reset_listing();');
  order=sql(asUser(buyer,`select order_id from public.submit_buy_now_order('${listing}',2,'meetup',1000,null);`));
  item=sql(`select id from public.order_items where order_id='${order}'`);
  rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('edit then acceptance: acceptance rechecks reduced stock',asUser(seller,save(rev,{available_quantity:1})),
    asUser(seller,`select * from public.accept_order_items('${order}',array['${item}'::uuid],'{}');`),
    `select test_assert((select status='declined' from public.orders where id='${order}'),'insufficient stock declined');
     select test_assert((select reserved_quantity=0 and stock_quantity=1 from public.listings where id='${listing}'),'no oversell');`);

  sql('select test_reset_listing();');
  order=sql(asUser(buyer,`select order_id from public.submit_buy_now_order('${listing}',2,'meetup',1000,null);`));
  item=sql(`select id from public.order_items where order_id='${order}'`);
  sql(asUser(seller,`select * from public.accept_order_items('${order}',array['${item}'::uuid],'{}');
    select * from public.mark_order_ready('${order}'); select * from public.mark_order_handed_over_or_shipped('${order}');`));
  rev=sql(`select revision from public.listings where id='${listing}'`);
  await race('edit then completion: text save cannot disturb consumption',asUser(seller,save(rev,{title:'Text before completion'})),
    asUser(buyer,`select * from public.confirm_order_received('${order}');`),
    `select test_assert((select stock_quantity=8 and reserved_quantity=0 and title='Text before completion'
       and revision=${rev}::bigint+2 from public.listings where id='${listing}'),'one edit plus one completion revision');`);
  check('partial confirmation and cancellation preserve lifecycle and revision',file('tests/database/published-listing-lifecycle.sql'));
  console.log(`All ${count} integration groups passed on local PostgreSQL. Storage HTTP transport was not exercised.`);
} finally {
  if(freshCreated) sql(`drop database ${freshDatabase} with (force);`,'postgres');
  if(baselineCreated) sql(`drop database ${database} with (force);`,'postgres');
}

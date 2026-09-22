/** Real PostgreSQL integration test for migration 0101 (Brand New
 * condition auto-assignment fix), independently runnable from
 * published-listing-editing.mjs and known-flaws-draft-fix.mjs.
 * PRESHOPPS_TEST_PSQL=/path/to/psql PRESHOPPS_TEST_PORT=55494 node tests/database/brand-new-condition-fix.mjs
 * Requires a disposable LOCAL PostgreSQL 17 server. Host is hard-coded to
 * 127.0.0.1; a newly generated database is the only database migrated/dropped.
 * Replays every repository migration 0001-0101 in order (0086 permanently
 * absent). The local PostgreSQL package lacks Supabase's http, pg_cron, and
 * pg_net extensions: only their extension install statements are replaced by
 * the same test-local http/cron shims published-listing-editing.mjs already
 * uses. No outbound HTTP, cron worker, or Storage HTTP service runs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const psql = process.env.PRESHOPPS_TEST_PSQL || 'psql';
const port = process.env.PRESHOPPS_TEST_PORT;
if (!port || !/^\d+$/.test(port)) throw new Error('Set PRESHOPPS_TEST_PORT for a disposable local server.');
const database = `preshopps_test_0101_brand_new_condition_${process.pid}_${Date.now()}`;
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
let created=false;
try {
  sql(`create database ${database};`,'postgres'); created=true;
  sql(file('tests/database/bootstrap.sql'));

  const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  if(migrations.some(f=>!/^\d{4}_/.test(f)))
    throw new Error('A migration filename does not follow the 4-digit sequential convention (possible stray timestamp-named file).');
  if(migrations.at(-1)!=='0101_auto_assign_brand_new_condition.sql')
    throw new Error('0101_auto_assign_brand_new_condition.sql must be the latest migration file.');
  if(migrations.some(f=>f.startsWith('0086_')))
    throw new Error('0086 must remain permanently absent.');
  if(migrations.filter(f=>f.startsWith('0101_')).length!==1)
    throw new Error('Exactly one 0101 migration file must exist.');

  for(const name of migrations) {
    if(name.startsWith('0051_')) install0051HttpShim();
    if(name.startsWith('0084_')) install0084CronShim();
    try { sql('begin;\n'+adaptedMigration(name)+'\ncommit;'); }
    catch(error) { throw new Error(`${name}: ${error.message}`); }
  }
  console.log(`REPLAY: ${migrations.length} repository migrations through 0101 ran in order; 0051 HTTP and 0084 cron/net used documented test shims.`);

  sql(file('tests/database/brand-new-condition-fix-fixtures.sql'));
  check('all ten brand-new-condition-fix cases (create/update derivation, mismatch rejection preserved, legacy Draft direct publish, rollback, unauthorized-publish safety, unrelated regressions)',
    file('tests/database/brand-new-condition-fix.sql'));

  console.log(`All ${count} check group(s) passed on local PostgreSQL. Storage HTTP transport was not exercised.`);
} finally {
  if(created) sql(`drop database ${database} with (force);`,'postgres');
}

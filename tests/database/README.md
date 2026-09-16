# Published listing editing database tests

Run against a disposable local PostgreSQL 17 server (with `pgcrypto`, `pg_trgm`,
and `moddatetime` available):

```powershell
$env:PRESHOPPS_TEST_PSQL = 'C:\path\to\pgsql\bin\psql.exe'
$env:PRESHOPPS_TEST_PORT = '55494'
node tests/database/published-listing-editing.mjs
```

The runner hard-codes `127.0.0.1`, creates a uniquely named test database, and drops
only that database in `finally`. It does not read application env files or accept
a production connection URL. It requires a local `postgres` superuser connection.
Do not run it through a port forwarded to another database server.

It replays every repository migration from 0001 through 0093 in order, then
clones the disposable 0093 database. One clone receives 0094 as a fresh schema;
the other receives representative synthetic 0093 listings, images, drafts and an
order before the 0094 upgrade. Migration 0086 remains absent. The 0052 PSGC
data correction and every other available migration statement run unchanged.

This is a **mocked Supabase replay, not a full real Supabase replay**. The local
PostgreSQL 17 package lacks Supabase's `http`, `pg_cron`, and `pg_net` extensions.
For 0051, the runner substitutes a three-row synthetic pinned HTTP response and
replaces only `CREATE EXTENSION http`; its original SQL body executes. The 0052
offline PSGC replacement subsequently loads its full committed data. For 0084,
the runner substitutes a local `cron.schedule` recording function and replaces
only the two hosted extension installs; both original schedule statements run,
but no cron worker or `pg_net` HTTP request runs. `bootstrap.sql` supplies minimal
Auth and Storage metadata. Supabase Auth, Storage HTTP/object bytes, email
delivery, and Realtime are not simulated.

Production deployment uses Supabase's migration executor, which owns migration
atomicity. 0094 intentionally has no outer `BEGIN`/`COMMIT`. The disposable test
runner supplies its own transaction wrapper for both successful applications
and a deliberate failure injected after a function replacement and Storage
policy drops. It verifies that schema, policy, and function changes roll back.
The actual 0094 file is not altered for the failure test. Runtime tests exercise row locks,
RLS, published and draft RPCs, sparse gallery staging, trusted maintenance,
upgrade data retention, and order snapshots.

Behavior assertions cover grants/identity, allowed statuses, merged validation,
immutable fields, revision/no-op behavior, inventory, draft publish, gallery
replacement and rollback, historical snapshots, and direct Storage RLS denial.
Concurrent sessions verify actual lock waiting before allowing the competing
transaction to commit. SQL-text Vitest checks are supplementary only.

# Phase B RPC contract

`get_published_listing_edit_state(p_listing_id uuid) -> jsonb` returns the existing
owner listing projection plus `revision` (decimal string), `available_quantity`,
`reserved_quantity`, `quantity_editable`, and `cover_image_id`. It accepts only an
eligible owner of an Available/Paused listing.

`update_published_listing(p_listing_id uuid, p_expected_revision bigint,
p_patch jsonb, p_images jsonb DEFAULT NULL) -> jsonb` returns that projection plus
`changed`. Send the decimal revision string through the RPC bigint parameter.
Omitted patch keys are retained; nullable optional fields may be cleared with
JSON null. Nested vehicle/rental objects merge supplied keys; JSON null removes
the optional extension. Fulfillment is a complete set when supplied.

`p_images` is SQL null/omitted to retain the gallery, or a complete ordered array:

```json
[
  {"image_id":"existing-uuid","is_reference_image":false,"is_cover":true},
  {"storage_path":"listing-images/owner-uuid/listing-uuid/random-uuid.jpg","is_reference_image":true,"is_cover":false}
]
```

Exactly one item must have `is_cover: true`. Each item has exactly one of
`image_id` and `storage_path`. The array index is the position. New files must be
uploaded first; database save never deletes Storage objects. Failed saves may
leave accepted temporary orphans. Do not call draft field/image RPCs for these
published saves, and do not add a cleanup service in Phase A.

Map recognized RPC `details` codes to safe UI copy: `NOT_AUTHENTICATED`,
`INTERACTION_BLOCKED`, `LISTING_NOT_FOUND`, `NOT_LISTING_OWNER`,
`LISTING_NOT_EDITABLE`, `STALE_LISTING_REVISION`, `LISTING_HAS_ACTIVE_RESERVATION`,
`PROTECTED_FIELD`, `UNKNOWN_FIELD`, `INVALID_PUBLISHED_LISTING`, `INVALID_IMAGE_STATE`.
Unexpected transport/database failures require generic copy. Never display raw
SQLSTATE, constraint names, or backend error text. A stale revision requires
reloading and resolving the edit, never automatically retrying with a new token.

Deploy 0094 before Phase B. Existing draft RPC signatures remain unchanged.
Existing order snapshot columns remain NULL; new orders populate both. If the
frontend is rolled back, retain the additive schema and recorded history. The
Storage policy restriction remains necessary once published editing is enabled.

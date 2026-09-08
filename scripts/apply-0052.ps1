<#
.SYNOPSIS
  Applies supabase/migrations/0052_ph_location_reference_data_correction.sql
  to the live Preshopps Supabase project via the Management API, in many
  small requests instead of one ~1.9MB request (which the SQL Editor and
  the Management API both reject as too large).

.DESCRIPTION
  This script does NOT change the data or the mapping decisions baked into
  0052_ph_location_reference_data_correction.sql. It reads that file at run
  time and re-emits its literal province/city/barangay text -- unmodified --
  split across many Management API calls.

  Real reference tables (provinces, cities_municipalities, barangays) are
  NOT touched until every row has been staged and validated:

    A. reset staging   -- drop only the dedicated staging tables (including
                           any left over from an earlier manual attempt) and
                           any prior migration-history row for this
                           correction. Touches no real table.
    B. stage provinces -- create staging table, load all 97 provinces.
    C. stage cities    -- create staging table, load all 1,642 cities.
    D. stage barangays -- create staging table, load all 42,010 barangays
                           across many small batches (the only part of the
                           migration that is re-batched; batches are drawn
                           between whole data rows, never by splitting SQL
                           on semicolons).
    E. validate staging -- count checks, duplicate checks, and staging-side
                           parent/child integrity checks (every staged city
                           resolves to a staged province; every staged
                           barangay resolves to a staged city). Read-only
                           against staging; touches no real table.
    F. swap (ONE transaction) -- everything below runs as a single
                           Management API request, i.e. one Postgres
                           implicit transaction: it either all applies or
                           all rolls back.
                             1. verify no shops/profiles/listings rows
                                currently reference any location row
                                (province_id/city_id/barangay_id all null)
                             2. delete real barangays -> cities -> provinces
                             3. insert real provinces from staging
                             4. resolve province ids
                             5. insert real cities from staging
                             6. resolve city ids
                             7. insert real barangays from staging
                             8. validate final real-table counts
                             9. drop all staging tables
                            10. record migration history

  Because steps A-E never touch provinces/cities_municipalities/barangays,
  a failure at any point before step F leaves the current real reference
  data completely untouched. Step F is one atomic transaction, so even a
  failure inside it (guard check, insert, or final validation) rolls back
  everything in that step -- real tables end up either fully replaced or
  completely unchanged, never partially replaced.

  The script stops immediately (non-zero exit) on the first failed request.
  It never prints the access token.

  Transport / encoding history (two bugs, two fixes):
  Attempt 1 used Invoke-RestMethod with a plain string -Body. Windows
  PowerShell 5.1 encoded that string to bytes using the process's default
  (non-UTF-8) encoding, silently mangling "ñ" into invalid UTF-8 that
  Postgres stored as U+FFFD (e.g. "City of Las Piñas" arrived as "City of
  Las Pi<FFFD>as").
  Attempt 2 switched to building the JSON and converting it to a UTF-8
  byte[] explicitly via [System.Text.Encoding]::UTF8.GetBytes(...), still
  passed through Invoke-RestMethod's -Body parameter. This still failed:
  Invoke-RestMethod in Windows PowerShell 5.1 does not transmit a byte[]
  -Body verbatim -- it re-stringifies the array first (each byte's decimal
  value, space-joined), so the Management API received literal text like
  "123 34 113 ..." instead of the intended bytes and rejected it as invalid
  JSON.
  Fix (current): Invoke-RestMethod is not used for sending the request body
  at all. Requests are sent via System.Net.Http.HttpClient, with the JSON
  body wrapped in [System.Net.Http.StringContent]::new($bodyJson,
  [System.Text.Encoding]::UTF8, "application/json"). StringContent owns its
  own byte encoding internally (using the exact Encoding instance it is
  given) and is never subject to PowerShell's implicit string-to-bytes
  conversion, so this is not just "another attempt at UTF-8" but a
  different code path that removes PowerShell's string handling from the
  transmission entirely. StringContent also sets the Content-Type header
  to "application/json; charset=utf-8" automatically from the encoding
  argument -- verified explicitly in -DryRun.

.PARAMETER MigrationPath
  Path to the source-of-truth migration file. Its province/city/barangay
  literal data is read at run time and reused verbatim -- never retyped or
  regenerated -- so this script cannot drift from the approved data model.

.PARAMETER ProjectRef
  Supabase project ref.

.PARAMETER BatchSize
  Number of barangay rows per staging batch request. Default 1000 -> 43
  batches for 42,010 rows, each well under 100KB.

.PARAMETER DryRun
  Performs only local, network-free verification: parses the migration file
  (asserting exactly 97 provinces / 1,642 cities / 42,010 barangays / the
  expected batch count) and builds the exact same HttpContent object a real
  request would send (via the same New-ManagementRequestContent function),
  then reads its bytes back out of memory -- with no socket ever opened --
  to confirm the Content-Type header and the raw bytes are correct UTF-8
  JSON containing the representative non-ASCII place names unchanged. Makes
  no HTTP calls, requires no SUPABASE_ACCESS_TOKEN, and touches no database.

.EXAMPLE
  ./scripts/apply-0052.ps1 -DryRun

.EXAMPLE
  $env:SUPABASE_ACCESS_TOKEN = "sbp_...."
  ./scripts/apply-0052.ps1
#>

[CmdletBinding()]
param(
  [string]$MigrationPath = (Join-Path $PSScriptRoot "..\supabase\migrations\0052_ph_location_reference_data_correction.sql"),
  [string]$ProjectRef = "ylhfbqcyxjmxrbpkxtgu",
  [string]$ApiBaseUrl = "https://api.supabase.com/v1",
  [int]$BatchSize = 1000,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Migration-history identity. See scripts/apply-0052.ps1 report / commit
# notes for why this exact name/version scheme was chosen: it matches the
# convention already used by every one of this project's other migration
# rows (0001_extensions .. 0050_shop_setup_custom_slug) in
# supabase_migrations.schema_migrations -- a real apply-time 14-digit
# timestamp as `version`, and the full filename stem (numeric prefix
# included) as `name`. 0051's row is the one exception (its name column
# dropped the "0051_" prefix); this script does not touch 0051's row and
# does not repeat that deviation for 0052.
# ---------------------------------------------------------------------------
$MigrationName = "0052_ph_location_reference_data_correction"

$MigrationPath = (Resolve-Path $MigrationPath).Path
Write-Host "Reading migration file: $MigrationPath"
$raw = [System.IO.File]::ReadAllText($MigrationPath, [System.Text.Encoding]::UTF8)

# ---------------------------------------------------------------------------
# Extraction helpers -- pull literal data blocks out of the migration file
# by locating the same anchor strings that appear in the file itself. This
# never retypes data: it only slices the original file text.
# ---------------------------------------------------------------------------
function Get-Slice {
  param([string]$Text, [string]$StartAnchor, [string]$EndAnchor)
  $s = $Text.IndexOf($StartAnchor)
  if ($s -lt 0) { throw "Anchor not found in migration file: '$StartAnchor'" }
  if ($EndAnchor) {
    $e = $Text.IndexOf($EndAnchor, $s)
    if ($e -lt 0) { throw "End anchor not found in migration file: '$EndAnchor'" }
    return $Text.Substring($s, $e - $s)
  }
  return $Text.Substring($s)
}

$AnchorProvincesValues = "insert into _ph_provinces (name) values"
$AnchorProvincesRealInsert = "insert into provinces (country_code, name)"
$AnchorCitiesValues = "insert into _ph_cities (province_name, name) values"
$AnchorCitiesRealInsert = "insert into cities_municipalities (province_id, name)"
$AnchorBarangaysChunkValues = "insert into _ph_barangays (province_name, city_name, name) values"
$AnchorFinalInsert = "insert into barangays (city_id, name)"

# 97 province name tuples, verbatim, ending at the real "insert into provinces" line.
$provincesValuesBlock = (Get-Slice $raw $AnchorProvincesValues $AnchorProvincesRealInsert).TrimEnd()

# 1,642 (province_name, city_name) tuples, verbatim.
$citiesValuesBlock = (Get-Slice $raw $AnchorCitiesValues $AnchorCitiesRealInsert).TrimEnd()

# All 9 embedded barangay chunks, concatenated, up to the final real insert.
$barangayChunksBlob = Get-Slice $raw $AnchorBarangaysChunkValues $AnchorFinalInsert

# ---------------------------------------------------------------------------
# Count and validate the provinces/cities tuple blocks (mirrors the existing
# barangay count check below). Counts a line as one row when it starts with
# "(" after trimming -- the same shape every data line in these two blocks
# has in the migration file.
# ---------------------------------------------------------------------------
function Get-TupleLineCount {
  param([string]$Block)
  $n = 0
  foreach ($line in ($Block -split "`r?`n")) {
    if ($line.Trim().StartsWith("(")) { $n++ }
  }
  return $n
}

$provinceCount = Get-TupleLineCount $provincesValuesBlock
Write-Host "Parsed $provinceCount province rows from the migration file."
if ($provinceCount -ne 97) {
  throw "Expected exactly 97 province rows from 0052.sql, found $provinceCount. Aborting -- refusing to apply data that does not match the approved migration."
}

$cityCount = Get-TupleLineCount $citiesValuesBlock
Write-Host "Parsed $cityCount city/municipality rows from the migration file."
if ($cityCount -ne 1642) {
  throw "Expected exactly 1642 city/municipality rows from 0052.sql, found $cityCount. Aborting -- refusing to apply data that does not match the approved migration."
}

# ---------------------------------------------------------------------------
# Parse the barangay chunk blob into individual tuple strings, discarding
# only the 9 repeated "insert into ... values" wrapper lines and normalizing
# each tuple line's trailing punctuation. The tuple content itself (the
# actual province/city/barangay names) is never touched.
# ---------------------------------------------------------------------------
$lines = $barangayChunksBlob -split "`r?`n"
$tuples = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
  $t = $line.Trim()
  if ($t.Length -eq 0) { continue }
  if ($t.StartsWith("insert into _ph_barangays")) { continue }
  if ($t.EndsWith(");")) { $t = $t.Substring(0, $t.Length - 2) + ")" }
  elseif ($t.EndsWith(",")) { $t = $t.Substring(0, $t.Length - 1) }
  $tuples.Add($t)
}

Write-Host "Parsed $($tuples.Count) barangay rows from the migration file."
if ($tuples.Count -ne 42010) {
  throw "Expected exactly 42010 barangay rows from 0052.sql, found $($tuples.Count). Aborting -- refusing to apply data that does not match the approved migration."
}

$batches = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $tuples.Count; $i += $BatchSize) {
  $end = [Math]::Min($i + $BatchSize - 1, $tuples.Count - 1)
  $batches.Add($tuples.GetRange($i, $end - $i + 1))
}
$TotalSteps = 5 + $batches.Count
Write-Host "Split into $($batches.Count) barangay batches of up to $BatchSize rows each."

# ---------------------------------------------------------------------------
# Shared request-content builder. Used by both the real API calls and the
# dry-run verification below, so the verification exercises the exact same
# code path a real request goes through -- not a lookalike copy of it.
#
# Transport fix: build the JSON exactly as before via ConvertTo-Json, then
# wrap it in a System.Net.Http.StringContent instance constructed with an
# explicit UTF-8 Encoding and media type "application/json". StringContent
# encodes its own bytes internally from the Encoding it is given -- it is
# never handed to any PowerShell string-to-bytes conversion, which is what
# actually corrupted the body on both earlier attempts (Invoke-RestMethod's
# default string encoding on attempt 1, and Invoke-RestMethod re-stringifying
# a byte[] -Body via decimal-value-joined text on attempt 2). StringContent
# also sets the Content-Type header to "application/json; charset=utf-8"
# automatically because of the Encoding argument.
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Net.Http

function New-ManagementRequestContent {
  param([string]$Sql)
  $bodyObj = @{ query = $Sql }
  $bodyJson = $bodyObj | ConvertTo-Json -Compress -Depth 3
  return [System.Net.Http.StringContent]::new($bodyJson, [System.Text.Encoding]::UTF8, "application/json")
}

# ---------------------------------------------------------------------------
# Local, network-free transport-level verification. Builds real HttpContent
# via the exact function the live requests use, then reads the bytes that
# content object holds in memory -- ReadAsByteArrayAsync() never opens a
# socket, it just serializes the StringContent's internal buffer -- and
# checks:
#   1. the Content-Type header actually carries charset=utf-8
#   2. the first bytes are literal JSON text ({"query":...), NOT the
#      space-separated decimal garbage ("123 34 113 ...") produced by the
#      Invoke-RestMethod byte[] bug this replaces
#   3. the bytes decode via UTF-8 back to valid JSON
#   4. the decoded query string still contains every representative
#      non-ASCII place name, unchanged
# This is what would have caught both previous transport bugs before either
# one ever reached the database.
# ---------------------------------------------------------------------------
function Test-TransportEncoding {
  param([string[]]$Samples)
  Write-Host ""
  Write-Host "=== Transport-level verification (actual HttpContent bytes) ==="

  $combinedSql = "insert into _ph_test (name) values " +
    (($Samples | ForEach-Object { "('$($_.Replace("'", "''"))')" }) -join ", ") + ";"
  $content = New-ManagementRequestContent -Sql $combinedSql

  $contentType = $content.Headers.ContentType.ToString()
  $contentTypeOk = $contentType -like "*charset=utf-8*"
  Write-Host "  Content-Type header: $contentType"
  Write-Host ("  [{0}] Content-Type includes charset=utf-8" -f $(if ($contentTypeOk) { "PASS" } else { "FAIL" }))

  # In-memory read of the exact bytes HttpClient would put on the wire.
  # No network call: StringContent already holds these bytes internally.
  $bytes = $content.ReadAsByteArrayAsync().GetAwaiter().GetResult()

  $asciiPreview = [System.Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min(24, $bytes.Length))
  $looksLikeDecimalGarbage = $asciiPreview -match '^\s*\d+\s+\d+\s+\d+'
  Write-Host "  first bytes (ascii preview): $asciiPreview"
  Write-Host ("  [{0}] first bytes are NOT space-separated decimal text (the prior bug's failure mode)" -f $(if (-not $looksLikeDecimalGarbage) { "PASS" } else { "FAIL" }))

  $decoded = [System.Text.Encoding]::UTF8.GetString($bytes)
  $startsCorrectly = $decoded.StartsWith('{"query":"')
  Write-Host ("  [{0}] decoded body starts with the literal JSON prefix {{`"query`":...}}" -f $(if ($startsCorrectly) { "PASS" } else { "FAIL" }))

  $parsesOk = $true
  $parsed = $null
  try { $parsed = $decoded | ConvertFrom-Json } catch { $parsesOk = $false }
  Write-Host ("  [{0}] decoded body parses as valid JSON" -f $(if ($parsesOk) { "PASS" } else { "FAIL" }))

  $sampleChecks = $true
  if ($parsesOk) {
    foreach ($s in $Samples) {
      $found = $parsed.query.Contains($s)
      if (-not $found) { $sampleChecks = $false }
      Write-Host ("  [{0}] decoded JSON 'query' contains '{1}'" -f $(if ($found) { "PASS" } else { "FAIL" }), $s)
    }
  }

  $content.Dispose()
  return ($contentTypeOk -and (-not $looksLikeDecimalGarbage) -and $startsCorrectly -and $parsesOk -and $sampleChecks)
}

if ($DryRun) {
  # Built from the explicit Unicode codepoint (U+00F1 LATIN SMALL LETTER N
  # WITH TILDE) rather than a literal "ñ" character in this source file.
  # Windows PowerShell 5.1 parses a .ps1 file's own source using the system
  # default codepage when the file has no UTF-8 BOM, which silently mangles
  # any literal non-ASCII character typed directly into the script (this was
  # caught during verification: a literal "ñ" here round-tripped "successfully"
  # only because it had already been corrupted into "Ã±" before the encoding
  # fix ever ran). Building the samples from the numeric codepoint sidesteps
  # that failure mode entirely, independent of how this file is saved.
  $enye = [char]0x00F1
  $samples = @(
    "Las Pi${enye}as", "Para${enye}aque", "Bi${enye}an", "Mu${enye}oz",
    "Los Ba${enye}os", "Santo Ni${enye}o"
  )
  $transportOk = Test-TransportEncoding -Samples $samples

  Write-Host ""
  Write-Host "=== Source-file containment check (same samples) ==="
  $containmentOk = $true
  foreach ($s in $samples) {
    $found = $raw.Contains($s)
    if (-not $found) { $containmentOk = $false }
    Write-Host ("  [{0}] {1}" -f $(if ($found) { "FOUND" } else { "MISSING" }), $s)
  }

  Write-Host ""
  Write-Host "=== Parsed counts ==="
  Write-Host "  provinces:        $provinceCount (expected 97)"
  Write-Host "  cities:           $cityCount (expected 1642)"
  Write-Host "  barangays:        $($tuples.Count) (expected 42010)"
  Write-Host "  barangay batches: $($batches.Count) (batch size $BatchSize)"

  Write-Host ""
  if ($transportOk -and $containmentOk -and $provinceCount -eq 97 -and $cityCount -eq 1642 -and $tuples.Count -eq 42010) {
    Write-Host "DRY RUN PASSED: parsing and transport-level UTF-8 encoding both verified. No network calls were made." -ForegroundColor Green
    exit 0
  }
  else {
    Write-Host "DRY RUN FAILED: see failures above. No network calls were made." -ForegroundColor Red
    exit 1
  }
}

# ---------------------------------------------------------------------------
# Token handling -- read only from the environment, never echoed or logged.
# Only required past this point (real execution), not for -DryRun.
# ---------------------------------------------------------------------------
$token = $env:SUPABASE_ACCESS_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Error "SUPABASE_ACCESS_TOKEN is not set. Set it in your environment before running this script."
  exit 1
}

# ---------------------------------------------------------------------------
# Management API call helper. Never logs headers or the HttpClient's default
# request headers (where the token lives) -- only $Label and error text.
# ---------------------------------------------------------------------------
$queryUrl = "$ApiBaseUrl/projects/$ProjectRef/database/query"
$httpClient = New-Object System.Net.Http.HttpClient
$httpClient.Timeout = [TimeSpan]::FromSeconds(180)

function Invoke-ManagementQuery {
  param([string]$Label, [string]$Sql)
  Write-Host "==> $Label"
  $content = New-ManagementRequestContent -Sql $Sql
  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $queryUrl)
  $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)
  $request.Content = $content
  try {
    $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
    $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      throw "HTTP $([int]$response.StatusCode) $($response.ReasonPhrase): $responseText"
    }
    Write-Host "    ok"
  }
  catch {
    Write-Host ""
    Write-Host "FAILED at step: $Label" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Stopping. No further requests will be sent."
    Write-Host "Real reference tables (provinces/cities_municipalities/barangays) have NOT been touched by this run unless the failure happened during the final swap step -- in which case that entire step rolled back and they are unchanged."
    Write-Host "Every step up to and including this one is safe to retry after the underlying issue is fixed."
    exit 1
  }
  finally {
    $request.Dispose()
  }
}

# ---------------------------------------------------------------------------
# Step A: reset staging only. Drops the dedicated staging tables (including
# the five left over from the earlier manual chat-relay attempt) and any
# prior migration-history row for this correction. Touches no real table.
# ---------------------------------------------------------------------------
$resetSql = @"
drop table if exists _ph_provinces, _ph_province_ids, _ph_cities, _ph_city_ids, _ph_barangays;
delete from supabase_migrations.schema_migrations where name = '$MigrationName';
"@
Invoke-ManagementQuery -Label "Step 1/${TotalSteps}: reset staging objects (real tables untouched)" -Sql $resetSql

# ---------------------------------------------------------------------------
# Step B: stage provinces (verbatim 97-row data block). Staging only.
# ---------------------------------------------------------------------------
$stepProvincesSql = @"
create table if not exists _ph_provinces (
  name text primary key
);
truncate table _ph_provinces;

$provincesValuesBlock
"@
Invoke-ManagementQuery -Label "Step 2/${TotalSteps}: stage 97 provinces (real tables untouched)" -Sql $stepProvincesSql

# ---------------------------------------------------------------------------
# Step C: stage cities (verbatim 1,642-row data block). Staging only.
# ---------------------------------------------------------------------------
$stepCitiesSql = @"
create table if not exists _ph_cities (
  province_name text not null,
  name text not null
);
truncate table _ph_cities;

$citiesValuesBlock
"@
Invoke-ManagementQuery -Label "Step 3/${TotalSteps}: stage 1,642 cities/municipalities (real tables untouched)" -Sql $stepCitiesSql

# ---------------------------------------------------------------------------
# Step D: empty barangay staging table, then N batches. Staging only.
# ---------------------------------------------------------------------------
$stepBarangaysTableSql = @"
create table if not exists _ph_barangays (
  province_name text not null,
  city_name text not null,
  name text not null
);
truncate table _ph_barangays;
"@
Invoke-ManagementQuery -Label "Step 4/${TotalSteps}: create barangay staging table (real tables untouched)" -Sql $stepBarangaysTableSql

$batchIndex = 0
foreach ($batch in $batches) {
  $batchIndex++
  $valuesText = ($batch -join ",`n  ")
  $batchSql = "insert into _ph_barangays (province_name, city_name, name) values`n  $valuesText;"
  $stepNum = 4 + $batchIndex
  Invoke-ManagementQuery -Label "Step $stepNum/${TotalSteps}: stage barangay batch $batchIndex/$($batches.Count) ($($batch.Count) rows, real tables untouched)" -Sql $batchSql
}

# ---------------------------------------------------------------------------
# Step E: validate staging counts, duplicates, and parent/child integrity.
# Read-only against staging tables; touches no real table. If this fails,
# nothing about the real reference data has been touched.
# ---------------------------------------------------------------------------
$validateStagingSql = @"
do `$validate`$
declare
  v_provinces integer;
  v_cities integer;
  v_barangays integer;
  v_dup_provinces integer;
  v_dup_cities integer;
  v_dup_barangays integer;
  v_orphan_cities integer;
  v_orphan_barangays integer;
begin
  select count(*) into v_provinces from _ph_provinces;
  select count(*) into v_cities from _ph_cities;
  select count(*) into v_barangays from _ph_barangays;

  if v_provinces <> 97 then
    raise exception 'staging provinces count = % (expected 97)', v_provinces;
  end if;
  if v_cities <> 1642 then
    raise exception 'staging cities count = % (expected 1642)', v_cities;
  end if;
  if v_barangays <> 42010 then
    raise exception 'staging barangays count = % (expected 42010)', v_barangays;
  end if;

  select count(*) into v_dup_provinces from (
    select name from _ph_provinces group by name having count(*) > 1
  ) d;
  if v_dup_provinces > 0 then
    raise exception 'staging has % duplicate province name(s)', v_dup_provinces;
  end if;

  select count(*) into v_dup_cities from (
    select province_name, name from _ph_cities group by province_name, name having count(*) > 1
  ) d;
  if v_dup_cities > 0 then
    raise exception 'staging has % duplicate (province, city) pair(s)', v_dup_cities;
  end if;

  select count(*) into v_dup_barangays from (
    select province_name, city_name, name from _ph_barangays group by province_name, city_name, name having count(*) > 1
  ) d;
  if v_dup_barangays > 0 then
    raise exception 'staging has % duplicate (province, city, barangay) triple(s)', v_dup_barangays;
  end if;

  select count(*) into v_orphan_cities
  from _ph_cities c
  left join _ph_provinces p on p.name = c.province_name
  where p.name is null;
  if v_orphan_cities > 0 then
    raise exception 'staging has % cit(y/ies) with no matching staged province', v_orphan_cities;
  end if;

  select count(*) into v_orphan_barangays
  from _ph_barangays b
  left join _ph_cities c on c.province_name = b.province_name and c.name = b.city_name
  where c.name is null;
  if v_orphan_barangays > 0 then
    raise exception 'staging has % barangay(s) with no matching staged city', v_orphan_barangays;
  end if;
end
`$validate`$;
"@
Invoke-ManagementQuery -Label "Step $(5 + $batches.Count)/${TotalSteps}: validate staged data (counts + duplicates + parent/child integrity)" -Sql $validateStagingSql

# ---------------------------------------------------------------------------
# Step F: ONE atomic transaction. Guard-checks live reference usage, then
# replaces the real tables, validates the result, cleans up staging, and
# records migration history -- all in a single request/transaction, so any
# failure anywhere in this step rolls back everything in it.
# ---------------------------------------------------------------------------
$migrationVersion = Get-Date -Format "yyyyMMddHHmmss"
$swapSql = @"
do `$guard`$
declare
  v_refs integer;
begin
  select count(*) into v_refs from shops
    where province_id is not null or city_id is not null or barangay_id is not null;
  if v_refs > 0 then
    raise exception 'Aborting: % shops row(s) still reference location data -- real tables were NOT touched', v_refs;
  end if;

  select count(*) into v_refs from profiles
    where province_id is not null or city_id is not null or barangay_id is not null;
  if v_refs > 0 then
    raise exception 'Aborting: % profiles row(s) still reference location data -- real tables were NOT touched', v_refs;
  end if;

  select count(*) into v_refs from listings
    where province_id is not null or city_id is not null or barangay_id is not null;
  if v_refs > 0 then
    raise exception 'Aborting: % listings row(s) still reference location data -- real tables were NOT touched', v_refs;
  end if;
end
`$guard`$;

delete from barangays;
delete from cities_municipalities;
delete from provinces;

insert into provinces (country_code, name)
select 'PH', p.name
from _ph_provinces p
on conflict (country_code, name) do nothing;

create temporary table _tmp_province_ids on commit drop as
select p.name, pr.id as province_id
from _ph_provinces p
join provinces pr on pr.country_code = 'PH' and pr.name = p.name;

insert into cities_municipalities (province_id, name)
select tpi.province_id, c.name
from _ph_cities c
join _tmp_province_ids tpi on tpi.name = c.province_name
on conflict (province_id, name) do nothing;

create temporary table _tmp_city_ids on commit drop as
select c.province_name, c.name, cm.id as city_id
from _ph_cities c
join _tmp_province_ids tpi on tpi.name = c.province_name
join cities_municipalities cm on cm.province_id = tpi.province_id and cm.name = c.name;

insert into barangays (city_id, name)
select tci.city_id, b.name
from _ph_barangays b
join _tmp_city_ids tci on tci.province_name = b.province_name and tci.name = b.city_name
on conflict (city_id, name) do nothing;

do `$finalcheck`$
declare
  v_provinces integer;
  v_cities integer;
  v_barangays integer;
begin
  select count(*) into v_provinces from provinces;
  select count(*) into v_cities from cities_municipalities;
  select count(*) into v_barangays from barangays;
  if v_provinces <> 97 or v_cities <> 1642 or v_barangays <> 42010 then
    raise exception 'Final validation failed: provinces=%, cities=%, barangays=% (expected 97/1642/42010) -- rolling back, real tables restored to pre-swap state', v_provinces, v_cities, v_barangays;
  end if;
end
`$finalcheck`$;

drop table if exists _ph_provinces, _ph_province_ids, _ph_cities, _ph_city_ids, _ph_barangays;

delete from supabase_migrations.schema_migrations where name = '$MigrationName';
insert into supabase_migrations.schema_migrations (version, name, statements)
values (
  '$migrationVersion',
  '$MigrationName',
  array['-- applied via scripts/apply-0052.ps1 (staged Management API executor); full SQL in supabase/migrations/0052_ph_location_reference_data_correction.sql']
);
"@
Invoke-ManagementQuery -Label "Step ${TotalSteps}/${TotalSteps}: swap real tables + validate + cleanup + register migration (one transaction)" -Sql $swapSql

Write-Host ""
Write-Host "Done. 0052_ph_location_reference_data_correction.sql has been fully applied:"
Write-Host "  - provinces: 97"
Write-Host "  - cities_municipalities: 1642"
Write-Host "  - barangays: 42010"
Write-Host "  - staging tables dropped"
Write-Host "  - migration recorded as applied (version $migrationVersion, name $MigrationName)"

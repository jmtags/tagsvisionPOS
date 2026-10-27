param(
  [string]$ProjectRef = '',
  [string]$AppUrl = 'http://127.0.0.1:5173',
  [switch]$SkipLogin,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$posRepoPath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $posRepoPath
try {
  if (-not $ProjectRef) {
    # Print only the public project reference; never echo environment keys.
    $posProjectScript = @'
import {loadEnv} from 'vite';
const env=loadEnv('development',process.cwd(),'VITE_');
const match=new URL(env.VITE_SUPABASE_URL).hostname.match(/^([a-z0-9]+)[.]supabase[.]co$/);
if(!match)throw new Error('Pass -ProjectRef for a custom Supabase domain');
console.log(match[1]);
'@
    $ProjectRef = ($posProjectScript | & node --input-type=module)
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the Supabase project reference from .env/.env.local.' }
    $ProjectRef = "$ProjectRef".Trim()
  }
  if ($ProjectRef -notmatch '^[a-z0-9]+$') { throw 'Invalid Supabase project reference.' }
  $posAppUri = [Uri]$AppUrl
  if (-not $posAppUri.IsAbsoluteUri -or $posAppUri.Scheme -notin @('http', 'https')) {
    throw 'AppUrl must be an absolute HTTP or HTTPS URL.'
  }
  $AppUrl = $posAppUri.GetLeftPart([UriPartial]::Authority)
  Write-Host "Supabase project: $ProjectRef"
  Write-Host "Allowed app origin: $AppUrl"
  if ($DryRun) {
    Write-Host 'Dry run: configuration is valid; no login, secret change, or deployment performed.'
    return
  }
  $posNpxPath = (Get-Command npx.cmd -ErrorAction Stop).Source
  $posCachePath = Join-Path $posRepoPath '.npm-cache'
  function Invoke-StaffCli([string[]]$CliArguments) {
    & $posNpxPath --yes --cache $posCachePath 'supabase@latest' @CliArguments
    if ($LASTEXITCODE -ne 0) { throw "Supabase CLI failed: $($CliArguments[0])" }
  }
  if (-not $SkipLogin -and -not $env:SUPABASE_ACCESS_TOKEN) {
    Invoke-StaffCli -CliArguments @('login')
  }
  Invoke-StaffCli -CliArguments @('secrets', 'set', "APP_URL=$AppUrl", '--project-ref', $ProjectRef)
  Invoke-StaffCli -CliArguments @('functions', 'deploy', 'manage-staff', '--project-ref', $ProjectRef, '--no-verify-jwt', '--use-api')
  $posCheck = Invoke-WebRequest -UseBasicParsing -Uri "https://$ProjectRef.supabase.co/functions/v1/manage-staff" -Method Options -Headers @{
    Origin = $AppUrl
    'Access-Control-Request-Method' = 'POST'
    'Access-Control-Request-Headers' = 'authorization,apikey,content-type'
  }
  if ($posCheck.StatusCode -ne 204 -or $posCheck.Headers['Access-Control-Allow-Origin'] -ne $AppUrl) {
    throw 'Deployment returned an unexpected CORS response. Check the function logs and APP_URL.'
  }
  Write-Host 'Staff function deployed and CORS check passed.'
  Write-Host 'Ensure 202610220002_admin_staff_passwords.sql is applied, then refresh the app and retry Add user.'
} finally {
  Pop-Location
}

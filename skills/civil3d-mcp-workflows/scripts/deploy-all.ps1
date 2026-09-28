# One-command deploy of the Civil3D-MCP plugin (chains the scripts of the 3-layer procedure; agent civil3d-deploy explains why).
#   pwsh -NoProfile -File deploy-all.ps1                     # PLAN ONLY: builds both layers, compares with what is installed, prints what would change
#   pwsh -NoProfile -File deploy-all.ps1 -Go -AllowSave 'FASE 1.dwg' [-Relaunch '<dwg path>']   # executes
# What it does (each step is skipped when nothing changed):
#   1. dotnet build -c Release (0 errors required)        2. npm run build (tsc)
#   3. layer 2: build/ -> installed extension server/ (Copy-Item; nothing to close)
#   4. layer 1: if the DLL differs from the ProgramData one: close-civil3d.ps1 -AllowSave <fragments> (stops on any unknown dialog,
#      never clicks the user's dialogs) -> install-plugin-dll.ps1 -> Start-Process <dwg> (-Relaunch) -> waits for port 8080
#   5. integrity-check.mjs --only deploy,bugs
# It NEVER does the two USER steps and says so at the end: approve the "Unsigned Executable File" dialog in Civil 3D, and (after layer 2
# or a new tool) fully quit + reopen Claude Desktop and open a new chat. Civil 3D is only closed with -Go, and only through
# close-civil3d.ps1 (save the drawing first: `civil3d_drawing save`).
param(
  [switch]$Go,
  [switch]$ForceBuild,
  [string]$AllowSave = '',
  [string]$Discard = 'c3d-dwg-dump',
  [string]$Relaunch = '',
  [string]$Repo = 'C:\Users\camil\OneDrive\Documents\Civil3D-mcp'
)
$ErrorActionPreference = 'Stop'
$skill = Split-Path -Parent $PSScriptRoot
$scripts = Join-Path $skill 'scripts'
$plugin = Join-Path $Repo 'Civil3D-MCP-Plugin'
$binDll = Join-Path $plugin 'bin\Release\net10.0-windows\Civil3DMcpPlugin.dll'
$bundleDll = 'C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\Contents\Civil3DMcpPlugin.dll'
$ext = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server' }) +
  (Join-Path $env:APPDATA 'Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server') | Where-Object { Test-Path $_ } | Select-Object -First 1
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Hash($p) { if (Test-Path $p) { (Get-FileHash $p -Algorithm SHA256).Hash } else { '' } }
$userSteps = @()

Step '1. dotnet build -c Release (only if a .cs file is newer than the installed DLL, or -ForceBuild)'
$refs = Join-Path $Repo 'C_References'
$newestCs = (Get-ChildItem $plugin -Recurse -Filter *.cs -File | Where-Object { $_.FullName -notmatch '[\\/](obj|bin)[\\/]' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
$installedAt = if (Test-Path $bundleDll) { (Get-Item $bundleDll).LastWriteTime } else { [datetime]::MinValue }
$srcNewer = $newestCs -gt $installedAt.AddSeconds(2)
if ($srcNewer -or $ForceBuild) {
  if (-not (Test-Path $refs)) { throw "C_References missing ($refs): rebuild it from the AutoCAD 2027 folders (see memory plugin-deployment-gotcha step 1)" }
  Push-Location $plugin
  try { dotnet build -c Release "/p:Civil3DReferencesPath=$refs" -nologo -v q 2>&1 | Select-Object -Last 6; if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed' } } finally { Pop-Location }
} else { Write-Host "no .cs newer than the installed DLL ($installedAt): build skipped (builds are not byte-deterministic, so a rebuild would look like a change)" }

Step '2. npm run build'
Push-Location $Repo
try { npm run build --silent 2>&1 | Select-Object -Last 5; if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' } } finally { Pop-Location }

$dllChanged = $srcNewer -or ($ForceBuild -and (Hash $binDll) -ne (Hash $bundleDll))
$srvDiff = @()
if ($ext) {
  foreach ($f in Get-ChildItem (Join-Path $Repo 'build') -Recurse -File) {
    $rel = $f.FullName.Substring((Join-Path $Repo 'build').Length).TrimStart('\')
    if ((Hash $f.FullName) -ne (Hash (Join-Path $ext $rel))) { $srvDiff += $rel }
  }
} else { Write-Host 'WARN extension server/ folder not found: layer 2 cannot be checked' -ForegroundColor Yellow }
Write-Host ("layer 1 (DLL):  {0}" -f $(if ($dllChanged) { 'CHANGED -> needs install (Civil 3D must be closed)' } else { 'up to date' }))
Write-Host ("layer 2 (Node): {0}" -f $(if ($srvDiff.Count) { "$($srvDiff.Count) file(s) differ: $($srvDiff | Select-Object -First 4 | Join-String -Separator ', ')" } else { 'up to date' }))
if (-not $Go) { Write-Host "`nPLAN ONLY (nothing installed or closed). Re-run with -Go [-AllowSave 'file.dwg'] [-Relaunch '<dwg>'] to execute." -ForegroundColor Yellow }

if ($Go -and $srvDiff.Count) {
  Step '3. layer 2: copy build/ -> extension server/'
  Copy-Item (Join-Path $Repo 'build\*') $ext -Recurse -Force
  Write-Host "copied $($srvDiff.Count) changed file(s)"
  $userSteps += 'Fully quit Claude Desktop (tray > Quit) and open a NEW chat: new tools/fields are invisible until then (a subagent does not count).'
}

if ($Go -and $dllChanged) {
  Step '4. layer 1: close Civil 3D -> install DLL -> relaunch'
  if (Get-Process acad -ErrorAction SilentlyContinue) {
    & pwsh -NoProfile -File (Join-Path $scripts 'close-civil3d.ps1') -AllowSave $AllowSave -Discard $Discard
    if (Get-Process acad -ErrorAction SilentlyContinue) { throw 'Civil 3D is still running (a dialog needs the user, see the output above). Answer it and re-run.' }
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'install-plugin-dll.ps1') -Repo $Repo
  if ($LASTEXITCODE -ne 0) { throw 'install-plugin-dll.ps1 failed' }
  if ($Relaunch) {
    Start-Process $Relaunch
    Write-Host 'Relaunched. Waiting for port 8080 (approve the "Unsigned Executable File" dialog in Civil 3D - never automated)...'
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) { if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { break }; Start-Sleep 3 }
    if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
      Write-Host 'port 8080 is up'
      if ((Get-Process acad -ErrorAction SilentlyContinue).MainWindowTitle -match 'Drawing1') { $userSteps += "Civil 3D opened Drawing1.dwg (it started before it finished loading): run Start-Process '$Relaunch' again." }
    } else { $userSteps += 'Port 8080 did not open in 5 min: approve the Unsigned Executable File dialog in Civil 3D.' }
  } else { $userSteps += 'Open Civil 3D on your drawing (Start-Process "<dwg>") and approve the "Unsigned Executable File" dialog.' }
} elseif ($Go) { Write-Host "`nlayer 1 already up to date: Civil 3D untouched." }

Step '5. integrity-check (deploy + bugs)'
& node (Join-Path $scripts 'integrity-check.mjs') --only deploy,bugs --brief --offline

if ($userSteps.Count) { Write-Host "`nPENDING - YOUR STEPS:" -ForegroundColor Yellow; $userSteps | ForEach-Object { Write-Host " * $_" } }
elseif ($Go) { Write-Host "`nDeploy complete: nothing pending for you." -ForegroundColor Green }

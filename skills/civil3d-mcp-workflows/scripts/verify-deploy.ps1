# Verifica que una acción/tool nueva esté presente en las 3 capas de despliegue.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File verify-deploy.ps1 <action_snake> [-PluginMethod camelCase] [-Repo RUTA]
# Ej.: verify-deploy.ps1 list_shape_entities -PluginMethod listShapeEntities
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Action,
  [string]$PluginMethod,
  [string]$Repo = 'C:\Users\camil\OneDrive\Documents\Civil3D-mcp'
)
$ErrorActionPreference = 'SilentlyContinue'
# Claude Desktop (MSIX) guarda las extensiones en la carpeta del paquete; %APPDATA%\Claude solo resuelve
# ahí desde procesos virtualizados dentro del paquete. Se revisan ambas rutas.
$extCandidates = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' | ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server' }) + (Join-Path $env:APPDATA 'Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server')
$ext = ($extCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
if (-not $ext) { $ext = $extCandidates[-1] }
$bundleDll = 'C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\Contents\Civil3DMcpPlugin.dll'
$binDll = Join-Path $Repo 'Civil3D-MCP-Plugin\bin\Release\net10.0-windows\Civil3DMcpPlugin.dll'

function Hits($path, $pattern, $filter) {
  if (-not (Test-Path $path)) { return "NO EXISTE ($path)" }
  $n = (Get-ChildItem $path -Recurse -File -Filter $filter | Select-String -Pattern $pattern -SimpleMatch | Measure-Object).Count
  if ($n -gt 0) { "OK ($n coincidencias)" } else { "FALTA" }
}

Write-Output "Acción: $Action  ·  método plugin: $(if ($PluginMethod) { $PluginMethod } else { '(no indicado)' })`n"
Write-Output ("[repo src]        {0}" -f (Hits (Join-Path $Repo 'src') "`"$Action`"" '*.ts'))
Write-Output ("[repo build]      {0}" -f (Hits (Join-Path $Repo 'build') "`"$Action`"" '*.js'))
Write-Output ("[extensión MCP]   {0}   ← capa 2 (server/ de Claude Desktop)" -f (Hits $ext "`"$Action`"" '*.js'))
if ($PluginMethod) {
  Write-Output ("[C# dispatcher]   {0}" -f (Hits (Join-Path $Repo 'Civil3D-MCP-Plugin') "`"$PluginMethod`"" 'CommandDispatcher.cs'))
  foreach ($d in @(@('bin Release', $binDll), @('ProgramData', $bundleDll))) {
    if (Test-Path $d[1]) {
      $has = Select-String -Path $d[1] -Pattern $PluginMethod -SimpleMatch -Encoding Unicode -Quiet
      if (-not $has) { $has = Select-String -Path $d[1] -Pattern $PluginMethod -SimpleMatch -Quiet }
      Write-Output ("[DLL {0,-11}] {1} · {2}" -f $d[0], $(if ($has) { 'contiene método' } else { 'NO contiene método' }), (Get-Item $d[1]).LastWriteTime)
    } else { Write-Output ("[DLL {0,-11}] NO EXISTE" -f $d[0]) }
  }
}
if ((Test-Path $binDll) -and (Test-Path $bundleDll) -and ((Get-Item $binDll).LastWriteTime -gt (Get-Item $bundleDll).LastWriteTime)) {
  Write-Output "!! El DLL de bin/Release es más nuevo que el de ProgramData → capa 1 sin copiar."
}
$acad = Get-Process acad | Select-Object -First 1
if ($acad -and (Test-Path $bundleDll) -and ($acad.StartTime -lt (Get-Item $bundleDll).LastWriteTime)) {
  Write-Output "!! Civil 3D arrancó antes de copiar el DLL → reiniciar Civil 3D."
}
$claude = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Sort-Object CreationDate | Select-Object -First 1
if ($claude -and (Test-Path $ext)) {
  $extTime = (Get-ChildItem $ext -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
  if ($claude.CreationDate -lt $extTime) { Write-Output "!! Claude Desktop arrancó ($($claude.CreationDate)) antes del despliegue de la extensión ($extTime) → el usuario debe reiniciar la app y abrir un chat NUEVO." }
  else { Write-Output "Claude Desktop arrancó después del despliegue: OK (usa un chat nuevo de nivel superior para ver tools nuevas)." }
}

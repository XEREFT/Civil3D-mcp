<#
  Abre Civil 3D 2027 (si no está abierto), carga el plugin MCP con NETLOAD por COM y espera
  al puerto 8080. Idempotente: si ya está todo listo, solo lo informa.
  Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File start-civil3d-mcp.ps1 [-Dwg <ruta.dwg>] [-WaitLoginMin 5] [-Quit]
  - Si Civil 3D pide iniciar sesión en Autodesk, el script espera: el usuario pulsa "Retry" en la
    página "Opening product" del navegador y acepta "Abrir AdskIdentityManager". Nunca lee ni pasa
    contraseñas, códigos ni URLs de inicio de sesión.
  - -Dwg abre ese dibujo en vez de uno nuevo (Drawing1) antes del NETLOAD.
  - -Quit cierra Civil 3D solo si lo único abierto es un Drawing# vacío (sin guardar nada del usuario).
#>
param(
  [string]$Dwg = '',
  [int]$WaitLoginMin = 5,
  [switch]$Quit
)
$ErrorActionPreference = 'Stop'
$dll  = 'C:/ProgramData/Autodesk/ApplicationPlugins/Civil3DMcpPlugin.bundle/Contents/Civil3DMcpPlugin.dll'
$lnk  = 'C:\Users\Public\Desktop\Civil 3D 2027 Imperial.lnk'
$log  = Join-Path $env:LOCALAPPDATA 'Civil3DMcpPlugin\plugin.log'

function Port8080 { [bool](Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue) }
function GetAcad  { try { [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application') } catch { $null } }
# Reintenta mientras Civil 3D rechaza llamadas (ventana modal o arrancando)
function Retry([scriptblock]$f, [int]$maxSec) {
  $t0 = Get-Date
  while ($true) {
    try { return & $f } catch {
      if (((Get-Date) - $t0).TotalSeconds -gt $maxSec) { throw }
      Start-Sleep 3
    }
  }
}

if ($Quit) {
  $a = GetAcad
  if (-not $a) { 'Civil 3D no está abierto.'; return }
  $docs = @(for ($i = 0; $i -lt $a.Documents.Count; $i++) { $a.Documents.Item($i) })
  $vacios = @($docs | Where-Object { $_.Name -match '^Drawing\d+\.dwg$' -and $_.FullName -notmatch '\\' -and $_.ModelSpace.Count -eq 0 })
  if ($docs.Count -eq $vacios.Count) { foreach ($d in $docs) { Retry { $d.Close($false) } 30 }; Retry { $a.Quit() } 30; 'Civil 3D cerrado (solo había dibujos vacíos).' }
  else { 'NO se cierra: hay dibujos con contenido o guardados. Pídele al usuario que los cierre.' }
  return
}

if (-not (Get-Process acad -ErrorAction SilentlyContinue)) {
  'Abriendo Civil 3D...'
  Start-Process $lnk
}
if (Port8080) { 'Plugin ya activo en el puerto 8080.' }
else {
  $a = $null; $t0 = Get-Date; $avisado = $false
  while (-not $a -or $true) {
    $a = GetAcad
    if ($a) { try { $null = $a.Documents.Count; break } catch {} }
    if (((Get-Date) - $t0).TotalMinutes -gt $WaitLoginMin) { throw "Civil 3D no responde tras $WaitLoginMin min. ¿Ventana de inicio de sesión de Autodesk abierta? Pide al usuario: pulsar Retry en la página 'Opening product' y Abrir en el cuadro de Identity Manager (NO cerrar con la X: apaga Civil 3D)." }
    if (-not $avisado -and ((Get-Date) - $t0).TotalSeconds -gt 60) { 'Civil 3D está esperando (¿inicio de sesión de Autodesk?). Esperando...'; $avisado = $true }
    Start-Sleep 5
  }
  Retry { if ($a.Documents.Count -eq 0) { if ($Dwg) { $null = $a.Documents.Open($Dwg) } else { $null = $a.Documents.Add() } } } 120
  Start-Sleep 3
  Retry { $a.ActiveDocument.SendCommand("(command `"_.NETLOAD`" `"$dll`") ") } 120
  $t1 = Get-Date
  while (-not (Port8080) -and ((Get-Date) - $t1).TotalSeconds -lt 60) { Start-Sleep 2 }
}
if (Port8080) { "OK: plugin MCP activo en el puerto 8080."; if (Test-Path $log) { Get-Content $log -Tail 1 } }
else { "FALLO: el puerto 8080 sigue cerrado. Si salió 'Security - Unsigned Executable File', el usuario debe aprobarlo (Always Load). Log: $log"; exit 1 }

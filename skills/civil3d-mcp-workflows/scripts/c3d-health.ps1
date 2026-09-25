# Diagnóstico de conexión Claude ↔ MCP ↔ plugin Civil 3D, sin pasar por MCP.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File c3d-health.ps1 [-Port 8080] [-LogLines 15]
param([int]$Port = 8080, [int]$LogLines = 15, [int]$TimeoutMs = 5000)

$ErrorActionPreference = 'SilentlyContinue'
function Section($t) { Write-Output "`n=== $t ===" }

Section "1. Civil 3D (acad.exe)"
$acad = Get-Process acad
if (-not $acad) { Write-Output "NO está corriendo → 'Failed to connect' esperado. Pedir al usuario abrir Civil 3D con un dibujo." }
else { $acad | ForEach-Object { Write-Output ("PID {0} · inicio {1} · Responding={2} · Mem {3:N0} MB · Ventana: {4}" -f $_.Id, $_.StartTime, $_.Responding, ($_.WorkingSet64/1MB), $_.MainWindowTitle) }
       if ($acad | Where-Object { -not $_.Responding }) { Write-Output "!! acad.exe NO RESPONDE → probable diálogo modal o regeneración pesada. Pedir al usuario revisar la ventana." } }

Section "2. Puerto $Port"
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen
if ($conn) { Write-Output ("LISTEN · proceso {0}" -f $conn[0].OwningProcess) } else { Write-Output "Nadie escucha en $Port → plugin no cargado o listener detenido (usuario: C3DMCPSTATUS / C3DMCPSTART)." }

Section "3. JSON-RPC directo getCivil3DHealth"
if ($conn) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { throw "timeout de conexión ($TimeoutMs ms)" }
    $client.EndConnect($iar)
    $stream = $client.GetStream(); $stream.ReadTimeout = $TimeoutMs
    $req = '{"jsonrpc":"2.0","id":"c3d-health-script","method":"getCivil3DHealth","params":{}}'
    $bytes = [Text.Encoding]::UTF8.GetBytes($req); $stream.Write($bytes, 0, $bytes.Length)
    $buf = New-Object byte[] 65536; $sb = New-Object Text.StringBuilder; $parsed = $null
    while (-not $parsed) {
      $n = $stream.Read($buf, 0, $buf.Length); if ($n -le 0) { break }
      [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $n))
      try { $parsed = $sb.ToString() | ConvertFrom-Json -ErrorAction Stop } catch { }
    }
    $client.Close()
    if ($parsed.error) { Write-Output ("ERROR RPC: {0}" -f ($parsed.error | ConvertTo-Json -Compress)) }
    elseif ($parsed.result) {
      $r = $parsed.result
      Write-Output ("connected={0} · drawingLoaded={1} · plugin {2} · ACADVER {3}" -f $r.connected, $r.drawingLoaded, $r.pluginVersion, $r.civil3dVersion)
      Write-Output ("operationInProgress={0} · current={1} · durationMs={2} · queue {3}/{4}" -f $r.operationInProgress, $r.currentOperation, $r.currentOperationDurationMs, $r.queueDepth, $r.queueCapacity)
      if ($r.operationInProgress -and $r.currentOperationDurationMs -gt 30000) { Write-Output "!! Operación colgada > 30 s → diálogo modal casi seguro. NO reintentar; pedir al usuario revisar Civil 3D." }
      Write-Output "→ El plugin responde. Si la herramienta MCP falla igual, el problema está en el servidor Node / extensión (ver sección 5)."
    } else { Write-Output "Respuesta vacía o ilegible: $($sb.ToString())" }
  } catch { Write-Output "Fallo TCP: $_ → el plugin no atiende (hilo bloqueado o listener caído)." }
} else { Write-Output "(omitido: puerto cerrado)" }

Section "4. plugin.log (últimas $LogLines líneas)"
$logDir = if ($env:CIVIL3D_MCP_LOG_DIR) { $env:CIVIL3D_MCP_LOG_DIR } else { Join-Path $env:LOCALAPPDATA 'Civil3DMcpPlugin' }
$log = Join-Path $logDir 'plugin.log'
if (Test-Path $log) { Write-Output ("Modificado: {0}" -f (Get-Item $log).LastWriteTime); Get-Content $log -Tail $LogLines } else { Write-Output "No existe $log (el plugin nunca cargó en este usuario)." }

Section "5. Claude Desktop vs despliegue de la extensión"
# Claude Desktop (MSIX): la extensión vive en la carpeta del paquete; %APPDATA%\Claude solo resuelve ahí desde procesos virtualizados.
$extCandidates = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' | ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server' }) + (Join-Path $env:APPDATA 'Claude\Claude Extensions\local.mcpb.steven-bouldin.civil3d-mcp\server')
$ext = ($extCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
if (-not $ext) { $ext = $extCandidates[-1] }
Write-Output "Extensión: $ext"
$claude = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Sort-Object CreationDate | Select-Object -First 1
if (Test-Path $ext) {
  $extTime = (Get-ChildItem $ext -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
  Write-Output "Extensión server/ última modificación: $extTime"
  if ($claude) { Write-Output ("Claude.exe más antiguo arrancó: {0}" -f $claude.CreationDate)
    if ($claude.CreationDate -lt $extTime) { Write-Output "!! Claude Desktop arrancó ANTES del último despliegue → herramientas nuevas no visibles hasta que el usuario reinicie la app." } }
} else { Write-Output "No se encontró la extensión instalada en $ext" }
$bundle = 'C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle'
if (Test-Path "$bundle\PackageContents.xml") { Write-Output ("Bundle OK · DLL: {0}" -f (Get-Item "$bundle\Contents\Civil3DMcpPlugin.dll").LastWriteTime) }
elseif (Test-Path $bundle) { Write-Output "!! Bundle sin PackageContents.xml (¿quedó como .xml.txt?) → Civil 3D no autocarga el plugin." }

# Copies the freshly built plugin DLL/PDB into the Civil 3D bundle. Civil 3D must be closed
# (it locks the DLL). Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-plugin-dll.ps1 [-Repo <path>]
param(
  [string]$Repo = "C:\Users\camil\OneDrive\Documents\Civil3D-mcp"
)
$ErrorActionPreference = "Stop"
$src = Join-Path $Repo "Civil3D-MCP-Plugin\bin\Release\net10.0-windows"
$dst = "C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\Contents"

$acad = Get-Process acad -ErrorAction SilentlyContinue
if ($acad) {
  Write-Host "ABORT: Civil 3D (acad.exe PID $($acad.Id -join ', ')) is still running. Close it first." -ForegroundColor Red
  exit 1
}

foreach ($name in "Civil3DMcpPlugin.dll", "Civil3DMcpPlugin.pdb", "Civil3DMcpPlugin.deps.json") {
  $from = Join-Path $src $name
  $to = Join-Path $dst $name
  if (-not (Test-Path $from)) { Write-Host "ABORT: missing build output $from" -ForegroundColor Red; exit 1 }
  Copy-Item $from $to -Force
  $h1 = (Get-FileHash $from).Hash; $h2 = (Get-FileHash $to).Hash
  if ($h1 -ne $h2) { Write-Host "FAIL: hash mismatch for $name" -ForegroundColor Red; exit 1 }
  Write-Host ("OK  {0,-28} {1}  {2}" -f $name, (Get-Item $to).LastWriteTime, $h2.Substring(0, 12))
}
Write-Host "Done. Open Civil 3D, then check plugin.log for a fresh init and restart the Claude app if the Node layer changed."

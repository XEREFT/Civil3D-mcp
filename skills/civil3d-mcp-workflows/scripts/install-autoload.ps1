<#
  Registra el plugin MCP para que Civil 3D 2027 lo cargue solo al arrancar (demand-load por registro de usuario).
  Hace falta porque el bundle (PackageContents.xml, LoadOnAutoCADStartup) NO se autocarga en Civil 3D 2027 aunque
  Platform sea "Civil3D" o "AutoCAD*". Probado 2026-10-21: con esta clave el puerto 8080 abre solo.
  Uso: powershell -NoProfile -ExecutionPolicy Bypass -File install-autoload.ps1 [-Remove]
  Tras reinstalar Windows/Civil 3D hay que volver a correrlo (y confirmar el código de producto abajo).
#>
param([switch]$Remove)
$dll = 'C:\ProgramData\Autodesk\ApplicationPlugins\Civil3DMcpPlugin.bundle\Contents\Civil3DMcpPlugin.dll'
# Código de producto de Civil 3D 2027: la clave HKLM con ProductName "Autodesk Civil 3D 2027" (aquí ACAD-A100:409)
$prod = Get-ChildItem 'HKLM:\Software\Autodesk\AutoCAD\R26.0' -ErrorAction Stop |
  Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ProductName -like '*Civil 3D 2027*' } |
  Select-Object -First 1 -ExpandProperty PSChildName
if (-not $prod) { throw 'No encontré Civil 3D 2027 en HKLM:\Software\Autodesk\AutoCAD\R26.0' }
$k = "HKCU:\Software\Autodesk\AutoCAD\R26.0\$prod\Applications\Civil3DMcpPlugin"
if ($Remove) { Remove-Item $k -Recurse -ErrorAction SilentlyContinue; "Autoarranque quitado ($prod)"; return }
if (-not (Test-Path $dll)) { throw "No existe la DLL: $dll (instala el bundle primero)" }
New-Item $k -Force | Out-Null
Set-ItemProperty $k DESCRIPTION 'Civil3D MCP plugin'
Set-ItemProperty $k LOADER $dll
Set-ItemProperty $k LOADCTRLS 2 -Type DWord
Set-ItemProperty $k MANAGED 1 -Type DWord
"Autoarranque registrado en $k. Abre Civil 3D y revisa el puerto 8080 (o usa start-civil3d-mcp.ps1)."

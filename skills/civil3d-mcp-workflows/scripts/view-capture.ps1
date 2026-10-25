# Looks at the live Civil 3D window without the user: zooms the ACTIVE view of a document to a model window and saves a PNG of the Civil 3D window (PrintWindow).
# Use it to verify a label / hidden item / colour on the real screen before and after an edit.
#   powershell -NoProfile -ExecutionPolicy Bypass -File view-capture.ps1 -Out "<png>" [-Doc "SEIDENSTEIN*"] [-Window "893250,497590 893390,497730"]
# -Window = two model corners "x1,y1 x2,y2" (sent as ZOOM _W; COM ZoomCenter/ZoomWindow and VIEWCTR writes are unreliable on a twisted view). Omit it to capture as is.
# The drawing must be idle (CMDACTIVE=0). The view stays zoomed afterwards (view changes are not drawing edits).
param([Parameter(Mandatory)][string]$Out, [string]$Doc = '*', [string]$Window)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class PW3 { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int L,T,R,B; } }
"@
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application')
$d = $null; foreach ($x in $app.Documents) { if ($x.Name -like $Doc) { $d = $x } }
if (-not $d) { throw "no open document matching '$Doc'" }
if ($app.ActiveDocument.Name -ne $d.Name) { $d.Activate(); Start-Sleep 2 }
if ($Window) { for ($i = 0; $i -lt 6; $i++) { try { $d.SendCommand("_.ZOOM _W $Window `n"); break } catch { Start-Sleep 2 } }; Start-Sleep 4 }
$h = [IntPtr]$app.HWND; $r = New-Object PW3+RECT; [PW3]::GetWindowRect($h, [ref]$r) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T); $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[PW3]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"view: center=" + ($d.GetVariable('VIEWCTR') -join ',') + " size=" + $d.GetVariable('VIEWSIZE') + " saved=" + $Out

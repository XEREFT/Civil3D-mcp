# SCAN OCR: reads a scanned sheet (WASD as-built TIF, recorded plat, any raster/PDF page exported to an image) with the OCR built into
# Windows (Windows.Media.Ocr: nothing to install) and writes every line + word with its box in ORIGINAL image pixels, as JSON.
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scan-ocr.ps1 -Image <scan.tif|png|jpg> -Out <ocr.json> [-Rotations 0,90,270]
# Each rotation is a separate pass (as-builts carry text along the pipes/streets, rotated 90/270): the bitmap is rotated before the OCR
# and every box is mapped back to the unrotated image, so all passes share one pixel frame. Duplicates across passes are kept (the
# consumer, asbuilt-extract.mjs, keeps the best reading). Read-only: the scan is never modified.
# Needs Windows PowerShell 5.1 (powershell.exe), not pwsh: WinRT projection. Max OCR side: [Windows.Media.Ocr.OcrEngine]::MaxImageDimension.
param(
  [Parameter(Mandatory)][string]$Image,
  [Parameter(Mandatory)][string]$Out,
  [int[]]$Rotations = @(0, 90, 270)
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait() | Out-Null; $task.Result }
function Num($v) { [double]($v | Select-Object -First 1) }

$path = (Resolve-Path $Image).Path
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$ImgW = [int]$decoder.PixelWidth; $ImgH = [int]$decoder.PixelHeight
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'No Windows OCR language available (Settings > Time & language > Language: add English)' }

# rotated (u,v) -> original (x,y). BitmapTransform rotations are clockwise. Returns an object, never an array: PowerShell would
# unroll @(x,y) pairs when they are collected (first version mixed X and Y that way). Image size lives in $ImgW/$ImgH: PowerShell names are case-insensitive and dynamically scoped, so a caller's $h (word height) shadowed $H (image height).
function ToOriginal([double]$u, [double]$v, [int]$rot) {
  switch ($rot) {
    0 { return [pscustomobject]@{ x = $u; y = $v } }
    90 { return [pscustomobject]@{ x = $v; y = ($ImgH - $u) } }          # rotated 90 cw: u = H - y, v = x
    180 { return [pscustomobject]@{ x = ($ImgW - $u); y = ($ImgH - $v) } }
    270 { return [pscustomobject]@{ x = ($ImgW - $v); y = $u } }         # rotated 270 cw: u = y, v = W - x
  }
}
function BoxToOriginal($r, [int]$rot) {
  $x = Num $r.X; $y = Num $r.Y; $w = Num $r.Width; $h = Num $r.Height
  $pts = @((ToOriginal $x $y $rot), (ToOriginal ($x + $w) $y $rot), (ToOriginal $x ($y + $h) $rot), (ToOriginal ($x + $w) ($y + $h) $rot))
  $xs = $pts | ForEach-Object { $_.x }; $ys = $pts | ForEach-Object { $_.y }
  $x0 = ($xs | Measure-Object -Minimum).Minimum; $y0 = ($ys | Measure-Object -Minimum).Minimum
  $x1 = ($xs | Measure-Object -Maximum).Maximum; $y1 = ($ys | Measure-Object -Maximum).Maximum
  [ordered]@{ x = [math]::Round($x0, 1); y = [math]::Round($y0, 1); w = [math]::Round($x1 - $x0, 1); h = [math]::Round($y1 - $y0, 1) }
}

$passes = @()
foreach ($rot in $Rotations) {
  $tf = New-Object Windows.Graphics.Imaging.BitmapTransform
  $tf.Rotation = switch ($rot) { 0 { 'None' } 90 { 'Clockwise90Degrees' } 180 { 'Clockwise180Degrees' } 270 { 'Clockwise270Degrees' } }
  $op = $decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
    $tf, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)
  $bmp = Await $op ([Windows.Graphics.Imaging.SoftwareBitmap])
  Write-Host ("rotation {0,3}: bitmap {1} x {2}" -f $rot, $bmp.PixelWidth, $bmp.PixelHeight)
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in @($res.Lines)) {
    $words = @()
    foreach ($wd in @($line.Words)) {
      $r = $wd.BoundingRect
      $raw = [ordered]@{ x = (Num $r.X); y = (Num $r.Y); w = (Num $r.Width); h = (Num $r.Height) }
      $words += [ordered]@{ text = [string]$wd.Text; box = (BoxToOriginal $r $rot); raw = $raw }
    }
    if (-not $words.Count) { continue }
    $bx0 = ($words | ForEach-Object { $_.box.x } | Measure-Object -Minimum).Minimum
    $by0 = ($words | ForEach-Object { $_.box.y } | Measure-Object -Minimum).Minimum
    $bx1 = ($words | ForEach-Object { $_.box.x + $_.box.w } | Measure-Object -Maximum).Maximum
    $by1 = ($words | ForEach-Object { $_.box.y + $_.box.h } | Measure-Object -Maximum).Maximum
    $lines += [ordered]@{ text = [string]$line.Text; rotation = $rot; box = [ordered]@{ x = $bx0; y = $by0; w = $bx1 - $bx0; h = $by1 - $by0 }; words = $words }
  }
  $passes += [ordered]@{ rotation = $rot; lines = $lines }
  Write-Host ("rotation {0,3}: {1} lines" -f $rot, $lines.Count)
}
$doc = [ordered]@{ image = $path; width = $ImgW; height = $ImgH; engine = 'Windows.Media.Ocr'; language = $engine.RecognizerLanguage.LanguageTag; passes = $passes }
[System.IO.File]::WriteAllText($Out, ($doc | ConvertTo-Json -Depth 8 -Compress), (New-Object System.Text.UTF8Encoding $false))
Write-Host "ocr -> $Out"

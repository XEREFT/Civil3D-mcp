# Closes Civil 3D. Answers "Save changes to <file>?" with Yes ONLY when the file name contains one of the
# -AllowSave fragments (drawings this session already saved; the prompt is often a phantom "dirty" flag).
# Any other dialog stops and is reported - never click the user's dialogs (security prompts, other drawings).
#   pwsh -NoProfile -File close-civil3d.ps1 -AllowSave 'FASE 1.dwg;CREATOR.dwg'   (';'-separated fragments)
param([string]$AllowSave = '', [int]$TimeoutSec = 120)
$allow = @($AllowSave -split ';' | Where-Object { $_.Trim() })
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class C3dClose { public delegate bool P(IntPtr h, IntPtr l);
[DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);
[DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr w, P p, IntPtr l);
[DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
// Returns "" when no dialog, "YES:<msg>" after clicking Yes on an allowed save prompt, "STOP:<texts>" otherwise.
public static string Handle(uint pid, string[] allow) {
  string result = "";
  EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); var c=new StringBuilder(64); GetClassName(h,c,64);
    if(p!=pid || !IsWindowVisible(h) || c.ToString()!="#32770") return true;
    string msg=null; IntPtr yes=IntPtr.Zero; var all=new List<string>();
    EnumChildWindows(h,(k,l2)=>{ var s=new StringBuilder(512); GetWindowText(k,s,512); var t=s.ToString(); all.Add(t);
      if(t.StartsWith("Save changes to")) msg=t; if(t=="&Yes") yes=k; return true;},IntPtr.Zero);
    bool ok = msg!=null && yes!=IntPtr.Zero && Array.Exists(allow, a => msg.Contains(a));
    if(ok){ SendMessage(yes,0xF5,IntPtr.Zero,IntPtr.Zero); result="YES:"+msg; } else { result="STOP:"+string.Join(" / ", all); }
    return false; },IntPtr.Zero);
  return result; } }
"@
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$p = Get-Process acad -ErrorAction SilentlyContinue
if ($p) { $p.CloseMainWindow() | Out-Null }
while ((Get-Process acad -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep 3
  $p = Get-Process acad -ErrorAction SilentlyContinue; if (-not $p) { break }
  $r = [C3dClose]::Handle([uint32]$p.Id, $allow)
  if ($r.StartsWith('YES:')) { "save prompt answered Yes: " + $r.Substring(4) }
  elseif ($r.StartsWith('STOP:')) { "STOP - dialog needs the user: " + $r.Substring(5); exit 2 }
  elseif ($p.MainWindowTitle) { $p.CloseMainWindow() | Out-Null }
}
if (Get-Process acad -ErrorAction SilentlyContinue) { "still open: " + (Get-Process acad).MainWindowTitle; exit 1 } else { "Civil 3D closed" }

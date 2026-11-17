# Starts Windows Terminal for an app running inside WSL and brings its window
# to the foreground. Windows refuses focus changes requested by background
# processes, and processes started through WSL interop count as background, so
# the new window would otherwise open behind the app.
#
# The launcher prepends `$terminalArguments` (the wt.exe command line). The
# line `started` on stdout tells the launcher that wt.exe was started; raising
# the window afterwards is best effort.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace GitKhronos -Name TerminalFocus -MemberDefinition @"
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr data);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, System.IntPtr data);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetClassName(System.IntPtr hwnd, System.Text.StringBuilder name, int size);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hwnd, int command);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, System.IntPtr process);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint to, bool enable);
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

// Visible Windows Terminal windows, topmost first.
public static System.Collections.Generic.List<System.IntPtr> Windows() {
  var found = new System.Collections.Generic.List<System.IntPtr>();
  EnumWindows((hwnd, data) => {
    var name = new System.Text.StringBuilder(64);
    GetClassName(hwnd, name, name.Capacity);
    if (name.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS" && IsWindowVisible(hwnd)) found.Add(hwnd);
    return true;
  }, System.IntPtr.Zero);
  return found;
}

// Sharing the input state of the current foreground thread lets this
// process hand the foreground to the terminal window.
public static void Raise(System.IntPtr hwnd) {
  if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
  uint current = GetCurrentThreadId();
  uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), System.IntPtr.Zero);
  bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
  try {
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
  } finally {
    if (attached) AttachThreadInput(current, foreground, false);
  }
}
"@

$before = [GitKhronos.TerminalFocus]::Windows()
Start-Process -FilePath 'wt.exe' -ArgumentList $terminalArguments
[Console]::Out.WriteLine('started')
[Console]::Out.Flush()

$deadline = (Get-Date).AddSeconds(5)
while ((Get-Date) -lt $deadline) {
  $opened = @([GitKhronos.TerminalFocus]::Windows() | Where-Object { $before -notcontains $_ })
  if ($opened.Count -gt 0) {
    # Give the new window a moment to finish showing before raising it.
    Start-Sleep -Milliseconds 150
    [GitKhronos.TerminalFocus]::Raise($opened[0])
    exit 0
  }
  Start-Sleep -Milliseconds 100
}

# Windows Terminal may be configured to open a tab in an existing window.
$existing = @([GitKhronos.TerminalFocus]::Windows())
if ($existing.Count -gt 0) { [GitKhronos.TerminalFocus]::Raise($existing[0]) }

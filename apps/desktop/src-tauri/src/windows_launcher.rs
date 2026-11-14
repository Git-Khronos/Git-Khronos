//! User-started inspection and repair of the Windows shortcuts that WSLg
//! creates for Git Khronos.
//!
//! Two defects are handled independently:
//!
//! - WSLg's Start Menu shortcut has no application id, so a taskbar pin made
//!   from it may not join the running window's taskbar group. Windows records
//!   the running window's id in an implicit shortcut; that recorded value is
//!   the only identity this module applies. It is never derived or guessed.
//! - Pinning the running window can leave the launcher path split at the first
//!   space (target `X:\Program`, arguments starting `Files\...\wslg.exe`). The
//!   path is rejoined only when the result exists on Windows and agrees with
//!   every working Git Khronos shortcut.
//!
//! Inspection is read-only. Explorer's taskbar registry and caches are
//! never written, pins are never created, and Explorer is never restarted, so
//! whether the taskbar groups as expected cannot be verified from here.
use crate::AppError;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const APP_EXECUTABLE: &str = "git-khronos";
const IDENTITY_PREFIX: &str = "Microsoft.RemoteApp.";
const OUTPUT_MARKER: &str = "GKJSON:";
const BACKUP_FOLDER: &str = r"%LOCALAPPDATA%\Git Khronos\Windows shortcut backups";
const INSPECT_TIMEOUT: Duration = Duration::from_secs(45);
const REPAIR_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WindowsShortcutLocation {
    StartMenu,
    TaskbarPin,
    Implicit,
}

/// Whether the recognized shortcut's launcher target exists or has a known defect.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WindowsShortcutLaunch {
    Works,
    SplitPath,
    LauncherMissing,
    Unreadable,
}

/// How the shortcut's application id compares with the recorded identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WindowsShortcutIdentity {
    Matching,
    Missing,
    Different,
    Unverified,
    Unknown,
}

/// The exact change a reviewed repair makes. Unset fields stay unchanged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowsShortcutRepairPlan {
    pub target: Option<String>,
    pub arguments: Option<String>,
    pub app_identity: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowsShortcut {
    pub location: WindowsShortcutLocation,
    pub path: String,
    pub target: String,
    pub arguments: String,
    pub app_identity: Option<String>,
    pub launch: WindowsShortcutLaunch,
    pub identity: WindowsShortcutIdentity,
    pub fingerprint: String,
    pub repair: Option<WindowsShortcutRepairPlan>,
    /// Why a visible problem has no repair, in user-facing words.
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowsLauncherInspection {
    pub supported: bool,
    pub interop_unavailable: bool,
    pub message: Option<String>,
    pub distribution: Option<String>,
    pub app_identity: Option<String>,
    pub identity_source: Option<String>,
    pub conflicting_identities: Vec<String>,
    /// Launcher used by every working Git Khronos shortcut, when they agree.
    pub launcher: Option<String>,
    pub shortcuts: Vec<WindowsShortcut>,
    /// Reasons the shortcut list may be incomplete.
    pub incomplete: Vec<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowsShortcutRepair {
    pub path: String,
    pub plan: WindowsShortcutRepairPlan,
    pub backup_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawShortcut {
    location: WindowsShortcutLocation,
    path: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    arguments: String,
    app_identity: Option<String>,
    #[serde(default)]
    fingerprint: String,
    target_exists: Option<bool>,
    candidate_target: Option<String>,
    candidate_exists: Option<bool>,
    read_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawInventory {
    shortcuts: Vec<RawShortcut>,
    #[serde(default)]
    incomplete: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRepair {
    outcome: String,
    backup_path: Option<String>,
    backup_intact: Option<bool>,
}

fn error(kind: &str, message: impl Into<String>, hint: Option<&str>) -> AppError {
    AppError {
        kind: kind.into(),
        message: message.into(),
        hint: hint.map(Into::into),
    }
}

fn unsupported(message: &str) -> WindowsLauncherInspection {
    WindowsLauncherInspection {
        supported: false,
        interop_unavailable: false,
        message: Some(message.into()),
        distribution: None,
        app_identity: None,
        identity_source: None,
        conflicting_identities: Vec::new(),
        launcher: None,
        shortcuts: Vec::new(),
        incomplete: Vec::new(),
    }
}

/// Splits a Windows command line into words, keeping double-quoted spans together.
fn split_arguments(arguments: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut started = false;
    for character in arguments.chars() {
        match character {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    words.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            c => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(current);
    }
    words
}

/// Whether a shortcut launches Git Khronos in `distribution` through wslg.exe.
/// Returns `Some(true)` for the split-path form left by an unquoted relaunch
/// command (target `...\Program`, arguments starting `Files\...\wslg.exe`).
fn launches_app(target: &str, arguments: &str, distribution: &str) -> Option<bool> {
    let target = target.trim().to_ascii_lowercase();
    let (words, broken) = if target.ends_with("\\wslg.exe") {
        (split_arguments(arguments), false)
    } else if target.ends_with(":\\program") {
        let mut words = split_arguments(arguments);
        let first = words.first()?.to_ascii_lowercase();
        if !first.starts_with("files\\") || !first.ends_with("\\wslg.exe") {
            return None;
        }
        words.remove(0);
        (words, true)
    } else {
        return None;
    };
    let separator = words.iter().position(|word| word == "--")?;
    let options = &words[..separator];
    let selects_distribution = options.windows(2).any(|pair| {
        (pair[0] == "-d" || pair[0] == "--distribution")
            && pair[1].eq_ignore_ascii_case(distribution)
    });
    let program = words.get(separator + 1)?;
    let launches = program.rsplit('/').next() == Some(APP_EXECUTABLE);
    (selects_distribution && launches).then_some(broken)
}

/// Rejoins a launcher path split at its first space. Returns the target and
/// the remaining arguments only for the recognized `X:\Program` +
/// `Files\...\wslg.exe` form; the caller must still confirm the target exists.
fn split_repair(target: &str, arguments: &str) -> Option<(String, String)> {
    let target = target.trim();
    if !target.to_ascii_lowercase().ends_with(":\\program") || target.len() != 10 {
        return None;
    }
    let rest = arguments.trim_start();
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let token = &rest[..end];
    let lower = token.to_ascii_lowercase();
    if token.contains('"') || !lower.starts_with("files\\") || !lower.ends_with("\\wslg.exe") {
        return None;
    }
    Some((
        format!("{target} {token}"),
        rest[end..].trim_start().to_owned(),
    ))
}

fn valid_identity(identity: &str) -> bool {
    identity.strip_prefix(IDENTITY_PREFIX).is_some_and(|hash| {
        (8..=128).contains(&hash.len())
            && hash
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=' | '-' | '_'))
    })
}

struct Recognized {
    raw: RawShortcut,
    launch: WindowsShortcutLaunch,
}

fn recognize(shortcut: RawShortcut, distribution: &str) -> Option<Recognized> {
    if shortcut.read_error.is_some() {
        let mentions_app = shortcut.path.to_ascii_lowercase().contains("khronos");
        return mentions_app.then_some(Recognized {
            raw: shortcut,
            launch: WindowsShortcutLaunch::Unreadable,
        });
    }
    let split = launches_app(&shortcut.target, &shortcut.arguments, distribution)?;
    let launch = if split {
        WindowsShortcutLaunch::SplitPath
    } else if shortcut.target_exists == Some(true) {
        WindowsShortcutLaunch::Works
    } else {
        WindowsShortcutLaunch::LauncherMissing
    };
    Some(Recognized {
        raw: shortcut,
        launch,
    })
}

/// Returns the rejoined target and arguments for a split launcher, or the
/// reason it cannot be established without guessing.
fn established_split(
    shortcut: &RawShortcut,
    known_launchers: &[String],
) -> Result<(String, String), String> {
    let Some((target, arguments)) = split_repair(&shortcut.target, &shortcut.arguments) else {
        return Err("The launcher path could not be rejoined unambiguously.".into());
    };
    if shortcut.candidate_target.as_deref() != Some(target.as_str())
        || shortcut.candidate_exists != Some(true)
    {
        return Err(format!(
            "{target} was not found on Windows, so the launcher path cannot be rejoined safely."
        ));
    }
    if known_launchers
        .iter()
        .any(|known| !known.eq_ignore_ascii_case(&target))
    {
        return Err(format!(
            "Other Git Khronos shortcuts start a different launcher ({}), so the correct path is ambiguous.",
            known_launchers.join(", ")
        ));
    }
    Ok((target, arguments))
}

fn classify(raw: Vec<RawShortcut>, distribution: &str) -> WindowsLauncherInspection {
    let mut unread = 0;
    let relevant: Vec<Recognized> = raw
        .into_iter()
        .filter_map(|shortcut| {
            let failed = shortcut.read_error.is_some();
            let recognized = recognize(shortcut, distribution);
            unread += usize::from(failed && recognized.is_none());
            recognized
        })
        .collect();

    let mut identities: Vec<(String, String)> = Vec::new();
    for item in &relevant {
        if item.raw.location == WindowsShortcutLocation::Implicit
            && matches!(
                item.launch,
                WindowsShortcutLaunch::Works
                    | WindowsShortcutLaunch::SplitPath
                    | WindowsShortcutLaunch::LauncherMissing
            )
            && let Some(identity) = item
                .raw
                .app_identity
                .as_deref()
                .filter(|id| valid_identity(id))
            && !identities.iter().any(|(known, _)| known == identity)
        {
            identities.push((identity.to_owned(), item.raw.path.clone()));
        }
    }
    let (app_identity, identity_source, conflicting_identities) = match identities.len() {
        1 => {
            let (identity, source) = identities.remove(0);
            (Some(identity), Some(source), Vec::new())
        }
        _ => (
            None,
            None,
            identities
                .into_iter()
                .map(|(identity, _)| identity)
                .collect(),
        ),
    };

    let mut known_launchers: Vec<String> = Vec::new();
    for item in &relevant {
        let target = item.raw.target.trim();
        if item.launch == WindowsShortcutLaunch::Works
            && !known_launchers
                .iter()
                .any(|known| known.eq_ignore_ascii_case(target))
        {
            known_launchers.push(target.to_owned());
        }
    }
    let launcher = (known_launchers.len() == 1).then(|| known_launchers[0].clone());

    let shortcuts = relevant
        .into_iter()
        .map(|Recognized { raw: shortcut, launch }| {
            let current = shortcut.app_identity.clone().filter(|id| !id.is_empty());
            let identity = match (launch, current.as_deref(), app_identity.as_deref()) {
                (WindowsShortcutLaunch::Unreadable, _, _) => WindowsShortcutIdentity::Unknown,
                (_, None, _) => WindowsShortcutIdentity::Missing,
                (_, Some(_), None) => WindowsShortcutIdentity::Unverified,
                (_, Some(id), Some(expected)) if id == expected => WindowsShortcutIdentity::Matching,
                _ => WindowsShortcutIdentity::Different,
            };
            let mut notes: Vec<String> = Vec::new();
            let fix = match launch {
                WindowsShortcutLaunch::SplitPath if shortcut.location != WindowsShortcutLocation::StartMenu => {
                    match established_split(&shortcut, &known_launchers) {
                        Ok(fix) => Some(fix),
                        Err(reason) => {
                            notes.push(reason);
                            None
                        }
                    }
                }
                WindowsShortcutLaunch::LauncherMissing => {
                    notes.push("The launcher this shortcut starts was not found on Windows, so it is left unchanged.".into());
                    None
                }
                WindowsShortcutLaunch::Unreadable => {
                    notes.push("Windows could not read this shortcut, so it is left unchanged.".into());
                    None
                }
                _ => None,
            };
            let launches = launch == WindowsShortcutLaunch::Works || fix.is_some();
            let identity_fix = shortcut.location == WindowsShortcutLocation::TaskbarPin
                && matches!(identity, WindowsShortcutIdentity::Missing | WindowsShortcutIdentity::Different);
            let set_identity = identity_fix && launches && app_identity.is_some();
            if identity_fix && app_identity.is_none() {
                notes.push("No single recorded identity is available, so the application id cannot be set.".into());
            }
            if shortcut.location == WindowsShortcutLocation::StartMenu
                && (identity != WindowsShortcutIdentity::Matching || launch != WindowsShortcutLaunch::Works)
            {
                notes.push("WSL recreates this shortcut, so Git Khronos does not change it. Pins made from it can be repaired separately.".into());
            }
            let repair = (fix.is_some() || set_identity).then(|| {
                let (target, arguments) = fix.map_or((None, None), |(target, arguments)| (Some(target), Some(arguments)));
                WindowsShortcutRepairPlan {
                    target,
                    arguments,
                    app_identity: if set_identity { app_identity.clone() } else { None },
                }
            });
            WindowsShortcut {
                location: shortcut.location,
                path: shortcut.path,
                target: shortcut.target,
                arguments: shortcut.arguments,
                app_identity: current,
                launch,
                identity,
                fingerprint: shortcut.fingerprint,
                repair,
                note: (!notes.is_empty()).then(|| notes.join(" ")),
            }
        })
        .collect();

    WindowsLauncherInspection {
        supported: true,
        interop_unavailable: false,
        message: None,
        distribution: Some(distribution.to_owned()),
        app_identity,
        identity_source,
        conflicting_identities,
        launcher,
        shortcuts,
        incomplete: match unread {
            0 => Vec::new(),
            1 => vec!["1 shortcut file could not be read, so it is unknown whether it belongs to Git Khronos.".into()],
            count => vec![format!("{count} shortcut files could not be read, so it is unknown whether they belong to Git Khronos.")],
        },
    }
}

/// Confirms that a reviewed repair still applies, unchanged, to the freshly
/// inspected state.
fn approve_repair<'a>(
    inspection: &'a WindowsLauncherInspection,
    path: &str,
    fingerprint: &str,
    plan: &WindowsShortcutRepairPlan,
) -> Result<&'a WindowsShortcut, AppError> {
    let changed = || {
        error(
            "windowsShortcutChanged",
            "The shortcut or the information used to repair it changed after it was reviewed. Nothing was modified.",
            Some("Check the shortcuts again and review the new result."),
        )
    };
    let shortcut = inspection
        .shortcuts
        .iter()
        .find(|shortcut| shortcut.path == path)
        .ok_or_else(changed)?;
    let Some(current) = shortcut.repair.as_ref() else {
        return Err(error(
            "windowsShortcutNotRepairable",
            "This shortcut has no repair available. Nothing was modified.",
            None,
        ));
    };
    if current != plan
        || fingerprint.len() != 64
        || !shortcut.fingerprint.eq_ignore_ascii_case(fingerprint)
    {
        return Err(changed());
    }
    if plan
        .app_identity
        .as_deref()
        .is_some_and(|id| !valid_identity(id) || inspection.app_identity.as_deref() != Some(id))
    {
        return Err(changed());
    }
    Ok(shortcut)
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = chunk.iter().enumerate().fold(0u32, |value, (index, byte)| {
            value | u32::from(*byte) << (16 - 8 * index)
        });
        for index in 0..4 {
            if index <= chunk.len() {
                output.push(char::from(
                    BASE64[(value >> (18 - 6 * index)) as usize & 63],
                ));
            } else {
                output.push('=');
            }
        }
    }
    output
}

fn encoded_command(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64(&bytes)
}

/// Values reach PowerShell only as base64 literals, never as script text.
fn script_value(value: &str) -> String {
    base64(value.as_bytes())
}

const SCRIPT_PRELUDE: &str = r#"
$ErrorActionPreference = 'Stop'
$backup = $null
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Emit($value) { [Console]::Out.WriteLine('GKJSON:' + (ConvertTo-Json -Compress -Depth 4 $value)) }
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class GitKhronosShortcut {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct Key { public Guid Format; public uint Id; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] struct Value { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Data; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { void GetCount(out uint count); void GetAt(uint index, out Key key); void GetValue(ref Key key, out Value value); void SetValue(ref Key key, ref Value value); void Commit(); }
  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPersistFile { void GetClassID(out Guid id); [PreserveSig] int IsDirty(); void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode); void Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember); void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file); void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file); }
  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellLinkW { void GetPath(IntPtr a, int b, IntPtr c, uint d); void GetIDList(out IntPtr a); void SetIDList(IntPtr a); void GetDescription(IntPtr a, int b); void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string a); void GetWorkingDirectory(IntPtr a, int b); void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string a); void GetArguments(IntPtr a, int b); void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string a); void GetHotkey(out short a); void SetHotkey(short a); void GetShowCmd(out int a); void SetShowCmd(int a); void GetIconLocation(IntPtr a, int b, out int c); void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string a, int b); void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved); void Resolve(IntPtr window, uint flags); void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path); }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
  static Key AppId = new Key { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
  static object Open(string path, uint mode) {
    object link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
    ((IPersistFile)link).Load(path, mode); return link;
  }
  public static string ReadId(string path) {
    object link = Open(path, 0);
    try { Value value; ((IPropertyStore)link).GetValue(ref AppId, out value);
      try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Data) : null; } finally { PropVariantClear(ref value); } }
    finally { Marshal.ReleaseComObject(link); }
  }
  // Edits a private working copy and saves the result to a separate staging
  // file; the original shortcut is never opened here. PowerShell passes $null
  // strings as "", so an empty value means "leave unchanged".
  public static void Stage(string copy, string destination, string target, string arguments, string id) {
    object link = Open(copy, 2);
    try {
      if (!string.IsNullOrEmpty(target)) {
        // SetPath can replace the working directory, so it is put back.
        IShellLinkW shell = (IShellLinkW)link; IntPtr buffer = Marshal.AllocCoTaskMem(2 * 1024);
        try { shell.GetWorkingDirectory(buffer, 1024); string folder = Marshal.PtrToStringUni(buffer); shell.SetPath(target); shell.SetArguments(arguments); shell.SetWorkingDirectory(folder); }
        finally { Marshal.FreeCoTaskMem(buffer); }
      }
      if (!string.IsNullOrEmpty(id)) {
        Value value = new Value { Type = 31, Data = Marshal.StringToCoTaskMemUni(id) };
        try { IPropertyStore store = (IPropertyStore)link; store.SetValue(ref AppId, ref value); store.Commit(); }
        finally { PropVariantClear(ref value); }
      }
      ((IPersistFile)link).Save(destination, false);
    } finally { Marshal.ReleaseComObject(link); }
  }
}
'@
$shell = New-Object -ComObject WScript.Shell
function Text($encoded) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) }
function Hash($file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
"#;

const INSPECT_SCRIPT: &str = r#"
$pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned'
$roots = @(
  @{ location = 'startMenu'; path = [Environment]::GetFolderPath('Programs') },
  @{ location = 'taskbarPin'; path = Join-Path $pinned 'TaskBar' },
  @{ location = 'implicit'; path = Join-Path $pinned 'ImplicitAppShortcuts' })
$incomplete = New-Object 'System.Collections.Generic.List[string]'
$items = @(foreach ($root in $roots) {
  if (-not $root.path -or -not (Test-Path -LiteralPath $root.path)) { continue }
  $walkErrors = $null
  $files = @(Get-ChildItem -LiteralPath $root.path -Recurse -Filter '*.lnk' -File -ErrorAction SilentlyContinue -ErrorVariable walkErrors)
  foreach ($problem in @($walkErrors)) { if ($problem) { $incomplete.Add([string]$problem.Exception.Message) } }
  foreach ($file in $files) {
    try {
      $link = $shell.CreateShortcut($file.FullName)
      $target = [string]$link.TargetPath
      $arguments = [string]$link.Arguments
      if ($target -notmatch '(?i)(\\wslg\.exe$|^[a-z]:\\program$)') { continue }
      $candidate = $null; $candidateExists = $null
      if ($target.Trim() -match '(?i)^[a-z]:\\program$') {
        $candidate = $target.Trim() + ' ' + ($arguments.TrimStart() -split '\s', 2)[0]
        $candidateExists = Test-Path -LiteralPath $candidate -PathType Leaf
      }
      [ordered]@{ location = $root.location; path = $file.FullName; target = $target; arguments = $arguments
        appIdentity = [GitKhronosShortcut]::ReadId($file.FullName); fingerprint = Hash $file.FullName
        targetExists = (Test-Path -LiteralPath $target -PathType Leaf); candidateTarget = $candidate; candidateExists = $candidateExists; readError = $null }
    } catch {
      [ordered]@{ location = $root.location; path = $file.FullName; target = ''; arguments = ''; appIdentity = $null; fingerprint = ''; readError = $_.Exception.Message }
    }
  }
})
Emit @{ shortcuts = $items; incomplete = @($incomplete) }
"#;

/// Repairs one reviewed shortcut. Every write happens after a verified backup
/// exists, and every outcome after that point reports the backup path.
const REPAIR_SCRIPT: &str = r#"
$path = Text '__PATH__'; $fingerprint = Text '__FINGERPRINT__'; $run = Text '__RUN__'
$id = $(if ('__SET_ID__' -eq '1') { Text '__IDENTITY__' } else { $null })
$newTarget = $(if ('__SET_TARGET__' -eq '1') { Text '__TARGET__' } else { $null })
$newArguments = $(if ('__SET_TARGET__' -eq '1') { Text '__ARGUMENTS__' } else { $null })
function Fields($file) { $link = $shell.CreateShortcut($file); @([string]$link.TargetPath, [string]$link.Arguments, [string]$link.WorkingDirectory, [string]$link.IconLocation, [string]$link.Description, [string]$link.WindowStyle, [string]$link.Hotkey) }
function Same($left, $right) { ($left -join "`n") -ceq ($right -join "`n") }
function BytesHash($bytes) { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString('X2') }) }
# Every file this script creates is created exclusively, and cleanup removes
# only those files and then their folders when empty, never recursively.
function Fresh($file, $bytes) { $out = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None); try { $out.Write($bytes, 0, $bytes.Length); $out.Flush($true) } finally { $out.Dispose() } }
function Drop($file) { if ($file) { try { [IO.File]::Delete($file) } catch { } } }
function DropDir($folder) { try { [IO.Directory]::Delete($folder, $false) } catch { } }
$original = [IO.File]::ReadAllBytes($path)
if ((BytesHash $original) -ne $fingerprint) { Emit @{ outcome = 'changed' }; exit 0 }
$expected = Fields $path
if ($newTarget -ne $null) { $expected[0] = $newTarget; $expected[1] = $newArguments }
$expectedId = $(if ($id -ne $null) { $id } else { [GitKhronosShortcut]::ReadId($path) })
# The run folder is new and private to this attempt. The backup and the
# staging files live in separate subfolders, so no shortcut name can collide
# with a staging file.
$root = Join-Path $env:LOCALAPPDATA 'Git Khronos\Windows shortcut backups'
$directory = Join-Path $root $run
$owner = Join-Path $directory 'attempt.lock'
$saved = Join-Path $directory 'original'
$staging = Join-Path $directory 'staging'
$owned = $false
try {
  [void][IO.Directory]::CreateDirectory($root)
  if (Test-Path -LiteralPath $directory) { throw 'The backup folder already exists.' }
  New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
  Fresh $owner ([byte[]]@()); $owned = $true
  if (@(Get-ChildItem -LiteralPath $directory -Force).Count -ne 1) { throw 'The backup folder is not empty.' }
  New-Item -ItemType Directory -Path $saved -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $staging -ErrorAction Stop | Out-Null
  $candidate = Join-Path $saved ([IO.Path]::GetFileName($path))
  Fresh $candidate $original; $file = $candidate
  if ((Hash $file) -ne $fingerprint) { Drop $file; throw 'The backup does not match the shortcut.' }
  $backup = $file
} catch {
  if ($owned) { Drop $file; DropDir $saved; DropDir $staging; Drop $owner; DropDir $directory }
  Emit @{ outcome = 'backupUnavailable' }; exit 0
}
function Discard() { Drop $backup; DropDir $saved; DropDir $staging; Drop $owner; DropDir $directory; $script:backup = $null }
$work = Join-Path $staging 'source.lnk'
$staged = Join-Path $staging 'result.lnk'
Fresh $work $original
[GitKhronosShortcut]::Stage($work, $staged, $newTarget, $newArguments, $id)
$stagedOk = (Same (Fields $staged) $expected) -and ([GitKhronosShortcut]::ReadId($staged) -ceq $expectedId)
$replacement = [IO.File]::ReadAllBytes($staged)
Drop $work; Drop $staged; DropDir $staging
if (-not $stagedOk) { Discard; Emit @{ outcome = 'stagingMismatch' }; exit 0 }
# Rewrite the existing file in place so Explorer keeps referring to the same file.
$stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$outcome = 'changed'
try {
  $current = New-Object byte[] $stream.Length
  $read = 0; while ($read -lt $current.Length) { $count = $stream.Read($current, $read, $current.Length - $read); if ($count -le 0) { break }; $read += $count }
  if ($read -eq $current.Length -and (BytesHash $current) -eq $fingerprint) {
    try { $stream.Position = 0; $stream.SetLength(0); $stream.Write($replacement, 0, $replacement.Length); $stream.Flush($true); $outcome = 'written' }
    catch { $outcome = 'writeFailed'; try { $stream.Position = 0; $stream.SetLength(0); $stream.Write($original, 0, $original.Length); $stream.Flush($true) } catch { } }
  }
} finally { $stream.Dispose() }
if ($outcome -eq 'changed') { Discard; Emit @{ outcome = 'changed' }; exit 0 }
Drop $owner
$intact = $false; try { $intact = (Hash $backup) -eq $fingerprint } catch { }
if ($outcome -eq 'writeFailed') {
  $restored = $false; try { $restored = (Hash $path) -eq $fingerprint } catch { }
  Emit @{ outcome = $(if ($restored) { 'restored' } else { 'restoreUnverified' }); backupPath = $backup; backupIntact = $intact }; exit 0 }
$verified = $false
try { $verified = (Same (Fields $path) $expected) -and ([GitKhronosShortcut]::ReadId($path) -ceq $expectedId) } catch { }
Emit @{ outcome = $(if ($verified) { 'applied' } else { 'unverified' }); backupPath = $backup; backupIntact = $intact }
"#;

fn interop_unavailable() -> AppError {
    error(
        "windowsInteropUnavailable",
        "Windows programs cannot be started from this WSL distribution, so the Windows shortcuts could not be checked.",
        Some(
            "Enable WSL interoperability (the [interop] settings in /etc/wsl.conf), restart WSL, and try again.",
        ),
    )
}

fn find_powershell() -> Option<PathBuf> {
    let suffix = Path::new("Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
    let from_path = std::env::var_os("PATH").into_iter().flat_map(|paths| {
        std::env::split_paths(&paths)
            .map(|directory| directory.join("powershell.exe"))
            .collect::<Vec<_>>()
    });
    let mounted = std::fs::read_dir("/mnt")
        .into_iter()
        .flatten()
        .flatten()
        .map(move |entry| entry.path().join(suffix));
    from_path
        .chain(mounted)
        .find(|candidate| candidate.is_file())
}

pub(crate) fn interop_available() -> bool {
    crate::display_environment::running_under_wsl()
        && interop_registered(
            std::fs::read_to_string("/proc/sys/fs/binfmt_misc/WSLInterop")
                .ok()
                .as_deref(),
        )
        && find_powershell().is_some()
}

fn interop_registered(registration: Option<&str>) -> bool {
    registration.is_some_and(|text| text.lines().next() == Some("enabled"))
}

fn run_powershell(script: &str, timeout: Duration) -> Result<String, AppError> {
    let executable = find_powershell().ok_or_else(interop_unavailable)?;
    let mut command = Command::new(&executable);
    command
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"])
        .arg(encoded_command(&format!(
            "try {{\n{SCRIPT_PRELUDE}{script}\n}} catch {{ $kept = $(if ($backup -and (Test-Path -LiteralPath $backup)) {{ $backup }} else {{ $null }}); $faithful = $false; if ($kept -and $fingerprint) {{ try {{ $faithful = (Hash $kept) -eq $fingerprint }} catch {{ }} }}; Emit @{{ scriptError = [string]$_.Exception.Message; backupPath = $kept; backupIntact = $faithful }} }}"
        )))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
    }
    let mut child = command.spawn().map_err(|_| interop_unavailable())?;
    let mut stdout = child.stdout.take().ok_or_else(interop_unavailable)?;
    let mut stderr = child.stderr.take().ok_or_else(interop_unavailable)?;
    let output = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error(
                    "windowsShortcutTimeout",
                    format!(
                        "Windows did not answer in time. If a repair was in progress, the shortcut may have changed; any original saved before a change is in {BACKUP_FOLDER}."
                    ),
                    Some("Check the shortcuts again before retrying."),
                ));
            }
        }
    }
    let output = output.join().unwrap_or_default();
    let errors = errors.join().unwrap_or_default();
    if let Some(line) = output
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(OUTPUT_MARKER))
    {
        return script_result(line);
    }
    let detail: String = errors.trim().chars().take(400).collect();
    Err(error(
        "windowsShortcutScriptFailed",
        if detail.is_empty() {
            "Windows PowerShell did not return a result.".to_owned()
        } else {
            format!("Windows PowerShell reported an error: {detail}")
        },
        None,
    ))
}

fn script_result(line: &str) -> Result<String, AppError> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return Ok(line.to_owned());
    };
    let Some(detail) = value.get("scriptError").and_then(|text| text.as_str()) else {
        return Ok(line.to_owned());
    };
    let detail: String = detail.chars().take(400).collect();
    let backup = value
        .get("backupPath")
        .and_then(|text| text.as_str())
        .filter(|text| !text.is_empty());
    let intact = value
        .get("backupIntact")
        .and_then(serde_json::Value::as_bool)
        == Some(true);
    let message = match backup {
        Some(backup) if intact => format!(
            "Windows reported an error while handling the shortcuts: {detail} A copy of the original shortcut, checked against the reviewed version, is at {backup}."
        ),
        Some(backup) => format!(
            "Windows reported an error while handling the shortcuts: {detail} A backup was started at {backup}, but it could not be confirmed to match the original shortcut."
        ),
        None => format!("Windows reported an error while handling the shortcuts: {detail}"),
    };
    Err(error(
        "windowsShortcutScriptFailed",
        message,
        backup.map(|_| {
            if intact {
                "Check the shortcuts again. To undo a change, copy the backup over the shortcut."
            } else {
                "Check the shortcuts again before relying on the backup."
            }
        }),
    ))
}

fn current_distribution() -> Option<String> {
    std::env::var("WSL_DISTRO_NAME")
        .ok()
        .filter(|name| !name.trim().is_empty())
}

fn inspect() -> Result<WindowsLauncherInspection, AppError> {
    if !crate::display_environment::running_under_wsl() {
        return Ok(unsupported(
            "Windows shortcut checks are available only when Git Khronos runs under WSL.",
        ));
    }
    let Some(distribution) = current_distribution() else {
        return Ok(unsupported(
            "The WSL distribution name is unavailable, so its Windows shortcuts cannot be identified.",
        ));
    };
    let output = match run_powershell(INSPECT_SCRIPT, INSPECT_TIMEOUT) {
        Ok(output) => output,
        Err(problem) if problem.kind == "windowsInteropUnavailable" => {
            let mut result = unsupported(&problem.message);
            result.interop_unavailable = true;
            result.distribution = Some(distribution);
            return Ok(result);
        }
        Err(problem) => return Err(problem),
    };
    let inventory: RawInventory = serde_json::from_str(&output).map_err(|_| {
        error(
            "windowsShortcutScriptFailed",
            "Windows returned shortcut details in an unexpected form.",
            None,
        )
    })?;
    let mut result = classify(inventory.shortcuts, &distribution);
    result
        .incomplete
        .extend(enumeration_problems(inventory.incomplete));
    Ok(result)
}

fn enumeration_problems(problems: Vec<String>) -> Vec<String> {
    const SHOWN: usize = 5;
    let total = problems.len();
    let mut messages: Vec<String> = problems
        .into_iter()
        .take(SHOWN)
        .map(|problem| {
            format!(
                "A folder could not be fully listed: {}",
                problem.chars().take(300).collect::<String>()
            )
        })
        .collect();
    if total > SHOWN {
        messages.push(format!(
            "{} more folder errors were reported.",
            total - SHOWN
        ));
    }
    messages
}

/// A backup folder name that is unique per attempt, even for concurrent ones.
fn run_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    format!(
        "{millis}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn repair_script(
    path: &str,
    fingerprint: &str,
    plan: &WindowsShortcutRepairPlan,
    run: &str,
) -> String {
    let flag = |set: bool| if set { "1" } else { "0" };
    REPAIR_SCRIPT
        .replace("__PATH__", &script_value(path))
        .replace(
            "__FINGERPRINT__",
            &script_value(&fingerprint.to_ascii_uppercase()),
        )
        .replace("__RUN__", &script_value(run))
        .replace("__SET_ID__", flag(plan.app_identity.is_some()))
        .replace(
            "__IDENTITY__",
            &script_value(plan.app_identity.as_deref().unwrap_or_default()),
        )
        .replace("__SET_TARGET__", flag(plan.target.is_some()))
        .replace(
            "__TARGET__",
            &script_value(plan.target.as_deref().unwrap_or_default()),
        )
        .replace(
            "__ARGUMENTS__",
            &script_value(plan.arguments.as_deref().unwrap_or_default()),
        )
}

fn repair(
    path: String,
    fingerprint: String,
    plan: WindowsShortcutRepairPlan,
) -> Result<WindowsShortcutRepair, AppError> {
    let inspection = inspect()?;
    if !inspection.supported {
        return Err(error(
            "windowsShortcutUnavailable",
            inspection
                .message
                .unwrap_or_else(|| "Windows shortcuts are unavailable.".into()),
            None,
        ));
    }
    approve_repair(&inspection, &path, &fingerprint, &plan)?;
    let output = run_powershell(
        &repair_script(&path, &fingerprint, &plan, &run_id()),
        REPAIR_TIMEOUT,
    )?;
    let result: RawRepair = serde_json::from_str(&output).map_err(|_| {
        error(
            "windowsShortcutScriptFailed",
            format!("Windows returned the repair result in an unexpected form. If the shortcut was changed, a backup is in {BACKUP_FOLDER}."),
            None,
        )
    })?;
    repair_outcome(result, path, plan)
}

fn repair_outcome(
    result: RawRepair,
    path: String,
    plan: WindowsShortcutRepairPlan,
) -> Result<WindowsShortcutRepair, AppError> {
    let backup = result.backup_path.filter(|backup| !backup.is_empty());
    let backup_text = backup.clone().unwrap_or_else(|| BACKUP_FOLDER.to_owned());
    let wrote = matches!(
        result.outcome.as_str(),
        "applied" | "unverified" | "restored" | "restoreUnverified"
    );
    if wrote && result.backup_intact != Some(true) {
        let change = if result.outcome == "applied" {
            "The shortcut was updated"
        } else {
            "The shortcut may have changed"
        };
        return Err(error(
            "windowsShortcutBackupDamaged",
            format!(
                "{change}, but the backup at {backup_text} no longer matches the original shortcut, so it cannot be used to undo the change."
            ),
            Some(
                "Check the shortcuts again. If the shortcut does not work, unpin it and pin Git Khronos again from the Start Menu.",
            ),
        ));
    }
    match (result.outcome.as_str(), backup) {
        ("applied", Some(backup_path)) => Ok(WindowsShortcutRepair {
            path,
            plan,
            backup_path,
        }),
        ("changed", _) => Err(error(
            "windowsShortcutChanged",
            "The shortcut changed after it was reviewed. Nothing was modified.",
            Some("Check the shortcuts again and review the new result."),
        )),
        ("stagingMismatch", _) => Err(error(
            "windowsShortcutRepairFailed",
            "Windows could not prepare a repaired copy that keeps the shortcut's working directory, icon, description, window style and hotkey. Nothing was modified.",
            None,
        )),
        ("backupUnavailable", _) => Err(error(
            "windowsShortcutRepairFailed",
            format!(
                "A new backup of the shortcut could not be saved in {BACKUP_FOLDER}, so nothing was modified."
            ),
            Some("Check that the folder is writable, then try again."),
        )),
        ("restored", _) => Err(error(
            "windowsShortcutRepairFailed",
            format!(
                "The shortcut could not be rewritten. Its original contents were written back and confirmed. A backup is at {backup_text}."
            ),
            None,
        )),
        ("restoreUnverified", _) => Err(error(
            "windowsShortcutRestoreUnverified",
            format!(
                "The shortcut could not be rewritten, and restoring its original contents could not be confirmed. The original is saved at {backup_text}."
            ),
            Some(
                "Copy the backup over the shortcut, or unpin it and pin Git Khronos again from the Start Menu.",
            ),
        )),
        _ => Err(error(
            "windowsShortcutUnverified",
            format!(
                "The shortcut was rewritten, but the result could not be confirmed. The original is saved at {backup_text}."
            ),
            Some("Check the shortcuts again. To undo, copy the backup over the shortcut."),
        )),
    }
}

fn main_window(window: &tauri::WebviewWindow) -> Result<(), AppError> {
    if window.label() == "main" {
        return Ok(());
    }
    Err(error(
        "windowsShortcutUnavailable",
        "Windows shortcut checks are available only in the main window.",
        None,
    ))
}

fn blocking_failure() -> AppError {
    error(
        "windowsShortcutScriptFailed",
        "The Windows shortcut request stopped unexpectedly.",
        None,
    )
}

/// Reads the Git Khronos shortcuts WSLg created on Windows. Changes nothing.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_windows_launcher(
    window: tauri::WebviewWindow,
) -> Result<WindowsLauncherInspection, AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(inspect)
        .await
        .map_err(|_| blocking_failure())?
}

/// Applies one reviewed repair plan to one shortcut.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn repair_windows_shortcut(
    path: String,
    fingerprint: String,
    plan: WindowsShortcutRepairPlan,
    window: tauri::WebviewWindow,
) -> Result<WindowsShortcutRepair, AppError> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || repair(path, fingerprint, plan))
        .await
        .map_err(|_| blocking_failure())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use WindowsShortcutIdentity as Identity;
    use WindowsShortcutLaunch as Launch;
    use WindowsShortcutLocation as Location;

    const ID: &str = "Microsoft.RemoteApp.4YkiF7MYQAEPsqkDo48gJLW2pppNwdOIrYgskMhJN0Q=";
    const OTHER_ID: &str = "Microsoft.RemoteApp.ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ=";
    const WSLG: &str = r"C:\Program Files\WSL\wslg.exe";
    const ARGS: &str = r#"-d DEV --cd "~" -- git-khronos "#;
    const SPLIT_ARGS: &str = r#"Files\WSL\wslg.exe -d DEV --cd "~" -- git-khronos"#;
    const PIN: &str = r"T\Git Khronos (DEV).lnk";
    const IMPLICIT: &str = r"I\a\Git Khronos (DEV).lnk";

    fn raw(
        location: Location,
        path: &str,
        target: &str,
        arguments: &str,
        id: Option<&str>,
    ) -> RawShortcut {
        RawShortcut {
            location,
            path: path.into(),
            target: target.into(),
            arguments: arguments.into(),
            app_identity: id.map(Into::into),
            fingerprint: "AB".repeat(32),
            target_exists: Some(target.ends_with("wslg.exe")),
            candidate_target: None,
            candidate_exists: None,
            read_error: None,
        }
    }

    fn split(location: Location, path: &str, id: Option<&str>, exists: bool) -> RawShortcut {
        let mut shortcut = raw(location, path, r"C:\Program", SPLIT_ARGS, id);
        shortcut.target_exists = Some(false);
        shortcut.candidate_target = Some(WSLG.into());
        shortcut.candidate_exists = Some(exists);
        shortcut
    }

    fn implicit(id: Option<&str>) -> RawShortcut {
        raw(Location::Implicit, IMPLICIT, WSLG, ARGS.trim(), id)
    }

    fn pin(id: Option<&str>) -> RawShortcut {
        raw(Location::TaskbarPin, PIN, WSLG, ARGS, id)
    }

    fn start() -> RawShortcut {
        raw(
            Location::StartMenu,
            r"S\Git Khronos (DEV).lnk",
            WSLG,
            ARGS,
            None,
        )
    }

    fn find<'a>(inspection: &'a WindowsLauncherInspection, path: &str) -> &'a WindowsShortcut {
        inspection
            .shortcuts
            .iter()
            .find(|shortcut| shortcut.path == path)
            .unwrap()
    }

    fn plan(target: bool, id: Option<&str>) -> WindowsShortcutRepairPlan {
        WindowsShortcutRepairPlan {
            target: target.then(|| WSLG.into()),
            arguments: target.then(|| r#"-d DEV --cd "~" -- git-khronos"#.into()),
            app_identity: id.map(Into::into),
        }
    }

    #[test]
    fn matches_only_this_app_in_this_distribution() {
        assert_eq!(launches_app(WSLG, ARGS, "DEV"), Some(false));
        assert_eq!(launches_app(WSLG, ARGS, "dev"), Some(false));
        assert_eq!(
            launches_app(WSLG, r#"-d DEV -- /usr/bin/git-khronos"#, "DEV"),
            Some(false)
        );
        assert_eq!(launches_app(WSLG, ARGS, "Ubuntu"), None);
        assert_eq!(
            launches_app(WSLG, r#"-d DEV --cd "~" -- alacritty"#, "DEV"),
            None
        );
        assert_eq!(
            launches_app(WSLG, r#"-d DEV --cd "~" -- git-khronos-other"#, "DEV"),
            None
        );
        assert_eq!(launches_app(r"C:\Windows\notepad.exe", ARGS, "DEV"), None);
        assert_eq!(launches_app(WSLG, "-d DEV git-khronos", "DEV"), None);
    }

    #[test]
    fn interop_registration_must_be_enabled() {
        assert!(interop_registered(Some("enabled\ninterpreter /init\n")));
        assert!(!interop_registered(Some("disabled\n")));
        assert!(!interop_registered(None));
    }

    #[test]
    fn recognizes_and_rejoins_only_the_split_launcher_form() {
        assert_eq!(launches_app(r"C:\Program", SPLIT_ARGS, "DEV"), Some(true));
        assert_eq!(
            launches_app(
                r"C:\Program",
                r"Files\Other\tool.exe -d DEV -- git-khronos",
                "DEV"
            ),
            None
        );
        assert_eq!(
            split_repair(r"C:\Program", SPLIT_ARGS),
            Some((
                WSLG.to_owned(),
                r#"-d DEV --cd "~" -- git-khronos"#.to_owned()
            ))
        );
        assert_eq!(
            split_repair(
                r"D:\Program ",
                "  Files\\WSL\\wslg.exe  -d X -- git-khronos"
            ),
            Some((
                r"D:\Program Files\WSL\wslg.exe".to_owned(),
                "-d X -- git-khronos".to_owned()
            ))
        );
        assert_eq!(
            split_repair(
                r"C:\Program",
                r"Files (x86)\WSL\wslg.exe -d DEV -- git-khronos"
            ),
            None
        );
        assert_eq!(
            split_repair(r#"C:\Program"#, r#""Files\WSL\wslg.exe" -d DEV"#),
            None
        );
        assert_eq!(split_repair(r"C:\Tools\Program", SPLIT_ARGS), None);
        assert_eq!(split_repair(WSLG, ARGS), None);
    }

    #[test]
    fn splits_quoted_arguments() {
        assert_eq!(
            split_arguments(r#"-d "My Distro" --cd "~" -- app"#),
            ["-d", "My Distro", "--cd", "~", "--", "app"]
        );
        assert_eq!(
            launches_app(WSLG, r#"-d "My Distro" -- git-khronos"#, "My Distro"),
            Some(false)
        );
    }

    #[test]
    fn validates_recorded_identity_shape() {
        assert!(valid_identity(ID));
        assert!(!valid_identity("Microsoft.RemoteApp."));
        assert!(!valid_identity("Chrome"));
        assert!(!valid_identity("Microsoft.RemoteApp.abc def ghi"));
        assert!(!valid_identity("Microsoft.RemoteApp.abcdefgh'"));
    }

    #[test]
    fn pin_made_from_start_menu_gets_identity_only() {
        let other = raw(
            Location::TaskbarPin,
            r"T\Alacritty (DEV).lnk",
            WSLG,
            r"-d DEV -- alacritty",
            None,
        );
        let result = classify(vec![start(), pin(None), implicit(Some(ID)), other], "DEV");
        assert_eq!(result.app_identity.as_deref(), Some(ID));
        assert_eq!(result.identity_source.as_deref(), Some(IMPLICIT));
        assert_eq!(result.launcher.as_deref(), Some(WSLG));
        assert_eq!(result.shortcuts.len(), 3);
        let start = find(&result, r"S\Git Khronos (DEV).lnk");
        assert_eq!(
            (start.launch, start.identity),
            (Launch::Works, Identity::Missing)
        );
        assert!(start.repair.is_none() && start.note.as_deref().unwrap().contains("WSL recreates"));
        let pinned = find(&result, PIN);
        assert_eq!(
            (pinned.launch, pinned.identity),
            (Launch::Works, Identity::Missing)
        );
        assert_eq!(pinned.repair, Some(plan(false, Some(ID))));
        let record = find(&result, IMPLICIT);
        assert_eq!(
            (record.identity, record.repair.clone()),
            (Identity::Matching, None)
        );
    }

    #[test]
    fn pin_made_from_running_window_gets_target_and_identity() {
        let broken = split(Location::TaskbarPin, PIN, None, true);
        let result = classify(vec![start(), broken, implicit(Some(ID))], "DEV");
        let pinned = find(&result, PIN);
        assert_eq!(pinned.launch, Launch::SplitPath);
        assert_eq!(pinned.repair, Some(plan(true, Some(ID))));
    }

    #[test]
    fn split_launcher_is_repaired_without_identity_when_none_is_recorded() {
        let result = classify(vec![split(Location::TaskbarPin, PIN, None, true)], "DEV");
        assert!(result.app_identity.is_none() && result.launcher.is_none());
        let pinned = find(&result, PIN);
        assert_eq!(pinned.repair, Some(plan(true, None)));
        assert!(
            pinned
                .note
                .as_deref()
                .unwrap()
                .contains("No single recorded identity")
        );
    }

    #[test]
    fn broken_implicit_record_still_supplies_identity_and_gets_target_only_repair() {
        let record = split(Location::Implicit, IMPLICIT, Some(ID), true);
        let result = classify(vec![pin(None), record], "DEV");
        assert_eq!(result.app_identity.as_deref(), Some(ID));
        assert_eq!(find(&result, IMPLICIT).repair, Some(plan(true, None)));
        assert_eq!(find(&result, PIN).repair, Some(plan(false, Some(ID))));
    }

    #[test]
    fn mixed_implicit_records_agree_or_conflict() {
        let mut broken = split(
            Location::Implicit,
            r"I\b\Git Khronos (DEV).lnk",
            Some(ID),
            true,
        );
        broken.fingerprint = "CD".repeat(32);
        let without_id = raw(
            Location::Implicit,
            r"I\c\Git Khronos (DEV).lnk",
            WSLG,
            ARGS,
            None,
        );
        let agree = classify(
            vec![pin(None), implicit(Some(ID)), broken, without_id],
            "DEV",
        );
        assert_eq!(agree.app_identity.as_deref(), Some(ID));
        assert!(agree.conflicting_identities.is_empty());
        assert_eq!(find(&agree, PIN).repair, Some(plan(false, Some(ID))));

        let other = split(
            Location::Implicit,
            r"I\b\Git Khronos (DEV).lnk",
            Some(OTHER_ID),
            true,
        );
        let conflict = classify(vec![pin(None), implicit(Some(ID)), other], "DEV");
        assert!(conflict.app_identity.is_none());
        assert_eq!(conflict.conflicting_identities, [ID, OTHER_ID]);
        assert!(find(&conflict, PIN).repair.is_none());
        assert_eq!(
            find(&conflict, r"I\b\Git Khronos (DEV).lnk").repair,
            Some(plan(true, None))
        );
    }

    #[test]
    fn first_time_setup_without_records_offers_nothing_to_guess() {
        let result = classify(vec![start()], "DEV");
        assert!(result.app_identity.is_none() && result.conflicting_identities.is_empty());
        assert!(
            result
                .shortcuts
                .iter()
                .all(|shortcut| shortcut.repair.is_none())
        );

        let pinned = classify(
            vec![start(), pin(None), implicit(None), implicit(Some("Chrome"))],
            "DEV",
        );
        assert!(pinned.app_identity.is_none());
        let pinned_shortcut = find(&pinned, PIN);
        assert!(pinned_shortcut.repair.is_none());
        assert!(
            pinned_shortcut
                .note
                .as_deref()
                .unwrap()
                .contains("No single recorded identity")
        );

        let unverified = classify(vec![pin(Some("Something.Else"))], "DEV");
        assert_eq!(unverified.shortcuts[0].identity, Identity::Unverified);
        assert!(unverified.shortcuts[0].repair.is_none());
    }

    #[test]
    fn split_launcher_is_not_guessed_when_ambiguous_or_missing() {
        let missing = classify(
            vec![
                split(Location::TaskbarPin, PIN, None, false),
                implicit(Some(ID)),
            ],
            "DEV",
        );
        let pinned = find(&missing, PIN);
        assert!(pinned.repair.is_none());
        assert!(pinned.note.as_deref().unwrap().contains("was not found"));

        let mut elsewhere = start();
        elsewhere.target = r"D:\WSL\wslg.exe".into();
        let ambiguous = classify(
            vec![
                split(Location::TaskbarPin, PIN, None, true),
                elsewhere,
                implicit(Some(ID)),
            ],
            "DEV",
        );
        assert!(ambiguous.launcher.is_none());
        let pinned = find(&ambiguous, PIN);
        assert!(pinned.repair.is_none());
        assert!(pinned.note.as_deref().unwrap().contains("ambiguous"));

        let mut reported = split(Location::TaskbarPin, PIN, None, true);
        reported.candidate_target = Some(r"C:\Program Files\Other\wslg.exe".into());
        assert!(
            classify(vec![reported], "DEV").shortcuts[0]
                .repair
                .is_none()
        );

        let start_split = split(Location::StartMenu, r"S\Git Khronos (DEV).lnk", None, true);
        assert!(
            classify(vec![start_split], "DEV").shortcuts[0]
                .repair
                .is_none()
        );
    }

    #[test]
    fn classifies_matching_different_missing_launcher_and_unreadable() {
        let matching = classify(vec![pin(Some(ID)), implicit(Some(ID))], "DEV");
        assert_eq!(matching.shortcuts[0].identity, Identity::Matching);
        assert!(matching.shortcuts[0].repair.is_none());

        let different = classify(
            vec![
                pin(Some("Microsoft.RemoteApp.OLDOLDOLDOLD")),
                implicit(Some(ID)),
            ],
            "DEV",
        );
        assert_eq!(different.shortcuts[0].identity, Identity::Different);
        assert_eq!(different.shortcuts[0].repair, Some(plan(false, Some(ID))));

        let mut gone = pin(None);
        gone.target_exists = Some(false);
        let result = classify(vec![gone, implicit(Some(ID))], "DEV");
        assert_eq!(result.shortcuts[0].launch, Launch::LauncherMissing);
        assert!(result.shortcuts[0].repair.is_none());

        let mut unreadable = pin(None);
        unreadable.read_error = Some("denied".into());
        let mut unrelated = raw(Location::TaskbarPin, r"T\Other.lnk", "", "", None);
        unrelated.read_error = Some("denied".into());
        let result = classify(vec![unreadable, unrelated, implicit(Some(ID))], "DEV");
        assert_eq!(result.shortcuts.len(), 2);
        assert_eq!(
            (result.shortcuts[0].launch, result.shortcuts[0].identity),
            (Launch::Unreadable, Identity::Unknown)
        );
        assert!(result.shortcuts[0].repair.is_none());
        assert_eq!(
            result.incomplete.len(),
            1,
            "the unreadable file that could not be identified is reported"
        );
        assert!(result.incomplete[0].starts_with("1 shortcut file could not be read"));
        assert!(matching.incomplete.is_empty());
        let listed = enumeration_problems((0..7).map(|n| format!("denied {n}")).collect());
        assert_eq!(listed.len(), 6);
        assert!(listed[0].contains("denied 0") && listed[5].starts_with("2 more"));
    }

    #[test]
    fn approves_only_the_reviewed_unchanged_plan() {
        let inspection = classify(vec![pin(None), start(), implicit(Some(ID))], "DEV");
        let fingerprint = "ab".repeat(32);
        let reviewed = plan(false, Some(ID));
        assert!(approve_repair(&inspection, PIN, &fingerprint, &reviewed).is_ok());
        let kind = |result: Result<&WindowsShortcut, AppError>| result.unwrap_err().kind;
        assert_eq!(
            kind(approve_repair(
                &inspection,
                PIN,
                &"cd".repeat(32),
                &reviewed
            )),
            "windowsShortcutChanged"
        );
        assert_eq!(
            kind(approve_repair(
                &inspection,
                PIN,
                &fingerprint,
                &plan(false, Some(OTHER_ID))
            )),
            "windowsShortcutChanged"
        );
        assert_eq!(
            kind(approve_repair(
                &inspection,
                PIN,
                &fingerprint,
                &plan(true, Some(ID))
            )),
            "windowsShortcutChanged"
        );
        assert_eq!(
            kind(approve_repair(
                &inspection,
                r"T\Missing.lnk",
                &fingerprint,
                &reviewed
            )),
            "windowsShortcutChanged"
        );
        assert_eq!(
            kind(approve_repair(
                &inspection,
                r"S\Git Khronos (DEV).lnk",
                &fingerprint,
                &reviewed
            )),
            "windowsShortcutNotRepairable"
        );
        assert_eq!(
            kind(approve_repair(
                &inspection,
                IMPLICIT,
                &fingerprint,
                &reviewed
            )),
            "windowsShortcutNotRepairable"
        );
    }

    #[test]
    fn every_failure_after_backup_reports_where_the_original_is() {
        let outcome = |outcome: &str, backup: Option<&str>| {
            let raw = RawRepair {
                outcome: outcome.into(),
                backup_path: backup.map(Into::into),
                backup_intact: Some(true),
            };
            repair_outcome(raw, PIN.into(), plan(false, Some(ID)))
        };
        let applied = outcome("applied", Some(r"B\pin.lnk")).unwrap();
        assert_eq!(applied.backup_path, r"B\pin.lnk");
        assert_eq!(
            outcome("changed", None).unwrap_err().kind,
            "windowsShortcutChanged"
        );
        assert_eq!(
            outcome("stagingMismatch", None).unwrap_err().kind,
            "windowsShortcutRepairFailed"
        );
        for (name, kind) in [
            ("restored", "windowsShortcutRepairFailed"),
            ("restoreUnverified", "windowsShortcutRestoreUnverified"),
            ("unverified", "windowsShortcutUnverified"),
        ] {
            let failure = outcome(name, Some(r"B\pin.lnk")).unwrap_err();
            assert_eq!(failure.kind, kind);
            assert!(failure.message.contains(r"B\pin.lnk"), "{name}");
        }
        assert!(
            outcome("restoreUnverified", None)
                .unwrap_err()
                .message
                .contains(BACKUP_FOLDER)
        );
        assert_eq!(
            outcome("applied", None).unwrap_err().kind,
            "windowsShortcutUnverified"
        );
        let unavailable = outcome("backupUnavailable", None).unwrap_err();
        assert_eq!(unavailable.kind, "windowsShortcutRepairFailed");
        assert!(unavailable.message.contains("nothing was modified"));
    }

    #[test]
    fn never_reports_success_when_the_backup_is_not_a_faithful_copy() {
        for name in ["applied", "unverified", "restored", "restoreUnverified"] {
            for intact in [Some(false), None] {
                let raw = RawRepair {
                    outcome: name.into(),
                    backup_path: Some(r"B\pin.lnk".into()),
                    backup_intact: intact,
                };
                let failure = repair_outcome(raw, PIN.into(), plan(false, Some(ID))).unwrap_err();
                assert_eq!(failure.kind, "windowsShortcutBackupDamaged", "{name}");
                assert!(
                    failure.message.contains(r"B\pin.lnk")
                        && failure.message.contains("cannot be used to undo")
                );
                assert_eq!(
                    failure.message.starts_with("The shortcut was updated"),
                    name == "applied"
                );
            }
        }
    }

    #[test]
    fn keeps_backup_and_staging_paths_apart_for_every_attempt() {
        let first = run_id();
        assert_ne!(first, run_id());
        let script = repair_script(PIN, "ab", &plan(false, Some(ID)), &first);
        assert!(!script.contains("__"), "every placeholder is filled");
        assert!(script.contains(&script_value(&first)) && script.contains(&script_value("AB")));
        assert!(
            !script.contains("-Recurse")
                && !script.contains("-Force -Path")
                && !script.contains("Remove-Item")
        );
        assert!(
            script.contains("Join-Path $directory 'original'")
                && script.contains("Join-Path $directory 'staging'")
        );
    }

    #[test]
    fn encodes_values_without_script_syntax() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(encoded_command("ab"), "YQBiAA==");
        let value = script_value("C:\\it's ‘quoted’ $(evil)");
        assert!(
            value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
        );
    }

    #[test]
    fn reports_script_errors_with_any_backup() {
        assert_eq!(
            script_result(r#"{"shortcuts":[]}"#).unwrap(),
            r#"{"shortcuts":[]}"#
        );
        let failure =
            script_result(r#"{"scriptError":"Access denied","backupPath":null}"#).unwrap_err();
        assert_eq!(failure.kind, "windowsShortcutScriptFailed");
        assert!(failure.message.contains("Access denied") && failure.hint.is_none());
        let failure = script_result(
            r#"{"scriptError":"Interrupted","backupPath":"B\\pin.lnk","backupIntact":true}"#,
        )
        .unwrap_err();
        assert!(
            failure.message.contains(r"B\pin.lnk")
                && failure.hint.unwrap().contains("copy the backup")
        );
        let failure = script_result(
            r#"{"scriptError":"Interrupted","backupPath":"B\\pin.lnk","backupIntact":false}"#,
        )
        .unwrap_err();
        assert!(
            failure.message.contains("could not be confirmed")
                && !failure.hint.unwrap().contains("copy the backup")
        );
    }

    #[test]
    fn reports_non_wsl_hosts_as_unsupported() {
        let result = unsupported("not here");
        assert!(!result.supported && result.shortcuts.is_empty() && result.app_identity.is_none());
    }

    /// Runs real repairs on disposable shortcuts under %TEMP%, with
    /// LOCALAPPDATA redirected there too. Nothing outside that folder is
    /// touched. Run with `cargo test -- --ignored --test-threads=1` inside WSL.
    mod disposable_windows {
        use super::*;

        const FAKE_ID: &str = "Microsoft.RemoteApp.DisposableTestIdentityDoNotUse0000000000000=";

        struct Sandbox {
            root: String,
        }

        impl Drop for Sandbox {
            fn drop(&mut self) {
                let _ = run_powershell(
                    &format!(
                        "Remove-Item -LiteralPath (Text '{}') -Recurse -Force; Emit @{{ ok = $true }}",
                        script_value(&self.root)
                    ),
                    Duration::from_secs(60),
                );
            }
        }

        fn ps(script: &str) -> serde_json::Value {
            let output =
                run_powershell(script, Duration::from_secs(120)).expect("PowerShell result");
            serde_json::from_str(&output).expect("JSON result")
        }

        fn sandbox() -> Option<Sandbox> {
            find_powershell()?;
            let root = ps(&format!(
                "$dir = Join-Path $env:TEMP (Text '{}'); [void][IO.Directory]::CreateDirectory((Join-Path $dir 'la')); Emit @{{ root = $dir }}",
                script_value(&format!("gk-shortcut-tests-{}", run_id()))
            ))["root"]
                .as_str()?
                .to_owned();
            Some(Sandbox { root })
        }

        impl Sandbox {
            fn prefix(&self) -> String {
                format!(
                    "$env:LOCALAPPDATA = Join-Path (Text '{}') 'la'\n",
                    script_value(&self.root)
                )
            }

            /// Creates a split-launcher shortcut and returns its path and hash.
            fn shortcut(&self, folder: &str, name: &str) -> (String, String) {
                let value = ps(&format!(
                    "$dir = Join-Path (Text '{root}') (Text '{folder}'); [void][IO.Directory]::CreateDirectory($dir); $file = Join-Path $dir (Text '{name}')
$link = $shell.CreateShortcut($file); $link.TargetPath = 'C:\\Program'; $link.Arguments = (Text '{args}'); $link.WorkingDirectory = 'C:\\'; $link.Description = 'disposable'; $link.Save()
Emit @{{ path = $file; hash = (Hash $file) }}",
                    root = script_value(&self.root),
                    folder = script_value(folder),
                    name = script_value(name),
                    args = script_value(SPLIT_ARGS),
                ));
                (
                    value["path"].as_str().unwrap().to_owned(),
                    value["hash"].as_str().unwrap().to_owned(),
                )
            }

            fn repair(
                &self,
                path: &str,
                hash: &str,
                run: &str,
                before: &str,
            ) -> Result<WindowsShortcutRepair, AppError> {
                let plan = plan(true, Some(FAKE_ID));
                let script = format!(
                    "{}{before}\n{}",
                    self.prefix(),
                    repair_script(path, hash, &plan, run)
                );
                let output = run_powershell(&script, REPAIR_TIMEOUT)?;
                repair_outcome(
                    serde_json::from_str(&output).map_err(|_| error("bad", output, None))?,
                    path.to_owned(),
                    plan,
                )
            }

            fn state(&self, path: &str) -> serde_json::Value {
                ps(&format!(
                    "$file = Text '{}'; $link = $shell.CreateShortcut($file)
Emit @{{ hash = (Hash $file); target = [string]$link.TargetPath; arguments = [string]$link.Arguments; workdir = [string]$link.WorkingDirectory; id = [GitKhronosShortcut]::ReadId($file) }}",
                    script_value(path)
                ))
            }

            fn hash(&self, path: &str) -> Option<String> {
                ps(&format!("$file = Text '{}'; Emit @{{ hash = $(if (Test-Path -LiteralPath $file) {{ Hash $file }} else {{ $null }}) }}", script_value(path)))["hash"]
                    .as_str()
                    .map(str::to_owned)
            }

            /// Copies the backup over the shortcut, as a user would to undo the repair.
            fn restore(&self, backup: &str, path: &str) {
                ps(&format!(
                    "Copy-Item -LiteralPath (Text '{}') -Destination (Text '{}') -Force; Emit @{{ ok = $true }}",
                    script_value(backup),
                    script_value(path)
                ));
            }
        }

        #[test]
        #[ignore = "needs WSL interop; writes only under %TEMP%"]
        fn backups_survive_shortcut_names_that_match_reserved_names() {
            let Some(sandbox) = sandbox() else {
                return eprintln!("skipped: Windows PowerShell unavailable");
            };
            for name in [
                "staging-result.lnk",
                "staging-source.lnk",
                "source.lnk",
                "result.lnk",
                "original.lnk",
                "attempt.lock.lnk",
            ] {
                let (path, hash) = sandbox.shortcut("names", name);
                let repaired = sandbox
                    .repair(&path, &hash, &run_id(), "")
                    .unwrap_or_else(|failure| panic!("{name}: {}", failure.message));
                assert!(
                    repaired
                        .backup_path
                        .ends_with(&format!(r"\original\{name}")),
                    "{name}: {}",
                    repaired.backup_path
                );
                assert_eq!(
                    sandbox.hash(&repaired.backup_path).as_deref(),
                    Some(hash.as_str()),
                    "{name}: backup is byte-identical"
                );
                let state = sandbox.state(&path);
                assert_eq!(state["target"], WSLG, "{name}");
                assert_eq!(
                    state["arguments"], r#"-d DEV --cd "~" -- git-khronos"#,
                    "{name}"
                );
                assert_eq!(state["workdir"], r"C:\", "{name}");
                assert_eq!(state["id"], FAKE_ID, "{name}");
                sandbox.restore(&repaired.backup_path, &path);
                assert_eq!(
                    sandbox.hash(&path).as_deref(),
                    Some(hash.as_str()),
                    "{name}: backup undoes the repair"
                );
            }
        }

        #[test]
        #[ignore = "needs WSL interop; writes only under %TEMP%"]
        fn failed_write_keeps_original_and_a_faithful_backup() {
            let Some(sandbox) = sandbox() else {
                return eprintln!("skipped: Windows PowerShell unavailable");
            };
            let (path, hash) = sandbox.shortcut("locked", "Git Khronos (DEV).lnk");
            let lock = format!(
                "$held = [IO.File]::Open((Text '{}'), 'Open', 'Read', 'Read')",
                script_value(&path)
            );
            let failure = sandbox.repair(&path, &hash, &run_id(), &lock).unwrap_err();
            assert_eq!(failure.kind, "windowsShortcutScriptFailed");
            assert!(
                failure
                    .message
                    .contains("checked against the reviewed version"),
                "{}",
                failure.message
            );
            let backup = failure
                .message
                .rsplit(" is at ")
                .next()
                .unwrap()
                .trim_end_matches('.');
            assert_eq!(sandbox.hash(backup).as_deref(), Some(hash.as_str()));
            assert_eq!(
                sandbox.hash(&path).as_deref(),
                Some(hash.as_str()),
                "original untouched"
            );
        }

        #[test]
        #[ignore = "needs WSL interop; writes only under %TEMP%"]
        fn existing_backup_folder_is_never_reused_or_emptied() {
            let Some(sandbox) = sandbox() else {
                return eprintln!("skipped: Windows PowerShell unavailable");
            };
            let (path, hash) = sandbox.shortcut("taken", "Git Khronos (DEV).lnk");
            let run = run_id();
            let foreign = ps(&format!(
                "{}$dir = Join-Path $env:LOCALAPPDATA ('Git Khronos\\Windows shortcut backups\\' + (Text '{}')); [void][IO.Directory]::CreateDirectory((Join-Path $dir 'staging')); $file = Join-Path $dir 'staging\\result.lnk'; [IO.File]::WriteAllText($file, 'foreign'); Emit @{{ path = $file; hash = (Hash $file) }}",
                sandbox.prefix(),
                script_value(&run)
            ));
            let failure = sandbox.repair(&path, &hash, &run, "").unwrap_err();
            assert!(
                failure.message.contains("nothing was modified"),
                "{}",
                failure.message
            );
            assert_eq!(
                sandbox.hash(foreign["path"].as_str().unwrap()).as_deref(),
                foreign["hash"].as_str(),
                "foreign file intact"
            );
            assert_eq!(
                sandbox.hash(&path).as_deref(),
                Some(hash.as_str()),
                "shortcut untouched"
            );
        }

        #[test]
        #[ignore = "needs WSL interop; reads the real shortcut folders without changing them"]
        fn inspection_script_reports_listing_problems_as_a_list() {
            if find_powershell().is_none() || current_distribution().is_none() {
                return eprintln!("skipped: Windows PowerShell unavailable");
            }
            let result = inspect().unwrap();
            assert!(result.supported);
            eprintln!(
                "shortcuts: {}, incomplete: {:?}",
                result.shortcuts.len(),
                result.incomplete
            );
        }

        #[test]
        #[ignore = "needs WSL interop; writes only under %TEMP%"]
        fn concurrent_attempts_with_the_same_folder_name_cannot_share_it() {
            let Some(sandbox) = sandbox() else {
                return eprintln!("skipped: Windows PowerShell unavailable");
            };
            let first = sandbox.shortcut("one", "Git Khronos (DEV).lnk");
            let second = sandbox.shortcut("two", "Git Khronos (DEV).lnk");
            let run = run_id();
            let results = std::thread::scope(|scope| {
                let jobs: Vec<_> = [&first, &second]
                    .into_iter()
                    .map(|(path, hash)| scope.spawn(|| sandbox.repair(path, hash, &run, "")))
                    .collect();
                jobs.into_iter()
                    .map(|job| job.join().unwrap())
                    .collect::<Vec<_>>()
            });
            let winners: Vec<_> = results
                .iter()
                .enumerate()
                .filter(|(_, result)| result.is_ok())
                .collect();
            assert_eq!(winners.len(), 1, "{results:?}");
            let (index, Ok(repaired)) = winners[0] else {
                unreachable!()
            };
            let (loser_path, loser_hash) = if index == 0 { &second } else { &first };
            let (_, winner_hash) = if index == 0 { &first } else { &second };
            let failure = results[1 - index].as_ref().unwrap_err();
            assert!(
                failure.message.contains("nothing was modified"),
                "{}",
                failure.message
            );
            assert_eq!(
                sandbox.hash(loser_path).as_deref(),
                Some(loser_hash.as_str()),
                "losing shortcut untouched"
            );
            assert_eq!(
                sandbox.hash(&repaired.backup_path).as_deref(),
                Some(winner_hash.as_str()),
                "winner's backup intact"
            );
        }
    }
}

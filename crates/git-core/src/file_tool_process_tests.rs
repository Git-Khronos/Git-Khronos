use super::*;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut bytes = [0u8; 12];
        getrandom::fill(&mut bytes).unwrap();
        let path = std::env::temp_dir().join(format!(
            "owned-file-process-{}",
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn command(&self, script: &str) -> Command {
        let name = self.0.join("owned recorder 'é'.py");
        fs::write(&name, script).unwrap();
        let mut command = Command::new("/usr/bin/python3");
        command.arg(name).current_dir(&self.0);
        command
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn exited(process: &mut FileToolProcess) -> FileToolProcessStatus {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let state = process.poll().unwrap();
        if state.state == FileToolProcessState::Exited {
            return state;
        }
        assert!(Instant::now() < deadline, "owned process did not exit");
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !path.exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn file_tool_process_preserves_literal_argv_cwd_and_user_config_but_clears_repository_and_prompt_bridges()
 {
    let f = Fixture::new();
    let mut command = f.command("import json,os,pathlib,sys\npathlib.Path('record.json').write_text(json.dumps({'args':sys.argv[1:],'cwd':os.getcwd(),'selectors':{key:os.getenv(key) for key in ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_LITERAL_PATHSPECS','GIT_GLOB_PATHSPECS','GIT_NOGLOB_PATHSPECS','GIT_ICASE_PATHSPECS']},'bridge':{key:os.getenv(key) for key in ['GIT_ASKPASS','SSH_ASKPASS','SSH_ASKPASS_REQUIRE','GIT_KHRONOS_ASKPASS_TOKEN','GIT_KHRONOS_ASKPASS_EXTRA']},'config':os.getenv('GIT_CONFIG_GLOBAL')}))\n");
    let args = [
        "",
        "literal 'é'",
        "; touch must-not-run",
        "$(touch never-run)",
        "{file}",
    ];
    command
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "owned-user-config");
    for key in GIT_CONTEXT_ENVIRONMENT_VARIABLES {
        command.env(key, "unselected");
    }
    for key in [
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "SSH_ASKPASS_REQUIRE",
        "GIT_KHRONOS_ASKPASS_TOKEN",
        "GIT_KHRONOS_ASKPASS_EXTRA",
    ] {
        command.env(key, "not-inherited");
    }
    let mut process = FileToolProcess::spawn(command).unwrap();
    assert_eq!(exited(&mut process).success, Some(true));
    let record: serde_json::Value =
        serde_json::from_slice(&fs::read(f.0.join("record.json")).unwrap()).unwrap();
    assert_eq!(record["args"], serde_json::json!(args));
    assert_eq!(record["cwd"], f.0.to_str().unwrap());
    assert_eq!(record["config"], "owned-user-config");
    assert!(
        record["selectors"]
            .as_object()
            .unwrap()
            .values()
            .all(|v| v.is_null())
    );
    assert!(
        record["bridge"]
            .as_object()
            .unwrap()
            .values()
            .all(|v| v.is_null())
    );
    assert!(!f.0.join("must-not-run").exists() && !f.0.join("never-run").exists());
}
#[test]
fn file_tool_process_cancel_stops_only_its_owned_child_and_does_not_signal_an_exited_handle() {
    let a = Fixture::new();
    let b = Fixture::new();
    let mut first = FileToolProcess::spawn(
        a.command("import pathlib,time\npathlib.Path('ready').touch()\ntime.sleep(5)\n"),
    )
    .unwrap();
    let mut second = FileToolProcess::spawn(b.command("import pathlib,time\npathlib.Path('ready').touch()\ntime.sleep(.3)\npathlib.Path('completed').touch()\n")).unwrap();
    wait_file(&a.0.join("ready"));
    wait_file(&b.0.join("ready"));
    first.cancel().unwrap();
    let stopped = exited(&mut first);
    assert_eq!(stopped.success, Some(false));
    assert!(stopped.cancellation_requested);
    assert_eq!(first.cancel().unwrap(), stopped);
    assert_eq!(exited(&mut second).success, Some(true));
    assert!(b.0.join("completed").exists());
}
#[test]
fn file_tool_process_launcher_exit_cannot_cancel_the_separate_gui_handoff_or_prove_save() {
    let f = Fixture::new();
    let marker = f.0.join("gui-finished");
    let mut command = f.command("import pathlib,subprocess,sys\nsubprocess.Popen([sys.executable,'-c',\"import pathlib,sys,time;time.sleep(.2);pathlib.Path(sys.argv[1]).touch()\",sys.argv[1]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)\n");
    command.arg(&marker);
    let mut process = FileToolProcess::spawn(command).unwrap();
    let state = exited(&mut process);
    assert_eq!(state.success, Some(true));
    assert!(!state.cancellation_requested);
    assert_eq!(process.cancel().unwrap(), state);
    wait_file(&marker);
}
#[test]
fn file_tool_process_nonzero_exit_is_retained_and_missing_program_is_an_explicit_error() {
    let f = Fixture::new();
    let mut process = FileToolProcess::spawn(f.command("raise SystemExit(19)\n")).unwrap();
    let state = exited(&mut process);
    assert_eq!(state.code, Some(19));
    assert_eq!(state.success, Some(false));
    assert_eq!(process.cancel().unwrap(), state);
    assert!(FileToolProcess::spawn(Command::new(f.0.join("missing-program"))).is_err());
}

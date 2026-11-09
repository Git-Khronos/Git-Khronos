use super::*;
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{Duration, Instant},
};
struct Fixture {
    root: PathBuf,
    repo: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("owned-native-file-tools-{}", identifier().unwrap()));
        fs::create_dir(&root).unwrap();
        let repo = root.join("repository");
        fs::create_dir(&repo).unwrap();
        let output = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["init", "--template=", "-q", "-b", "main"])
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(output.status.success());
        let config = repo.join(".git/config");
        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str(
            "\n[core]\nhooksPath = /dev/null\nfsmonitor = false\nattributesFile = /dev/null\n",
        );
        fs::write(config, text).unwrap();
        fs::write(repo.join("file.txt"), b"owned bytes\n").unwrap();
        Self { root, repo }
    }
    fn uid(&self) -> u32 {
        // SAFETY: geteuid takes no pointer arguments and has no memory effects.
        unsafe { libc::geteuid() }
    }
    fn tool(&self, role: core::ToolRole) -> core::PreparedFileTool {
        let request = if role == core::ToolRole::Editor {
            core::FileToolRequest::Editor {
                path: "file.txt".into(),
                line: None,
            }
        } else {
            core::FileToolRequest::Diff {
                before: core::FileToolSource::WorkingTree {
                    path: "file.txt".into(),
                },
                after: core::FileToolSource::WorkingTree {
                    path: "file.txt".into(),
                },
            }
        };
        let arguments = if role == core::ToolRole::Editor {
            vec!["{file}".into()]
        } else {
            vec!["{before}".into(), "{after}".into()]
        };
        // SAFETY: geteuid has no pointer arguments or memory effects.
        core::prepare_file_tool(
            &self.repo,
            request,
            core::ToolProfile {
                version: 1,
                id: "owned".into(),
                name: "Owned program".into(),
                role,
                executable: "/usr/bin/true".into(),
                arguments,
            },
            &self.root.join("copies"),
            self.uid(),
            &core::CancellationToken::default(),
        )
        .unwrap()
    }
    fn session(&self) -> Arc<Session> {
        Arc::new(Session {
            requested_at_millis: "1793577600000".into(),
            id: identifier().unwrap(),
            repo_id: "owned-repository".into(),
            closed: AtomicBool::new(false),
            value: Mutex::new(SessionValue {
                revision: identifier().unwrap(),
                tool: self.tool(core::ToolRole::Editor),
                child: None,
                phase: FileToolSessionPhase::Failed,
                error: None,
                saved: None,
            }),
        })
    }
    fn add_unexpected_private_file(&self) -> PathBuf {
        let directory = fs::read_dir(self.root.join("copies"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let unexpected = directory.join("unexpected.txt");
        fs::write(&unexpected, b"preserve").unwrap();
        unexpected
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
#[test]
fn file_tool_runtime_cancelled_publication_discards_only_unlaunched_private_copies_and_releases_reservation()
 {
    let fixture = Fixture::new();
    let state = FileToolState::default();
    let reservation = Reservation::new(&state, "context", Purpose::Launch).unwrap();
    let tool = fixture.tool(core::ToolRole::Diff);
    assert_eq!(
        fs::read_dir(fixture.root.join("copies")).unwrap().count(),
        1
    );
    let cancellation = core::CancellationToken::default();
    cancellation.cancel();
    assert!(
        reservation
            .publish(
                Payload::Launch {
                    repo_id: "owned".into(),
                    tool: Box::new(tool)
                },
                &cancellation
            )
            .is_err()
    );
    assert_eq!(
        fs::read_dir(fixture.root.join("copies")).unwrap().count(),
        0
    );
    Reservation::new(&state, "context", Purpose::Launch).unwrap();
    assert_eq!(
        fs::read(fixture.repo.join("file.txt")).unwrap(),
        b"owned bytes\n"
    );
}

#[test]
fn file_tool_runtime_cancelled_publication_reports_private_copies_that_cannot_be_retired() {
    let fixture = Fixture::new();
    let state = FileToolState::default();
    let reservation = Reservation::new(&state, "context", Purpose::Launch).unwrap();
    let tool = fixture.tool(core::ToolRole::Diff);
    let unexpected = fixture.add_unexpected_private_file();
    let cancellation = core::CancellationToken::default();
    cancellation.cancel();
    let error = reservation
        .publish(
            Payload::Launch {
                repo_id: "owned".into(),
                tool: Box::new(tool),
            },
            &cancellation,
        )
        .unwrap_err();
    assert_eq!(error.kind, "fileToolSnapshotRefused");
    assert!(error.message.contains("unexpected files"));
    assert_eq!(fs::read(unexpected).unwrap(), b"preserve");
    Reservation::new(&state, "context", Purpose::Launch).unwrap();
}

#[test]
fn file_tool_runtime_explicit_retirement_reports_and_preserves_unexpected_private_files() {
    let fixture = Fixture::new();
    let state = FileToolState::default();
    let reservation = Reservation::new(&state, "context", Purpose::Launch).unwrap();
    let tool = fixture.tool(core::ToolRole::Diff);
    let unexpected = fixture.add_unexpected_private_file();
    let token = reservation
        .publish(
            Payload::Launch {
                repo_id: "owned".into(),
                tool: Box::new(tool),
            },
            &core::CancellationToken::default(),
        )
        .unwrap();
    let error = state
        .discard_review("context", Purpose::Launch, &token)
        .unwrap_err();
    assert_eq!(error.kind, "fileToolSnapshotRefused");
    assert_eq!(fs::read(unexpected).unwrap(), b"preserve");
    Reservation::new(&state, "context", Purpose::Launch).unwrap();
}

#[test]
fn file_tool_runtime_replacing_a_review_reports_cleanup_failure_and_releases_the_new_slot() {
    let fixture = Fixture::new();
    let state = FileToolState::default();
    let old = Reservation::new(&state, "context", Purpose::Launch).unwrap();
    let tool = fixture.tool(core::ToolRole::Diff);
    let unexpected = fixture.add_unexpected_private_file();
    old.publish(
        Payload::Launch {
            repo_id: "owned".into(),
            tool: Box::new(tool),
        },
        &core::CancellationToken::default(),
    )
    .unwrap();
    let error = match Reservation::new(&state, "context", Purpose::Launch) {
        Ok(_) => panic!("a failed cleanup must not produce a new reservation"),
        Err(error) => error,
    };
    assert_eq!(error.kind, "fileToolSnapshotRefused");
    assert_eq!(fs::read(unexpected).unwrap(), b"preserve");
    Reservation::new(&state, "context", Purpose::Launch).unwrap();
}
#[test]
fn file_tool_runtime_session_capacity_and_retirement_never_replace_another_owned_session() {
    let fixture = Fixture::new();
    let state = FileToolState::default();
    let mut sessions = Vec::new();
    for _ in 0..SESSION_CAPACITY {
        let session = fixture.session();
        state.insert(session.clone()).unwrap();
        sessions.push(session);
    }
    assert!(state.insert(fixture.session()).is_err());
    assert!(state.insert(sessions[0].clone()).is_err());
    for session in &sessions {
        assert!(Arc::ptr_eq(&state.get(&session.id).unwrap(), session));
    }
    sessions[0].closed.store(true, Ordering::Release);
    assert!(state.get(&sessions[0].id).is_err());
}
#[test]
fn file_tool_runtime_late_launch_publication_cleans_its_own_copies_without_retiring_new_work() {
    let fixture = Fixture::new();
    let state = FileToolState::default();
    let old = Reservation::new(&state, "context", Purpose::Launch).unwrap();
    state
        .reviews
        .lock()
        .unwrap()
        .discard("context", Purpose::Launch, &old.token)
        .unwrap();
    let current = Reservation::new(&state, "context", Purpose::Launch).unwrap();
    assert!(
        old.publish(
            Payload::Launch {
                repo_id: "owned".into(),
                tool: Box::new(fixture.tool(core::ToolRole::Diff))
            },
            &core::CancellationToken::default()
        )
        .is_err()
    );
    current
        .publish(
            Payload::Launch {
                repo_id: "owned".into(),
                tool: Box::new(fixture.tool(core::ToolRole::Editor)),
            },
            &core::CancellationToken::default(),
        )
        .unwrap();
    assert_eq!(
        fs::read_dir(fixture.root.join("copies")).unwrap().count(),
        0
    );
}
#[test]
fn file_tool_runtime_cleanup_refuses_unconfirmed_launch_and_live_owned_process_until_exit() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let mut value = session.value.lock().unwrap();
    value.phase = FileToolSessionPhase::Launching;
    assert!(finished(&mut value).is_err());
    let script = fixture.root.join("owned wait.py");
    fs::write(&script, "import time\ntime.sleep(5)\n").unwrap();
    let mut tool = core::prepare_file_tool(
        &fixture.repo,
        core::FileToolRequest::Editor {
            path: "file.txt".into(),
            line: None,
        },
        core::ToolProfile {
            version: 1,
            id: "owned-wait".into(),
            name: "Owned wait".into(),
            role: core::ToolRole::Editor,
            executable: "/usr/bin/python3".into(),
            arguments: vec![script.to_str().unwrap().into(), "{file}".into()],
        },
        &fixture.root.join("copies"),
        fixture.uid(),
        &core::CancellationToken::default(),
    )
    .unwrap();
    value.child = Some(tool.launch(&core::CancellationToken::default()).unwrap());
    value.phase = FileToolSessionPhase::Launched;
    assert!(finished(&mut value).is_err());
    value.child.as_mut().unwrap().cancel().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while value.child.as_mut().unwrap().poll().unwrap().state != core::FileToolProcessState::Exited
    {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    finished(&mut value).unwrap();
}

#[test]
fn file_tool_runtime_session_snapshot_retains_request_time_and_inspectable_action_errors() {
    let fixture = Fixture::new();
    let session = fixture.session();
    let mut value = session.value.lock().unwrap();
    value.error = Some(refused("Owned save outcome requires inspection"));
    let snapshot = session.snapshot(&mut value);
    assert_eq!(snapshot.requested_at_millis, "1793577600000");
    assert_eq!(
        snapshot.error.unwrap().message,
        "Owned save outcome requires inspection"
    );
    assert!(snapshot.process.is_none());
    assert!(!snapshot.can_review_staging);
}

use super::*;
use serde_json::Value;

struct Fixture {
    directory: PathBuf,
    actor: Value,
    owner: Value,
    source: Value,
    fork: Value,
    reference: Value,
    fork_unavailable: bool,
    reference_unavailable: bool,
    object_unavailable: bool,
    write_error: bool,
    write_panic: bool,
    reads: Vec<String>,
    writes: Vec<(String, Value)>,
}
impl Fixture {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("khronos-fork-request-{}", random_id().unwrap()));
        fs::create_dir(&directory).unwrap();
        let source = json!({"id":101,"name":"source","full_name":"team/source","owner":{"id":90,"login":"team"},"html_url":"https://github.com/team/source","clone_url":"https://github.com/team/source.git","ssh_url":"git@github.com:team/source.git","fork":false,"allow_forking":true,"permissions":{"pull":true}});
        let fork = json!({"id":9007199254740993u64,"name":"forked","full_name":"owned/forked","owner":{"id":7,"login":"owned"},"html_url":"https://github.com/owned/forked","clone_url":"https://github.com/owned/forked.git","ssh_url":"git@github.com:owned/forked.git","fork":true,"parent":{"id":101,"full_name":"team/source"},"source":{"id":101,"full_name":"team/source"},"default_branch":"feature/review","permissions":{"pull":true},"temp_clone_token":"private-response-only"});
        Self {
            directory,
            actor: json!({"id":7,"login":"owned"}),
            owner: json!({"id":7,"login":"owned","type":"User"}),
            source,
            fork,
            reference: json!({"ref":"refs/heads/feature/review","object":{"type":"commit","sha":"a".repeat(40)}}),
            fork_unavailable: false,
            reference_unavailable: false,
            object_unavailable: false,
            write_error: false,
            write_panic: false,
            reads: vec![],
            writes: vec![],
        }
    }
    fn request(&self) -> HostedForkRequest {
        HostedForkRequest {
            source_full_name: "team/source".into(),
            source_repository_id: "101".into(),
            account_id: "7".into(),
            destination_owner: "owned".into(),
            name: "forked".into(),
            default_branch_only: true,
        }
    }
    fn plan(&mut self) -> HostedForkPlan {
        let r = self.request();
        prepare_with(self, &r).unwrap()
    }
    fn execute(&mut self, plan: &HostedForkPlan) -> HostedForkStatus {
        let directory = self.directory.clone();
        execute_with(&directory, plan, self, &CancellationToken::default()).unwrap()
    }
    fn reconcile(&mut self, id: &str) -> HostedForkStatus {
        let directory = self.directory.clone();
        reconcile_with(&directory, id, self, &CancellationToken::default()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}
impl Transport for Fixture {
    fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
        self.reads.push(endpoint.into());
        if endpoint == format!("repos/owned/forked/git/commits/{}", "a".repeat(40)) {
            return if self.object_unavailable {
                Err(refused("Owned Git commit object pending."))
            } else {
                Ok(
                    json!({"sha":"a".repeat(40),"tree":{"sha":"b".repeat(40)},"message":"private response metadata is not persisted"}),
                )
            };
        }
        match endpoint {
            "user" => Ok(self.actor.clone()),
            "users/owned" | "users/owned-org" => Ok(self.owner.clone()),
            "repos/team/source" => Ok(self.source.clone()),
            "repos/owned/forked" | "repos/owned-org/forked" if !self.fork_unavailable => {
                Ok(self.fork.clone())
            }
            "repos/owned/forked" | "repos/owned-org/forked" => {
                Err(refused("Owned read unavailable, not evidence of absence."))
            }
            "repos/owned/forked/git/ref/heads/feature%2Freview" if !self.reference_unavailable => {
                Ok(self.reference.clone())
            }
            "repos/owned/forked/git/ref/heads/feature%2Freview" => {
                Err(refused("Owned Git references still pending."))
            }
            _ => panic!("Unexpected provider read {endpoint}"),
        }
    }
    fn write(
        &mut self,
        method: &'static str,
        endpoint: &str,
        payload: &Value,
    ) -> Result<Value, AppError> {
        assert_eq!(method, "POST");
        assert_eq!(endpoint, "repos/team/source/forks");
        // Observe disk at the provider boundary, independently of the in-memory
        // status. A request must already survive a caller/process interruption.
        let records = fs::read_dir(&self.directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .collect::<Vec<_>>();
        assert_eq!(records.len(), 1);
        let value: Value = serde_json::from_slice(&fs::read(records[0].path()).unwrap()).unwrap();
        assert_eq!(value["status"]["phase"], "awaitingConfirmation");
        assert_eq!(value["status"]["serverReplyReceived"], false);
        self.writes.push((endpoint.into(), payload.clone()));
        assert!(
            !serde_json::to_string(payload)
                .unwrap()
                .contains("private-response-only")
        );
        if self.write_panic {
            panic!("Owned lost caller after dispatch boundary");
        }
        if self.write_error {
            return Err(refused("Owned ambiguous provider reply"));
        }
        Ok(json!({"temp_clone_token":"private-response-only"}))
    }
}

#[test]
fn fork_creation_prepare_is_read_only_and_personal_scope_is_explicit() {
    let mut f = Fixture::new();
    let plan = f.plan();
    assert_eq!(plan.intent.destination.id, "7");
    assert_eq!(plan.intent.destination.kind, HostedForkOwnerKind::Personal);
    assert!(plan.intent.default_branch_only);
    assert!(f.writes.is_empty());
    assert_eq!(fs::read_dir(&f.directory).unwrap().count(), 0);
    let encoded = serde_json::to_string(&plan).unwrap();
    assert!(!encoded.contains("private-response-only"));
    assert!(!encoded.contains("created"));
    f.owner["id"] = json!(8);
    let request = f.request();
    assert!(prepare_with(&mut f, &request).is_err());
    f.owner["id"] = json!(7);
    f.source["allow_forking"] = json!(false);
    assert!(prepare_with(&mut f, &request).is_err());
    f.source["allow_forking"] = Value::Null;
    assert!(
        prepare_with(&mut f, &request)
            .unwrap()
            .intent
            .forking_allowed
            .is_none()
    );
    let mut bad = request;
    bad.name = "../elsewhere".into();
    f.reads.clear();
    assert!(prepare_with(&mut f, &bad).is_err());
    assert!(f.reads.is_empty());
}

#[test]
fn fork_creation_organization_payload_has_no_personal_fallback() {
    let mut f = Fixture::new();
    f.owner = json!({"id":88,"login":"owned-org","type":"Organization"});
    let mut r = f.request();
    r.destination_owner = "owned-org".into();
    r.default_branch_only = false;
    let plan = prepare_with(&mut f, &r).unwrap();
    assert_eq!(
        plan.intent.destination.kind,
        HostedForkOwnerKind::Organization
    );
    let status = f.execute(&plan);
    assert_eq!(status.phase, HostedForkPhase::AcceptedPending);
    assert!(status.repository.is_none());
    assert_eq!(
        f.writes[0].1,
        json!({"organization":"owned-org","name":"forked","default_branch_only":false})
    );
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_journals_before_dispatch_and_same_review_never_replays() {
    let mut f = Fixture::new();
    let plan = f.plan();
    let status = f.execute(&plan);
    assert_eq!(status.phase, HostedForkPhase::AcceptedPending);
    assert!(status.server_reply_received);
    assert_eq!(
        f.writes[0].1,
        json!({"name":"forked","default_branch_only":true})
    );
    f.reads.clear();
    assert_eq!(f.execute(&plan).id, status.id);
    assert!(f.reads.is_empty());
    assert_eq!(f.writes.len(), 1);
    let saved = fs::read(f.directory.join(format!("{}.json", plan.id))).unwrap();
    assert!(
        !String::from_utf8(saved)
            .unwrap()
            .contains("private-response-only")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(f.directory.join(format!("{}.json", plan.id)))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let next = f.plan();
    assert_ne!(next.id, plan.id);
    assert_eq!(f.execute(&next).id, plan.id);
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_uncertain_reply_survives_reload_and_blocks_fresh_duplicate() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.write_error = true;
    let status = f.execute(&plan);
    assert_eq!(status.phase, HostedForkPhase::AwaitingConfirmation);
    assert!(!status.server_reply_received);
    assert!(archive_hosted_fork_request(&f.directory, &plan.id).is_err());
    let restored = list_hosted_fork_requests(&f.directory).unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, status.id);
    let next = f.plan();
    assert_eq!(f.execute(&next).id, status.id);
    assert_eq!(f.writes.len(), 1);
    let confirmed = f.reconcile(&status.id);
    assert_eq!(confirmed.phase, HostedForkPhase::Ready);
    assert!(!confirmed.server_reply_received);
    assert_eq!(confirmed.repository.unwrap().id, "9007199254740993");
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_interruption_after_dispatch_boundary_cannot_repeat_post() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.write_panic = true;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.execute(&plan)));
    assert!(result.is_err());
    assert_eq!(
        list_hosted_fork_requests(&f.directory).unwrap()[0].phase,
        HostedForkPhase::AwaitingConfirmation
    );
    assert_eq!(
        f.execute(&plan).phase,
        HostedForkPhase::AwaitingConfirmation
    );
    assert_eq!(f.writes.len(), 1);
    assert_eq!(f.reconcile(&plan.id).phase, HostedForkPhase::Ready);
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_reconciles_async_metadata_and_git_references_without_writes() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.execute(&plan);
    f.fork_unavailable = true;
    let pending = f.reconcile(&plan.id);
    assert_eq!(pending.phase, HostedForkPhase::AcceptedPending);
    assert!(pending.repository.is_none());
    f.fork_unavailable = false;
    f.reference_unavailable = true;
    let metadata = f.reconcile(&plan.id);
    assert_eq!(metadata.phase, HostedForkPhase::MetadataAvailable);
    assert!(metadata.head_oid.is_none());
    f.reference_unavailable = false;
    f.object_unavailable = true;
    assert_eq!(
        f.reconcile(&plan.id).phase,
        HostedForkPhase::MetadataAvailable
    );
    f.object_unavailable = false;
    let ready = f.reconcile(&plan.id);
    assert_eq!(ready.phase, HostedForkPhase::Ready);
    assert_eq!(ready.head_oid, Some("a".repeat(40)));
    f.fork_unavailable = true;
    let unavailable = f.reconcile(&plan.id);
    assert_eq!(unavailable.phase, HostedForkPhase::AcceptedPending);
    assert!(unavailable.repository.is_none());
    assert!(unavailable.head_oid.is_none());
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_refuses_changed_bindings_before_dispatch() {
    for field in ["account", "source", "owner", "policy", "expired"] {
        let mut f = Fixture::new();
        let mut plan = f.plan();
        match field {
            "account" => f.actor["id"] = json!(8),
            "source" => f.source["id"] = json!(102),
            "owner" => f.owner["id"] = json!(8),
            "policy" => f.source["allow_forking"] = json!(false),
            "expired" => plan.created = Instant::now() - Duration::from_secs(901),
            _ => unreachable!(),
        }
        let directory = f.directory.clone();
        assert!(
            execute_with(&directory, &plan, &mut f, &CancellationToken::default()).is_err(),
            "accepted {field}"
        );
        assert!(f.writes.is_empty());
        assert!(list_hosted_fork_requests(&directory).unwrap().is_empty());
    }
}

#[test]
fn fork_creation_reconciliation_checks_network_owner_identity_and_exact_git_ref() {
    for (field, value) in [
        ("fork", json!(false)),
        ("owner", json!({"id":8,"login":"owned"})),
        ("source", json!({"id":999,"full_name":"elsewhere/root"})),
        ("parent", Value::Null),
        ("disabled", json!(true)),
    ] {
        let mut f = Fixture::new();
        let plan = f.plan();
        f.execute(&plan);
        f.fork[field] = value;
        assert_eq!(
            f.reconcile(&plan.id).phase,
            HostedForkPhase::Conflict,
            "accepted {field}"
        );
        assert_eq!(f.writes.len(), 1);
    }
    for reference in [
        json!({"ref":"refs/heads/other","object":{"type":"commit","sha":"a".repeat(40)}}),
        json!({"ref":"refs/heads/feature/review","object":{"type":"tag","sha":"a".repeat(40)}}),
        json!({"ref":"refs/heads/feature/review","object":{"type":"commit","sha":"invalid"}}),
    ] {
        let mut f = Fixture::new();
        let plan = f.plan();
        f.execute(&plan);
        f.reference = reference;
        assert_eq!(
            f.reconcile(&plan.id).phase,
            HostedForkPhase::MetadataAvailable
        );
    }
}

#[test]
fn fork_creation_policy_changes_do_not_prevent_read_only_recovery() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.execute(&plan);
    f.source["allow_forking"] = json!(false);
    assert_eq!(f.reconcile(&plan.id).phase, HostedForkPhase::Ready);
    assert_eq!(f.writes.len(), 1);
    f.actor["id"] = json!(8);
    let directory = f.directory.clone();
    let before = fs::read(directory.join(format!("{}.json", plan.id))).unwrap();
    assert!(reconcile_with(&directory, &plan.id, &mut f, &CancellationToken::default()).is_err());
    assert_eq!(
        fs::read(directory.join(format!("{}.json", plan.id))).unwrap(),
        before
    );
}

#[test]
fn fork_creation_archive_retains_outcome_and_cannot_reactivate_old_review() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.execute(&plan);
    f.reconcile(&plan.id);
    archive_hosted_fork_request(&f.directory, &plan.id).unwrap();
    assert!(list_hosted_fork_requests(&f.directory).unwrap().is_empty());
    assert!(
        f.directory
            .join("archive")
            .join(format!("{}.json", plan.id))
            .is_file()
    );
    assert_eq!(f.execute(&plan).phase, HostedForkPhase::Ready);
    assert_eq!(
        execute_hosted_fork(&f.directory, &plan, &CancellationToken::default())
            .unwrap()
            .phase,
        HostedForkPhase::Ready
    );
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_cancel_lock_and_corrupt_records_never_dispatch() {
    let mut f = Fixture::new();
    let plan = f.plan();
    let directory = f.directory.clone();
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    assert_eq!(
        execute_with(&directory, &plan, &mut f, &cancellation)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    let held = Store::open(&directory).unwrap();
    assert!(execute_with(&directory, &plan, &mut f, &CancellationToken::default()).is_err());
    drop(held);
    fs::write(
        directory.join(format!("{}.json", plan.id)),
        b"interrupted journal write",
    )
    .unwrap();
    assert!(execute_with(&directory, &plan, &mut f, &CancellationToken::default()).is_err());
    assert!(f.writes.is_empty());
    assert!(reconcile_hosted_fork(&directory, "../outside", &cancellation).is_err());
    assert_eq!(
        prepare_hosted_fork(&f.request(), &cancellation)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
}

#[test]
fn fork_creation_retains_first_verified_id_across_unavailability_and_replacement() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.execute(&plan);
    let ready = f.reconcile(&plan.id);
    assert_eq!(
        ready.observed_repository_id.as_deref(),
        Some("9007199254740993")
    );
    f.fork_unavailable = true;
    assert_eq!(
        f.reconcile(&plan.id).observed_repository_id,
        ready.observed_repository_id
    );
    f.fork_unavailable = false;
    f.fork["id"] = json!(9007199254740994u64);
    for _ in 0..2 {
        let replaced = f.reconcile(&plan.id);
        assert_eq!(replaced.phase, HostedForkPhase::Conflict);
        assert_eq!(
            replaced.observed_repository_id,
            ready.observed_repository_id
        );
        assert!(replaced.repository.is_none());
    }
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_malformed_metadata_clears_ready_without_inventing_absence() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.execute(&plan);
    f.reconcile(&plan.id);
    f.fork["clone_url"] = json!("https://elsewhere.test/never-use.git");
    let status = f.reconcile(&plan.id);
    assert_eq!(status.phase, HostedForkPhase::AcceptedPending);
    assert!(status.repository.is_none());
    assert!(status.head_oid.is_none());
    let saved = fs::read_to_string(f.directory.join(format!("{}.json", plan.id))).unwrap();
    assert!(!saved.contains("elsewhere.test"));
    assert!(!saved.contains("private response metadata"));
    assert_eq!(f.writes.len(), 1);
}

#[test]
fn fork_creation_interrupted_archive_keeps_non_replaying_record_and_can_finish() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.execute(&plan);
    f.reconcile(&plan.id);
    // Model the crash boundary after retaining a second name and before
    // unlinking the active name. Recovery must preserve the original outcome.
    let archive = f.directory.join("archive");
    fs::create_dir(&archive).unwrap();
    fs::hard_link(
        f.directory.join(format!("{}.json", plan.id)),
        archive.join(format!("{}.json", plan.id)),
    )
    .unwrap();
    archive_hosted_fork_request(&f.directory, &plan.id).unwrap();
    assert!(list_hosted_fork_requests(&f.directory).unwrap().is_empty());
    assert_eq!(f.execute(&plan).phase, HostedForkPhase::Ready);
    assert_eq!(f.writes.len(), 1);
}

#[test]
#[cfg(unix)]
fn fork_creation_lock_releases_even_while_an_owned_child_holds_a_duplicate() {
    use std::process::{Command, Stdio};
    let f = Fixture::new();
    let held = Store::open(&f.directory).unwrap();
    let gate = f.directory.join("release-owned-lock-child");
    let mut child = Command::new("sh")
        .args([
            "-c",
            "while [ ! -f \"$1\" ]; do sleep 0.02; done",
            "owned-lock-holder",
        ])
        .arg(&gate)
        .stdin(Stdio::from(held._lock.try_clone().unwrap()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    drop(held);
    let reacquired = Store::open(&f.directory);
    fs::write(&gate, "release").unwrap();
    let result = child.wait().unwrap();
    assert!(result.success());
    assert!(
        reacquired.is_ok(),
        "A duplicated child descriptor retained the finished request's lock"
    );
}

#[test]
fn fork_creation_explicit_acknowledgement_retains_unknown_outcome_and_needs_new_review() {
    let mut f = Fixture::new();
    let plan = f.plan();
    f.write_error = true;
    let unresolved = f.execute(&plan);
    let mut changed = unresolved.clone();
    changed.notice = Some("unreviewed replacement".into());
    assert!(acknowledge_hosted_fork_request(&f.directory, &changed).is_err());
    acknowledge_hosted_fork_request(&f.directory, &unresolved).unwrap();
    acknowledge_hosted_fork_request(&f.directory, &unresolved).unwrap();
    assert!(list_hosted_fork_requests(&f.directory).unwrap().is_empty());
    assert_eq!(
        load_hosted_fork_request(&f.directory, &plan.id).unwrap(),
        unresolved
    );
    assert_eq!(f.execute(&plan), unresolved);
    assert_eq!(f.writes.len(), 1);
    f.write_error = false;
    let new_review = f.plan();
    assert_ne!(new_review.id, plan.id);
    assert_eq!(
        f.execute(&new_review).phase,
        HostedForkPhase::AcceptedPending
    );
    assert_eq!(f.writes.len(), 2);
}

#[test]
fn fork_creation_stale_acknowledgement_cannot_retire_newly_reconciled_outcome() {
    let mut f = Fixture::new();
    let plan = f.plan();
    let pending = f.execute(&plan);
    let ready = f.reconcile(&plan.id);
    assert_ne!(pending, ready);
    assert!(acknowledge_hosted_fork_request(&f.directory, &pending).is_err());
    assert_eq!(
        list_hosted_fork_requests(&f.directory).unwrap(),
        vec![ready]
    );
    assert_eq!(f.writes.len(), 1);
}

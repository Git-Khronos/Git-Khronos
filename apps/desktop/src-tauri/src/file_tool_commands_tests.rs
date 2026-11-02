use super::*;
#[test]
fn file_tool_commands_main_window_boundary_refuses_auxiliary_and_unknown_labels() {
    main_label("main").unwrap();
    for label in ["", "preview", "authentication", "main-other"] {
        assert!(main_label(label).is_err());
    }
}
#[test]
fn file_tool_commands_strict_launch_and_execution_data_never_accept_renderer_argv_or_storage_authority()
 {
    let prepare = serde_json::json!({"repoId":"owned","contextId":"context","request":{"kind":"editor","path":"file.txt","line":1},"profile":{"version":1,"id":"owned","name":"Owned program","role":"editor","executable":"/usr/bin/true","arguments":["{file}"]},"operationId":"operation"});
    serde_json::from_value::<PrepareFileToolLaunchRequest>(prepare.clone()).unwrap();
    for key in ["root", "argv", "snapshotParent", "uid"] {
        let mut forged = prepare.clone();
        forged[key] = serde_json::json!("forged");
        assert!(serde_json::from_value::<PrepareFileToolLaunchRequest>(forged).is_err());
    }
    let mut forged = prepare;
    forged["request"]["root"] = serde_json::json!("/other");
    assert!(serde_json::from_value::<PrepareFileToolLaunchRequest>(forged).is_err());
    let execution =
        serde_json::json!({"contextId":"context","token":"a".repeat(32),"operationId":"operation"});
    serde_json::from_value::<ExecuteFileToolReviewRequest>(execution.clone()).unwrap();
    for key in ["plan", "profile", "path", "argv", "sessionId"] {
        let mut forged = execution.clone();
        forged[key] = serde_json::json!("forged");
        assert!(serde_json::from_value::<ExecuteFileToolReviewRequest>(forged).is_err());
    }
}
#[test]
fn file_tool_commands_save_cleanup_acknowledgements_and_review_purpose_are_explicit_and_strict() {
    let execution =
        serde_json::json!({"contextId":"context","token":"a".repeat(32),"operationId":"operation"});
    assert!(serde_json::from_value::<SaveFileToolResultRequest>(execution.clone()).is_err());
    assert!(serde_json::from_value::<DiscardFileToolSessionRequest>(execution.clone()).is_err());
    let mut save = execution.clone();
    save["finishedEditing"] = serde_json::json!(true);
    serde_json::from_value::<SaveFileToolResultRequest>(save.clone()).unwrap();
    save["bytes"] = serde_json::json!([1, 2]);
    assert!(serde_json::from_value::<SaveFileToolResultRequest>(save).is_err());
    let mut cleanup = execution;
    cleanup["finishedUsingFiles"] = serde_json::json!(true);
    serde_json::from_value::<DiscardFileToolSessionRequest>(cleanup.clone()).unwrap();
    cleanup["path"] = serde_json::json!("/other");
    assert!(serde_json::from_value::<DiscardFileToolSessionRequest>(cleanup).is_err());
    let unknown =
        serde_json::json!({"contextId":"context","token":"a".repeat(32),"purpose":"unknown"});
    assert!(serde_json::from_value::<DiscardFileToolReviewRequest>(unknown).is_err());
}

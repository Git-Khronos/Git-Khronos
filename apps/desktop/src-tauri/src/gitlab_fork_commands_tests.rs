use super::*;
use serde_json::json;

#[test]
fn gitlab_namespace_inspection_accepts_only_connection_bound_identity_without_write_authority() {
    let request = json!({"connectionId":"a".repeat(32),"operationId":"owned-namespace-inspect",
        "selection":{"id":"9007199254740993","fullPath":"team/nested","kind":"group"}});
    assert!(serde_json::from_value::<GitLabInspectNamespaceRequest>(request.clone()).is_ok());
    for field in ["canCreateProject", "token", "endpoint", "origin", "account"] {
        let mut invalid = request.clone();
        invalid["selection"][field] = json!("forged");
        assert!(serde_json::from_value::<GitLabInspectNamespaceRequest>(invalid).is_err());
        let mut invalid = request.clone();
        invalid[field] = json!("forged");
        assert!(serde_json::from_value::<GitLabInspectNamespaceRequest>(invalid).is_err());
    }
    for field in ["connectionId", "operationId", "selection"] {
        let mut invalid = request.clone();
        invalid.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<GitLabInspectNamespaceRequest>(invalid).is_err());
    }
    for (field, value) in [
        ("id", json!(9007199254740993_u64)),
        ("kind", json!("future")),
    ] {
        let mut invalid = request.clone();
        invalid["selection"][field] = value;
        assert!(serde_json::from_value::<GitLabInspectNamespaceRequest>(invalid).is_err());
    }
}

#[test]
fn gitlab_fork_commands_reject_unbound_credentials_endpoints_and_forged_relationships() {
    let query =
        json!({"sourceProjectId":"10","sourceFullPath":"team/upstream","page":1,"search":"owned"});
    let request = json!({"connectionId":"a".repeat(32),"operationId":"owned-read","query":query});
    assert!(serde_json::from_value::<GitLabForksRequest>(request.clone()).is_ok());
    for (key, value) in [
        ("token", json!("forged")),
        ("origin", json!("https://other.test")),
        ("endpoint", json!("other/resource")),
        ("expectedAccount", json!({"id":"other"})),
    ] {
        let mut invalid = request.clone();
        invalid[key] = value;
        assert!(serde_json::from_value::<GitLabForksRequest>(invalid).is_err());
    }
    let mut invalid = request;
    invalid["query"]["forkedFromProject"] = json!({"id":"10"});
    assert!(serde_json::from_value::<GitLabForksRequest>(invalid).is_err());
}

#[test]
fn gitlab_fork_commands_require_native_connection_and_project_selection_without_transport_authority()
 {
    let request = json!({"connectionId":"a".repeat(32),"operationId":"owned-inspect","selection":{
        "sourceProjectId":"10","sourceFullPath":"team/upstream","forkProjectId":"20","forkFullPath":"group/owned"}});
    assert!(serde_json::from_value::<GitLabInspectForkRequest>(request.clone()).is_ok());
    let mut invalid = request.clone();
    invalid.as_object_mut().unwrap().remove("connectionId");
    assert!(serde_json::from_value::<GitLabInspectForkRequest>(invalid).is_err());
    for key in [
        "cloneHttps",
        "cloneSsh",
        "namespaceId",
        "importState",
        "repositoryPath",
    ] {
        let mut invalid = request.clone();
        invalid["selection"][key] = json!("forged");
        assert!(serde_json::from_value::<GitLabInspectForkRequest>(invalid).is_err());
    }
    assert!(serde_json::from_value::<GitLabNamespacesRequest>(json!({"connectionId":"a".repeat(32),"operationId":"owned-list","query":{"page":1,"canWrite":true}})).is_err());
    assert!(main_label("main").is_ok());
    for label in ["", "auth", "preferences", "main-other"] {
        assert!(main_label(label).is_err());
    }
}

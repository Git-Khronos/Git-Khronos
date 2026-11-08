use super::*;
use std::process::Command;

const REMOTE: &str = "https://example.test/owned/project.git";

#[test]
fn repository_links_round_trip_all_targets_and_literal_plus_unicode_percent() {
    for target in [
        RepositoryLinkTarget::Repository {},
        RepositoryLinkTarget::Commit {
            oid: "A".repeat(40),
        },
        RepositoryLinkTarget::Commit {
            oid: "B".repeat(64),
        },
        RepositoryLinkTarget::Reference {
            reference: "refs/heads/feature/雪+%2F".into(),
        },
        RepositoryLinkTarget::Reference {
            reference: "refs/tags/v1.0".into(),
        },
        RepositoryLinkTarget::Reference {
            reference: "refs/remotes/origin/feature".into(),
        },
    ] {
        let link = create_repository_link(REMOTE, &target).unwrap();
        assert!(link.is_ascii());
        let parsed = parse_repository_link(&link).unwrap();
        assert_eq!(parsed.remote(), REMOTE);
        let expected = match target {
            RepositoryLinkTarget::Commit { oid } => RepositoryLinkTarget::Commit {
                oid: oid.to_ascii_lowercase(),
            },
            other => other,
        };
        assert_eq!(parsed.target(), &expected);
        assert_eq!(
            create_repository_link(parsed.remote(), parsed.target()).unwrap(),
            link
        );
    }
}

#[test]
fn repository_links_reject_ambiguous_malformed_and_executable_inputs() {
    let base = create_repository_link(REMOTE, &RepositoryLinkTarget::Repository {}).unwrap();
    for suffix in [
        "&v=1",
        "&remote=https%3A%2F%2Fevil.test%2Fx",
        "&unknown=1",
        "&ref=HEAD",
        "&commit=HEAD",
        "&commit=--help",
        "&ref=refs%2Fheads%2Fx&commit=",
        "&%76=1",
        "&ref=%FF",
        "&ref=%00",
        "&ref=%0a",
        "&ref=%",
        "&ref=%0",
        "&ref=%GG",
        "&ref=refs%2Fheads%2Fx#fragment",
        "&",
    ] {
        assert!(
            parse_repository_link(&(base.clone() + suffix)).is_err(),
            "{suffix}"
        );
    }
    for invalid in [
        "",
        "git-khronos://repository?v=2&remote=x",
        "git-khronos://repository?v=1",
        "git-khronos://repository/path?v=1&remote=x",
        "https://repository?v=1&remote=x",
        "git-khronos://user@repository?v=1&remote=x",
        "git-khronos://repository:80?v=1&remote=x",
        "git-khronos://repository?v=1&remote=git-khronos%3A%2F%2Frepository",
        "git-khronos://repository?v=1&remote=x\n",
        "git-khronos://repository?v=1&remote=x\t",
    ] {
        assert!(parse_repository_link(invalid).is_err(), "{invalid}");
    }
    assert!(parse_repository_link(&(base + &"x".repeat(MAX_LINK_BYTES))).is_err());
}

#[test]
fn repository_links_remote_validation_never_returns_credentials_or_executable_transports() {
    for remote in [
        "file:///owned/project",
        "/owned/project",
        "../project",
        "host:project",
        "ext::owned-helper",
        "javascript:alert(1)",
        "https:example.test/project",
        "https://example.test",
        "https://example.test/",
        "https://example.test/a/../b",
        "https://example.test/a/%2E%2E/b",
        "https://example.test/a/%00b",
        "https://example.test/a/%GG",
        "https://example.test/a\\b",
        "https://example.test/a b",
        "https://user@example.test/project",
        "https://@example.test/project",
        "https://user:owned-secret@example.test/project",
        "https://example.test/project?token=owned-secret",
        "ssh://git:owned-secret@example.test/project",
        "ssh://example.test/project",
        "ssh://git@exa%0ample.test/project",
        "ssh://git%40evil@example.test/project",
        "https://example.test/project#token",
        "https://example.test/project\n",
    ] {
        let error = repository_link_remote_identity(remote).unwrap_err();
        assert_eq!(error.kind, "invalidRepositoryLink");
        assert!(!format!("{error:?}").contains("owned-secret"));
    }
}

#[test]
fn repository_links_normalize_only_defined_host_and_default_port_properties() {
    assert_eq!(
        repository_link_remote_identity("HTTPS://EXAMPLE.TEST:443/Owner/Repo.git").unwrap(),
        "https://example.test/Owner/Repo.git"
    );
    assert_eq!(
        repository_link_remote_identity("ssh://git@EXAMPLE.TEST:22/Owner/Repo.git").unwrap(),
        "ssh://git@example.test/Owner/Repo.git"
    );
    let remotes = [
        REMOTE,
        "https://example.test/Owned/project.git",
        "https://elsewhere.test/owned/project.git",
        "ssh://git@example.test/owned/project.git",
        "ssh://alice@example.test/owned/project.git",
        "ssh://git@example.test:2222/owned/project.git",
        "https://example.test:444/owned/project.git",
    ];
    let identities: std::collections::HashSet<_> = remotes
        .iter()
        .map(|remote| repository_link_remote_identity(remote).unwrap())
        .collect();
    assert_eq!(identities.len(), remotes.len());
    assert!(repository_link_remote_identity("ssh://git@[::1]:22/owned/project.git").is_ok());
}

#[test]
fn repository_links_ref_rules_match_independent_git_oracle_for_supported_namespaces() {
    for reference in [
        "refs/heads/main",
        "refs/tags/v1.0",
        "refs/remotes/origin/main",
        "refs/heads/雪+%2f",
        "refs/heads/-literal",
        "refs/heads/x..y",
        "refs/heads/.x",
        "refs/heads/x.lock",
        "refs/heads/x.lock/y",
        "refs/heads/x.",
        "refs/heads/x//y",
        "refs/heads/x/",
        "refs/heads/x@{1}",
        "refs/heads/x~1",
        "refs/heads/x^",
        "refs/heads/x:y",
        "refs/heads/x?",
        "refs/heads/x*",
        "refs/heads/x[",
        "refs/heads/x\\y",
        "refs/heads/x y",
        "refs/heads/x\t",
        "refs/heads/x\u{7f}",
    ] {
        let oracle = Command::new("git")
            .args(["check-ref-format", reference])
            .output()
            .unwrap();
        assert_eq!(
            valid_reference(reference),
            oracle.status.success(),
            "{reference}"
        );
        let generated = create_repository_link(
            REMOTE,
            &RepositoryLinkTarget::Reference {
                reference: reference.into(),
            },
        );
        assert_eq!(generated.is_ok(), oracle.status.success(), "{reference}");
    }
    for unsupported in [
        "HEAD",
        "main",
        "@{-1}",
        "refs/notes/owned",
        "refs/replace/abc",
    ] {
        assert!(!valid_reference(unsupported));
    }
}

#[test]
fn repository_links_generation_refuses_invalid_targets_without_reinterpreting_space_or_oid() {
    for target in [
        RepositoryLinkTarget::Reference {
            reference: "refs/heads/a b".into(),
        },
        RepositoryLinkTarget::Reference {
            reference: "refs/heads/x\0".into(),
        },
        RepositoryLinkTarget::Commit { oid: "HEAD".into() },
        RepositoryLinkTarget::Commit {
            oid: "g".repeat(40),
        },
    ] {
        assert!(create_repository_link(REMOTE, &target).is_err());
    }
    let long = RepositoryLinkTarget::Reference {
        reference: format!("refs/heads/{}", "雪".repeat(1500)),
    };
    assert!(create_repository_link(REMOTE, &long).is_err());
}

#[test]
fn repository_links_preserve_documented_scp_paths_without_inventing_ssh_url_equivalence() {
    for remote in [
        "git@EXAMPLE.TEST:Owned/repo.git",
        "git@example.test:/Owned/repo.git",
        "git@example.test:~owned/repo.git",
        "git@[::1]:Owned/雪%2F.git",
    ] {
        let identity = repository_link_remote_identity(remote).unwrap();
        let link = create_repository_link(remote, &RepositoryLinkTarget::Repository {}).unwrap();
        assert_eq!(parse_repository_link(&link).unwrap().remote(), identity);
    }
    assert_eq!(
        repository_link_remote_identity("git@EXAMPLE.TEST:Owned/repo.git").unwrap(),
        "git@example.test:Owned/repo.git"
    );
    let identities: std::collections::HashSet<_> = [
        "git@example.test:Owned/repo.git",
        "git@example.test:/Owned/repo.git",
        "ssh://git@example.test/Owned/repo.git",
        "alice@example.test:Owned/repo.git",
    ]
    .iter()
    .map(|v| repository_link_remote_identity(v).unwrap())
    .collect();
    assert_eq!(identities.len(), 4);
    for invalid in [
        "git@host:",
        "git@host:-option",
        "git@host:a/../repo",
        "git@host/path:repo",
        "user:password@host:repo",
        "git@evil@host:repo",
        "git@host:repo?token=secret",
    ] {
        assert!(repository_link_remote_identity(invalid).is_err());
    }
}

#[test]
fn repository_link_target_json_refuses_ambiguous_unknown_fields() {
    for value in [
        serde_json::json!({"kind":"repository","oid":"a".repeat(40)}),
        serde_json::json!({"kind":"commit","oid":"a".repeat(40),"reference":"refs/heads/main"}),
    ] {
        assert!(serde_json::from_value::<RepositoryLinkTarget>(value).is_err());
    }
}

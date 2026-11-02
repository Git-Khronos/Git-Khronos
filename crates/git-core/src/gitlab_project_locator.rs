//! Closed project-detail routes for the documented namespace/project slug form.
//! Display names are unrelated to slugs; no renderer-supplied URL is accepted.
use crate::AppError;

fn valid(value: &str) -> bool {
    value.len() <= 4096
        && value.contains('/')
        && value.split('/').all(|part| {
            !part.is_empty()
                && !matches!(part, "." | "..")
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        })
}
pub(crate) fn project_path_endpoint(full_path: &str) -> Result<String, AppError> {
    if !valid(full_path) {
        return Err(AppError::new(
            "gitlabProjectLocator",
            "The saved destination cannot be represented as a GitLab project slug.",
            None,
        ));
    }
    Ok(format!("projects/{}", full_path.replace('/', "%2F")))
}
pub(crate) fn canonical_project_path_route(route: &str) -> bool {
    route.strip_prefix("projects/").is_some_and(|encoded| {
        if encoded.len() > 4096 * 3 {
            return false;
        }
        let decoded = encoded.replace("%2F", "/");
        project_path_endpoint(&decoded).is_ok_and(|canonical| canonical == route)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_locator_encodes_nested_slug_as_one_component_without_normalization() {
        assert_eq!(
            project_path_endpoint("Team-1/sub.group/project_name").unwrap(),
            "projects/Team-1%2Fsub.group%2Fproject_name"
        );
        assert!(canonical_project_path_route(
            "projects/Team-1%2Fsub.group%2Fproject_name"
        ));
    }
    #[test]
    fn project_locator_refuses_extra_routes_encoded_aliases_and_double_decoding() {
        for route in [
            "projects/101",
            "projects/team/repo",
            "projects/team%2frepo",
            "projects/team%2Frepo/forks",
            "projects/team%252Frepo",
            "projects/team%2F%2E%2E%2Fuser",
            "projects/team%2F..%2Fuser",
            "projects/team%2Frepo?token=other",
            "projects/team%2Frepo#fragment",
            "projects/%74eam%2Frepo",
        ] {
            assert!(!canonical_project_path_route(route), "{route}");
        }
        for path in [
            "",
            "team",
            "../team/repo",
            "team//repo",
            "team/./repo",
            "team/%2e%2e/repo",
            "team/repo?query",
            "team/repo#fragment",
            "team/repo\\other",
            "team/repo\n",
            "team/repo name",
        ] {
            assert!(project_path_endpoint(path).is_err(), "{path:?}");
        }
        assert!(project_path_endpoint(&format!("team/{}", "a".repeat(4096))).is_err());
    }
}

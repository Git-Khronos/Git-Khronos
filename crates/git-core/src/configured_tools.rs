//! Original, versioned tool profiles and literal argv rendering.
//! This module does not execute programs or authorize filesystem paths.
use super::*;
use std::collections::BTreeSet;

const MAX_ARGUMENTS: usize = 32;
const MAX_ARGUMENT_BYTES: usize = 16 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ToolRole {
    Editor,
    Diff,
    Merge,
    Terminal,
    Agent,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolProfile {
    pub version: u8,
    pub id: String,
    pub name: String,
    pub role: ToolRole,
    pub executable: String,
    pub arguments: Vec<String>,
}
impl std::fmt::Debug for ToolProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolProfile")
            .field("role", &self.role)
            .field("argument_count", &self.arguments.len())
            .finish_non_exhaustive()
    }
}

/// Literal rendering values, deliberately not deserializable. A future native
/// launcher must derive and validate these from its captured repository/file
/// context. Expanding arguments alone is not execution authorization.
#[derive(Default)]
pub struct ToolArgumentContext {
    pub repository: PathBuf,
    pub file: Option<PathBuf>,
    pub line: Option<u32>,
    pub before: Option<PathBuf>,
    pub after: Option<PathBuf>,
    pub base: Option<PathBuf>,
    pub merged: Option<PathBuf>,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Placeholder {
    Repository,
    File,
    Line,
    Before,
    After,
    Base,
    Merged,
}
fn invalid(message: &str) -> AppError {
    AppError::new(
        "invalidToolProfile",
        message,
        Some("Review the selected executable and each separate argument. No program was started."),
    )
}
impl Placeholder {
    fn parse(name: &str) -> Result<Self, AppError> {
        match name {
            "repository" => Ok(Self::Repository),
            "file" => Ok(Self::File),
            "line" => Ok(Self::Line),
            "before" => Ok(Self::Before),
            "after" => Ok(Self::After),
            "base" => Ok(Self::Base),
            "merged" => Ok(Self::Merged),
            _ => Err(invalid("An argument contains an unsupported placeholder.")),
        }
    }
    fn allowed(self, role: ToolRole) -> bool {
        match self {
            Self::Repository => true,
            Self::File | Self::Line => role == ToolRole::Editor,
            Self::Before | Self::After => matches!(role, ToolRole::Diff | ToolRole::Merge),
            Self::Base | Self::Merged => role == ToolRole::Merge,
        }
    }
    fn value(self, context: &ToolArgumentContext) -> Result<String, AppError> {
        let path = match self {
            Self::Repository => Some(&context.repository),
            Self::File => context.file.as_ref(),
            Self::Before => context.before.as_ref(),
            Self::After => context.after.as_ref(),
            Self::Base => context.base.as_ref(),
            Self::Merged => context.merged.as_ref(),
            Self::Line => {
                return context
                    .line
                    .filter(|line| *line > 0)
                    .map(|line| line.to_string())
                    .ok_or_else(|| {
                        invalid("This argument requires an available one-based line number.")
                    });
            }
        }
        .ok_or_else(|| invalid("An argument requires a file role unavailable in this context."))?;
        literal_path(path)
    }
}
fn literal_path(path: &Path) -> Result<String, AppError> {
    let text = path
        .to_str()
        .ok_or_else(|| invalid("A tool path cannot be represented as UTF-8."))?;
    if !path.is_absolute() || text.contains('\0') || text.len() > MAX_ARGUMENT_BYTES {
        return Err(invalid(
            "Tool context paths must be bounded absolute paths without NUL bytes.",
        ));
    }
    Ok(text.into())
}
fn render(
    template: &str,
    mut value: impl FnMut(Placeholder) -> Result<String, AppError>,
) -> Result<String, AppError> {
    let mut output = String::new();
    let mut chars = template.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '{' if chars.peek() == Some(&'{') => {
                chars.next();
                output.push('{');
            }
            '}' if chars.peek() == Some(&'}') => {
                chars.next();
                output.push('}');
            }
            '{' => {
                let mut name = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(c) if c.is_ascii_lowercase() && name.len() < 16 => name.push(c),
                        _ => {
                            return Err(invalid(
                                "An argument placeholder is incomplete or malformed.",
                            ));
                        }
                    }
                }
                output.push_str(&value(Placeholder::parse(&name)?)?);
            }
            '}' => {
                return Err(invalid(
                    "Use doubled braces for literal braces in tool arguments.",
                ));
            }
            c => output.push(c),
        }
        if output.len() > MAX_ARGUMENT_BYTES {
            return Err(invalid("An expanded tool argument exceeds the size limit."));
        }
    }
    Ok(output)
}
impl ToolProfile {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.version != 1
            || self.id.is_empty()
            || self.id.len() > 64
            || !self
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
        {
            return Err(invalid(
                "Choose a supported profile version and stable profile identifier.",
            ));
        }
        if self.name.trim().is_empty()
            || self.name.len() > 128
            || self.name.chars().any(char::is_control)
        {
            return Err(invalid(
                "Choose a nonempty tool name within the display limit.",
            ));
        }
        literal_path(Path::new(&self.executable))?;
        if self.arguments.len() > MAX_ARGUMENTS
            || self.arguments.iter().map(String::len).sum::<usize>() > MAX_TOTAL_ARGUMENT_BYTES
        {
            return Err(invalid(
                "The tool profile has too many arguments or exceeds the total size limit.",
            ));
        }
        let mut used = BTreeSet::new();
        for argument in &self.arguments {
            if argument.contains('\0') || argument.len() > MAX_ARGUMENT_BYTES {
                return Err(invalid(
                    "Tool arguments must be bounded text without NUL bytes.",
                ));
            }
            render(argument, |placeholder| {
                if !placeholder.allowed(self.role) {
                    return Err(invalid(
                        "An argument placeholder is not available for this tool role.",
                    ));
                }
                used.insert(placeholder);
                Ok(String::new())
            })?;
        }
        let required: &[Placeholder] = match self.role {
            ToolRole::Editor => &[Placeholder::File],
            ToolRole::Diff => &[Placeholder::Before, Placeholder::After],
            ToolRole::Merge => &[Placeholder::Merged],
            ToolRole::Terminal | ToolRole::Agent => &[],
        };
        if !required.iter().all(|value| used.contains(value)) {
            return Err(invalid(
                "The tool arguments omit a required file role. Editors need {file}, diffs need {before} and {after}, and merge tools need {merged}.",
            ));
        }
        Ok(())
    }
    /// Produces a literal argv vector. It neither resolves executable availability
    /// nor follows/authorizes paths, starts a process, or changes Git configuration.
    pub fn expanded_arguments(
        &self,
        context: &ToolArgumentContext,
    ) -> Result<Vec<String>, AppError> {
        self.validate()?;
        literal_path(&context.repository)?;
        let mut total = 0;
        self.arguments
            .iter()
            .map(|argument| {
                let expanded = render(argument, |placeholder| placeholder.value(context))?;
                total += expanded.len();
                if total > MAX_TOTAL_ARGUMENT_BYTES {
                    return Err(invalid(
                        "Expanded tool arguments exceed the total size limit.",
                    ));
                }
                Ok(expanded)
            })
            .collect()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn profile(role: ToolRole, arguments: &[&str]) -> ToolProfile {
        ToolProfile {
            version: 1,
            id: "owned-profile".into(),
            name: "Owned tool".into(),
            role,
            executable: "/owned/tool program".into(),
            arguments: arguments.iter().map(|x| (*x).into()).collect(),
        }
    }
    fn context() -> ToolArgumentContext {
        ToolArgumentContext {
            repository: "/owned/repository [x]".into(),
            file: Some("/owned/repository [x]/é 'quoted';$(literal){repository}.txt".into()),
            line: Some(42),
            before: Some("/owned/snapshot before".into()),
            after: Some("/owned/snapshot after".into()),
            base: None,
            merged: Some("/owned/merge output".into()),
        }
    }
    #[test]
    fn configured_tools_preserve_literal_argument_boundaries_without_recursive_expansion() {
        let p = profile(
            ToolRole::Editor,
            &["--goto", "{file}:{line}", "", "{repository}", "{{literal}}"],
        );
        let values = p.expanded_arguments(&context()).unwrap();
        assert_eq!(
            values,
            [
                "--goto",
                "/owned/repository [x]/é 'quoted';$(literal){repository}.txt:42",
                "",
                "/owned/repository [x]",
                "{literal}"
            ]
        );
    }
    #[test]
    fn configured_tools_require_explicit_compatible_file_roles() {
        assert!(profile(ToolRole::Editor, &["{{file}}"]).validate().is_err());
        assert!(profile(ToolRole::Diff, &["{before}"]).validate().is_err());
        assert!(
            profile(ToolRole::Terminal, &["{merged}"])
                .validate()
                .is_err()
        );
        assert!(
            profile(ToolRole::Merge, &["{merged}", "{before}", "{after}"])
                .validate()
                .is_ok()
        );
        assert!(
            profile(ToolRole::Agent, &["--project={repository}"])
                .validate()
                .is_ok()
        );
    }
    #[test]
    fn configured_tools_refuse_unknown_or_unbalanced_placeholders_and_nuls() {
        for value in [
            "{unknown}",
            "{file",
            "file}",
            "{file\0}",
            "{file}{nested{file}}",
        ] {
            assert!(
                profile(ToolRole::Editor, &[value]).validate().is_err(),
                "{value:?}"
            );
        }
    }
    #[test]
    fn configured_tools_missing_base_or_line_never_silently_drops_an_argument() {
        assert!(
            profile(ToolRole::Merge, &["{base}", "{merged}"])
                .expanded_arguments(&context())
                .is_err()
        );
        let mut values = context();
        values.line = Some(0);
        assert!(
            profile(ToolRole::Editor, &["{file}:{line}"])
                .expanded_arguments(&values)
                .is_err()
        );
        values.line = None;
        assert!(
            profile(ToolRole::Editor, &["{file}:{line}"])
                .expanded_arguments(&values)
                .is_err()
        );
    }
    #[test]
    fn configured_tools_bound_both_templates_and_expanded_bytes() {
        assert!(
            profile(ToolRole::Agent, &["x"; MAX_ARGUMENTS + 1])
                .validate()
                .is_err()
        );
        let mut p = profile(ToolRole::Editor, &["{file}"]);
        p.arguments.push("x".repeat(MAX_ARGUMENT_BYTES + 1));
        assert!(p.validate().is_err());
        p.arguments = vec!["{file}".repeat(10)];
        let mut values = context();
        values.file = Some(PathBuf::from(format!(
            "/{}",
            "x".repeat(MAX_ARGUMENT_BYTES / 2)
        )));
        assert!(p.expanded_arguments(&values).is_err());
    }
    #[test]
    fn configured_tools_are_versioned_strict_data_and_debug_omits_private_values() {
        let p = profile(ToolRole::Editor, &["{file}", "owned-private-argument"]);
        let encoded = serde_json::to_value(&p).unwrap();
        assert!(serde_json::from_value::<ToolProfile>(encoded.clone()).is_ok());
        let mut extra = encoded;
        extra["shell"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ToolProfile>(extra).is_err());
        assert!(!format!("{p:?}").contains("owned-private-argument"));
        assert!(!format!("{p:?}").contains("/owned"));
        let mut invalid = p;
        invalid.version = 2;
        assert!(invalid.validate().is_err());
    }
}

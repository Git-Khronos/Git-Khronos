//! Cross-platform display/request models for independently configured file tools.
//! Runtime execution remains platform-qualified separately; these values are not authority.
use super::{AppError, ToolRole};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FileToolSource {
    Revision { oid: String, path: String },
    Index { path: String },
    WorkingTree { path: String },
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FileToolRequest {
    Editor {
        path: String,
        line: Option<u32>,
    },
    Diff {
        before: FileToolSource,
        after: FileToolSource,
    },
    Comparison {
        request: super::FileComparisonRequest,
    },
    Merge {
        path: String,
    },
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolSideReview {
    pub role: String,
    pub path: String,
    pub kind: String,
    pub bytes: u64,
    pub oid: Option<String>,
}
#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolLaunchReview {
    pub profile_id: String,
    pub profile_name: String,
    pub role: ToolRole,
    pub executable: String,
    pub arguments: Vec<String>,
    pub repository_path: String,
    pub sides: Vec<FileToolSideReview>,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolMergeWriteResult {
    pub status: super::WorkingFileWriteStatus,
    pub warning: Option<String>,
    pub can_review_staging: bool,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolMergeStageResult {
    pub confirmed: bool,
    pub error: Option<AppError>,
    pub warning: Option<String>,
}
#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolCleanupReview {
    pub copy_directory: Option<String>,
    pub sides: Vec<FileToolSideReview>,
    pub output_bytes: Option<u64>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileToolProcessState {
    Running,
    Exited,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileToolProcessStatus {
    pub state: FileToolProcessState,
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub success: Option<bool>,
    pub cancellation_requested: bool,
}

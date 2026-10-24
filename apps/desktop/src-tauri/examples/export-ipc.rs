//! Development-only code generation, excluded from distributable binary targets.
use specta_typescript::{BigIntExportBehavior, Typescript};

fn main() {
    let output = git_khronos_desktop::ipc_registry()
        // Existing JSON counters use numbers, not strings or JS bigint. The
        // renderer transport rejects unsafe integers before delivering payloads.
        .export_str(Typescript::default().bigint(BigIntExportBehavior::Number))
        .expect("export the native IPC contract");
    print!("{output}");
}

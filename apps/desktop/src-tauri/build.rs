fn main() {
    println!("cargo:rerun-if-env-changed=GIT_KHRONOS_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=GIT_KHRONOS_BUILD_INPUT_ID");
    tauri_build::build()
}

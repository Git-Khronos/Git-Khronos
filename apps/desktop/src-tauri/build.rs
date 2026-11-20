fn main() {
    println!("cargo:rerun-if-env-changed=GIT_KHRONOS_UPDATER_PUBLIC_KEY");
    tauri_build::build()
}

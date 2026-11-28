fn main() {
    #[cfg(target_os = "linux")]
    if let Some(code) = git_khronos_desktop::update_authorization_terminal_entry() {
        std::process::exit(code);
    }
    if let Some(code) = git_khronos_git_core::authentication::helper_entry() {
        std::process::exit(code);
    }
    git_khronos_desktop::run();
}

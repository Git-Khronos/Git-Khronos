fn main() {
    if let Some(code) = git_khronos_git_core::authentication::helper_entry() {
        std::process::exit(code);
    }
    git_khronos_desktop::run();
}

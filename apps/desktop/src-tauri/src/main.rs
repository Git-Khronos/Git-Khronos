fn main() {
    if let Some(code) = git_chronos_git_core::authentication::helper_entry() {
        std::process::exit(code);
    }
    git_chronos_desktop::run();
}

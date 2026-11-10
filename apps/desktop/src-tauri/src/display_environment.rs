//! Window-environment adjustments for WSLg.
//!
/// A close-only layout targeted by the experimental WSL adjustment.
#[cfg(target_os = "linux")]
const GTK_FALLBACK_DECORATION_LAYOUT: &str = "menu:close";
#[cfg(target_os = "linux")]
const WSL_DECORATION_LAYOUT: &str = "menu:minimize,maximize,close";

pub fn running_under_wsl() -> bool {
    #[cfg(target_os = "linux")]
    {
        let env_set = |name: &str| std::env::var_os(name).is_some_and(|value| !value.is_empty());
        env_set("WSL_DISTRO_NAME")
            || env_set("WSL_INTEROP")
            || std::fs::read_to_string("/proc/sys/kernel/osrelease")
                .is_ok_and(|release| kernel_release_is_wsl(&release))
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn kernel_release_is_wsl(release: &str) -> bool {
    release.to_ascii_lowercase().contains("microsoft")
}

/// Requests window buttons under WSL without changing other reported layouts.
#[cfg(target_os = "linux")]
pub fn show_wsl_window_buttons() {
    use gtk::prelude::GtkSettingsExt;

    if !running_under_wsl() {
        return;
    }
    let Some(settings) = gtk::Settings::default() else {
        return;
    };
    let layout = settings.gtk_decoration_layout();
    if needs_window_buttons(layout.as_deref()) {
        settings.set_gtk_decoration_layout(Some(WSL_DECORATION_LAYOUT));
    }
}

#[cfg(target_os = "linux")]
fn needs_window_buttons(layout: Option<&str>) -> bool {
    layout.is_none_or(|layout| layout.trim().is_empty() || layout == GTK_FALLBACK_DECORATION_LAYOUT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_wsl_kernel_releases() {
        assert!(kernel_release_is_wsl("6.6.87.2-microsoft-standard-WSL2\n"));
        assert!(kernel_release_is_wsl("4.4.0-19041-Microsoft"));
        assert!(!kernel_release_is_wsl("7.0.0-42-generic"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn replaces_only_the_gtk_fallback_layout() {
        assert!(needs_window_buttons(None));
        assert!(needs_window_buttons(Some("")));
        assert!(needs_window_buttons(Some("menu:close")));
        assert!(!needs_window_buttons(Some("appmenu:close")));
        assert!(!needs_window_buttons(Some(":minimize,maximize,close")));
    }
}

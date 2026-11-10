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

/// Native title-bar metrics at 100%, in CSS pixels. The bar height includes the
/// theme's fixed vertical padding, which is not scaled.
const CHROME_BAR_HEIGHT: f64 = 36.0;
const CHROME_BAR_PADDING: u32 = 8;
const CHROME_BUTTON_SIZE: f64 = 24.0;
const CHROME_MAX_PERCENT: u32 = 400;

/// GTK style rules that scale the client-side title bar with the interface zoom.
///
/// The web view zoom never reaches toolkit-drawn window chrome, so the same
/// scale is applied to the bar, its buttons, and its title text here.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn window_chrome_css(percent: u32) -> String {
    let scale = f64::from(percent.clamp(100, CHROME_MAX_PERCENT)) / 100.0;
    let px = |base: f64| (base * scale).round() as u32;
    format!(
        "headerbar, .titlebar {{ min-height: {bar}px; }}\n\
         headerbar .title, .titlebar .title {{ font-size: {text}%; }}\n\
         headerbar button.titlebutton, .titlebar button.titlebutton {{ min-width: {button}px; min-height: {button}px; }}\n\
         headerbar button.titlebutton image, .titlebar button.titlebutton image {{ -gtk-icon-transform: scale({scale}); }}\n",
        bar = px(CHROME_BAR_HEIGHT).saturating_sub(CHROME_BAR_PADDING),
        text = (scale * 100.0).round() as u32,
        button = px(CHROME_BUTTON_SIZE),
        scale = scale,
    )
}

/// Applies the window-chrome scale for this process. Call on the GTK main thread.
#[cfg(target_os = "linux")]
pub fn apply_window_chrome_scale(percent: u32) {
    use gtk::prelude::CssProviderExt;
    use std::cell::RefCell;

    thread_local! {
        static PROVIDER: RefCell<Option<gtk::CssProvider>> = const { RefCell::new(None) };
    }

    if !running_under_wsl() {
        return;
    }
    let Some(screen) = gtk::gdk::Screen::default() else {
        return;
    };
    PROVIDER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let provider = slot.get_or_insert_with(|| {
            let provider = gtk::CssProvider::new();
            gtk::StyleContext::add_provider_for_screen(
                &screen,
                &provider,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
            provider
        });
        if let Err(error) = provider.load_from_data(window_chrome_css(percent).as_bytes()) {
            eprintln!("Window chrome scaling was rejected by GTK: {error}");
        }
    });
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

    #[test]
    fn scales_window_chrome_with_the_interface_zoom() {
        let base = window_chrome_css(100);
        assert!(base.contains("min-height: 28px"));
        assert!(base.contains("font-size: 100%"));
        let zoomed = window_chrome_css(130);
        assert!(zoomed.contains("min-height: 39px"));
        assert!(zoomed.contains("min-width: 31px"));
        assert!(zoomed.contains("scale(1.3)"));
        assert!(zoomed.contains("font-size: 130%"));
        assert_eq!(window_chrome_css(50), base);
        assert_eq!(window_chrome_css(9000), window_chrome_css(400));
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

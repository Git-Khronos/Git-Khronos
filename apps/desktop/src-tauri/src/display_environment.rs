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
const CHROME_BUTTON_WIDTH: f64 = 46.0;
// The theme's symbolic glyphs fill only about half of their image box, so the
// The glyph grid is 20 units wide with a 10-unit drawing, so the image box is
// 20px at 100% and the drawn glyph is 10px, scaling together with the zoom.
const CHROME_ICON_SIZE: f64 = 20.0;
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
         headerbar button.titlebutton, .titlebar button.titlebutton {{ min-width: {button_w}px; min-height: {button}px; padding: 0; }}\n\
         ",
        bar = px(CHROME_BAR_HEIGHT).saturating_sub(CHROME_BAR_PADDING),
        text = (scale * 100.0).round() as u32,
        button = px(CHROME_BUTTON_SIZE),
        button_w = px(CHROME_BUTTON_WIDTH),
    )
}

/// Pixel size of the title-bar button glyphs. GTK 3 sizes these images through
/// the widget, not CSS, so the value is applied to the image widgets directly.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn window_chrome_icon_px(percent: u32) -> i32 {
    let scale = f64::from(percent.clamp(100, CHROME_MAX_PERCENT)) / 100.0;
    (CHROME_ICON_SIZE * scale).round() as i32
}

/// Sets the glyph size, and swaps in thin glyphs when available, on every
/// title-bar button image under `widget`. GTK rebuilds these images and swaps
/// the maximize/restore icon on window-state changes, so this stays idempotent.
#[cfg(target_os = "linux")]
fn scale_titlebutton_icons(widget: &gtk::Widget, in_button: bool, pixels: i32, thin: bool) -> usize {
    use gtk::prelude::*;

    let in_button = in_button || widget.style_context().has_class("titlebutton");
    let mut updated = 0;
    if in_button && let Some(image) = widget.downcast_ref::<gtk::Image>() {
        if thin
            && let Some(name) = image.icon_name()
            && let Some(thin_name) = thin_glyph_name(&name)
        {
            image.set_from_icon_name(Some(thin_name), gtk::IconSize::Menu);
            updated += 1;
        }
        if image.pixel_size() != pixels {
            image.set_pixel_size(pixels);
            updated += 1;
        }
    }
    if let Some(container) = widget.downcast_ref::<gtk::Container>() {
        container.forall(|child| updated += scale_titlebutton_icons(child, in_button, pixels, thin));
    }
    updated
}

/// Original thin window-control glyphs on a 20-unit grid (10 units of glyph, as
/// on common desktop title bars). They are filled shapes so GTK recolors them.
#[cfg(target_os = "linux")]
const THIN_GLYPHS: [(&str, &str, &str); 4] = [
    ("window-minimize-symbolic", "gk-window-minimize-symbolic", "M5 10h10v1H5z"),
    (
        "window-maximize-symbolic",
        "gk-window-maximize-symbolic",
        "M5 5h10v10H5z M6 6v8h8V6z",
    ),
    (
        "window-restore-symbolic",
        "gk-window-restore-symbolic",
        "M5 7h8v8H5z M6 8v6h6V8z M7 5h8v8h-2v-1h1V6H8v1H7z",
    ),
    (
        "window-close-symbolic",
        "gk-window-close-symbolic",
        "M5.7 5 10 9.3 14.3 5l.7.7-4.3 4.3 4.3 4.3-.7.7-4.3-4.3-4.3 4.3-.7-.7L9.3 10 5 5.7z",
    ),
];

#[cfg(target_os = "linux")]
fn thin_glyph_name(icon_name: &str) -> Option<&'static str> {
    THIN_GLYPHS
        .iter()
        .find(|(original, ..)| *original == icon_name)
        .map(|(_, thin, _)| *thin)
}

/// Writes the glyph files and registers their folder with the icon theme.
/// Returns false when they cannot be provided, leaving the theme icons in use.
#[cfg(target_os = "linux")]
fn install_thin_glyphs() -> bool {
    use gtk::prelude::IconThemeExt;

    let dir = gtk::glib::user_runtime_dir().join("git-khronos-window-icons");
    if std::fs::create_dir_all(&dir).is_err() {
        return false;
    }
    for (_, name, path) in THIN_GLYPHS {
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 20 20\">\
             <path fill=\"#2e3436\" fill-rule=\"evenodd\" d=\"{path}\"/></svg>"
        );
        let file = dir.join(format!("{name}.svg"));
        if std::fs::read_to_string(&file).is_ok_and(|existing| existing == svg) {
            continue;
        }
        if std::fs::write(&file, svg).is_err() {
            return false;
        }
    }
    let Some(theme) = gtk::IconTheme::default() else {
        return false;
    };
    theme.append_search_path(&dir);
    true
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct ChromeState {
    provider: Option<gtk::CssProvider>,
    icon_px: i32,
    thin_glyphs: Option<bool>,
    refresh_pending: bool,
    hooked: Vec<gtk::glib::WeakRef<gtk::Window>>,
}

#[cfg(target_os = "linux")]
thread_local! {
    static CHROME: std::cell::RefCell<ChromeState> = std::cell::RefCell::new(ChromeState::default());
}

/// Re-applies the current glyph size to all toplevels; returns images changed.
#[cfg(target_os = "linux")]
fn refresh_titlebutton_icons() -> usize {
    let (pixels, thin) = CHROME.with(|state| {
        let state = state.borrow();
        (state.icon_px, state.thin_glyphs == Some(true))
    });
    if pixels <= 0 {
        return 0;
    }
    gtk::Window::list_toplevels()
        .iter()
        .map(|window| scale_titlebutton_icons(window, false, pixels, thin))
        .sum()
}

/// Queues one refresh on the next main-loop idle, after GTK has finished the
/// state change that rebuilt the buttons. Repeated requests coalesce.
#[cfg(target_os = "linux")]
fn schedule_titlebutton_refresh() {
    let already_pending = CHROME.with(|state| std::mem::replace(&mut state.borrow_mut().refresh_pending, true));
    if already_pending {
        return;
    }
    gtk::glib::idle_add_local_once(|| {
        CHROME.with(|state| state.borrow_mut().refresh_pending = false);
        refresh_titlebutton_icons();
    });
}

/// Connects the refresh to window-state changes once per application window.
#[cfg(target_os = "linux")]
fn hook_window_state_changes() {
    use gtk::glib::prelude::ObjectExt;
    use gtk::prelude::*;

    for toplevel in gtk::Window::list_toplevels() {
        let Ok(window) = toplevel.downcast::<gtk::Window>() else {
            continue;
        };
        if window.window_type() != gtk::WindowType::Toplevel {
            continue;
        }
        let hooked = CHROME.with(|state| {
            let mut state = state.borrow_mut();
            state.hooked.retain(|weak| weak.upgrade().is_some());
            state.hooked.iter().any(|weak| weak.upgrade().as_ref() == Some(&window))
        });
        if hooked {
            continue;
        }
        CHROME.with(|state| state.borrow_mut().hooked.push(window.downgrade()));
        window.connect_window_state_event(|_, _| {
            schedule_titlebutton_refresh();
            gtk::glib::Propagation::Proceed
        });
    }
}

/// Loads the scaling style sheet and applies the glyph size, keeping it applied
/// across window-state changes. Call on the GTK main thread.
#[cfg(target_os = "linux")]
fn install_window_chrome_scale(percent: u32) {
    use gtk::prelude::CssProviderExt;

    let Some(screen) = gtk::gdk::Screen::default() else {
        return;
    };
    CHROME.with(|state| {
        let mut state = state.borrow_mut();
        state.icon_px = window_chrome_icon_px(percent);
        state.thin_glyphs.get_or_insert_with(install_thin_glyphs);
        let provider = state.provider.get_or_insert_with(|| {
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
    refresh_titlebutton_icons();
    hook_window_state_changes();
}

/// Applies the window-chrome scale for this process. Call on the GTK main thread.
#[cfg(target_os = "linux")]
pub fn apply_window_chrome_scale(percent: u32) {
    if running_under_wsl() {
        install_window_chrome_scale(percent);
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

    #[test]
    fn scales_window_chrome_with_the_interface_zoom() {
        let base = window_chrome_css(100);
        assert!(base.contains("min-height: 28px"));
        assert!(base.contains("font-size: 100%"));
        let zoomed = window_chrome_css(130);
        assert!(zoomed.contains("min-height: 39px"));
        assert!(zoomed.contains("min-width: 60px"));
        assert_eq!(window_chrome_icon_px(100), 20);
        assert_eq!(window_chrome_icon_px(130), 26);
        assert_eq!(window_chrome_icon_px(9000), 80);
        assert!(zoomed.contains("font-size: 130%"));
        assert_eq!(window_chrome_css(50), base);
        assert_eq!(window_chrome_css(9000), window_chrome_css(400));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn keeps_titlebutton_icons_scaled_when_gtk_rebuilds_them() {
        use gtk::prelude::*;

        // Needs a display; skipped where GTK cannot initialize (for example CI).
        if gtk::init().is_err() {
            eprintln!("skipping: no GTK display available");
            return;
        }
        fn sizes(widget: &gtk::Widget, in_button: bool, found: &mut Vec<i32>) {
            let in_button = in_button || widget.style_context().has_class("titlebutton");
            if in_button && let Some(image) = widget.downcast_ref::<gtk::Image>() {
                found.push(image.pixel_size());
            }
            if let Some(container) = widget.downcast_ref::<gtk::Container>() {
                container.forall(|child| sizes(child, in_button, found));
            }
        }
        fn glyph_sizes(window: &gtk::Window) -> Vec<i32> {
            let mut found = Vec::new();
            sizes(window.upcast_ref(), false, &mut found);
            found
        }
        fn settle() {
            while gtk::events_pending() {
                gtk::main_iteration_do(false);
            }
        }

        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        let bar = gtk::HeaderBar::new();
        bar.set_show_close_button(true);
        bar.set_decoration_layout(Some(":minimize,maximize,close"));
        window.set_titlebar(Some(&bar));
        window.show_all();
        settle();

        install_window_chrome_scale(130);
        let expected = window_chrome_icon_px(130);
        assert_eq!(glyph_sizes(&window), vec![expected; 3]);

        // Changing the layout makes GTK recreate the buttons with default sizes.
        bar.set_decoration_layout(Some(":close"));
        bar.set_decoration_layout(Some(":minimize,maximize,close"));
        settle();
        assert_ne!(glyph_sizes(&window), vec![expected; 3]);

        let event = gtk::gdk::Event::new(gtk::gdk::EventType::WindowState);
        window.emit_by_name::<bool>("window-state-event", &[&event]);
        settle();
        assert_eq!(glyph_sizes(&window), vec![expected; 3]);

        // The thin glyph set must also survive the rebuild.
        let mut names = Vec::new();
        fn collect_names(widget: &gtk::Widget, in_button: bool, found: &mut Vec<String>) {
            let in_button = in_button || widget.style_context().has_class("titlebutton");
            if in_button && let Some(image) = widget.downcast_ref::<gtk::Image>() {
                found.push(image.icon_name().map(|name| name.to_string()).unwrap_or_default());
            }
            if let Some(container) = widget.downcast_ref::<gtk::Container>() {
                container.forall(|child| collect_names(child, in_button, found));
            }
        }
        collect_names(window.upcast_ref(), false, &mut names);
        assert_eq!(names.len(), 3);
        assert!(names.iter().all(|name| name.starts_with("gk-window-")), "{names:?}");

        window.close();
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

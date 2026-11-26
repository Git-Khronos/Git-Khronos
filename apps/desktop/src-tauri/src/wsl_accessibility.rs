//! Session-local accessibility routing for X11 startup under WSL.
use gtk::{gio, glib};
use std::cell::RefCell;
use std::ffi::OsStr;
use std::os::unix::process::CommandExt;
use std::process::Command;
use std::rc::Rc;
use std::time::Duration;

const ADDRESS_VARIABLE: &str = "AT_SPI_BUS_ADDRESS";
const LOOKUP_LIMIT: Duration = Duration::from_millis(600);

fn use_session_address(
    wsl: bool,
    explicit_address: bool,
    display: Option<&str>,
    wayland: Option<&str>,
    backend: Option<&str>,
    session_bus: Option<&str>,
) -> bool {
    wsl && !explicit_address
        && display.is_some_and(|value| !value.is_empty())
        && match backend.filter(|value| !value.is_empty()) {
            Some(value) => value == "x11",
            None => wayland.is_none_or(str::is_empty),
        }
        && session_bus.is_some_and(local_bus_address)
}

fn local_bus_address(value: &str) -> bool {
    value.len() <= 4096
        && (value.starts_with("unix:path=") || value.starts_with("unix:abstract="))
        && !value.contains(';')
        && !value.chars().any(char::is_control)
}

fn session_accessibility_address() -> Option<String> {
    let context = glib::MainContext::new();
    context
        .with_thread_default(|| {
            let event_loop = glib::MainLoop::new(Some(&context), false);
            let result = Rc::new(RefCell::new(None));
            let timeout = glib::timeout_source_new(LOOKUP_LIMIT, None, glib::Priority::DEFAULT, {
                let event_loop = event_loop.clone();
                move || {
                    event_loop.quit();
                    glib::ControlFlow::Break
                }
            });
            timeout.attach(Some(&context));
            let task = context.spawn_local({
                let result = result.clone();
                let event_loop = event_loop.clone();
                async move {
                    if let Ok(bus) = gio::bus_get_future(gio::BusType::Session).await
                        && let Ok(reply) = bus
                            .call_future(
                                Some("org.a11y.Bus"),
                                "/org/a11y/bus",
                                "org.a11y.Bus",
                                "GetAddress",
                                None,
                                Some(glib::VariantTy::new("(s)").expect("fixed D-Bus reply type")),
                                gio::DBusCallFlags::NONE,
                                600,
                            )
                            .await
                        && let Some((address,)) = reply.get::<(String,)>()
                        && local_bus_address(&address)
                    {
                        *result.borrow_mut() = Some(address);
                    }
                    event_loop.quit();
                }
            });
            event_loop.run();
            task.abort();
            timeout.destroy();
            result.take()
        })
        .ok()
        .flatten()
}

pub(crate) fn route_before_gtk(wsl: bool) {
    let variable = |name| std::env::var(name).ok();
    if !use_session_address(
        wsl,
        std::env::var_os(ADDRESS_VARIABLE).is_some(),
        variable("DISPLAY").as_deref(),
        variable("WAYLAND_DISPLAY").as_deref(),
        variable("GDK_BACKEND").as_deref(),
        variable("DBUS_SESSION_BUS_ADDRESS").as_deref(),
    ) {
        return;
    }
    let Some(address) = session_accessibility_address() else {
        return;
    };
    // GIO may start worker threads. Pass the address to the new process image
    // instead of mutating the environment shared with those threads. Use the
    // same executable inode, arguments and PID; the explicit address prevents
    // a second lookup.
    let mut args = std::env::args_os();
    let program_name = args.next();
    let mut command = Command::new("/proc/self/exe");
    let error = command
        .arg0(
            program_name
                .as_deref()
                .unwrap_or_else(|| OsStr::new("git-khronos")),
        )
        .args(args)
        .env(ADDRESS_VARIABLE, address)
        .exec();
    eprintln!("Git Khronos: could not apply the session accessibility address: {error}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_implicit_accessibility_on_local_wsl_x11_is_routed() {
        let display = Some(":0");
        let wayland = Some("wayland-0");
        let local = Some("unix:path=/run/user/1000/bus");
        assert!(use_session_address(
            true,
            false,
            display,
            wayland,
            Some("x11"),
            local
        ));
        assert!(use_session_address(true, false, display, None, None, local));
        assert!(!use_session_address(
            false, false, display, None, None, local
        ));
        assert!(!use_session_address(true, true, display, None, None, local));
        assert!(!use_session_address(
            true, false, display, wayland, None, local
        ));
        assert!(!use_session_address(
            true,
            false,
            display,
            None,
            Some("wayland"),
            local
        ));
        assert!(!use_session_address(true, false, None, None, None, local));
        assert!(!use_session_address(true, false, display, None, None, None));
    }

    #[test]
    fn rejects_remote_or_multiple_bus_endpoints() {
        assert!(local_bus_address("unix:abstract=/tmp/owned"));
        assert!(!local_bus_address("tcp:host=localhost,port=1000"));
        assert!(!local_bus_address(
            "unix:path=/tmp/owned;tcp:host=localhost"
        ));
        assert!(!local_bus_address("unix:path=/tmp/owned\n"));
    }
}

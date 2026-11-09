#!/usr/bin/env python3
"""Check production CSS in WebKitGTK under Tauri's nonce-bearing style policy.

Run after `pnpm nx run desktop:build` with the system Python, GTK 3 and
WebKit2 4.1 introspection packages installed. Opens a temporary test window;
uses the browser sample repository and never opens or changes a real repository.
"""

import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2


ROOT = Path(__file__).resolve().parent.parent / "dist/apps/desktop/browser"
NONCE = "khronos-renderer-regression"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split("?")[0] != "/":
            return super().do_GET()
        # Tauri injects nonces into initial HTML style elements. Reproduce that
        # transformation and the resulting style policy on production assets.
        html = (ROOT / "index.html").read_text().replace(
            "<style", f'<style nonce="{NONCE}"'
        )
        policy = (
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            f"style-src 'self' 'unsafe-inline' 'nonce-{NONCE}'; "
            "img-src 'self' data:; font-src 'self'"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Security-Policy", policy)
        self.end_headers()
        self.wfile.write(html.encode())


PROBE = """
JSON.stringify((() => {
  const workspace = document.querySelector('.workspace');
  const list = document.querySelector('.commit-list');
  const rows = [...document.querySelectorAll('.commit-row[data-commit-oid]')];
  const styles = [...document.querySelectorAll('style')];
  const referenceOffsets = [...document.querySelectorAll('.single-ref > button.ref-pill')].map(button => {
    const left = button.getBoundingClientRect().left;
    button.focus({ preventScroll: true });
    const offset = button.getBoundingClientRect().left - left;
    button.blur();
    return offset;
  });
  const bounds = list?.getBoundingClientRect();
  return {
    workspace: workspace && getComputedStyle(workspace).display,
    rows: rows.length,
    rowPosition: rows[0] && getComputedStyle(rows[0]).position,
    listHeight: bounds?.height,
    listBottom: bounds?.bottom,
    viewportHeight: innerHeight,
    blockedStyles: styles.filter(s => !s.sheet).length,
    missingNonces: styles.filter(s => !s.nonce).length,
    styles: styles.length,
    referenceOffsets,
  };
})())
"""


def main():
    if not (ROOT / "index.html").exists():
        raise SystemExit("Build the production renderer first.")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    window = Gtk.Window(title="Git Khronos packaged renderer regression")
    window.set_default_size(1440, 900)
    view = WebKit2.WebView()
    window.add(view)
    window.show_all()
    failures = []
    completed = False

    def interactions_done(obj, result, _data):
        nonlocal completed
        try:
            report = json.loads(obj.evaluate_javascript_finish(result).to_string())
            print(json.dumps(report, indent=2), flush=True)
            assert report["selected"], "commit selection did not respond"
            assert report["preferences"], "deferred preferences did not open"
            assert report["blockedStyles"] == 0, "CSP blocked deferred styles"
            assert report["missingNonces"] == 0, "deferred styles lost the nonce"
        except Exception as error:
            failures.append(str(error))
        completed = True
        Gtk.main_quit()

    def inspect_interactions():
        view.evaluate_javascript("""JSON.stringify({
          selected: !!document.querySelector('.commit-row.selected'),
          preferences: !!document.querySelector('gc-preferences-dialog [role="dialog"]'),
          blockedStyles: [...document.querySelectorAll('style')].filter(s => !s.sheet).length,
          missingNonces: [...document.querySelectorAll('style')].filter(s => !s.nonce).length
        })""", -1, None, None, None, interactions_done, None)
        return False

    def exercise_interactions():
        view.evaluate_javascript("""
          document.querySelector('.commit-row[data-commit-oid]').click();
          document.querySelector('[aria-label="Preferences"]').click();
        """, -1, None, None, None, None, None)
        GLib.timeout_add_seconds(2, inspect_interactions)

    def snapshot_done(obj, result, _data):
        try:
            obj.get_snapshot_finish(result).write_to_png(sys.argv[1])
        except Exception as error:
            failures.append(str(error))
        exercise_interactions()

    def finish(obj, result, _data):
        nonlocal completed
        try:
            report = json.loads(obj.evaluate_javascript_finish(result).to_string())
            print(json.dumps(report, indent=2), flush=True)
            assert report["workspace"] == "grid", "repository panes lost grid layout"
            assert report["rows"] > 0, "sample commit history did not render"
            assert report["rowPosition"] == "absolute", "commit virtualization lost its CSS"
            assert report["styles"] > 1, "Angular component styles are missing"
            assert report["blockedStyles"] == 0, "CSP blocked a component stylesheet"
            assert report["missingNonces"] == 0, "Angular did not reuse the Tauri nonce"
            assert report["referenceOffsets"] and all(abs(offset) <= 1 for offset in report["referenceOffsets"]), "reference labels moved on focus"
            assert 0 < report["listHeight"] < report["viewportHeight"], "history is unbounded"
            assert report["listBottom"] <= report["viewportHeight"], "history exceeds the window"
        except Exception as error:
            failures.append(str(error))
        if failures:
            completed = True
            Gtk.main_quit()
        elif len(sys.argv) > 1:
            view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE,
                              None, snapshot_done, None)
        else:
            exercise_interactions()

    def inspect():
        view.evaluate_javascript(PROBE, -1, None, None, None, finish, None)
        return False

    def deadline():
        if not completed:
            failures.append("WebKit renderer did not answer within 30 seconds")
            Gtk.main_quit()
        return False

    view.load_uri(f"http://127.0.0.1:{server.server_port}/")
    GLib.timeout_add_seconds(12, inspect)
    GLib.timeout_add_seconds(30, deadline)
    try:
        Gtk.main()
    finally:
        window.destroy()
        server.shutdown()
    if failures:
        raise SystemExit("FAIL: " + "; ".join(failures))
    print("PASS: production commit graph retains its layout under Tauri's style CSP")


if __name__ == "__main__":
    main()

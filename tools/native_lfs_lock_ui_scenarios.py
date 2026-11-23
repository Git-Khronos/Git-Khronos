"""Packaged Git LFS lock/unlock journeys through the real tracking dialog."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import threading

from native_acceptance import open_ui


def lfs_lock_dialog_actions(driver, fixtures, report):
    repository = fixtures.repository("lfs-lock-dialog-actions", commits=1)
    fixtures.git(repository, "lfs", "track", "--lockable", "fixture.txt")
    fixtures.git(repository, "add", ".gitattributes", "fixture.txt")
    fixtures.git(repository, "commit", "-qm", "Track lockable asset")
    original = (repository / "fixture.txt").read_bytes()

    locks = [{"id": "remote-41", "path": "remote.psd", "owner": "Other Editor",
              "locked_at": "2026-11-22T10:00:00Z"}]

    class Server(HTTPServer):
        daemon_threads = True

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def _body(self):
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 16 * 1024:
                raise ValueError("invalid request body")
            return json.loads(self.rfile.read(length) or b"{}")

        def _reply(self, status, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/vnd.git-lfs+json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            try:
                body = self._body()
            except (ValueError, json.JSONDecodeError):
                return self._reply(400, {"message": "Invalid JSON"})
            if self.path == "/locks/verify":
                ours = [lock for lock in locks if lock["owner"] == "Tester"]
                theirs = [lock for lock in locks if lock["owner"] != "Tester"]
                return self._reply(200, {
                    "ours": [self._wire(lock) for lock in ours],
                    "theirs": [self._wire(lock) for lock in theirs],
                })
            if self.path == "/locks":
                path = body.get("path")
                if not isinstance(path, str) or not path:
                    return self._reply(400, {"message": "Path is required"})
                existing = next((lock for lock in locks if lock["path"] == path), None)
                if existing:
                    return self._reply(409, {"lock": self._wire(existing), "message": "Lock already exists"})
                lock = {"id": f"local-{len(locks) + 1}", "path": path,
                        "owner": "Tester", "locked_at": "2026-11-22T10:01:00Z"}
                locks.append(lock)
                return self._reply(201, {"lock": self._wire(lock)})
            if self.path.endswith("/unlock"):
                lock_id = self.path.removeprefix("/locks/").removesuffix("/unlock")
                lock = next((lock for lock in locks if lock["id"] == lock_id), None)
                if lock is None:
                    return self._reply(404, {"message": "Lock not found"})
                if lock["owner"] != "Tester" and body.get("force") is not True:
                    return self._reply(403, {"message": "Lock belongs to another user"})
                locks.remove(lock)
                return self._reply(200, {"lock": self._wire(lock)})
            return self._reply(404, {"message": "Unknown endpoint"})

        @staticmethod
        def _wire(lock):
            return {"id": lock["id"], "path": lock["path"],
                    "owner": {"name": lock["owner"]}, "locked_at": lock["locked_at"]}

    server = Server(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    worker.start()
    try:
        fixtures.git(repository, "config", "lfs.url", f"http://127.0.0.1:{server.server_port}/")
        repo_id = open_ui(driver, repository)
        before = {
            "head": fixtures.git(repository, "rev-parse", "HEAD"),
            "index": (repository / ".git/index").read_bytes(),
            "attributes": (repository / ".gitattributes").read_bytes(),
        }

        driver.click('[aria-label="Preferences"]')
        driver.wait("return !!document.querySelector('#preferences-tab-git')")
        driver.click("#preferences-tab-git")
        driver.click_text(".preferences-grid button", "Manage tracking patterns…")
        driver.wait("return !!document.querySelector('gk-lfs-tracking-dialog [role=dialog]')")
        driver.click("gk-lfs-tracking-dialog details.locks > summary")
        driver.click("button[data-lfs-locks-load]")
        driver.wait("return !!document.querySelector('gk-lfs-tracking-dialog .lock-result')")
        driver.wait("return document.querySelector('gk-lfs-tracking-dialog .lock-result')?.textContent.includes('Other Editor')")

        driver.click('[aria-label="Review force unlock of remote.psd"]')
        driver.wait("return !!document.querySelector('gk-lfs-tracking-dialog .force-review')")
        driver.click_text("gk-lfs-tracking-dialog .force-review button", "Keep lock")
        assert any(lock["id"] == "remote-41" for lock in locks), "Cancel removed the collaborator lock"
        assert not driver.script("return !!document.querySelector('gk-lfs-tracking-dialog .force-review')")

        driver.script("const e=document.querySelector('#lfs-lock-path');e.value='fixture.txt';e.dispatchEvent(new Event('input',{bubbles:true}));")
        driver.click_text("gk-lfs-tracking-dialog form button", "Lock file")
        driver.wait("return !!document.querySelector('[aria-label=\"Unlock fixture.txt\"]')")
        assert any(lock["path"] == "fixture.txt" and lock["owner"] == "Tester" for lock in locks)

        (repository / "fixture.txt").write_bytes(b"uncommitted while lock held\n")
        driver.click('[aria-label="Unlock fixture.txt"]')
        driver.wait("return !!document.querySelector('gk-lfs-tracking-dialog [role=alert]')")
        assert any(lock["path"] == "fixture.txt" and lock["owner"] == "Tester" for lock in locks), (
            "Dirty-file refusal released the local server lock")
        (repository / "fixture.txt").write_bytes(original)
        driver.click('[aria-label="Unlock fixture.txt"]')
        driver.wait("return !document.querySelector('[aria-label=\"Unlock fixture.txt\"]')")
        assert not any(lock["path"] == "fixture.txt" for lock in locks)

        driver.click('[aria-label="Review force unlock of remote.psd"]')
        driver.wait("return !!document.querySelector('gk-lfs-tracking-dialog .force-review')")
        driver.click_text("gk-lfs-tracking-dialog .force-review button", "Force unlock")
        driver.wait("return !document.querySelector('[aria-label=\"Review force unlock of remote.psd\"]')")
        assert not any(lock["id"] == "remote-41" for lock in locks), "Confirmed force unlock left the server lock"
        assert fixtures.git(repository, "rev-parse", "HEAD") == before["head"]
        assert (repository / ".git/index").read_bytes() == before["index"]
        assert (repository / ".gitattributes").read_bytes() == before["attributes"]
        assert not fixtures.git(repository, "status", "--porcelain")
        report["scenarios"].append("native-ui-lfs-lock-create-unlock-dirty-refusal-and-force-unlock-review")
        return repository, repo_id
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)
        assert not worker.is_alive(), "Owned LFS lock fixture server did not shut down"

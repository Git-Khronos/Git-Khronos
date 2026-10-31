"""Real packaged IPC scenarios with independent on-disk Git assertions.

These complement the native UI smoke and existing renderer journeys; they do
not claim that a direct IPC call verifies a dialog or keyboard workflow.
"""
import json
import os
import signal
from pathlib import Path
import subprocess
import threading
import time
import uuid
import zlib
from native_acceptance import open_ui, run
from native_fork_remote_scenarios import hosted_fork_remote_attachment


def shallow_history_pagination(driver, fixtures, report):
    repository = fixtures.repository("shallow-history", commits=420)
    complete = fixtures.git(repository, "rev-list", "--all").splitlines()
    shallow = repository / ".git/shallow"
    linked = fixtures.root / "shallow-linked-worktree"
    fixtures.git(repository, "worktree", "add", "--detach", str(linked), "HEAD")
    for path in (repository, linked):
        head = fixtures.git(path, "rev-parse", "HEAD")
        contents = (path / "fixture.txt").read_bytes()
        repo_id = None
        retained = None
        for visible in (330, 380, 420):
            if visible < 420:
                shallow.write_text(complete[visible - 1] + "\n")
            else:
                shallow.unlink()
            boundary = shallow.read_bytes() if shallow.exists() else None
            # Parent objects remain readable: object absence must not be what
            # accidentally makes pagination stop at the shallow boundary.
            fixtures.git(path, "cat-file", "-e", complete[-1])
            expected = [line.split() for line in fixtures.git(
                path, "log", "--all", "--format=%H %P"
            ).splitlines()]
            assert len(expected) == visible
            if repo_id is None:
                snapshot = driver.invoke("open_repository", path=str(path))
                repo_id = snapshot["id"]
                assert 0 < len(snapshot["commits"]) < visible, "Fixture must require pagination"
            else:
                snapshot = driver.invoke("refresh_repository", repoId=repo_id)
                assert len(snapshot["commits"]) == retained, (
                    "Refresh discarded loaded history", retained, len(snapshot["commits"]))
            loaded = list(snapshot["commits"])
            while True:
                page = driver.invoke("load_more_commits", repoId=repo_id)
                loaded.extend(page["commits"])
                assert len(loaded) <= visible, ("History crossed shallow boundary", visible, len(loaded))
                if not page["historyTruncated"]:
                    break
                assert page["commits"] and len(loaded) < visible, "Pagination made no progress"
            assert [(entry["oid"], entry["parents"]) for entry in loaded] == [
                (entry[0], entry[1:]) for entry in expected
            ], ("Shallow pagination differs from Git", str(path), visible, len(loaded))
            retained = visible
            assert fixtures.git(path, "rev-parse", "HEAD") == head
            assert (path / "fixture.txt").read_bytes() == contents
            assert (shallow.read_bytes() if shallow.exists() else None) == boundary
    report["scenarios"].append("native-shallow-history-boundaries-deepen-unshallow-worktree")


def damaged_history_pagination(driver, fixtures, report):
    for damage in ("missing", "compressed", "decoded"):
        repository = fixtures.repository(f"damaged-history-{damage}", commits=1)
        tree = fixtures.git(repository, "rev-parse", "HEAD^{tree}")
        head = fixtures.git(repository, "rev-parse", "HEAD")
        # commit-tree creates loose objects so one older commit can be damaged
        # without deleting a pack or disturbing unrelated objects.
        for index in range(120):
            head = fixtures.git(repository, "commit-tree", tree, "-p", head, "-m", f"Owned history {index}")
        fixtures.git(repository, "update-ref", "refs/heads/main", head)
        expected = [line.split() for line in fixtures.git(repository, "log", "--all", "--format=%H %P").splitlines()]
        opened = driver.invoke("open_repository", path=str(repository))
        repo_id = opened["id"]
        assert 0 < len(opened["commits"]) < 100
        oid = expected[100][0]
        object_path = repository / ".git/objects" / oid[:2] / oid[2:]
        original = object_path.read_bytes()
        backup = object_path.with_suffix(".owned-backup")
        object_path.rename(backup)

        def failed_page():
            try:
                driver.invoke("load_more_commits", repoId=repo_id)
            except RuntimeError as error:
                result = json.loads(str(error))
                assert result["kind"] == "historyObjectFailure", result
                assert oid in result["message"] and "incomplete" in result["hint"], result
                return result
            raise AssertionError(f"{damage} object was reported as complete history")

        try:
            if damage == "compressed":
                object_path.write_bytes(b"invalid compressed commit object")
            elif damage == "decoded":
                malformed = b"invalid commit\n"
                object_path.write_bytes(zlib.compress(f"commit {len(malformed)}\0".encode() + malformed))
            error = failed_page()
        finally:
            if object_path.exists():
                object_path.unlink()
            backup.rename(object_path)
        assert failed_page() == error, "Retry skipped an unreturned page prefix after object failure"
        refreshed = driver.invoke("refresh_repository", repoId=repo_id)
        assert len(refreshed["commits"]) == len(opened["commits"]), "Failed page advanced retained history"
        page = driver.invoke("load_more_commits", repoId=repo_id)
        assert not page["historyTruncated"]
        assert [(entry["oid"], entry["parents"]) for entry in refreshed["commits"] + page["commits"]] == [
            (entry[0], entry[1:]) for entry in expected
        ], "Repair and refresh did not recover the complete history"
        assert object_path.read_bytes() == original
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-damaged-history-errors-stay-failed-until-repair-and-refresh")


def control_character_history(driver, fixtures, report):
    repository = fixtures.repository("control-character-history", commits=1)
    tree = fixtures.git(repository, "rev-parse", "HEAD^{tree}")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    special = []
    forged = "f" * 40
    author = "Author\x1fField\x1eRecord élève"
    for index in range(120):
        message = f"Owned history {index}"
        if index in (0, 100, 119):
            message += (f"\x1fsubject\x1erecord\n\nBefore\x1e{forged}\x1f\x1fForged Author"
                        "\x1fforged@example.test\x1f2020-01-01T00:00:00Z\x1fForged subject"
                        "\x1fForged body\x1fforged/ref\x1eAfter")
        head = fixtures.git(repository, "-c", f"user.name={author}",
                            "commit-tree", tree, "-p", head, "-m", message)
        if index in (0, 100, 119):
            special.append(head)
    fixtures.git(repository, "update-ref", "refs/heads/main", head)
    fixtures.git(repository, "config", "i18n.logOutputEncoding", "UTF-16")
    expected = fixtures.git(repository, "rev-list", "--all").splitlines()
    opened = driver.invoke("open_repository", path=str(repository))
    repo_id = opened["id"]
    assert 0 < len(opened["commits"]) < len(expected)
    loaded = list(opened["commits"])
    while True:
        page = driver.invoke("load_more_commits", repoId=repo_id)
        loaded.extend(page["commits"])
        assert len(loaded) <= len(expected), "Message payload created phantom history records"
        if not page["historyTruncated"]:
            break
        assert page["commits"], "History pagination made no progress"
    assert [entry["oid"] for entry in loaded] == expected
    for oid in special:
        entry = next(entry for entry in loaded if entry["oid"] == oid)
        for name, token in (("authorName", "%an"), ("authorEmail", "%ae"),
                            ("authoredAt", "%aI"), ("subject", "%s"), ("description", "%b")):
            assert entry[name] == fixtures.git(repository, "show", "-s", "--encoding=UTF-8", f"--format={token}", oid), (oid, name)
        decorations = fixtures.git(repository, "show", "-s", "--encoding=UTF-8", "--decorate=short", "--format=%D", oid)
        assert entry["decorations"] == [value.strip() for value in decorations.split(",") if value.strip()]
    refreshed = driver.invoke("refresh_repository", repoId=repo_id)
    assert refreshed["commits"] == loaded, "Refresh changed control-character commit fields"
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-control-character-history-preserves-fields-without-phantom-records")


def control_character_stashes(driver, fixtures, report):
    repository = fixtures.repository("control-character-stashes", commits=3)
    fixtures.git(repository, "config", "i18n.logOutputEncoding", "UTF-16")
    fixtures.git(repository, "config", "log.date", "iso-strict")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    file = repository / "fixture.txt"
    original_contents = file.read_bytes()
    messages = [
        f"Older élève\x1ffield\x1estash@{{999}}\x1f{'f' * 40}\x1fForged stash\x1eAfter",
        "Newer élève\x1erecord\x1ffield",
    ]
    oids = []

    def assert_entries(snapshot, expected_oids):
        entries = snapshot["stashes"]
        assert [entry["oid"] for entry in entries] == expected_oids, "Stash label forged or hid a stack entry"
        for index, entry in enumerate(entries):
            reference = f"stash@{{{index}}}"
            assert entry["reference"] == reference
            label = fixtures.git(repository, "log", "-g", "-1", "--encoding=UTF-8", "--format=%gs", reference)
            assert entry["message"] == label, "Stash label was truncated or recoded"

    for index, message in enumerate(messages):
        file.write_text(f"saved {index}\n")
        saved = driver.invoke("stash_changes", repoId=repo_id, message=message)
        oids.append(fixtures.git(repository, "rev-parse", "refs/stash"))
        assert_entries(saved, list(reversed(oids)))
    fixtures.git(repository, "stash", "store", "-m", "Duplicate owned stash", oids[0])
    assert_entries(driver.invoke("refresh_repository", repoId=repo_id), [oids[0], oids[1], oids[0]])
    captures_before = driver.invoke("load_operation_recoveries", repoId=repo_id)
    try:
        driver.invoke("drop_stash", repoId=repo_id, reference="stash@{0}", expectedOid=oids[1])
    except RuntimeError as error:
        assert json.loads(str(error))["kind"] == "staleStash", str(error)
    else:
        raise AssertionError("A shifted stash selector deleted a different object")
    assert driver.invoke("load_operation_recoveries", repoId=repo_id) == captures_before
    assert_entries(driver.invoke("refresh_repository", repoId=repo_id), [oids[0], oids[1], oids[0]])
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert file.read_bytes() == original_contents
    assert_entries(driver.invoke("drop_stash", repoId=repo_id, reference="stash@{0}", expectedOid=oids[0]), list(reversed(oids)))
    renamed = "Renamed élève\x1ffield\x1erecord"
    changed = driver.invoke("rename_stash", repoId=repo_id, reference="stash@{1}", expectedOid=oids[0], message=renamed)
    assert_entries(changed, list(reversed(oids)))
    assert changed["stashes"][1]["message"] == renamed
    applied = driver.invoke("apply_stash", repoId=repo_id, reference="stash@{1}", expectedOid=oids[0])
    assert file.read_text() == "saved 0\n"
    assert_entries(applied, list(reversed(oids)))
    fixtures.git(repository, "restore", "--", "fixture.txt")
    assert_entries(driver.invoke("drop_stash", repoId=repo_id, reference="stash@{0}", expectedOid=oids[1]), [oids[0]])
    assert_entries(driver.invoke("pop_stash_entry", repoId=repo_id, reference="stash@{0}", expectedOid=oids[0]), [])
    assert file.read_text() == "saved 0\n"
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert not fixtures.git(repository, "diff", "--cached", "--name-only")
    fixtures.git(repository, "restore", "--", "fixture.txt")
    file.write_text("complete saved contents\n")
    fixtures.git(repository, "stash", "push", "-m", "élève😀" * 1000)
    large_oid = fixtures.git(repository, "rev-parse", "refs/stash")
    original = fixtures.git(repository, "cat-file", "commit", large_oid)
    assert_entries(driver.invoke("drop_stash", repoId=repo_id, reference="stash@{0}", expectedOid=large_oid), [])
    captures = driver.invoke("load_operation_recoveries", repoId=repo_id)
    capture = next(entry for entry in captures if entry["snapshotOid"] == large_oid)
    assert capture["label"].endswith("…") and len(capture["label"].encode()) < 4096
    assert "\0" not in capture["label"]
    assert fixtures.git(repository, "cat-file", "commit", large_oid) == original
    driver.invoke("restore_operation_recovery", repoId=repo_id, id=capture["id"], branch="restored-stash")
    assert file.read_text() == "complete saved contents\n"
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert not fixtures.git(repository, "diff", "--cached", "--name-only")
    report["scenarios"].append("native-control-character-stash-labels-duplicate-objects-and-exact-target-actions")


def stash_delete_confirmation(driver, fixtures, report):
    repository = fixtures.repository("ui-stash-delete", commits=3)
    file = repository / "fixture.txt"
    original = file.read_bytes()
    head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_text("owned saved contents\n")
    fixtures.git(repository, "stash", "push", "-m", "Owned deletion confirmation")
    oid = fixtures.git(repository, "rev-parse", "refs/stash")
    repo_id = open_ui(driver, repository)
    row = '.stash-item'
    driver.click('#reference-section-stashes .sidebar-heading')
    driver.wait("return !!document.querySelector('.stash-item:not(:disabled)')")
    driver.script("""
      const element = document.querySelector(arguments[0]);
      element.scrollIntoView({block: 'center'});
      element.focus();
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: bounds.left + 10, clientY: bounds.top + 10}));
    """, row)
    driver.click_text('.stash-context-menu [role="menuitem"]', 'Delete Stash…')
    dialog = 'gc-stash-delete-dialog [role="alertdialog"]'
    driver.wait(f"return document.querySelector('{dialog}')?.contains(document.activeElement) && document.activeElement.textContent === 'Cancel'")
    lock = repository / ".git/refs/stash.lock"
    assert not lock.exists(), "Owned stash refusal must not overwrite a lock"
    lock.write_text("owned acceptance lock\n")
    try:
        driver.click_text(f'{dialog} button', 'Delete Stash')
        driver.wait(f"return !!document.querySelector('{dialog} [role=alert]') && document.activeElement === document.querySelector('{dialog} [role=alert]')")
        assert fixtures.git(repository, "rev-parse", "refs/stash") == oid
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert file.read_bytes() == original
    finally:
        lock.unlink()
    driver.click_text(f'{dialog} button', 'Retry Delete')
    driver.wait("return !document.querySelector('gc-stash-delete-dialog') && document.activeElement?.matches('.wip-nav')")
    assert not driver.invoke("refresh_repository", repoId=repo_id)["stashes"]
    captures = driver.invoke("load_operation_recoveries", repoId=repo_id)
    assert any(capture["snapshotOid"] == oid for capture in captures)
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert file.read_bytes() == original
    report["scenarios"].append("native-ui-stash-delete-refusal-retains-dialog-explicit-retry-and-focus")


def selected_stash_actions(driver, fixtures, report):
    repository = fixtures.repository("selected-stash-actions", commits=3)
    file = repository / "fixture.txt"
    original = file.read_bytes()
    head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_text("selected saved contents\n")
    fixtures.git(repository, "stash", "push", "-m", "Owned selected stash")
    selected = fixtures.git(repository, "rev-parse", "refs/stash")
    file.write_text("newer saved contents\n")
    fixtures.git(repository, "stash", "push", "-m", "Owned newer stash")
    newer = fixtures.git(repository, "rev-parse", "refs/stash")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    index = (repository / ".git/index").read_bytes()
    for command in ("apply_stash", "pop_stash_entry", "pop_stash"):
        args = {"repoId": repo_id, "expectedOid": selected}
        if command != "pop_stash":
            args["reference"] = "stash@{0}"
        try:
            driver.invoke(command, **args)
        except RuntimeError as error:
            assert json.loads(str(error))["kind"] == "staleStash", str(error)
        else:
            raise AssertionError(f"{command} accepted a shifted selected stash")
        assert file.read_bytes() == original
        assert (repository / ".git/index").read_bytes() == index
        assert not driver.invoke("load_operation_recoveries", repoId=repo_id)
    applied = driver.invoke("apply_stash", repoId=repo_id, reference="stash@{1}", expectedOid=selected)
    assert [entry["oid"] for entry in applied["stashes"]] == [newer, selected]
    assert file.read_text() == "selected saved contents\n"
    fixtures.git(repository, "restore", "--", "fixture.txt")
    lock = repository / ".git/refs/stash.lock"
    lock.write_text("owned acceptance lock\n")
    try:
        try:
            driver.invoke("pop_stash_entry", repoId=repo_id, reference="stash@{1}", expectedOid=selected)
        except RuntimeError as error:
            payload = json.loads(str(error))
            assert payload["kind"] == "stashAppliedButRetained", payload
            assert "Do not apply or pop" in payload["hint"], payload
        else:
            raise AssertionError("Pop reported full success after removal was refused")
        assert file.read_text() == "selected saved contents\n"
        assert [entry["oid"] for entry in driver.invoke("refresh_repository", repoId=repo_id)["stashes"]] == [newer, selected]
    finally:
        lock.unlink()
    remaining = driver.invoke("drop_stash", repoId=repo_id, reference="stash@{1}", expectedOid=selected)
    assert [entry["oid"] for entry in remaining["stashes"]] == [newer]
    assert file.read_text() == "selected saved contents\n"
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert not fixtures.git(repository, "diff", "--cached", "--name-only")
    fixtures.git(repository, "restore", "--", "fixture.txt")
    file.write_text("owned upstream conflict\n")
    fixtures.git(repository, "add", "fixture.txt")
    fixtures.git(repository, "commit", "-qm", "Owned conflicting upstream")
    try:
        driver.invoke("pop_stash_entry", repoId=repo_id, reference="stash@{0}", expectedOid=newer)
    except RuntimeError as error:
        payload = json.loads(str(error))
        assert payload["kind"] == "gitFailure" and "stash was kept" in payload["hint"], payload
    else:
        raise AssertionError("Conflicting pop did not preserve a failure")
    assert fixtures.git(repository, "rev-parse", "refs/stash") == newer
    assert fixtures.git(repository, "ls-files", "-u")
    report["scenarios"].append("native-selected-stash-apply-pop-stale-identity-partial-removal-and-conflict-retention")
    for command in ("apply_stash", "pop_stash_entry"):
        racing = fixtures.repository(f"renumber-during-{command}", commits=3)
        racing_file = racing / "fixture.txt"
        (racing / ".gitattributes").write_text("fixture.txt merge=owned\n")
        fixtures.git(racing, "add", ".gitattributes")
        fixtures.git(racing, "commit", "-qm", "Owned merge attributes")
        racing_file.write_text("selected concurrent contents\n")
        fixtures.git(racing, "stash", "push", "-m", "Selected")
        selected = fixtures.git(racing, "rev-parse", "refs/stash")
        racing_file.write_text("other concurrent contents\n")
        fixtures.git(racing, "stash", "push", "-m", "Other")
        other = fixtures.git(racing, "rev-parse", "refs/stash")
        fixtures.git(racing, "stash", "drop", "stash@{0}")
        racing_file.write_text("upstream concurrent contents\n")
        fixtures.git(racing, "add", "fixture.txt")
        fixtures.git(racing, "commit", "-qm", "Owned upstream")
        fixtures.git(racing, "config", "merge.owned.driver",
                     f"git stash store -m 'Concurrent owned stash' {other} && cat '%B' > '%A'")
        racing_id = driver.invoke("open_repository", path=str(racing))["id"]
        try:
            driver.invoke(command, repoId=racing_id, reference="stash@{0}", expectedOid=selected)
        except RuntimeError as error:
            assert command == "pop_stash_entry" and json.loads(str(error))["kind"] == "stashAppliedButRetained", str(error)
        else:
            assert command == "apply_stash", "Pop concealed the changed stack after applying"
        assert racing_file.read_text() == "selected concurrent contents\n"
        assert [entry["oid"] for entry in driver.invoke("refresh_repository", repoId=racing_id)["stashes"]] == [other, selected]
    report["scenarios"].append("native-selected-stash-actions-keep-immutable-target-during-external-renumber")


def immutable_stash_previews(driver, fixtures, report):
    repository = fixtures.repository("immutable-stash-previews", commits=3)
    file = repository / "fixture.txt"
    original = file.read_bytes()
    head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_text("selected élève😀 contents\n")
    (repository / "*.tmp").write_text("selected untracked contents\n")
    fixtures.git(repository, "stash", "push", "--include-untracked", "-m", "élève😀 selected preview\n\nSelected body élève😀")
    selected = fixtures.git(repository, "rev-parse", "refs/stash")
    expected = fixtures.git(repository, "show", "-s", "--encoding=UTF-8", "--no-notes", "--no-show-signature", "--format=%B", selected)
    (repository / "other.txt").write_text("newer unrelated stash\n")
    fixtures.git(repository, "stash", "push", "--include-untracked", "-m", "Newer unrelated stash")
    newer = fixtures.git(repository, "rev-parse", "refs/stash")
    fixtures.git(repository, "notes", "add", "-m", "Unexpected presentation note", selected)
    fixtures.git(repository, "config", "i18n.logOutputEncoding", "UTF-16")
    fixtures.git(repository, "config", "color.ui", "always")
    fixtures.git(repository, "config", "log.showNotes", "true")
    repo_id = open_ui(driver, repository)
    index = (repository / ".git/index").read_bytes()
    driver.click('#reference-section-stashes .sidebar-heading')
    entry = '.stash-item[aria-label^="Stash stash@{1},"]'
    driver.click_visible(entry)
    driver.wait("return document.querySelector('.commit-body')?.textContent.includes('Selected body élève😀')")
    assert driver.script("return !document.querySelector('.commit-body').textContent.includes('Unexpected presentation note')")
    # Change the selector after the details panel has loaded, then inspect its
    # file through the real UI. No Angular state or bridge patch is injected.
    fixtures.git(repository, "stash", "store", "-m", "Concurrent preview entry", newer)
    driver.click_visible('.commit-file[aria-label="Open diff for fixture.txt"]')
    driver.wait("return document.querySelector('.diff-content-shell')?.textContent.includes('selected élève😀 contents')")
    report["scenarios"].append("native-ui-stash-unicode-body-and-file-preview-after-external-renumber")
    details = driver.invoke("inspect_stash", repoId=repo_id, oid=selected)
    assert details["oid"] == selected and details["message"] == expected, details
    assert {entry["path"] for entry in details["files"]} == {"fixture.txt", "*.tmp"}, details
    assert details["signature"]["status"] == "unsigned"
    for path, content in (("fixture.txt", "selected élève😀 contents"), ("*.tmp", "selected untracked contents")):
        patch = driver.invoke("inspect_stash_file", repoId=repo_id, oid=selected, path=path, previousPath=None)
        assert patch["oid"] == selected and content in patch["patch"], patch
        assert "newer unrelated" not in patch["patch"] and "\x1b" not in patch["patch"]
    raw = fixtures.git(repository, "cat-file", "commit", selected)
    headers, body = raw.split("\n\n", 1)
    signed = f"{headers}\ngpgsig -----BEGIN PGP SIGNATURE-----\n bogus\n -----END PGP SIGNATURE-----\n\n{body}\n"
    signed_oid = fixtures.git(repository, "hash-object", "-t", "commit", "-w", "--stdin", input=signed.encode())
    helper = repository / ".git/owned-signature-helper"
    marker = repository / ".git/owned-signature-invoked"
    helper.write_text('#!/bin/sh\nprintf invoked > "${0%/*}/owned-signature-invoked"\nexit 1\n')
    helper.chmod(0o700)
    fixtures.git(repository, "config", "gpg.program", str(helper))
    fixtures.git(repository, "config", "log.showSignature", "true")
    fixtures.git(repository, "show", "-s", "--show-signature", "--encoding=UTF-8", "--format=%H", signed_oid)
    assert marker.exists(), "Owned signature fixture did not exercise its helper"
    marker.unlink()
    signed_details = driver.invoke("inspect_stash", repoId=repo_id, oid=signed_oid)
    signed_summary = driver.invoke("inspect_history_commit", repoId=repo_id, oid=signed_oid)
    assert not marker.exists(), "Preview executed optional signature presentation"
    assert signed_details["signature"]["status"] == "unverifiable", signed_details
    assert signed_details["message"] == expected
    assert signed_summary["oid"] == signed_oid and "Selected body élève😀" in signed_summary["description"], signed_summary
    assert fixtures.git(repository, "rev-parse", "refs/stash") == newer
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert file.read_bytes() == original and not (repository / "*.tmp").exists()
    report["scenarios"].append("native-immutable-stash-previews-utf8-no-notes-colour-or-signature-helper")
    sha256_repository = fixtures.root / "sha256-stash-previews"
    sha256_repository.mkdir()
    fixtures.git(sha256_repository, "init", "-q", "--object-format=sha256", "-b", "main")
    (sha256_repository / "tracked.txt").write_text("base\n")
    fixtures.git(sha256_repository, "add", ".")
    fixtures.git(sha256_repository, "commit", "-qm", "SHA-256 preview base")
    (sha256_repository / "tracked.txt").write_text("saved tracked\n")
    (sha256_repository / "*.tmp").write_text("saved untracked\n")
    fixtures.git(sha256_repository, "stash", "push", "--include-untracked", "-m", "SHA-256 preview")
    sha256_oid = fixtures.git(sha256_repository, "rev-parse", "refs/stash")
    assert len(sha256_oid) == 64
    sha256_id = driver.invoke("open_repository", path=str(sha256_repository))["id"]
    sha256_details = driver.invoke("inspect_stash", repoId=sha256_id, oid=sha256_oid)
    assert {entry["path"] for entry in sha256_details["files"]} == {"tracked.txt", "*.tmp"}
    for path, content in (("tracked.txt", "saved tracked"), ("*.tmp", "saved untracked")):
        patch = driver.invoke("inspect_stash_file", repoId=sha256_id, oid=sha256_oid, path=path, previousPath=None)
        assert patch["oid"] == sha256_oid and content in patch["patch"], patch
    report["scenarios"].append("native-sha256-tracked-and-untracked-stash-previews")


def commit_preview_output(driver, fixtures, report):
    repository = fixtures.repository("commit-preview-output", commits=1)
    file = repository / "fixture.txt"
    author = "Élodie\x1ffield\x1erecord"
    fixtures.git(repository, "config", "user.name", author)
    message = "élève😀 summary\n\nUnicode élève😀 body"
    file.write_text("first saved contents\n")
    fixtures.git(repository, "add", "fixture.txt")
    fixtures.git(repository, "commit", "-qm", message)
    selected = fixtures.git(repository, "rev-parse", "HEAD")
    subject = f"élève😀\x1ffield\x1erecord\x1e{'f' * 40}\x1fForged\x1ffake@example.test\x1f2020-01-01T00:00:00Z\x1fInjected"
    file.write_text("second saved contents\n")
    fixtures.git(repository, "add", "fixture.txt")
    fixtures.git(repository, "commit", "-qm", subject)
    tip = fixtures.git(repository, "rev-parse", "HEAD")
    expected_ids = fixtures.git(repository, "log", "--follow", "--format=%H", tip, "--", "fixture.txt").splitlines()
    fixtures.git(repository, "notes", "add", "-m", "Unexpected preview note", selected)
    for name, value in (("i18n.logOutputEncoding", "UTF-16"), ("color.ui", "always"), ("log.showNotes", "true"), ("log.showSignature", "true")):
        fixtures.git(repository, "config", name, value)
    repo_id = open_ui(driver, repository)
    index = (repository / ".git/index").read_bytes()
    driver.click_visible(f'.commit-row[data-commit-oid="{selected}"]')
    driver.wait("return document.querySelector('.commit-body')?.textContent.includes('Unicode élève😀 body')")
    driver.wait("return document.querySelector('.commit-signature.unsigned strong')?.textContent.trim() === 'Unsigned'")
    details = driver.invoke("inspect_commit", repoId=repo_id, oid=selected)
    assert details["message"] == message and details["signature"]["status"] == "unsigned", details
    assert details["signature"]["signer"] is None and details["signature"]["key"] is None
    report["scenarios"].append("native-ui-commit-preview-utf8-notes-colour-and-unsigned-status")
    history = driver.invoke("inspect_file_history", repoId=repo_id, revision=tip, path="fixture.txt")
    assert [entry["oid"] for entry in history] == expected_ids, "File history forged or omitted a commit"
    assert history[0]["subject"] == subject and history[0]["authorName"] == author
    query = dict(message="élève", author="", oid="", since="", until="", path="", scope="main")
    page = driver.invoke("search_repository_history", repoId=repo_id, query=query, cursor=None, operationId=str(uuid.uuid4()))
    assert [entry["oid"] for entry in page["entries"]] == [tip, selected], page
    assert page["entries"][0]["subject"] == subject
    files = driver.invoke("inspect_file_history_page", repoId=repo_id, revision=tip, path="fixture.txt", cursor=None, operationId=str(uuid.uuid4()))
    assert [entry["oid"] for entry in files["entries"]] == expected_ids, files
    assert files["entries"][0]["subject"] == subject
    assert fixtures.git(repository, "rev-parse", "HEAD") == tip
    assert file.read_text() == "second saved contents\n"
    assert (repository / ".git/index").read_bytes() == index
    report["scenarios"].append("native-file-history-control-characters-and-utf16-metadata-reads")


def bounded_file_history_reads(driver, fixtures, report):
    repository = fixtures.repository("bounded-file-history", commits=3)
    repo_id = open_ui(driver, repository)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    expected = fixtures.git(repository, "log", "--follow", "--format=%H", "--", "fixture.txt").splitlines()
    index = (repository / ".git/index").read_bytes()
    original = (repository / "fixture.txt").read_bytes()
    gate = fixtures.history_gate
    hold, started = gate / "hold", gate / "started"
    (gate / "target").write_text(str(repository))
    hold.touch()
    release = threading.Event()

    def release_if_unresponsive():
        deadline = time.monotonic() + 10
        while not started.exists() and not release.is_set() and time.monotonic() < deadline:
            release.wait(0.01)
        release.wait(4)
        hold.unlink(missing_ok=True)

    worker = threading.Thread(target=release_if_unresponsive)
    worker.start()
    try:
        before = time.monotonic()
        driver.script("""
          window.__ownedHistoryRead = {done: false};
          window.__TAURI_INTERNALS__.invoke('inspect_file_history', {repoId: arguments[0], revision: arguments[1], path: 'fixture.txt'})
            .then(value => { window.__ownedHistoryRead = {done: true, value}; },
                  error => { window.__ownedHistoryRead = {done: true, error}; });
        """, repo_id, head)
        deadline = time.monotonic() + 2
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert started.exists(), "Owned history Git command did not reach the gate"
        assert driver.invoke("cancel_git_operation", operationId="owned-not-running-history-probe") is False
        elapsed = time.monotonic() - before
        report["fileHistoryControlMs"] = elapsed * 1000
        assert elapsed < 2, "File-history reading blocked unrelated native controls"
        assert hold.exists(), "Responsiveness was only observed after the Git read finished"
        assert not driver.script("return window.__ownedHistoryRead.done")
    finally:
        hold.unlink(missing_ok=True)
        release.set()
        worker.join(timeout=12)
        assert not worker.is_alive(), "Owned history release thread did not stop"
        (gate / "target").unlink(missing_ok=True)
    driver.wait("return window.__ownedHistoryRead.done")
    result = driver.script("return window.__ownedHistoryRead")
    assert "error" not in result and [entry["oid"] for entry in result["value"]] == expected, result
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == original
    report["scenarios"].append("native-file-history-read-keeps-unrelated-controls-responsive")
    # An unreferenced changed-tree commit avoids putting the oversized subject
    # into the UI graph while exercising the real legacy-history IPC reader.
    blob = fixtures.git(repository, "hash-object", "-w", "--stdin", input=b"oversized history fixture\n")
    tree = fixtures.git(repository, "mktree", input=f"100644 blob {blob}\tfixture.txt\n".encode())
    oversized = fixtures.git(repository, "commit-tree", tree, "-p", head, input=b"m" * (2 * 1024 * 1024 + 1))
    try:
        driver.invoke("inspect_file_history", repoId=repo_id, revision=oversized, path="fixture.txt")
    except RuntimeError as error:
        assert json.loads(str(error))["kind"] == "historyOutputLimit", error
    else:
        raise AssertionError("Oversized file history returned a large or partial result")
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == original
    report["scenarios"].append("native-file-history-output-limit-refuses-partial-results")
    started.unlink()
    (gate / "target").write_text(str(repository))
    hold.touch()
    fallback = threading.Timer(20, lambda: hold.unlink(missing_ok=True))
    fallback.start()
    try:
        before = time.monotonic()
        try:
            driver.invoke("inspect_file_history", repoId=repo_id, revision=head, path="fixture.txt")
        except RuntimeError as error:
            assert json.loads(str(error))["kind"] == "historyTimeout", error
        else:
            raise AssertionError("A held file-history read did not reach its deadline")
        elapsed = time.monotonic() - before
        report["fileHistoryTimeoutMs"] = elapsed * 1000
        assert elapsed < 20 and hold.exists(), "The fixture fallback, not the native deadline, released Git"
        pid = int(started.read_text())
        assert not Path(f"/proc/{pid}").exists(), "Timed-out history Git process was not reaped"
    finally:
        fallback.cancel()
        hold.unlink(missing_ok=True)
        (gate / "target").unlink(missing_ok=True)
        fallback.join(timeout=2)
        assert not fallback.is_alive(), "Owned timeout fallback did not stop"
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == original
    report["scenarios"].append("native-file-history-deadline-reaps-owned-git-without-partial-results")


def blame_read_acceptance(driver, fixtures, report):
    repository = fixtures.repository("blame-responsiveness", commits=3)
    repo_id = open_ui(driver, repository)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    gate = fixtures.history_gate
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("blame")
    report["blameControlMs"] = {}
    try:
        for command in ("inspect_file_blame", "inspect_file_blame_page"):
            hold, started = gate / "hold", gate / "started"
            started.unlink(missing_ok=True)
            hold.touch()
            release = threading.Event()
            def release_if_unresponsive():
                deadline = time.monotonic() + 10
                while not started.exists() and not release.is_set() and time.monotonic() < deadline:
                    release.wait(0.01)
                release.wait(4)
                hold.unlink(missing_ok=True)
            worker = threading.Thread(target=release_if_unresponsive)
            worker.start()
            try:
                before = time.monotonic()
                driver.script("""
                  window.__ownedBlameRead = {done: false};
                  window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
                    value => { window.__ownedBlameRead = {done: true, value}; },
                    error => { window.__ownedBlameRead = {done: true, error}; });
                """, command, dict(repoId=repo_id, revision=head, path="fixture.txt", firstLine=1))
                deadline = time.monotonic() + 2
                while not started.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                assert started.exists(), "Owned blame Git process did not reach the gate"
                assert driver.invoke("cancel_git_operation", operationId="owned-blame-read-probe") is False
                elapsed = time.monotonic() - before
                report["blameControlMs"][command] = elapsed * 1000
                assert elapsed < 2 and hold.exists(), "Blame reading blocked unrelated native controls"
                assert not driver.script("return window.__ownedBlameRead.done")
            finally:
                hold.unlink(missing_ok=True)
                release.set()
                worker.join(timeout=12)
                assert not worker.is_alive()
            driver.wait("return window.__ownedBlameRead.done")
            result = driver.script("return window.__ownedBlameRead")
            assert "error" not in result, result
        report["scenarios"].append("native-legacy-and-paged-blame-keep-controls-responsive")
    finally:
        (gate / "target").unlink(missing_ok=True)
        (gate / "mode").unlink(missing_ok=True)
    large = fixtures.repository("large-blame-pages", commits=1)
    contents = "".join(f"élève😀 source line {index}\n" for index in range(1, 100001))
    (large / "fixture.txt").write_text(contents)
    (large / "no-final-newline.txt").write_text("tail")
    (large / "empty.txt").write_text("")
    (large / "blank-line.txt").write_text("\n")
    (large / "*.txt").write_text("literal pattern file\n")
    (large / "line\nname.txt").write_text("newline path source\n")
    (large / 'quote"').write_text("quoted path source\n")
    (large / "bell\x07.txt").write_text("bell path source\n")
    (large / " tail ").write_text("space path source\n")
    fixtures.git(large, "add", ".")
    fixtures.git(large, "commit", "-qm", "Unicode blame pages")
    revision = fixtures.git(large, "rev-parse", "HEAD")
    fixtures.git(large, "config", "i18n.logOutputEncoding", "UTF-16")
    fixtures.git(large, "config", "blame.blankBoundary", "true")
    large_id = open_ui(driver, large)
    index = (large / ".git/index").read_bytes()
    for file, expected_text in (("no-final-newline.txt", ["tail"]), ("empty.txt", []), ("blank-line.txt", [""]),
                                ("*.txt", ["literal pattern file"]), ("line\nname.txt", ["newline path source"]),
                                ('quote"', ["quoted path source"]), ("bell\x07.txt", ["bell path source"]), (" tail ", ["space path source"])):
        page = driver.invoke("inspect_file_blame_page", repoId=large_id, revision=revision, path=file, firstLine=1)
        assert [line["text"] for line in page["lines"]] == expected_text and page["nextLine"] is None, page
        assert all(line["path"] == file for line in page["lines"]), page
    for first in (1, 101, 99901):
        page = driver.invoke("inspect_file_blame_page", repoId=large_id, revision=revision, path="fixture.txt", firstLine=first)
        assert len(page["lines"]) == 100 and page["lines"][0]["lineNumber"] == first
        assert page["lines"][0]["text"] == f"élève😀 source line {first}"
        assert page["nextLine"] == (first + 100 if first < 99901 else None)
        assert all(line["oid"] == revision for line in page["lines"])
    driver.click_visible(f'.commit-row[data-commit-oid="{revision}"]')
    driver.wait("return !!document.querySelector('.commit-file[aria-label=\"Open diff for fixture.txt\"]')")
    driver.click_visible('.commit-file[aria-label="Open diff for fixture.txt"]')
    driver.wait("return !!document.querySelector('.diff-insight-toggle button:nth-child(3):not(:disabled)')")
    driver.click_text('.diff-insight-toggle button', 'Blame')
    driver.wait("return document.querySelectorAll('.blame-line').length === 100")
    driver.click_text('gc-file-blame button', 'Next lines')
    driver.wait("return document.querySelector('gc-file-blame header')?.textContent.includes('Lines 101–200')")
    element = driver.request("POST", driver.path("element"), {"using": "css selector", "value": "gc-file-blame input[name=line]"})
    element_id = element["element-6066-11e4-a52e-4f735466cecf"]
    driver.request("POST", driver.path(f"element/{element_id}/clear"), {})
    driver.request("POST", driver.path(f"element/{element_id}/value"), {"text": "99901"})
    driver.click_text('gc-file-blame button', 'Go')
    driver.wait("return document.querySelector('gc-file-blame header')?.textContent.includes('Lines 99901–100000')")
    assert driver.script("return document.querySelectorAll('.blame-line').length === 100")
    selected_commit = driver.script("return document.querySelector('.commit-row.selected')?.getAttribute('data-commit-oid')")
    assert selected_commit == revision
    driver.script("document.querySelector('#repository-reference-panel').focus()")
    driver.key("\ue036")  # WebDriver F6.
    assert driver.script("return document.activeElement?.matches('.blame-lines')"), "F6 skipped the visible blame viewport"
    driver.key("\ue015")  # WebDriver ArrowDown.
    driver.wait("return document.querySelector('.blame-lines').scrollTop > 0")
    assert driver.script("return document.querySelector('.commit-row.selected')?.getAttribute('data-commit-oid')") == selected_commit, "Scrolling blame navigated the graph"
    driver.script("const lines = document.querySelector('.blame-lines'); lines.scrollTop = 240; window.__blameScroll = lines.scrollTop")
    driver.click_text('.diff-insight-toggle button', 'Diff')
    driver.click_text('.diff-insight-toggle button', 'Blame')
    driver.wait("return document.querySelector('gc-file-blame header')?.textContent.includes('Lines 99901–100000')")
    assert driver.script("return document.querySelector('.blame-lines').scrollTop === window.__blameScroll"), "Returning to blame lost its viewport"
    driver.screenshot(Path(report["artifactsDirectory"]) / "blame-return.png")
    expected_history = fixtures.git(large, "log", "--encoding=UTF-8", "--format=%H", revision, "--", "fixture.txt").splitlines()
    driver.click_text('.diff-insight-toggle button', 'History')
    driver.wait("return !!document.querySelector('gc-file-history .history-entry') && document.querySelector('gc-file-history header').textContent.trim().endsWith(' · complete')")
    driver.click_text('.diff-insight-toggle button', 'Diff')
    driver.click_text('.diff-insight-toggle button', 'History')
    assert driver.script("return document.querySelectorAll('gc-file-history .history-entry').length") == len(expected_history), "Returning to history lost its loaded results"
    assert driver.script("return !![...document.querySelectorAll('gc-file-history button')].find(button => button.textContent.trim() === 'Reload file history' && !button.disabled)")
    driver.script("document.querySelector('#repository-reference-panel').focus()")
    driver.key("\ue036")
    assert driver.script("return document.activeElement?.matches('gc-file-history .history-list')"), "F6 skipped the visible file history viewport"
    driver.script("[...document.querySelectorAll('gc-file-history button')].find(button => button.textContent.trim() === 'Reload file history').focus()")
    driver.key("\ue036")
    assert driver.script("return document.activeElement?.id === 'repository-commit-panel'"), "F6 lost its region when starting from a history control"
    driver.screenshot(Path(report["artifactsDirectory"]) / "history-return.png")
    driver.script("document.querySelector('gc-file-history .history-list').focus()")
    driver.key("\ue037")  # WebDriver F7.
    driver.wait("return document.activeElement?.matches('.focus-diff-view, .split-diff-body') && document.querySelector('.diff-primary-view')?.getClientRects().length > 0")
    assert driver.script("return document.querySelector('.history-insight').getClientRects().length === 0"), "F7 navigated a hidden diff without revealing it"
    previous_layout = driver.script("return document.querySelector('[aria-label=\"Diff layout\"] button[aria-pressed=true]').getAttribute('data-diff-mode')")
    assert previous_layout in ("hunk", "inline", "split")
    driver.click_visible('[aria-label="Diff layout"] button[data-diff-mode="split"]')
    driver.wait("return !!document.querySelector('.split-diff-body')")
    driver.script("document.querySelector('#repository-reference-panel').focus()")
    driver.key("\ue036")
    assert driver.script("return document.activeElement?.matches('.split-diff-body')"), "F6 focused the split frame instead of its source viewport"
    driver.script("document.querySelector('.split-diff-body').scrollTop = 0")
    driver.key("\ue015")
    driver.wait("return document.querySelector('.split-diff-body').scrollTop > 0")
    assert driver.script("return document.querySelector('.commit-row.selected')?.getAttribute('data-commit-oid')") == selected_commit
    driver.screenshot(Path(report["artifactsDirectory"]) / "split-keyboard-scroll.png")
    driver.click_visible(f'[aria-label="Diff layout"] button[data-diff-mode="{previous_layout}"]')
    assert driver.script("return [...document.querySelectorAll('style')].every(style => style.sheet && style.nonce)"), "Deferred blame styles violated production CSP"
    assert fixtures.git(large, "rev-parse", "HEAD") == revision
    assert (large / ".git/index").read_bytes() == index
    assert (large / "fixture.txt").read_text() == contents
    report["scenarios"].append("native-ui-large-unicode-blame-pages-bound-rendering-and-exact-attribution")
    report["scenarios"].append("native-file-insight-keyboard-scroll-and-region-navigation")
    report["scenarios"].append("native-visible-diff-change-shortcut-and-split-keyboard-scrolling")
    diff_layout_continuity(driver, fixtures, report)
    production_query_isolation(driver, fixtures, report)


def diff_layout_continuity(driver, fixtures, report):
    repository = fixtures.repository("diff-layout-continuity", commits=1)
    file = repository / "fixture.txt"
    file.write_text("".join(f"old source line {line}\n" for line in range(1, 501)))
    fixtures.git(repository, "add", "fixture.txt")
    fixtures.git(repository, "commit", "-qm", "Before layout source")
    contents = "".join(f"new source line {line} " + "long readable source content " * 6 + "\n" for line in range(1, 501))
    file.write_text(contents)
    fixtures.git(repository, "add", "fixture.txt")
    fixtures.git(repository, "commit", "-qm", "After layout source")
    revision = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    open_ui(driver, repository)
    driver.click_visible(f'.commit-row[data-commit-oid="{revision}"]')
    driver.wait("return !!document.querySelector('.commit-file[aria-label=\"Open diff for fixture.txt\"]')")
    driver.click_visible('.commit-file[aria-label="Open diff for fixture.txt"]')
    driver.wait("return !!document.querySelector('.diff-primary-view')")
    previous_layout = driver.script("return document.querySelector('[data-diff-mode][aria-pressed=true]').getAttribute('data-diff-mode')")
    previous_wrap = driver.script("return document.querySelector('.diff-workspace').classList.contains('word-wrap')")

    def painted():
        driver.script("window.__layoutPainted = false; requestAnimationFrame(() => requestAnimationFrame(() => {window.__layoutPainted = true}))")
        driver.wait("return window.__layoutPainted")

    geometry = """return (() => {
      const primary = document.querySelector('.diff-primary-view');
      const scroller = primary?.querySelector('.split-diff-body') ?? primary;
      const line = primary?.querySelector('[data-diff-new-line="60"]');
      if (!line || !scroller) return null;
      const bounds = scroller.getBoundingClientRect(), rect = line.getBoundingClientRect();
      return {offset: rect.top - bounds.top, visible: rect.bottom > bounds.top && rect.top < bounds.bottom};
    })()"""
    for wrapped in (False, True):
        if driver.script("return document.querySelector('.diff-workspace').classList.contains('word-wrap')") != wrapped:
            driver.click_visible('.diff-wrap-toggle, .diff-footer-wrap-toggle')
        driver.click_visible('[data-diff-mode="split"]')
        driver.wait("return !!document.querySelector('.split-diff-body [data-diff-new-line=\"60\"]')")
        driver.click_visible('.split-diff-body')
        driver.script("document.querySelector('.diff-primary-view [data-diff-new-line=\"60\"] code').scrollIntoView({block: 'start', behavior: 'auto'})")
        painted()
        before = driver.script(geometry)
        assert before and before["visible"], before
        for mode in ("hunk", "inline", "split"):
            driver.click_visible(f'[data-diff-mode="{mode}"]')
            driver.wait(f"return document.querySelector('[data-diff-mode=\"{mode}\"]')?.getAttribute('aria-pressed') === 'true'")
            painted()
            after = driver.script(geometry)
            assert after and after["visible"] and abs(after["offset"] - before["offset"]) < 8, (wrapped, mode, before, after)
            assert driver.script("return document.activeElement?.getAttribute('data-diff-mode')") == mode
            name = ("wrapped-" if wrapped else "") + mode
            report.setdefault("diffLayoutOffsetPx", {})[name] = after["offset"] - before["offset"]
            driver.screenshot(Path(report["artifactsDirectory"]) / f"diff-layout-{name}.png")
    if driver.script("return document.querySelector('.diff-workspace').classList.contains('word-wrap')") != previous_wrap:
        driver.click_visible('.diff-wrap-toggle, .diff-footer-wrap-toggle')
    driver.click_visible(f'[data-diff-mode="{previous_layout}"]')
    assert fixtures.git(repository, "rev-parse", "HEAD") == revision
    assert (repository / ".git/index").read_bytes() == index
    assert file.read_text() == contents
    report["scenarios"].append("native-ui-diff-layout-keeps-source-line-and-toolbar-focus-without-git-mutation")


def production_query_isolation(driver, fixtures, report):
    repository = fixtures.repository("production-query-isolation", commits=3)
    revision = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    open_ui(driver, repository)
    original_url = driver.script("return location.href")
    try:
        # Navigate normally: do not change component state or replace the native
        # bridge. These development-only parameters must be inert in a release.
        driver.script("""
          const url = new URL(location.href);
          url.search = 'compare-commits&diff-viewer=split&coauthors&merge-tool';
          history.replaceState(null, '', url.href);
        """)
        driver.reload()
        driver.wait("return document.querySelectorAll('.commit-row[data-commit-oid]').length >= 3", 60)
        driver.script("window.__queryPainted = false; requestAnimationFrame(() => requestAnimationFrame(() => {window.__queryPainted = true}))")
        driver.wait("return window.__queryPainted")
        assert driver.script("return !document.querySelector('.merge-tool, .diff-workspace, .comparison-title')"), "Release URL parameters seeded a fabricated inspection"
        driver.click('.wip-nav')
        driver.wait("return !!document.querySelector('[aria-label=\"Commit summary\"]')")
        assert driver.script("return document.querySelector('[aria-label=\"Commit summary\"]').value") == "", "Release URL parameters changed the commit draft"
        assert driver.script("return document.querySelector('.add-coauthor').getAttribute('aria-expanded')") == "false"
        assert fixtures.git(repository, "rev-parse", "HEAD") == revision
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / "fixture.txt").read_bytes() == contents
        report["scenarios"].append("native-release-ignores-development-preview-query-initializers")
    finally:
        driver.script("history.replaceState(null, '', arguments[0])", original_url)
        driver.reload()
        driver.wait("return !!document.querySelector('.wip-nav')", 60)


def stash_pop_partial_ui(driver, fixtures, report):
    repository = fixtures.repository("ui-stash-pop-partial", commits=3)
    file = repository / "fixture.txt"
    head = fixtures.git(repository, "rev-parse", "HEAD")
    file.write_text("owned pop UI contents\n")
    fixtures.git(repository, "stash", "push", "-m", "Owned partial pop")
    oid = fixtures.git(repository, "rev-parse", "refs/stash")
    repo_id = open_ui(driver, repository)
    lock = repository / ".git/refs/stash.lock"
    lock.write_text("owned acceptance lock\n")
    try:
        driver.wait("return !!document.querySelector('[title=\"Pop the latest stash\"]:not(:disabled)')")
        driver.click('[title="Pop the latest stash"]')
        driver.wait("return document.querySelector('.error-toast')?.textContent.includes('Do not apply or pop')")
        assert file.read_text() == "owned pop UI contents\n"
        assert fixtures.git(repository, "rev-parse", "refs/stash") == oid
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
    finally:
        lock.unlink()
    # Complete only removal; re-running pop would apply the saved changes again.
    assert not driver.invoke("drop_stash", repoId=repo_id, reference="stash@{0}", expectedOid=oid)["stashes"]
    assert file.read_text() == "owned pop UI contents\n"
    report["scenarios"].append("native-ui-pop-partial-success-warns-without-automatic-reapply")


def reference_namespace_names(driver, fixtures, report):
    repository = fixtures.repository("reference-namespace-names", commits=3)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    fixtures.git(repository, "remote", "add", "origin", ".")
    fixtures.git(repository, "update-ref", "refs/remotes/origin/main", head)
    fixtures.git(repository, "branch", "--set-upstream-to=refs/remotes/origin/main", "main")
    fixtures.git(repository, "tag", "-a", "main", "-m", "Owned shared-name tag", head)
    fixtures.git(repository, "tag", "origin/main", head)
    for ambiguous in ("true", "false"):
        fixtures.git(repository, "config", "core.warnAmbiguousRefs", ambiguous)
        opened = driver.invoke("open_repository", path=str(repository))
        branches = {branch["fullName"]: branch for branch in opened["branches"]}
        assert branches["refs/heads/main"]["name"] == "main", branches
        assert branches["refs/heads/main"]["upstream"] == "origin/main", branches
        assert branches["refs/remotes/origin/main"]["name"] == "origin/main", branches
        # First-frame snapshots intentionally defer tags; refresh their metadata.
        opened = driver.invoke("refresh_repository", repoId=opened["id"])
        tags = {tag["fullName"]: tag for tag in opened["tags"]}
        assert tags["refs/tags/main"]["name"] == "main", tags
        assert tags["refs/tags/origin/main"]["name"] == "origin/main", tags
        assert driver.invoke("inspect_tag", repoId=opened["id"], name=tags["refs/tags/main"]["name"])["oid"] == head
    selected = tags["refs/tags/main"]
    after = driver.invoke("manage_reference", repoId=opened["id"], action="delete-tag",
                          name=selected["name"], expectedOid=selected["oid"], message=None, url=None)
    assert [tag["name"] for tag in after["tags"]] == ["origin/main"]
    assert fixtures.git(repository, "rev-parse", "refs/heads/main") == head
    assert fixtures.git(repository, "rev-parse", "refs/remotes/origin/main") == head
    assert fixtures.git(repository, "symbolic-ref", "HEAD") == "refs/heads/main"
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == contents
    report["scenarios"].append("native-shared-branch-tag-names-preserve-reference-action-scope")


def transport_cancel_after_parent_exit(driver, fixtures, report):
    repository = fixtures.repository("transport-inherited-pipe", commits=3)
    fixtures.git(repository, "remote", "add", "origin", ".")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    gate = fixtures.history_gate
    for name in ("started", "inherited-pid"):
        (gate / name).unlink(missing_ok=True)
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("fetch")
    (gate / "failure").write_text("0")
    (gate / "inherit-stdout").touch()
    operation = str(uuid.uuid4())
    child = parent = None
    try:
        args = dict(repoId=repo_id, remote="origin", operationId=operation)
        driver.script("window.__ownedTransportCancel = {done:false}; "
                      f"window.__TAURI_INTERNALS__.invoke('fetch_repository', {json.dumps(args)})"
                      ".then(value => window.__ownedTransportCancel = {done:true,value})"
                      ".catch(error => window.__ownedTransportCancel = {done:true,error});")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if (gate / "started").exists() and (gate / "inherited-pid").exists():
                parent = int((gate / "started").read_text())
                child = int((gate / "inherited-pid").read_text())
                if not Path(f"/proc/{parent}").exists():
                    break
            time.sleep(0.01)
        assert parent is not None and not Path(f"/proc/{parent}").exists(), "Owned transport parent was not reaped"
        assert child is not None and os.getpgid(child) == parent, "Unexpected fixture child process group"
        before = time.monotonic()
        assert driver.invoke("cancel_git_operation", operationId=operation) is True
        deadline = before + 2
        while time.monotonic() < deadline:
            result = driver.script("return window.__ownedTransportCancel")
            if result["done"]:
                break
            time.sleep(0.01)
        assert result["done"], "Transport cancellation waited for inherited output after Git exited"
        assert result["error"]["kind"] == "operationCancelled", result
        elapsed = (time.monotonic() - before) * 1000
        assert elapsed < 1000, "Transport cancellation was not prompt after parent exit"
        report["transportInheritedPipeCancelMs"] = elapsed
        try:
            state = Path(f"/proc/{child}/stat").read_text().rsplit(")", 1)[1].split()[0]
        except FileNotFoundError:
            state = None
        assert state in (None, "Z"), "Cancelled transport descendant is still running"
    finally:
        # Signal only the exact owned sleep child, after verifying its fixture group.
        if child is not None:
            try:
                if os.getpgid(child) == parent:
                    os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for name in ("target", "mode", "failure", "inherit-stdout", "started", "inherited-pid"):
            (gate / name).unlink(missing_ok=True)
        driver.wait("return window.__ownedTransportCancel?.done")
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == contents
    report["scenarios"].append("native-transport-cancel-after-parent-exit-reaps-inherited-pipe-child")


def transport_config_cancellation(driver, fixtures, report):
    repository = fixtures.repository("transport-config-cancellation", commits=3)
    fixtures.git(repository, "remote", "add", "origin", ".")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    gate = fixtures.history_gate
    hold, started = gate / "hold", gate / "started"
    started.unlink(missing_ok=True)
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("--get-regexp")
    hold.touch()
    fallback = threading.Timer(8, lambda: hold.unlink(missing_ok=True))
    fallback.start()
    operation = str(uuid.uuid4())
    try:
        args = dict(repoId=repo_id, remote="origin", operationId=operation)
        driver.script("window.__ownedConfigCancel = {done:false}; "
                      f"window.__TAURI_INTERNALS__.invoke('fetch_repository', {json.dumps(args)})"
                      ".then(value => window.__ownedConfigCancel = {done:true,value})"
                      ".catch(error => window.__ownedConfigCancel = {done:true,error});")
        deadline = time.monotonic() + 3
        parent = None
        while time.monotonic() < deadline:
            try:
                parent = int(started.read_text())
                break
            except (FileNotFoundError, ValueError):
                time.sleep(0.01)
        assert parent is not None, "Transport did not reach the owned configuration gate"
        before = time.monotonic()
        assert driver.invoke("cancel_git_operation", operationId=operation) is True
        deadline = before + 2
        while time.monotonic() < deadline:
            result = driver.script("return window.__ownedConfigCancel")
            if result["done"]:
                break
            time.sleep(0.01)
        assert result["done"], "Transport configuration query ignored cancellation until its gate was released"
        assert result["error"]["kind"] == "operationCancelled", result
        elapsed = (time.monotonic() - before) * 1000
        assert elapsed < 1000 and hold.exists(), "Transport configuration cancellation was not prompt"
        assert not Path(f"/proc/{parent}").exists(), "Cancelled configuration process was not reaped"
        report["transportConfigCancelMs"] = elapsed
    finally:
        fallback.cancel()
        hold.unlink(missing_ok=True)
        for name in ("target", "mode", "started"):
            (gate / name).unlink(missing_ok=True)
        driver.wait("return window.__ownedConfigCancel?.done")
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == contents
    report["scenarios"].append("native-transport-config-preflight-cancels-without-fetch-or-file-changes")


def clone_url_policy(driver, fixtures, report):
    source = fixtures.repository("clone-url-policy-source", commits=3)
    head = fixtures.git(source, "rev-parse", "HEAD")
    index = (source / ".git/index").read_bytes()
    contents = (source / "fixture.txt").read_bytes()
    config = Path(fixtures.env["GIT_CONFIG_GLOBAL"])
    original = config.read_bytes()
    remote = "https://clone-policy.example.test/repository.git"
    unsafe = ('[url "https://fixture-user:fixture-not-a-secret@clone-policy.example.test/"]\n'
              'insteadOf = https://clone-policy.example.test/\n')
    # Even the unfixed baseline may not send the synthetic userinfo anywhere.
    local_only = '[protocol "https"]\nallow = never\n'
    rule = fixtures.root / "clone-url-policy-rule"
    rule.write_text(unsafe)
    try:
        for kind in ("global", "destination", "remote"):
            folder = "clone-url-policy-" + kind
            destination = fixtures.root / folder
            if kind == "global":
                setting = unsafe
            elif kind == "destination":
                setting = f'[includeIf "gitdir:{destination}/.git"]\npath = {rule}\n'
            else:
                setting = f'[includeIf "hasconfig:remote.*.url:{remote}"]\npath = {rule}\n'
            config.write_bytes(original + (local_only + setting).encode())
            try:
                driver.invoke("clone_repository", remote=remote, parentPath=str(fixtures.root), folder=folder,
                              branch=None, depth=None, recurseSubmodules=False, operationId=str(uuid.uuid4()))
            except RuntimeError as error:
                detail = json.loads(str(error))
                assert detail["kind"] == "credentialsInUrl", detail
                assert "fixture-not-a-secret" not in json.dumps(detail), detail
            else:
                raise AssertionError("Clone accepted an embedded-credential rewrite")
            assert not destination.exists(), "Rejected clone left a destination behind"
        # A safe rewrite still clones through the actual packaged command.
        safe = f'[url "{source}"]\ninsteadOf = {remote}\n'
        config.write_bytes(original + (local_only + safe).encode())
        cloned = driver.invoke("clone_repository", remote=remote, parentPath=str(fixtures.root),
                               folder="clone-url-policy-safe", branch="main", depth=None,
                               recurseSubmodules=False, operationId=str(uuid.uuid4()))
        assert cloned["headOid"] == head
    finally:
        config.write_bytes(original)
    # Block only the new configuration-only command, not clone itself. A
    # cancelled preflight must return while the gate is still held.
    gate = fixtures.history_gate
    destination = fixtures.root / "clone-url-policy-cancelled"
    hold, started = gate / "hold", gate / "started"
    started.unlink(missing_ok=True)
    (gate / "target").write_text(str(destination))
    (gate / "mode").write_text("--get-url")
    hold.touch()
    fallback = threading.Timer(8, lambda: hold.unlink(missing_ok=True))
    fallback.start()
    operation = str(uuid.uuid4())
    try:
        args = dict(remote=str(source), parentPath=str(fixtures.root), folder=destination.name,
                    branch="main", depth=None, recurseSubmodules=False, operationId=operation)
        driver.script("window.__ownedCloneReviewCancel = {done:false}; "
                      f"window.__TAURI_INTERNALS__.invoke('clone_repository', {json.dumps(args)})"
                      ".then(value => window.__ownedCloneReviewCancel = {done:true,value})"
                      ".catch(error => window.__ownedCloneReviewCancel = {done:true,error});")
        deadline = time.monotonic() + 3
        parent = None
        while time.monotonic() < deadline:
            try:
                parent = int(started.read_text())
                break
            except (FileNotFoundError, ValueError):
                time.sleep(0.01)
        assert parent is not None, "Clone did not reach URL review"
        before = time.monotonic()
        assert driver.invoke("cancel_git_operation", operationId=operation) is True
        driver.wait("return window.__ownedCloneReviewCancel?.done", 2)
        result = driver.script("return window.__ownedCloneReviewCancel")
        assert result["error"]["kind"] == "operationCancelled", result
        elapsed = (time.monotonic() - before) * 1000
        assert elapsed < 1000 and hold.exists(), "Clone URL review cancellation was not prompt"
        assert not Path(f"/proc/{parent}").exists(), "Cancelled clone review process was not reaped"
        assert not destination.exists(), "Cancelled review left an empty destination behind"
        report["cloneUrlReviewCancelMs"] = elapsed
    finally:
        fallback.cancel()
        hold.unlink(missing_ok=True)
        for name in ("target", "mode", "started"):
            (gate / name).unlink(missing_ok=True)
        driver.wait("return window.__ownedCloneReviewCancel?.done")
    assert fixtures.git(source, "rev-parse", "HEAD") == head
    assert (source / ".git/index").read_bytes() == index
    assert (source / "fixture.txt").read_bytes() == contents
    report["scenarios"].append("native-clone-rewrite-policy-refuses-credentials-before-transport")


def clone_template_password_policy(driver, fixtures, report):
    source = fixtures.repository("template-policy-source", commits=3)
    head = fixtures.git(source, "rev-parse", "HEAD")
    index = (source / ".git/index").read_bytes()
    contents = (source / "fixture.txt").read_bytes()
    template = fixtures.root / "clone-policy-template"
    template.mkdir(mode=0o700)
    (template / "owned-marker").write_bytes(b"keep safe template files\n")
    config = Path(fixtures.env["GIT_CONFIG_GLOBAL"])
    original = config.read_bytes()
    remote = "https://template-policy.example.test/repository.git"
    setting = (f'[init]\ntemplateDir = {template}\n[transfer]\ncredentialsInUrl = allow\n'
               '[protocol "https"]\nallow = never\n[protocol "ssh"]\nallow = never\n')
    try:
        config.write_bytes(original + setting.encode())
        for scheme in ("https", "ssh"):
            (template / "config").write_text(
                '[core]\nbare = false\n'
                f'[url "{scheme}://fixture-user:fixture-not-a-secret@template-policy.example.test/"]\n'
                'insteadOf = https://template-policy.example.test/\n')
            destination = fixtures.root / ("template-policy-refused-" + scheme)
            try:
                driver.invoke("clone_repository", remote=remote, parentPath=str(fixtures.root),
                              folder=destination.name, branch=None, depth=None, recurseSubmodules=False,
                              operationId=str(uuid.uuid4()))
            except RuntimeError as error:
                detail = json.loads(str(error))
                assert detail["kind"] == "credentialsInUrl", detail
                assert "fixture-not-a-secret" not in json.dumps(detail), detail
                assert "fixture-user" not in json.dumps(detail), detail
            else:
                raise AssertionError("Clone accepted a template password URL")
            assert not destination.exists(), "Refused template clone left a destination behind"
        (template / "config").write_text(f'[core]\nbare = false\n[url "{source}"]\ninsteadOf = {remote}\n')
        cloned = driver.invoke("clone_repository", remote=remote, parentPath=str(fixtures.root),
                               folder="template-policy-safe", branch="main", depth=None,
                               recurseSubmodules=False, operationId=str(uuid.uuid4()))
        assert cloned["headOid"] == head
        assert (fixtures.root / "template-policy-safe/.git/owned-marker").read_bytes() == b"keep safe template files\n"
    finally:
        config.write_bytes(original)
    assert fixtures.git(source, "rev-parse", "HEAD") == head
    assert (source / ".git/index").read_bytes() == index
    assert (source / "fixture.txt").read_bytes() == contents
    report["scenarios"].append("native-template-password-urls-refused-with-safe-template-preserved")


def busy_workspace_menu_focus(driver, fixtures, original_repository, report):
    repository = fixtures.repository("busy-workspace-menu", commits=3)
    fixtures.git(repository, "remote", "add", "origin", ".")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    open_ui(driver, repository)
    gate = fixtures.history_gate
    hold, started = gate / "hold", gate / "started"
    started.unlink(missing_ok=True)
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("fetch")
    hold.touch()
    fallback = threading.Timer(15, lambda: hold.unlink(missing_ok=True))
    fallback.start()
    try:
        # A real renderer action owns the pending fetch; do not patch Angular
        # state or replace the production bridge to manufacture a busy menu.
        driver.click('[aria-label="Fetch all remotes"]')
        deadline = time.monotonic() + 3
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert started.exists(), "Native menu fixture did not reach the owned fetch gate"
        driver.script("document.querySelector('.workspace-toggle').focus()")
        driver.key("\ue004")
        assert driver.script("return document.activeElement !== document.body"), "No native busy Tab destination"
        driver.script("document.activeElement.setAttribute('data-native-busy-tab-target', '')")
        driver.click('.workspace-toggle')
        driver.wait("return !!document.querySelector('.workspace-menu')")
        assert driver.script("return !document.querySelector('.workspace-menu button:not(:disabled)')"), \
            "Workspace actions were not disabled during the held fetch"
        driver.key("\ue004")
        driver.wait("return !document.querySelector('.workspace-menu')", 2)
        assert driver.script("return document.activeElement?.hasAttribute('data-native-busy-tab-target')"), \
            "Busy menu Tab did not resume normal focus order"
        assert hold.exists(), "Busy menu check outlasted the owned fetch hold"
    finally:
        fallback.cancel()
        hold.unlink(missing_ok=True)
        for name in ("target", "mode", "started"):
            (gate / name).unlink(missing_ok=True)
        driver.script("document.querySelectorAll('[data-native-busy-tab-target]').forEach(element => element.removeAttribute('data-native-busy-tab-target'))")
        driver.wait("return !document.querySelector('[aria-label=\"Fetch all remotes\"]')?.disabled")
        open_ui(driver, original_repository)
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (repository / "fixture.txt").read_bytes() == contents
    report["scenarios"].append("native-busy-workspace-menu-tab-dismissal-preserves-focus")


def authenticated_push_rejection(driver, fixtures, original_repository, report):
    repository = fixtures.repository("prompted-push-rejection", commits=3)
    remote = fixtures.root / "prompted-push-remote.git"
    fixtures.git(repository, "clone", "--bare", str(repository), str(remote))
    fixtures.git(repository, "remote", "add", "origin", str(remote))
    fixtures.git(repository, "fetch", "origin")
    fixtures.git(repository, "branch", "--set-upstream-to=origin/main", "main")
    (repository / "fixture.txt").write_text("unpublished local commit\n")
    fixtures.git(repository, "commit", "-qam", "Local commit before refused push")
    hooks = repository / ".git/owned-prompt-hooks"
    hooks.mkdir(mode=0o700)
    hook = hooks / "pre-push"
    # This is a real Git hook and shipped askpass invocation, not a simulated
    # authentication event. Server authentication is qualified by the SSH suite.
    hook.write_text(
        '#!/bin/sh\n'
        'answer="$("$GIT_ASKPASS" "Enter passphrase for key \'/native-fixture\':")" || exit 1\n'
        '[ "$answer" = "native-fixture-not-a-real-secret" ] || exit 1\n'
        'printf "%s\\n" "Owned hook refuses push: native-fixture-not-a-real-secret" >&2\n'
        'exit 1\n')
    hook.chmod(0o700)
    fixtures.git(repository, "config", "core.hooksPath", str(hooks))
    open_ui(driver, repository)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    remote_head = fixtures.git(remote, "rev-parse", "main")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    try:
        push = '.toolbar-split:has(> [aria-label="Push options"]) > .split-main'
        driver.wait(f"return !!document.querySelector({json.dumps(push)}) && !document.querySelector({json.dumps(push)}).disabled")
        driver.click(push)
        driver.wait("return !!document.querySelector('gc-authentication dialog[open] input[type=password]')", 10)
        driver.script("""
          const input = document.querySelector('gc-authentication input');
          input.value = 'native-fixture-not-a-real-secret';
          input.dispatchEvent(new Event('input', {bubbles: true}));
        """)
        driver.click('gc-authentication button[type=submit]')
        driver.wait("return !document.querySelector('gc-authentication dialog[open]')", 10)
        driver.wait("return !!document.querySelector('.error-toast')", 10)
        message = driver.script("return document.querySelector('.error-toast').textContent")
        assert "remote rejected the push" in message, message
        assert "authentication is required" not in message.lower(), message
        assert "native-fixture-not-a-real-secret" not in message, message
        assert driver.invoke("pending_authentication") == []
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert fixtures.git(remote, "rev-parse", "main") == remote_head
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / "fixture.txt").read_bytes() == contents
    finally:
        # Restore the UI only after the real operation and its prompt finished.
        if driver.script("return !!document.querySelector('.error-toast')"):
            driver.click('[aria-label="Dismiss error"]')
        open_ui(driver, original_repository)
    report["scenarios"].append("native-ui-push-rejection-after-real-askpass-remains-actionable")


def local_remote_error_guidance(driver, fixtures, original_repository, report, *, fixture_name, names, scenario):
    repository = fixtures.repository(fixture_name, commits=3)
    fixtures.git(repository, "remote", "add", "origin", str(fixtures.root / names[0]))
    open_ui(driver, repository)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    try:
        for name in names:
            missing = fixtures.root / name
            assert not missing.exists()
            fixtures.git(repository, "remote", "set-url", "origin", str(missing))
            driver.wait("return !document.querySelector('[aria-label=\"Fetch all remotes\"]')?.disabled")
            driver.click('[aria-label="Fetch all remotes"]')
            driver.wait("return !!document.querySelector('.error-toast')", 10)
            message = driver.script("return document.querySelector('.error-toast').textContent")
            assert "Git transport failed" in message, message
            assert "HTTPS connection" not in message, message
            assert driver.invoke("pending_authentication") == []
            assert not missing.exists()
            assert fixtures.git(repository, "rev-parse", "HEAD") == head
            assert (repository / ".git/index").read_bytes() == index
            assert (repository / "fixture.txt").read_bytes() == contents
            driver.click('[aria-label="Dismiss error"]')
    finally:
        if driver.script("return !!document.querySelector('.error-toast')"):
            driver.click('[aria-label="Dismiss error"]')
        open_ui(driver, original_repository)
    report["scenarios"].append(scenario)


def local_remote_tls_words(driver, fixtures, original_repository, report):
    local_remote_error_guidance(driver, fixtures, original_repository, report,
        fixture_name="misleading-tls-remote",
        names=("certificate-assets.git", "ssl-assets.git", "SSL certificate problem.git"),
        scenario="native-ui-local-remote-tls-words-do-not-misreport-certificate-failure")


def local_remote_quoted_targets(driver, fixtures, original_repository, report):
    local_remote_error_guidance(driver, fixtures, original_repository, report,
        fixture_name="misleading-quoted-target",
        names=("authentication failed.git", "Host key verification failed.git", "[rejected].git",
               "authentication failed' quoted.git"),
        scenario="native-ui-quoted-target-names-do-not-impersonate-transport-failures")


def authenticated_lfs_lock_listing(driver, fixtures, report):
    """Real locking HTTP + native IPC; this does not qualify a lock dialog."""
    import base64
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import shlex

    repository = fixtures.repository("authenticated-lfs-locks", commits=1)
    expected = {"id": "owned-lock", "path": "fixture.txt", "owner": "Native Fixture",
                "lockedAt": "2026-10-24T10:00:00Z", "ours": True}
    authorization = "Basic " + base64.b64encode(b"fixture-user:owned-lock-fixture-token").decode()
    authorized_requests = []
    requests = []
    connections = []

    class Server(HTTPServer):
        def get_request(self):
            connection, address = super().get_request()
            connections.append(address)
            return connection, address

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(2)

        def log_message(self, *_args):
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 16 * 1024:
                self.send_error(400)
                return
            self.rfile.read(length)
            requests.append(self.path)
            authenticated = self.headers.get("Authorization") == authorization
            if self.path != "/locks/verify":
                status, value = 404, {"message": "Unknown fixture endpoint"}
            elif not authenticated:
                status, value = 401, {"message": "Authentication required"}
            else:
                authorized_requests.append(self.path)
                status, value = 200, {"ours": [{
                    "id": expected["id"], "path": expected["path"],
                    "owner": {"name": expected["owner"]}, "locked_at": expected["lockedAt"],
                }], "theirs": []}
            body = json.dumps(value).encode()
            self.send_response(status)
            if status == 401:
                self.send_header("WWW-Authenticate", 'Basic realm="owned-lock-fixture"')
            self.send_header("Content-Type", "application/vnd.git-lfs+json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

    server = Server(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
    worker.start()
    try:
        helper = fixtures.root / "owned noninteractive lock helper"
        helper_log = fixtures.root / "owned-lock-helper-modes"
        # This helper only releases its saved fixture credential when the caller
        # explicitly requests noninteractive retrieval. Both listing requests
        # must use that same policy; no personal helper or credential is used.
        helper.write_text(
            "#!/bin/sh\ncat >/dev/null\n"
            'if [ "$1" = get ]; then\n'
            f"  printf '%s\\n' \"${{GIT_CREDENTIAL_INTERACTIVE-unconfigured}}\" >> {shlex.quote(str(helper_log))}\n"
            '  if [ "$GIT_CREDENTIAL_INTERACTIVE" = false ]; then\n'
            "    printf 'username=fixture-user\\npassword=owned-lock-fixture-token\\n\\n'\n"
            "  fi\nfi\n")
        helper.chmod(0o700)
        helper_config = "!" + shlex.quote(str(helper))
        fixtures.git(repository, "config", "credential.helper", "")
        fixtures.git(repository, "config", "--add", "credential.helper", helper_config)
        endpoint = f"http://127.0.0.1:{server.server_port}/"
        fixtures.git(repository, "config", "lfs.url", endpoint)
        opened = driver.invoke("open_repository", path=str(repository))
        repo_id = opened["id"]
        head = fixtures.git(repository, "rev-parse", "HEAD")
        index = (repository / ".git/index").read_bytes()
        contents = (repository / "fixture.txt").read_bytes()
        listed = driver.invoke("lfs_locks", repoId=repo_id)
        assert listed["locks"] == [expected], (
            "Authenticated LFS lock listing lost a server-held lock", listed)
        assert authorized_requests and set(helper_log.read_text().splitlines()) == {"false"}

        def refused_before_contact(expected_kind="credentialsInUrl"):
            before = len(requests)
            connections_before = len(connections)
            try:
                result = driver.invoke("lfs_locks", repoId=repo_id)
            except RuntimeError as error:
                result = json.loads(str(error))
                assert result["kind"] == expected_kind, result
                assert "owned-lock-fixture-token" not in json.dumps(result), result
            else:
                raise AssertionError(("Refused endpoint configuration was accepted", expected_kind, result))
            assert len(requests) == before, "Endpoint policy was checked only after contacting the server"
            assert len(connections) == connections_before, "Endpoint policy opened a connection before refusal"
            assert not driver.invoke("pending_authentication")

        credential_endpoint = endpoint.replace("http://", "http://fixture-user:owned-lock-fixture-token@", 1)
        for key in ("lfs.url", "lfs.pushurl", "remote.owned.lfsurl", "remote.owned.lfspushurl"):
            fixtures.git(repository, "config", key, credential_endpoint)
            refused_before_contact()
            if key == "lfs.url":
                fixtures.git(repository, "config", key, endpoint)
            else:
                fixtures.git(repository, "config", "--unset-all", key)
        configuration_file = repository / ".lfsconfig"
        fixtures.git(repository, "config", "-f", str(configuration_file), "lfs.url", credential_endpoint)
        fixtures.git(repository, "config", "--unset-all", "lfs.url")
        refused_before_contact()
        fixtures.git(repository, "config", "lfs.url", endpoint)
        file_bytes = configuration_file.read_bytes()
        configuration = (repository / ".git/config").read_bytes()
        assert driver.invoke("lfs_locks", repoId=repo_id)["locks"] == [expected]
        assert configuration_file.read_bytes() == file_bytes
        assert (repository / ".git/config").read_bytes() == configuration
        configuration_file.unlink()
        configuration_path = repository / ".git/config"
        record = f"\n[lfs]\nurl = {endpoint}\n".encode()
        oversized = configuration + record * (768 * 1024 // len(record) + 1)
        try:
            configuration_path.write_bytes(oversized)
            refused_before_contact("remoteConfigurationUnavailable")
            assert configuration_path.read_bytes() == oversized
        finally:
            configuration_path.write_bytes(configuration)
        fixtures.git(repository, "config", "--unset-all", "credential.helper")
        fixtures.git(repository, "config", "credential.helper", "")
        try:
            result = driver.invoke("lfs_locks", repoId=repo_id)
        except RuntimeError as error:
            result = json.loads(str(error))
            assert result["kind"] == "authenticationRequired", result
            assert "owned-lock-fixture-token" not in json.dumps(result), result
        else:
            raise AssertionError(("Authentication refusal became a successful lock list", result))
        assert not driver.invoke("pending_authentication"), "A read opened an unexpected credential prompt"
        fixtures.git(repository, "config", "--add", "credential.helper", helper_config)
        assert driver.invoke("lfs_locks", repoId=repo_id)["locks"] == [expected]
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / "fixture.txt").read_bytes() == contents
        assert not fixtures.git(repository, "status", "--porcelain")
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)
        assert not worker.is_alive(), "Owned LFS fixture server did not shut down"
    report["scenarios"].append("native-lfs-lock-list-authentication-preserves-held-locks-and-quiet-refusal")
    report["scenarios"].append("native-lfs-endpoint-policy-refuses-before-contact-and-preserves-safe-overrides")
    report["scenarios"].append("native-ordinary-endpoint-configuration-is-bounded-before-contact")


def reference_hover_stability(driver, fixtures, original_repository, report):
    """Real Git decorations and WebDriver input; no replacement row markup."""
    references = [
        (kind, f"{prefix}/{name}")
        for kind, prefix, names in (
            ("local", "refs/heads", ("tip", "feature/topic", "owned-local-reference-name-long-enough-to-overflow")),
            ("remote", "refs/remotes", ("o/tip", "upstream/master", "owned/remote-reference-name-long-enough-to-overflow")),
            ("tag", "refs/tags", ("v1", "release-2026.10", "owned-tag-reference-name-long-enough-to-overflow")),
        )
        for name in names
    ]
    repository = fixtures.repository("reference-hover-stability", commits=len(references) + 1)
    selectors = []
    for depth, (kind, reference) in enumerate(references, start=1):
        oid = fixtures.git(repository, "rev-parse", f"HEAD~{depth}")
        fixtures.git(repository, "update-ref", reference, oid)
        selectors.append((reference, f'.commit-row[data-commit-oid="{oid}"] .single-ref .ref-pill.{kind}'))
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    before_contents = (repository / "fixture.txt").read_bytes()
    resize = '[aria-label="Resize Branch and Tag column"]'

    def move(x, y):
        driver.request("POST", driver.path("actions"), {"actions": [{
            "type": "pointer", "id": "native-mouse", "parameters": {"pointerType": "mouse"},
            "actions": [{"type": "pointerMove", "origin": "viewport", "x": x, "y": y, "duration": 0}],
        }]})

    def sample(selector):
        return driver.request("POST", driver.path("execute/async"), {"script": """
          const selector = arguments[0], done = arguments[arguments.length - 1];
          const samples = [];
          const frame = () => {
            const button = document.querySelector(selector);
            if (!button) { done({missing: true}); return; }
            const rect = button.getBoundingClientRect();
            const graph = button.closest('.commit-row').querySelector('.graph-cell').getBoundingClientRect();
            const label = button.querySelector(':scope > span') ?? button;
            samples.push({x: rect.x, y: rect.y, graphX: graph.x, graphWidth: graph.width,
              hover: button.matches(':hover'), focused: button === document.activeElement,
              readable: label.scrollWidth <= label.clientWidth});
            if (samples.length < 30) requestAnimationFrame(frame);
            else done({samples});
          };
          requestAnimationFrame(frame);
        """, "args": [selector]})

    try:
        open_ui(driver, repository)
        driver.script("document.querySelector(arguments[0]).focus()", resize)
        driver.key("\ue011")  # Home: the supported minimum column width.
        previous_width = None
        for step in range(3):
            if step:
                driver.script("document.querySelector(arguments[0]).focus()", resize)
                driver.request("POST", driver.path("actions"), {"actions": [{
                    "type": "key", "id": "native-keyboard", "actions":
                    [{"type": action, "value": "\ue014"}
                     for _ in range(14) for action in ("keyDown", "keyUp")],
                }]})
            width = driver.script("return Number(document.querySelector(arguments[0]).getAttribute('aria-valuenow'))", resize)
            assert width > 0 and (previous_width is None or width > previous_width), width
            previous_width = width
            for reference, selector in selectors:
                move(0, 0)
                driver.script("document.querySelector(arguments[0]).focus()", resize)
                driver.wait(f"return !!document.querySelector({json.dumps(selector)})")
                driver.script("document.querySelector(arguments[0]).scrollIntoView({block: 'nearest', inline: 'nearest'})", selector)
                resting = driver.script("""
                  const button = document.querySelector(arguments[0]);
                  const rect = button.getBoundingClientRect();
                  const graph = button.closest('.commit-row').querySelector('.graph-cell').getBoundingClientRect();
                  return {x: rect.x, y: rect.y, graphX: graph.x, graphWidth: graph.width,
                    pointerX: Math.floor(rect.x + rect.width / 2),
                    pointerY: Math.floor(rect.y + rect.height / 2)};
                """, selector)
                move(resting["pointerX"], resting["pointerY"])
                hovered = sample(selector)
                assert hovered.get("samples"), (reference, width, hovered)
                for position in hovered["samples"]:
                    assert position["hover"] and position["readable"], (reference, width, position)
                    assert all(abs(position[key] - resting[key]) <= 1
                               for key in ("x", "y", "graphX", "graphWidth")), (reference, width, resting, position)
                move(0, 0)
                driver.script("document.querySelector(arguments[0]).focus()", selector)
                focused = sample(selector)
                assert focused.get("samples"), (reference, width, focused)
                for position in focused["samples"]:
                    assert position["focused"] and position["readable"], (reference, width, position)
                    assert all(abs(position[key] - resting[key]) <= 1
                               for key in ("x", "y", "graphX", "graphWidth")), (reference, width, resting, position)
            for kind in ("local", "remote", "tag"):
                report["scenarios"].append(f"native-{kind}-reference-hover-focus-stable-width-{width}")
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        assert (repository / "fixture.txt").read_bytes() == before_contents
    finally:
        open_ui(driver, original_repository)


def avatar_attachment_measurements(driver):
    return driver.script("""
      const checks = [];
      for (const row of document.querySelectorAll('.commit-row[data-commit-oid]')) {
        const avatar = row.querySelector('.author-node');
        const rect = avatar.getBoundingClientRect();
        const offset = Number(avatar.dataset.laneOffset);
        const centerY = rect.y + rect.height / 2;
        for (const path of row.querySelectorAll('.graph-edges path')) {
          const start = path.getPointAtLength(0);
          const end = path.getPointAtLength(path.getTotalLength());
          let point, right, kind;
          if (Math.abs(start.y - 20) < .01 && Math.abs(end.x - offset) > .01) {
            point = start; right = end.x > offset; kind = 'departure';
          } else if (Math.abs(end.y - 20) < .01 && Math.abs(start.x - offset) > .01) {
            point = end; right = start.x > offset; kind = 'arrival';
          } else continue;
          const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
          checks.push({oid: row.dataset.commitOid, kind, side: right ? 'right' : 'left',
            dx: Math.abs(screen.x - (right ? rect.right : rect.left)),
            dy: Math.abs(screen.y - centerY)});
        }
        const connector = row.querySelector('.ref-connector')?.getBoundingClientRect();
        if (connector) checks.push({kind: 'reference', dx: 0,
          dy: Math.abs(connector.y + connector.height / 2 - centerY)});
      }
      return checks;
    """)


def avatar_side_attachments(driver, fixtures, original_repository, report):
    """Measure real release SVG endpoints against circles, without debug APIs."""
    repository = fixtures.repository("avatar-side-attachments", commits=1)
    base = fixtures.git(repository, "rev-parse", "HEAD")
    tree = fixtures.git(repository, "rev-parse", "HEAD^{tree}")

    def commit(label, date, *parents):
        arguments = ["git", "-C", str(repository), "commit-tree", tree]
        for parent in parents:
            arguments.extend(["-p", parent])
        return run(*arguments, "-m", label, env={
            **fixtures.env, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date,
        })

    pinned = commit("Pinned lane", "2026-01-02T00:00:00Z", base)
    other = commit("Other lane", "2026-01-03T00:00:00Z", base)
    extra = commit("Intervening lane", "2026-01-01T12:00:00Z", base)
    merge = commit("Merge", "2026-01-04T00:00:00Z", other, pinned)
    fixtures.git(repository, "update-ref", "refs/heads/main", merge)
    fixtures.git(repository, "update-ref", "refs/heads/owned-pinned", pinned)
    fixtures.git(repository, "update-ref", "refs/heads/owned-extra", extra)
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    before_contents = (repository / "fixture.txt").read_bytes()
    try:
        open_ui(driver, repository)
        for compact in (False, True):
            for pin in (False, True):
                # Exercise persisted user preferences, not injected component state.
                driver.script("""
                  const key = `git-khronos.graph.${encodeURIComponent(arguments[0])}.`;
                  localStorage.setItem(key + 'column.graph.compact', String(arguments[1]));
                  if (arguments[2]) localStorage.setItem(key + 'branch.pinned', 'owned-pinned');
                  else localStorage.removeItem(key + 'branch.pinned');
                """, str(repository), compact, pin)
                driver.reload()
                driver.wait(f"""
                  return document.querySelectorAll('.commit-row[data-commit-oid]').length === 5
                    && document.querySelector('.author-node')?.getBoundingClientRect().width === {20 if compact else 24};
                """, 60)
                measurements = avatar_attachment_measurements(driver)
                assert measurements, (compact, pin, "Missing avatar attachment measurements")
                assert all(check["dx"] < .1 and check["dy"] < .1 for check in measurements), (
                    compact, pin, measurements)
                if pin:
                    assert any(check.get("oid") == pinned and check["kind"] == "arrival"
                               for check in measurements), ("Missing relocated-lane arrival", measurements)
                else:
                    assert {check["side"] for check in measurements if check["kind"] == "departure"} == {
                        "left", "right"}, ("Both side departures must be exercised", measurements)
                report["scenarios"].append(
                    f"native-avatar-side-centers-{'compact' if compact else 'expanded'}-{'pinned' if pin else 'unpinned'}")
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        assert (repository / "fixture.txt").read_bytes() == before_contents
    finally:
        open_ui(driver, original_repository)


def shared_parent_avatar_attachments(driver, fixtures, original_repository, report):
    repository = fixtures.repository("shared-parent-avatar-attachments", commits=1)
    base = fixtures.git(repository, "rev-parse", "HEAD")
    tree = fixtures.git(repository, "rev-parse", "HEAD^{tree}")

    def commit(label, day, *parents):
        arguments = ["git", "-C", str(repository), "commit-tree", tree]
        for parent in parents:
            arguments.extend(["-p", parent])
        date = f"2026-01-{day:02d}T00:00:00Z"
        return run(*arguments, "-m", label, env={
            **fixtures.env, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date,
        })

    older = commit("Older", 2, base)
    parent = commit("Parent", 3, older)
    shared = commit("Shared", 4, parent)
    recovery = commit("Recovery", 5, parent)
    checkpoint_b = commit("Checkpoint B", 6, base)
    checkpoint_a = commit("Checkpoint A", 7, base)
    checkpoint = commit("Checkpoint", 8, shared)
    tip = commit("Tip", 9, shared)
    for name, oid in (("main", tip), ("owned-checkpoint", checkpoint),
                      ("owned-checkpoint-a", checkpoint_a), ("owned-checkpoint-b", checkpoint_b),
                      ("owned-recovery", recovery), ("owned-base", base)):
        fixtures.git(repository, "update-ref", f"refs/heads/{name}", oid)
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    before_contents = (repository / "fixture.txt").read_bytes()
    try:
        open_ui(driver, repository)
        snapshot = driver.invoke("open_repository", path=str(repository))
        assert [entry["oid"] for entry in snapshot["commits"]] == [
            tip, checkpoint, checkpoint_a, checkpoint_b, recovery, shared, parent, older, base
        ], "The real shared-parent fixture must reproduce the reported row order"
        for compact in (False, True):
            driver.script("""
              localStorage.setItem(`git-khronos.graph.${encodeURIComponent(arguments[0])}.column.graph.compact`,
                String(arguments[1]));
            """, str(repository), compact)
            driver.reload()
            driver.wait(f"""
              return document.querySelectorAll('.commit-row[data-commit-oid]').length === 9
                && document.querySelector('.author-node')?.getBoundingClientRect().width === {20 if compact else 24};
            """, 60)
            routing = driver.script(r"""
              const paths = [...document.querySelectorAll('.commit-row[data-commit-oid] .graph-edges path')];
              return {count: paths.length,
                rounded: paths.filter(path => (path.getAttribute('d') ?? '').includes(' A ')).length,
                invalid: paths.flatMap(path => {
                const d = path.getAttribute('d') ?? '';
                return /^M [-\d.]+ [-\d.]+(?: [HVA] [-\d. ]+)+$/.test(d)
                  && !/[CQLST]/i.test(d)
                  && getComputedStyle(path).strokeLinejoin === 'round' ? [] : [d];
              })};
            """)
            assert routing["rounded"] > 0 and not routing["invalid"], (compact, routing)
            measurements = avatar_attachment_measurements(driver)
            assert measurements and all(check["dx"] < .1 and check["dy"] < .1
                                        for check in measurements), (compact, measurements)
            assert any(check.get("oid") == shared and check["kind"] == "departure"
                       and check["side"] == "right" for check in measurements), measurements
            bypass = driver.script("""
              const row = document.querySelector(`[data-commit-oid="${arguments[0]}"]`);
              const node = row.querySelector('.author-node').getBoundingClientRect();
              const results = [];
              const endpoints = [];
              for (const path of row.querySelectorAll('.graph-edges path')) {
                const length = path.getTotalLength();
                const start = path.getPointAtLength(0), end = path.getPointAtLength(length);
                endpoints.push({start: {x: start.x, y: start.y}, end: {x: end.x, y: end.y}});
                // WebKit's arc-length interpolation can return 40.0000038
                // for the exact y=40 endpoint of a rounded path. Classify the
                // row boundary with subpixel tolerance, not exact equality.
                if (Math.abs(start.y) > .001 || Math.abs(end.y - 40) > .001
                    || start.x === end.x) continue;
                let clearance = Infinity;
                for (let step = 0; step <= 100; step++) {
                  const point = path.getPointAtLength(length * step / 100);
                  const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
                  clearance = Math.min(clearance, Math.hypot(screen.x - node.x - node.width / 2,
                    screen.y - node.y - node.height / 2) - node.width / 2);
                }
                results.push(clearance);
              }
              return {clearances: results, endpoints};
            """, shared)
            clearances = bypass["clearances"]
            assert clearances and min(clearances) >= .5, (compact, bypass)
            mode = "compact" if compact else "expanded"
            report.setdefault("roundedOrthogonalGraphPathCount", {})[mode] = routing["count"]
            report.setdefault("sharedParentAvatarClearancePx", {})[mode] = min(clearances)
            report.setdefault("sharedParentAvatarBypassEndpoints", {})[mode] = bypass["endpoints"]
            report["scenarios"].append(f"native-shared-parent-avatar-side-ports-and-bypass-{mode}")
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        assert (repository / "fixture.txt").read_bytes() == before_contents
    finally:
        open_ui(driver, original_repository)


def committed_merge_preview(driver, fixtures, original_repository, report):
    repository = fixtures.repository("committed-merge-preview", commits=1)
    fixtures.git(repository, "checkout", "-q", "-b", "preview-source")
    (repository / "fixture.txt").write_text("source version\n")
    fixtures.git(repository, "commit", "-qam", "Source change")
    source = fixtures.git(repository, "rev-parse", "HEAD")
    fixtures.git(repository, "checkout", "-q", "main")
    (repository / "fixture.txt").write_text("target version\n")
    fixtures.git(repository, "commit", "-qam", "Target change")
    target = fixtures.git(repository, "rev-parse", "HEAD")
    (repository / "fixture.txt").write_text("unstaged local work\n")
    (repository / "untracked.txt").write_text("preserved untracked work\n")
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    try:
        repo_id = open_ui(driver, repository)
        request = {"source": "refs/heads/preview-source", "target": "refs/heads/main",
                   "sourceOid": source, "targetOid": target}
        result = driver.invoke("preview_merge", repoId=repo_id, request=request, operationId=str(uuid.uuid4()))
        assert not result["clean"] and result["conflictedPaths"] == ["fixture.txt"], result
        assert result["request"] == request
        report["scenarios"].append("native-committed-merge-preview-exact-refs-and-conflict-paths")
        driver.click('[aria-label="Main menu"]')
        driver.click_text('.app-menu-popover strong', 'Command Palette')
        driver.wait("return !!document.querySelector('gc-command-palette input')")
        driver.script("""
          const input = document.querySelector('gc-command-palette input');
          input.value = 'Preview merge conflicts';
          input.dispatchEvent(new Event('input', {bubbles: true}));
        """)
        driver.wait("return [...document.querySelectorAll('gc-command-palette [role=option]')].filter(x => !x.disabled).length === 1")
        driver.click('gc-command-palette [role=option]:not(:disabled)')
        driver.wait("return !!document.querySelector('gc-merge-preview-dialog #preview-target')")
        driver.script("""
          const select = document.querySelector('gc-merge-preview-dialog #preview-target');
          select.value = 'refs/heads/preview-source';
          select.dispatchEvent(new Event('change', {bubbles: true}));
        """)
        assert driver.script("return document.querySelector('gc-merge-preview-dialog #preview-source').value") == "refs/heads/main"
        assert driver.script("return document.querySelector('gc-merge-preview-dialog #preview-target').value") == "refs/heads/preview-source"
        driver.click_text('gc-merge-preview-dialog button', 'Preview conflicts')
        driver.wait("return document.querySelector('gc-merge-preview-dialog')?.textContent.includes('Git reports merge conflicts')")
        assert driver.script("return [...document.querySelectorAll('gc-merge-preview-dialog li')].map(x => x.textContent)") == ["fixture.txt"]
        driver.click_text('gc-merge-preview-dialog button', 'Close')
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        assert (repository / "fixture.txt").read_text() == "unstaged local work\n"
        assert (repository / "untracked.txt").read_text() == "preserved untracked work\n"
        report["scenarios"].append("native-merge-preview-dialog-default-direction-and-dirty-state-preservation")
    finally:
        open_ui(driver, original_repository)


def workspace_center_workflows(driver, fixtures, original_repository, report):
    repository = fixtures.repository("workspace-center", commits=1)
    (repository / "fixture.txt").write_text("kept local edits\n")
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    before_name = fixtures.git(repository, "config", "user.name")
    storage_key = "git-khronos.identity-profiles.v1"
    previous = driver.script("return localStorage.getItem(arguments[0])", storage_key)
    label = "Owned native identity"
    try:
        repo_id = open_ui(driver, repository)
        driver.click('.workspace-toggle')
        driver.click_text('.workspace-menu-actions button', 'Repository overview')
        driver.wait("return !!document.querySelector('gc-workspace-center [role=dialog]')")
        driver.click_text('gc-workspace-center button', 'Refresh local state')
        driver.wait("return document.querySelector('gc-workspace-center')?.textContent.includes('Read locally at')")
        assert driver.script("return document.querySelector('gc-workspace-center').textContent").find(str(repository)) >= 0
        assert fixtures.git(repository, "config", "user.name") == before_name
        report["scenarios"].append("native-workspace-overview-explicit-local-refresh")
        driver.click_text('gc-workspace-center nav button', 'Identity profiles')
        driver.script("""
          const values = {'Profile label': arguments[0], 'Commit author name': 'Owned Native Author',
            'Commit author email': 'native-owned@example.test'};
          for (const [text,value] of Object.entries(values)) {
            const label = [...document.querySelectorAll('gc-workspace-center form label')].find(label => label.textContent.trim() === text);
            const input = label.querySelector('input'); input.value = value;
            input.dispatchEvent(new Event('input', {bubbles:true}));
          }
        """, label)
        driver.click_text('gc-workspace-center button', 'Save profile')
        driver.wait("return document.querySelector('gc-workspace-center')?.textContent.includes('Saved Owned native identity')")
        assert fixtures.git(repository, "config", "user.name") == before_name
        driver.click_text('gc-workspace-center button', 'Use ' + label + '…')
        assert str(repository) in driver.script("return document.querySelector('gc-workspace-center aside').textContent")
        driver.click_text('gc-workspace-center button', 'Apply to this repository')
        driver.wait("return document.querySelector('gc-workspace-center')?.textContent.includes('Applied Owned native identity')")
        assert fixtures.git(repository, "config", "--local", "user.name") == "Owned Native Author"
        assert fixtures.git(repository, "config", "--local", "user.email") == "native-owned@example.test"
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        assert (repository / "fixture.txt").read_text() == "kept local edits\n"
        report["scenarios"].append("native-identity-profile-explicit-local-application-preserves-git-state")
        driver.click_text('gc-workspace-center button', 'Close')
        for command, args in [
            ("load_hosting_page", {"remote": "missing", "section": "pullRequests"}),
            ("load_hosted_review", {"remote": "missing", "pullNumber": 1, "expectedHeadOid": "not-an-oid"}),
        ]:
            try:
                driver.invoke(command, repoId=repo_id, operationId=str(uuid.uuid4()), **args)
                raise AssertionError("Unsupported hosted request unexpectedly succeeded")
            except RuntimeError as error:
                assert "hostingUnsupported" in str(error) or "hostingRequest" in str(error), str(error)
        report["scenarios"].append("native-hosted-read-boundary-rejects-invalid-requests-without-network")
    finally:
        driver.script("""
          if (arguments[1] === null) localStorage.removeItem(arguments[0]);
          else localStorage.setItem(arguments[0], arguments[1]);
          document.querySelector('gc-workspace-center header button')?.click();
        """, storage_key, previous)
        open_ui(driver, original_repository)


def hosted_paging_and_decisions(driver, fixtures, original_repository, report):
    repository = fixtures.repository("hosted-paging", commits=1)
    request_log = fixtures.hosting_gate / "requests.jsonl"
    request_start = len(request_log.read_text().splitlines()) if request_log.exists() else 0
    fixtures.git(repository, "remote", "add", "origin", "https://github.com/owned-fixture/native-repo.git")
    oid = fixtures.git(repository, "rev-parse", "HEAD")
    config = fixtures.hosting_gate / "config.json"
    config.write_text(json.dumps({"repository": "owned-fixture/native-repo", "oid": oid}))
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    try:
        repo_id = open_ui(driver, repository)
        page = driver.invoke("load_hosting_page", repoId=repo_id, remote="origin", section="pullRequests",
                             query={"page": 2, "state": "closed"}, operationId=str(uuid.uuid4()))
        assert page["page"] == 2 and page["entries"][0]["number"] == "2"
        assert page["entries"][0]["state"] == "closed"
        query = {"filesPage": 2, "reviewsPage": 1, "checksPage": 1, "statusesPage": 1}
        review = driver.invoke("load_hosted_review", repoId=repo_id, remote="origin", pullNumber=1,
                               expectedHeadOid=oid, query=query, operationId=str(uuid.uuid4()))
        assert review["files"][0]["path"] == "second.txt" and not review["filesMayHaveMore"]
        assert review["currentReviews"][0]["commitOid"] == oid
        assert review["currentReviews"][0]["state"] == "APPROVED"
        assert review["legacyState"] == "failure" and review["legacyStatuses"][0]["name"] == "owned-legacy-ci"
        assert all(review["sections"].values()) and not review["warnings"]
        report["scenarios"].append("native-hosted-page-state-head-scoped-review-and-legacy-status")
        hold, started = fixtures.hosting_gate / "hold", fixtures.hosting_gate / "started"
        started.unlink(missing_ok=True)
        hold.touch()
        operation = str(uuid.uuid4())
        try:
            driver.script("""
              window.__ownedHostedCancel = {done: false};
              window.__TAURI_INTERNALS__.invoke('load_hosting_page', arguments[0]).then(
                value => { window.__ownedHostedCancel = {done: true, value}; },
                error => { window.__ownedHostedCancel = {done: true, error}; });
            """, dict(repoId=repo_id, remote="origin", section="issues",
                      query={"page": 3, "state": "all"}, operationId=operation))
            deadline = time.monotonic() + 3
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            assert started.exists(), "Owned hosted CLI did not reach its gate"
            pid = int(started.read_text())
            assert b"native_hosting_fixture.py" in Path(f"/proc/{pid}/cmdline").read_bytes()
            before = time.monotonic()
            assert driver.invoke("cancel_git_operation", operationId=operation) is True
            driver.wait("return window.__ownedHostedCancel?.done", 3)
            assert driver.script("return window.__ownedHostedCancel.error.kind") == "operationCancelled"
            assert not Path(f"/proc/{pid}").exists(), "Cancelled hosted CLI was not reaped"
            report["hostedPageCancelMs"] = (time.monotonic() - before) * 1000
            assert report["hostedPageCancelMs"] < 2000
            report["scenarios"].append("native-hosted-page-cancellation-reaps-owned-cli")
        finally:
            hold.unlink(missing_ok=True)
        config.write_text(json.dumps({"repository": "owned-fixture/native-repo", "oid": oid, "partial": True}))
        partial = driver.invoke("load_hosted_review", repoId=repo_id, remote="origin", pullNumber=1,
                                expectedHeadOid=oid, operationId=str(uuid.uuid4()))
        assert not partial["sections"]["checks"] and partial["sections"]["statuses"]
        assert partial["files"] and partial["currentReviews"] and partial["warnings"]
        assert "private diagnostic" not in json.dumps(partial)
        report["scenarios"].append("native-hosted-partial-permissions-retain-accessible-sections")
        driver.click('.workspace-toggle')
        driver.click_text('.workspace-menu-actions button', 'Reviews and checks')
        driver.wait("return !!document.querySelector('gc-hosting-panel #hosting-state')")
        driver.click_text('gc-hosting-panel button', 'Load from GitHub')
        driver.wait("return document.querySelector('gc-hosting-panel')?.textContent.includes('Owned hosted page 1')")
        driver.click_text('gc-hosting-panel button', 'Inspect #1')
        driver.wait("return document.querySelector('gc-hosting-panel')?.textContent.includes('owned-legacy-ci')")
        assert driver.script("return document.querySelector('gc-hosting-panel').textContent.includes('Check runs could not be loaded')")
        assert driver.script("return document.querySelector('gc-hosting-panel').textContent.includes('APPROVED')")
        driver.click_text('gc-hosting-panel button', 'Next changed files page')
        driver.wait("return document.querySelector('gc-hosting-panel')?.textContent.includes('second.txt')")
        driver.click_text('gc-workspace-center header button', 'Close')
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        requests = [json.loads(line) for line in request_log.read_text().splitlines()[request_start:]]
        assert requests and all(item["method"] == "GET" and item["cwd"] != str(repository) for item in requests)
        report["scenarios"].append("native-hosted-dialog-paging-and-partial-status-preserve-git-state")
    finally:
        driver.script("document.querySelector('gc-workspace-center header button')?.click()")
        fixtures.git(repository, "remote", "remove", "origin")
        open_ui(driver, original_repository)


def hosted_reviewed_writes(driver, fixtures, original_repository, report):
    repository = fixtures.repository("hosted-reviewed-writes", commits=2)
    fixtures.git(repository, "branch", "feature")
    fixtures.git(repository, "remote", "add", "origin", "https://github.com/owned-fixture/native-repo.git")
    fixtures.git(repository, "remote", "add", "fork", "git@github.com:owned-fixture/native-fork.git")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    base = fixtures.git(repository, "rev-parse", "HEAD~1")
    before_refs = fixtures.git(repository, "show-ref")
    before_index = (repository / ".git/index").read_bytes()
    before_files = (repository / "fixture.txt").read_bytes()
    gate = fixtures.hosting_gate
    config_path = gate / "config.json"
    original_config = config_path.read_bytes()
    config = {"repository": "owned-fixture/native-repo", "sourceRepository": "owned-fixture/native-fork",
              "oid": head, "baseOid": base, "headBranch": "feature", "baseBranch": "main",
              "actor": "owned-author", "allowWrites": True}
    config_path.write_text(json.dumps(config))
    state_path = gate / "write-state.json"
    def prepare(request):
        return driver.invoke("prepare_hosted_write", repoId=repo_id, remote="origin", request=request, operationId=str(uuid.uuid4()))
    def execute(preview):
        return driver.invoke("execute_hosted_write", repoId=repo_id, token=preview["token"], operationId=str(uuid.uuid4()))
    def refuses(preview, kind):
        try:
            execute(preview)
        except RuntimeError as error:
            assert kind in str(error), error
            assert "private diagnostic" not in str(error) and "owned-token-" not in str(error)
        else:
            raise AssertionError("Owned hosted submission unexpectedly succeeded")
    request = {"kind": "createPull", "headRemote": "fork", "headBranch": "feature", "baseBranch": "main",
               "title": "Owned native fork request", "body": "Original native body\nSecond line", "draft": True}
    try:
        repo_id = open_ui(driver, repository)
        preview = prepare(request)
        assert preview["plan"]["actor"] == "owned-author" and preview["plan"]["headOid"] == head
        assert preview["plan"]["baseOid"] == base and preview["plan"]["sourceRepository"] == config["sourceRepository"]
        config["flipActorAfterBaseRead"] = True
        config_path.write_text(json.dumps(config))
        receipt = execute(preview)
        assert receipt["number"] == 100 and receipt["actor"] == "owned-author" and receipt["commitOid"] == head
        assert json.loads(config_path.read_text())["actor"] == "owned-other-account"
        assert json.loads(state_path.read_text())["created"][0]["user"]["login"] == "owned-author"
        refuses(preview, "staleHostedWritePlan")
        assert len(json.loads(state_path.read_text())["created"]) == 1
        report["scenarios"].append("native-hosted-fork-creation-pins-account-and-consumes-preview-once")
        config.pop("flipActorAfterBaseRead", None)
        config["actor"] = "owned-author"
        config_path.write_text(json.dumps(config))
        preview = prepare(request)
        config["actor"] = "owned-other-account"
        config_path.write_text(json.dumps(config))
        refuses(preview, "hostingWriteRefused")
        assert len(json.loads(state_path.read_text())["created"]) == 1
        report["scenarios"].append("native-hosted-account-change-refuses-submission")
        config["actor"] = "owned-author"
        config_path.write_text(json.dumps(config))
        preview = prepare(request)
        config["actorIds"] = {"owned-author": 777}
        config_path.write_text(json.dumps(config))
        refuses(preview, "hostingWriteRefused")
        assert len(json.loads(state_path.read_text())["created"]) == 1
        report["scenarios"].append("native-hosted-same-login-different-account-id-refuses-submission")
        config.pop("actorIds")
        config["actor"] = "owned-other-account"
        config_path.write_text(json.dumps(config))
        for event in ("approve", "requestChanges", "comment"):
            preview = prepare({"kind": "review", "number": 1, "expectedHeadOid": head, "event": event, "body": "" if event == "approve" else "Original native review " + event})
            receipt = execute(preview)
            assert receipt["commitOid"] == head and receipt["actor"] == "owned-other-account"
        assert [item["state"] for item in json.loads(state_path.read_text())["reviews"]] == ["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]
        report["scenarios"].append("native-hosted-all-submitted-review-events-target-captured-head")
        preview = prepare({"kind": "review", "number": 1, "expectedHeadOid": head, "event": "comment", "body": "Applied with lost reply"})
        config["uncertainAfterWrite"] = True
        config_path.write_text(json.dumps(config))
        refuses(preview, "hostingWriteUncertain")
        refuses(preview, "staleHostedWritePlan")
        assert len(json.loads(state_path.read_text())["reviews"]) == 4
        report["scenarios"].append("native-hosted-applied-write-with-lost-reply-cannot-replay")
        config.pop("uncertainAfterWrite")
        config["denyBeforeWrite"] = True
        config_path.write_text(json.dumps(config))
        preview = prepare({"kind": "review", "number": 1, "expectedHeadOid": head, "event": "comment", "body": "Refused provider write"})
        refuses(preview, "hostingWriteUncertain")
        refuses(preview, "staleHostedWritePlan")
        assert len(json.loads(state_path.read_text())["reviews"]) == 4
        report["scenarios"].append("native-hosted-provider-write-refusal-never-reports-success-or-replays")
        config.pop("denyBeforeWrite")
        config["holdWritesOnly"] = True
        config_path.write_text(json.dumps(config))
        preview = prepare({"kind": "review", "number": 1, "expectedHeadOid": head, "event": "comment", "body": "Held native write"})
        hold = gate / "hold"
        hold.touch()
        operation = str(uuid.uuid4())
        try:
            driver.script("""
              window.__ownedHostedWriteWait = {done: false};
              window.__TAURI_INTERNALS__.invoke('execute_hosted_write', arguments[0]).then(
                value => { window.__ownedHostedWriteWait = {done:true,value}; },
                error => { window.__ownedHostedWriteWait = {done:true,error}; });
            """, dict(repoId=repo_id, token=preview["token"], operationId=operation))
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                last = json.loads((gate / "requests.jsonl").read_text().splitlines()[-1])
                if last["method"] == "POST" and last.get("payload", {}).get("body") == "Held native write":
                    break
                time.sleep(0.01)
            assert last["method"] == "POST" and last["payload"]["body"] == "Held native write"
            pid = last["pid"]
            assert b"native_hosting_fixture.py" in Path(f"/proc/{pid}/cmdline").read_bytes()
            before = time.monotonic()
            driver.invoke("refresh_repository_status", repoId=repo_id)
            assert time.monotonic() - before < 2 and hold.exists(), "Hosted write blocked unrelated native status controls"
            assert driver.invoke("cancel_git_operation", operationId=operation) is True
            driver.wait("return window.__ownedHostedWriteWait?.done", 3)
            assert driver.script("return window.__ownedHostedWriteWait.error.kind") == "hostingWriteUncertain"
            assert not Path(f"/proc/{pid}").exists()
            assert len(json.loads(state_path.read_text())["reviews"]) == 4
        finally:
            hold.unlink(missing_ok=True)
        report["scenarios"].append("native-hosted-write-wait-cancellation-is-unknown-and-controls-stay-responsive")
        config.pop("holdWritesOnly")
        config_path.write_text(json.dumps(config))
        driver.click('.workspace-toggle')
        driver.click_text('.workspace-menu-actions button', 'Reviews and checks')
        driver.wait("return !!document.querySelector('gc-hosting-panel #hosting-remote')")
        driver.click_text('gc-hosting-panel button', 'Create pull request')
        driver.wait("return !!document.querySelector('#hosted-head-remote')")
        for selector, value, event in [("#hosted-head-remote", "fork", "change"), ("#hosted-head-branch", "feature", "input"),
                                       ("#hosted-base-branch", "main", "input"), ("#hosted-write-title", "Owned native UI request", "input"),
                                       ("#hosted-write-body", "Original UI body", "input")]:
            driver.script("const field=document.querySelector(arguments[0]); field.value=arguments[1]; field.dispatchEvent(new Event(arguments[2],{bubbles:true}));", selector, value, event)
        driver.click_text('gc-hosted-write-panel button', 'Prepare submission preview')
        driver.wait("return !!document.querySelector('gc-hosted-write-panel [data-write-preview]')")
        assert driver.script("return document.querySelector('gc-hosted-write-panel').textContent.includes('owned-other-account')")
        driver.screenshot(Path(report["artifactsDirectory"]) / "hosted-submission-preview.png")
        driver.click_text('gc-hosted-write-panel button', 'Create draft pull request')
        driver.wait("return !!document.querySelector('gc-hosted-write-panel [data-write-receipt]')")
        created = json.loads(state_path.read_text())["created"]
        assert len(created) == 2 and created[-1]["title"] == "Owned native UI request"
        driver.click_text('gc-hosted-write-panel button', 'Close submission')
        driver.click_text('gc-workspace-center header button', 'Close')
        report["scenarios"].append("native-hosted-draft-creation-ui-previews-and-confirms-provider-receipt")
        preview = prepare({"kind": "merge", "number": 1, "expectedHeadOid": head, "method": "squash", "title": "Owned merge", "body": "Original merge body"})
        receipt = execute(preview)
        assert receipt["commitOid"] == "c" * 40
        assert json.loads(state_path.read_text())["merges"] == [{"sha": head, "merge_method": "squash", "commit_title": "Owned merge", "commit_message": "Original merge body"}]
        assert fixtures.git(repository, "show-ref") == before_refs
        assert (repository / ".git/index").read_bytes() == before_index
        assert (repository / "fixture.txt").read_bytes() == before_files
        assert "owned-token-" not in (gate / "requests.jsonl").read_text()
        report["scenarios"].append("native-hosted-squash-merge-receipt-and-local-git-state-preserved")
    finally:
        (gate / "hold").unlink(missing_ok=True)
        config_path.write_bytes(original_config)
        driver.script("document.querySelector('gc-workspace-center header button')?.click()")
        fixtures.git(repository, "remote", "remove", "origin")
        fixtures.git(repository, "remote", "remove", "fork")
        open_ui(driver, original_repository)


def rebase_row_keyboard_preview(driver, fixtures, original_repository, report):
    """Real packaged plan, WebDriver keyboard input and independent Git oracle."""
    repository = fixtures.repository("rebase-row-keyboard-preview", 4)
    original_order = fixtures.git(repository, "rev-list", "--reverse", "HEAD").splitlines()
    expected = [original_order[-1], *original_order[:-1]]
    refs = fixtures.git(repository, "show-ref")
    index = (repository / ".git/index").read_bytes()
    contents = (repository / "fixture.txt").read_bytes()
    try:
        open_ui(driver, repository)
        driver.script("document.querySelector(arguments[0]).focus()", '[aria-label="Local branch main, current"]')
        driver.click_visible('[aria-label="Branch actions for main"]')
        driver.wait("return [...document.querySelectorAll('.context-menu [role=\"menuitem\"]')].some(element => element.getClientRects().length && element.textContent.trim() === 'Edit entire history, including root…')")
        driver.click_text('.context-menu [role="menuitem"]', 'Edit entire history, including root…')
        driver.wait("return document.querySelectorAll('.interactive-rebase [data-rebase-oid]').length === 4")
        selector = f'.interactive-rebase [data-rebase-oid="{original_order[-1]}"]'
        driver.script("document.querySelector(arguments[0]).focus()", selector)
        driver.request("POST", driver.path("actions"), {"actions": [{
            "type": "key", "id": "native-rebase-row-keyboard", "actions": [
                {"type": "keyDown", "value": "\ue00a"},
                *[{"type": action, "value": "\ue013"}
                  for _ in range(3) for action in ("keyDown", "keyUp")],
                {"type": "keyUp", "value": "\ue00a"},
            ],
        }]})
        driver.wait(f"return JSON.stringify([...document.querySelectorAll('.interactive-rebase [data-rebase-oid]')].map(row => row.dataset.rebaseOid)) === JSON.stringify({json.dumps(expected)})")
        assert driver.script("return document.activeElement === document.querySelector(arguments[0])", selector)
        driver.screenshot(Path(report["artifactsDirectory"]) / "rebase-row-keyboard-preview.png")
        driver.click('.interactive-rebase [data-rebase-close]')
        driver.wait("return !document.querySelector('.interactive-rebase')")
        assert fixtures.git(repository, "show-ref") == refs
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / "fixture.txt").read_bytes() == contents
        assert fixtures.git(repository, "rev-list", "--reverse", "HEAD").splitlines() == original_order
        assert not (repository / ".git/rebase-merge").exists()
        report["scenarios"].append("native-ui-rebase-rapid-keyboard-moves-compose-and-cancel-without-git-mutation")
    except Exception:
        driver.screenshot(Path(report["artifactsDirectory"]) / "rebase-row-keyboard-failure.png")
        raise
    finally:
        open_ui(driver, original_repository)





def _workflow_repository(fixtures, name):
    repository = fixtures.repository(name, 1)
    hooks = repository / '.git/owned-workflow-hooks'
    hooks.mkdir()
    empty = repository / '.git/owned-workflow-empty'
    empty.write_bytes(b'')
    for key, value in {
        'user.name': 'Owned Native Workflow', 'user.email': 'owned-workflow@example.test',
        'commit.gpgsign': 'false', 'tag.gpgsign': 'false', 'tag.forceSignAnnotated': 'false',
        'core.fsmonitor': 'false', 'core.autocrlf': 'false', 'core.hooksPath': str(hooks),
        'core.attributesFile': str(empty), 'core.excludesFile': str(empty),
    }.items():
        fixtures.git(repository, 'config', '--local', key, value)
    return repository

def branch_workflow_native_boundary(driver, fixtures, original_repository, report):
    repository = _workflow_repository(fixtures, 'branch-workflow-boundary')
    initial = fixtures.git(repository, 'rev-parse', 'HEAD')
    repo_id = driver.invoke('open_repository', path=str(repository))['id']
    original_id = driver.invoke('open_repository', path=str(original_repository))['id']
    settings = dict(version=1, production='main', development='develop', featurePrefix='feature/',
                    releasePrefix='release/', hotfixPrefix='hotfix/', tagPrefix='')
    prepared = driver.invoke('prepare_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()),
                             request=dict(action='setup', settings=settings, initialOid=initial))
    before = fixtures.git(repository, 'show-ref')
    try:
        driver.invoke('execute_branch_workflow', repoId=original_id, token=prepared['token'], operationId=str(uuid.uuid4()))
        raise AssertionError('A preview dispatched against another repository')
    except RuntimeError as error:
        assert 'staleBranchWorkflowPlan' in str(error), error
    assert fixtures.git(repository, 'show-ref') == before
    prepared['plan']['plan']['settings']['production'] = 'client-altered-name'
    driver.invoke('execute_branch_workflow', repoId=repo_id, token=prepared['token'], operationId=str(uuid.uuid4()))
    assert fixtures.git(repository, 'rev-parse', 'develop') == initial
    assert not fixtures.git(repository, 'for-each-ref', '--format=%(refname)', 'refs/heads/client-altered-name')
    try:
        driver.invoke('execute_branch_workflow', repoId=repo_id, token=prepared['token'], operationId=str(uuid.uuid4()))
        raise AssertionError('A consumed native preview was replayed')
    except RuntimeError as error:
        assert 'staleBranchWorkflowPlan' in str(error), error
    before = fixtures.git(repository, 'show-ref')
    try:
        driver.invoke('control_branch_workflow_finish', repoId=repo_id, id='a' * 32, revision=0,
                      control=dict(action='abort', retry=True), operationId=str(uuid.uuid4()))
        raise AssertionError('Unexpected control fields reached the workflow engine')
    except RuntimeError as error:
        assert 'unknown field' in str(error), error
    assert fixtures.git(repository, 'show-ref') == before
    report['scenarios'].append('native-workflow-preview-repository-binding-server-immutability-single-use-and-strict-control-decoding')

    monitor = fixtures.root / 'owned-workflow-monitor'
    monitor.write_text('#!/bin/sh\ngit_dir=$(git rev-parse --absolute-git-dir)\nsleep 30 &\nprintf "%s" "$!" > "$git_dir/owned-monitor-child"\nwait\n')
    monitor.chmod(0o700)
    fixtures.git(repository, 'config', 'core.fsmonitor', str(monitor))
    index = (repository / '.git/index').read_bytes()
    operation_id = str(uuid.uuid4())
    try:
        driver.script("""
          window.__ownedWorkflowRequest = { settled: false };
          window.__TAURI_INTERNALS__.invoke('prepare_branch_workflow', arguments[0])
            .then(value => { window.__ownedWorkflowRequest = { settled: true, value }; },
                  error => { window.__ownedWorkflowRequest = { settled: true, error }; });
        """, dict(repoId=repo_id, operationId=operation_id,
                  request=dict(action='start', kind='feature', suffix='cancel-owned')))
        marker = repository / '.git/owned-monitor-child'
        deadline = time.monotonic() + 30
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists(), 'Owned cancellable preflight never reached its monitor'
        assert driver.invoke('cancel_git_operation', operationId=operation_id)
        driver.wait('return window.__ownedWorkflowRequest?.settled', 10)
        result = driver.script('return window.__ownedWorkflowRequest')
        assert result.get('error', {}).get('kind') == 'operationCancelled', result
        assert fixtures.git(repository, 'show-ref') == before
        assert (repository / '.git/index').read_bytes() == index
        assert not (repository / '.git/git-khronos-branch-workflow/active.json').exists()
        child = marker.read_text()
        stat = Path('/proc') / child / 'stat'
        if stat.exists():
            assert stat.read_text().rsplit(') ', 1)[1].startswith('Z'), 'Canceled owned monitor is still running'
        report['scenarios'].append('native-workflow-cancellation-interrupts-running-preflight-helper-without-branch-or-index-mutation')
    finally:
        fixtures.git(repository, 'config', 'core.fsmonitor', 'false')
        driver.script('delete window.__ownedWorkflowRequest')


def _workflow_button(driver, text):
    driver.wait(f"return [...document.querySelectorAll('gc-branch-workflow-dialog button')].some(button => button.textContent.trim() === {json.dumps(text)} && !button.matches(':disabled'))")
    driver.click_text('gc-branch-workflow-dialog button', text)

def branch_workflow_desktop(driver, fixtures, original_repository, report):
    """Packaged UI actions with exact Git refs, parents, tags and recovery oracles."""
    repository = _workflow_repository(fixtures, 'branch-workflow-ui')
    initial = fixtures.git(repository, "rev-parse", "HEAD")
    initial_refs = fixtures.git(repository, "show-ref")
    initial_index = (repository / ".git/index").read_bytes()
    initial_bytes = (repository / "fixture.txt").read_bytes()
    selector = 'gc-branch-workflow-dialog'

    def ready():
        driver.wait("""return (() => {
          const dialog = document.querySelector('gc-branch-workflow-dialog');
          return dialog && !dialog.querySelector('.progress') &&
            [...dialog.querySelectorAll('button')].some(button =>
              button.textContent.trim() === 'Reload workflow state' && !button.disabled);
        })()""")

    def enter():
        driver.click('.workspace-toggle')
        driver.click_text('.workspace-menu-actions button', 'Branch workflows')
        driver.wait("return !!document.querySelector('gc-branch-workflow-dialog [role=dialog]')")
        ready()

    def fill(selector, value, event="input"):
        driver.wait(f"return !!document.querySelector({json.dumps(selector)}) && !document.querySelector({json.dumps(selector)}).matches(':disabled')")
        driver.script("""
          const element = document.querySelector(arguments[0]);
          if (!element) throw Error('Missing owned workflow control: ' + arguments[0]);
          element.value = arguments[1];
          element.dispatchEvent(new Event(arguments[2], {bubbles: true}));
        """, selector, value, event)

    def button(text):
        _workflow_button(driver, text)

    def apply():
        driver.wait("return !!document.querySelector('gc-branch-workflow-dialog .review')")
        button('Apply reviewed workflow')
        ready()
        error = driver.script("return document.querySelector('gc-branch-workflow-dialog [role=alert]')?.textContent")
        assert not error, error

    def acknowledge():
        button('Review acknowledgement')
        button('Acknowledge outcome')
        ready()

    def start(kind, suffix):
        button('Topics')
        fill('#workflow-kind', kind, 'change')
        fill('#workflow-suffix', suffix)
        before = fixtures.git(repository, 'show-ref')
        button('Review topic creation')
        ready()
        assert fixtures.git(repository, 'show-ref') == before
        apply()
        assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == f'{kind}/{suffix}'

    def commit_file(path, content, message):
        (repository / path).write_text(content)
        fixtures.git(repository, 'add', '--', path)
        fixtures.git(repository, 'commit', '-qm', message)
        return fixtures.git(repository, 'rev-parse', 'HEAD')

    try:
        repo_id = open_ui(driver, repository)
        enter()
        fill('#workflow-tagPrefix', 'v')
        button('Review configuration')
        ready()
        assert fixtures.git(repository, 'show-ref') == initial_refs
        assert (repository / '.git/index').read_bytes() == initial_index
        assert (repository / 'fixture.txt').read_bytes() == initial_bytes
        apply()
        settings = json.loads(fixtures.git(repository, 'config', '--local', 'gitkhronos.branchWorkflow'))
        assert settings['production'] == 'main' and settings['development'] == 'develop'
        assert settings['tagPrefix'] == 'v'
        assert fixtures.git(repository, 'rev-parse', 'main') == initial
        assert fixtures.git(repository, 'rev-parse', 'develop') == initial
        assert fixtures.git(repository, 'symbolic-ref', '--short', 'HEAD') == 'main'
        report['scenarios'].append('native-ui-workflow-setup-reviewed-ref-creation-preserves-checkout-index-files')

        start('feature', 'owned-ui')
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == initial
        button('Close')
        source = commit_file('fixture.txt', 'owned feature\n', 'Owned UI feature')
        repo_id = open_ui(driver, repository)
        enter()
        button('Finish feature/owned-ui')
        before = fixtures.git(repository, 'show-ref')
        button('Review finish')
        ready()
        assert fixtures.git(repository, 'show-ref') == before
        apply()
        status = driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish']
        assert status['phase'] == 'complete', status
        development = fixtures.git(repository, 'rev-parse', 'develop')
        assert fixtures.git(repository, 'rev-list', '--parents', '--max-count=1', 'develop').split() == [development, initial, source]
        assert fixtures.git(repository, 'rev-parse', 'main') == initial
        assert not fixtures.git(repository, 'for-each-ref', '--format=%(refname)', 'refs/heads/feature/owned-ui')
        assert (repository / 'fixture.txt').read_text() == 'owned feature\n'
        assert fixtures.git(repository, 'status', '--porcelain') == ''
        assert len(status['recovery']) == 2
        for capture in status['recovery']:
            assert fixtures.git(repository, 'rev-parse', capture['headReference']) == capture['headOid']
        driver.screenshot(Path(report['artifactsDirectory']) / 'branch-workflow-feature-finished.png')
        acknowledge()
        assert driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish'] is None
        for capture in status['recovery']:
            assert fixtures.git(repository, 'rev-parse', capture['headReference']) == capture['headOid']
        report['scenarios'].append('native-ui-feature-start-reviewed-finish-exact-parents-conditional-cleanup-and-retained-recovery')

        start('release', '1.0')
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == development
        button('Close')
        release_source = commit_file('release.txt', 'owned release\n', 'Owned UI release')
        fixtures.git(repository, 'checkout', '-q', 'main')
        production_before = commit_file('production-only.txt', 'production content\n', 'Owned production divergence')
        repo_id = open_ui(driver, repository)
        enter()
        button('Finish release/1.0')
        fill('#workflow-tag-message', 'Owned native release\nRelease notes')
        fill('#workflow-signing', 'unsigned', 'change')
        driver.script("""
          const checkbox = [...document.querySelectorAll('gc-branch-workflow-dialog input[type=checkbox]')][0];
          checkbox.checked = true; checkbox.dispatchEvent(new Event('change', {bubbles:true}));
        """)
        button('Review finish')
        ready()
        driver.screenshot(Path(report['artifactsDirectory']) / 'branch-workflow-release-review.png')
        apply()
        status = driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish']
        assert status['phase'] == 'complete', status
        production = fixtures.git(repository, 'rev-parse', 'main')
        release_development = fixtures.git(repository, 'rev-parse', 'develop')
        assert fixtures.git(repository, 'rev-list', '--parents', '--max-count=1', 'main').split() == [production, production_before, release_source]
        assert fixtures.git(repository, 'rev-list', '--parents', '--max-count=1', 'develop').split() == [release_development, development, release_source]
        assert fixtures.git(repository, 'rev-parse', 'v1.0^{commit}') == production
        assert fixtures.git(repository, 'cat-file', '-t', 'v1.0') == 'tag'
        assert fixtures.git(repository, 'cat-file', '-p', 'v1.0').endswith('Owned native release\nRelease notes')
        assert not (repository / 'production-only.txt').exists(), 'Production-only changes were unexpectedly copied into development'
        assert not fixtures.git(repository, 'for-each-ref', '--format=%(refname)', 'refs/heads/release/1.0')
        acknowledge()
        report['scenarios'].append('native-ui-release-finish-integrates-original-source-into-both-targets-and-tags-production')

        start('hotfix', '1.1')
        assert fixtures.git(repository, 'rev-parse', 'HEAD') == production
        button('Close')
        hotfix_source = commit_file('hotfix.txt', 'owned hotfix\n', 'Owned UI hotfix')
        repo_id = open_ui(driver, repository)
        enter()
        button('Finish hotfix/1.1')
        button('Review finish')
        ready()
        apply()
        status = driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish']
        assert status['phase'] == 'complete', status
        fixtures.git(repository, 'merge-base', '--is-ancestor', hotfix_source, 'main')
        fixtures.git(repository, 'merge-base', '--is-ancestor', hotfix_source, 'develop')
        assert fixtures.git(repository, 'rev-parse', 'hotfix/1.1') == hotfix_source
        assert not fixtures.git(repository, 'for-each-ref', '--format=%(refname)', 'refs/tags/v1.1')
        assert fixtures.git(repository, 'status', '--porcelain') == ''
        acknowledge()
        button('Close')
        report['scenarios'].append('native-ui-hotfix-starts-at-production-finishes-both-targets-and-retains-topic-without-implicit-tag')
    except Exception:
        driver.screenshot(Path(report['artifactsDirectory']) / 'branch-workflow-ui-failure.png')
        state = driver.script("""return {
          dialog: document.querySelector('gc-branch-workflow-dialog')?.textContent,
          controls: [...document.querySelectorAll('gc-branch-workflow-dialog button')].map(button => ({text: button.textContent, disabled: button.disabled})),
          mainStatus: document.querySelector('[role=status]')?.textContent
        }""")
        (Path(report['artifactsDirectory']) / 'branch-workflow-ui-failure.json').write_text(json.dumps(state, indent=2))
        raise
    finally:
        open_ui(driver, original_repository)


def branch_workflow_restart_and_abort(driver, fixtures, original_repository, report):
    for action in ('continue', 'abort'):
        repository = _workflow_repository(fixtures, 'branch-workflow-' + action)
        initial = fixtures.git(repository, 'rev-parse', 'HEAD')
        try:
            repo_id = open_ui(driver, repository)
            settings = dict(version=1, production='main', development='develop', featurePrefix='feature/',
                            releasePrefix='release/', hotfixPrefix='hotfix/', tagPrefix='v')
            prepared = driver.invoke('prepare_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()),
                                     request=dict(action='setup', settings=settings, initialOid=initial))
            driver.invoke('execute_branch_workflow', repoId=repo_id, token=prepared['token'], operationId=str(uuid.uuid4()))
            # Ordinary manually named topics are supported. Divergent fixture
            # contents force a conflict only at the second integration target.
            fixtures.git(repository, 'checkout', '-q', 'develop')
            (repository / 'fixture.txt').write_text('development target\n')
            fixtures.git(repository, 'add', 'fixture.txt')
            fixtures.git(repository, 'commit', '-qm', 'Owned development target')
            development_before = fixtures.git(repository, 'rev-parse', 'HEAD')
            fixtures.git(repository, 'checkout', '-q', '-b', 'release/recovery', 'main')
            (repository / 'fixture.txt').write_text('release source\n')
            fixtures.git(repository, 'add', 'fixture.txt')
            fixtures.git(repository, 'commit', '-qm', 'Owned release source')
            source = fixtures.git(repository, 'rev-parse', 'HEAD')
            repo_id = open_ui(driver, repository)
            driver.click('.workspace-toggle')
            driver.click_text('.workspace-menu-actions button', 'Branch workflows')
            driver.wait("return !!document.querySelector('gc-branch-workflow-dialog .topics')")
            _workflow_button(driver, 'Finish release/recovery')
            _workflow_button(driver, 'Review finish')
            driver.wait("return !!document.querySelector('gc-branch-workflow-dialog .review')")
            _workflow_button(driver, 'Apply reviewed workflow')
            driver.wait("return document.querySelector('gc-branch-workflow-dialog')?.textContent.includes('Workflow paused for conflicts')", 60)
            status = driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish']
            assert status['phase'] == 'conflicted' and len(status['completedTargets']) == 1, status
            first_integration = fixtures.git(repository, 'rev-parse', 'main')
            assert first_integration == status['completedTargets'][0]
            assert fixtures.git(repository, 'rev-parse', 'develop') == development_before
            assert not fixtures.git(repository, 'for-each-ref', '--format=%(refname)', 'refs/tags/vrecovery')
            _workflow_button(driver, 'Close')
            # Recreate the renderer and repository session, retaining only Git's
            # durable operation/journal state, then use the actual recovery UI.
            repo_id = open_ui(driver, repository)
            if action == 'continue':
                (repository / 'fixture.txt').write_text('resolved after restart\n')
                fixtures.git(repository, 'add', 'fixture.txt')
            driver.click('.workspace-toggle')
            driver.click_text('.workspace-menu-actions button', 'Branch workflows')
            driver.wait("return document.querySelector('gc-branch-workflow-dialog')?.textContent.includes('Workflow paused for conflicts')")
            if action == 'continue':
                _workflow_button(driver, 'Inspect and continue')
                driver.wait("return document.querySelector('gc-branch-workflow-dialog')?.textContent.includes('Workflow complete')", 60)
                final = driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish']
                assert final['phase'] == 'complete' and len(final['completedTargets']) == 2, final
                assert fixtures.git(repository, 'rev-parse', 'main') == first_integration
                assert fixtures.git(repository, 'rev-parse', 'vrecovery^{commit}') == first_integration
                assert (repository / 'fixture.txt').read_text() == 'resolved after restart\n'
                assert fixtures.git(repository, 'status', '--porcelain') == ''
                report['scenarios'].append('native-ui-workflow-restart-continues-second-target-conflict-without-replaying-first-merge')
            else:
                _workflow_button(driver, 'Review stop')
                _workflow_button(driver, 'Stop workflow')
                driver.wait("return document.querySelector('gc-branch-workflow-dialog')?.textContent.includes('Workflow stopped')", 60)
                final = driver.invoke('load_branch_workflow', repoId=repo_id, operationId=str(uuid.uuid4()))['finish']
                assert final['phase'] == 'aborted', final
                assert fixtures.git(repository, 'rev-parse', 'main') == first_integration
                assert fixtures.git(repository, 'rev-parse', 'develop') == development_before
                assert (repository / 'fixture.txt').read_text() == 'development target\n'
                assert not (repository / '.git/MERGE_HEAD').exists()
                report['scenarios'].append('native-ui-workflow-stop-aborts-only-current-merge-and-retains-first-integration')
            assert fixtures.git(repository, 'rev-parse', 'release/recovery') == source
            for capture in final['recovery']:
                assert fixtures.git(repository, 'rev-parse', capture['headReference']) == capture['headOid']
            driver.screenshot(Path(report['artifactsDirectory']) / ('branch-workflow-recovery-' + action + '.png'))
            _workflow_button(driver, 'Close')
        finally:
            open_ui(driver, original_repository)

def hosted_repository_discovery_and_clone(driver, fixtures, original_repository, report):
    source = fixtures.repository('hosted-discovery-source', commits=3)
    fixtures.git(source, 'branch', 'topic/reviewed')
    head = fixtures.git(source, 'rev-parse', 'HEAD')
    before_refs = fixtures.git(source, 'show-ref')
    before_index = (source / '.git/index').read_bytes()
    before_bytes = (source / 'fixture.txt').read_bytes()
    gate = fixtures.hosting_gate
    config_path = gate / 'config.json'
    original_config = config_path.read_bytes()
    config = {'repository': 'owned-fixture/native-repo', 'oid': head, 'actor': 'owned-author', 'allowDiscovery': True}
    config_path.write_text(json.dumps(config))
    git_config = Path(fixtures.env['GIT_CONFIG_GLOBAL'])
    original_git_config = git_config.read_bytes()
    # Git's real clone implementation uses a fixture-owned rewrite. Disallow the
    # external protocols as well: a missed rewrite must fail, never use a host.
    git_config.write_bytes(original_git_config + (
        '[protocol "https"]\nallow = never\n[protocol "ssh"]\nallow = never\n'
        f'[url "{source.as_uri()}"]\ninsteadOf = https://github.com/owned-fixture/native-repo.git\n'
        'insteadOf = git@github.com:owned-fixture/native-repo.git\n').encode())
    query = dict(page=1, expectedAccountId=None, visibility='all', affiliation='accessible', sort='fullName', direction='ascending')
    context = 'owned-native-hosted-clone'
    def hosted_button(text):
        driver.wait(f"return [...document.querySelectorAll('gc-hosted-repository-browser button')].some(button => button.textContent.trim() === {json.dumps(text)} && !button.matches(':disabled'))")
        driver.click_text('gc-hosted-repository-browser button', text)
    def prepare(folder, transport='https', depth=None, branch=None):
        return driver.invoke('prepare_hosted_clone', contextId=context, operationId=str(uuid.uuid4()), request={
            'fullName': config['repository'], 'repositoryId': '9007199254740993', 'accountId': '501',
            'transport': transport, 'parentPath': str(fixtures.root), 'folder': folder, 'branch': branch,
            'depth': depth, 'recurseSubmodules': False})
    def execute(preview, selected_context=context):
        return driver.invoke('execute_hosted_clone', contextId=selected_context, token=preview['token'], operationId=str(uuid.uuid4()))
    def refuses(preview, kind, selected_context=context):
        try:
            execute(preview, selected_context)
        except RuntimeError as error:
            assert kind in str(error), error
        else:
            raise AssertionError('Owned hosted clone unexpectedly succeeded')
    try:
        page = driver.invoke('load_hosted_repositories', query=query, operationId=str(uuid.uuid4()))
        assert page['account']['id'] == '501' and page['entries'][0]['id'] == '9007199254740993'
        assert page['entries'][0]['canPush'] is False
        assert 'temp_clone_token' not in json.dumps(page) and 'owned-private-field' not in json.dumps(page)
        query.update(page=2, expectedAccountId='501')
        assert driver.invoke('load_hosted_repositories', query=query, operationId=str(uuid.uuid4()))['entries'] == []
        report['scenarios'].append('native-hosted-catalogue-precision-safe-identities-account-bound-pages-and-private-field-exclusion')

        preview = prepare('hosted-clone-account-refusal')
        config['actor'] = 'owned-other-account'; config_path.write_text(json.dumps(config))
        refuses(preview, 'hostingDiscoveryRequest')
        assert not (fixtures.root / 'hosted-clone-account-refusal').exists()
        refuses(preview, 'staleHostedClonePlan')
        config['actor'] = 'owned-author'; config_path.write_text(json.dumps(config))
        preview = prepare('hosted-clone-existing')
        destination = fixtures.root / 'hosted-clone-existing'; destination.mkdir()
        (destination / 'retain').write_text('existing owned bytes')
        refuses(preview, 'hostedCloneRefused')
        assert (destination / 'retain').read_text() == 'existing owned bytes'
        report['scenarios'].append('native-hosted-clone-revalidates-account-consumes-refused-preview-and-preserves-existing-destination')

        preview = prepare('hosted-clone-ssh', 'ssh', 1, 'topic/reviewed')
        preview['plan']['url'] = 'https://unowned.example.test/altered.git'
        refuses(preview, 'staleHostedClonePlan', 'other-owned-context')
        assert not (fixtures.root / 'hosted-clone-ssh').exists()
        cloned = execute(preview)
        checkout = Path(cloned['path'])
        assert fixtures.git(checkout, 'rev-parse', 'HEAD') == head
        assert fixtures.git(checkout, 'symbolic-ref', '--short', 'HEAD') == 'topic/reviewed'
        assert (checkout / '.git/shallow').exists()
        assert fixtures.git(checkout, 'config', '--get', 'remote.origin.url') == 'git@github.com:owned-fixture/native-repo.git'
        assert (checkout / 'fixture.txt').read_bytes() == before_bytes
        refuses(preview, 'staleHostedClonePlan')
        fixtures.git(checkout, 'remote', 'set-url', 'origin', source.as_uri())
        report['scenarios'].append('native-hosted-clone-server-plan-context-binding-ssh-shallow-branch-and-single-use-with-real-git')

        open_ui(driver, original_repository)
        driver.click('[aria-label="New repository tab"]')
        driver.wait("return !!document.querySelector('#repository-tab-clone')?.getClientRects().length")
        driver.click_text('gc-repository-dialog [role=tab]', 'Clone')
        driver.wait("return [...document.querySelectorAll('gc-repository-dialog button')].some(button => button.textContent.trim() === 'Browse repositories on GitHub')")
        driver.click_text('gc-repository-dialog button', 'Browse repositories on GitHub')
        hosted_button('Load repositories')
        driver.wait("return document.querySelector('[data-hosted-account]')?.textContent.includes('owned-author')")
        hosted_button('Select owned-fixture/native-repo')
        driver.wait("return !!document.querySelector('#hosted-parent')")
        # Enter the destination through its normal editable field. All hosted
        # commands, registration and Git cloning use the packaged backend.
        driver.script("const input=document.querySelector('#hosted-parent'); input.value=arguments[0]; input.dispatchEvent(new Event('input',{bubbles:true}));", str(fixtures.root))
        driver.wait(f"return document.querySelector('#hosted-parent')?.value === {json.dumps(str(fixtures.root))}")
        driver.script("const input=document.querySelector('#hosted-folder'); input.value='hosted-clone-ui'; input.dispatchEvent(new Event('input',{bubbles:true}));")
        hosted_button('Review hosted clone')
        driver.wait("return !!document.querySelector('gc-hosted-repository-browser [aria-label=\"Review hosted clone\"]')")
        assert not (fixtures.root / 'hosted-clone-ui').exists()
        driver.screenshot(Path(report['artifactsDirectory']) / 'hosted-clone-ui-review.png')
        hosted_button('Clone reviewed repository')
        driver.wait("return !document.querySelector('gc-repository-dialog')", 60)
        checkout = fixtures.root / 'hosted-clone-ui'
        assert fixtures.git(checkout, 'rev-parse', 'HEAD') == head
        assert fixtures.git(checkout, 'config', '--get', 'remote.origin.url') == 'https://github.com/owned-fixture/native-repo.git'
        assert fixtures.git(checkout, 'status', '--porcelain') == ''
        assert (checkout / 'fixture.txt').read_bytes() == before_bytes
        assert not (checkout / '.git/shallow').exists()
        driver.screenshot(Path(report['artifactsDirectory']) / 'hosted-clone-ui-completed.png')
        fixtures.git(checkout, 'remote', 'set-url', 'origin', source.as_uri())
        report['scenarios'].append('native-ui-hosted-catalogue-reviewed-https-clone-opens-exact-owned-history-and-files')

        open_ui(driver, original_repository)
        hold, started = gate / 'hold', gate / 'started'
        started.unlink(missing_ok=True); hold.touch()
        operation = str(uuid.uuid4())
        try:
            driver.script("""
              window.__ownedCatalogueRead={done:false};
              window.__TAURI_INTERNALS__.invoke('load_hosted_repositories',arguments[0]).then(
                value => {window.__ownedCatalogueRead={done:true,value}},
                error => {window.__ownedCatalogueRead={done:true,error}});
            """, dict(query=dict(query, page=1), operationId=operation))
            deadline = time.monotonic() + 10
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            assert started.exists(), 'Owned hosted catalogue did not reach its read gate'
            pid = int(started.read_text())
            assert driver.invoke('cancel_git_operation', operationId=operation)
            driver.wait('return window.__ownedCatalogueRead.done', 10)
            assert driver.script('return window.__ownedCatalogueRead.error.kind') == 'operationCancelled'
            stat = Path('/proc') / str(pid) / 'stat'
            assert not stat.exists() or stat.read_text().rsplit(') ', 1)[1].startswith('Z')
        finally:
            hold.unlink(missing_ok=True)
        report['scenarios'].append('native-hosted-catalogue-cancellation-reaps-owned-cli-read-without-cloning')
        assert fixtures.git(source, 'show-ref') == before_refs
        assert (source / '.git/index').read_bytes() == before_index
        assert (source / 'fixture.txt').read_bytes() == before_bytes
    except Exception:
        driver.screenshot(Path(report['artifactsDirectory']) / 'hosted-discovery-failure.png')
        raise
    finally:
        git_config.write_bytes(original_git_config)
        config_path.write_bytes(original_config)
        open_ui(driver, original_repository)


def hosted_fork_requests(driver, fixtures, original_repository, report):
    """Real native reviews and private journal; provider writes stay offline."""
    source = fixtures.repository('hosted-fork-git-source', commits=3)
    head = fixtures.git(source, 'rev-parse', 'HEAD')
    source_refs = fixtures.git(source, 'show-ref')
    source_index = (source / '.git/index').read_bytes()
    source_bytes = (source / 'fixture.txt').read_bytes()
    git_config = Path(fixtures.env['GIT_CONFIG_GLOBAL'])
    original_git_config = git_config.read_bytes()
    gate = fixtures.hosting_gate
    config_path, state_path = gate / 'config.json', gate / 'write-state.json'
    original_config = config_path.read_bytes()
    original_state = state_path.read_bytes() if state_path.exists() else None
    config = dict(repository='owned-fixture/native-repo', oid=head,
                  treeOid=fixtures.git(source, 'rev-parse', 'HEAD^{tree}'),
                  allowForks=True, allowDiscovery=True, forkPending=True,
                  actor='owned-author', forkName='owned-fork', uncertainAfterWrite=True)
    context = 'owned-native-fork'
    request = dict(sourceFullName=config['repository'], sourceRepositoryId='9007199254740993',
                   accountId='501', destinationOwner='owned-author', name='owned-fork', defaultBranchOnly=True)
    def invoke(command, **args):
        return driver.invoke(command, operationId=str(uuid.uuid4()), **args)
    def refuses(command, kind, **args):
        try:
            invoke(command, **args)
        except RuntimeError as error:
            assert kind in str(error), error
        else:
            raise AssertionError('Owned fork precondition unexpectedly succeeded')
    def submissions():
        return json.loads(state_path.read_text()).get('forks', []) if state_path.exists() else []
    def save_config():
        config_path.write_text(json.dumps(config))
    def archive_preview(record):
        return invoke('prepare_hosted_fork_acknowledgement', contextId=context, id=record['id'])
    def archive(review):
        return invoke('execute_hosted_fork_acknowledgement', contextId=context, token=review['token'])
    try:
        git_config.write_bytes(original_git_config + (
            '[protocol "https"]\nallow = never\n[protocol "ssh"]\nallow = never\n'
            f'[url "{source.as_uri()}"]\ninsteadOf = https://github.com/owned-organization/organization-fork.git\n'
            'insteadOf = git@github.com:owned-organization/organization-fork.git\n').encode())
        state_path.unlink(missing_ok=True)
        save_config()
        before = invoke('list_hosted_fork_requests')
        preview = invoke('prepare_hosted_fork', contextId=context, request=request)
        assert not submissions()
        refuses('execute_hosted_fork', 'staleHostedForkReview', contextId='other-owned-context', token=preview['token'])
        refuses('execute_hosted_fork_acknowledgement', 'staleHostedForkReview', contextId=context, token=preview['token'])
        preview['plan']['intent']['name'] = 'client-altered-fork'
        record = invoke('execute_hosted_fork', contextId=context, token=preview['token'])
        assert record['phase'] == 'awaitingConfirmation' and record['serverReplyReceived'] is False
        assert record['intent']['name'] == 'owned-fork'
        assert submissions() == [dict(name='owned-fork', default_branch_only=True)]
        refuses('execute_hosted_fork', 'staleHostedForkReview', contextId=context, token=preview['token'])
        journals = list(Path(fixtures.env['XDG_DATA_HOME']).glob('*/hosted-fork-requests/' + record['id'] + '.json'))
        assert len(journals) == 1, journals
        journal = journals[0]
        assert journal.stat().st_mode & 0o777 == 0o600
        assert journal.parent.stat().st_mode & 0o777 == 0o700
        assert 'owned-token-' not in journal.read_text()
        report['scenarios'].append('native-fork-server-plan-context-purpose-single-use-and-private-durable-uncertain-outcome')

        # Recreate the renderer/session and read the native on-disk record.
        # This is renderer recovery, not an application-process restart claim.
        open_ui(driver, original_repository)
        saved = invoke('list_hosted_fork_requests')
        assert {row['id'] for row in saved} == {row['id'] for row in before} | {record['id']}
        assert invoke('load_hosted_fork_request', id=record['id']) == record
        duplicate = invoke('prepare_hosted_fork', contextId=context, request=request)
        assert invoke('execute_hosted_fork', contextId=context, token=duplicate['token'])['id'] == record['id']
        assert len(submissions()) == 1
        assert invoke('reconcile_hosted_fork', id=record['id'])['phase'] == 'awaitingConfirmation'
        stale_archive = archive_preview(record)
        assert stale_archive['unresolved'] is True
        config.update(forkPending=False, forkObjectsPending=True)
        save_config()
        metadata = invoke('reconcile_hosted_fork', id=record['id'])
        assert metadata['phase'] == 'metadataAvailable' and metadata['repository']['id'] == '9007199254740995'
        refuses('execute_hosted_fork_acknowledgement', 'hostingForkRequest', contextId=context, token=stale_archive['token'])
        config['forkObjectsPending'] = False
        save_config()
        ready = invoke('reconcile_hosted_fork', id=record['id'])
        assert ready['phase'] == 'ready' and ready['headOid'] == head
        page = invoke('load_hosted_forks', query=dict(sourceFullName=request['sourceFullName'],
                      sourceRepositoryId=request['sourceRepositoryId'], accountId='501', page=1))
        assert page['entries'][0]['id'] == '9007199254740995'
        checked = invoke('inspect_hosted_fork', selection=dict(sourceFullName=request['sourceFullName'],
                         sourceRepositoryId=request['sourceRepositoryId'], accountId='501',
                         forkFullName='owned-author/owned-fork', forkRepositoryId='9007199254740995', forkOwnerId='501'))
        assert checked['repository']['fullName'] == 'owned-author/owned-fork'
        assert len(submissions()) == 1
        review = archive_preview(ready)
        assert review['unresolved'] is False
        assert archive(review) == ready
        assert invoke('list_hosted_fork_requests') == before
        assert invoke('load_hosted_fork_request', id=record['id']) == ready
        assert not journal.exists() and (journal.parent / 'archive' / journal.name).exists()
        assert len(submissions()) == 1
        report['scenarios'].append('native-fork-renderer-recovery-no-post-replay-readiness-fresh-inspection-stale-archive-and-retained-outcome')

        config.update(forkOwner='owned-organization', forkOwnerId=702, forkOwnerType='Organization',
                      forkName='organization-fork', forkDefaultBranchOnly=False, uncertainAfterWrite=False)
        save_config()
        def button(text, selector='gc-hosted-forks button'):
            driver.wait(f"return [...document.querySelectorAll({json.dumps(selector)})].some(button => button.textContent.trim() === {json.dumps(text)} && !button.matches(':disabled'))")
            driver.click_text(selector, text)
        def fill(selector, value):
            driver.script("const input=document.querySelector(arguments[0]); input.value=arguments[1]; input.dispatchEvent(new Event('input',{bubbles:true}));", selector, value)
        def checkbox_layout(selector):
            boxes = driver.script("""return [...document.querySelectorAll(arguments[0])].map(input => {
              const box=input.getBoundingClientRect(), label=input.parentElement.getBoundingClientRect();
              return {width:box.width,height:box.height,offset:Math.abs(box.left-label.left)};
            })""", selector)
            assert boxes and all(12 <= box['width'] <= 20 and 12 <= box['height'] <= 20 and box['offset'] <= 2 for box in boxes), boxes
        driver.click('[aria-label="New repository tab"]')
        driver.wait("return !!document.querySelector('#repository-tab-clone')?.getClientRects().length")
        driver.click_text('gc-repository-dialog [role=tab]', 'Clone')
        button('Browse repositories on GitHub', 'gc-repository-dialog button')
        button('Load repositories', 'gc-hosted-repository-browser button')
        button('Select owned-fixture/native-repo', 'gc-hosted-repository-browser button')
        button('Manage forks and saved requests', 'gc-hosted-repository-browser button')
        driver.wait("return !!document.querySelector('#fork-name')")
        checkbox_layout('gc-hosted-forks .check input[type=checkbox]')
        driver.script("const input=document.querySelector('gc-hosted-forks input[type=checkbox]'); input.checked=true; input.dispatchEvent(new Event('change',{bubbles:true}));")
        driver.wait("return !!document.querySelector('#fork-owner')")
        fill('#fork-owner', 'owned-organization')
        fill('#fork-name', 'organization-fork')
        driver.script("const inputs=document.querySelectorAll('gc-hosted-forks fieldset input[type=checkbox]'); const input=inputs[inputs.length-1]; input.checked=false; input.dispatchEvent(new Event('change',{bubbles:true}));")
        button('Review fork creation')
        driver.wait("return document.querySelector('gc-hosted-forks [aria-label=\"Review fork creation\"]')?.textContent.includes('All branches')")
        assert len(submissions()) == 1
        driver.screenshot(Path(report['artifactsDirectory']) / 'hosted-organization-fork-review.png')
        button('Submit reviewed fork request')
        driver.wait("return document.querySelector('gc-hosted-forks [aria-label=\"Saved fork outcome\"]')?.textContent.includes('Accepted; verification pending')")
        assert submissions()[-1] == dict(name='organization-fork', default_branch_only=False, organization='owned-organization')
        button('Check fork status')
        driver.wait("return document.querySelector('gc-hosted-forks [aria-label=\"Saved fork outcome\"]')?.textContent.includes('Fork verified and ready for use')")
        button('Inspect fork for cloning')
        driver.wait("return !!document.querySelector('gc-hosted-forks [aria-label=\"Verified fork for cloning\"]')")
        button('Use this fork for cloning')
        driver.wait("return document.querySelector('gc-hosted-repository-browser .selection h3')?.textContent.trim() === 'owned-organization/organization-fork'")
        assert driver.script("return document.querySelector('#hosted-folder').value") == 'organization-fork'
        checkbox_layout('gc-hosted-repository-browser .check input[type=checkbox]')
        assert not (fixtures.root / 'organization-fork').exists()
        assert len(submissions()) == 2
        driver.screenshot(Path(report['artifactsDirectory']) / 'hosted-fork-clone-handoff.png')
        report['scenarios'].append('native-ui-reviewed-organization-all-branches-fork-readiness-and-separate-clone-handoff')
        fill('#hosted-parent', str(fixtures.root))
        button('Review hosted clone', 'gc-hosted-repository-browser button')
        driver.wait("return !!document.querySelector('gc-hosted-repository-browser [aria-label=\"Review hosted clone\"]')")
        assert not (fixtures.root / 'organization-fork').exists()
        button('Clone reviewed repository', 'gc-hosted-repository-browser button')
        driver.wait("return !document.querySelector('gc-repository-dialog')", 60)
        checkout = fixtures.root / 'organization-fork'
        assert fixtures.git(checkout, 'rev-parse', 'HEAD') == head
        assert fixtures.git(checkout, 'rev-list', '--count', 'HEAD') == '3'
        assert fixtures.git(checkout, 'status', '--porcelain') == ''
        assert (checkout / 'fixture.txt').read_bytes() == source_bytes
        assert fixtures.git(checkout, 'config', '--get', 'remote.origin.url') == 'https://github.com/owned-organization/organization-fork.git'
        fixtures.git(checkout, 'remote', 'set-url', 'origin', source.as_uri())
        assert fixtures.git(source, 'show-ref') == source_refs
        assert (source / '.git/index').read_bytes() == source_index
        assert (source / 'fixture.txt').read_bytes() == source_bytes
        assert len(submissions()) == 2
        report['scenarios'].append('native-ui-ready-fork-separate-reviewed-clone-preserves-exact-owned-history-and-source-state')

        config.update(forkName='cancelled-submission', holdWritesOnly=True)
        save_config()
        cancel_request = request | dict(destinationOwner='owned-organization', name='cancelled-submission', defaultBranchOnly=False)
        preview = invoke('prepare_hosted_fork', contextId=context, request=cancel_request)
        operation = str(uuid.uuid4())
        (gate / 'hold').touch()
        driver.script("""
          window.__ownedForkSubmission={done:false};
          window.__TAURI_INTERNALS__.invoke('execute_hosted_fork',arguments[0]).then(
            value => {window.__ownedForkSubmission={done:true,value}},
            error => {window.__ownedForkSubmission={done:true,error}});
        """, dict(contextId=context, token=preview['token'], operationId=operation))
        deadline = time.monotonic() + 15
        child = None
        while time.monotonic() < deadline:
            rows = [json.loads(line) for line in (gate / 'requests.jsonl').read_text().splitlines()]
            matching = [row for row in rows if row['method'] == 'POST' and row['payload'] ==
                        dict(name='cancelled-submission', default_branch_only=False, organization='owned-organization')]
            if matching:
                child = matching[-1]['pid']
                break
            time.sleep(.02)
        assert child is not None, 'Owned fork submission did not reach the held dispatch boundary'
        assert driver.invoke('cancel_git_operation', operationId=operation)
        driver.wait('return window.__ownedForkSubmission.done', 10)
        cancelled = driver.script('return window.__ownedForkSubmission')
        assert cancelled.get('value', {}).get('phase') == 'awaitingConfirmation', cancelled
        assert cancelled['value']['serverReplyReceived'] is False
        assert invoke('load_hosted_fork_request', id=cancelled['value']['id']) == cancelled['value']
        stat = Path('/proc') / str(child) / 'stat'
        assert not stat.exists() or stat.read_text().rsplit(') ', 1)[1].startswith('Z')
        assert len(submissions()) == 2
        (gate / 'hold').unlink()
        report['scenarios'].append('native-fork-cancelled-dispatch-reaps-owned-cli-and-retains-unconfirmed-outcome-without-retry')
    except Exception:
        driver.screenshot(Path(report['artifactsDirectory']) / 'hosted-fork-failure.png')
        raise
    finally:
        (gate / 'hold').unlink(missing_ok=True)
        driver.script('delete window.__ownedForkSubmission')
        git_config.write_bytes(original_git_config)
        config_path.write_bytes(original_config)
        if original_state is None:
            state_path.unlink(missing_ok=True)
        else:
            state_path.write_bytes(original_state)
        open_ui(driver, original_repository)


def full_toolkit(driver, fixtures, repository, repo_id, report):
    hosted_fork_remote_attachment(driver, fixtures, repository, report)
    hosted_fork_requests(driver, fixtures, repository, report)
    hosted_repository_discovery_and_clone(driver, fixtures, repository, report)
    branch_workflow_native_boundary(driver, fixtures, repository, report)
    branch_workflow_desktop(driver, fixtures, repository, report)
    branch_workflow_restart_and_abort(driver, fixtures, repository, report)
    rebase_row_keyboard_preview(driver, fixtures, repository, report)
    hosted_paging_and_decisions(driver, fixtures, repository, report)
    hosted_reviewed_writes(driver, fixtures, repository, report)
    workspace_center_workflows(driver, fixtures, repository, report)
    committed_merge_preview(driver, fixtures, repository, report)
    shared_parent_avatar_attachments(driver, fixtures, repository, report)
    avatar_side_attachments(driver, fixtures, repository, report)
    reference_hover_stability(driver, fixtures, repository, report)
    authenticated_lfs_lock_listing(driver, fixtures, report)
    local_remote_quoted_targets(driver, fixtures, repository, report)
    local_remote_tls_words(driver, fixtures, repository, report)
    authenticated_push_rejection(driver, fixtures, repository, report)
    reference_namespace_names(driver, fixtures, report)
    transport_cancel_after_parent_exit(driver, fixtures, report)
    transport_config_cancellation(driver, fixtures, report)
    clone_url_policy(driver, fixtures, report)
    clone_template_password_policy(driver, fixtures, report)
    busy_workspace_menu_focus(driver, fixtures, repository, report)
    def call(command, **args):
        return driver.invoke(command, repoId=repo_id, **args)

    def head():
        return fixtures.git(repository, "rev-parse", "HEAD")

    def commit(message):
        call("stage_all")
        return call("commit_changes", message=message, amend=False, skipHooks=False, sign=False)["headOid"]

    def passed(name):
        report["scenarios"].append(name)

    base = head()
    file = repository / "fixture.txt"
    file.write_text("changed through native fixture\n")
    diff = call("inspect_working_tree_file", path="fixture.txt", staged=False)
    assert "changed through native fixture" in diff["patch"]
    call("stage_path", path="fixture.txt")
    assert fixtures.git(repository, "diff", "--cached", "--name-only") == "fixture.txt"
    call("unstage_all")
    preview = call("preview_discard", paths=["fixture.txt"])
    discarded = call("discard_changes", token=preview["token"])
    assert "changed through" not in file.read_text()
    call("apply_saved_discard", id=discarded["id"], reverse=False)
    assert file.read_text() == "changed through native fixture\n"
    committed = commit("Native packaged commit")
    assert head() == committed and committed != base
    passed("stage-unstage-diff-commit-discard-recovery")

    call("create_branch_at", name="native-side", oid=base)
    call("checkout_branch", name="native-side")
    (repository / "side.txt").write_text("side\n")
    side = commit("Side change")
    call("checkout_branch", name="main")
    call("cherry_pick_commits", oids=[side], mainline=None, noCommit=False)
    assert (repository / "side.txt").read_text() == "side\n"
    picked = head()
    call("revert_commit", oid=picked, mainline=None, oids=None)
    assert not (repository / "side.txt").exists()
    call("create_tag", name="native-tag", oid=head(), message="Native annotated tag")
    assert call("inspect_tag", name="native-tag")["annotated"]
    call("rename_branch", oldName="native-side", newName="native-renamed")
    assert fixtures.git(repository, "rev-parse", "native-renamed") == side
    passed("branches-tags-cherry-pick-revert")

    file.write_text("stash contents\n")
    call("stash_changes", message="Native stash")
    assert not fixtures.git(repository, "status", "--porcelain")
    assert call("inspect_stash", oid=fixtures.git(repository, "rev-parse", "refs/stash"))["files"]
    call("pop_stash", expectedOid=fixtures.git(repository, "rev-parse", "refs/stash"))
    assert file.read_text() == "stash contents\n"
    fixtures.git(repository, "restore", "fixture.txt")
    passed("stash-inspection-and-pop")

    original = head()
    prepared = call("preview_reset", oid=base, mode="hard")
    call("execute_prepared_reset", token=prepared["token"])
    assert head() == base
    recoveries = call("load_operation_recoveries")
    assert recoveries
    call("restore_operation_recovery", id=recoveries[0]["id"], branch="native-recovery")
    assert fixtures.git(repository, "rev-parse", "native-recovery") == original
    call("checkout_branch", name="main")
    passed("reviewed-reset-and-operation-recovery")

    # Deliberately create a conflict, verify the failed operation is recoverable,
    # then abort through the same native command boundary used by the renderer.
    call("create_branch_at", name="conflict-side", oid=base)
    call("checkout_branch", name="conflict-side")
    file.write_text("side conflict\n")
    commit("Side conflict")
    call("checkout_branch", name="main")
    file.write_text("main conflict\n")
    commit("Main conflict")
    original = head()
    try:
        call("integrate_branch", name="conflict-side", strategy="merge")
    except RuntimeError:
        pass
    assert call("refresh_repository_status")["mergeInProgress"]
    conflict = call("inspect_conflict", path="fixture.txt")
    assert conflict["current"] is not None and conflict["incoming"] is not None
    call("abort_merge")
    assert head() == original and not call("refresh_repository_status")["mergeInProgress"]
    passed("merge-conflict-inspection-and-abort")

    linked = fixtures.root / "native-linked"
    call("create_worktree", parentPath=str(fixtures.root), folder=linked.name, branch="native-linked", base="main")
    assert fixtures.git(linked, "rev-parse", "HEAD") == head()
    call("set_worktree_locked", path=str(linked), locked=True)
    assert "locked" in fixtures.git(repository, "worktree", "list", "--porcelain")
    call("set_worktree_locked", path=str(linked), locked=False)
    call("remove_worktree", path=str(linked), deleteBranch=True, force=False)
    assert not linked.exists()
    assert call("worktree_registration_review")["registrations"]
    passed("worktree-create-lock-remove-review")

    source = fixtures.repository("submodule-source", 2)
    call("add_submodule", url=str(source), path="vendor/module", operationId=str(uuid.uuid4()))
    commit("Add submodule")
    review = call("submodule_state_review")
    assert any(entry["path"] == "vendor/module" and entry["checkedOut"] for entry in review["entries"])
    passed("submodule-add-and-review")

    file.write_text("patch contents\n")
    patch = fixtures.root / "owned.patch"
    call("export_diff_patch", staged=False, paths=["fixture.txt"], destination=str(patch))
    fixtures.git(repository, "restore", "fixture.txt")
    review = call("review_diff_patch", file=str(patch), target="worktree")
    call("import_diff_patch", request=review["request"])
    assert file.read_text() == "patch contents\n"
    fixtures.git(repository, "restore", "fixture.txt")
    bundle = fixtures.root / "owned.bundle"
    call("export_git_bundle", branch="main", expectedOid=head(), destination=str(bundle))
    assert call("review_git_bundle", file=str(bundle))["request"]["tips"]
    mail = fixtures.root / "owned.mbox"
    review = call("review_mail_patch_export", oids=[head()])
    call("export_mail_patch", request=review["request"], destination=str(mail))
    assert mail.is_file() and "From " in mail.read_text()
    passed("patch-roundtrip-bundle-review-mail-export")

    query = dict(message="Native", author="", oid="", since="", until="", path="", scope="")
    assert call("search_repository_history", query=query, cursor=None, operationId=str(uuid.uuid4()))["entries"]
    assert call("inspect_file_blame", revision=head(), path="fixture.txt")
    assert call("load_reflog")["entries"]
    call("start_bisect", badOid=head(), goodOid=fixtures.git(repository, "rev-parse", "HEAD~5"))
    assert call("refresh_repository_status")["bisectInProgress"]
    call("reset_bisect")
    assert not call("refresh_repository_status")["bisectInProgress"]
    passed("history-search-blame-reflog-bisect")

    paged_repository = fixtures.repository("paged-history", commits=350)
    opened = driver.invoke("open_repository", path=str(paged_repository))
    paged_id = opened["id"]
    first_page = driver.invoke("load_more_commits", repoId=paged_id)
    loaded = opened["commits"] + first_page["commits"]
    assert len(loaded) > len(opened["commits"])
    refreshed = driver.invoke("refresh_repository", repoId=paged_id)
    assert [entry["oid"] for entry in refreshed["commits"]] == [entry["oid"] for entry in loaded], (
        "Metadata refresh discarded loaded history", len(loaded), len(refreshed["commits"])
    )
    second_page = driver.invoke("load_more_commits", repoId=paged_id)
    all_loaded = loaded + second_page["commits"]
    assert not second_page["historyTruncated"]
    assert [entry["oid"] for entry in all_loaded] == fixtures.git(
        paged_repository, "rev-list", "--date-order", "--all"
    ).splitlines(), "History pagination skipped or repeated commits after refresh"
    assert len(driver.invoke("refresh_repository", repoId=paged_id)["commits"]) == 350
    passed("native-history-pagination-survives-refresh")
    shallow_history_pagination(driver, fixtures, report)
    damaged_history_pagination(driver, fixtures, report)
    control_character_history(driver, fixtures, report)
    control_character_stashes(driver, fixtures, report)
    selected_stash_actions(driver, fixtures, report)
    immutable_stash_previews(driver, fixtures, report)
    commit_preview_output(driver, fixtures, report)
    bounded_file_history_reads(driver, fixtures, report)
    blame_read_acceptance(driver, fixtures, report)
    stash_delete_confirmation(driver, fixtures, report)
    stash_pop_partial_ui(driver, fixtures, report)
    # This UI scenario intentionally navigates to its own disposable repository.
    # Restore the toolkit's selected repository before its terminal/UI steps.
    assert open_ui(driver, repository) == repo_id

    assert call("inspect_repository_integrity", operationId=str(uuid.uuid4()))["passed"]
    call("perform_repository_maintenance")
    assert call("cancel_git_operation", operationId="not-running") is False
    terminal = call("open_terminal", rows=24, cols=80)
    driver.invoke("resize_terminal", sessionId=terminal["id"], rows=30, cols=100)
    terminal_root = repository / ".git/native-terminal-root"
    terminal_error = repository / ".git/native-terminal-error"
    terminal_done = repository / ".git/native-terminal-done"
    probe = repository / "native-terminal-probe.txt"
    probe.write_bytes(b"selected terminal repository\n")
    try:
        driver.invoke("write_terminal", sessionId=terminal["id"], data=list(
            b"git rev-parse --show-toplevel > .git/native-terminal-root 2> .git/native-terminal-error; "
            b"git add -- native-terminal-probe.txt 2>> .git/native-terminal-error; "
            b"printf done > .git/native-terminal-done\n"))
        deadline = time.monotonic() + 10
        while not terminal_done.exists():
            if time.monotonic() > deadline:
                raise TimeoutError("Native terminal commands did not finish")
            time.sleep(0.05)
        assert terminal_root.read_text().strip() == str(repository), (
            "Terminal Git used the wrong repository", terminal_root.read_text(), terminal_error.read_text())
        assert not terminal_error.read_text(), terminal_error.read_text()
        assert fixtures.git(repository, "show", ":native-terminal-probe.txt") == "selected terminal repository"
        fixtures.git(repository, "restore", "--staged", "--", probe.name)
        probe.unlink()
    finally:
        driver.invoke("close_terminal", sessionId=terminal["id"])
    passed("native-terminal-git-uses-selected-repository")
    terminal = call("open_terminal", rows=24, cols=80)
    terminal_pid = repository / ".git/native-terminal-exit-pid"
    driver.invoke("write_terminal", sessionId=terminal["id"], data=list(
        b"printf '%s\\n' \"$$\" > .git/native-terminal-exit-pid; exit\n"))
    deadline = time.monotonic() + 10
    while not terminal_pid.exists() or not terminal_pid.read_text().endswith("\n"):
        if time.monotonic() > deadline:
            raise TimeoutError("Native terminal did not report its owned shell PID")
        time.sleep(0.05)
    process = Path(f"/proc/{int(terminal_pid.read_text())}/stat")
    while process.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not process.exists(), "Exited native terminal shell was not reaped"
    driver.invoke("close_terminal", sessionId=terminal["id"])
    passed("native-terminal-natural-exit-reaps-owned-shell")
    terminal = call("open_terminal", rows=24, cols=80)
    terminal_pid = repository / ".git/native-terminal-close-pid"
    driver.invoke("write_terminal", sessionId=terminal["id"], data=list(
        b"trap '' HUP; printf '%s\\n' \"$$\" > .git/native-terminal-close-pid\n"))
    deadline = time.monotonic() + 10
    while not terminal_pid.exists() or not terminal_pid.read_text().endswith("\n"):
        if time.monotonic() > deadline:
            raise TimeoutError("Native terminal did not install its owned HUP-refusal fixture")
        time.sleep(0.05)
    process = Path(f"/proc/{int(terminal_pid.read_text())}/stat")
    driver.invoke("close_terminal", sessionId=terminal["id"])
    while process.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not process.exists(), "Closing an HUP-ignoring shell did not reap the owned process"
    passed("native-terminal-close-reaps-hup-ignoring-owned-shell")
    terminal_input_backpressure(driver, fixtures, repository, repo_id, report)
    terminal_lifecycle_events(driver, repository, repo_id, report)
    terminal_renderer_startup_failure(driver, fixtures, report)
    authentication_prompt_recovery(driver, repo_id, report)
    passed("integrity-maintenance-terminal-and-idle-cancellation")

    # UI acceptance remains separate from command acceptance above.
    driver.reload()
    driver.wait("return !!document.querySelector('.wip-nav')")
    driver.click('.wip-nav')
    (repository / "ui.txt").write_text("committed from the native UI\n")
    driver.wait("return !!document.querySelector('[aria-label=\"Stage all changes\"]:not(:disabled)')")
    driver.click('[aria-label="Stage all changes"]')
    driver.script("const input = document.querySelector('[aria-label=\"Commit summary\"]'); input.value = 'Native UI commit'; input.dispatchEvent(new Event('input', { bubbles: true }));")
    driver.wait("return !!document.querySelector('.commit-form button[type=submit]:not(:disabled)')")
    hook = repository / ".git/hooks/pre-commit"
    assert not hook.exists(), "UI refusal fixture must not overwrite an existing hook"
    hook.write_text("#!/bin/sh\nprintf 'Native hook refused the commit\\n' >&2\nexit 1\n")
    hook.chmod(0o700)
    before_ui_commit = head()
    driver.click('.commit-form button[type=submit]')
    driver.wait("return document.querySelector('.error-toast')?.textContent.includes('Native hook refused the commit')")
    assert head() == before_ui_commit
    assert driver.script("return document.querySelector('[aria-label=\"Commit summary\"]').value") == "Native UI commit"
    hook.unlink()
    driver.wait("return !!document.querySelector('.commit-form button[type=submit]:not(:disabled)')")
    # The persistent error must not intercept the user's explicit retry.
    driver.click('.commit-form button[type=submit]')
    deadline = time.monotonic() + 20
    while fixtures.git(repository, "log", "-1", "--format=%s") != "Native UI commit":
        if time.monotonic() > deadline:
            raise TimeoutError("Native UI commit did not reach Git")
        time.sleep(0.1)
    assert not fixtures.git(repository, "status", "--porcelain")
    passed("native-ui-stage-and-commit")
    passed("native-ui-hook-refusal-and-nonblocking-retry")

    ui_commit = head()
    undo = '.toolbar .tool-button[title^="Undo Commit ("]:not(:disabled)'
    redo = '.toolbar .tool-button[title^="Redo Commit ("]:not(:disabled)'
    driver.wait(f"return !!document.querySelector({json.dumps(undo)})", 20)
    driver.click(undo)
    driver.wait(f"return !!document.querySelector({json.dumps(redo)})", 20)
    assert head() == before_ui_commit, "Native UI Undo did not restore the previous HEAD"
    assert (repository / "ui.txt").read_text() == "committed from the native UI\n"
    assert "ui.txt" in fixtures.git(repository, "diff", "--cached", "--name-only").splitlines()
    driver.click(redo)
    driver.wait(f"return !!document.querySelector({json.dumps(undo)})", 20)
    assert head() == ui_commit, "Native UI Redo did not restore the committed HEAD"
    assert not fixtures.git(repository, "status", "--porcelain")
    passed("native-ui-commit-undo-redo")
    raw_working_tree_comparisons(driver, fixtures, report)
    untracked_statistics(driver, fixtures, report)
    untracked_attribute_statistics(driver, fixtures, report)
    indexed_attribute_statistics(driver, fixtures, report)
    selected_stash_boundaries(driver, fixtures, report)
    binary_discard(driver, fixtures, report)
    recovery_boundaries(driver, fixtures, report)
    ignore_workflows(driver, fixtures, report)
    operation_storage_boundaries(driver, fixtures, report)
    file_selection_boundaries(driver, fixtures, report)
    file_workflows(driver, fixtures, report)
    advanced(driver, fixtures, report)


def authentication_prompt_recovery(driver, repo_id, report):
    assert driver.invoke("pending_authentication") == [], "Fixture must not consume a real pending request"
    requests = ["native-fixture-unavailable-secret", "native-fixture-unavailable-user"]
    try:
        for index, request in enumerate(requests):
            driver.invoke("plugin:event|emit", event="git-authentication-prompt", payload={
                "requestId": request, "operationId": f"native-fixture-operation-{index}",
                "repositoryId": repo_id, "secret": index == 0,
            })
        driver.wait("return !!document.querySelector('gc-authentication dialog[open] input[type=password]')")
        driver.script("""
          const input = document.querySelector('gc-authentication input');
          input.value = 'native-fixture-not-a-real-secret';
          input.dispatchEvent(new Event('input', {bubbles: true}));
        """)
        driver.click('gc-authentication button[type=submit]')
        driver.wait("return document.querySelector('gc-authentication [role=alert]')?.textContent.includes('Cancel and retry')")
        assert driver.script("return document.querySelector('gc-authentication input').value") == ""
        driver.click('gc-authentication button[type=button]')
        driver.wait("return !!document.querySelector('gc-authentication dialog[open] input[type=text]')", 10)
        assert driver.script("return document.querySelector('gc-authentication input').value") == ""
        driver.wait("return document.querySelector('.error-toast')?.textContent.includes('could not confirm cancellation')")
        driver.click('gc-authentication button[type=button]')
        driver.wait("return !document.querySelector('gc-authentication dialog[open]')", 10)
        assert driver.invoke("pending_authentication") == []
    finally:
        for request in requests:
            driver.invoke("plugin:event|emit", event="git-authentication-dismissed", payload=request)
    report["scenarios"].append("native-authentication-unavailable-cancel-preserves-prompt-isolation")


def terminal_renderer_startup_failure(driver, fixtures, report):
    before = fixtures.terminal_pids.read_text().splitlines()
    sessions = []
    callback = driver.script("return window.__TAURI_INTERNALS__.transformCallback(event => window.__terminalStartupFailure?.exitIds.push(event.payload.sessionId))")
    listener = driver.invoke("plugin:event|listen", event="terminal-exit", target={"kind": "Any"}, handler=callback)
    driver.script("""
      const originalAppend = Element.prototype.appendChild;
      const state = window.__terminalStartupFailure = {id: null, mountFailed: false, exitIds: []};
      state.restore = () => {
        Element.prototype.appendChild = originalAppend;
      };
      Element.prototype.appendChild = function(node) {
        if (!state.mountFailed && node instanceof Element && node.classList.contains('xterm')) {
          state.mountFailed = true;
          state.id = this.dataset.terminalId;
          Element.prototype.appendChild = originalAppend;
          throw new Error('Native acceptance terminal mount failure');
        }
        return originalAppend.call(this, node);
      };
    """)
    try:
        driver.click('[title^="Open repository terminal"]')
        driver.wait("return document.querySelector('.terminal-error')?.textContent.includes('Native acceptance terminal mount failure')", 10)
        pids = fixtures.terminal_pids.read_text().splitlines()
        added = pids[len(before):]
        # Closing a newly spawned PTY may reap its child before the wrapper
        # executes its PID logger. Require native completion in both cases;
        # every PID that became observable must independently be gone.
        assert len(added) <= 1, "One failed startup unexpectedly created multiple owned shells"
        for pid in added:
            assert not Path(f"/proc/{int(pid)}/stat").exists(), "Renderer startup failure left its owned shell running"
        state = driver.script("return {id: window.__terminalStartupFailure.id, mountFailed: window.__terminalStartupFailure.mountFailed}")
        assert state["mountFailed"] and state["id"]
        sessions.append(state["id"])
        driver.wait("return window.__terminalStartupFailure.exitIds.includes(" + json.dumps(state["id"]) + ")", 10)
        assert driver.script("return window.__terminalStartupFailure.exitIds.filter(id => id === arguments[0]).length", state["id"]) == 1
        try:
            driver.invoke("write_terminal", sessionId=state["id"], data=[])
        except RuntimeError as error:
            assert json.loads(str(error))["kind"] == "unknownTerminal"
        else:
            raise AssertionError("Failed startup remained in the native terminal registry")
        assert driver.script("return document.querySelectorAll('gc-terminal-panel [role=tab]').length") == 0
        driver.click('.terminal-error button')
        driver.wait("return !!document.querySelector('gc-terminal-panel .xterm-screen')", 10)
        sessions.append(driver.script("return document.querySelector('gc-terminal-panel .terminal-host').dataset.terminalId"))
        assert sessions[0] != sessions[1]
        deadline = time.monotonic() + 5
        retry_pids = fixtures.terminal_pids.read_text().splitlines()
        while len(retry_pids) < len(pids) + 1 and time.monotonic() < deadline:
            time.sleep(.02)
            retry_pids = fixtures.terminal_pids.read_text().splitlines()
        assert len(retry_pids) == len(pids) + 1, "The retried owned shell never started"
        retry_pid = int(retry_pids[-1])
        driver.click('.terminal-tab-close')
        driver.wait("return !document.querySelector('gc-terminal-panel')", 10)
        driver.wait("return window.__terminalStartupFailure.exitIds.includes(" + json.dumps(sessions[1]) + ")", 10)
        assert not Path(f"/proc/{retry_pid}/stat").exists(), "Retry cleanup left its observed shell running"
    finally:
        failed_id = driver.script("window.__terminalStartupFailure.restore(); return window.__terminalStartupFailure.id")
        for session in set(sessions + ([failed_id] if failed_id else [])):
            driver.invoke("close_terminal", sessionId=session)
        driver.script("window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('terminal-exit', arguments[0])", listener)
        driver.invoke("plugin:event|unlisten", event="terminal-exit", eventId=listener)
        driver.script("window.__TAURI_INTERNALS__.unregisterCallback(arguments[0])", callback)
    report["scenarios"].append("native-terminal-renderer-startup-failure-reaps-shell-and-retries")


def terminal_lifecycle_events(driver, repository, repo_id, report):
    callbacks = driver.script("""
      window.__terminalLifecycleEvents = [];
      return ['terminal-output', 'terminal-exit'].map(name => ({name,
        callback: window.__TAURI_INTERNALS__.transformCallback(event => {
          window.__terminalLifecycleEvents.push({name, id: event.payload.sessionId,
            text: name === 'terminal-output'
              ? new TextDecoder().decode(new Uint8Array(event.payload.data)) : ''});
        })}));
    """)
    listeners = []
    sessions = []
    try:
        for callback in callbacks:
            listener = driver.invoke("plugin:event|listen", event=callback["name"],
                                     target={"kind": "Any"}, handler=callback["callback"])
            listeners.append((callback, listener))
        for mode in ["natural", "explicit"]:
            terminal = driver.invoke("open_terminal", repoId=repo_id, rows=24, cols=80)
            sessions.append(terminal["id"])
            marker = f"native-final-terminal-output-{mode}"
            # Octal spelling prevents the shell's input echo from satisfying
            # the final-output assertion before the printf has actually run.
            encoded = "".join(f"\\{ord(character):03o}" for character in marker)
            pid_file = repository / f".git/native-terminal-events-{mode}-pid"
            command = (f"stty -echo; trap '' HUP; printf '%s\\n' \"$$\" > .git/{pid_file.name}; "
                       "head -c 131072 /dev/zero | tr '\\000' x; "
                       f"printf '{encoded}\\n'; " + ("exit\n" if mode == "natural" else "\n"))
            driver.invoke("write_terminal", sessionId=terminal["id"], data=list(command.encode()))
            driver.wait("return window.__terminalLifecycleEvents.filter(event => event.id === "
                        + json.dumps(terminal["id"]) + ").map(event => event.text).join('').includes("
                        + json.dumps(marker) + ")", 10)
            if mode == "explicit":
                driver.invoke("close_terminal", sessionId=terminal["id"])
            driver.wait("return window.__terminalLifecycleEvents.some(event => event.name === 'terminal-exit' && event.id === "
                        + json.dumps(terminal["id"]) + ")", 10)
            driver.invoke("close_terminal", sessionId=terminal["id"])
            events = driver.script("return window.__terminalLifecycleEvents.filter(event => event.id === arguments[0])", terminal["id"])
            exits = [index for index, event in enumerate(events) if event["name"] == "terminal-exit"]
            assert len(exits) == 1 and exits[0] == len(events) - 1, events[-3:]
            output = "".join(event["text"] for event in events[:exits[0]])
            assert ("x" * 131072 + marker) in output, "Terminal output was incomplete before exit"
            assert pid_file.read_text().endswith("\n")
            assert not Path(f"/proc/{int(pid_file.read_text())}/stat").exists(), "Exit was announced before reaping"
    finally:
        for session in sessions:
            driver.invoke("close_terminal", sessionId=session)
        for callback, listener in listeners:
            driver.script("window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(arguments[0], arguments[1])",
                          callback["name"], listener)
            driver.invoke("plugin:event|unlisten", event=callback["name"], eventId=listener)
        for callback in callbacks:
            driver.script("window.__TAURI_INTERNALS__.unregisterCallback(arguments[0])", callback["callback"])
    report["scenarios"].append("native-terminal-exit-follows-complete-output-and-reaping-once")


def terminal_input_backpressure(driver, fixtures, repository, repo_id, report):
    blocked = driver.invoke("open_terminal", repoId=repo_id, rows=24, cols=80)
    other = None
    ready = repository / ".git/native-terminal-stopped-pid"
    try:
        driver.invoke("write_terminal", sessionId=blocked["id"], data=list(
            b"stty raw -echo; printf '%s\\n' \"$$\" > .git/native-terminal-stopped-pid; kill -STOP \"$$\"\n"))
        deadline = time.monotonic() + 10
        while not ready.exists() or not ready.read_text().endswith("\n"):
            if time.monotonic() > deadline:
                raise TimeoutError("Owned terminal did not prepare its stopped-input fixture")
            time.sleep(0.05)
        status = Path(f"/proc/{int(ready.read_text())}/status")
        application_pid = next(line.split()[1] for line in status.read_text().splitlines() if line.startswith("PPid:"))
        while not any(line.startswith("State:") and line.split()[1] == "T"
                      for line in status.read_text().splitlines()):
            if time.monotonic() > deadline:
                raise TimeoutError("Owned terminal shell did not stop")
            time.sleep(0.05)
        # Deliberately do not await the write: its real PTY buffer must fill.
        # No production test hook is installed; these are ordinary native calls.
        driver.script("""
          window.__terminalBlockedInput = {status: 'pending'};
          window.__TAURI_INTERNALS__.invoke('write_terminal', {
            sessionId: arguments[0], data: Array.from(new Uint8Array(262144).fill(65))
          }).then(() => { window.__terminalBlockedInput = {status: 'complete'}; },
            error => { window.__terminalBlockedInput = {status: 'failed', error}; });
        """, blocked["id"])
        other = driver.invoke("open_terminal", repoId=repo_id, rows=24, cols=80)
        driver.invoke("resize_terminal", sessionId=other["id"], rows=30, cols=100)
        driver.invoke("write_terminal", sessionId=other["id"], data=list(
            b"printf ready > .git/native-terminal-other-ready\n"))
        deadline = time.monotonic() + 10
        while not (repository / ".git/native-terminal-other-ready").exists():
            if time.monotonic() > deadline:
                raise TimeoutError("Another terminal stopped responding during blocked input")
            time.sleep(0.05)
        assert driver.script("return window.__terminalBlockedInput.status") == "pending"
        start = time.monotonic()
        driver.invoke("close_terminal", sessionId=blocked["id"])
        assert time.monotonic() - start < 3, "Closing a terminal blocked behind its pending input"
        try:
            driver.wait("return window.__terminalBlockedInput.status !== 'pending'", 10)
        except TimeoutError:
            tasks = Path(f"/proc/{application_pid}/task")
            report["terminalBackpressureDiagnostics"] = {
                "ownedShellStillPresent": status.exists(),
                "threads": [{"name": (task / "comm").read_text().strip(),
                             "wait": (task / "wchan").read_text().strip()}
                            for task in tasks.iterdir() if (task / "wchan").exists()],
            }
            raise
        result = driver.script("return window.__terminalBlockedInput")
        assert result["status"] == "failed" and result["error"]["kind"] == "terminalFailure", result
        assert not status.exists(), "Closing the blocked input terminal did not reap its owned shell"
    finally:
        driver.invoke("close_terminal", sessionId=blocked["id"])
        if other is not None:
            driver.invoke("close_terminal", sessionId=other["id"])
    report["scenarios"].append("native-terminal-blocked-input-keeps-controls-and-other-sessions-responsive")


def selected_stash_boundaries(driver, fixtures, report):
    for mode in ["all", "staged-only"]:
        repository = fixtures.repository(f"selected-rename-{mode}", 1)
        suffix = "\nfile" if mode == "staged-only" else ".txt"
        old, new = f"old*[a]{suffix}", f"new*[a]{suffix}"
        (repository / old).write_bytes(b"selected original\n")
        fixtures.git(repository, "add", "--all")
        fixtures.git(repository, "commit", "-qm", "Selected rename base")
        base = fixtures.git(repository, "rev-parse", "HEAD")
        fixtures.git(repository, "--literal-pathspecs", "mv", "--", old, new)
        (repository / "fixture.txt").write_bytes(b"neighbour staged\n")
        fixtures.git(repository, "add", "fixture.txt")
        (repository / "fixture.txt").write_bytes(b"neighbour working\n")
        repo_id = driver.invoke("open_repository", path=str(repository))["id"]
        driver.invoke("stash_selected", repoId=repo_id, options=dict(
            mode=mode, includeUntracked=False, paths=[new], message="Selected native rename"))
        assert (repository / old).read_bytes() == b"selected original\n"
        assert not (repository / new).exists()
        assert fixtures.git(repository, "show", ":fixture.txt") == "neighbour staged"
        assert (repository / "fixture.txt").read_bytes() == b"neighbour working\n"
        oid = fixtures.git(repository, "rev-parse", "refs/stash")
        driver.invoke("apply_stash_options", repoId=repo_id, reference="stash@{0}",
                      expectedOid=oid, restoreIndex=False)
        assert not (repository / old).exists()
        assert (repository / new).read_bytes() == b"selected original\n"
        assert fixtures.git(repository, "show", ":fixture.txt") == "neighbour staged"
        assert (repository / "fixture.txt").read_bytes() == b"neighbour working\n"
        assert fixtures.git(repository, "rev-parse", "HEAD") == base
    report["scenarios"].append("native-selected-rename-stash-both-names-and-literal-paths")

    for ignored in [False, True]:
        repository = fixtures.repository(f"selected-rename-reused-{ignored}", 1)
        (repository / "old").write_bytes(b"original\n")
        fixtures.git(repository, "add", "old")
        fixtures.git(repository, "commit", "-qm", "Old path base")
        if ignored:
            (repository / ".git/info/exclude").write_text("/old\n")
        fixtures.git(repository, "mv", "old", "new")
        (repository / "old").write_bytes(b"unselected precious contents\n")
        repo_id = driver.invoke("open_repository", path=str(repository))["id"]
        index = (repository / ".git/index").read_bytes()
        base = fixtures.git(repository, "rev-parse", "HEAD")
        for include_untracked in [False, True]:
            try:
                driver.invoke("stash_selected", repoId=repo_id, options=dict(
                    mode="all", includeUntracked=include_untracked, paths=["new"], message="Guard reuse"))
            except RuntimeError as error:
                assert "overlappingStashSelection" in str(error), str(error)
            else:
                raise AssertionError("Selected rename overwrote an unselected reused old path")
            assert (repository / ".git/index").read_bytes() == index
            assert (repository / "old").read_bytes() == b"unselected precious contents\n"
            assert (repository / "new").read_bytes() == b"original\n"
            assert not fixtures.git(repository, "stash", "list")
            assert fixtures.git(repository, "rev-parse", "HEAD") == base
    report["scenarios"].append("native-selected-rename-refuses-visible-and-ignored-old-path-reuse")

    repository = fixtures.repository("selected-rename-keep-index", 1)
    (repository / "old").write_bytes(b"one\ntwo\n")
    fixtures.git(repository, "add", "old")
    fixtures.git(repository, "commit", "-qm", "Keep index base")
    fixtures.git(repository, "mv", "old", "new")
    (repository / "new").write_bytes(b"one\nchanged\n")
    index = fixtures.git(repository, "ls-files", "--stage", "-z")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    driver.invoke("stash_selected", repoId=repo_id, options=dict(
        mode="keep-index", includeUntracked=False, paths=["new"], message="Native keep index"))
    assert not (repository / "old").exists()
    assert (repository / "new").read_bytes() == b"one\ntwo\n"
    assert fixtures.git(repository, "ls-files", "--stage", "-z") == index
    oid = fixtures.git(repository, "rev-parse", "refs/stash")
    assert fixtures.git(repository, "show", f"{oid}:new") == "one\nchanged"
    assert fixtures.git(repository, "show", f"{oid}^2:new") == "one\ntwo"
    fixtures.git(repository, "restore", "--source=HEAD", "--staged", "--worktree", ".")
    driver.invoke("apply_stash_options", repoId=repo_id, reference="stash@{0}",
                  expectedOid=oid, restoreIndex=True)
    assert not (repository / "old").exists()
    assert (repository / "new").read_bytes() == b"one\nchanged\n"
    assert fixtures.git(repository, "ls-files", "--stage", "-z") == index
    report["scenarios"].append("native-selected-rename-keep-index-capture-and-base-restoration")

    for configured in ["true", "false"]:
        for restore_index in [False, True]:
            repository = fixtures.repository(f"stash-index-{configured}-{restore_index}", 1)
            baseline = (repository / "fixture.txt").read_bytes()
            (repository / "fixture.txt").write_bytes(b"staged\n")
            fixtures.git(repository, "add", "fixture.txt")
            (repository / "fixture.txt").write_bytes(b"working\n")
            repo_id = driver.invoke("open_repository", path=str(repository))["id"]
            driver.invoke("stash_selected", repoId=repo_id, options=dict(
                mode="all", includeUntracked=False, paths=None, message="Native index option"))
            fixtures.git(repository, "config", "stash.index", configured)
            oid = fixtures.git(repository, "rev-parse", "refs/stash")
            driver.invoke("apply_stash_options", repoId=repo_id, reference="stash@{0}",
                          expectedOid=oid, restoreIndex=restore_index)
            assert fixtures.git(repository, "show", ":fixture.txt") == (
                "staged" if restore_index else baseline.decode().strip())
            assert (repository / "fixture.txt").read_bytes() == b"working\n"
    report["scenarios"].append("native-explicit-stash-index-option-overrides-repository-default")

    repository = fixtures.repository("selected-stash-raw-neighbour", 1)
    (repository / "fixture.txt").write_bytes(b"selected changes\n")
    other = repository / b"unselected-\xff".decode("utf-8", "surrogateescape")
    other.write_bytes(b"unselected precious contents\n")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    driver.invoke("stash_selected", repoId=repo_id, options=dict(
        mode="all", includeUntracked=True, paths=["fixture.txt"], message="Keep raw neighbour"))
    assert other.read_bytes() == b"unselected precious contents\n"
    assert "selected changes" not in (repository / "fixture.txt").read_text()
    report["scenarios"].append("native-selected-stash-preserves-non-utf8-untracked-neighbours")


def raw_working_tree_comparisons(driver, fixtures, report):
    repository = fixtures.repository("raw-working-tree-comparisons", 1)
    (repository / ".gitattributes").write_text("*.owned diff=owned\n")
    fixtures.git(repository, "add", ".gitattributes")
    fixtures.git(repository, "commit", "-qm", "Raw comparison attributes")
    base = fixtures.git(repository, "rev-parse", "HEAD")
    converter = repository / ".git/owned-comparison-converter"
    converter.write_text("#!/bin/sh\nprintf called > .git/comparison-converter-called\nprintf 'converted output\\n'\n")
    converter.chmod(0o700)
    fixtures.git(repository, "config", "diff.owned.textconv", str(converter))
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    file = repository / "preview.owned"
    marker = repository / ".git/comparison-converter-called"
    for tracked in [False, True]:
        if tracked:
            file.write_bytes(b"base\n")
            fixtures.git(repository, "add", "--", file.name)
            fixtures.git(repository, "commit", "-qm", "Track raw comparison payload")
            base = fixtures.git(repository, "rev-parse", "HEAD")
        for payload in [b"raw comparison contents\n", bytes([0, 255, 13, 10, 0, 5])]:
            file.write_bytes(payload)
            index = (repository / ".git/index").read_bytes()
            result = driver.invoke("compare_commit_file_with_working_tree", repoId=repo_id,
                                   baseOid=base, path=file.name, previousPath=None)
            assert not marker.exists(), f"Comparison executed a text converter for tracked={tracked}"
            assert not result["truncated"] and "converted output" not in result["patch"]
            assert ("Binary files" if b"\0" in payload else "raw comparison contents") in result["patch"]
            assert file.read_bytes() == payload and (repository / ".git/index").read_bytes() == index
    report["scenarios"].append("native-raw-tracked-and-untracked-comparisons-without-textconv")

    tracked_file = repository / "large-tracked.txt"
    tracked_file.write_bytes(b"base\n")
    fixtures.git(repository, "add", "--", tracked_file.name)
    fixtures.git(repository, "commit", "-qm", "Track bounded comparison payload")
    base = fixtures.git(repository, "rev-parse", "HEAD")
    large = b"large comparison contents\n" * 100_000
    for target in [tracked_file, repository / "large-untracked.txt"]:
        target.write_bytes(large)
        result = driver.invoke("compare_commit_file_with_working_tree", repoId=repo_id,
                               baseOid=base, path=target.name, previousPath=None)
        assert result["truncated"] and len(result["patch"].encode()) == 256_000
        assert result["patch"].startswith("diff --git ") and target.read_bytes() == large
    assert not marker.exists()
    report["scenarios"].append("native-large-tracked-and-untracked-comparison-previews")


def untracked_statistics(driver, fixtures, report):
    repository = fixtures.repository("untracked-statistics", 1)
    outside = fixtures.repository("untracked-statistics-outside", 1)
    text = outside / "text-target"
    text.write_bytes(b"external first\nexternal second\nexternal third\n")
    binary = outside / "binary-target"
    binary.write_bytes(bytes([0, 1, 255]))
    directory = outside / "directory-target"
    directory.mkdir()
    targets = {
        "text-link": text,
        "binary-link": binary,
        "directory-link": directory,
        "missing-link": outside / "missing-target",
        "newline-link": outside / "missing\nsecond-line",
    }
    for name, target in targets.items():
        (repository / name).symlink_to(target, target_is_directory=(target == directory))
    payloads = {
        "non-utf8.txt": b"first\xff\nsecond\xfe",
        "empty.txt": b"",
        "crlf.txt": b"one\r\ntwo\r\n",
        "binary.dat": bytes([0, 1, 255]),
        "large.txt": b"line\n" * 100_000,
    }
    for offset in [0, 7999, 8000, 8191, 8192, 16000]:
        payload = bytearray(b"x" * 20000)
        payload[offset] = 0
        payload[19000] = 10
        payloads[f"nul-at-{offset}.txt"] = bytes(payload)
    for name, payload in payloads.items():
        (repository / name).write_bytes(payload)
    base = fixtures.git(repository, "rev-parse", "HEAD")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    index = (repository / ".git/index").read_bytes()
    result = driver.invoke("compare_commit_with_working_tree", repoId=repo_id, baseOid=base)
    entries = {entry["path"]: entry for entry in result["files"]}
    for name, target in targets.items():
        entry = entries[name]
        assert (entry["additions"], entry["deletions"]) == (str(target).count("\n") + 1, 0), entry
        assert (repository / name).is_symlink()
    assert text.read_bytes() == b"external first\nexternal second\nexternal third\n"
    assert binary.read_bytes() == bytes([0, 1, 255])
    assert directory.is_dir() and not (outside / "missing-target").exists()
    report["scenarios"].append("native-untracked-link-statistics-use-link-bytes-not-target-contents")

    for name, expected in {
        "non-utf8.txt": (2, 0), "empty.txt": (0, 0), "crlf.txt": (2, 0),
        "binary.dat": (None, None), "large.txt": (100_000, 0),
    }.items():
        entry = entries[name]
        assert (entry["additions"], entry["deletions"]) == expected, entry
        assert (repository / name).read_bytes() == payloads[name]
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == base
    report["scenarios"].append("native-untracked-byte-counts-for-non-utf8-empty-crlf-binary-and-large-files")
    for offset in [0, 7999, 8000, 8191, 8192, 16000]:
        name = f"nul-at-{offset}.txt"
        entry = entries[name]
        expected = (None, None) if offset < 8000 else (2, 0)
        assert (entry["additions"], entry["deletions"]) == expected, entry
        assert (repository / name).read_bytes() == payloads[name]
    report["scenarios"].append("native-untracked-binary-prefix-boundary")


def untracked_attribute_statistics(driver, fixtures, report):
    repository = fixtures.repository("untracked-attribute-statistics", 1)
    (repository / ".gitattributes").write_text(
        "forced.binary -diff\nmacro.binary binary\nforced.text diff\n"
        "driver.text diff=ownedtext\ndriver.binary diff=ownedbinary\n"
        "driver.auto diff=ownedauto\n*.owned -diff\n"
        "binary.link -diff\ntext.link diff\nauto.link !diff\nsmall.link -diff\n"
    )
    nested = repository / "nested"
    nested.mkdir()
    (nested / ".gitattributes").write_text("*.owned diff\n")
    fixtures.git(repository, "add", ".gitattributes", "nested/.gitattributes")
    fixtures.git(repository, "commit", "-qm", "Owned diff attributes")
    (repository / ".git/info/attributes").write_text("info.owned diff\n")
    fixtures.git(repository, "config", "core.bigFileThreshold", "32")
    for driver_name, value in [("ownedtext", "false"), ("ownedbinary", "true"), ("ownedauto", "auto")]:
        fixtures.git(repository, "config", f"diff.{driver_name}.binary", value)
    converter = repository / ".git/owned-statistics-converter"
    converter.write_text("#!/bin/sh\nprintf called > .git/statistics-converter-called\nprintf 'converted\\n'\n")
    converter.chmod(0o700)
    for name in ["ownedtext", "ownedbinary", "ownedauto"]:
        fixtures.git(repository, "config", f"diff.{name}.textconv", str(converter))
    payloads = {
        "forced.binary": b"one\ntwo\n", "macro.binary": b"one\ntwo\n",
        "forced.text": b"one\0\ntwo\n", "driver.text": b"one\0\ntwo\n",
        "driver.binary": b"one\ntwo\n", "driver.auto": b"one\0\ntwo\n",
        "below.txt": b"x" * 31, "boundary.txt": b"x" * 32, "above.txt": b"x" * 33,
        "info.owned": b"one\0\ntwo\n",
    }
    expected = {
        "forced.binary": (None, None), "macro.binary": (None, None),
        "forced.text": (2, 0), "driver.text": (2, 0), "driver.binary": (None, None),
        "driver.auto": (None, None), "below.txt": (1, 0), "boundary.txt": (1, 0),
        "above.txt": (None, None), "info.owned": (2, 0),
    }
    for index in range(260):
        name = f"nested/{index:03}-{'x' * 64}.owned"
        payloads[name] = b"one\0\ntwo\n"
        expected[name] = (2, 0)
    for name, payload in payloads.items():
        (repository / name).write_bytes(payload)
    for name in ["binary.link", "text.link", "auto.link"]:
        (repository / name).symlink_to("missing\nsecond-line-" + "x" * 64)
        expected[name] = (None, None)
    (repository / "small.link").symlink_to("missing\nsecond")
    expected["small.link"] = (2, 0)
    base = fixtures.git(repository, "rev-parse", "HEAD")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    index = (repository / ".git/index").read_bytes()
    result = driver.invoke("compare_commit_with_working_tree", repoId=repo_id, baseOid=base)
    entries = {entry["path"]: entry for entry in result["files"]}
    assert entries.keys() == expected.keys()
    for name, counts in expected.items():
        entry = entries[name]
        assert (entry["additions"], entry["deletions"]) == counts, entry
        if name in payloads:
            assert (repository / name).read_bytes() == payloads[name]
        else:
            assert (repository / name).is_symlink()
            target = "missing\nsecond" if name == "small.link" else "missing\nsecond-line-" + "x" * 64
            assert str((repository / name).readlink()) == target
    assert not (repository / ".git/statistics-converter-called").exists()
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == base
    report["scenarios"].append("native-untracked-statistics-respect-diff-attributes-without-converters")
    report["scenarios"].append("native-untracked-statistics-respect-large-file-threshold")
    report["scenarios"].append("native-untracked-statistics-inherited-attributes-across-wide-path-set")

    repository = fixtures.root / "untracked-statistics-sha256"
    repository.mkdir()
    fixtures.git(repository, "init", "--object-format=sha256", "-b", "main")
    (repository / "seed").write_text("seed\n")
    (repository / ".gitattributes").write_text("*.binary -diff\n")
    fixtures.git(repository, "add", "--all")
    fixtures.git(repository, "commit", "-qm", "SHA-256 baseline")
    base = fixtures.git(repository, "rev-parse", "HEAD")
    assert len(base) == 64
    (repository / "text.txt").write_bytes(b"one\ntwo\n")
    (repository / "forced.binary").write_bytes(b"one\ntwo\n")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    index = (repository / ".git/index").read_bytes()
    result = driver.invoke("compare_commit_with_working_tree", repoId=repo_id, baseOid=base)
    entries = {entry["path"]: entry for entry in result["files"]}
    assert set(entries) == {"text.txt", "forced.binary"}
    assert entries["text.txt"]["additions"] == 2 and entries["text.txt"]["deletions"] == 0
    assert entries["forced.binary"]["additions"] is None and entries["forced.binary"]["deletions"] is None
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == base
    assert (repository / "text.txt").read_bytes() == b"one\ntwo\n"
    assert (repository / "forced.binary").read_bytes() == b"one\ntwo\n"
    report["scenarios"].append("native-untracked-statistics-sha256-repository")


def indexed_attribute_statistics(driver, fixtures, report):
    repository = fixtures.repository("executable-attribute-statistics", 1)
    attributes = repository / ".gitattributes"
    attributes.write_text("*.owned -diff\n")
    fixtures.git(repository, "add", "--chmod=+x", ".gitattributes")
    fixtures.git(repository, "commit", "-qm", "Executable attribute rules")
    attributes.unlink()
    (repository / "selected.owned").write_bytes(b"one\ntwo\n")
    base = fixtures.git(repository, "rev-parse", "HEAD")
    assert fixtures.git(repository, "ls-files", "--stage", ".gitattributes").startswith("100755 ")
    index = (repository / ".git/index").read_bytes()
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    result = driver.invoke("compare_commit_with_working_tree", repoId=repo_id, baseOid=base)
    entry = next(entry for entry in result["files"] if entry["path"] == "selected.owned")
    assert (entry["additions"], entry["deletions"]) == (None, None), entry
    assert (repository / ".git/index").read_bytes() == index
    assert not attributes.exists()
    assert (repository / "selected.owned").read_bytes() == b"one\ntwo\n"
    report["scenarios"].append("native-untracked-statistics-index-only-executable-attributes")

    repository = fixtures.repository("sparse-index-attribute-statistics", 1)
    (repository / "included").mkdir()
    (repository / "excluded").mkdir()
    (repository / "included/seed").write_text("included\n")
    (repository / "excluded/seed").write_text("excluded\n")
    (repository / "excluded/.gitattributes").write_text("*.owned -diff\n")
    fixtures.git(repository, "add", "--all")
    fixtures.git(repository, "commit", "-qm", "Sparse attribute rules")
    base = fixtures.git(repository, "rev-parse", "HEAD")
    fixtures.git(repository, "sparse-checkout", "set", "--cone", "--sparse-index", "included")
    assert "040000 " in fixtures.git(repository, "ls-files", "--sparse", "--stage")
    index = (repository / ".git/index").read_bytes()
    (repository / "excluded").mkdir()
    (repository / "excluded/selected.owned").write_bytes(b"one\ntwo\n")
    alternate = repository / ".git/owned-native-statistics-index"
    alternate.write_bytes(index)
    environment = dict(fixtures.env, GIT_INDEX_FILE=str(alternate))
    run("git", "-C", str(repository), "add", "--sparse", "--", "excluded/selected.owned", env=environment)
    oracle = run("git", "-C", str(repository), "diff", "--cached", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--", "excluded/selected.owned", env=environment)
    assert oracle.startswith("-\t-\t"), oracle
    alternate.unlink()
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    result = driver.invoke("compare_commit_with_working_tree", repoId=repo_id, baseOid=base)
    entry = next(entry for entry in result["files"] if entry["path"] == "excluded/selected.owned")
    assert (entry["additions"], entry["deletions"]) == (None, None), entry
    assert (repository / ".git/index").read_bytes() == index
    assert not (repository / "excluded/.gitattributes").exists()
    assert not (repository / "excluded/seed").exists()
    assert (repository / "excluded/selected.owned").read_bytes() == b"one\ntwo\n"
    assert fixtures.git(repository, "rev-parse", "HEAD") == base
    report["scenarios"].append("native-untracked-statistics-sparse-index-attributes-without-hydration")


def binary_discard(driver, fixtures, report):
    repository = fixtures.repository("raw-binary-recovery", 1)
    (repository / ".gitattributes").write_text("*.owned diff=owned\n")
    fixtures.git(repository, "add", ".gitattributes")
    fixtures.git(repository, "commit", "-qm", "Owned attributes")
    converter = repository / ".git/owned-textconv"
    converter.write_text("#!/bin/sh\nprintf called > .git/textconv-called\nprintf 'converted contents\\n'\n")
    converter.chmod(0o700)
    fixtures.git(repository, "config", "diff.owned.textconv", str(converter))
    payload = repository / "raw.owned"
    original = bytes([0, 255, 13, 10, 0, 5])
    payload.write_bytes(original)
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    preview = driver.invoke("preview_discard", repoId=repo_id, paths=[payload.name])
    marker = repository / ".git/textconv-called"
    assert not marker.exists(), "Recovery preview executed an external text converter"
    result = driver.invoke("discard_changes", repoId=repo_id, token=preview["token"])
    assert not payload.exists()
    assert not marker.exists()
    driver.invoke("apply_saved_discard", repoId=repo_id, id=result["id"], reverse=False)
    assert payload.read_bytes() == original
    assert not marker.exists()
    assert not fixtures.git(repository, "diff", "--cached", "--name-only")
    report["scenarios"].append("native-raw-binary-discard-recovery-with-textconv-config")


def recovery_boundaries(driver, fixtures, report):
    repository = fixtures.repository("recovery-boundaries", 1)
    outside = fixtures.repository("recovery-boundaries-outside", 1)
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]

    def call(command, **args):
        return driver.invoke(command, repoId=repo_id, **args)

    def refused(command, **args):
        try:
            call(command, **args)
        except RuntimeError as error:
            assert "invalidRecoveryPath" in str(error), str(error)
        else:
            raise AssertionError(f"{command} accepted redirected recovery storage")

    file = repository / "fixture.txt"
    base = file.read_bytes()
    edited = b"preserve recovery-boundary edit\n"
    file.write_bytes(edited)
    directory = repository / ".git/git-khronos-recovery"
    external = outside / "protected"
    external.mkdir(mode=0o755)
    external.chmod(0o755)
    sentinel = external / "123.patch"
    sentinel.write_bytes(b"outside sentinel\n")
    directory.symlink_to(external, target_is_directory=True)
    preview = call("preview_discard", paths=[file.name])
    refused("discard_changes", token=preview["token"])
    refused("load_discard_recoveries")
    refused("forget_saved_discard", id="123")
    assert file.read_bytes() == edited
    assert sentinel.read_bytes() == b"outside sentinel\n"
    assert list(external.iterdir()) == [sentinel]
    assert external.stat().st_mode & 0o777 == 0o755
    directory.unlink()
    report["scenarios"].append("native-recovery-refuses-linked-directory-without-external-writes")

    preview = call("preview_discard", paths=[file.name])
    saved = call("discard_changes", token=preview["token"])["id"]
    assert file.read_bytes() == base
    capture = directory / f"{saved}.patch"
    patch = capture.read_bytes()
    relocated = outside / "relocated.patch"
    capture.rename(relocated)
    capture.symlink_to(relocated)
    refused("apply_saved_discard", id=saved, reverse=False)
    refused("load_discard_recoveries")
    refused("forget_saved_discard", id=saved)
    assert file.read_bytes() == base
    assert relocated.read_bytes() == patch and capture.is_symlink()
    capture.unlink()
    relocated.rename(capture)
    report["scenarios"].append("native-recovery-refuses-linked-capture")

    marker = capture.with_suffix(".restored")
    for existing in [False, True]:
        target = outside / ("existing-marker" if existing else "missing-marker")
        if existing:
            target.write_bytes(b"keep external bytes\n")
        marker.symlink_to(target)
        refused("apply_saved_discard", id=saved, reverse=False)
        refused("load_discard_recoveries")
        refused("forget_saved_discard", id=saved)
        assert file.read_bytes() == base and capture.read_bytes() == patch
        assert marker.is_symlink()
        if existing:
            assert target.read_bytes() == b"keep external bytes\n"
        else:
            assert not target.exists()
        marker.unlink()
    call("apply_saved_discard", id=saved, reverse=False)
    assert file.read_bytes() == edited
    assert marker.stat().st_mode & 0o777 == 0o600
    call("apply_saved_discard", id=saved, reverse=True)
    assert file.read_bytes() == base
    call("forget_saved_discard", id=saved)
    assert not call("load_discard_recoveries")
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-recovery-refuses-linked-markers-and-allows-repaired-retry")


def ignore_workflows(driver, fixtures, report):
    repository = fixtures.repository("ignore-workflows", 1)
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]

    def ignore(file, stop=False):
        return driver.invoke("ignore_path", repoId=repo_id, path=file,
                             patternKind="file", stopTracking=stop)

    def refused(file, stop=False):
        try:
            ignore(file, stop)
        except RuntimeError:
            return
        raise AssertionError("Ignore unexpectedly accepted invalid storage or untracking")

    rules = repository / ".gitignore"
    secret = repository / "secret.log"
    secret.write_bytes(b"keep secret bytes\n")
    original = b"# original rules\r\n/old-\xff.log\r\n"
    rules.write_bytes(original)
    ignore(secret.name)
    assert rules.read_bytes() == original + b"/secret.log\n"
    assert secret.read_bytes() == b"keep secret bytes\n"
    report["scenarios"].append("native-ignore-preserves-non-utf8-rules")

    candidate = repository / "candidate.tmp"
    candidate.write_bytes(b"candidate\n")
    rules.unlink()
    for existing in [False, True]:
        target = repository / ".git" / ("existing-ignore-target" if existing else "missing-ignore-target")
        if existing:
            target.write_bytes(b"external rules\n")
        rules.symlink_to(target)
        refused(candidate.name)
        assert rules.is_symlink()
        if existing:
            assert target.read_bytes() == b"external rules\n"
        else:
            assert not target.exists()
        assert not (repository / ".gitignore.lock").exists()
        rules.unlink()
    report["scenarios"].append("native-ignore-refuses-linked-rules")

    rules.write_bytes(b"# retain\n")
    lock = repository / ".gitignore.lock"
    lock.write_bytes(b"other writer\n")
    refused(candidate.name)
    assert rules.read_bytes() == b"# retain\n" and lock.read_bytes() == b"other writer\n"
    lock.unlink()
    ignore(candidate.name)
    assert rules.read_bytes() == b"# retain\n/candidate.tmp\n"
    assert not lock.exists()
    report["scenarios"].append("native-ignore-lock-refusal-and-retry")

    literal = repository / "*.log"
    unrelated = repository / "a.log"
    literal.write_bytes(b"selected\n")
    unrelated.write_bytes(b"unrelated\n")
    fixtures.git(repository, "--literal-pathspecs", "add", "--", literal.name, unrelated.name)
    fixtures.git(repository, "commit", "-qm", "Literal filename fixture")
    literal.write_bytes(b"selected edit\n")
    ignore(literal.name, True)
    tracked = fixtures.git(repository, "ls-files").splitlines()
    assert literal.name not in tracked and unrelated.name in tracked
    assert literal.read_bytes() == b"selected edit\n" and unrelated.read_bytes() == b"unrelated\n"
    fixtures.git(repository, "commit", "-qm", "Untrack only the literal filename")
    report["scenarios"].append("native-ignore-untracks-only-literal-filename")

    unrelated.write_bytes(b"staged contents\n")
    fixtures.git(repository, "add", "--", unrelated.name)
    unrelated.write_bytes(b"working contents\n")
    original = rules.read_bytes()
    index = (repository / ".git/index").read_bytes()
    refused(unrelated.name, True)
    assert rules.read_bytes() == original and (repository / ".git/index").read_bytes() == index
    assert unrelated.read_bytes() == b"working contents\n"
    assert not lock.exists()
    report["scenarios"].append("native-ignore-preflights-untracking-before-changing-rules")


def operation_storage_boundaries(driver, fixtures, report):
    outside = fixtures.repository("operation-storage-outside", 1)
    repository = fixtures.repository("rebase-storage-boundaries", 3)
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]

    def call(command, **args):
        return driver.invoke(command, repoId=repo_id, **args)

    def refused(command, **args):
        try:
            call(command, **args)
        except RuntimeError as error:
            assert "invalidOperationStorage" in str(error), str(error)
            return
        raise AssertionError(f"{command} accepted redirected operation storage")

    tip = fixtures.git(repository, "rev-parse", "HEAD")

    def pause():
        plan = call("prepare_interactive_rebase", source="main", target="main", selectionOids=[tip], root=False)
        assert len(plan["commits"]) == 1
        call("execute_interactive_rebase", source="main", target="main",
             steps=[dict(oid=entry["oid"], action="edit", message=None) for entry in plan["commits"]],
             selectionOids=[tip], root=False, ontoOid=None)
        assert call("refresh_repository_status")["rebaseEditStopped"]

    pause()
    support = repository / ".git/git-khronos-rebase"
    parked = repository / ".git/parked-support"
    support.rename(parked)
    protected = outside / "protected"
    protected.mkdir()
    sentinel = protected / "sentinel"
    sentinel.write_bytes(b"retain external operation data\n")
    support.symlink_to(protected, target_is_directory=True)
    call("abort_rebase")
    assert sentinel.read_bytes() == b"retain external operation data\n", "Rebase Abort deleted redirected external support data"
    assert list(protected.iterdir()) == [sentinel] and support.is_symlink()
    assert fixtures.git(repository, "rev-parse", "HEAD") == tip
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-rebase-abort-preserves-linked-support-target")

    references = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)")
    index = (repository / ".git/index").read_bytes()
    refused("execute_interactive_rebase", source="main", target="main",
            steps=[dict(oid=tip, action="edit", message=None)],
            selectionOids=[tip], root=False, ontoOid=None)
    assert sentinel.read_bytes() == b"retain external operation data\n"
    assert fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)") == references
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == tip
    report["scenarios"].append("native-rebase-start-refuses-linked-support-before-mutation")

    support.unlink()
    parked.rename(support)
    pause()
    stopped = fixtures.git(repository, "rev-parse", "HEAD")
    call("begin_rebase_split", expectedHead=stopped)
    split_storage = outside / "protected-split"
    support.rename(split_storage)
    support.symlink_to(split_storage, target_is_directory=True)
    split = (split_storage / "split.json").read_bytes()
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    refused("refresh_repository_status")
    refused("begin_rebase_split", expectedHead=head)
    refused("continue_rebase")
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    assert (split_storage / "split.json").read_bytes() == split
    call("abort_rebase")
    assert fixtures.git(repository, "rev-parse", "HEAD") == tip
    assert (split_storage / "split.json").read_bytes() == split and support.is_symlink()
    report["scenarios"].append("native-split-refuses-linked-ancestor-and-keeps-abort-available")

    repository = fixtures.repository("replay-storage-boundaries", 1)
    file = repository / "fixture.txt"
    fixtures.git(repository, "checkout", "-qb", "source")
    file.write_bytes(b"source replay\n")
    fixtures.git(repository, "commit", "-qam", "Replay source")
    source = fixtures.git(repository, "rev-parse", "HEAD")
    fixtures.git(repository, "checkout", "-q", "main")
    file.write_bytes(b"destination replay\n")
    fixtures.git(repository, "commit", "-qam", "Replay destination")
    head = fixtures.git(repository, "rev-parse", "HEAD")
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]
    try:
        call("cherry_pick_commits", oids=[source], mainline=None, noCommit=True)
    except RuntimeError:
        pass
    assert fixtures.git(repository, "diff", "--name-only", "--diff-filter=U") == file.name
    assert call("refresh_repository_status")["historyNoCommit"]
    journal = repository / ".git/git-khronos-no-commit.json"
    external = outside / "protected-journal.json"
    journal.rename(external)
    journal.symlink_to(external)
    data = external.read_bytes()
    index = (repository / ".git/index").read_bytes()
    working = file.read_bytes()
    for action in ["quit", "continue", "abort"]:
        refused("control_history_operation", operation="cherry-pick", action=action)
        assert external.read_bytes() == data and journal.is_symlink()
        assert (repository / ".git/index").read_bytes() == index and file.read_bytes() == working
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
    refused("refresh_repository_status")
    journal.unlink()
    external.rename(journal)
    call("control_history_operation", operation="cherry-pick", action="abort")
    assert file.read_bytes() == b"destination replay\n" and not journal.exists()
    assert not call("refresh_repository_status")["historyNoCommit"]
    report["scenarios"].append("native-replay-refuses-linked-journal-controls-and-allows-repaired-abort")

    target = outside / "missing-journal.json"
    journal.symlink_to(target)
    references = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)", "refs/git-khronos/recovery/")
    index = (repository / ".git/index").read_bytes()
    refused("cherry_pick_commits", oids=[source], mainline=None, noCommit=True)
    assert not target.exists() and not target.with_suffix(".json.lock").exists()
    assert file.read_bytes() == b"destination replay\n"
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)", "refs/git-khronos/recovery/") == references
    journal.unlink()
    assert not call("refresh_repository_status")["historyNoCommit"]
    report["scenarios"].append("native-replay-refuses-dangling-journal-before-any-replay")


def file_selection_boundaries(driver, fixtures, report):
    for label, selected, other in [
        ("star", "*.txt", "other.txt"),
        ("brackets", "[ab].txt", "a.txt"),
        ("magic", ":(glob)*.txt", "other.txt"),
    ]:
        repository = fixtures.repository(f"literal-selection-{label}", 1)
        file = repository / selected
        neighbour = repository / other
        file.write_bytes(b"selected old\n")
        neighbour.write_bytes(b"unrelated old\n")
        fixtures.git(repository, "add", "--all")
        fixtures.git(repository, "commit", "-qm", "Base selected files")
        base = fixtures.git(repository, "rev-parse", "HEAD")
        file.write_bytes(b"selected current\n")
        neighbour.write_bytes(b"unrelated current\n")
        fixtures.git(repository, "commit", "-qam", "Selected change")
        changed = fixtures.git(repository, "rev-parse", "HEAD")
        neighbour.write_bytes(b"unrelated newer\n")
        fixtures.git(repository, "commit", "-qam", "Neighbour only")
        tip = fixtures.git(repository, "rev-parse", "HEAD")
        neighbour.write_bytes(b"unrelated dirty bytes\n")
        repo_id = driver.invoke("open_repository", path=str(repository))["id"]

        def call(command, **args):
            return driver.invoke(command, repoId=repo_id, **args)

        def selected_patch(result, marker="selected current"):
            patch = result["patch"]
            assert patch.count("diff --git ") == 1 and marker in patch, patch
            assert "unrelated" not in patch and not result["truncated"], patch

        index = fixtures.git(repository, "--literal-pathspecs", "ls-files", "--stage", "--", other)
        call("restore_files_from_commit", oid=base, paths=[selected])
        assert neighbour.read_bytes() == b"unrelated dirty bytes\n", f"Restore of {selected!r} overwrote a neighbouring file"
        assert fixtures.git(repository, "--literal-pathspecs", "ls-files", "--stage", "--", other) == index
        assert file.read_bytes() == b"selected old\n"
        assert fixtures.git(repository, "diff", "--cached", "--name-only", "-z") == selected + "\0"
        assert fixtures.git(repository, "rev-parse", "HEAD") == tip
        fixtures.git(repository, "--literal-pathspecs", "restore", "--source", "HEAD", "--staged", "--worktree", "--", selected)

        selected_patch(call("inspect_commit_file", oid=changed, path=selected, previousPath=None))
        selected_patch(call("compare_commit_file", baseOid=base, targetOid=changed, path=selected, previousPath=None))
        selected_patch(call("compare_commit_file_with_working_tree", baseOid=base, path=selected, previousPath=None))
        history = call("inspect_file_history", revision=tip, path=selected)
        assert [entry["subject"] for entry in history] == ["Selected change", "Base selected files"], history

        file.write_bytes(b"selected stashed\n")
        (repository / "untracked.txt").write_bytes(b"unrelated untracked\n")
        fixtures.git(repository, "stash", "push", "--include-untracked", "-m", "Tracked literal preview")
        selected_patch(call("inspect_stash_file", oid=fixtures.git(repository, "rev-parse", "refs/stash"), path=selected, previousPath=None), "selected stashed")
        fixtures.git(repository, "stash", "pop")
        temporary = repository / "*.tmp"
        temporary.write_bytes(b"selected untracked stash\n")
        (repository / "other.tmp").write_bytes(b"unrelated untracked stash\n")
        fixtures.git(repository, "stash", "push", "--include-untracked", "-m", "Untracked literal preview")
        selected_patch(call("inspect_stash_file", oid=fixtures.git(repository, "rev-parse", "refs/stash"), path=temporary.name, previousPath=None), "selected untracked stash")

    report["scenarios"].extend([
        "native-literal-historical-restore-preserves-dirty-neighbours",
        "native-literal-commit-file-preview",
        "native-literal-commit-comparison",
        "native-literal-working-tree-comparison",
        "native-literal-file-history-excludes-neighbour-commits",
        "native-literal-tracked-stash-preview",
        "native-literal-untracked-stash-preview",
    ])


def file_workflows(driver, fixtures, report):
    """Exercise file-operation controls without Angular/debug state injection."""
    repository = fixtures.repository("ui-file-workflows", 3)
    file = repository / "fixture.txt"
    original = file.read_text()
    file.write_text("unstaged native UI edit\n")
    repo_id = open_ui(driver, repository)
    driver.click('.wip-nav')
    driver.wait("return !!document.querySelector('[aria-label=\"Stage fixture.txt\"]')")
    driver.click('[aria-label="Working directory options"]')
    driver.wait("return !!document.querySelector('[role=menu][aria-label=\"Working directory options\"]')")
    driver.click_text('[role="menuitem"] strong', 'Discard all unstaged…')
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    driver.click_text('[role="alertdialog"] button', 'Discard captured changes')
    driver.wait("return !document.querySelector('[aria-label=\"Stage fixture.txt\"]')")
    assert file.read_text() == original
    assert not fixtures.git(repository, "status", "--porcelain")
    captures = driver.invoke("load_discard_recoveries", repoId=repo_id)
    assert len(captures) == 1
    report["scenarios"].append("native-ui-bulk-discard-and-capture")

    file.write_text("partial edit reviewed in native UI\n")
    driver.reload()
    driver.wait("return !!document.querySelector('.wip-nav')")
    driver.click('.wip-nav')
    driver.wait("return !!document.querySelector('[title=\"View changes in fixture.txt\"]')")
    driver.click_visible('[title="View changes in fixture.txt"]')
    added = '[aria-label^="Select added line"]:not(:disabled)'
    driver.wait(f"return !!document.querySelector({json.dumps(added)})")
    driver.click_visible(added)
    driver.wait("return !!document.querySelector('[aria-label=\"Selected line actions\"]')")
    driver.click_text('[aria-label="Selected line actions"] button', 'Discard')
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    file.write_text("later external native edit\n")
    driver.click_text('[role="alertdialog"] button', 'Discard selected lines')
    driver.wait("return document.querySelector('.error-toast')?.textContent.includes('changed') || !document.querySelector('[aria-label=\"Diff viewer\"]')")
    assert file.read_text() == "later external native edit\n", "Partial discard replaced edits made after its confirmation opened"
    assert driver.script("return !!document.querySelector('.error-toast')?.textContent.includes('changed')")
    assert not fixtures.git(repository, "diff", "--cached", "--name-only")
    assert len(driver.invoke("load_discard_recoveries", repoId=repo_id)) == 1
    report["scenarios"].append("native-ui-partial-discard-refuses-stale-patch")

    driver.click_visible('[aria-label="Reload diff"]:not(:disabled)')
    driver.wait("return document.querySelector('[aria-label=\"Diff viewer\"]')?.textContent.includes('later external native edit')")
    driver.click_visible(added)
    driver.wait("return !!document.querySelector('[aria-label=\"Selected line actions\"]')")
    driver.click_text('[aria-label="Selected line actions"] button', 'Discard')
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    driver.click_text('[role="alertdialog"] button', 'Discard selected lines')
    driver.wait("return !document.querySelector('[aria-label=\"Diff viewer\"]')")
    assert file.read_text() == original
    assert not fixtures.git(repository, "status", "--porcelain")
    refreshed_captures = driver.invoke("load_discard_recoveries", repoId=repo_id)
    new_ids = {capture["id"] for capture in refreshed_captures} - {capture["id"] for capture in captures}
    assert len(new_ids) == 1
    recovery_id = new_ids.pop()
    driver.invoke("apply_saved_discard", repoId=repo_id, id=recovery_id, reverse=False)
    assert file.read_text() == "later external native edit\n"
    driver.invoke("apply_saved_discard", repoId=repo_id, id=recovery_id, reverse=True)
    assert file.read_text() == original
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-ui-partial-discard-refresh-and-retry")
    driver.reload()
    driver.wait("return !!document.querySelector('.wip-nav')")

    previous = fixtures.git(repository, "rev-parse", "HEAD~1")
    row = f'.commit-row[data-commit-oid="{previous}"]'
    driver.wait(f"return !!document.querySelector({json.dumps(row)})")
    driver.click_visible(row)
    entry = '.commit-file[aria-label="Open diff for fixture.txt"]'
    driver.wait(f"return [...document.querySelectorAll({json.dumps(entry)})].some(element => element.getClientRects().length)")
    driver.script("""
      const element = [...document.querySelectorAll(arguments[0])].find(element => element.getClientRects().length);
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: bounds.left + 10, clientY: bounds.top + 10}));
    """, entry)
    driver.wait("return !!document.querySelector('.commit-file-context-menu')")
    driver.click_text('.commit-file-context-menu [role="menuitem"]', 'Restore file from this commit…')
    driver.wait("return !!document.querySelector('[role=alertdialog] .confirm-action:not(:disabled)')")
    driver.click_text('[role="alertdialog"] button', 'Restore and stage file')
    driver.wait("return !!document.querySelector('.wip-panel-title') && !!document.querySelector('[aria-label=\"Unstage fixture.txt\"]')")
    assert file.read_text() == fixtures.git(repository, "show", f"{previous}:fixture.txt") + "\n"
    assert fixtures.git(repository, "diff", "--cached", "--name-only") == "fixture.txt"
    report["scenarios"].append("native-ui-restore-file-from-commit")

    fixtures.git(repository, "reset", "--hard", "-q", "HEAD")
    fixtures.git(repository, "checkout", "-q", "-b", "ui-conflict-side")
    file.write_text("incoming native conflict\n")
    fixtures.git(repository, "commit", "-qam", "Incoming conflict")
    fixtures.git(repository, "checkout", "-q", "main")
    file.write_text("current native conflict\n")
    fixtures.git(repository, "commit", "-qam", "Current conflict")
    before = fixtures.git(repository, "rev-parse", "HEAD")
    try:
        fixtures.git(repository, "merge", "ui-conflict-side")
    except RuntimeError:
        pass
    assert fixtures.git(repository, "diff", "--name-only", "--diff-filter=U") == "fixture.txt"
    driver.reload()
    driver.wait("return !!document.querySelector('.wip-nav')")
    driver.click('.wip-nav')
    driver.wait("return !!document.querySelector('[title=\"Open Merge Tool for fixture.txt\"]')")
    driver.click('[title="Open Merge Tool for fixture.txt"]')
    output = '[aria-label="Resolved output for fixture.txt"]'
    driver.wait(f"return !!document.querySelector({json.dumps(output)})")
    driver.script("const input = document.querySelector(arguments[0]); input.value = 'resolved from native UI\\n'; input.dispatchEvent(new Event('input', {bubbles: true}));", output)
    driver.wait("return !!document.querySelector('.merge-tool .primary:not(:disabled)')")
    driver.click_text('.merge-tool button', 'Save Output & Mark Resolved')
    driver.wait("return !document.querySelector('.merge-tool')")
    assert file.read_text() == "resolved from native UI\n"
    assert fixtures.git(repository, "show", ":fixture.txt") == "resolved from native UI"
    assert not fixtures.git(repository, "diff", "--name-only", "--diff-filter=U")
    assert fixtures.git(repository, "rev-parse", "HEAD") == before
    fixtures.git(repository, "merge", "--abort")
    assert file.read_text() == "current native conflict\n"
    assert not fixtures.git(repository, "status", "--porcelain")
    report["scenarios"].append("native-ui-conflict-output-resolution")


def advanced(driver, fixtures, report):
    repository = fixtures.repository("advanced", 8)
    repo_id = driver.invoke("open_repository", path=str(repository))["id"]

    def call(command, **args):
        return driver.invoke(command, repoId=repo_id, **args)

    def commit(message, sign=False):
        call("stage_all")
        return call("commit_changes", message=message, amend=False, skipHooks=False, sign=sign)["headOid"]

    base = fixtures.git(repository, "rev-parse", "HEAD")
    call("create_branch", name="topic")
    (repository / "topic.txt").write_text("topic\n")
    commit("Topic for rebase")
    call("checkout_branch", name="main")
    (repository / "main.txt").write_text("main\n")
    commit("Main for rebase")
    plan = call("prepare_interactive_rebase", source="topic", target="main", selectionOids=None, root=False)
    assert plan["commits"]
    call("execute_interactive_rebase", source="topic", target="main",
         steps=[dict(oid=entry["oid"], action="pick", message=None) for entry in plan["commits"]],
         selectionOids=None, root=False, ontoOid=None)
    assert not call("refresh_repository_status")["rebaseInProgress"]
    assert (repository / "topic.txt").is_file() and (repository / "main.txt").is_file()
    report["scenarios"].append("interactive-rebase-pick")

    call("create_branch_at", name="edit-topic", oid=base)
    call("checkout_branch", name="edit-topic")
    (repository / "edit.txt").write_text("edit\n")
    commit("Edit rebase")
    call("checkout_branch", name="main")
    plan = call("prepare_interactive_rebase", source="edit-topic", target="main", selectionOids=None, root=False)
    call("execute_interactive_rebase", source="edit-topic", target="main",
         steps=[dict(oid=entry["oid"], action="edit", message=None) for entry in plan["commits"]],
         selectionOids=None, root=False, ontoOid=None)
    assert call("refresh_repository_status")["rebaseEditStopped"]
    call("abort_rebase")
    assert not call("refresh_repository_status")["rebaseInProgress"]
    call("checkout_branch", name="main")
    report["scenarios"].append("interactive-rebase-edit-and-abort")

    # Local bare remote: actual native fetch/publish/clone without external accounts.
    bare = fixtures.root / "remote.git"
    run("git", "init", "--bare", "-q", str(bare), env=fixtures.env)
    call("add_remote", name="origin", url=str(bare))
    call("publish_branch", remote="origin", branch="main", operationId=str(uuid.uuid4()))
    assert fixtures.git(bare, "rev-parse", "main") == fixtures.git(repository, "rev-parse", "main")
    call("fetch_branches", options=dict(remote="origin", prune=True), operationId=str(uuid.uuid4()))
    cloned = driver.invoke("clone_repository", remote=str(bare), parentPath=str(fixtures.root), folder="native-clone",
                           branch="main", depth=None, recurseSubmodules=False, operationId=str(uuid.uuid4()))
    assert cloned["headOid"] == fixtures.git(repository, "rev-parse", "main")
    report["scenarios"].append("local-remote-publish-fetch-clone")

    key = fixtures.root / "native-signing-key"
    run("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key), env=fixtures.env)
    allowed = fixtures.root / "allowed-signers"
    allowed.write_text("native@example.test " + key.with_suffix(".pub").read_text())
    for name, value in (("gpg.format", "ssh"), ("user.signingkey", str(key)), ("gpg.ssh.allowedSignersFile", str(allowed))):
        fixtures.git(repository, "config", name, value)
    (repository / "signed.txt").write_text("signed natively\n")
    signed_message = "Native élève😀 SSH-signed commit\n\nSigned Unicode élève😀 body"
    signed = commit(signed_message, sign=True)
    for name, value in (("i18n.logOutputEncoding", "UTF-16"), ("log.showSignature", "true"), ("color.ui", "always")):
        fixtures.git(repository, "config", name, value)
    signed_details = call("inspect_commit", oid=signed)
    assert signed_details["signature"]["status"].startswith("valid"), signed_details
    assert signed_details["message"] == signed_message
    for name in ("i18n.logOutputEncoding", "log.showSignature", "color.ui"):
        fixtures.git(repository, "config", "--unset", name)
    report["scenarios"].append("native-ssh-signing-and-verification")

    call("lfs_initialize")
    lfs_empty_store_review(driver, fixtures, repository, repo_id, report)
    call("lfs_track_pattern", pattern="*.native-bin", lockable=False)
    (repository / "object.native-bin").write_bytes(b"native LFS content\n" * 16)
    commit("Native LFS object")
    objects = call("lfs_objects")["files"]
    assert objects and objects[0]["oidType"] == "sha256" and objects[0]["workingState"]
    assert call("lfs_tracking_rules")["patterns"]
    assert call("lfs_file_attributes", file="object.native-bin")["attributes"]
    report["scenarios"].append("native-lfs-initialize-track-commit-inspect")

    contents = b"protected native CRLF object\n"
    pointer = fixtures.git(repository, "lfs", "clean", input=contents)
    oid = next(line.removeprefix("oid sha256:") for line in pointer.splitlines() if line.startswith("oid sha256:"))
    media = Path(next(line.removeprefix("LocalMediaDir=") for line in fixtures.git(repository, "lfs", "env").splitlines() if line.startswith("LocalMediaDir=")))
    assert media.resolve().is_relative_to((repository / ".git").resolve())
    cached = media / oid[:2] / oid[2:4] / oid
    old = time.time() - 7200
    os.utime(cached, (old, old))
    before = call("lfs_prune_preview")
    assert any(entry["oid"] == oid for entry in before["objects"])
    pointer_file = repository / "crlf-lfs.pointer"
    pointer_file.write_bytes((pointer.replace("\n", "\r\n") + "\r\n").encode())
    fixtures.git(repository, "lfs", "pointer", "--check", "--no-strict", "--file", str(pointer_file))
    pointer_oid = fixtures.git(repository, "hash-object", "-w", "--no-filters", "--", str(pointer_file)).strip()
    index = (repository / ".git/index").read_bytes()
    head = fixtures.git(repository, "rev-parse", "HEAD")
    cache_before = {str(file.relative_to(media)): file.read_bytes() for file in media.rglob("*") if file.is_file()}
    after = call("lfs_prune_preview")
    assert all(entry["oid"] != oid for entry in after["objects"]), "CRLF pointer did not protect its referenced LFS object"
    try:
        call("lfs_prune_objects", preview=before, operationId=str(uuid.uuid4()))
    except RuntimeError as error:
        assert json.loads(str(error))["kind"] == "staleLfsPrune", error
    else:
        raise AssertionError("A stale prune review removed an object referenced by an accepted CRLF pointer")
    assert cached.read_bytes() == contents
    assert {str(file.relative_to(media)): file.read_bytes() for file in media.rglob("*") if file.is_file()} == cache_before
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    report["scenarios"].append("native-lfs-prune-retains-accepted-crlf-pointer-and-refuses-stale-removal")
    replacement_file = repository / "replacement-lfs.pointer"
    replacement_file.write_bytes(b"hidden pointer\n")
    replacement_oid = fixtures.git(repository, "hash-object", "-w", "--no-filters", "--", str(replacement_file)).strip()
    fixtures.git(repository, "replace", pointer_oid, replacement_oid)
    visible_pointer = subprocess.run(
        ["git", "-C", str(repository), "cat-file", "-p", pointer_oid],
        env=fixtures.env, capture_output=True, check=True, timeout=120,
    ).stdout
    assert visible_pointer == b"hidden pointer\n"
    after = call("lfs_prune_preview")
    assert all(entry["oid"] != oid for entry in after["objects"]), "Replacement ref hid an original pointer from cleanup"
    try:
        call("lfs_prune_objects", preview=before, operationId=str(uuid.uuid4()))
    except RuntimeError as error:
        assert json.loads(str(error))["kind"] == "staleLfsPrune", error
    else:
        raise AssertionError("A replacement ref allowed cleanup to remove original pointer content")
    assert cached.read_bytes() == contents
    assert {str(file.relative_to(media)): file.read_bytes() for file in media.rglob("*") if file.is_file()} == cache_before
    assert (repository / ".git/index").read_bytes() == index
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert fixtures.git(repository, "rev-parse", f"refs/replace/{pointer_oid}").strip() == replacement_oid
    report["scenarios"].append("native-lfs-prune-protects-original-pointer-behind-replacement-ref")
    lfs_prune_scan_cancellation(driver, fixtures, repository, repo_id, report)


def lfs_empty_store_review(driver, fixtures, repository, repo_id, report):
    media = Path(next(line.removeprefix("LocalMediaDir=") for line in fixtures.git(repository, "lfs", "env").splitlines() if line.startswith("LocalMediaDir=")))
    assert not any(file.is_file() for file in media.rglob("*")), "Owned fixture should start with empty LFS storage"
    gate = fixtures.history_gate
    hold, started = gate / "hold", gate / "started"
    started.unlink(missing_ok=True)
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("--batch-all-objects")
    hold.touch()
    fallback = threading.Timer(8, lambda: hold.unlink(missing_ok=True))
    fallback.start()
    try:
        before = time.monotonic()
        preview = driver.invoke("lfs_prune_preview", repoId=repo_id)
        elapsed = time.monotonic() - before
        assert preview["objects"] == [] and preview["remaining"] == 0
        assert not started.exists(), "An empty LFS store unnecessarily enumerated Git objects"
        assert hold.exists() and elapsed < 2, "Empty LFS review did not finish promptly"
        report["emptyLfsReviewMs"] = elapsed * 1000
    finally:
        fallback.cancel()
        hold.unlink(missing_ok=True)
        (gate / "target").unlink(missing_ok=True)
        (gate / "mode").unlink(missing_ok=True)
    report["scenarios"].append("native-empty-lfs-review-skips-git-object-enumeration")


def lfs_prune_scan_cancellation(driver, fixtures, repository, repo_id, report):
    pointer = fixtures.git(repository, "lfs", "clean", input=b"owned cancelled prune object\n")
    oid = next(line.removeprefix("oid sha256:") for line in pointer.splitlines() if line.startswith("oid sha256:"))
    media = Path(next(line.removeprefix("LocalMediaDir=") for line in fixtures.git(repository, "lfs", "env").splitlines() if line.startswith("LocalMediaDir=")))
    assert media.resolve().is_relative_to((repository / ".git").resolve())
    cached = media / oid[:2] / oid[2:4] / oid
    old = time.time() - 7200
    os.utime(cached, (old, old))
    preview = driver.invoke("lfs_prune_preview", repoId=repo_id)
    assert any(entry["oid"] == oid for entry in preview["objects"])
    gate = fixtures.history_gate
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    fixtures.git(repository, "config", "remote.owned-preflight.promisor", "OFF")
    try:
        assert any(entry["oid"] == oid for entry in driver.invoke("lfs_prune_preview", repoId=repo_id)["objects"])
    finally:
        fixtures.git(repository, "config", "--unset", "remote.owned-preflight.promisor")
    fixtures.git(repository, "config", "extensions.partialclone", "false")
    try:
        try:
            driver.invoke("lfs_prune_objects", repoId=repo_id, preview=preview, operationId=str(uuid.uuid4()))
        except RuntimeError as error:
            assert json.loads(str(error))["kind"] == "unsafeLfsPrune", error
        else:
            raise AssertionError("Partial-clone remote named false permitted cleanup")
    finally:
        fixtures.git(repository, "config", "--unset", "extensions.partialclone")
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("--get-regexp")
    (gate / "failure").write_text("2")
    try:
        for inherited in (False, True):
            if inherited:
                (gate / "inherit-stdout").touch()
            for command, args in (
                ("lfs_prune_preview", dict(repoId=repo_id)),
                ("lfs_prune_objects", dict(repoId=repo_id, preview=preview, operationId=str(uuid.uuid4()))),
            ):
                before = time.monotonic()
                try:
                    driver.invoke(command, **args)
                except RuntimeError as error:
                    assert json.loads(str(error))["kind"] == "unsafeLfsPrune", error
                else:
                    raise AssertionError("A failed configuration query permitted cleanup")
                if inherited:
                    elapsed = (time.monotonic() - before) * 1000
                    report.setdefault("pruneFailedParentMs", {})[command] = elapsed
                    assert elapsed < 2000, "An exited failed Git parent waited for inherited stdout"
                    parent = int((gate / "started").read_text())
                    assert not Path(f"/proc/{parent}").exists(), "Failed metadata Git parent was not reaped"
                    child = int((gate / "inherited-pid").read_text())
                    stat = Path(f"/proc/{child}/stat")
                    # An orphan may briefly await init's reap, but it must no
                    # longer be running or holding the inherited output pipe.
                    try:
                        state = stat.read_text().rsplit(")", 1)[1].split()[0]
                    except FileNotFoundError:
                        state = None
                    assert state in (None, "Z"), "Failed metadata descendant is still running"
    finally:
        for name in ("target", "mode", "failure", "inherit-stdout", "inherited-pid"):
            (gate / name).unlink(missing_ok=True)
    assert cached.read_bytes() == b"owned cancelled prune object\n"
    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git/index").read_bytes() == index
    report["scenarios"].append("native-lfs-prune-refuses-incomplete-clone-settings-and-failed-config-query")
    report["scenarios"].append("native-lfs-prune-failed-parent-closes-inherited-output-without-timeout-or-removal")
    for mode in ("version", "--is-shallow-repository", "--get-regexp", "env", "--git-common-dir", "--batch-all-objects", "--batch"):
        hold, started = gate / "hold", gate / "started"
        started.unlink(missing_ok=True)
        (gate / "target").write_text(str(repository))
        (gate / "mode").write_text(mode)
        hold.touch()
        fallback = threading.Timer(8, lambda: hold.unlink(missing_ok=True))
        fallback.start()
        operation = str(uuid.uuid4())
        try:
            driver.script("""
              window.__ownedPruneScan = {done: false};
              window.__TAURI_INTERNALS__.invoke('lfs_prune_objects', arguments[0]).then(
                value => {window.__ownedPruneScan = {done: true, value};},
                error => {window.__ownedPruneScan = {done: true, error};});
            """, dict(repoId=repo_id, preview=preview, operationId=operation))
            deadline = time.monotonic() + 3
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            assert started.exists(), f"Prune {mode} did not reach the owned gate"
            pid = int(started.read_text())
            before = time.monotonic()
            assert driver.invoke("cancel_git_operation", operationId=operation) is True
            deadline = time.monotonic() + 2
            while not driver.script("return window.__ownedPruneScan.done") and time.monotonic() < deadline:
                time.sleep(.02)
            assert driver.script("return window.__ownedPruneScan.done"), f"Prune {mode} ignored cancellation while Git held its pipe"
            assert hold.exists(), "Fixture fallback, not cancellation, released Git"
            result = driver.script("return window.__ownedPruneScan")
            assert result["error"]["kind"] == "operationCancelled", result
            assert not Path(f"/proc/{pid}").exists(), "Cancelled prune Git process was not reaped"
            report.setdefault("pruneCancelMs", {})[mode] = (time.monotonic() - before) * 1000
        finally:
            fallback.cancel()
            hold.unlink(missing_ok=True)
            (gate / "target").unlink(missing_ok=True)
            (gate / "mode").unlink(missing_ok=True)
            driver.wait("return window.__ownedPruneScan.done")
        assert cached.read_bytes() == b"owned cancelled prune object\n"
    report["scenarios"].append("native-lfs-prune-cancels-preflight-inventory-and-content-reads-and-reaps-git")
    lfs_prune_directory_swap(driver, fixtures, repository, repo_id, report, preview, oid, cached)


def lfs_prune_directory_swap(driver, fixtures, repository, repo_id, report, preview, oid, cached):
    gate = fixtures.history_gate
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git/index").read_bytes()
    outside = fixtures.root / "prune-directory-swap-outside"
    outside.mkdir(mode=0o700)
    external = outside / oid
    original_bytes = cached.read_bytes()
    # Same reviewed length, different contents: size validation alone must
    # never be enough to hide an outside-directory traversal.
    external_bytes = b"!" * len(original_bytes)
    assert external_bytes != original_bytes
    external.write_bytes(external_bytes)
    leaf = cached.parent
    parked = leaf.parent / "owned-parked-cache-directory"
    assert not parked.exists()
    reviewed = next(entry for entry in preview["objects"] if entry["oid"] == oid)
    single = dict(preview, objects=[reviewed], totalSize=reviewed["size"], remaining=0)
    hold, started = gate / "hold", gate / "started"
    started.unlink(missing_ok=True)
    (gate / "target").write_text(str(repository))
    (gate / "mode").write_text("--batch-all-objects")
    hold.touch()
    fallback = threading.Timer(8, lambda: hold.unlink(missing_ok=True))
    fallback.start()
    swapped = False
    try:
        driver.script("""
          window.__ownedPruneDirectorySwap = {done: false};
          window.__TAURI_INTERNALS__.invoke('lfs_prune_objects', arguments[0]).then(
            value => {window.__ownedPruneDirectorySwap = {done: true, value};},
            error => {window.__ownedPruneDirectorySwap = {done: true, error};});
        """, dict(repoId=repo_id, preview=single, operationId=str(uuid.uuid4())))
        deadline = time.monotonic() + 3
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.01)
        assert started.exists(), "LFS removal did not reach the owned post-inventory gate"
        # Local cache discovery has completed, while the Git object scan is
        # held. Change only an owned cache directory, not any personal data.
        leaf.rename(parked)
        swapped = True
        leaf.symlink_to(outside, target_is_directory=True)
        hold.unlink()
        driver.wait("return window.__ownedPruneDirectorySwap.done")
        result = driver.script("return window.__ownedPruneDirectorySwap")
        assert external.exists() and external.read_bytes() == external_bytes, "LFS cleanup followed a swapped cache directory and removed an external file"
        assert result.get("error", {}).get("kind") in ("unsafeLfsPrune", "staleLfsPrune", "lfsPruneFailed"), result
        assert (parked / oid).read_bytes() == original_bytes
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert (repository / ".git/index").read_bytes() == index
        report["scenarios"].append("native-lfs-prune-refuses-directory-swap-without-external-or-reviewed-data-loss")
    finally:
        fallback.cancel()
        fallback.join(timeout=2)
        assert not fallback.is_alive(), "Owned directory-swap fallback did not stop"
        hold.unlink(missing_ok=True)
        if swapped:
            if leaf.is_symlink():
                leaf.unlink()
            parked.rename(leaf)
        for name in ("target", "mode"):
            (gate / name).unlink(missing_ok=True)
        driver.wait("return window.__ownedPruneDirectorySwap.done")

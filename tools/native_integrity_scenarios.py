"""Packaged UI behavior for real Git integrity findings and safe refusal."""
import re
import os
import shlex
import shutil
import stat
import time

from native_acceptance import open_ui


def integrity_cancellation_environment(fixtures):
    real_git = shutil.which("git", path=fixtures.env.get("PATH", os.defpath))
    if real_git is None:
        raise RuntimeError("Git is required for packaged integrity cancellation acceptance")
    directory = fixtures.root / "integrity-git-bin"
    directory.mkdir(mode=0o700)
    gate = fixtures.root / "integrity-fsck-gate"
    gate.mkdir(mode=0o700)
    wrapper = directory / "git"
    wrapper.write_text(
        "#!/bin/sh\n"
        'gate="$GIT_KHRONOS_ACCEPTANCE_INTEGRITY_GATE"\n'
        'if [ "$1" = "-C" ] && [ "$2" = "$(cat "$gate/target" 2>/dev/null)" ] && [ "$5" = "fsck" ] && [ -f "$gate/hold" ]; then\n'
        '  printf \'%s\\n\' "$$" > "$gate/started" || exit 126\n'
        '  while [ -f "$gate/hold" ]; do /bin/sleep 0.05; done\n'
        "fi\n"
        f"exec {shlex.quote(real_git)} \"$@\"\n"
    )
    wrapper.chmod(0o700)
    return {
        "PATH": str(directory) + os.pathsep + fixtures.env.get("PATH", os.defpath),
        "GIT_KHRONOS_ACCEPTANCE_INTEGRITY_GATE": str(gate),
    }


def damaged_integrity_ui(driver, fixtures, report):
    repository = fixtures.repository("damaged-integrity-ui", commits=2)
    source = repository / "unreferenced-integrity-fixture.txt"
    source.write_text("disposable unreachable blob\n")
    oid = fixtures.git(repository, "hash-object", "-w", str(source))
    object_path = repository / ".git" / "objects" / oid[:2] / oid[2:]
    original_object = object_path.read_bytes()
    original_mode = stat.S_IMODE(object_path.stat().st_mode)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git" / "index").read_bytes()
    config = (repository / ".git" / "config").read_bytes()
    status = fixtures.git(repository, "status", "--porcelain=v1")

    try:
        object_path.chmod(0o600)
        object_path.write_bytes(b"")
        open_ui(driver, repository)
        driver.click('[aria-label="Preferences"]')
        driver.wait("return !!document.querySelector('#preferences-tab-git')?.getClientRects().length")
        driver.click('#preferences-tab-git')
        driver.wait("return !!document.querySelector('gk-integrity-panel')")
        panel = 'gk-integrity-panel'

        driver.click_scrolled_text(panel + ' button', 'Inspect integrity', wait_for_ready=True)
        result = driver.wait("""const panel = document.querySelector('gk-integrity-panel');
          const status = panel?.querySelector('[role="status"]');
          return status?.textContent.includes('findings or a check failure') ? status.textContent : null;""")
        exit_code = re.search(r"Exit (\d+)\.", result)
        assert exit_code and int(exit_code.group(1)) != 0, result
        diagnostic = driver.script("return document.querySelector('gk-integrity-panel [aria-label=\"Integrity diagnostic output\"]')?.textContent")
        assert diagnostic and ("is empty" in diagnostic or "is corrupt" in diagnostic), diagnostic
        assert not (repository / ".git/lost-found").exists()
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / ".git/config").read_bytes() == config
        assert fixtures.git(repository, "status", "--porcelain=v1") == status

        driver.click_scrolled_text(panel + ' summary', 'Non-pruning maintenance', wait_for_ready=True)
        driver.click_scrolled_text(panel + ' button', 'Review maintenance', wait_for_ready=True)
        driver.wait("return document.querySelector('gk-integrity-panel')?.textContent.includes('Run integrity-checked commit-graph')")
        driver.click_scrolled_text(panel + ' button', 'Run maintenance', wait_for_ready=True)
        refusal = driver.wait("""const alert = document.querySelector('gk-integrity-panel [role="alert"]');
          return alert?.textContent.includes('No maintenance task') ? alert.textContent : null;""")
        assert "integrity check failed" in refusal, refusal
        completion = driver.script("return document.querySelector('gk-integrity-panel [role=status]')?.textContent || ''")
        assert "Maintenance complete" not in completion, completion
        assert object_path.read_bytes() == b""
        assert not (repository / ".git/packed-refs").exists()
        assert not (repository / ".git/objects/info/commit-graphs").exists()
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert (repository / ".git/index").read_bytes() == index
        assert (repository / ".git/config").read_bytes() == config
        assert fixtures.git(repository, "status", "--porcelain=v1") == status
        report["scenarios"].append(
            "native-integrity-ui-reports-damaged-object-and-refuses-maintenance-without-repair-or-repository-mutation")
    finally:
        object_path.chmod(0o600)
        object_path.write_bytes(original_object)
        object_path.chmod(original_mode)


def healthy_integrity_maintenance_ui(driver, fixtures, report):
    repository = fixtures.repository("healthy-integrity-maintenance-ui", commits=2)
    fixtures.git(repository, "branch", "maintenance-preserved")
    fixtures.git(repository, "tag", "maintenance-preserved")
    source = repository / "unreachable-integrity-fixture.txt"
    source.write_text("unreachable object must not be pruned\n")
    oid = fixtures.git(repository, "hash-object", "-w", str(source))
    oid = oid.strip()
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git" / "index").read_bytes()
    config = (repository / ".git" / "config").read_bytes()
    status = fixtures.git(repository, "status", "--porcelain=v1")
    refs = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)")
    reflog = (repository / ".git" / "logs" / "HEAD").read_bytes()

    assert not (repository / ".git" / "packed-refs").exists()
    assert not (repository / ".git" / "objects" / "info" / "commit-graphs").exists()
    open_ui(driver, repository)
    driver.click('[aria-label="Preferences"]')
    driver.wait("return !!document.querySelector('#preferences-tab-git')?.getClientRects().length")
    driver.click('#preferences-tab-git')
    driver.wait("return !!document.querySelector('gk-integrity-panel')")
    panel = 'gk-integrity-panel'
    driver.click_scrolled_text(panel + ' summary', 'Non-pruning maintenance', wait_for_ready=True)
    driver.click_scrolled_text(panel + ' button', 'Review maintenance', wait_for_ready=True)
    driver.wait("return document.querySelector('gk-integrity-panel')?.textContent.includes('Run integrity-checked commit-graph')")
    driver.click_scrolled_text(panel + ' button', 'Run maintenance', wait_for_ready=True)
    driver.wait("""return [...(document.querySelector('gk-integrity-panel')?.querySelectorAll('[role="status"]') ?? [])]
      .some(status => status.textContent.includes('Maintenance complete.'));""")

    deadline = time.monotonic() + 15
    graph_directory = repository / ".git" / "objects" / "info" / "commit-graphs"
    packed_refs = repository / ".git" / "packed-refs"
    while time.monotonic() < deadline:
        error = driver.script("return document.querySelector('gk-integrity-panel [role=alert]')?.textContent || ''")
        assert not error, f"reviewed healthy maintenance failed: {error}"
        if packed_refs.is_file() and graph_directory.is_dir() and any(graph_directory.glob("graph-*.graph")):
            break
        time.sleep(0.1)
    else:
        raise AssertionError("reviewed maintenance did not create packed refs and a commit graph")

    assert fixtures.git(repository, "rev-parse", "HEAD") == head
    assert (repository / ".git" / "index").read_bytes() == index
    assert (repository / ".git" / "config").read_bytes() == config
    assert (repository / ".git" / "logs" / "HEAD").read_bytes() == reflog
    assert fixtures.git(repository, "status", "--porcelain=v1") == status
    assert fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)") == refs
    assert fixtures.git(repository, "cat-file", "-p", oid) == "unreachable object must not be pruned"
    report["scenarios"].append(
        "native-integrity-ui-runs-reviewed-non-pruning-maintenance-and-preserves-checkout-index-refs-and-unreachable-objects")


def cancelled_integrity_ui(driver, fixtures, report):
    repository = fixtures.repository("cancelled-integrity-ui", commits=2)
    head = fixtures.git(repository, "rev-parse", "HEAD")
    index = (repository / ".git" / "index").read_bytes()
    config = (repository / ".git" / "config").read_bytes()
    status = fixtures.git(repository, "status", "--porcelain=v1")
    gate = fixtures.root / "integrity-fsck-gate"
    (gate / "target").write_text(str(repository))
    (gate / "hold").write_text("hold explicit fsck until UI cancellation\n")
    try:
        open_ui(driver, repository)
        driver.click('[aria-label="Preferences"]')
        driver.wait("return !!document.querySelector('#preferences-tab-git')?.getClientRects().length")
        driver.click('#preferences-tab-git')
        panel = 'gk-integrity-panel'
        driver.wait("return !!document.querySelector('gk-integrity-panel')")
        driver.click_scrolled_text(panel + ' button', 'Inspect integrity', wait_for_ready=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not (gate / "started").is_file():
            time.sleep(0.05)
        assert (gate / "started").is_file(), "the app did not start the held integrity check"
        process_id = int((gate / "started").read_text().strip())
        driver.click_scrolled_text(panel + ' button', 'Cancel inspection', wait_for_ready=True)
        message = driver.wait("""const panel = document.querySelector('gk-integrity-panel');
          const alert = panel?.querySelector('[role="alert"]');
          return alert?.textContent.includes('cancelled') ? alert.textContent : null;""")
        assert "Inspection cancelled" in message and "No complete result" in message, message
        assert not driver.script("return !!document.querySelector('gk-integrity-panel [aria-label=\"Integrity diagnostic output\"]')")
        status_text = driver.script("return document.querySelector('gk-integrity-panel [role=status]')?.textContent || ''")
        assert "Git completed the check" not in status_text, status_text
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(process_id, 0)
            except ProcessLookupError:
                break
            time.sleep(0.05)
        else:
            raise AssertionError("cancelled Git fsck process was not reaped")
        assert fixtures.git(repository, "rev-parse", "HEAD") == head
        assert (repository / ".git" / "index").read_bytes() == index
        assert (repository / ".git" / "config").read_bytes() == config
        assert fixtures.git(repository, "status", "--porcelain=v1") == status
        assert not (repository / ".git" / "lost-found").exists()
        assert not (repository / ".git" / "objects" / "info" / "commit-graphs").exists()
        report["scenarios"].append(
            "native-integrity-ui-cancels-held-fsck-without-presenting-partial-success-or-mutating-repository")
    finally:
        (gate / "hold").unlink(missing_ok=True)

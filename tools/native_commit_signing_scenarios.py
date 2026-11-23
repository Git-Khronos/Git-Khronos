"""Packaged UI acceptance for explicitly signing a new commit."""
import subprocess
import json

from native_acceptance import open_ui, run, seed_commit_draft


def signed_commit_creation(driver, fixtures, report):
    repository = fixtures.repository("signed-commit-ui", commits=3)
    parent = fixtures.git(repository, "rev-parse", "HEAD")
    gnupg_home = fixtures.env["GNUPGHOME"]
    run(
        "gpg", "--batch", "--homedir", gnupg_home, "--pinentry-mode", "loopback",
        "--passphrase", "", "--quick-generate-key",
        "Native UI Commit Signing <native-ui-commit@example.test>", "ed25519", "sign", "0",
        env=fixtures.env,
    )
    key_listing = run(
        "gpg", "--batch", "--homedir", gnupg_home, "--with-colons",
        "--list-secret-keys", env=fixtures.env,
    )
    fingerprint = next(
        (fields[9] for line in key_listing.splitlines()
         if (fields := line.split(":"))[0] == "fpr"),
        None,
    )
    assert fingerprint and len(fingerprint) == 40, key_listing
    for name, value in (
        ("user.signingkey", fingerprint),
        ("gpg.format", "openpgp"),
        ("commit.gpgsign", "false"),
        ("tag.gpgsign", "false"),
    ):
        fixtures.git(repository, "config", "--local", name, value)

    payload = repository / "signed-ui-payload.txt"
    payload.write_text("Explicitly signed through the commit form.\n", encoding="utf-8")
    fixtures.git(repository, "add", "--", payload.name)
    assert fixtures.git(repository, "diff", "--cached", "--name-only") == payload.name
    config = (repository / ".git/config").read_bytes()
    existing_refs = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)")
    repo_id = open_ui(driver, repository)
    message = "Create an explicitly signed commit through the UI"
    seed_commit_draft(driver, repository, message)
    driver.wait("return !!document.querySelector('.commit-form input[name=signCommit]')")
    driver.click_visible('.commit-form input[name="signCommit"]')
    driver.wait("return document.querySelector('.commit-form input[name=signCommit]')?.checked === true")
    driver.click_visible('.commit-form button[type="submit"]')
    driver.wait(
        "return [...document.querySelectorAll('.commit-row[data-commit-oid]')].some(row => "
        f"row.textContent.includes({json.dumps(message)}))"
    )
    oid = fixtures.git(repository, "rev-parse", "HEAD")
    assert oid != parent, "The UI did not create a new commit"
    assert fixtures.git(repository, "rev-parse", "HEAD^") == parent
    commit_object = fixtures.git(repository, "cat-file", "commit", oid)
    assert "gpgsig -----BEGIN PGP SIGNATURE-----" in commit_object, commit_object
    verify = subprocess.run(
        ["git", "-C", str(repository), "verify-commit", oid],
        env=fixtures.env, capture_output=True, text=True, timeout=120,
    )
    verification_output = verify.stdout + verify.stderr
    assert verify.returncode == 0, verification_output
    driver.click(f'.commit-row[data-commit-oid="{oid}"]')
    driver.wait("return !!document.querySelector('.commit-signature.valid')")
    assert fixtures.git(repository, "show", f"{oid}:signed-ui-payload.txt") == payload.read_text().strip()
    assert not fixtures.git(repository, "status", "--porcelain=v1")
    assert not fixtures.git(repository, "diff", "--cached", "--name-only")
    assert (repository / ".git/config").read_bytes() == config
    refs_after = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)")
    assert existing_refs.splitlines() == [f"refs/heads/main {parent}"], existing_refs
    assert refs_after.splitlines() == [f"refs/heads/main {oid}"], refs_after
    report["scenarios"].append(
        "native-ui-creates-and-verifies-explicitly-openpgp-signed-commit"
    )
    return repository, repo_id

"""Packaged UI acceptance for explicitly signing a new commit."""
import subprocess
import json

from native_acceptance import open_ui, run, seed_commit_draft
from native_x509_signing_fixture import configure_x509_signing


def signed_commit_creation(driver, fixtures, report):
    repository = fixtures.repository("signed-commit-ui", commits=3)
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

    _sign_commit_in_ui(driver, fixtures, repository, "OpenPGP", "PGP SIGNATURE", report)

    ssh_repository = fixtures.repository("signed-commit-ui-ssh", commits=3)
    key = fixtures.root / "commit-ssh-signing-key"
    principal = "native-ui-commit@example.test"
    run("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", principal,
        "-f", str(key), env=fixtures.env)
    public_key = key.with_suffix(".pub").read_text(encoding="utf-8").strip()
    allowed_signers = fixtures.root / "commit-ssh-allowed-signers"
    allowed_signers.write_text(f"{principal} {public_key}\n", encoding="utf-8")
    for name, value in (
        ("user.signingkey", str(key)),
        ("gpg.format", "ssh"),
        ("gpg.ssh.allowedSignersFile", str(allowed_signers)),
        ("commit.gpgsign", "false"),
    ):
        fixtures.git(ssh_repository, "config", "--local", name, value)
    _sign_commit_in_ui(driver, fixtures, ssh_repository, "SSH", "SSH SIGNATURE", report,
                       missing_key=fixtures.root / "missing-commit-signing-key")

    x509_repository = fixtures.repository("signed-commit-ui-x509", commits=3)
    configure_x509_signing(fixtures, x509_repository)
    x509_repo_id = _sign_commit_in_ui(driver, fixtures, x509_repository, "X.509", "SIGNED MESSAGE", report)
    return x509_repository, x509_repo_id


def _sign_commit_in_ui(driver, fixtures, repository, format_name, signature_header, report, *, missing_key=None):
    parent = fixtures.git(repository, "rev-parse", "HEAD")
    payload = repository / "signed-ui-payload.txt"
    payload.write_text("Explicitly signed through the commit form.\n", encoding="utf-8")
    fixtures.git(repository, "add", "--", payload.name)
    assert fixtures.git(repository, "diff", "--cached", "--name-only") == payload.name
    config = (repository / ".git/config").read_bytes()
    existing_refs = fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)")
    repo_id = open_ui(driver, repository)
    message = f"Create an explicitly {format_name}-signed commit through the UI"
    seed_commit_draft(driver, repository, message)
    driver.wait("return !!document.querySelector('.commit-form input[name=signCommit]')")
    driver.click_visible('.commit-form input[name="signCommit"]')
    driver.wait("return document.querySelector('.commit-form input[name=signCommit]')?.checked === true")
    if missing_key is not None:
        key = fixtures.git(repository, "config", "--local", "--get", "user.signingkey")
        fixtures.git(repository, "config", "--local", "user.signingkey", str(missing_key))
        failure_config = (repository / ".git/config").read_bytes()
        staged = fixtures.git(repository, "diff", "--cached", "--binary")
        payload_bytes = payload.read_bytes()
        driver.click_visible('.commit-form button[type="submit"]')
        driver.wait("""const toast = document.querySelector('gk-error-toast');
          return /sign|private key/i.test(toast?.textContent ?? '') &&
            !document.querySelector('.commit-form button[type=submit]')?.disabled;""")
        assert driver.script("return document.querySelector('.commit-form #commit-summary').value") == message
        assert driver.script("return document.querySelector('.commit-form input[name=signCommit]').checked")
        assert fixtures.git(repository, "for-each-ref", "--format=%(refname) %(objectname)") == existing_refs
        assert fixtures.git(repository, "diff", "--cached", "--binary") == staged
        assert payload.read_bytes() == payload_bytes
        assert (repository / ".git/config").read_bytes() == failure_config
        report["scenarios"].append("native-ssh-signing-failure-preserves-commit-draft-and-staged-changes")
        fixtures.git(repository, "config", "--local", "user.signingkey", key)
        config = (repository / ".git/config").read_bytes()
    driver.click_visible('.commit-form button[type="submit"]')
    driver.wait(
        "return [...document.querySelectorAll('.commit-row[data-commit-oid]')].some(row => "
        f"row.textContent.includes({json.dumps(message)}))"
    )
    oid = fixtures.git(repository, "rev-parse", "HEAD")
    assert oid != parent, "The UI did not create a new commit"
    assert fixtures.git(repository, "rev-parse", "HEAD^") == parent
    commit_object = fixtures.git(repository, "cat-file", "commit", oid)
    assert f"gpgsig -----BEGIN {signature_header}-----" in commit_object, commit_object
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
        f"native-ui-creates-and-verifies-explicitly-{format_name.lower().replace('.', '')}-signed-commit"
    )
    return repo_id

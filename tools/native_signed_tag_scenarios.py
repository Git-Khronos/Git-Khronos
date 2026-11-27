"""Packaged signed-tag creation through the reviewed native UI workflow."""
import subprocess

from native_acceptance import open_ui, run
from native_x509_signing_fixture import configure_x509_signing


def _create_tag_through_ui(driver, repository, name, *, message=None, signed=False):
    repo_id = open_ui(driver, repository)
    driver.click_visible('[aria-label="Command palette"]')
    driver.wait("return !!document.querySelector('gk-command-palette input[aria-label=\"Search commands\"]')")
    driver.script(
        "const field = document.querySelector('gk-command-palette input[aria-label=\"Search commands\"]'); "
        "field.value = 'Create Tag'; field.dispatchEvent(new Event('input', {bubbles:true}));"
    )
    driver.wait(
        "return [...document.querySelectorAll('gk-command-palette [role=option] strong')] "
        ".filter(item => item.textContent.trim() === 'Create Tag').length === 1"
    )
    driver.click_visible('gk-command-palette [role=option] strong', 'Create Tag')
    driver.wait("return !!document.querySelector('.tag-creation-dialog input[name=tagName]')")
    driver.script(
        "const field = document.querySelector('.tag-creation-dialog input[name=tagName]'); "
        "field.value = arguments[0]; field.dispatchEvent(new Event('input', {bubbles:true}));",
        name,
    )
    if message is not None:
        driver.script("document.querySelector('.tag-creation-dialog input[value=annotated]').click()")
        driver.wait("return !!document.querySelector('.tag-creation-dialog textarea[name=tagMessage]')")
        driver.script(
            "const field = document.querySelector('.tag-creation-dialog textarea[name=tagMessage]'); "
            "field.value = arguments[0]; field.dispatchEvent(new Event('input', {bubbles:true}));",
            message,
        )
        if signed:
            driver.script("document.querySelector('.tag-creation-dialog input[name=signTag]').click()")
    driver.click_visible(".tag-creation-dialog button.confirm-action")
    driver.wait("return !document.querySelector('.tag-creation-dialog')")
    return repo_id


def _verify_tag(fixtures, repository, target, name, message, signature_marker=None):
    assert fixtures.git(repository, "cat-file", "-t", f"refs/tags/{name}") == "tag"
    assert fixtures.git(repository, "rev-parse", f"refs/tags/{name}^{{}}") == target
    tag_object = fixtures.git(repository, "cat-file", "tag", f"refs/tags/{name}")
    assert message in tag_object, tag_object
    if signature_marker is not None:
        assert signature_marker in tag_object, tag_object
    else:
        signature = fixtures.git(
            repository, "for-each-ref", "--format=%(contents:signature)", f"refs/tags/{name}"
        )
        assert signature.strip(), tag_object
    verify = subprocess.run(
        ["git", "-C", str(repository), "verify-tag", name],
        env=fixtures.env, capture_output=True, text=True, timeout=120,
    )
    verification_output = verify.stdout + verify.stderr
    assert verify.returncode == 0, verification_output


def signed_tag_creation(driver, fixtures, report):
    repository = fixtures.repository("signed-tag-ui-openpgp", commits=3)
    target = fixtures.git(repository, "rev-parse", "HEAD")
    gnupg_home = fixtures.env["GNUPGHOME"]
    run("gpg", "--batch", "--homedir", gnupg_home, "--pinentry-mode", "loopback",
        "--passphrase", "", "--quick-generate-key",
        "Native UI Signing <native-ui-signer@example.test>", "ed25519", "sign", "0",
        env=fixtures.env)
    key_listing = run("gpg", "--batch", "--homedir", gnupg_home, "--with-colons",
                      "--list-secret-keys", env=fixtures.env)
    fingerprint = next(
        (fields[9] for line in key_listing.splitlines()
         if (fields := line.split(":"))[0] == "fpr"),
        None,
    )
    assert fingerprint and len(fingerprint) == 40, key_listing
    for name, value in (
        ("user.signingkey", fingerprint),
        ("gpg.format", "openpgp"),
        ("tag.gpgsign", "false"),
        ("commit.gpgsign", "false"),
    ):
        fixtures.git(repository, "config", "--local", name, value)

    before = (
        fixtures.git(repository, "rev-parse", "HEAD"),
        fixtures.git(repository, "ls-files", "--stage", "-z"),
        fixtures.git(repository, "status", "--porcelain=v1", "-z"),
    )
    repo_id = _create_tag_through_ui(
        driver, repository, "v9.8.7-signed",
        message="Signed release acceptance fixture", signed=True,
    )
    _verify_tag(
        fixtures, repository, target, "v9.8.7-signed",
        "Signed release acceptance fixture", "-----BEGIN PGP SIGNATURE-----",
    )
    after = (
        fixtures.git(repository, "rev-parse", "HEAD"),
        fixtures.git(repository, "ls-files", "--stage", "-z"),
        fixtures.git(repository, "status", "--porcelain=v1", "-z"),
    )
    assert after == before, "Creating a signed tag changed commit/index/working-tree state"
    report["scenarios"].append(
        "native-ui-creates-and-verifies-configured-openpgp-signed-annotated-tag"
    )
    driver.invoke(
        "create_tag", repoId=repo_id, name="v9.8.7-lightweight", oid=target, message=None,
    )
    assert fixtures.git(repository, "cat-file", "-t", "refs/tags/v9.8.7-lightweight") == "commit"
    assert fixtures.git(repository, "rev-parse", "refs/tags/v9.8.7-lightweight") == target
    assert (
        fixtures.git(repository, "rev-parse", "HEAD"),
        fixtures.git(repository, "ls-files", "--stage", "-z"),
        fixtures.git(repository, "status", "--porcelain=v1", "-z"),
    ) == before, "Creating a lightweight tag changed commit/index/working-tree state"
    report["scenarios"].append("native-ui-creates-lightweight-tag-at-reviewed-commit")

    ssh_repository = fixtures.repository("signed-tag-ui-ssh", commits=3)
    ssh_target = fixtures.git(ssh_repository, "rev-parse", "HEAD")
    ssh_key = fixtures.root / "ssh-signing-key"
    run("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "native@example.test",
        "-f", str(ssh_key), env=fixtures.env)
    public_key = ssh_key.with_suffix(".pub").read_text(encoding="utf-8").split()
    allowed_signers = fixtures.root / "allowed-signers"
    allowed_signers.write_text(f"native@example.test {public_key[0]} {public_key[1]}\n", encoding="utf-8")
    for name, value in (
        ("user.signingkey", str(ssh_key)),
        ("gpg.format", "ssh"),
        ("gpg.ssh.allowedSignersFile", str(allowed_signers)),
        ("tag.gpgsign", "false"),
        ("commit.gpgsign", "false"),
    ):
        fixtures.git(ssh_repository, "config", "--local", name, value)
    ssh_before = (
        fixtures.git(ssh_repository, "rev-parse", "HEAD"),
        fixtures.git(ssh_repository, "ls-files", "--stage", "-z"),
        fixtures.git(ssh_repository, "status", "--porcelain=v1", "-z"),
    )
    ssh_repo_id = open_ui(driver, ssh_repository)
    driver.invoke(
        "manage_reference", repoId=ssh_repo_id, action="signed-tag",
        name="v9.8.7-ssh-signed", expectedOid=ssh_target,
        message="SSH signed release acceptance fixture",
    )
    _verify_tag(
        fixtures, ssh_repository, ssh_target, "v9.8.7-ssh-signed",
        "SSH signed release acceptance fixture", "-----BEGIN SSH SIGNATURE-----",
    )
    ssh_after = (
        fixtures.git(ssh_repository, "rev-parse", "HEAD"),
        fixtures.git(ssh_repository, "ls-files", "--stage", "-z"),
        fixtures.git(ssh_repository, "status", "--porcelain=v1", "-z"),
    )
    assert ssh_after == ssh_before, "Creating an SSH-signed tag changed commit/index/working-tree state"
    report["scenarios"].append(
        "native-creates-and-verifies-configured-ssh-signed-annotated-tag"
    )

    x509_repository = fixtures.repository("signed-tag-ui-x509", commits=3)
    x509_target = fixtures.git(x509_repository, "rev-parse", "HEAD")
    configure_x509_signing(fixtures, x509_repository)
    x509_before = (
        fixtures.git(x509_repository, "rev-parse", "HEAD"),
        fixtures.git(x509_repository, "ls-files", "--stage", "-z"),
        fixtures.git(x509_repository, "status", "--porcelain=v1", "-z"),
    )
    x509_repo_id = open_ui(driver, x509_repository)
    driver.invoke(
        "manage_reference", repoId=x509_repo_id, action="signed-tag",
        name="v9.8.7-x509-signed", expectedOid=x509_target,
        message="X509 signed release acceptance fixture",
    )
    _verify_tag(
        fixtures, x509_repository, x509_target, "v9.8.7-x509-signed",
        "X509 signed release acceptance fixture",
    )
    x509_after = (
        fixtures.git(x509_repository, "rev-parse", "HEAD"),
        fixtures.git(x509_repository, "ls-files", "--stage", "-z"),
        fixtures.git(x509_repository, "status", "--porcelain=v1", "-z"),
    )
    assert x509_after == x509_before, "Creating an X.509-signed tag changed commit/index/working-tree state"
    report["scenarios"].append(
        "native-creates-and-verifies-configured-x509-signed-annotated-tag"
    )
    return x509_repository, x509_repo_id

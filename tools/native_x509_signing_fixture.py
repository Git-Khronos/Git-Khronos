"""Isolated X.509 signing configuration for packaged acceptance fixtures."""
from datetime import datetime, timedelta, timezone
import shlex

from native_acceptance import run


def configure_x509_signing(fixtures, repository):
    gnupg_home = fixtures.env["GNUPGHOME"]
    config = fixtures.root / "x509-fixture-parameters"
    certificate = fixtures.root / "x509-fixture-certificate.der"
    expiration = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    config.write_text(
        "Key-Type: RSA\nKey-Length: 2048\nKey-Usage: sign\n"
        "Name-DN: CN=Native UI X509 Fixture\nName-Email: native@example.test\n"
        f"Serial: random\nNot-After: {expiration}\n%commit\n",
        encoding="utf-8",
    )
    # Generate inside the owned agent and import only the public certificate.
    # Jammy's legacy PKCS#12 decryption intermittently rejected the generated
    # envelope before any Git signing operation had started.
    run(
        "gpgsm", "--no-options", "--homedir", gnupg_home, "--batch", "--no-tty",
        "--pinentry-mode", "loopback", "--passphrase", "", "--output", str(certificate),
        "--gen-key", str(config), env=fixtures.env,
    )
    run(
        "gpgsm", "--no-options", "--homedir", gnupg_home, "--batch", "--no-tty",
        "--disable-dirmngr", "--disable-crl-checks", "--import", str(certificate), env=fixtures.env,
    )
    certificate_listing = run(
        "gpgsm", "--no-options", "--homedir", gnupg_home, "--with-colons",
        "--list-secret-keys", env=fixtures.env,
    )
    fingerprint = next(
        (fields[9] for line in certificate_listing.splitlines()
         if (fields := line.split(":"))[0] == "fpr"),
        None,
    )
    assert fingerprint and len(fingerprint) == 40, certificate_listing
    (fixtures.root / "gnupghome" / "trustlist.txt").write_text(
        f"{fingerprint} S\n", encoding="utf-8",
    )
    run("gpgconf", "--homedir", gnupg_home, "--reload", "gpg-agent", env=fixtures.env)
    x509_signer = fixtures.root / "x509-gpgsm-signer"
    x509_signer.write_text(
        "#!/bin/sh\nexec gpgsm --no-options --homedir " + shlex.quote(gnupg_home)
        + ' --batch --no-tty --pinentry-mode loopback --disable-dirmngr '
        + '--disable-crl-checks "$@"\n',
        encoding="utf-8",
    )
    x509_signer.chmod(0o700)
    for name, value in (
        ("user.signingkey", fingerprint),
        ("gpg.format", "x509"),
        ("gpg.x509.program", str(x509_signer)),
        ("tag.gpgsign", "false"),
        ("commit.gpgsign", "false"),
    ):
        fixtures.git(repository, "config", "--local", name, value)

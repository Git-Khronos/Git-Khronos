"""Isolated X.509 signing configuration for packaged acceptance fixtures."""
import shlex

from native_acceptance import run


def configure_x509_signing(fixtures, repository):
    gnupg_home = fixtures.env["GNUPGHOME"]
    private_key = fixtures.root / "x509-fixture-private.pem"
    certificate = fixtures.root / "x509-fixture-certificate.pem"
    container = fixtures.root / "x509-fixture-certificate.p12"
    run(
        "openssl", "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-days", "2", "-subj", "/CN=Native UI X509 Fixture/emailAddress=native@example.test",
        "-addext", "keyUsage=critical,digitalSignature", "-addext",
        "extendedKeyUsage=emailProtection", "-keyout", str(private_key),
        "-out", str(certificate), env=fixtures.env,
    )
    run(
        # OpenSSL 3's default PBES2 envelope is not accepted by Jammy's
        # gpgsm. This throwaway transport file does not set the signature's
        # algorithm or change how production keys are handled.
        "openssl", "pkcs12", "-export", "-keypbe", "PBE-SHA1-3DES",
        "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1", "-passout", "pass:", "-inkey", str(private_key),
        "-in", str(certificate), "-out", str(container), env=fixtures.env,
    )
    run(
        "gpgsm", "--no-options", "--homedir", gnupg_home, "--batch", "--no-tty",
        "--pinentry-mode", "loopback", "--passphrase", "", "--disable-dirmngr",
        "--disable-crl-checks", "--import", str(container), env=fixtures.env,
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

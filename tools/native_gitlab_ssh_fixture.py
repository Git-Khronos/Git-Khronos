"""Owned loopback OpenSSH transport; private keys/trust and read-only Git mapping."""
import json
import os
from pathlib import Path
import pwd
import shlex
import shutil
import socket
import subprocess
import sys
import time

VIRTUAL_REPOSITORY = "/team/subgroup/owned-project.git"


def accepted_upload(command):
    try:
        return shlex.split(command) == ["git-upload-pack", VIRTUAL_REPOSITORY]
    except ValueError:
        return False


def serve_upload(repository, journal, git):
    accepted = accepted_upload(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    with open(journal, "a", encoding="utf-8") as output:
        output.write(json.dumps({"uploadPack": accepted}) + "\n")
    if not accepted:
        return 126
    # The command and repository are fixture-owned, never supplied by the peer.
    return subprocess.call([git, "-c", "safe.bareRepository=all", "upload-pack", repository],
                           env={"PATH": os.defpath, "GIT_CONFIG_GLOBAL": "/dev/null",
                                "GIT_CONFIG_NOSYSTEM": "1", "GIT_NO_LAZY_FETCH": "1",
                                **({"GIT_PROTOCOL": os.environ["GIT_PROTOCOL"]} if "GIT_PROTOCOL" in os.environ else {})})


def sshd_helpers(sshd):
    helpers = sshd.parent.parent / "lib/openssh"
    return helpers / "sshd-session", helpers / "sshd-auth"


def sshd_helper_config(sshd):
    session, auth = sshd_helpers(sshd)
    if session.is_file() and auth.is_file():
        return f"SshdSessionPath {json.dumps(str(session))}\nSshdAuthPath {json.dumps(str(auth))}\n"
    return ""


def resolve_sshd():
    sshd = Path(os.environ.get("GIT_KHRONOS_SSHD", "/usr/sbin/sshd"))
    if not sshd.is_absolute() or not sshd.is_file() or not os.access(sshd, os.X_OK):
        raise RuntimeError(
            "Native GitLab acceptance needs an executable OpenSSH server. "
            "Install openssh-server or set GIT_KHRONOS_SSHD to an absolute path "
            "to an extracted sshd. The gitlab-fork-ui suite does not require SSH."
        )
    return sshd


def preflight_sshd(env):
    """Detect incomplete private prefixes before spending time in the webview."""
    sshd = resolve_sshd()
    helpers = sshd_helpers(sshd)
    selected = helpers if any(path.exists() for path in helpers) else ()
    for executable in (sshd, *selected):
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise RuntimeError(
                f"OpenSSH fixture helper {executable.name} is missing or not executable. "
                "Keep both helpers from the same package in the extracted prefix."
            )
        try:
            probe = subprocess.run([str(executable), "-V"], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env=env | {"LC_ALL": "C"}, timeout=5, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeError(f"Could not start OpenSSH fixture executable {executable.name}.") from error
        # Some OpenSSH releases reject -V. Only diagnose a loader error here;
        # the fixture's later sshd -t invocation validates the actual config.
        if probe.returncode and b"error while loading shared libraries:" in probe.stderr:
            raise RuntimeError(
                f"OpenSSH fixture executable {executable.name} could not load its shared libraries. "
                "Use a prepared test image or supply the extracted package dependencies. "
                "For HTTPS-only fork UI coverage, use gitlab-fork-ui."
            )


def start_gitlab_ssh(fixtures, gate, children, report):
    sshd = resolve_sshd()
    real_ssh = shutil.which("ssh", path=fixtures.env["PATH"])
    git = shutil.which("git", path=fixtures.env["PATH"])
    if not real_ssh or not git:
        raise RuntimeError("Native GitLab SSH acceptance requires ssh and git")
    directory = gate / "ssh"
    directory.mkdir(mode=0o700)
    login = pwd.getpwuid(os.geteuid()).pw_name
    for name in ("host", "client"):
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(directory / name)],
                       env=fixtures.env, stdin=subprocess.DEVNULL, check=True)
    (directory / "authorized_keys").write_bytes((directory / "client.pub").read_bytes())
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    journal = directory / "uploads.jsonl"
    repository = gate / "git-http-root/team/subgroup/owned-project.git"
    forced = shlex.join([sys.executable, str(Path(__file__).resolve()), "serve", str(repository), str(journal), git])
    quoted = lambda path: json.dumps(str(path))
    config = (f"ListenAddress 127.0.0.1\nPort {port}\n"
              f"HostKey {quoted(directory / 'host')}\nAuthorizedKeysFile {quoted(directory / 'authorized_keys')}\n"
              f"AllowUsers {login}\nPidFile none\nUsePAM no\nStrictModes no\n"
              "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\n"
              "AllowAgentForwarding no\nAllowTcpForwarding no\nX11Forwarding no\nPermitTTY no\n"
              "PermitUserEnvironment no\nAcceptEnv GIT_PROTOCOL\n" + f"ForceCommand {forced}\n"
              + sshd_helper_config(sshd))
    (directory / "sshd_config").write_text(config)
    subprocess.run([str(sshd), "-t", "-f", str(directory / "sshd_config")],
                   env=fixtures.env, stdin=subprocess.DEVNULL, check=True)
    with (directory / "server.log").open("wb") as log:
        process = subprocess.Popen([str(sshd), "-D", "-e", "-f", str(directory / "sshd_config")],
                                   env=fixtures.env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=log, start_new_session=True)
    children.append(process)
    deadline = time.monotonic() + 10
    while "Server listening" not in (directory / "server.log").read_text():
        if process.poll() is not None or time.monotonic() >= deadline:
            detail = (directory / "server.log").read_text(errors="replace").strip()
            raise RuntimeError(f"Owned loopback sshd did not become ready: {detail}")
        time.sleep(.02)
    key = " ".join((directory / "host.pub").read_text().split()[:2])
    (directory / "known_hosts").write_text(f"[127.0.0.1]:{port} {key}\n")
    (directory / "ssh_config").write_text(
        f"UserKnownHostsFile {quoted(directory / 'known_hosts')}\nGlobalKnownHostsFile /dev/null\n"
        f"IdentityFile {quoted(directory / 'client')}\nIdentitiesOnly yes\nIdentityAgent none\n"
        "StrictHostKeyChecking yes\nUpdateHostKeys no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n")
    binary = directory / "bin"
    binary.mkdir(mode=0o700)
    wrapper = binary / "ssh"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(real_ssh) + " -F "
                       + shlex.quote(str(directory / "ssh_config")) + ' "$@"\n')
    wrapper.chmod(0o700)
    fixtures.gitlab_ssh_url = f"ssh://{login}@127.0.0.1:{port}{VIRTUAL_REPOSITORY}"
    fixtures.gitlab_ssh_journal = journal
    report["gitlabSshFixture"] = {"origin": f"127.0.0.1:{port}", "trust": "private-pinned-known-hosts",
                                   "agent": False, "readOnlyForcedCommand": True}
    return {"PATH": str(binary) + os.pathsep + fixtures.env["PATH"]}


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[1] != "serve":
        raise SystemExit(126)
    raise SystemExit(serve_upload(*sys.argv[2:]))

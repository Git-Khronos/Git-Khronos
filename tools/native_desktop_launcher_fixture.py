"""Own the Linux opener for acceptance without launching a real desktop application."""
import shlex


def desktop_launcher_paths(fixtures):
    return (fixtures.root / 'desktop-launch-arguments', fixtures.root / 'desktop-launch-refuse')


def desktop_launcher_environment(fixtures):
    capture, refusal = desktop_launcher_paths(fixtures)
    binary_dir = fixtures.root / 'desktop-launcher-bin'
    binary_dir.mkdir()
    opener = binary_dir / 'xdg-open'
    opener.write_text(
        '#!/bin/sh\n'
        f'printf \'%s\\0\' "$@" >> {shlex.quote(str(capture))}\n'
        f'[ ! -f {shlex.quote(str(refusal))} ]\n'
    )
    opener.chmod(0o700)
    return {'PATH': str(binary_dir) + ':' + fixtures.env['PATH']}

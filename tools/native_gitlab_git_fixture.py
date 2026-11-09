"""Private Git HTTPS profile for the owned fixture; no host credentials or trust."""
import json
import shlex


def prepare_git_https(fixtures, gate, source):
    bare = gate / "git-http-root/team/subgroup/owned-project.git"
    bare.parent.mkdir(mode=0o700, parents=True)
    fixtures.git(fixtures.root, "clone", "--bare", str(source), str(bare))
    helper = gate / "git-credential-helper"
    helper.write_text('#!/bin/sh\nif [ "$1" = get ]; then\n'
                      '  printf "username=owned-git-reader\\npassword=owned-git-credential\\n\\n"\nfi\n')
    helper.chmod(0o700)
    # The helper and CA are private fixture files. Git receives its own distinct
    # synthetic credential, and still verifies the HTTPS certificate normally.
    profile = ('[protocol "https"]\nallow = always\n[protocol "ssh"]\nallow = never\n'
               '[http]\nproxy =\nsslCAInfo = ' + json.dumps(str(gate / "certificate.pem"), ensure_ascii=False)
               + '\n[credential]\nhelper =\nhelper = ' + json.dumps(shlex.quote(str(helper)), ensure_ascii=False) + '\n')
    return profile.encode()

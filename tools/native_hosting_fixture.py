"""Owned, offline gh-api fixture for packaged acceptance. Never forwards requests."""
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs, urlsplit


def response(endpoint, config):
    parsed = urlsplit(endpoint)
    prefix = "repos/" + config["repository"]
    if not parsed.path.startswith(prefix + "/"):
        raise ValueError("Unowned repository request")
    route = parsed.path[len(prefix):]
    query = parse_qs(parsed.query)
    page = int(query.get("page", ["1"])[0])
    oid = config["oid"]
    if page < 1:
        raise ValueError("Invalid page")
    if route in ("/pulls", "/issues"):
        state = query.get("state", ["open"])[0]
        return [{"number": page, "title": f"Owned hosted page {page}", "state": state,
                 "head": {"sha": oid, "ref": "feature"}, "user": {"login": "owned-author"}}]
    if route == "/actions/runs":
        return {"workflow_runs": [{"id": page, "display_title": "Owned workflow", "status": "completed", "conclusion": "failure", "head_sha": oid}]}
    if route == "/pulls/1":
        return {"head": {"sha": oid, "ref": "feature"}, "base": {"ref": "main"}, "changed_files": 51}
    if route == "/pulls/1/files":
        return [{"filename": "owned.txt" if page == 1 else "second.txt", "status": "modified", "additions": 1, "deletions": 0, "patch": "@@ -1 +1 @@\n-old\n+owned"}]
    if route == "/pulls/1/reviews":
        return [{"user": {"login": "owned-reviewer"}, "state": "APPROVED", "commit_id": oid, "submitted_at": "2026-01-01T00:00:00Z"}]
    if route == f"/commits/{oid}/check-runs":
        if config.get("partial"):
            raise PermissionError("Owned private diagnostic must stay hidden")
        return {"check_runs": [{"name": "owned-test", "status": "completed", "conclusion": "success"}]}
    if route == f"/commits/{oid}/status":
        return {"state": "failure", "statuses": [{"context": "owned-legacy-ci", "state": "failure", "description": "Owned status failure"}]}
    raise ValueError("Unsupported owned fixture endpoint")


def main(argv):
    prefix = ["api", "--hostname", "github.com", "--method", "GET", "-H", "Accept: application/vnd.github+json"]
    if len(argv) != 8 or argv[:7] != prefix:
        raise ValueError("Only an explicit read request is allowed")
    gate = Path(os.environ["KHRONOS_NATIVE_HOSTING_GATE"])
    config = json.loads((gate / "config.json").read_text())
    with (gate / "requests.jsonl").open("a") as output:
        output.write(json.dumps({"endpoint": argv[7], "cwd": os.getcwd(), "method": "GET"}) + "\n")
    (gate / "started").write_text(str(os.getpid()))
    while (gate / "hold").exists():
        time.sleep(.02)
    print(json.dumps(response(argv[7], config)))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

"""Owned, offline gh-api fixture for packaged acceptance. Never forwards requests."""
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs, unquote, urlsplit


def discovery_repository(config):
    full_name = config["repository"]
    owner, name = full_name.split("/")
    return {"id": config.get("repositoryId", 9007199254740993), "full_name": full_name,
            "name": name, "owner": {"id": 701, "login": owner},
            "html_url": "https://github.com/" + full_name,
            "clone_url": "https://github.com/" + full_name + ".git",
            "ssh_url": "git@github.com:" + full_name + ".git", "description": "Owned discovery fixture",
            "default_branch": "main", "private": True, "archived": False, "disabled": False,
            "fork": False, "permissions": {"pull": True, "push": False},
            "temp_clone_token": "owned-private-field-not-for-renderer"}


def fork_repository(config):
    owner = config.get("forkOwner", config.get("actor", "owned-author"))
    name = config.get("forkName", "owned-fork")
    repository = discovery_repository(config | {"repository": owner + "/" + name,
                                                "repositoryId": config.get("forkId", 9007199254740995)})
    repository.update(fork=True, owner={"id": config.get("forkOwnerId", 501), "login": owner},
                      parent={"id": config.get("repositoryId", 9007199254740993), "full_name": config["repository"]},
                      source={"id": config.get("repositoryId", 9007199254740993), "full_name": config["repository"]})
    return repository


def response(endpoint, config, state=None):
    if endpoint == "user" and (config.get("allowWrites") or config.get("allowDiscovery") or config.get("allowForks")):
        return {"login": acting_account(config), "id": acting_account_id(config)}
    parsed = urlsplit(endpoint)
    prefix = "repos/" + config["repository"]
    source_prefix = "repos/" + config.get("sourceRepository", config["repository"])
    if config.get("allowForks"):
        if parsed.path == "users/" + config.get("forkOwner", config.get("actor", "owned-author")):
            return {"login": parsed.path.removeprefix("users/"), "id": config.get("forkOwnerId", 501),
                    "type": config.get("forkOwnerType", "User")}
        if parsed.path == prefix:
            return discovery_repository(config) | {"allow_forking": True}
        if parsed.path == prefix + "/forks":
            query = parse_qs(parsed.query)
            if query.get("per_page") != ["50"] or int(query.get("page", ["0"])[0]) < 1:
                raise ValueError("Unbounded owned fork page")
            return [fork_repository(config)] if query["page"] == ["1"] else []
        fork_prefix = "repos/" + fork_repository(config)["full_name"]
        if parsed.path == fork_prefix:
            if not (state or {}).get("forks") or config.get("forkPending"):
                raise PermissionError("Owned fork is pending")
            return fork_repository(config)
        if parsed.path == fork_prefix + "/git/ref/heads/main":
            if not (state or {}).get("forks") or config.get("forkObjectsPending"):
                raise PermissionError("Owned fork objects are pending")
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": config["oid"]}}
        if parsed.path == fork_prefix + "/git/commits/" + config["oid"]:
            if not (state or {}).get("forks") or config.get("forkObjectsPending"):
                raise PermissionError("Owned fork objects are pending")
            return {"sha": config["oid"], "tree": {"sha": config.get("treeOid", "b" * 40)}}
    if config.get("allowDiscovery"):
        if parsed.path == "user/repos":
            query = parse_qs(parsed.query)
            if query.get("per_page") != ["50"] or int(query.get("page", ["0"])[0]) < 1:
                raise ValueError("Unbounded or invalid owned catalogue page")
            return [discovery_repository(config)] if query["page"] == ["1"] else []
        if parsed.path == prefix:
            return discovery_repository(config)
    if config.get("allowWrites") and parsed.path.startswith(prefix + "/branches/") and unquote(parsed.path[len(prefix + "/branches/"):]) == config.get("baseBranch", "main"):
        return {"name": config.get("baseBranch", "main"), "commit": {"sha": config.get("baseOid", config["oid"])}}
    if config.get("allowWrites") and parsed.path.startswith(source_prefix + "/branches/"):
        branch = unquote(parsed.path[len(source_prefix + "/branches/"):])
        if branch != config.get("headBranch", "feature"):
            raise ValueError("Unowned source branch")
        return {"name": branch, "commit": {"sha": config["oid"]}}
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
        return pull_record(config, 1)
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


def acting_account(config):
    # This is a dummy fixture token, never a real credential.
    token = os.environ.get("GH_TOKEN", "")
    return token.removeprefix("owned-token-") if token.startswith("owned-token-") else config.get("actor", "owned-author")


def acting_account_id(config):
    actor = acting_account(config)
    return config.get("actorIds", {}).get(actor, 501 if actor == "owned-author" else 502)


def pull_record(config, number):
    author = {"login": config.get("pullAuthor", "owned-request-author"), "id": 503} if number == 1 else {"login": acting_account(config), "id": acting_account_id(config)}
    return {"number": number, "state": "open", "merged": False, "draft": False,
            "mergeable": True, "user": author,
            "head": {"sha": config["oid"], "ref": config.get("headBranch", "feature"),
                     "repo": {"full_name": config.get("sourceRepository", config["repository"])}},
            "base": {"sha": config.get("baseOid", config["oid"]), "ref": config.get("baseBranch", "main"),
                     "repo": {"full_name": config["repository"]}}, "changed_files": 51}


def write_response(method, endpoint, payload, config, state):
    if config.get("allowForks") and method == "POST" and endpoint == "repos/" + config["repository"] + "/forks":
        expected = {"name": config.get("forkName", "owned-fork"),
                    "default_branch_only": config.get("forkDefaultBranchOnly", True)}
        if config.get("forkOwnerType") == "Organization":
            expected["organization"] = config["forkOwner"]
        if payload != expected:
            raise ValueError("Unexpected owned fork request")
        state.setdefault("forks", []).append(payload)
        return fork_repository(config)
    if not config.get("allowWrites"):
        raise ValueError("Writes are disabled for this owned fixture")
    if config.get("denyBeforeWrite"):
        raise PermissionError("Owned private provider refusal before write")
    prefix = "repos/" + config["repository"] + "/pulls"
    if method == "POST" and endpoint == prefix:
        source_owner, source_name = config.get("sourceRepository", config["repository"]).split("/")
        if payload.get("head") != source_owner + ":" + config.get("headBranch", "feature") or payload.get("head_repo") != source_name or payload.get("base") != config.get("baseBranch", "main"):
            raise ValueError("Unexpected owned pull request branches")
        result = pull_record(config, 100 + len(state.get("created", [])))
        result.update(title=payload["title"], body=payload["body"], draft=payload["draft"])
        state.setdefault("created", []).append(result)
        return result
    if method == "POST" and endpoint == prefix + "/1/reviews":
        event = payload.get("event")
        if payload.get("commit_id") != config["oid"] or event not in ("APPROVE", "REQUEST_CHANGES", "COMMENT"):
            raise ValueError("Unexpected owned review head or action")
        result = {"id": 200 + len(state.get("reviews", [])), "user": {"login": acting_account(config), "id": acting_account_id(config)},
                  "commit_id": payload["commit_id"], "body": payload["body"],
                  "state": {"APPROVE": "APPROVED", "REQUEST_CHANGES": "CHANGES_REQUESTED", "COMMENT": "COMMENTED"}[event]}
        state.setdefault("reviews", []).append(result)
        return result
    if method == "PUT" and endpoint == prefix + "/1/merge":
        if payload.get("sha") != config["oid"] or payload.get("merge_method") not in ("merge", "squash", "rebase"):
            raise ValueError("Unexpected owned merge precondition")
        state.setdefault("merges", []).append(payload)
        return {"merged": True, "sha": config.get("mergeOid", "c" * 40)}
    raise ValueError("Unowned write endpoint or method")


def main(argv):
    gate = Path(os.environ["KHRONOS_NATIVE_HOSTING_GATE"])
    config = json.loads((gate / "config.json").read_text())
    if argv == ["auth", "token", "--hostname", "github.com"]:
        if not (config.get("allowWrites") or config.get("allowDiscovery") or config.get("allowForks")):
            raise ValueError("Fixture authentication is disabled")
        print("owned-token-" + config.get("actor", "owned-author"))
        return
    if len(argv) not in (8, 10) or argv[:4] != ["api", "--hostname", "github.com", "--method"] or argv[5:7] != ["-H", "Accept: application/vnd.github+json"]:
        raise ValueError("Only an explicit owned API request is allowed")
    method, endpoint = argv[4], argv[7]
    writing = method in ("POST", "PUT") and len(argv) == 10 and argv[8:] == ["--input", "-"] and (config.get("allowWrites") or config.get("allowForks"))
    if not writing and (method != "GET" or len(argv) != 8):
        raise ValueError("Unowned write request")
    payload = None
    if writing:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Owned fixture payload limit exceeded")
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Owned fixture requires an object body")
    with (gate / "requests.jsonl").open("a") as output:
        output.write(json.dumps({"endpoint": endpoint, "cwd": os.getcwd(), "method": method,
                                 "payload": payload, "actor": acting_account(config), "pid": os.getpid()}) + "\n")
    (gate / "started").write_text(str(os.getpid()))
    while (gate / "hold").exists() and (writing or not config.get("holdWritesOnly")):
        time.sleep(.02)
    if writing:
        state_path = gate / "write-state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        result = write_response(method, endpoint, payload, config, state)
        state_path.write_text(json.dumps(state))
        if config.get("uncertainAfterWrite"):
            raise OSError("Owned private diagnostic after applied write")
    else:
        state_path = gate / "write-state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        result = response(endpoint, config, state)
        if config.get("flipActorAfterBaseRead") and endpoint.endswith("/branches/" + config.get("baseBranch", "main")):
            config["actor"] = "owned-other-account"
            config.pop("flipActorAfterBaseRead")
            (gate / "config.json").write_text(json.dumps(config))
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

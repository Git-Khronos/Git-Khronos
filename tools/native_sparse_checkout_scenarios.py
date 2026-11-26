"""Verify the sparse-checkout toolbar against a real, isolated Git repository."""


def disable_sparse_checkout(driver, fixtures, report):
    from native_acceptance import open_ui

    repository = fixtures.repository("owned-sparse-checkout", commits=2)
    included = repository / "included" / "one.txt"
    excluded = repository / "excluded" / "two.txt"
    for path in (included, excluded):
        path.parent.mkdir()
        path.write_text(f"{path.name} original contents\n")
    fixtures.git(repository, "add", "--", "included", "excluded")
    fixtures.git(repository, "commit", "-qm", "Record two directories")
    fixtures.git(repository, "sparse-checkout", "set", "--cone", "--sparse-index", "included")
    included.write_text("Preserve this unstaged edit\n")

    def read_git(*args):
        return fixtures.git(repository, "--no-optional-locks", *args)

    def content_state():
        return {
            "head": read_git("rev-parse", "HEAD"),
            "index": read_git("ls-files", "--stage", "-z"),
            "status": read_git("status", "--porcelain=v1", "-z"),
            "included": included.read_bytes(),
        }

    def sparse_state():
        return (
            read_git("config", "--bool", "core.sparseCheckout"),
            read_git("ls-files", "--sparse", "-t"),
            read_git("sparse-checkout", "list"),
        )

    original = content_state()
    sparse = sparse_state()
    assert sparse[0] == "true" and "S excluded/" in sparse[1] and sparse[2] == "included"
    assert not excluded.exists()

    driver.request("POST", driver.path("window/rect"), {"width": 1440, "height": 900})
    repo_id = open_ui(driver, repository)
    toggle = '[aria-label="Sparse checkout options"]'
    menu = "#sparse-checkout-options-menu"
    dialog = '[aria-labelledby="sparse-checkout-title"]'

    def review():
        driver.click_visible(toggle)
        driver.wait(f"""const menu = document.querySelector({menu!r});
          return document.querySelectorAll('.sparse-menu').length === 1
            && menu?.textContent.includes('1 selected directory')
            && menu.textContent.includes('sparse index');""")
        driver.click_scrolled_text(menu + " [role=menuitem] strong", "Disable sparse checkout", wait_for_ready=True)
        driver.wait(f"""return document.querySelector({(dialog + ' h2')!r})?.textContent.trim()
          === 'Restore the complete working tree?';""")
        assert content_state() == original and sparse_state() == sparse
        assert not excluded.exists()

    review()
    driver.click_scrolled_text(dialog + " button", "Cancel", wait_for_ready=True)
    driver.wait(f"""return !document.querySelector({dialog!r})
      && document.activeElement?.matches({toggle!r});""")
    assert content_state() == original and sparse_state() == sparse
    assert not excluded.exists()
    report["scenarios"].append("native-sparse-disable-preview-and-cancel-preserve-working-tree")

    review()
    driver.click_scrolled_text(dialog + " button", "Restore All Files", wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r}) && !document.querySelector({toggle!r});", 60)
    assert read_git("config", "--bool", "core.sparseCheckout") == "false"
    assert excluded.read_text() == "two.txt original contents\n"
    assert content_state() == original
    report["scenarios"].append("native-sparse-disable-restores-excluded-files-and-keeps-local-edit")
    return repository, repo_id

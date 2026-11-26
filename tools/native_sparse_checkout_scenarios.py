"""Verify the sparse-checkout toolbar against a real, isolated Git repository."""


def sparse_checkout_workflow(driver, fixtures, report):
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
    search = 'gk-command-palette input[aria-label="Search commands"]'
    editor = 'textarea[aria-label="Sparse checkout directories"]'
    preferences = '#preference-sparse-checkout'
    apply = dialog + ' button'
    root_file = (repository / "fixture.txt").read_bytes()

    def review_selection():
        driver.key('p', modifiers=('\ue009',))
        driver.wait(f"return document.activeElement?.matches({search!r});")
        driver.script("""const input = document.activeElement;
          input.value = 'Configure Sparse Checkout';
          input.dispatchEvent(new Event('input', {bubbles: true}));""")
        driver.click_scrolled_text('gk-command-palette [role=option] strong',
                                   'Configure Sparse Checkout', wait_for_ready=True)
        driver.wait(f"return document.querySelector({editor!r})?.getClientRects().length > 0;")
        driver.script("""const input = document.querySelector(arguments[0]);
          input.value = '  included  ';
          input.dispatchEvent(new Event('input', {bubbles: true}));
          const checkbox = input.closest('.preference-group').querySelector('input[type=checkbox]');
          if (checkbox.checked) checkbox.click();""", editor)
        driver.click_scrolled_text(preferences + ' button', 'Enable Sparse Checkout', wait_for_ready=True)
        driver.wait(f"""const review = document.querySelector({dialog!r});
          return review?.querySelector('h2')?.textContent.trim() === 'Apply this directory selection?'
            && document.activeElement?.textContent.trim() === 'Cancel';""")
        scope = driver.script("""const review = document.querySelector(arguments[0]);
          return {
            directories: [...review.querySelectorAll('ul[aria-label="Selected directories"] li')]
              .map(item => item.textContent.trim()),
            index: review.querySelector('.sparse-index-review')?.textContent.trim() ?? null,
          };""", dialog)
        assert scope == {"directories": ["included"], "index": "Index: Full"}, scope

    def assert_full_checkout():
        assert read_git("config", "--bool", "core.sparseCheckout") == "false"
        assert excluded.read_text() == "two.txt original contents\n"
        assert content_state() == original
        assert (repository / "fixture.txt").read_bytes() == root_file

    review_selection()
    assert_full_checkout()
    driver.click_scrolled_text(apply, 'Cancel', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r});")
    assert_full_checkout()
    report["scenarios"].append("native-sparse-selection-shows-exact-directory-and-index-and-cancels-without-writes")

    review_selection()
    driver.click_scrolled_text(apply, 'Apply Selection', wait_for_ready=True)
    driver.wait(f"return !document.querySelector({dialog!r}) && document.querySelector({toggle!r})?.getClientRects().length > 0;", 60)
    driver.click_visible(toggle)
    driver.wait(f"return document.querySelector({menu!r})?.textContent.includes('full index');")
    enabled, entries, directories = sparse_state()
    assert enabled == "true" and directories == "included"
    assert "S excluded/two.txt" in entries
    assert not excluded.exists()
    assert content_state() == original
    assert (repository / "fixture.txt").read_bytes() == root_file
    report["scenarios"].append("native-sparse-selection-applies-reviewed-full-index-and-preserves-local-edits")
    reapply = "Reapply sparse checkout"
    excluded.parent.mkdir(exist_ok=True)
    edited = b"Keep this out-of-cone local edit.\n"
    excluded.write_bytes(edited)
    driver.click_scrolled_text(menu + " [role=menuitem] strong", reapply, wait_for_ready=True)
    driver.wait("""return [...document.querySelectorAll('[role="alert"]')].some(alert =>
      alert.textContent.includes('excluded/two.txt') && alert.textContent.includes('Nothing was deleted.'));""")
    assert excluded.read_bytes() == edited
    assert read_git("rev-parse", "HEAD") == original["head"]
    assert read_git("ls-files", "--stage", "-z") == original["index"]
    assert included.read_bytes() == original["included"]
    report["scenarios"].append("native-sparse-reapply-discloses-out-of-cone-edit-and-keeps-file")

    # Repair only our owned, deliberately materialized file. Refresh Git's
    # stat cache so it can recognize the now-clean file during Reapply.
    excluded.write_text("two.txt original contents\n")
    fixtures.git(repository, "status", "--porcelain=v1")
    driver.click_visible(toggle)
    driver.click_scrolled_text(menu + " [role=menuitem] strong", reapply, wait_for_ready=True)
    driver.wait("""return document.querySelector('.activity-status')?.textContent.includes('Sparse checkout reapplied');""")
    assert not excluded.exists()
    assert sparse_state() == (enabled, entries, directories)
    assert content_state() == original
    report["scenarios"].append("native-sparse-reapply-removes-now-clean-excluded-file-without-changing-index-content")
    return repository, repo_id

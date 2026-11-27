"""Packaged menu keyboard fallbacks and native tab order."""
import json


def _expect_menu_tab_order(driver, toggle, menu, content, modifiers, *, focus_gap):
    driver.script("document.querySelector(arguments[0]).focus()", toggle)
    driver.key("\ue004", modifiers=modifiers)
    outside_document = driver.script("""if (document.activeElement === document.body) return !document.hasFocus();
      document.activeElement.setAttribute('data-native-menu-tab-target', '');
      return false;""")
    if not outside_document:
        assert driver.script("return document.activeElement.hasAttribute('data-native-menu-tab-target')"), \
            f"No native Tab destination for {toggle}"
    try:
        driver.click(toggle)
        driver.wait(f"return document.querySelector({json.dumps(content)})?.contains(document.activeElement)")
        if focus_gap:
            # The loader-to-content focus gap can send the key to the document.
            driver.script("document.activeElement.blur()")
            assert driver.script("return document.activeElement === document.body")
        driver.key("\ue004", modifiers=modifiers)
        driver.wait(f"return !document.querySelector({json.dumps(menu)})", 5)
        if outside_document:
            driver.wait("return document.activeElement === document.body && !document.hasFocus()", 5)
        else:
            assert driver.script("return document.activeElement.hasAttribute('data-native-menu-tab-target')"), \
                f"Tab from {menu} with focus gap {focus_gap} did not resume the normal focus order"
    finally:
        driver.script("document.querySelectorAll('[data-native-menu-tab-target]').forEach(element => element.removeAttribute('data-native-menu-tab-target'))")


def main_menu_focus_gap(driver, report):
    main = (".app-menu", ".app-menu-popover", ".app-menu-popover gk-main-menu-content")
    for modifiers in ((), ("\ue008",)):
        _expect_menu_tab_order(driver, *main, modifiers, focus_gap=True)
    report["scenarios"].append("native-main-menu-tab-resumes-focus-order-after-focus-gap")
    _expect_menu_tab_order(driver, *main, ("\ue008",), focus_gap=False)
    _expect_menu_tab_order(driver, ".workspace-toggle", ".workspace-menu", ".workspace-menu",
                           ("\ue008",), focus_gap=False)
    report["scenarios"].append("native-reverse-tab-dismisses-focused-main-and-workspace-menus")

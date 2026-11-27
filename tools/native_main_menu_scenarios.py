"""Packaged main menu keyboard fallback and native tab order."""
import json


def main_menu_focus_gap(driver, report):
    toggle = ".app-menu"
    menu = ".app-menu-popover"
    for modifiers in ((), ("\ue008",)):
        driver.script("document.querySelector(arguments[0]).focus()", toggle)
        driver.key("\ue004", modifiers=modifiers)
        outside_document = driver.script("""if (document.activeElement === document.body) return !document.hasFocus();
          document.activeElement.setAttribute('data-native-menu-tab-target', '');
          return false;""")
        if not outside_document:
            assert driver.script("return document.activeElement.hasAttribute('data-native-menu-tab-target')"), \
                "No native main menu Tab destination"
        try:
            driver.click(toggle)
            driver.wait("""return document.querySelector('.app-menu-popover gk-main-menu-content')
              ?.contains(document.activeElement)""")
            # The loader-to-content focus gap can send the key to the document.
            driver.script("document.activeElement.blur()")
            assert driver.script("return document.activeElement === document.body")
            driver.key("\ue004", modifiers=modifiers)
            driver.wait(f"return !document.querySelector({json.dumps(menu)})", 5)
            if outside_document:
                driver.wait("return document.activeElement === document.body && !document.hasFocus()", 5)
            else:
                assert driver.script("return document.activeElement.hasAttribute('data-native-menu-tab-target')"), \
                    "Tab after main menu focus loss did not resume the normal focus order"
        finally:
            driver.script("document.querySelectorAll('[data-native-menu-tab-target]').forEach(element => element.removeAttribute('data-native-menu-tab-target'))")
    report["scenarios"].append("native-main-menu-tab-resumes-focus-order-after-focus-gap")

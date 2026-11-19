"""Classify explicit WebDriver refusals, never uncertain transport outcomes."""
import json


def stale_element_refusal(error):
    if not isinstance(error, RuntimeError):
        return False
    try:
        detail = json.loads(str(error))
    except (ValueError, TypeError):
        return False
    if isinstance(detail, dict) and isinstance(detail.get('value'), dict):
        detail = detail['value']
    return isinstance(detail, dict) and detail.get('error') == 'stale element reference'

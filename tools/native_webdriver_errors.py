"""Classify explicit WebDriver refusals, never uncertain transport outcomes."""
import json


def error_detail(error):
    if not isinstance(error, RuntimeError):
        return {}
    try:
        detail = json.loads(str(error))
    except (ValueError, TypeError):
        return {}
    if isinstance(detail, dict) and isinstance(detail.get('value'), dict):
        detail = detail['value']
    return detail if isinstance(detail, dict) else {}


def stale_element_refusal(error):
    return error_detail(error).get('error') == 'stale element reference'


def script_result_unavailable(error):
    detail = error_detail(error)
    return detail.get('error') == 'unknown error' and detail.get('message') == 'Could not parse script result'

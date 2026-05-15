import websocket
import json
import time
import requests

WS_URL = "http://127.0.0.1:9222/json"
try:
    response = requests.get(WS_URL)
    tabs = response.json()
    # Find the active tab or the one with the Workday URL
    target_tab = next((tab for tab in tabs if tab['type'] == 'page' and 'workday' in tab['url']), None)
    if not target_tab:
        target_tab = next(tab for tab in tabs if tab['type'] == 'page')
    ws_endpoint = target_tab['webSocketDebuggerUrl']
except Exception as e:
    print(f"Error connecting to Brave CDP: {e}")
    exit(1)

ws = websocket.create_connection(ws_endpoint)

def send(method, params=None):
    msg_id = int(time.time() * 1000)
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        res = json.loads(ws.recv())
        if res.get('id') == msg_id:
            return res

def eval_js(expression):
    res = send("Runtime.evaluate", {"expression": expression, "returnByValue": True})
    if 'exceptionDetails' in res.get('result', {}):
        print(f"JS Error: {res['result']['exceptionDetails']}")
        return None
    return res.get('result', {}).get('value')

# Check Step
url = eval_js("window.location.href")
print(f"URL: {url}")

if url and ("applyManually" in url or "my-information" in url):
    errors = eval_js("Array.from(document.querySelectorAll('.wd-error-content')).map(e => e.innerText)")
    if not errors:
        eval_js("Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next') && b.offsetParent !== null)?.click()")
        print("Clicked Next on My Information")
        time.sleep(10)

# Refresh URL check
url = eval_js("window.location.href")
print(f"URL after potential transition: {url}")

# My Experience Step or check if we are there
time.sleep(5)
work_count = eval_js("document.querySelectorAll('[data-automation-id=\"workExperienceSection\"]').length")
if work_count == 0:
    print("No work experience found, checking for Re-scan")
    eval_js("Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Re-scan'))?.click()")
    time.sleep(10)

# Final Audit Data Extraction
audit_data = eval_js("""
(function() {
    return {
        url: window.location.href,
        work: Array.from(document.querySelectorAll('[data-automation-id="workExperienceSection"]')).map(s => ({
            title: s.querySelector('[data-automation-id="jobTitle"]')?.value || s.querySelector('[data-automation-id="jobTitle"]')?.innerText,
            company: s.querySelector('[data-automation-id="company"]')?.value || s.querySelector('[data-automation-id="company"]')?.innerText,
            current: s.querySelector('[data-automation-id="currentlyWorkHere"]')?.checked,
            start: s.querySelector('[data-automation-id="startDate"]')?.value,
            end: s.querySelector('[data-automation-id="endDate"]')?.value,
            description: s.querySelector('[data-automation-id="description"]')?.value
        })),
        education: Array.from(document.querySelectorAll('[data-automation-id="educationSection"]')).map(s => ({
            school: s.querySelector('[data-automation-id="school"]')?.value,
            degree: s.querySelector('[data-automation-id="degree"]')?.value,
            field: s.querySelector('[data-automation-id="fieldOfStudy"]')?.value,
            start: s.querySelector('[data-automation-id="startDate"]')?.value,
            end: s.querySelector('[data-automation-id="endDate"]')?.value
        })),
        social: Array.from(document.querySelectorAll('[data-automation-id="socialLink"]')).map(s => s.value),
        errors: Array.from(document.querySelectorAll('.wd-error-content')).map(e => e.innerText),
        overlay: {
            persistent: !!document.querySelector('#autoapply-overlay'),
            minimized: !!document.querySelector('#autoapply-overlay.minimized'),
            autoNext: !!document.querySelector('#auto-next-toggle')?.checked
        }
    };
})()
""")

print("AUDIT_RESULT:" + json.dumps(audit_data))
ws.close()

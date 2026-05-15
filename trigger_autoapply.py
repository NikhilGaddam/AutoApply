import json
import urllib.request
import websocket
import time

def main():
    try:
        with urllib.request.urlopen("http://127.0.0.1:9222/json") as response:
            pages = json.loads(response.read().decode())
        
        target_page = None
        for page in pages:
            if "greenhouse.io" in page.get("url", ""):
                target_page = page
                break
        
        if not target_page:
            print("Target Greenhouse page not found.")
            return

        ws_url = target_page['webSocketDebuggerUrl']
        ws = websocket.create_connection(ws_url)

        def send_command(method, params=None):
            msg_id = int(time.time() * 1000)
            ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            while True:
                result = json.loads(ws.recv())
                if result.get("id") == msg_id:
                    return result

        # 1. Trigger fill
        send_command("Runtime.evaluate", {
            "expression": "chrome.runtime.sendMessage({type:'autoapply.fill'}, r => { window.__aaResp = r; }); 'sent';"
        })
        
        # 2. Use CDP to "wait" by evaluating a promise that resolves after 4 seconds
        send_command("Runtime.evaluate", {
            "expression": "new Promise(resolve => setTimeout(resolve, 4000))",
            "awaitPromise": True
        })

        # 3. Audit
        audit_script = """
        (function() {
            const getVal = (id) => {
                const el = document.getElementById(id);
                return el ? (el.value || el.innerText || el.textContent) : 'not found';
            };
            const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map(cb => ({
                id: cb.id,
                checked: cb.checked,
                required: cb.required
            }));
            
            return {
                aaResp: window.__aaResp || "no response yet",
                title: document.title,
                education: {
                    school: getVal('school--0') || getVal('education_school_name_0'),
                    degree: getVal('degree--0') || getVal('education_degree_0'),
                    discipline: getVal('discipline--0') || getVal('education_discipline_0')
                },
                checkboxes: checkboxes.filter(cb => cb.required),
                url: window.location.href
            };
        })()
        """
        audit_result = send_command("Runtime.evaluate", {
            "expression": audit_script,
            "returnByValue": True
        })
        
        print(json.dumps(audit_result.get('result', {}).get('value', {}), indent=2))
        ws.close()

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()

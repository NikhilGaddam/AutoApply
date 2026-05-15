import websocket, json, time, requests, sys

def main():
    try:
        resp = requests.get('http://127.0.0.1:9222/json').json()
        target = next(t for t in resp if t['type'] == 'page' and 'proofpoint' in t['url'].lower())
        ws = websocket.create_connection(target['webSocketDebuggerUrl'])
        
        def call_cdp(method, params):
            ws.send(json.dumps({'id': 1, 'method': method, 'params': params}))
            return json.loads(ws.recv())

        def eval_js(js):
            res = call_cdp('Runtime.evaluate', {'expression': js, 'returnByValue': True, 'userGesture': True})
            if 'result' in res and 'result' in res['result']:
                return res['result']['result'].get('value')
            return None

        # Local manifest version check
        import os
        with open('extension/manifest.json', 'r') as f:
            manifest = json.load(f)
            local_version = manifest.get('version')
        
        if local_version != '0.4.3':
            print(f"FAIL: Local manifest version {local_version} != 0.4.3")
            return
        print(f"PASS: Local manifest version is {local_version}")

        # Wait for button
        found = False
        for _ in range(40):
            if eval_js('!!document.querySelector(".wd-auto-next-btn")'):
                found = True
                break
            time.sleep(1)
        if not found:
            print("FAIL: .wd-auto-next-btn not found")
            return

        # Check state. Reset to Off if needed.
        initial_text = eval_js('document.querySelector(".wd-auto-next-btn").innerText')
        if "Auto Next: On" in initial_text:
            print("Resetting to Off...")
            eval_js('document.querySelector(".wd-auto-next-btn").click()')
            time.sleep(1)

        # Verify it's Off
        btn_text = eval_js('document.querySelector(".wd-auto-next-btn").innerText')
        if "Auto Next: Off" not in btn_text:
            print(f"FAIL: Text not Off: {btn_text}")
            return
            
        print("Initial state: Off.")

        # Click 1: Off -> On
        eval_js('document.querySelector(".wd-auto-next-btn").click()')
        time.sleep(1.5)
        btn_text_on = eval_js('document.querySelector(".wd-auto-next-btn").innerText')
        data_enabled = eval_js('document.querySelector(".wd-auto-next-btn").getAttribute("data-enabled")')
        
        # Check window variable in main world
        window_var = eval_js('window.__autoApplyWorkdayAutoNext')

        if "Auto Next: On" not in btn_text_on:
             print(f"FAIL: Text didn't change to On: {btn_text_on}")
             return
        if data_enabled != "true":
             print(f"FAIL: data-enabled not true: {data_enabled}")
             return
        
        print(f"PASS: Click 1 (Off -> On) verified (Text and data-enabled). window_var={window_var}")

        # Click 2: On -> Off
        eval_js('document.querySelector(".wd-auto-next-btn").click()')
        time.sleep(1.5)
        btn_text_off = eval_js('document.querySelector(".wd-auto-next-btn").innerText')
        data_enabled_off = eval_js('document.querySelector(".wd-auto-next-btn").getAttribute("data-enabled")')
        
        if "Auto Next: Off" not in btn_text_off or data_enabled_off != "false":
            print(f"FAIL: Click 2 (On -> Off): Text='{btn_text_off}', data-enabled='{data_enabled_off}'")
            return

        print("PASS: Click 2 (On -> Off) verified.")
        print("PASS: All checks successful")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

main()

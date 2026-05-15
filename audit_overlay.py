import websocket, json, time, sys, requests

def send(ws, method, params={}):
    msg = {'id': 1, 'method': method, 'params': params}
    ws.send(json.dumps(msg))
    return json.loads(ws.recv())

try:
    resp = requests.get('http://127.0.0.1:9222/json').json()
    target = next(t for t in resp if t['type'] == 'page' and 'proofpoint' in t['url'].lower())
    ws_url = target['webSocketDebuggerUrl']
    ws = websocket.create_connection(ws_url)
    
    def eval_js(js):
        res = send(ws, 'Runtime.evaluate', {'expression': js, 'returnByValue': True})
        return res.get('result', {}).get('value')

    print('Waiting for overlay...')
    found = False
    for _ in range(30):
        if eval_js('!!document.querySelector(".autoapply-toast")'):
            found = True
            break
        time.sleep(1)
    
    if not found:
        print('FAIL: Overlay not found')
        sys.exit(1)

    with open('extension/manifest.json') as f:
        m = json.load(f)
        if m.get('version') != '0.4.2':
            print(f'FAIL: Manifest version mismatch: {m.get("version")}')
            sys.exit(1)
    print('Manifest 0.4.2 verified.')

    if not eval_js('!!document.querySelector(".autoapply-minimize")'):
        print('FAIL: .autoapply-minimize missing')
        sys.exit(1)

    eval_js('document.querySelector(".autoapply-minimize").click()')
    time.sleep(1)
    if not eval_js('document.querySelector(".autoapply-toast").classList.contains("autoapply-minimized")'):
        print('FAIL: Minimize failed')
        sys.exit(1)
    print('Minimize pass.')

    eval_js('document.querySelector(".autoapply-minimize").click()')
    time.sleep(1)
    if eval_js('document.querySelector(".autoapply-toast").classList.contains("autoapply-minimized")'):
        print('FAIL: Restore failed')
        sys.exit(1)
    print('Restore pass.')

    if eval_js('!!document.querySelector(".autoapply-primary")'):
        eval_js('document.querySelector(".autoapply-primary").click()')
        time.sleep(2)
        if not eval_js('!!document.querySelector(".autoapply-toast")'):
            print('FAIL: Toast disappeared')
            sys.exit(1)
        print('Primary click pass.')

    print("PASS: All audits successful.")
    ws.close()
except Exception as e:
    print(f"FAIL: {e}")
    sys.exit(1)

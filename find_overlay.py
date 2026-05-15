import websocket, json, time, requests, sys
try:
    resp = requests.get('http://127.0.0.1:9222/json').json()
    target = next(t for t in resp if t['type'] == 'page' and 'proofpoint' in t['url'].lower())
    ws = websocket.create_connection(target['webSocketDebuggerUrl'])
    def eval_js(js):
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}))
        return json.loads(ws.recv())['result']['result'].get('value')
    for i in range(15):
        if eval_js('!!document.querySelector(".autoapply-toast")'):
            print("PASS: Found")
            sys.exit(0)
        time.sleep(1)
    print("FAIL: Not found")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)

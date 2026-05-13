#!/usr/bin/env python3
"""Capture network requests for N seconds."""
import asyncio, json, sys, urllib.request, websockets

CDP = "http://127.0.0.1:9222"
DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0

def pick_tab(substr="workday"):
    tabs = [t for t in json.load(urllib.request.urlopen(f"{CDP}/json")) if t.get("type")=="page"]
    return [t for t in tabs if substr.lower() in t.get("url","").lower()][0]

async def main():
    tab = pick_tab()
    async with websockets.connect(tab["webSocketDebuggerUrl"], max_size=20*1024*1024) as ws:
        await ws.send(json.dumps({"id":1,"method":"Network.enable"}))
        end = asyncio.get_event_loop().time() + DURATION
        reqs = {}
        while asyncio.get_event_loop().time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - asyncio.get_event_loop().time())
            except asyncio.TimeoutError: break
            msg = json.loads(raw)
            m = msg.get("method","")
            if m == "Network.requestWillBeSent":
                p = msg["params"]
                req = p["request"]
                reqs[p["requestId"]] = (req["method"], req["url"])
                if "wd5" in req["url"] or "myworkday" in req["url"]:
                    pdata = req.get("postData","")
                    print(f"REQ {req['method']} {req['url'][:120]} body={pdata[:200]}")
            elif m == "Network.responseReceived":
                p = msg["params"]
                if p["requestId"] in reqs:
                    method, url = reqs[p["requestId"]]
                    if "wd5" in url or "myworkday" in url:
                        st = p["response"]["status"]
                        print(f"RES {st} {method} {url[:120]}")

asyncio.run(main())

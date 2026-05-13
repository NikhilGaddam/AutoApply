#!/usr/bin/env python3
"""Capture console logs for N seconds from the workday tab."""
import asyncio, json, sys, urllib.request, websockets

CDP = "http://127.0.0.1:9222"
DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0

def pick_tab(substr="workday"):
    tabs = [t for t in json.load(urllib.request.urlopen(f"{CDP}/json")) if t.get("type")=="page"]
    tabs = [t for t in tabs if substr.lower() in t.get("url","").lower()]
    return tabs[0]

async def main():
    tab = pick_tab()
    async with websockets.connect(tab["webSocketDebuggerUrl"], max_size=20*1024*1024) as ws:
        await ws.send(json.dumps({"id":1,"method":"Runtime.enable"}))
        await ws.send(json.dumps({"id":2,"method":"Log.enable"}))
        end = asyncio.get_event_loop().time() + DURATION
        while asyncio.get_event_loop().time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - asyncio.get_event_loop().time())
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            m = msg.get("method","")
            if m == "Runtime.consoleAPICalled":
                p = msg["params"]
                args = " ".join(str(a.get("value", a.get("description",""))) for a in p.get("args", []))
                print(f"[{p.get('type')}] {args}")
            elif m == "Runtime.exceptionThrown":
                ed = msg["params"]["exceptionDetails"]
                print(f"[EXCEPTION] {ed.get('text')} {ed.get('exception',{}).get('description','')}")
            elif m == "Log.entryAdded":
                e = msg["params"]["entry"]
                print(f"[{e.get('level')}] {e.get('source')}: {e.get('text')}")

asyncio.run(main())

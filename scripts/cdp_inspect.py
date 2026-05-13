#!/usr/bin/env python3
"""Read-only CDP helper. Inspect the live page; never type/click.
Usage:
  python3 scripts/cdp_inspect.py <eval-expression>
  python3 scripts/cdp_inspect.py --file path/to/snippet.js
  python3 scripts/cdp_inspect.py --reload      # reload the active page tab
  python3 scripts/cdp_inspect.py --url-substr workday   # pick tab by url
"""
import asyncio, json, sys, urllib.request, argparse, pathlib
import websockets

CDP = "http://127.0.0.1:9222"

def list_tabs():
    with urllib.request.urlopen(f"{CDP}/json") as r:
        return json.load(r)

def pick_tab(substr=None):
    tabs = [t for t in list_tabs() if t.get("type") == "page"]
    if substr:
        tabs = [t for t in tabs if substr.lower() in t.get("url","").lower()]
    else:
        tabs = [t for t in tabs if not t.get("url","").startswith("chrome-extension://")]
    if not tabs:
        raise SystemExit(f"No matching tab (substr={substr!r}). All: {[t['url'] for t in list_tabs()]}")
    return tabs[0]

async def evaluate(ws_url, expr, await_promise=True):
    async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
        await ws.send(json.dumps({
            "id": 1, "method": "Runtime.evaluate",
            "params": {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "allowUnsafeEvalBlockedByCSP": True,
            },
        }))
        while True:
            resp = json.loads(await ws.recv())
            if resp.get("id") == 1:
                return resp

async def reload(ws_url):
    async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Page.reload", "params": {"ignoreCache": True}}))
        while True:
            resp = json.loads(await ws.recv())
            if resp.get("id") == 1:
                return resp

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("expr", nargs="?")
    ap.add_argument("--file")
    ap.add_argument("--reload", action="store_true")
    ap.add_argument("--url-substr", default=None)
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for t in list_tabs():
            print(t.get("type"), "-", t.get("url",""))
        return

    tab = pick_tab(args.url_substr)
    print(f"# tab: {tab['url'][:140]}", file=sys.stderr)
    ws_url = tab["webSocketDebuggerUrl"]

    if args.reload:
        print(asyncio.run(reload(ws_url)))
        return

    if args.file:
        expr = pathlib.Path(args.file).read_text()
    else:
        expr = args.expr or "1+1"

    result = asyncio.run(evaluate(ws_url, expr))
    out = result.get("result", {})
    if "exceptionDetails" in out:
        print("EXCEPTION:", json.dumps(out["exceptionDetails"], indent=2))
        sys.exit(1)
    val = out.get("result", {}).get("value")
    if isinstance(val, (dict, list)):
        print(json.dumps(val, indent=2, default=str))
    else:
        print(val)

if __name__ == "__main__":
    main()

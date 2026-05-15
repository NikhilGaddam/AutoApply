import json
import re
import sys
import time
import urllib.request

import websocket

TARGET = "fullsteam.wd1.myworkdayjobs.com"
MAX_STEPS = 12


def cdp_target():
    with urllib.request.urlopen("http://127.0.0.1:9222/json") as response:
        targets = json.loads(response.read())
    target = next((t for t in targets if t.get("type") == "page" and TARGET in t.get("url", "").lower()), None)
    if not target:
        print(json.dumps({"error": "Fullsteam tab not found", "targets": [t.get("url") for t in targets if t.get("type") == "page"]}, indent=2))
        sys.exit(1)
    return target


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=20)
        self.msg_id = 0

    def close(self):
        self.ws.close()

    def send(self, method, params=None):
        self.msg_id += 1
        msg_id = self.msg_id
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == msg_id:
                return msg

    def eval(self, expression):
        msg = self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        result = msg.get("result", {})
        if "exceptionDetails" in result:
            return {"exception": result["exceptionDetails"]}
        return result.get("result", {}).get("value")


def audit_script():
    return r'''
(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };
  const fieldRows = Array.from(document.querySelectorAll('input, textarea, select, button[aria-haspopup="listbox"], [role="combobox"]'))
    .filter(visible)
    .map(el => {
      const tag = el.tagName;
      const type = el.type || el.getAttribute('role') || '';
      const selectRoot = el.closest?.('.select__container, .select') || el.closest?.('[data-automation-id^="formField-"]');
      const selected = selectRoot?.querySelector?.('[class*="single-value"], [data-automation-id="selectedItem"]')?.textContent;
      const value = type === 'checkbox' || type === 'radio' ? (el.checked ? 'checked' : 'unchecked') : clean(selected || el.value || el.innerText || el.textContent || '');
      let label = '';
      if (el.id) label = clean(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || '');
      if (!label) {
        let node = el.parentElement;
        for (let i = 0; node && i < 4 && !label; i += 1, node = node.parentElement) {
          const text = clean(node.innerText || node.textContent || '');
          if (text && text.length < 180) label = text;
        }
      }
      return { id: el.id || '', name: el.name || '', aid: el.getAttribute('data-automation-id') || '', tag, type, label: label.slice(0, 180), value: value.slice(0, 300), checked: !!el.checked };
    });
  const work = fieldRows.filter(row => /^workExperience-\d+--/.test(row.id));
  const education = fieldRows.filter(row => /^education-\d+--/.test(row.id));
  const source = fieldRows.filter(row => /source|hear/i.test(`${row.id} ${row.name} ${row.aid} ${row.label}`));
  const questions = fieldRows.filter(row => /5\s*years|software engineering|authorized|sponsor|worked for fullsteam|hear about/i.test(`${row.id} ${row.name} ${row.aid} ${row.label}`));
  const errors = Array.from(document.querySelectorAll('[aria-invalid="true"], [data-automation-id="errorMessage"], [data-automation-id="errorHeading"], [role="alert"]'))
    .filter(visible)
    .map(el => clean(el.innerText || el.getAttribute('aria-label') || el.id || ''))
    .filter(Boolean);
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(visible)
    .map(el => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))
    .filter(Boolean)
    .slice(-20);
  const text = clean(document.body?.innerText || '');
  const currentStep = (text.match(/current step \d+ of \d+ [^\n]+?(?= step \d+ of| \* Indicates|$)/i) || [''])[0];
  return {
    url: location.href,
    title: document.title,
    currentStep,
    auth: document.documentElement.getAttribute('data-autoapply-auth') || '',
    step: document.documentElement.getAttribute('data-autoapply-step') || '',
    aiStatus: document.documentElement.getAttribute('data-autoapply-ai-status') || '',
    driver: !!window.__autoApplyWorkdayDriver,
    errors,
    buttons,
    bodyPrefix: text.slice(0, 900),
    source,
    questions,
    work,
    education,
    social: fieldRows.filter(row => /^socialNetworkAccounts--/.test(row.id)),
    overlay: clean(document.querySelector('.autoapply-toast')?.innerText || '').slice(0, 1600)
  };
})()
'''


def click_next_script():
    return r'''
(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  const btn = buttons.find(el => visible(el) && /^(next|save and continue|continue)$/i.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))) ||
    document.querySelector('[data-automation-id="pageFooterNextButton"]');
  if (!btn || !visible(btn) || btn.disabled) return { ok: false, reason: 'next not found or disabled' };
  btn.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const base = { bubbles: true, composed: true, cancelable: true, button: 0, buttons: 1, view: window, clientX: x, clientY: y };
  try { btn.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
  btn.dispatchEvent(new MouseEvent('mousedown', base));
  try { btn.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, pointerType: 'mouse', isPrimary: true })); } catch (_) {}
  btn.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  btn.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
  return { ok: true, text: clean(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '') };
})()
'''


def wait_for_settle(cdp, previous_step=""):
    last = None
    stable = 0
    for _ in range(90):
        state = cdp.eval(audit_script())
        sig = json.dumps({"step": state.get("currentStep"), "auth": state.get("auth"), "errors": state.get("errors"), "work": len(state.get("work", [])), "edu": len(state.get("education", []))}, sort_keys=True)
        if sig == last:
            stable += 1
        else:
            stable = 0
            last = sig
        if stable >= 3 and (state.get("auth") or state.get("currentStep") != previous_step):
            return state
        time.sleep(1)
    return state


def main():
    cdp = CDP(cdp_target()["webSocketDebuggerUrl"])
    try:
        state = wait_for_settle(cdp)
        print("INITIAL", json.dumps(state, indent=2))
        for idx in range(MAX_STEPS):
            step = state.get("currentStep", "")
            print(f"STEP_AUDIT_{idx}", json.dumps({
                "step": step,
                "auth": state.get("auth"),
                "aiStatus": state.get("aiStatus"),
                "errors": state.get("errors"),
                "workCount": len([row for row in state.get("work", []) if row.get("id", "").endswith("--jobTitle")]),
                "educationCount": len([row for row in state.get("education", []) if row.get("id", "").endswith("--schoolName")]),
                "source": state.get("source"),
                "questions": state.get("questions"),
                "overlay": state.get("overlay", "")[-800:],
            }, indent=2))
            if re.search(r"current step \d+ of \d+ review", step, re.I) or " Review " in state.get("bodyPrefix", "") and re.search(r"current step \d+ of \d+ Review", state.get("bodyPrefix", ""), re.I):
                print("REACHED_REVIEW", json.dumps(state, indent=2))
                return
            if state.get("errors"):
                print("BLOCKED_ERRORS", json.dumps(state, indent=2))
                return
            if not any(re.fullmatch(r"Next|Save and Continue|Continue", b, re.I) for b in state.get("buttons", [])):
                print("BLOCKED_NO_NEXT", json.dumps(state, indent=2))
                return
            click = cdp.eval(click_next_script())
            print("CLICK_NEXT", json.dumps(click, indent=2))
            if not click.get("ok"):
                print("BLOCKED_CLICK", json.dumps(state, indent=2))
                return
            state = wait_for_settle(cdp, previous_step=step)
        print("MAX_STEPS_REACHED", json.dumps(state, indent=2))
    finally:
        cdp.close()


if __name__ == "__main__":
    main()

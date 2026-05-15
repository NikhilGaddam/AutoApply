import json
import sys
import urllib.request

import websocket


def main():
    with open('extension/manifest.json') as f:
        local_version = json.load(f).get('version')
    with urllib.request.urlopen('http://127.0.0.1:9222/json') as r:
        targets = json.loads(r.read())
    target = next((t for t in targets if t.get('type') == 'page' and 'proofpoint' in t.get('url', '').lower()), None)
    if not target:
        print(json.dumps({'error': 'proofpoint target not found', 'localVersion': local_version}, indent=2))
        return
    ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=10)
    script = r'''
(() => {
  const visible = el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const wanted = /source|candidateIsPreviousWorker|socialNetwork|workExperience|education|school|degree|fieldOfStudy|gradeAverage/i;
  const fieldData = el => {
    let ancestor = el.parentElement;
    const ancestors = [];
    for (let i = 0; ancestor && i < 4; i += 1, ancestor = ancestor.parentElement) {
      const text = clean(ancestor.innerText || ancestor.textContent || '');
      if (text) ancestors.push(text.slice(0, 240));
    }
    return {
      tag: el.tagName,
      type: el.type || '',
      id: el.id || '',
      name: el.name || '',
      aid: el.getAttribute('data-automation-id') || '',
      role: el.getAttribute('role') || '',
      aria: el.getAttribute('aria-label') || '',
      text: clean(el.innerText || el.textContent || '').slice(0, 160),
      value: el.value || '',
      checked: !!el.checked,
      visible: visible(el),
      ancestors
    };
  };
  const fields = Array.from(document.querySelectorAll('input, select, textarea, button, [role="combobox"], [data-automation-id]'))
    .filter(el => wanted.test(`${el.id || ''} ${el.name || ''} ${el.getAttribute('data-automation-id') || ''} ${el.getAttribute('aria-label') || ''}`))
    .map(fieldData);
  const addButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter(el => visible(el) && /add/i.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '')))
    .map(el => ({ text: clean(el.innerText || el.textContent || ''), aid: el.getAttribute('data-automation-id') || '', ancestor: clean(el.parentElement?.parentElement?.innerText || el.parentElement?.innerText || '').slice(0, 300) }));
  return {
    url: location.href,
    title: document.title,
    bodyPrefix: clean(document.body.innerText).slice(0, 1600),
    docAuth: document.documentElement.getAttribute('data-autoapply-auth') || '',
    docStep: document.documentElement.getAttribute('data-autoapply-step') || '',
    docTick: document.documentElement.getAttribute('data-autoapply-tick') || '',
    toastExists: !!document.querySelector('.autoapply-toast'),
    toastMinimized: !!document.querySelector('.autoapply-toast.autoapply-minimized'),
    toastText: clean(document.querySelector('.autoapply-toast')?.innerText || '').slice(0, 1200),
    autoNextText: clean(document.querySelector('.wd-auto-next-btn')?.innerText || ''),
    autoNextEnabled: document.querySelector('.wd-auto-next-btn')?.getAttribute('data-enabled') || '',
    dragHandle: !!document.querySelector('.autoapply-drag-handle'),
    primaryText: clean(document.querySelector('.autoapply-primary')?.innerText || ''),
    errors: Array.from(document.querySelectorAll('[aria-invalid="true"], [data-automation-id="errorHeading"], [data-automation-id="errorMessage"], [data-automation-id="errorBanner"]')).map(el => clean(el.innerText || el.getAttribute('aria-label') || el.id)).filter(Boolean),
    fields,
    addButtons
  };
})()
'''
    ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': script, 'returnByValue': True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == 1:
            value = msg.get('result', {}).get('result', {}).get('value', {})
            value['localVersion'] = local_version
            print(json.dumps(value, indent=2))
            break
    ws.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error': str(exc)}, indent=2))
        sys.exit(1)

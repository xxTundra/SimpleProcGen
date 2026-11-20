function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'value') node.value = v;
      else if (k === 'hidden') node.hidden = true;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) appendChildren(node, c);
  return node;
}

function appendChildren(node, children) {
  if (children == null || children === false) return;
  if (Array.isArray(children)) { for (const c of children) appendChildren(node, c); return; }
  node.appendChild(
    (typeof children === 'string' || typeof children === 'number')
      ? document.createTextNode(String(children))
      : children
  );
}

function fmt(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n);
  return String(parseFloat(n.toFixed(10)));
}

function timeStamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function toast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; toastTimer = null; }, 4000);
}

let askTextClose = null;

function askText({ title, initial, onSubmit }) {
  return new Promise((resolve) => {
    if (askTextClose) askTextClose();
    const prevFocused = document.activeElement;
    const input = el('input', {
      class: 'field', type: 'text', value: initial == null ? '' : String(initial),
      'aria-label': title,
    });
    const okBtn = el('button', { class: 'btn', type: 'button' }, 'OK');
    const cancelBtn = el('button', { class: 'btn', type: 'button' }, 'Cancel');
    const closeBtn = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Close' }, '✕');
    const dialog = el('div', {
      class: 'gen-picker-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    });
    dialog.append(
      el('div', { class: 'examples-head' }, el('h2', { class: 'examples-title' }, title), closeBtn),
      el('div', { class: 'gen-picker-search' }, input),
      el('div', { class: 'dialog-actions' }, okBtn, cancelBtn),
    );
    const overlay = el('div', { class: 'gen-picker-overlay', id: 'ask-text-panel' });
    overlay.append(dialog);
    document.body.append(overlay);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      if (askTextClose === close) askTextClose = null;
      if (prevFocused && typeof prevFocused.focus === 'function' && document.contains(prevFocused)) prevFocused.focus();
      resolve(value);
    };
    const close = () => finish(null);
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    okBtn.addEventListener('click', () => finish(input.value));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } });
    document.addEventListener('keydown', escHandler);
    askTextClose = close;
    input.focus();
    input.select();
  });
}

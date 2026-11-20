

function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((h) => h && typeof h === 'object');
  } catch (_) {
    return [];
  }
}

function saveHistory() {
  try {
    state.history = state.history.slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch (_) {  }
}

function addHistory(entry) {
  state.history.unshift(entry);
  if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
  saveHistory();
  renderHistory();
}

function flashCopy(btn) {
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1200);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {  }
  ta.remove();
}

function setupHistory() {
  const btn = document.getElementById('clear-history');
  btn.addEventListener('click', () => {
    if (!confirm('Clear roll history?')) return;
    state.history = [];
    saveHistory();
    renderHistory();
  });
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.replaceChildren();
  empty.hidden = state.history.length > 0;
  for (const h of state.history) {
    const isGen = h.kind === 'generation';
    const copyBtn = el('button', { class: 'btn tiny', type: 'button' }, 'copy');
    copyBtn.addEventListener('click', async () => {
      const text = String(h.value);
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        fallbackCopy(text);
      }
      flashCopy(copyBtn);
    });
    const row = el('li', { class: 'history-row' + (isGen ? ' history-row-gen' : '') },
      el('span', { class: 'h-time mono' }, h.time || ''),
    );
    const expr = el('span', { class: 'h-expr mono' }, h.display || '');
    row.append(expr, el('span', { class: 'h-value mono' }, String(h.value)), copyBtn);
    list.append(row);
  }
}

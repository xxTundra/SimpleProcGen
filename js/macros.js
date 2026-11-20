
function matchMacro(input) {
  const trimmed = String(input == null ? '' : input).trim();
  if (trimmed === '' || state.macros.length === 0) return null;
  const lower = trimmed.toLowerCase();
  let best = null;
  for (const m of state.macros) {
    const name = m.name.trim();
    if (name === '') continue;
    if (!lower.startsWith(name.toLowerCase())) continue;
    const next = trimmed[name.length];
    if (next !== undefined && !/\s/.test(next) && !'+-*/('.includes(next)) continue;
    if (best === null || name.length > best.name.length) best = m;
  }
  if (best === null) return null;

  const remainder = trimmed.slice(best.name.length).trim();
  let expression = '(' + best.formula.trim() + ')';
  if (remainder !== '') {
    let rest = remainder;
    if (/^[0-9(]/.test(rest)) rest = '+' + rest;
    rest = rest.replace(/^([+\-*/])/, '$1 ');
    expression += ' ' + rest;
  }
  const display = trimmed + ' → ' + expression;
  return { macro: best, expression, display };
}

function sanitizeFileName(name) {
  let s = String(name).trim().replace(/\.json$/i, '');
  s = s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').replace(/^\.+/, '');
  if (s === '' || s === '.' || s === '..') return '';
  return s.toLowerCase();
}

async function persistMacroFile(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) return;
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const clean = entry.parsed.items.filter((it) => it && typeof it.name === 'string' && it.name.trim() !== '');
  const text = JSON.stringify({ items: clean }, null, 2) + '\n';
  await state.storage.writeFile(path, text);
  entry.parsed.items = clean;
  entry.text = text;
}

function macroRow(path, item) {
  const row = el('div', { class: 'macro-row' });
  const warn = el('div', { class: 'row-warn', hidden: true });
  const nameInput = el('input', {
    class: 'field', type: 'text', value: strOf(item, 'name'),
    placeholder: 'name (used for lookup)', spellcheck: 'false',
  });
  const labelInput = el('input', {
    class: 'field', type: 'text', value: strOf(item, 'label'),
    placeholder: 'label (display, optional)',
  });
  const formulaInput = el('input', {
    class: 'field mono', type: 'text', value: strOf(item, 'formula'),
    placeholder: 'formula, e.g. 1d20+5', spellcheck: 'false',
  });
  const delBtn = el('button', {
    class: 'btn small danger', type: 'button', 'aria-label': 'Delete this macro',
  }, '✕');

  const commit = async () => {
    if (!item || typeof item !== 'object') return;
    item.name = nameInput.value;
    item.label = labelInput.value;
    item.formula = formulaInput.value;
    const name = String(item.name).trim();
    warn.hidden = true;
    warn.textContent = '';
    if (name === '') {
      warn.textContent = 'Name is required — this row is not saved until it has one.';
      warn.hidden = false;
      derive();
      updateSuggestions();
      return;
    }
    let dups = 0;
    for (const p of [...state.files.keys()].filter((q) => q.startsWith('dice-macros/'))) {
      for (const x of itemsOf(p)) {
        if (strOf(x, 'name').trim().toLowerCase() === name.toLowerCase()) dups++;
      }
    }
    if (dups > 1) {
      warn.textContent = 'Duplicate name — the first match (by file order) wins.';
      warn.hidden = false;
    }
    let formulaError = null;
    if (String(item.formula).trim() !== '') {
      try { evaluate(item.formula); } catch (e) { formulaError = e.message; }
    }
    if (formulaError) {
      warn.textContent = 'Formula: ' + formulaError;
      warn.hidden = false;
    }
    try {
      await persistMacroFile(path);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    derive();
    renderAll();
  };

  nameInput.addEventListener('change', () => { commit(); });
  labelInput.addEventListener('change', () => { commit(); });
  formulaInput.addEventListener('change', () => { commit(); });
  delBtn.addEventListener('click', async () => {
    const items = itemsOf(path);
    const idx = items.indexOf(item);
    if (idx >= 0) items.splice(idx, 1);
    try {
      await persistMacroFile(path);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    derive();
    renderAll();
  });

  row.append(nameInput, labelInput, formulaInput, delBtn, warn);
  return row;
}

function renderMacrosTab() {
  const box = document.getElementById('tab-macros');
  box.replaceChildren();

  const newFileBtn = el('button', { class: 'btn small', type: 'button' }, '+ new file');
  newFileBtn.addEventListener('click', onNewMacroFile);

  const exportAllBtn = el('button', { class: 'btn small', type: 'button' }, 'export all');
  exportAllBtn.addEventListener('click', () => exportAllMacros());

  const importBtn = el('button', { class: 'btn small', type: 'button' }, 'import…');
  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.multiple = true;
    input.addEventListener('change', () => {
      handleDroppedFiles([...input.files]);
      input.remove();
    });
    input.click();
  });

  box.append(el('div', { class: 'tab-actions' }, newFileBtn, exportAllBtn, importBtn));

  const paths = [...state.files.keys()].filter((p) => p.startsWith('dice-macros/')).sort();
  if (paths.length === 0) {
    box.append(el('div', { class: 'hint' },
      'No macro files yet. Click "+ new file", or drop a JSON file (anywhere on the page).'));
  }

  for (const p of paths) {
    const entry = state.files.get(p);
    const section = el('div', { class: 'file-section' });
    const items = itemsOf(p);
    const addBtn = el('button', { class: 'btn small', type: 'button' }, '+ add macro');
    addBtn.addEventListener('click', () => onAddMacro(p));
    section.append(el('div', { class: 'file-head' },
      el('span', { class: 'file-path mono' }, p),
      el('span', { class: 'file-count' }, items.length + (items.length === 1 ? ' macro' : ' macros')),
      addBtn,
    ));
    if (entry.error) {
      section.append(el('div', { class: 'error' }, 'Parse error: ' + entry.error));
      box.append(section);
      continue;
    }
    for (let i = 0; i < items.length; i++) section.append(macroRow(p, items[i]));
    box.append(section);
  }
}

function onAddMacro(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) {
    toast('That file has a parse error — fix it in the JSON first.', 'error');
    return;
  }
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  entry.parsed.items.push({ name: '', label: '', formula: '' });
  derive();
  renderMacrosTab();
  const rows = document.querySelectorAll('#tab-macros .macro-row');
  const last = rows[rows.length - 1];
  if (last) {
    const firstInput = last.querySelector('input');
    if (firstInput) firstInput.focus();
  }
}

async function createNewMacroFile(name) {
  const fileName = sanitizeFileName(name);
  if (fileName === '') {
    toast('That file name is not usable.', 'error');
    return;
  }
  const path = 'dice-macros/' + fileName + '.json';
  const text = JSON.stringify({ items: [] }, null, 2) + '\n';
  try {
    await state.storage.createFile(path, text);
    setFile(path, text);
    derive();
    renderAll();
    toast('Created ' + path);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onNewMacroFile() {
  const name = await askText({ title: 'New macro file name (without .json):', initial: 'new-macros' });
  if (name == null) return;
  createNewMacroFile(name);
}

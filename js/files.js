
function downloadFile(path, entry) {
  const blob = new Blob([entry.text || ''], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split('/').pop() || 'file.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onDeleteFile(path) {
  if (!confirm('Delete ' + path + '? This cannot be undone.')) return;
  try {
    await state.storage.deleteFile(path);
    state.files.delete(path);
    if (state.selectedTable && state.selectedTable.file === path) state.selectedTable = null;
    derive();
    renderAll();
    toast('Deleted ' + path);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderFilesTab() {
  const box = document.getElementById('tab-files');
  box.replaceChildren();

  box.append(el('div', { class: 'dropzone' },
    el('div', {}, 'Drag & drop .json files here'),
    el('div', { class: 'hint' },
      'Macro files (items with a "formula" field) go to dice-macros/, tables (items with an "entries" array) go to tables/, generators (items with a "template" field) go to generators/. Dropping over an existing path overwrites it.'),
  ));

  const table = el('table', { class: 'file-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Path'),
    el('th', {}, 'Kind'),
    el('th', {}, 'Items'),
    el('th', {}, 'Size'),
    el('th', {}, ''),
  )));
  const tbody = el('tbody');
  const paths = [...state.files.keys()].sort();
  if (paths.length === 0) {
    tbody.append(el('tr', {}, el('td', { colspan: '5', class: 'hint' }, 'No files loaded.')));
  }
  for (const p of paths) {
    const entry = state.files.get(p);
    const kind = p.startsWith('tables/') ? 'tables'
      : p.startsWith('dice-macros/') ? 'dice-macros'
      : p.startsWith('generators/') ? 'generators'
      : 'other';
    const size = new Blob([entry.text || '']).size;
    const dlBtn = el('button', { class: 'btn tiny', type: 'button' }, 'download');
    dlBtn.addEventListener('click', () => downloadFile(p, entry));
    const delBtn = el('button', { class: 'btn tiny danger', type: 'button' }, 'delete');
    delBtn.addEventListener('click', () => { onDeleteFile(p); });
    tbody.append(el('tr', {},
      el('td', { class: 'mono' }, p),
      el('td', {}, kind),
      el('td', {}, entry.error ? '—' : String(itemsOf(p).length)),
      el('td', {}, size + ' B'),
      el('td', { class: 'row-btns' }, dlBtn, delBtn),
    ));
  }
  table.append(tbody);
  box.append(el('div', { class: 'file-table-wrap' }, table));

  const warnSection = el('div', { class: 'warn-section' });
  warnSection.append(el('h3', {}, 'Warnings'));
  if (state.warnings.length === 0) {
    warnSection.append(el('div', { class: 'hint' }, 'No warnings.'));
  } else {
    const ul = el('ul', { class: 'warn-list' });
    for (const w of state.warnings) {
      if (w.kind === 'dup') {
        ul.append(el('li', {},
          'Duplicate ' + w.what + ' name "' + w.name + '" in ',
          el('span', { class: 'mono' }, w.path),
          ' (first occurrence in ',
          el('span', { class: 'mono' }, w.first),
          ' wins).'));
      } else {
        ul.append(el('li', {}, el('span', { class: 'mono' }, w.path), ': ' + w.message));
      }
    }
    warnSection.append(ul);
  }
  box.append(warnSection);
}

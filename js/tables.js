
async function persistTableFile(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) return;
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const text = JSON.stringify({ items: entry.parsed.items }, null, 2) + '\n';
  await state.storage.writeFile(path, text);
  entry.text = text;
}

function weightedPick(entries) {
  let total = 0;
  for (const e of entries) {
    const w = Number(e && e.weight);
    if (isFinite(w) && w > 0) total += w;
  }
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const e of entries) {
    const w = Number(e && e.weight);
    if (!isFinite(w) || w <= 0) continue;
    r -= w;
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

function weightedPickDistinct(rows, n, rng) {
  const list = Array.isArray(rows) ? rows : [];
  const want = (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
  if (want <= 0) return [];
  const drawable = [];
  for (const e of list) {
    const w = Number(e && e.weight);
    if (isFinite(w) && w > 0) drawable.push(e);
  }
  if (drawable.length < want) return null;
  const pick = (typeof rng === 'function') ? rng : Math.random;
  const out = [];
  for (let i = 0; i < want; i += 1) {
    let total = 0;
    for (const e of drawable) total += Number(e.weight);
    let r = pick() * total;
    if (!isFinite(r)) r = total;
    let idx = drawable.length - 1;
    for (let j = 0; j < drawable.length; j += 1) {
      r -= Number(drawable[j].weight);
      if (r < 0) { idx = j; break; }
    }
    out.push(drawable.splice(idx, 1)[0]);
  }
  return out;
}

function embedErrorMessage(err) {
  const err2 = (err && typeof err === 'object') ? err : {};
  const cnameOf = (e) => (typeof e.containerName === 'string' && e.containerName !== ''
    ? e.containerName
    : e.token);
  const opNameOf = (e) => String(cnameOf(e)).replace(/^\{+/, '').replace(/\}+$/, '').trim();
  const chainText = (names) => names.map((n) => '[' + n + ']').join(' -> ');
  const chain = Array.isArray(err2.chain) ? err2.chain : [];
  const suffix = chain.length > 0 ? ' (inside ' + chainText(chain) + ')' : '';
  switch (err2.kind) {
    case 'unresolved':
      return 'Entry embed error: "' + err2.token + '" is not a macro or a valid dice expression' + suffix;
    case 'invalid-expression':
      if (typeof err2.macroName === 'string' && err2.macroName !== '') {
        const op = (typeof err2.operationName === 'string' && err2.operationName !== '')
          ? ' (inside logic operation "' + err2.operationName + '")'
          : '';
        return 'Entry embed error: macro "' + err2.macroName + '" has an invalid formula'
          + op + suffix;
      }
      if (typeof err2.operationName === 'string' && err2.operationName !== '') {
        return 'Entry embed error: logic operation "' + err2.operationName
          + '" has an invalid formula' + suffix;
      }
      return 'Entry embed error: macro "' + err2.macroName + '" has an invalid formula' + suffix;
    case 'malformed':
      return (err2.token.indexOf('((', 0) === 0
        ? 'Entry embed error: empty inline expression, empty option, or invalid option weight in "' + err2.token + '"'
        : err2.token.indexOf('[', 0) === 0
          ? 'Entry embed error: empty container reference "' + err2.token + '"'
          : 'Entry embed error: empty dice/macro reference "' + err2.token + '"') + suffix;
    case 'invalid-range':
      return 'Entry embed error: "' + err2.token + '" is not a valid integer range (expected ((min-max)) with integers)' + suffix;
    case 'reversed-range':
      return 'Entry embed error: "' + err2.token + '" has a reversed range (minimum is greater than maximum)' + suffix;
    case 'missing-container':
      return 'Entry embed error: container "' + cnameOf(err2) + '" not found - create a container'
        + ' with that name or reference an existing one' + suffix;
    case 'ambiguous-container':
      return 'Entry embed error: more than one container is named "' + cnameOf(err2)
        + '" - rename one or use a unique name' + suffix;
    case 'empty-container':
      return 'Entry embed error: container "' + cnameOf(err2)
        + '" has no entries with a positive weight' + suffix;
    case 'missing-operation':
      return 'Entry embed error: no logic operation named "' + opNameOf(err2)
        + '" - create the operation in the Logic tab or fix the {token}' + suffix;
    case 'unsupported-operation':
      return 'Entry embed error: logic operation "' + opNameOf(err2)
        + '" is not executable.' + suffix;
    case 'cycle': {
      const loop = chain.length > 0
        ? chain.concat([cnameOf(err2)])
        : [cnameOf(err2), cnameOf(err2)];
      return 'Entry embed error: circular container reference ' + chainText(loop)
        + ' - remove one reference to break the loop';
    }
    case 'op-cycle': {
      const loop = chain.length > 0
        ? chain.map((n) => '"' + n + '"').join(' -> ')
        : (typeof err2.operationName === 'string' && err2.operationName !== '')
          ? '"' + err2.operationName + '"'
          : String(err2.token);
      return 'Entry embed error: '
        + ((typeof err2.message === 'string' && err2.message !== '') ? err2.message
          : 'circular operation reference ' + loop + ' - remove one call to break the loop');
    }
    case 'missing-import': {
      const vn = (typeof err2.varName === 'string' && err2.varName !== '') ? err2.varName : '';
      return 'Entry embed error: '
        + ((typeof err2.message === 'string' && err2.message !== '') ? err2.message
          : 'the imported value' + (vn !== '' ? ' for %' + vn + '%' : '')
            + ' is missing - supply it for this run') + suffix;
    }
    case 'nesting-limit': {
      if (typeof err2.message === 'string' && err2.message !== '') {
        return 'Entry embed error: ' + err2.message + suffix;
      }
      return 'Entry embed error: container references exceeded the nesting'
        + ' budget (depth 8, 1000 picks, or 100,000 characters)'
        + ' - simplify the chain' + suffix;
    }
    default:
      return 'Entry embed error: "' + err2.token + '" could not be resolved' + suffix;
  }
}

async function mutateTable(path, fn) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) {
    toast('That file has a parse error — fix it in the JSON first.', 'error');
    return false;
  }
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const before = JSON.stringify(entry.parsed.items);
  fn(entry.parsed.items);
  try {
    await persistTableFile(path);
    return true;
  } catch (e) {
    entry.parsed.items = JSON.parse(before);
    toast(e.message, 'error');
    return false;
  }
}

function findEntryContainerRefs(containerId, containers) {
  const plan = [];
  const eng = genEngine();
  if (!containerId || !eng || typeof eng.parseEmbeds !== 'function' || typeof eng.findContainer !== 'function') {
    return plan;
  }
  for (const t of state.tables) {
    const raw = itemsOf(t.file)[t.index];
    if (!raw || !Array.isArray(raw.entries)) continue;
    for (let ei = 0; ei < raw.entries.length; ei++) {
      const e = raw.entries[ei];
      const label = e && typeof e.label === 'string' ? e.label : '';
      if (label.indexOf('[') === -1) continue;
      const spans = [];
      for (const seg of eng.parseEmbeds(label)) {
        if (seg.type !== 'container') continue;
        const found = eng.findContainer(seg.inner, containers, t.file);
        if (found.ok && found.container.id === containerId) {
          spans.push({ start: seg.start, end: seg.start + seg.raw.length });
        }
      }
      if (spans.length > 0) plan.push({ file: t.file, index: t.index, entry: ei, spans });
    }
  }
  return plan;
}

async function rewriteEntryContainerRefs(plan, newName) {
  const byFile = new Map();
  for (const p of plan) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  let files = 0;
  let spans = 0;
  for (const [file, targets] of byFile) {
    let changed = 0;
    const ok = await mutateTable(file, (its) => {
      for (const p of targets) {
        const it = its[p.index];
        if (!it || !Array.isArray(it.entries)) continue;
        const e = it.entries[p.entry];
        if (!e || typeof e.label !== 'string') continue;
        let label = e.label;
        const ordered = p.spans.slice().sort((a, b) => b.start - a.start);
        for (const s of ordered) {
          const spanText = label.slice(s.start, s.end);
          const replacement = '[' + newName + ']';
          if (spanText !== replacement) changed++;
          label = label.slice(0, s.start) + replacement + label.slice(s.end);
        }
        if (label !== e.label) e.label = label;
      }
    });
    if (ok && changed > 0) { files++; spans += changed; }
  }
  return { files, spans };
}

function findEntryOpRefs(operationId, oldName) {
  const plan = [];
  const eng = genEngine();
  const id = typeof operationId === 'string' ? operationId : '';
  const oldKey = String(oldName == null ? '' : oldName).trim().toLowerCase();
  if (oldKey === '' && id === '') return plan;
  if (!eng || typeof eng.parseEmbeds !== 'function') return plan;
  for (const t of state.tables) {
    const raw = itemsOf(t.file)[t.index];
    if (!raw || !Array.isArray(raw.entries)) continue;
    for (let ei = 0; ei < raw.entries.length; ei++) {
      const e = raw.entries[ei];
      const label = e && typeof e.label === 'string' ? e.label : '';
      if (label.indexOf('{') === -1) continue;
      const refs = Array.isArray(e && e.operations) ? e.operations : [];
      const byToken = new Map();
      for (const r of refs) {
        if (!r || typeof r.token !== 'string') continue;
        const k = r.token.trim().toLowerCase();
        if (k !== '') byToken.set(k, r);
      }
      const spans = [];
      const tokens = new Set();
      for (const seg of eng.parseEmbeds(label)) {
        if (seg.type !== 'op') continue;
        const key = seg.inner.trim().toLowerCase();
        if (key === '') continue;
        const ref = byToken.get(key);
        const refId = ref && typeof ref.operationId === 'string' ? ref.operationId : '';
        const idMatch = id !== '' && refId === id;
        const nameMatch = !idMatch && refId === '' && oldKey !== '' && key === oldKey;
        if (!idMatch && !nameMatch) continue;
        spans.push({ start: seg.start, end: seg.start + seg.raw.length });
        tokens.add(key);
      }
      if (spans.length === 0) continue;
      plan.push({ file: t.file, index: t.index, entry: ei, spans, operationId: id, tokens: Array.from(tokens) });
    }
  }
  return plan;
}

async function rewriteEntryOpRefs(plan, newName) {
  const byFile = new Map();
  for (const p of plan) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  const name = String(newName == null ? '' : newName).trim();
  const replacement = '{' + name + '}';
  let files = 0;
  let entries = 0;
  let spans = 0;
  const failed = [];
  for (const [file, targets] of byFile) {
    const current = itemsOf(file);
    const needsWrite = targets.some((p) => {
      const it = current[p.index];
      if (!it || !Array.isArray(it.entries)) return false;
      const e = it.entries[p.entry];
      if (!e || typeof e.label !== 'string') return false;
      return p.spans.some((s) => e.label.slice(s.start, s.end) !== replacement);
    });
    if (!needsWrite) continue;
    let changedLabels = 0;
    let changedSpans = 0;
    const ok = await mutateTable(file, (its) => {
      for (const p of targets) {
        const it = its[p.index];
        if (!it || !Array.isArray(it.entries)) continue;
        const e = it.entries[p.entry];
        if (!e || typeof e.label !== 'string') continue;
        let label = e.label;
        let labelChanged = false;
        const ordered = p.spans.slice().sort((a, b) => b.start - a.start);
        for (const s of ordered) {
          const spanText = label.slice(s.start, s.end);
          if (spanText !== replacement) { changedSpans++; labelChanged = true; }
          label = label.slice(0, s.start) + replacement + label.slice(s.end);
        }
        if (label !== e.label) e.label = label;
        if (!Array.isArray(e.operations)) e.operations = [];
        const keys = new Set(p.tokens);
        for (const ref of e.operations) {
          if (!ref || typeof ref.token !== 'string') continue;
          const key = ref.token.trim().toLowerCase();
          const refId = typeof ref.operationId === 'string' ? ref.operationId : '';
          if (p.operationId !== '' && refId === p.operationId) ref.token = name;
          else if (keys.has(key) && refId === '') ref.token = name;
        }
        const refs = entryOperationRefs(label, e.operations);
        if (refs.length > 0) e.operations = refs;
        else delete e.operations;
        if (labelChanged) changedLabels++;
      }
    });
    if (!ok) { failed.push(file); continue; }
    if (changedLabels > 0) { files++; entries += changedLabels; spans += changedSpans; }
  }
  return { files, entries, spans, failed };
}

function renderTableDetailPanel(box, sel) {
  box.replaceChildren();
  const key = sel.file + '#' + sel.index;
  const items = itemsOf(sel.file);
  const item = items[sel.index];
  const isObj = item && typeof item === 'object' && !Array.isArray(item);
  const valid = isObj && Array.isArray(item.entries);
  const name = isObj ? strOf(item, 'name') : '';

  const nameInput = el('input', {
    class: 'field table-name-input', type: 'text', value: name,
    placeholder: 'container name', spellcheck: 'false',
    'aria-label': 'container name',
  });
  nameInput.addEventListener('change', async () => {
    if (!isObj) return;
    const oldName = strOf(item, 'name');
    const containerId = typeof item.id === 'string' ? item.id : '';
    const newName = String(nameInput.value).trim();
    const refPlan = (containerId !== '' && newName !== '')
      ? findEntryContainerRefs(containerId, embedContainers())
      : [];
    const ok = await mutateTable(sel.file, (its) => {
      const it = its[sel.index];
      if (it && typeof it === 'object' && !Array.isArray(it)) it.name = nameInput.value;
    });
    if (!ok) return;
    derive();
    propagateContainerRename(containerId, oldName, nameInput.value);
    if (refPlan.length > 0) {
      const rewritten = await rewriteEntryContainerRefs(refPlan, newName);
      if (rewritten.files > 0) {
        derive();
        toast('Renamed container — updated ' + rewritten.spans + ' entry reference'
          + (rewritten.spans === 1 ? '' : 's') + ' in ' + rewritten.files + ' table file'
          + (rewritten.files === 1 ? '' : 's') + '.');
      }
    }
    renderAll();
  });

  const delBtn = el('button', { class: 'btn small danger', type: 'button' }, 'delete container');
  delBtn.addEventListener('click', async () => {
    const cid = isObj && typeof item.id === 'string' ? item.id : '';
    const entryRefs = cid !== ''
      ? findEntryContainerRefs(cid, embedContainers()).reduce((n, p) => n + p.spans.length, 0)
      : 0;
    const affected = [];
    if (cid !== '') {
      for (const g of state.generators) {
        const raw = itemsOf(g.file)[g.index];
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.references)) continue;
        if (raw.references.some((r) => r && typeof r.containerId === 'string' && r.containerId === cid)) {
          affected.push((strOf(raw, 'name') !== '' ? strOf(raw, 'name') : '(unnamed)') + ' in ' + g.file);
        }
      }
    }
    let msg = 'Delete container "' + (name !== '' ? name : '(unnamed)') + '" from ' + sel.file + '?';
    if (entryRefs > 0) {
      msg += '\n\n' + entryRefs + ' table entry reference' + (entryRefs === 1 ? '' : 's')
        + ' to it will become missing (the [token] stays in the label - recreate a container'
        + ' with the same name to fix it).';
    }
    if (affected.length > 0) {
      msg += '\n\n' + affected.length + ' generator' + (affected.length === 1 ? '' : 's')
        + ' reference' + (affected.length === 1 ? 's' : '')
        + ' it; after deletion their reference' + (affected.length === 1 ? ' will' : 's will')
        + ' be flagged missing (the token stays in the template — recover it by creating a container with the same name or re-importing):'
        + '\n- ' + affected.join('\n- ');
    }
    if (!confirm(msg)) return;
    const ok = await mutateTable(sel.file, (its) => {
      const idx = its.indexOf(item);
      if (idx >= 0) its.splice(idx, 1);
    });
    if (!ok) return;
    state.selectedTable = null;
    derive();
    renderAll();
  });

  box.append(el('div', { class: 'table-head' },
    nameInput,
    el('span', { class: 'file-path mono hint' }, sel.file),
    delBtn,
  ));

  if (!valid) {
    box.append(el('div', { class: 'hint' },
      isObj
        ? 'This container has no "entries" array — add one in the JSON, or delete it.'
        : 'This container is invalid — fix it in the JSON, or delete it.'));
    return;
  }
  const entries = item.entries;

  const errEl = el('div', { class: 'error', hidden: true });
  const rollBtn = el('button', { class: 'btn primary', type: 'button' }, 'Roll');
  rollBtn.addEventListener('click', () => {
    errEl.hidden = true;
    const picked = weightedPick(entries);
    if (!picked) {
      errEl.textContent = 'All weights are 0 — give at least one entry a positive weight.';
      errEl.hidden = false;
      return;
    }
    const label = typeof picked.label === 'string' && picked.label.trim() !== '' ? picked.label : '(unlabeled)';
    const resolved = resolveEntryEmbeds(label, sel.file, picked.operations);
    if (!resolved.ok) {
      const message = embedErrorMessage(resolved.errors[0]);
      state.lastTableRoll = {
        key, label, segments: resolved.segments, trace: resolved.trace, error: message,
      };
      toast(message, 'error');
      renderTablesTab();
      return;
    }
    state.lastTableRoll = { key, label, segments: resolved.segments, trace: resolved.trace };
    addHistory({
      time: timeStamp(),
      display: (name !== '' ? name : '(unnamed)') + ' (' + sel.file + ')',
      value: resolved.output,
    });
    renderTablesTab();
  });

  const last = state.lastTableRoll && state.lastTableRoll.key === key ? state.lastTableRoll : null;
  const resultEl = el('div', { class: 'table-result' });
  if (last) {
    const valueEl = el('div', { class: 'table-result-value' });
    renderEmbedSegments(valueEl, last.segments);
    resultEl.append(
      el('div', { class: 'table-result-label hint' }, 'Last roll'),
      valueEl,
    );
    if (last.error) {
      resultEl.append(el('div', { class: 'error' }, last.error));
    }
  } else {
    resultEl.append(el('div', { class: 'hint' }, 'No rolls yet.'));
  }

  const editor = el('div', { class: 'entry-editor' });
  entries.forEach((e, i) => {
    const row = el('div', { class: 'entry-row' });
    const labelInput = el('input', {
      class: 'field', type: 'text',
      value: e && typeof e === 'object' && typeof e.label === 'string' ? e.label : '',
      placeholder: 'label',
      spellcheck: 'false', autocomplete: 'off',
    });
    const weightInput = el('input', {
      class: 'field field-narrow', type: 'number', min: '0', step: 'any',
      value: e && typeof e === 'object' && isFinite(Number(e.weight)) ? String(Number(e.weight)) : '1',
    });
    const entryDelBtn = el('button', {
      class: 'btn small danger', type: 'button', 'aria-label': 'Delete this entry',
    }, '✕');

    const commit = async () => {
      const ok = await mutateTable(sel.file, (its) => {
        const it = its[sel.index];
        if (!it || !Array.isArray(it.entries) || !it.entries[i]) return;
        it.entries[i].label = labelInput.value;
        const w = parseFloat(weightInput.value);
        it.entries[i].weight = isFinite(w) && w > 0 ? w : 0;
        const e2 = it.entries[i];
        const refs = entryOperationRefs(e2.label, e2.operations);
        if (refs.length > 0) {
          if (!Array.isArray(e2.operations) ||
              JSON.stringify(e2.operations) !== JSON.stringify(refs)) {
            e2.operations = refs;
          }
        } else if (Array.isArray(e2.operations)) {
          delete e2.operations;
        }
      });
      if (ok) { derive(); renderAll(); }
    };

    labelInput.addEventListener('change', () => { commit(); });
    weightInput.addEventListener('change', () => { commit(); });
    entryDelBtn.addEventListener('click', async () => {
      const ok = await mutateTable(sel.file, (its) => {
        const it = its[sel.index];
        if (it && Array.isArray(it.entries)) it.entries.splice(i, 1);
      });
      if (!ok) return;
      derive();
      renderAll();
    });

    const labelField = el('div', { class: 'entry-embed-field' });
    const embedHighlight = el('div', {
      class: 'entry-embed-highlight', 'aria-hidden': 'true',
    });
    const picker = el('div', { class: 'suggest', hidden: true });
    labelField.append(embedHighlight, labelInput, picker);
    row.append(labelField, weightInput, entryDelBtn);

    const syncHighlight = () => renderEmbedHighlight(embedHighlight, labelInput.value, sel.file);
    const syncScroll = () => { embedHighlight.scrollLeft = labelInput.scrollLeft; };

    const entrySuggest = { items: [], hi: -1 };

    function labelBracketToken() {
      const before = labelInput.value.slice(0, labelInput.selectionStart);
      const open = before.lastIndexOf('[');
      if (open < 0) return null;
      const inner = before.slice(open + 1);
      if (inner.indexOf(']') !== -1) return null;
      return { open, inner };
    }

    function renderEntrySuggest(hi) {
      entrySuggest.hi = hi;
      picker.replaceChildren();
      if (entrySuggest.items.length === 0) { picker.hidden = true; return; }
      picker.hidden = false;
      entrySuggest.items.forEach((item, i) => {
        const opt = el('div', { class: 'suggest-item' + (i === hi ? ' active' : '') },
          '[' + item.name + ']',
          item.file !== sel.file
            ? el('span', { class: 'hint entry-suggest-file' }, item.file)
            : null);
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); selectEntrySuggestion(i); });
        picker.append(opt);
      });
    }

    function closeEntrySuggest() {
      entrySuggest.items = [];
      entrySuggest.hi = -1;
      picker.hidden = true;
      picker.replaceChildren();
    }

    function updateEntrySuggest() {
      const info = labelBracketToken();
      const items = [];
      if (info) {
        const query = info.inner.trim().toLowerCase();
        const seen = new Set();
        for (const t of state.tables) {
          const name = String(t.name).trim();
          if (name === '') continue;
          const key = name.toLowerCase() + '\u0000' + t.file;
          if (seen.has(key)) continue;
          if (query === '' || name.toLowerCase().indexOf(query) === 0) {
            seen.add(key);
            items.push({ name, file: t.file });
          }
          if (items.length >= 8) break;
        }
      }
      entrySuggest.items = items;
      entrySuggest.hi = -1;
      renderEntrySuggest(-1);
    }

    function selectEntrySuggestion(idx) {
      const item = entrySuggest.items[idx];
      const info = labelBracketToken();
      if (!item || !info) { closeEntrySuggest(); return; }
      const at = labelInput.selectionStart;
      const after = labelInput.value.slice(at);
      labelInput.value = labelInput.value.slice(0, info.open) + '[' + item.name + ']' + after;
      const caret = info.open + item.name.length + 2;
      labelInput.setSelectionRange(caret, caret);
      labelInput.focus();
      closeEntrySuggest();
      syncHighlight();
      syncScroll();
    }

    labelInput.addEventListener('input', () => {
      syncHighlight();
      syncScroll();
      updateEntrySuggest();
    });
    labelInput.addEventListener('keydown', (e) => {
      const open = !picker.hidden && entrySuggest.items.length > 0;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!open) return;
        e.preventDefault();
        const n = entrySuggest.items.length;
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        entrySuggest.hi = entrySuggest.hi < 0
          ? (e.key === 'ArrowDown' ? 0 : n - 1)
          : (entrySuggest.hi + delta + n) % n;
        renderEntrySuggest(entrySuggest.hi);
        return;
      }
      if (e.key === 'Escape') {
        if (open) closeEntrySuggest();
        return;
      }
      if (e.key === 'Tab') {
        if (!open) return;
        e.preventDefault();
        selectEntrySuggestion(entrySuggest.hi >= 0 ? entrySuggest.hi : 0);
        return;
      }
      if (e.key === 'Enter') {
        if (open) {
          e.preventDefault();
          selectEntrySuggestion(entrySuggest.hi >= 0 ? entrySuggest.hi : 0);
        }
      }
    });
    labelInput.addEventListener('scroll', () => { syncScroll(); });
    labelInput.addEventListener('blur', () => {
      setTimeout(() => { closeEntrySuggest(); }, 150);
    });
    syncHighlight();

    editor.append(row);
  });

  const addEntryBtn = el('button', { class: 'btn small', type: 'button' }, '+ add entry');
  addEntryBtn.addEventListener('click', async () => {
    const ok = await mutateTable(sel.file, (its) => {
      const it = its[sel.index];
      if (!it) return;
      if (!Array.isArray(it.entries)) it.entries = [];
      it.entries.push({ label: 'Entry', weight: 1 });
    });
    if (ok) { derive(); renderAll(); }
  });

  box.append(
    el('div', { class: 'table-actions' }, rollBtn, errEl),
    resultEl,
    el('h4', { class: 'editor-title' }, 'Entries'),
    editor,
    addEntryBtn,
  );
}

function renderTablesTab() {
  const box = document.getElementById('tab-tables');
  box.replaceChildren();

  const tablePaths = [...state.files.keys()].filter((p) => p.startsWith('tables/')).sort();
  if (state.tableFileFilter !== '' && !tablePaths.includes(state.tableFileFilter)) {
    state.tableFileFilter = '';
  }

  const newFileBtn = el('button', { class: 'btn small', type: 'button' }, '+ new file');
  newFileBtn.addEventListener('click', onNewTableFile);

  const exportAllBtn = el('button', { class: 'btn small', type: 'button' }, 'export all');
  exportAllBtn.addEventListener('click', () => exportAllTables());

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

  const helpBtn = el('button', { class: 'btn small', type: 'button' }, 'Help');
  helpBtn.addEventListener('click', () => window.open('help/tables.html', '_blank'));

  box.append(el('div', { class: 'tab-actions' }, newFileBtn, exportAllBtn, importBtn, helpBtn));

  const left = el('div', { class: 'table-list' });

  const searchInput = el('input', {
    id: 'table-search', class: 'field table-search', type: 'search',
    placeholder: 'search containers…', spellcheck: 'false',
    value: state.tableSearch, 'aria-label': 'Search containers',
  });
  const fileFilter = el('select', {
    id: 'table-file-filter', class: 'field table-file-filter',
    'aria-label': 'Filter by file',
  });
  fileFilter.append(el('option', { value: '' }, 'All files'));
  for (const p of tablePaths) {
    const opt = el('option', { value: p, text: p });
    if (p === state.tableFileFilter) opt.selected = true;
    fileFilter.append(opt);
  }
  searchInput.addEventListener('input', () => {
    state.tableSearch = searchInput.value;
    renderTableGroups(left);
  });
  fileFilter.addEventListener('change', () => {
    state.tableFileFilter = fileFilter.value;
    renderTableGroups(left);
  });
  box.append(el('div', { class: 'table-search-row' }, searchInput, fileFilter));

  const layout = el('div', { class: 'tables-layout' });
  const right = el('div', { class: 'table-detail' });
  renderTableGroups(left);
  layout.append(left, right);
  box.append(layout);

  let sel = null;
  if (state.selectedTable) {
    const st = state.selectedTable;
    const stItems = itemsOf(st.file);
    if (st.index >= 0 && st.index < stItems.length) sel = { file: st.file, index: st.index };
  }
  if (!sel) {
    state.selectedTable = null;
    right.append(el('div', { class: 'hint' }, 'Select a container on the left, or create a new one.'));
    return;
  }
  renderTableDetailPanel(right, sel);
}

function renderTableGroups(left) {
  left.replaceChildren();
  const search = state.tableSearch.trim().toLowerCase();
  let any = false;
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('tables/')).sort()) {
    const items = itemsOf(p);
    const visible = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isObj = it && typeof it === 'object' && !Array.isArray(it);
      const name = isObj ? strOf(it, 'name') : '';
      if (state.tableFileFilter !== '' && state.tableFileFilter !== p) continue;
      if (search !== '' && name.toLowerCase().includes(search) === false) continue;
      visible.push({
        index: i,
        name: name !== '' ? name : '(unnamed)',
        count: isObj && Array.isArray(it.entries) ? it.entries.length : 0,
      });
    }
    if (visible.length === 0 &&
        !(search === '' && (state.tableFileFilter === '' || state.tableFileFilter === p))) {
      continue;
    }
    any = true;

    const addBtn = el('button', {
      class: 'btn tiny', type: 'button',
      'aria-label': 'Add a container to ' + p,
    }, '+ new container');
    addBtn.addEventListener('click', () => onAddContainerToFile(p));

    const section = el('div', { class: 'file-section' });
    section.append(el('div', { class: 'file-head' },
      el('span', { class: 'file-path mono' }, p),
      el('span', { class: 'file-count hint' }, String(visible.length)),
      addBtn,
    ));
    for (const v of visible) {
      const selected = state.selectedTable &&
        state.selectedTable.file === p && state.selectedTable.index === v.index;
      const row = el('button', {
        class: 'table-item' + (selected ? ' selected' : ''), type: 'button',
      },
        el('span', { class: 'table-name' }, v.name),
        el('span', { class: 'table-count hint' }, String(v.count)),
      );
      row.addEventListener('click', () => {
        state.selectedTable = { file: p, index: v.index };
        renderTablesTab();
      });
      section.append(row);
    }
    if (visible.length === 0) {
      section.append(el('div', { class: 'table-empty' }, 'No containers yet.'));
    }
    left.append(section);
  }
  if (!any) {
    left.append(el('div', { class: 'hint' },
      search !== '' || state.tableFileFilter !== ''
        ? 'No containers match.'
        : 'No tables yet. Click "+ new file" or drop a JSON file.'));
  }
}

async function createNewTableFile(name) {
  const fileName = sanitizeFileName(name);
  if (fileName === '') {
    toast('That file name is not usable.', 'error');
    return;
  }
  const path = 'tables/' + fileName + '.json';
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

async function onNewTableFile() {
  const name = await askText({ title: 'New table file name (without .json):', initial: 'new-tables' });
  if (name == null) return;
  createNewTableFile(name);
}

async function onAddContainerToFile(path) {
  const ok = await mutateTable(path, (its) => {
    its.push({ name: 'New container', entries: [] });
  });
  if (!ok) return;
  await ensureContainerIds(path);
  state.selectedTable = { file: path, index: itemsOf(path).length - 1 };
  derive();
  renderAll();
  focusContainerName();
}

function focusContainerName() {
  const inp = document.querySelector('#tab-tables .table-name-input');
  if (inp) { inp.focus(); inp.select(); }
}

function randomIdHex() {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 8; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

function entryOperationRefs(label, existing) {
  const eng = genEngine();
  const prev = Array.isArray(existing) ? existing : [];
  if (!eng || typeof eng.resolveOperationRefs !== 'function') return prev;
  try {
    return eng.resolveOperationRefs(label, state.logicOps, prev);
  } catch (_) {
    return prev;
  }
}

async function ensureEntryOpRefs(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed || !Array.isArray(entry.parsed.items)) return;
  const eng = genEngine();
  if (!eng || typeof eng.resolveOperationRefs !== 'function') return;
  let changed = false;
  for (const item of entry.parsed.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!Array.isArray(item.entries)) continue;
    for (const e of item.entries) {
      if (!e || typeof e !== 'object') continue;
      const label = typeof e.label === 'string' ? e.label : '';
      const prev = Array.isArray(e.operations) ? e.operations : [];
      const refs = eng.resolveOperationRefs(label, state.logicOps, prev);
      if (refs.length > 0) {
        if (!Array.isArray(e.operations) ||
            JSON.stringify(e.operations) !== JSON.stringify(refs)) {
          e.operations = refs;
          changed = true;
        }
      } else if (Array.isArray(e.operations)) {
        delete e.operations;
        changed = true;
      }
    }
  }
  if (!changed) return;
  const text = JSON.stringify({ items: entry.parsed.items }, null, 2) + '\n';
  try {
    await state.storage.writeFile(path, text);
    entry.text = text;
  } catch (e) {
    toast('Could not save entry operation refs in ' + path + ': ' + e.message, 'warn');
  }
}

async function ensureContainerIds(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed || !Array.isArray(entry.parsed.items)) return;
  let changed = false;
  for (const item of entry.parsed.items) {
    if (item && typeof item === 'object' && !Array.isArray(item) &&
        (typeof item.id !== 'string' || item.id === '')) {
      item.id = 'tbl_' + randomIdHex();
      changed = true;
    }
  }
  if (!changed) return;
  const text = JSON.stringify({ items: entry.parsed.items }, null, 2) + '\n';
  try {
    await state.storage.writeFile(path, text);
    entry.text = text;
  } catch (e) {
    toast('Could not save container ids in ' + path + ': ' + e.message, 'warn');
  }
}

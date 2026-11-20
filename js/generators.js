
async function persistGeneratorFile(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) return;
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const clean = entry.parsed.items.filter((it) => it && typeof it.name === 'string' && it.name.trim() !== '');
  const text = JSON.stringify({ items: clean }, null, 2) + '\n';
  await state.storage.writeFile(path, text);
  entry.parsed.items = clean;
  entry.text = text;
}


const LOGIC_VALUE_KINDS = ['number', 'string', 'boolean'];

function typedValueKind(value) {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && isFinite(value)) return 'number';
  return null;
}

function makeTypedValue(raw) {
  if (typeof raw === 'string') return isLogicNumericText(raw) ? Number(raw) : raw;
  const kind = typedValueKind(raw);
  if (kind === 'number' || kind === 'boolean') return raw;
  return undefined;
}

const LOGIC_NUMERIC_FORMAT_RE = /^[+-]?\d+(?:\.\d+)?(?![\s\S])/;

function isLogicNumericText(text) {
  const s = typeof text === 'string' ? text : (text == null ? '' : String(text));
  if (typeof LogicLanguage !== 'undefined' && typeof LogicLanguage.isNumericText === 'function') {
    return LogicLanguage.isNumericText(s);
  }
  return LOGIC_NUMERIC_FORMAT_RE.test(s);
}

function asNumberValue(value) {
  if (typeof value === 'number' && isFinite(value)) return { ok: true, value: value };
  if (value === null || typeof value === 'undefined') return { ok: false, kind: 'missing-variable' };
  return { ok: false, kind: 'type-mismatch', value: value };
}

const LOGIC_SCOPES = ['generator', 'imported', 'local', 'exposed', 'output'];

function resolveVariable(name, scopes) {
  if (typeof name !== 'string' || name === '') return null;
  const sc = (scopes && typeof scopes === 'object' && !Array.isArray(scopes)) ? scopes : {};
  for (const scopeName of ['local', 'imported', 'generator']) {
    const bag = sc[scopeName];
    if (bag && typeof bag === 'object' && !Array.isArray(bag)
        && Object.prototype.hasOwnProperty.call(bag, name)) {
      return { scope: scopeName, value: bag[name] };
    }
  }
  return null;
}

function newOccurrenceId() {
  return 'occ_' + randomIdHex();
}

function genTemplateOccurrences(template, macros, refs, opRefs) {
  const eng = genEngine();
  if (!eng || typeof template !== 'string' || template === '') return [];
  let parsed;
  try {
    parsed = eng.parseTemplate(template);
  } catch (e) {
    return [];
  }
  const segments = (parsed && Array.isArray(parsed.segments)) ? parsed.segments : [];
  const macroList = Array.isArray(macros) ? macros : [];
  const refList = Array.isArray(refs) ? refs : [];
  const opList = Array.isArray(opRefs) ? opRefs : [];
  const out = [];
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue;
    if (seg.type === 'ref') {
      const token = typeof seg.token === 'string' ? seg.token : '';
      const key = token.trim().toLowerCase();
      const stored = refList.find((r) =>
        r && typeof r === 'object' && typeof r.token === 'string'
        && r.token.trim().toLowerCase() === key);
      out.push({
        instanceId: newOccurrenceId(),
        kind: 'ref',
        token: token,
        refId: (stored && typeof stored.containerId === 'string' && stored.containerId !== '')
          ? stored.containerId : null,
        offset: (typeof seg.start === 'number') ? seg.start : 0,
      });
    } else if (seg.type === 'op') {
      const token = typeof seg.inner === 'string' ? seg.inner.trim() : '';
      const key = token.toLowerCase();
      const stored = opList.find((o) =>
        o && typeof o === 'object' && typeof o.token === 'string'
        && o.token.trim().toLowerCase() === key);
      out.push({
        instanceId: newOccurrenceId(),
        kind: 'op',
        token: token,
        refId: (stored && typeof stored.operationId === 'string' && stored.operationId !== '')
          ? stored.operationId : null,
        offset: (typeof seg.start === 'number') ? seg.start : 0,
      });
    } else if (seg.type === 'embed') {
      const token = typeof seg.inner === 'string' ? seg.inner.trim() : '';
      const key = token.toLowerCase();
      let refId = null;
      for (const m of macroList) {
        if (m && typeof m === 'object' && typeof m.name === 'string'
            && m.name.trim().toLowerCase() === key) {
          refId = m.name.trim();
          break;
        }
      }
      out.push({
        instanceId: newOccurrenceId(),
        kind: 'embed',
        token: token,
        refId: refId,
        offset: (typeof seg.start === 'number') ? seg.start : 0,
      });
    } else if (seg.type === 'inline') {
      const shape = eng.classifyInline(seg.inner);
      if (shape === 'choice' || shape === 'range') {
        const token = typeof seg.inner === 'string' ? seg.inner.trim() : '';
        out.push({
          instanceId: newOccurrenceId(),
          kind: 'inline',
          token: token,
          refId: null,
          offset: (typeof seg.start === 'number') ? seg.start : 0,
        });
      }
    }
  }
  return out;
}

function reconcileGeneratorOccurrences(oldOccurrences, fresh, oldBindings) {
  const oldList = Array.isArray(oldOccurrences) ? oldOccurrences : [];
  const freshList = Array.isArray(fresh) ? fresh : [];
  const oldB = (oldBindings && typeof oldBindings === 'object' && !Array.isArray(oldBindings))
    ? oldBindings : {};

  const keyOf = (row) => {
    if (!row || typeof row !== 'object') return '';
    const kind = typeof row.kind === 'string' ? row.kind : '';
    const token = typeof row.token === 'string' ? row.token : '';
    const refId = (row.refId == null) ? '' : String(row.refId);
    return kind + '\u0000' + token + '\u0000' + refId;
  };

  const groups = new Map();
  for (let i = 0; i < freshList.length; i++) {
    const k = keyOf(freshList[i]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }

  const kept = new Array(freshList.length);
  const unresolved = [];
  const seenVar = new Set();
  const addUnresolved = (varName, reason) => {
    if (typeof varName !== 'string' || varName === '') return;
    if (seenVar.has(varName)) return;
    seenVar.add(varName);
    unresolved.push({ varName: varName, reason: reason });
  };

  for (const oldRow of oldList) {
    if (!oldRow || typeof oldRow !== 'object') continue;
    const oldId = typeof oldRow.instanceId === 'string' ? oldRow.instanceId : '';
    const idxs = groups.get(keyOf(oldRow));
    const unconsumed = idxs ? idxs.filter((i) => !kept[i]) : [];
    let winner = -1;
    if (unconsumed.length === 1) {
      winner = unconsumed[0];
    } else if (unconsumed.length > 1) {
      const same = unconsumed.filter((i) =>
        typeof oldRow.offset === 'number'
        && typeof freshList[i].offset === 'number'
        && freshList[i].offset === oldRow.offset);
      if (same.length === 1) winner = same[0];
    }
    if (winner === -1) {
      const b = oldB[oldId];
      const why = unconsumed.length === 0 ? 'occurrence-deleted' : 'occurrence-ambiguous';
      if (typeof b === 'string' && b !== '') {
        addUnresolved(b, why);
      } else if (b && typeof b === 'object' && !Array.isArray(b)) {
        for (const key of Object.keys(b)) {
          const val = b[key];
          if (typeof val === 'string' && val !== '') addUnresolved(val, why);
        }
      }
      continue;
    }
    kept[winner] = oldRow;
  }

  const occurrences = [];
  const bindings = {};
  for (let i = 0; i < freshList.length; i++) {
    const row = freshList[i];
    if (!row || typeof row !== 'object') continue;
    const norm = {
      kind: (typeof row.kind === 'string') ? row.kind : '',
      token: (typeof row.token === 'string') ? row.token : '',
      refId: (row.refId == null) ? null : row.refId,
      offset: (typeof row.offset === 'number') ? row.offset : 0,
    };
    const oldRow = kept[i];
    if (oldRow) {
      const id = (typeof oldRow.instanceId === 'string' && oldRow.instanceId !== '')
        ? oldRow.instanceId : newOccurrenceId();
      occurrences.push({ instanceId: id, kind: norm.kind, token: norm.token, refId: norm.refId, offset: norm.offset });
      const b = oldB[oldRow.instanceId];
      if (typeof b === 'string' && b !== '') {
        bindings[id] = b;
      } else if (b && typeof b === 'object' && !Array.isArray(b)) {
        const copy = {};
        for (const key of Object.keys(b)) {
          const val = b[key];
          if (typeof val === 'string') copy[key] = val;
        }
        bindings[id] = copy;
      }
    } else {
      occurrences.push({ instanceId: newOccurrenceId(), kind: norm.kind, token: norm.token, refId: norm.refId, offset: norm.offset });
    }
  }
  return { occurrences: occurrences, bindings: bindings, unresolvedBindings: unresolved };
}

function syncGeneratorRefs(item) {
  if (!item || typeof item !== 'object') return;
  if (!Array.isArray(item.references)) item.references = [];
  if (!Array.isArray(item.operations)) item.operations = [];
  const eng = genEngine();
  if (eng) {
    try {
      item.references = eng.resolveReferences(item.template, engineContainers(), item.references);
    } catch (_) {  }
  }
  item.operations = genOperationRefs(item.template, item.operations);
}

function normalizeGeneratorItem(item, ctx) {
  if (!item || typeof item !== 'object') return item;
  item.mode = (item.mode === 'basic' || item.mode === 'advanced') ? item.mode : 'basic';
  if (!Array.isArray(item.occurrences)) item.occurrences = [];
  if (!item.bindings || typeof item.bindings !== 'object' || Array.isArray(item.bindings)) item.bindings = {};
  if (!Array.isArray(item.unresolvedBindings)) item.unresolvedBindings = [];
  if (typeof item.template === 'string' && item.template !== '' && genEngine()) {
    const macros = (ctx && Array.isArray(ctx.macros)) ? ctx.macros : [];
    syncGeneratorRefs(item);
    const fresh = genTemplateOccurrences(item.template, macros, item.references, item.operations);
    const rec = reconcileGeneratorOccurrences(item.occurrences, fresh, item.bindings);
    const rankReason = (r) => (typeof r === 'string' && r !== '' && r !== 'no-exposed-variables') ? 1 : 0;
    const byVar = new Map();
    for (const u of (Array.isArray(item.unresolvedBindings) ? item.unresolvedBindings : [])
      .concat(rec.unresolvedBindings)) {
      if (!u || typeof u !== 'object') continue;
      const n = typeof u.varName === 'string' ? u.varName : '';
      if (n === '') continue;
      const reason = (typeof u.reason === 'string' && u.reason !== '') ? u.reason : 'no-exposed-variables';
      const prev = byVar.get(n);
      if (!prev || (rankReason(prev.reason) === 0 && rankReason(reason) === 1)) {
        byVar.set(n, { varName: n, reason });
      }
    }
    const keptUnresolved = [];
    for (const u of byVar.values()) keptUnresolved.push(u);
    item.occurrences = rec.occurrences;
    item.bindings = rec.bindings;
    item.unresolvedBindings = keptUnresolved;
  }
  return item;
}

async function addGeneratorToFile(path, gen) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) { toast('Cannot add to ' + path + ' (file is unparseable).', 'error'); return; }
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const item = {
    id: 'gen_' + randomIdHex(),
    name: (gen && typeof gen.name === 'string') ? gen.name : '',
    description: (gen && typeof gen.description === 'string') ? gen.description : '',
    template: (gen && typeof gen.template === 'string') ? gen.template : '',
    references: (gen && Array.isArray(gen.references)) ? gen.references : [],
    mode: 'basic',
  };
  entry.parsed.items.push(item);
  syncGeneratorRefs(item);
  normalizeGeneratorItem(item, { macros: state.macros });
  try {
    await persistGeneratorFile(path);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  derive();
  renderAll();
}

async function updateGenerator(file, index, gen) {
  const items = itemsOf(file);
  const item = items[index];
  if (!item || typeof item !== 'object') return;
  if (gen && typeof gen.name === 'string') item.name = gen.name;
  if (gen && typeof gen.description === 'string') item.description = gen.description;
  if (gen && typeof gen.template === 'string') item.template = gen.template;
  if (gen && Array.isArray(gen.references)) item.references = gen.references;
  syncGeneratorRefs(item);
  normalizeGeneratorItem(item, { macros: state.macros });
  try {
    await persistGeneratorFile(file);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  derive();
  renderAll();
}

async function deleteGenerator(file, index) {
  const items = itemsOf(file);
  if (index < 0 || index >= items.length) return;
  items.splice(index, 1);
  try {
    await persistGeneratorFile(file);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  derive();
  renderAll();
}

async function duplicateGenerator(file, index) {
  const items = itemsOf(file);
  const item = items[index];
  if (!item || typeof item !== 'object') return;
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = 'gen_' + randomIdHex();
  copy.name = strOf(item, 'name') + ' (copy)';
  items.splice(index + 1, 0, copy);
  try {
    await persistGeneratorFile(file);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  derive();
  renderAll();
}


function genEngine() {
  return (typeof window.GeneratorEngine === 'object' && window.GeneratorEngine)
    ? window.GeneratorEngine
    : null;
}

function engineContainers() {
  const out = [];
  for (const t of state.tables) {
    const raw = itemsOf(t.file)[t.index];
    out.push({
      id: (raw && typeof raw.id === 'string' && raw.id !== '') ? raw.id : '',
      name: t.name,
      entries: Array.isArray(t.entries) ? t.entries : [],
      file: t.file,
    });
  }
  return out;
}

function validateGen(item) {
  const eng = genEngine();
  if (!eng) return null;
  return eng.validateGenerator(item, engineContainers(), state.logicOps);
}

function isEmptyOpError(e, template) {
  return !!e && e.kind === 'malformed' && (e.token == null || e.token === '')
    && Array.isArray(e.occurrences) && e.occurrences.length > 0
    && typeof template === 'string'
    && template.charAt(e.occurrences[0].position) === '{';
}

function isOpErrorKind(e, template) {
  const kind = e && e.kind;
  if (kind === 'missing-operation' || kind === 'unsupported-operation') return true;
  return isEmptyOpError(e, template);
}

function genOperationRefs(template, existing) {
  const eng = genEngine();
  const prev = Array.isArray(existing) ? existing : [];
  if (!eng) return prev;
  try {
    return eng.resolveOperationRefs(template, state.logicOps, prev);
  } catch (_) {
    return prev;
  }
}

function insertGenOperationRef(existing, op) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const name = strOf(op, 'name').trim();
  if (name === '') return out;
  const key = name.toLowerCase();
  const already = out.some((r) => r && typeof r.token === 'string'
    && r.token.trim().toLowerCase() === key);
  if (!already) {
    out.push({ token: name, operationId: strOf(op, 'id') || null, operationName: name });
  }
  return out;
}

function findLogicOpRow(token, storedRefs) {
  const key = String(token == null ? '' : token).trim().toLowerCase();
  if (key === '') return null;
  const refs = Array.isArray(storedRefs) ? storedRefs : [];
  const stored = refs.find((r) => r && typeof r.token === 'string'
    && r.token.trim().toLowerCase() === key);
  if (stored && typeof stored.operationId === 'string' && stored.operationId !== '') {
    const byId = state.logicOps.find((o) => o && o.id === stored.operationId);
    if (byId) return byId;
  }
  const matches = state.logicOps.filter((o) => strOf(o, 'name').trim().toLowerCase() === key);
  return matches.length === 1 ? matches[0] : null;
}

function exposedVarsOfOpRow(row, storedRefs) {
  if (!row || row.kind !== 'op') return [];
  const op = findLogicOpRow(row.token, storedRefs);
  if (!op || typeof op.script !== 'string' || op.script === '') return [];
  if (typeof deriveScriptExposed !== 'function') return [];
  return deriveScriptExposed(op.script);
}

function opSpanAt(text, caret) {
  const src = typeof text === 'string' ? text : '';
  const at = typeof caret === 'number'
    ? Math.max(0, Math.min(caret, src.length))
    : src.length;
  let open = -1;
  for (let i = at; i >= 0; i--) {
    const ch = src[i];
    if (ch === '{') { open = i; break; }
    if (ch === '}' && i < at - 1) return null;
  }
  if (open < 0) return null;
  const close = src.indexOf('}', open + 1);
  if (close < 0) return null;
  if (at > close + 1) return null;
  const inner = src.slice(open + 1, close).trim();
  if (inner === '') return null;
  return { start: open, end: close, inner, raw: src.slice(open, close + 1) };
}

function opSuggestItems(query, operations) {
  const q = String(query == null ? '' : query).toLowerCase();
  const rows = Array.isArray(operations) ? operations : [];
  const out = [];
  const seen = new Set();
  for (const o of rows) {
    const name = strOf(o, 'name').trim();
    if (name === '') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (q !== '' && key.indexOf(q) !== 0) continue;
    seen.add(key);
    out.push({ text: name, hint: strOf(o, 'type') || 'operation', kind: 'op' });
    if (out.length >= 8) break;
  }
  return out;
}

function genItemIndex(file, item) {
  return itemsOf(file).indexOf(item);
}

function genErrorText(e) {
  return '[' + (e && e.token != null ? e.token : '?') + '] ' + (e ? e.kind : 'error');
}

function genErrorMessage(e, template) {
  const kind = e && typeof e.kind === 'string' ? e.kind : '';
  const token = e && e.token != null ? String(e.token) : '';
  if (kind === 'missing') {
    return 'Generator error: no container named "' + token
      + '" - create a container with that name or fix the token.';
  }
  if (kind === 'ambiguous') {
    return 'Generator error: more than one container is named "' + token
      + '" - rename one so the token is unambiguous.';
  }
  if (kind === 'empty') {
    return 'Generator error: container "' + token
      + '" has no entries with a positive weight.';
  }
  if (kind === 'missing-operation') {
    return 'Generator error: no logic operation named "' + token
      + '" - insert one with the Insert logic button or fix the {token}.';
  }
  if (kind === 'unsupported-operation') {
    return 'Generator error: logic operation "' + token
      + '" is not executable.';
  }
  if (kind === 'malformed' && token === '') {
    if (isEmptyOpError(e, template)) {
      return 'Generator error: the template has an empty {} token - put an operation name between the braces.';
    }
    const fromTemplate = Array.isArray(e.occurrences) && e.occurrences.length > 0;
    return fromTemplate
      ? 'Generator error: the template has an empty [] token - put a container name between the brackets.'
      : 'Generator error: this template could not be run.';
  }
  return embedErrorMessage(e);
}


function runGenItem(file, item) {
  const eng = genEngine();
  let result = null;
  if (eng) {
    try {
      result = eng.runGenerator(item, engineContainers(), genRollEntry, entryEmbedContext(file));
    } catch (e) {
      result = { ok: false, errors: [{ kind: 'malformed', token: '', occurrences: [] }] };
    }
  }
  const ok = !!(result && result.ok);
  const name = strOf(item, 'name');
  state.genLastRun = {
    file,
    item,
    name,
    ok,
    output: ok ? String(result.output) : '',
    errors: ok ? [] : (result && Array.isArray(result.errors) ? result.errors : []),
    rolls: ok && Array.isArray(result.rolls) ? result.rolls : [],
    segments: ok && Array.isArray(result.segments) ? result.segments : [],
    trace: ok && Array.isArray(result.trace) ? result.trace : [],
    template: strOf(item, 'template'),
    exposed: (ok && result && result.exposed && typeof result.exposed === 'object') ? result.exposed : {},
    occurrenceResults: (ok && result && result.occurrenceResults && typeof result.occurrenceResults === 'object')
      ? result.occurrenceResults : {},
  };
  if (ok) {
    state.genLastSuccess = {
      file,
      item,
      name,
      output: state.genLastRun.output,
      rolls: state.genLastRun.rolls,
      segments: state.genLastRun.segments,
      trace: state.genLastRun.trace,
      exposed: state.genLastRun.exposed,
      occurrenceResults: state.genLastRun.occurrenceResults,
    };
    addHistory({
      time: timeStamp(),
      display: 'Generated: ' + (name !== '' ? name : '(unnamed)'),
      value: state.genLastRun.output,
      kind: 'generation',
      details: state.genLastRun.rolls,
    });
  }
}

function genRollDetailLine(r) {
  const token = r && r.token != null ? String(r.token) : '?';
  const name = r && r.containerName != null && String(r.containerName) !== ''
    ? String(r.containerName) : 'unknown container';
  const occ = r && r.occurrence != null ? '#' + r.occurrence : '?';
  const entry = r && r.entry && typeof r.entry === 'object' ? r.entry : null;
  const label = entry && entry.label != null && String(entry.label).trim() !== ''
    ? '"' + String(entry.label) + '"' : '(unlabeled)';
  const weight = r && r.weight != null ? String(r.weight) : '?';
  const pos = r && r.position != null ? String(r.position) : '?';
  return '[' + token + '] → ' + name + ' · ' + occ + ' · ' + label + ' · weight ' + weight + ' · pos ' + pos;
}

function genRollDetailsBlock(rolls) {
  const block = el('div', { class: 'gen-roll-details', hidden: true });
  block.append(el('div', { class: 'gen-panel-label' }, 'Roll details'));
  if (!Array.isArray(rolls) || rolls.length === 0) {
    block.append(el('div', { class: 'hint' }, 'No roll details for this run.'));
  } else {
    for (const r of rolls) block.append(el('div', { class: 'gen-roll-line mono' }, genRollDetailLine(r)));
  }
  return block;
}

function genResultNodes(file, item, rerender) {
  const last = state.genLastRun && state.genLastRun.item === item ? state.genLastRun : null;
  const succ = state.genLastSuccess && state.genLastSuccess.item === item ? state.genLastSuccess : null;
  const nodes = [];
  if (!last && !succ) return nodes;
  if (last && !last.ok) {
    nodes.push(el('div', { class: 'error' },
      last.errors.length > 0
        ? last.errors.map((e) => genErrorMessage(e, last.template != null ? last.template : strOf(item, 'template'))).join('  ·  ')
        : 'Run failed.'));
  }
  if (succ) {
    if (last && !last.ok) {
      nodes.push(el('div', { class: 'hint gen-stale-label' }, 'Last successful output:'));
    }
    const outputEl = el('div', { class: 'gen-output mono' });
    if (Array.isArray(succ.segments) && succ.segments.length > 0) {
      renderEmbedSegments(outputEl, succ.segments);
    } else {
      outputEl.appendChild(document.createTextNode(String(succ.output)));
    }
    nodes.push(outputEl);
    const btnRow = el('div', { class: 'gen-card-actions gen-result-actions' });
    const againBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Generate again');
    againBtn.addEventListener('click', () => { runGenItem(file, item); rerender(); });
    const copyBtn = el('button', { class: 'btn small', type: 'button' }, 'Copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(succ.output);
      } catch (_) {
        fallbackCopy(succ.output);
      }
      flashCopy(copyBtn);
    });
    const detailsBlock = genRollDetailsBlock(succ.rolls);
    const detailsBtn = el('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false' }, 'Roll details');
    detailsBtn.addEventListener('click', () => {
      detailsBlock.hidden = !detailsBlock.hidden;
      detailsBtn.setAttribute('aria-expanded', String(!detailsBlock.hidden));
    });
    btnRow.append(againBtn, copyBtn, detailsBtn);
    nodes.push(btnRow, detailsBlock);
  }
  return nodes;
}

function renderGeneratorsTab() {
  const box = document.getElementById('tab-generators');
  box.replaceChildren();
  if (state.genEditor) {
    const ed = state.genEditor;
    if (!state.files.has(ed.file) || genItemIndex(ed.file, ed.item) < 0) {
      state.genEditor = null;
      state.genLastRun = null;
      state.genLastSuccess = null;
      renderGenList(box);
      return;
    }
    renderGenEditor(box, ed);
    return;
  }
  renderGenList(box);
}

function renderGenList(box) {
  box.replaceChildren();
  const searchInput = el('input', {
    class: 'field gen-search', type: 'search', value: state.genSearch,
    placeholder: 'Search generators…', spellcheck: 'false',
    'aria-label': 'Search generators',
  });
  searchInput.addEventListener('input', () => {
    state.genSearch = searchInput.value;
    renderGenList(box);
    const fresh = box.querySelector('.gen-search');
    if (fresh) {
      fresh.focus();
      const n = fresh.value.length;
      fresh.setSelectionRange(n, n);
    }
  });

  const newFileBtn = el('button', { class: 'btn small', type: 'button' }, '+ new generator file');
  newFileBtn.addEventListener('click', onNewGenFile);

  const exportAllBtn = el('button', { class: 'btn small', type: 'button' }, 'export all');
  exportAllBtn.addEventListener('click', () => exportAllGenerators(false));
  const exportAllContBtn = el('button', { class: 'btn small', type: 'button' }, 'export all + containers');
  exportAllContBtn.addEventListener('click', () => exportAllGenerators(true));

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
  helpBtn.addEventListener('click', () => window.open('help/generator.html', '_blank'));

  box.append(el('div', { class: 'tab-actions' }, searchInput, newFileBtn, exportAllBtn, exportAllContBtn, importBtn, helpBtn));

  const q = state.genSearch.trim().toLowerCase();
  const paths = [...state.files.keys()].filter((p) => p.startsWith('generators/')).sort();
  let sections = 0;

  for (const p of paths) {
    const entry = state.files.get(p);
    const items = itemsOf(p);
    const visible = [];
    for (const g of state.generators) {
      if (g.file !== p) continue;
      const raw = items[g.index];
      if (q !== '') {
        const hay = (strOf(raw, 'name') + ' ' + strOf(raw, 'description') + ' ' + strOf(raw, 'template')).toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }
      visible.push(raw);
    }
    const itemCount = itemsOf(p).length;
    if (visible.length === 0 && !(entry && entry.error) && !(q === '' && itemCount === 0)) continue;
    sections++;
    const section = el('div', { class: 'file-section gen-file-section' });
    const addBtn = el('button', { class: 'btn small', type: 'button' }, '+ add generator');
    addBtn.addEventListener('click', () => onAddGeneratorTo(p));
    section.append(el('div', { class: 'file-head' },
      el('span', { class: 'file-path mono' }, p),
      el('span', { class: 'file-count' }, visible.length + (visible.length === 1 ? ' generator' : ' generators')),
      addBtn,
    ));
    if (entry && entry.error) {
      section.append(el('div', { class: 'error' }, 'Parse error: ' + entry.error));
      box.append(section);
      continue;
    }
    for (const raw of visible) section.append(genCard(p, raw, () => renderGenList(box)));
    box.append(section);
  }

  if (sections === 0) {
    box.append(el('div', { class: 'hint' },
      paths.length === 0
        ? 'No generator files yet. Click "+ new generator file", or drop a JSON file with a "template" field anywhere on the page.'
        : 'No generators match the search.'));
  }
}

function genCard(file, item, rerender) {
  const card = el('div', { class: 'gen-card' });
  const name = strOf(item, 'name');
  card.append(el('div', { class: 'gen-card-name' }, name !== '' ? name : '(unnamed)'));
  const desc = strOf(item, 'description');
  if (desc !== '') card.append(el('div', { class: 'gen-card-desc hint' }, desc));

  const v = validateGen(item);
  if (v) {
    const tplText = strOf(item, 'template');
    const contErrs = new Map();
    const opErrs = new Map();
    for (const e of v.errors) {
      const key = e.token == null ? '' : String(e.token);
      const m = isOpErrorKind(e, tplText) ? opErrs : contErrs;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(e);
    }
    const chipRow = el('div', { class: 'gen-chips' });
    const seen = new Set();
    for (const r of v.refs) {
      seen.add(r.token);
      const bad = contErrs.has(r.token);
      chipRow.append(el('span', {
        class: 'gen-chip mono' + (bad ? ' bad' : ''),
        title: r.containerName ? 'resolves to "' + r.containerName + '"' : 'unresolved reference',
      }, (bad ? '⚠ ' : '') + '[' + r.token + ']' + (r.containerName ? ' → ' + r.containerName : '')));
    }
    for (const key of contErrs.keys()) {
      if (seen.has(key)) continue;
      chipRow.append(el('span', { class: 'gen-chip mono bad', title: 'unresolved reference' }, '⚠ [' + key + ']'));
    }
    for (const key of opErrs.keys()) {
      chipRow.append(el('span', {
        class: 'gen-chip mono bad', title: 'unresolved logic operation',
      }, '⚠ {' + key + '}'));
    }
    if (chipRow.childNodes.length > 0) card.append(chipRow);
  }

  for (const n of genResultNodes(file, item, rerender)) card.append(n);

  const idx = genItemIndex(file, item);
  const actions = el('div', { class: 'gen-card-actions' });

  const runBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Run');
  runBtn.addEventListener('click', () => { runGenItem(file, item); rerender(); });

  const editBtn = el('button', { class: 'btn small', type: 'button' }, 'Edit');
  editBtn.addEventListener('click', () => { state.genEditor = { file, item, newGen: false }; renderAll(); });

  const renameBtn = el('button', { class: 'btn small', type: 'button' }, 'Rename');
  renameBtn.addEventListener('click', async () => {
    const answer = prompt('Rename generator:', name);
    if (answer == null) return;
    const newName = String(answer).trim();
    if (newName === '') { toast('Name cannot be empty.', 'error'); return; }
    if (newName === name) return;
    await updateGenerator(file, idx, { name: newName });
  });

  const dupBtn = el('button', { class: 'btn small', type: 'button' }, 'Duplicate');
  dupBtn.addEventListener('click', () => { duplicateGenerator(file, idx); });

  const delBtn = el('button', { class: 'btn small danger', type: 'button' }, 'Delete');
  delBtn.addEventListener('click', () => {
    if (!confirm('Delete generator "' + (name !== '' ? name : '(unnamed)') + '"?')) return;
    if (state.genLastRun && state.genLastRun.item === item) state.genLastRun = null;
    if (state.genLastSuccess && state.genLastSuccess.item === item) state.genLastSuccess = null;
    deleteGenerator(file, idx);
  });

  const exportBtn = el('button', { class: 'btn small', type: 'button' }, 'Export');
  exportBtn.addEventListener('click', () => exportGenerator(file, item));

  actions.append(runBtn, editBtn, renameBtn, dupBtn, delBtn, exportBtn);
  card.append(actions);
  return card;
}

function onAddGeneratorTo(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) { toast('That file has a parse error — fix it in the JSON first.', 'error'); return; }
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const item = { id: 'gen_' + randomIdHex(), name: '', description: '', template: '', references: [], mode: 'basic', occurrences: [], bindings: {}, unresolvedBindings: [] };
  entry.parsed.items.push(item);
  normalizeGeneratorItem(item, { macros: state.macros });
  derive();
  state.genEditor = { file: path, item, newGen: true };
  renderAll();
  const inp = document.querySelector('#tab-generators .gen-name-input');
  if (inp) inp.focus();
}

async function createNewGenFile(name) {
  const fileName = sanitizeFileName(name);
  if (fileName === '') { toast('That file name is not usable.', 'error'); return; }
  const path = 'generators/' + fileName + '.json';
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

async function onNewGenFile() {
  const name = await askText({ title: 'New generator file name (without .json):', initial: 'generators' });
  if (name == null) return;
  createNewGenFile(name);
}
const GEN_DICE_PRESETS = ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20'];

function unclosedSpanAt(text, caret, openCh, closeCh) {
  const src = typeof text === 'string' ? text : '';
  const at = typeof caret === 'number'
    ? Math.max(0, Math.min(caret, src.length))
    : src.length;
  const before = src.slice(0, at);
  const open = before.lastIndexOf(openCh);
  if (open < 0) return null;
  const inner = before.slice(open + 1);
  if (openCh === closeCh) {
    if ((before.split(openCh).length - 1) % 2 === 0) return null;
    return { open, inner };
  }
  if (inner.indexOf(closeCh) !== -1) return null;
  return { open, inner };
}

function pipeSuggestItems(query, macros, presets) {
  const q = String(query == null ? '' : query).toLowerCase();
  const rows = Array.isArray(macros) ? macros : [];
  const dice = Array.isArray(presets) ? presets : GEN_DICE_PRESETS;
  const out = [];
  const seen = new Set();
  const offer = (raw, hint) => {
    const text = raw == null ? '' : String(raw).trim();
    if (text === '' || out.length >= 8) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    if (q !== '' && key.indexOf(q) !== 0) return;
    seen.add(key);
    out.push({ text, hint });
  };
  for (const d of dice) offer(d, 'dice');
  for (const m of rows) {
    if (m && typeof m === 'object') {
      offer(m.name != null && m.name !== '' ? m.name : m.label, 'macro');
    }
  }
  return out;
}

function tokenLabelOf(row) {
  const kind = row && row.kind;
  const token = row && row.token != null ? String(row.token) : '';
  if (kind === 'ref') return '[' + token + ']';
  if (kind === 'op') return '{' + token + '}';
  if (kind === 'embed') return '|' + token + '|';
  if (kind === 'inline') return '((' + token + '))';
  return token;
}

function bindingNameError(name) {
  const s = String(name == null ? '' : name).trim();
  if (s === '') return '';
  const ll = (typeof LogicLanguage !== 'undefined') ? LogicLanguage : null;
  if (!ll || typeof ll.normalizeName !== 'function') return '';
  try {
    ll.normalizeName(s, 0);
    return '';
  } catch (e) {
    return (e && typeof e.message === 'string' && e.message !== '') ? e.message : 'invalid variable name';
  }
}

function renderGenEditor(box, ed) {
  const file = ed.file;
  const item = ed.item;
  box.replaceChildren();

  const backBtn = el('button', { class: 'btn small', type: 'button' }, '← back to list');
  backBtn.addEventListener('click', () => { state.genEditor = null; renderAll(); });
  const cancelBtn = el('button', { class: 'btn small', type: 'button' }, 'Cancel');
  const saveBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Save');
  box.append(el('div', { class: 'gen-editor-head' },
    backBtn,
    cancelBtn,
    saveBtn,
    el('span', { class: 'file-path mono hint' }, file),
  ));

  const nameInput = el('input', {
    class: 'field gen-name-input', type: 'text', value: strOf(item, 'name'),
    placeholder: 'name', spellcheck: 'false', 'aria-label': 'Generator name',
  });
  const descInput = el('input', {
    class: 'field', type: 'text', value: strOf(item, 'description'),
    placeholder: 'description (optional)', 'aria-label': 'Generator description',
  });
  const modeSelect = el('select', {
    class: 'field gen-mode-select', 'aria-label': 'Generator mode',
  });
  modeSelect.append(
    el('option', { value: 'basic' }, 'basic'),
    el('option', { value: 'advanced' }, 'advanced'),
  );
  modeSelect.value = item.mode === 'advanced' ? 'advanced' : 'basic';

  const tplWrap = el('div', { class: 'gen-tpl-wrap' });
  const tplField = el('div', { class: 'gen-tpl-field' });
  const tplLayer = el('div', { class: 'gen-tpl-highlight', 'aria-hidden': 'true' });
  const tpl = el('textarea', {
    class: 'field mono gen-template', rows: '8', spellcheck: 'false',
    placeholder: 'Free text, [container name] to roll a container, or |1d6| to roll dice…',
    'aria-label': 'Generator template',
  });
  tpl.value = strOf(item, 'template');
  tplField.append(tplLayer, tpl);
  const suggestBox = el('div', { class: 'suggest gen-suggest', hidden: true });
  tplWrap.append(tplField, suggestBox);

  function syncTplHighlight() {
    renderEmbedHighlight(tplLayer, tpl.value);
    tplLayer.style.right = (tpl.offsetWidth - tpl.clientWidth) + 'px';
    tplLayer.scrollTop = tpl.scrollTop;
    tplLayer.scrollLeft = tpl.scrollLeft;
  }

  const insertBtn = el('button', { class: 'btn small', type: 'button' }, 'Insert container…');
  const insertLogicBtn = el('button', { class: 'btn small', type: 'button' }, 'Insert logic…');
  const openOpBtn = el('button', { class: 'btn small', type: 'button', hidden: true }, 'Open {…}');
  const runBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Run');
  const refsPanel = el('div', { class: 'gen-panel' });
  const bindingsPanel = el('div', { class: 'gen-panel gen-bindings-panel', hidden: true });
  const previewPanel = el('div', { class: 'gen-panel gen-preview-panel', hidden: true });
  const validPanel = el('div', { class: 'gen-panel', 'aria-live': 'polite' });
  const runArea = el('div', { class: 'gen-run-area' });
  const warnEl = el('div', { class: 'row-warn', hidden: true });

  box.append(el('div', { class: 'gen-editor-form' },
    el('div', { class: 'gen-field-row' }, nameInput, descInput),
    el('div', { class: 'gen-field-row' },
      el('label', { class: 'gen-mode-label' }, 'mode'),
      modeSelect,
    ),
    tplWrap,
    el('div', { class: 'gen-editor-actions' }, insertBtn, insertLogicBtn, openOpBtn, runBtn),
    refsPanel,
    bindingsPanel,
    previewPanel,
    validPanel,
    runArea,
    warnEl,
  ));
  syncTplHighlight();

  const genSuggest = { items: [], hi: -1, mode: 'container' };

  function bracketToken() {
    return unclosedSpanAt(tpl.value, tpl.selectionStart, '[', ']');
  }

  function pipeToken() {
    return unclosedSpanAt(tpl.value, tpl.selectionStart, '|', '|');
  }

  function braceToken() {
    return unclosedSpanAt(tpl.value, tpl.selectionStart, '{', '}');
  }

  function renderGenSuggest(hi) {
    genSuggest.hi = hi;
    suggestBox.replaceChildren();
    if (genSuggest.items.length === 0) { suggestBox.hidden = true; return; }
    suggestBox.hidden = false;
    genSuggest.items.forEach((item, i) => {
      const opt = el('div', { class: 'suggest-item' + (i === hi ? ' active' : '') }, item.text);
      if (item.hint) opt.append(el('span', { class: 'hint' }, ' · ' + item.hint));
      opt.addEventListener('mousedown', (e) => { e.preventDefault(); selectGenSuggestion(i); });
      suggestBox.append(opt);
    });
  }

  function closeGenSuggest() {
    genSuggest.items = [];
    genSuggest.hi = -1;
    genSuggest.mode = 'container';
    suggestBox.hidden = true;
    suggestBox.replaceChildren();
  }

  function updateGenSuggest() {
    const br = bracketToken();
    const pi = pipeToken();
    const op = braceToken();
    const usePipe = pi !== null && br === null;
    const useOp = op !== null && br === null && pi === null;
    const info = useOp ? op : (usePipe ? pi : br);
    let items = [];
    if (info) {
      if (useOp) {
        items = opSuggestItems(info.inner, state.logicOps);
      } else if (usePipe) {
        items = pipeSuggestItems(info.inner, state.macros, GEN_DICE_PRESETS)
          .map((s) => ({ text: s.text, hint: s.hint, kind: 'embed' }));
      } else {
        const query = info.inner.toLowerCase();
        const seen = new Set();
        for (const c of engineContainers()) {
          const name = String(c.name).trim();
          if (name === '') continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          if (query === '' || key.indexOf(query) === 0) {
            seen.add(key);
            items.push({ text: name, hint: '', kind: 'container' });
          }
          if (items.length >= 8) break;
        }
      }
    }
    genSuggest.items = items;
    genSuggest.mode = useOp ? 'op' : (usePipe ? 'embed' : 'container');
    genSuggest.hi = -1;
    renderGenSuggest(-1);
  }

  function selectGenSuggestion(idx) {
    const picked = genSuggest.items[idx];
    if (!picked) { closeGenSuggest(); return; }
    const info = genSuggest.mode === 'embed' ? pipeToken()
      : genSuggest.mode === 'op' ? braceToken()
        : bracketToken();
    if (!info) { closeGenSuggest(); return; }
    const insert = picked.kind === 'container' ? '[' + picked.text + ']'
      : picked.kind === 'op' ? '{' + picked.text + '}'
        : '|' + picked.text + '|';
    const after = tpl.value.slice(tpl.selectionStart);
    tpl.value = tpl.value.slice(0, info.open) + insert + after;
    if (picked.kind === 'op') {
      const row = state.logicOps.find((o) => strOf(o, 'name').trim() === picked.text);
      if (row) item.operations = insertGenOperationRef(item.operations, row);
    }
    const caret = info.open + insert.length;
    tpl.setSelectionRange(caret, caret);
    tpl.focus();
    closeGenSuggest();
    syncTplHighlight();
    refreshPanels();
  }

  const KIND_LABEL = {
    missing: 'no container with this name',
    empty: 'container has no entries',
    ambiguous: 'multiple containers share this name',
    malformed: 'malformed reference',
    'missing-operation': 'no logic operation with this name',
    'unsupported-operation': 'operation type is not executable yet',
  };

  function valuesNow() {
    return {
      name: nameInput.value,
      description: descInput.value,
      template: tpl.value,
      references: Array.isArray(item.references) ? item.references : [],
      operations: genOperationRefs(tpl.value, item.operations),
    };
  }

  function panelGen(v) {
    return {
      name: v.name,
      description: v.description,
      template: v.template,
      references: v.references,
      operations: v.operations,
    };
  }

  function applyInputsToItem() {
    item.name = nameInput.value;
    item.description = descInput.value;
    item.template = tpl.value;
    item.mode = modeSelect.value;
    const merged = mergeGatheredBindings();
    if (merged.count > 0) {
      mergeUnresolvedNames(merged.orphanNames);
      item.bindings = merged.bindings;
    }
    syncGeneratorRefs(item);
    normalizeGeneratorItem(item, { macros: state.macros });
  }

  function buildRefsPanel(v) {
    const panel = el('div', { class: 'gen-panel' });
    panel.append(el('div', { class: 'gen-panel-label' }, 'References'));
    const vres = validateGen(panelGen(v));
    if (!vres) {
      panel.append(el('div', { class: 'hint' }, 'Engine unavailable.'));
      return panel;
    }
    const tplText = typeof v.template === 'string' ? v.template : '';
    const contErrs = new Map();
    const opErrs = new Map();
    for (const e of vres.errors) {
      const key = e.token == null ? '' : String(e.token);
      const m = isOpErrorKind(e, tplText) ? opErrs : contErrs;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(e);
    }
    const list = el('div', { class: 'gen-refs' });
    const seen = new Set();
    const seenOps = new Set();
    const missingBtn = (token) => {
      const b = el('button', { class: 'btn tiny', type: 'button' }, 'create container');
      b.addEventListener('click', () => {
        applyInputsToItem();
        onCreateContainerForToken(token, file, item);
      });
      return b;
    };
    for (const r of vres.refs) {
      seen.add(r.token);
      const bad = contErrs.has(r.token);
      const row = el('div', { class: 'gen-ref-row' },
        el('span', {
          class: 'gen-chip mono' + (bad ? ' bad' : ''),
          title: r.containerName ? 'resolves to "' + r.containerName + '"' : 'unresolved reference',
        }, (bad ? '⚠ ' : '') + '[' + r.token + ']' + (r.containerName ? ' → ' + r.containerName : '')));
      if ((contErrs.get(r.token) || []).some((e) => e.kind === 'missing')) row.append(missingBtn(r.token));
      list.append(row);
    }
    const opRefs = Array.isArray(v.operations) ? v.operations : [];
    for (const r of opRefs) {
      const token = String(r && r.token != null ? r.token : '').trim();
      if (token === '') continue;
      seenOps.add(token);
      const errs = opErrs.get(token) || [];
      const bad = errs.length > 0;
      const resolvedTo = String(r && r.operationName ? r.operationName : '');
      const opRow = el('div', { class: 'gen-ref-row' },
        el('span', {
          class: 'gen-chip mono' + (bad ? ' bad' : ''),
          title: bad
            ? 'unresolved logic operation'
            : 'resolves to "' + (resolvedTo || token) + '"',
        }, (bad ? '⚠ ' : '') + '{' + token + '}'
          + (bad || resolvedTo === '' ? '' : ' → ' + resolvedTo)));
      list.append(opRow);
    }
    for (const [key, errs] of contErrs) {
      if (seen.has(key)) continue;
      const row = el('div', { class: 'gen-ref-row' },
        el('span', { class: 'gen-chip mono bad', title: 'unresolved reference' },
          '⚠ [' + key + ']'));
      if (errs.some((e) => e.kind === 'missing')) row.append(missingBtn(key));
      list.append(row);
    }
    for (const key of opErrs.keys()) {
      if (seenOps.has(key)) continue;
      list.append(el('div', { class: 'gen-ref-row' },
        el('span', { class: 'gen-chip mono bad', title: 'unresolved logic operation' },
          '⚠ {' + key + '}')));
    }
    if (list.childNodes.length === 0) {
      panel.append(el('div', { class: 'hint' }, 'No references in the template yet.'));
      return panel;
    }
    panel.append(list);
    return panel;
  }

  function buildValidPanel(v) {
    const panel = el('div', { class: 'gen-panel' });
    panel.append(el('div', { class: 'gen-panel-label' }, 'Validation'));
    const vres = validateGen(panelGen(v));
    if (!vres) {
      panel.append(el('div', { class: 'hint' }, 'Engine unavailable.'));
      return panel;
    }
    if (vres.errors.length === 0) {
      panel.append(el('div', { class: 'hint' }, 'No problems.'));
      return panel;
    }
    const ul = el('ul', { class: 'gen-valid-list' });
    for (const e of vres.errors) {
      const where = (Array.isArray(e.occurrences) && e.occurrences.length > 0)
        ? ' (at ' + e.occurrences.map((o) => 'char ' + o.position).join(', ') + ')'
        : '';
      const emptyOp = isEmptyOpError(e, v.template);
      const text = emptyOp
        ? '{ } malformed operation'
        : genErrorText(e) + ' — ' + (KIND_LABEL[e.kind] || e.kind);
      ul.append(el('li', {}, text + where));
    }
    panel.append(ul);
    return panel;
  }

  const bindingDraft = Object.create(null);
  const bindingKeyOf = (occId, varName) =>
    (varName === '' ? occId : occId + '\u0000' + varName);

  function mergeGatheredBindings() {
    const rows = bindingsPanel.querySelectorAll('input.gen-binding-input');
    const live = {};
    const rendered = new Set();
    const varsByOcc = new Map();
    for (const inp of rows) {
      const occId = inp.dataset.occId || '';
      if (occId === '') continue;
      rendered.add(occId);
      const varName = inp.dataset.var || '';
      const name = String(inp.value).trim();
      if (varName === '') {
        if (name !== '') live[occId] = name;
      } else {
        let vars = varsByOcc.get(occId);
        if (!vars) { vars = new Set(); varsByOcc.set(occId, vars); }
        vars.add(varName);
        let obj = live[occId];
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
        obj[varName] = name;
        live[occId] = obj;
      }
    }
    const stored = (item.bindings && typeof item.bindings === 'object' && !Array.isArray(item.bindings))
      ? item.bindings : {};
    const touched = new Set();
    for (const k of Object.keys(bindingDraft)) {
      const sep = k.indexOf('\u0000');
      touched.add(sep > 0 ? k.slice(0, sep) : k);
    }
    const merged = {};
    const orphanNames = [];
    const seenOrphan = new Set();
    const orphan = (n) => {
      if (typeof n === 'string' && n !== '' && !seenOrphan.has(n)) {
        seenOrphan.add(n);
        orphanNames.push(n);
      }
    };
    for (const occId of Object.keys(stored)) {
      if (rendered.has(occId)) continue;
      const b = stored[occId];
      if (typeof b === 'string') orphan(b);
      else if (b && typeof b === 'object' && !Array.isArray(b)) {
        for (const key of Object.keys(b)) orphan(b[key]);
      }
    }
    for (const occId of Object.keys(live)) {
      const b = stored[occId];
      if (typeof b === 'string' && b !== '' && !touched.has(occId)) {
        merged[occId] = b;
      } else {
        merged[occId] = live[occId];
        if (b && typeof b === 'object' && !Array.isArray(b)) {
          const vars = varsByOcc.get(occId);
          if (vars) {
            for (const key of Object.keys(b)) {
              if (!vars.has(key)) orphan(b[key]);
            }
          }
        }
      }
    }
    return { bindings: merged, orphanNames: orphanNames, count: rows.length };
  }

  function mergeUnresolvedNames(names) {
    if (!Array.isArray(names) || names.length === 0) return;
    const prev = Array.isArray(item.unresolvedBindings) ? item.unresolvedBindings : [];
    const seen = new Set();
    const list = [];
    for (const u of prev) {
      if (!u || typeof u !== 'object') continue;
      const n = typeof u.varName === 'string' ? u.varName : '';
      if (n === '' || seen.has(n)) continue;
      seen.add(n);
      list.push({
        varName: n,
        reason: (typeof u.reason === 'string' && u.reason !== '') ? u.reason : 'no-exposed-variables',
      });
    }
    for (const n of names) {
      if (typeof n !== 'string' || n === '' || seen.has(n)) continue;
      seen.add(n);
      list.push({ varName: n, reason: 'no-exposed-variables' });
    }
    item.unresolvedBindings = list;
  }

  function buildBindingRow(row, existing) {
    const occId = (row && row.instanceId != null) ? String(row.instanceId) : '';
    const label = tokenLabelOf(row);
    const chip = el('span', { class: 'gen-chip mono' }, label);
    const isOp = !!row && row.kind === 'op';
    const existingObj = (isOp && existing && typeof existing === 'object' && !Array.isArray(existing))
      ? existing : null;
    const makeInput = (varName, defaultText, aria) => {
      const key = bindingKeyOf(occId, varName);
      const draft = (occId !== '' && Object.prototype.hasOwnProperty.call(bindingDraft, key))
        ? String(bindingDraft[key]) : null;
      const current = draft != null
        ? draft
        : (defaultText != null ? String(defaultText) : '');
      const input = el('input', {
        class: 'field gen-binding-input', type: 'text', value: current,
        placeholder: 'variable name (empty = unexposed)',
        spellcheck: 'false',
        'aria-label': aria,
      });
      input.dataset.occId = occId;
      input.dataset.var = varName;
      const err = bindingNameError(current);
      if (err !== '') { input.classList.add('bad'); input.title = err; }
      input.addEventListener('input', () => {
        if (occId !== '') bindingDraft[key] = input.value;
        const e = bindingNameError(String(input.value).trim());
        if (e === '') { input.classList.remove('bad'); input.title = ''; }
        else { input.classList.add('bad'); input.title = e; }
      });
      input.addEventListener('change', syncBindingInputs);
      return input;
    };
    if (!isOp) {
      const existingStr = (existing != null && typeof existing === 'string') ? existing : '';
      return el('div', { class: 'gen-binding-row' },
        chip, makeInput('', existingStr, 'Variable name for ' + label));
    }
    const fields = el('div', { class: 'gen-binding-fields' });
    const vars = exposedVarsOfOpRow(row, item.operations);
    for (const v of vars) {
      const stored = (existingObj && Object.prototype.hasOwnProperty.call(existingObj, v))
        ? existingObj[v] : null;
      fields.append(
        el('span', { class: 'gen-binding-var mono' }, v),
        makeInput(v,
          (stored != null && typeof stored === 'string') ? stored : v,
          'Binding for ' + label + ' exposed variable ' + v));
    }
    if (vars.length === 0) {
      fields.append(el('span', { class: 'hint' }, 'no exposed variables'));
    }
    return el('div', { class: 'gen-binding-row' }, chip, fields);
  }

  function buildBindingsPanel() {
    const panel = el('div', { class: 'gen-panel gen-bindings-panel' });
    panel.append(el('div', { class: 'gen-panel-label' }, 'Bindings'));
    panel.append(el('div', { class: 'hint' },
      'One variable per occurrence; leave a name empty to keep that result unexposed. '
      + 'Logic operations get one field per EXPOSE variable, prefilled with the variable name.'));
    const list = el('div', { class: 'gen-binding-list' });
    const occs = Array.isArray(item.occurrences) ? item.occurrences : [];
    const bindings = (item.bindings && typeof item.bindings === 'object') ? item.bindings : {};
    if ((typeof item.template === 'string') && item.template === '' && occs.length > 0) {
      panel.append(el('div', { class: 'hint' },
        'Template is empty — these rows are parked until their spans return.'));
    }
    for (const row of occs) {
      if (!row || typeof row !== 'object') continue;
      list.append(buildBindingRow(row, bindings[row.instanceId]));
    }
    const unres = Array.isArray(item.unresolvedBindings) ? item.unresolvedBindings : [];
    for (const u of unres) {
      if (!u || typeof u !== 'object') continue;
      const varName = u.varName != null ? String(u.varName) : '?';
      const why = u.reason === 'occurrence-ambiguous'
        ? 'its occurrence is ambiguous in the template'
        : u.reason === 'occurrence-deleted'
          ? 'its occurrence was removed from the template'
          : u.reason === 'no-exposed-variables'
            ? 'its operation exposes no variables'
            : 'its occurrence no longer exists';
      list.append(el('div', { class: 'gen-binding-row gen-unresolved' },
        el('span', { class: 'gen-chip mono bad', title: why }, '⚠ ' + varName),
        el('span', { class: 'hint' }, why)));
    }
    if (list.childNodes.length === 0) {
      panel.append(el('div', { class: 'hint' },
        'No occurrences in the template yet — bindable spans get a row here.'));
      return panel;
    }
    panel.append(list);
    return panel;
  }

  function syncBindingInputs() {
    const merged = mergeGatheredBindings();
    const rows = bindingsPanel.querySelectorAll('input.gen-binding-input');
    for (const inp of rows) {
      const occId = inp.dataset.occId || '';
      if (occId !== '') delete bindingDraft[bindingKeyOf(occId, inp.dataset.var || '')];
    }
    if (merged.count > 0) {
      mergeUnresolvedNames(merged.orphanNames);
      item.bindings = merged.bindings;
    }
    commitOnChange();
  }

  function previewValueOf(value) {
    if (value == null) return '(no result)';
    if (typeof value === 'string') return '"' + value + '"';
    return String(value);
  }

  function buildPreviewPanel() {
    const panel = el('div', { class: 'gen-panel gen-preview-panel' });
    panel.append(el('div', { class: 'gen-panel-label' }, 'Operation preview'));
    const last = (state.genLastRun && state.genLastRun.item === item) ? state.genLastRun : null;
    if (last && last.ok === false) {
      panel.append(el('div', { class: 'hint gen-unresolved' },
        'Last run failed — the values below are from the previous successful run, if any.'));
    }
    const succ = (state.genLastSuccess && state.genLastSuccess.item === item)
      ? state.genLastSuccess : null;
    const results = (succ && succ.occurrenceResults && typeof succ.occurrenceResults === 'object')
      ? succ.occurrenceResults : {};
    const occs = Array.isArray(item.occurrences) ? item.occurrences : [];
    const bindings = (item.bindings && typeof item.bindings === 'object') ? item.bindings : {};
    if ((typeof item.template === 'string') && item.template === '' && occs.length > 0) {
      panel.append(el('div', { class: 'hint' },
        'Template is empty — nothing to preview until spans return.'));
    }
    const list = el('div', { class: 'gen-preview-list' });
    for (const row of occs) {
      if (!row || typeof row !== 'object') continue;
      const r = results[row.instanceId];
      const line = el('div', { class: 'gen-preview-line mono' },
        el('span', { class: 'gen-chip mono' }, tokenLabelOf(row)),
        el('span', {}, ' → ' + previewValueOf(r ? r.value : null)));
      const bound = bindings[row.instanceId];
      const boundNames = (row.kind === 'op' && bound && typeof bound === 'object' && !Array.isArray(bound))
        ? Object.keys(bound).filter((k) => typeof bound[k] === 'string' && bound[k].trim() !== '')
        : ((bound != null && String(bound).trim() !== '') ? [String(bound)] : []);
      if (boundNames.length > 0) {
        line.append(el('span', { class: 'hint' }, ' · ' + boundNames.join(', ')));
      }
      list.append(line);
    }
    if (list.childNodes.length === 0) {
      panel.append(el('div', { class: 'hint' },
        'Run this generator to see each operation resolve here.'));
      return panel;
    }
    panel.append(list);
    return panel;
  }

  function bindingsSig() {
    const occs = Array.isArray(item.occurrences) ? item.occurrences : [];
    const unres = Array.isArray(item.unresolvedBindings) ? item.unresolvedBindings : [];
    const parts = [];
    for (const r of occs) {
      if (!r || typeof r !== 'object') continue;
      parts.push(String(r.instanceId || '') + '\u0001' + String(r.kind || '') + '\u0001' + String(r.token || ''));
    }
    for (const u of unres) {
      if (!u || typeof u !== 'object') continue;
      parts.push('!' + String(u.varName || '') + '\u0001' + String(u.reason || ''));
    }
    return parts.join('\u0002');
  }

  function refreshPanels() {
    const v = valuesNow();
    const activeEl = document.activeElement;
    const ownsFocus = (panel) => {
      if (!activeEl || activeEl === panel || !panel.contains(activeEl)) return false;
      const t = activeEl.tagName;
      return t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'SELECT';
    };
    if (!ownsFocus(refsPanel)) refsPanel.replaceChildren(...buildRefsPanel(v).childNodes);
    if (!ownsFocus(validPanel)) validPanel.replaceChildren(...buildValidPanel(v).childNodes);
    const advanced = modeSelect.value === 'advanced';
    bindingsPanel.hidden = !advanced;
    previewPanel.hidden = !advanced;
    if (advanced) {
      const sig = bindingsSig();
      if (bindingsPanel.dataset.sig !== sig) {
        const active = document.activeElement;
        let focus = null;
        if (active && active !== bindingsPanel && bindingsPanel.contains(active)
            && active.classList && active.classList.contains('gen-binding-input')) {
          focus = {
            occId: active.dataset.occId || '',
            var: active.dataset.var || '',
            start: active.selectionStart,
            end: active.selectionEnd,
          };
        }
        bindingsPanel.replaceChildren(...buildBindingsPanel().childNodes);
        bindingsPanel.dataset.sig = sig;
        if (focus && focus.occId !== '') {
          const again = bindingsPanel.querySelector(
            'input.gen-binding-input[data-occ-id="' + focus.occId + '"]'
            + (focus.var !== '' ? '[data-var="' + focus.var + '"]' : ''));
          if (again) {
            again.focus();
            try { again.setSelectionRange(focus.start, focus.end); } catch (_) {  }
          }
        }
      }
      previewPanel.replaceChildren(...buildPreviewPanel().childNodes);
    }
    syncOpenOpBtn();
  }

  function syncOpenOpBtn() {
    const span = opSpanAt(tpl.value, tpl.selectionStart);
    const row = span ? findLogicOpRow(span.inner, item.operations) : null;
    if (row) {
      openOpBtn.textContent = 'Open {' + strOf(row, 'name').trim() + '}';
      openOpBtn.hidden = false;
      openOpBtn.dataset.opId = strOf(row, 'id');
      openOpBtn.dataset.token = span.inner;
    } else {
      openOpBtn.hidden = true;
      delete openOpBtn.dataset.opId;
      delete openOpBtn.dataset.token;
    }
  }

  let pickerOpen = false;
  let pendingCommit = false;

  const commit = async () => {
    if (!item || typeof item !== 'object') return;
    if (genCommitInFlight && genCommitInFlight.file === file && genCommitInFlight.id === item.id) {
      const inFlight = genCommitInFlight;
      const r = await inFlight.promise;
      const takenOver = genCommitInFlight && genCommitInFlight.file === file && genCommitInFlight.id === item.id;
      const live = mergeGatheredBindings();
      const bindingsNow = live.count > 0 ? JSON.stringify(live.bindings) : JSON.stringify(item.bindings);
      const unchanged = item.name === nameInput.value
        && item.description === descInput.value
        && item.template === tpl.value
        && item.mode === modeSelect.value
        && bindingsNow === inFlight.bindingsAfter;
      if (takenOver || unchanged || !box.contains(tpl)) return r;
    }
    const name = String(nameInput.value).trim();
    if (name === '') {
      warnEl.textContent = 'Name is required — this generator is not saved until it has one.';
      warnEl.hidden = false;
      refreshPanels();
      return 'blocked';
    }
    warnEl.hidden = true;
    const snapshot = JSON.parse(JSON.stringify(item));
    applyInputsToItem();
    const bindingsAfter = JSON.stringify(item.bindings);
    const promise = (async () => {
      try {
        await persistGeneratorFile(file);
      } catch (e) {
        for (const k of Object.keys(item)) delete item[k];
        Object.assign(item, snapshot);
        toast(e.message, 'error');
        renderGenEditor(box, state.genEditor || ed);
        return 'failed';
      }
      derive();
      if (!pickerOpen && !box.contains(document.activeElement)) renderAll();
      else refreshPanels();
      return 'ok';
    })();
    genCommitInFlight = { file, id: item.id, bindingsAfter, promise };
    const mine = genCommitInFlight;
    try {
      return await promise;
    } finally {
      if (genCommitInFlight === mine) genCommitInFlight = null;
    }
  };

  const onSaveClick = async () => {
    const r = await commit();
    if (r === 'ok') {
      state.genEditor = null;
      renderAll();
      toast('Saved');
    }
  };
  const onCancelClick = async () => {
    if (genCommitInFlight && genCommitInFlight.file === file && genCommitInFlight.id === item.id) {
      await genCommitInFlight.promise;
    }
    const entry = state.files.get(file);
    if (entry && entry.parsed) {
      if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
      let saved = null;
      try {
        const onDisk = JSON.parse(entry.text || 'null');
        const arr = (onDisk && Array.isArray(onDisk.items)) ? onDisk.items : [];
        saved = arr.find((it) => it && it.id === item.id) || null;
      } catch (_) {  }
      if (item.name === '') {
        const at = entry.parsed.items.indexOf(item);
        if (at >= 0) entry.parsed.items.splice(at, 1);
      } else if (ed && !ed.newGen) {
        if (saved) {
          for (const k of Object.keys(item)) delete item[k];
          Object.assign(item, saved);
        }
      } else {
        const at = entry.parsed.items.indexOf(item);
        if (at >= 0) entry.parsed.items.splice(at, 1);
        try {
          await persistGeneratorFile(file);
        } catch (e) {
          toast(e.message, 'error');
          return;
        }
      }
    }
    derive();
    state.genEditor = null;
    renderAll();
    toast('Cancelled');
  };

  const commitOnChange = () => {
    if (pickerOpen) { pendingCommit = true; return; }
    commit();
  };
  const pickerClosed = () => {
    pickerOpen = false;
    if (pendingCommit) { pendingCommit = false; commit(); }
  };

  function openGenPicker() {
    if (pickerOpen) return;
    closeGenSuggest();
    const overlay = el('div', { class: 'gen-picker-overlay', id: 'gen-picker-panel' });
    const dialog = el('div', {
      class: 'gen-picker-dialog', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Insert container',
    });
    const closeBtn = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Close container picker' }, '✕');
    const searchInput = el('input', {
      class: 'field', type: 'search', placeholder: 'Search containers…',
      'aria-label': 'Search containers',
    });
    const list = el('div', { class: 'gen-picker-list' });
    dialog.append(
      el('div', { class: 'examples-head' },
        el('h2', { class: 'examples-title' }, 'Insert container'),
        closeBtn),
      el('div', { class: 'gen-picker-search' }, searchInput),
      list,
    );
    overlay.append(dialog);
    document.body.append(overlay);
    pickerOpen = true;

    const closePicker = () => {
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      if (!box.contains(tpl)) {
        pickerOpen = false;
        pendingCommit = false;
        const live = box.querySelector('textarea.gen-template');
        if (live) live.focus();
        return;
      }
      tpl.focus();
      pickerClosed();
    };
    const escHandler = (e) => {
      if (e.key === 'Escape') closePicker();
    };
    closeBtn.addEventListener('click', closePicker);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePicker(); });
    document.addEventListener('keydown', escHandler);

    const pickInsert = (r) => {
      if (!box.contains(tpl)) {
        pendingCommit = false;
        closePicker();
        toast('The editor was refreshed — click Insert container again.', 'error');
        return;
      }
      const at = tpl.selectionStart, atEnd = tpl.selectionEnd;
      tpl.value = tpl.value.slice(0, at) + '[' + r.name + ']' + tpl.value.slice(atEnd);
      const caret = at + r.name.length + 2;
      pendingCommit = false;
      closePicker();
      tpl.setSelectionRange(caret, caret);
      syncTplHighlight();
      updateGenSuggest();
      refreshPanels();
      commit();
    };

    const pickerNav = { rows: [], hi: -1 };
    const paintPickerHi = () => {
      const opts = [...list.children];
      for (let i = 0; i < opts.length; i++) {
        opts[i].classList.toggle('active', i === pickerNav.hi);
        if (i === pickerNav.hi && opts[i].scrollIntoView) opts[i].scrollIntoView({ block: 'nearest' });
      }
    };
    const renderList = (query) => {
      const q = String(query).trim().toLowerCase();
      list.replaceChildren();
      pickerNav.rows = [];
      pickerNav.hi = -1;
      for (const t of state.tables) {
        if (q !== '' && t.name.toLowerCase().indexOf(q) === -1 && t.file.toLowerCase().indexOf(q) === -1) continue;
        const raw = itemsOf(t.file)[t.index];
        pickerNav.rows.push({ name: t.name, file: t.file, id: raw && typeof raw.id === 'string' ? raw.id : '' });
      }
      if (pickerNav.rows.length === 0) {
        list.append(el('div', { class: 'hint' }, 'No containers match.'));
        return;
      }
      for (const r of pickerNav.rows) {
        const opt = el('div', { class: 'gen-picker-item' },
          el('span', { class: 'mono' }, '[' + r.name + ']'),
          el('span', { class: 'hint file-path mono' }, r.file),
        );
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); pickInsert(r); });
        list.append(opt);
      }
    };
    searchInput.addEventListener('input', () => { renderList(searchInput.value); });
    searchInput.addEventListener('keydown', (e) => {
      const n = pickerNav.rows.length;
      if (n === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pickerNav.hi = e.key === 'ArrowDown'
          ? (pickerNav.hi < 0 ? 0 : (pickerNav.hi + 1) % n)
          : (pickerNav.hi < 0 ? n - 1 : (pickerNav.hi - 1 + n) % n);
        paintPickerHi();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickInsert(pickerNav.rows[pickerNav.hi >= 0 ? pickerNav.hi : 0]);
      }
    });
    renderList('');
    searchInput.focus();
  }

  function openOpPicker() {
    if (pickerOpen) return;
    closeGenSuggest();
    const overlay = el('div', { class: 'gen-picker-overlay', id: 'gen-op-picker-panel' });
    const dialog = el('div', {
      class: 'gen-picker-dialog', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Insert logic',
    });
    const closeBtn = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Close operation picker' }, '✕');
    const searchInput = el('input', {
      class: 'field', type: 'search', placeholder: 'Search operations…',
      'aria-label': 'Search operations',
    });
    const list = el('div', { class: 'gen-picker-list' });
    dialog.append(
      el('div', { class: 'examples-head' },
        el('h2', { class: 'examples-title' }, 'Insert logic'),
        closeBtn),
      el('div', { class: 'gen-picker-search' }, searchInput),
      list,
    );
    overlay.append(dialog);
    document.body.append(overlay);
    pickerOpen = true;

    const closePicker = () => {
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      if (!box.contains(tpl)) {
        pickerOpen = false;
        pendingCommit = false;
        const live = box.querySelector('textarea.gen-template');
        if (live) live.focus();
        return;
      }
      tpl.focus();
      pickerClosed();
    };
    const escHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (document.getElementById('ask-text-panel')) return;
      closePicker();
    };
    closeBtn.addEventListener('click', closePicker);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePicker(); });
    document.addEventListener('keydown', escHandler);

    const pickInsertOp = (op, rawName) => {
      if (!box.contains(tpl)) {
        pendingCommit = false;
        closePicker();
        toast('The editor was refreshed — click Insert logic again.', 'error');
        return;
      }
      const name = String(rawName == null ? strOf(op, 'name') : rawName).trim();
      if (name === '') {
        toast('An operation needs a name before it can be inserted.', 'error');
        return;
      }
      const at = tpl.selectionStart, atEnd = tpl.selectionEnd;
      const raw = '{' + name + '}';
      tpl.value = tpl.value.slice(0, at) + raw + tpl.value.slice(atEnd);
      const caret = at + raw.length;
      item.operations = insertGenOperationRef(item.operations, { name, id: strOf(op, 'id') });
      pendingCommit = false;
      closePicker();
      tpl.setSelectionRange(caret, caret);
      syncTplHighlight();
      updateGenSuggest();
      refreshPanels();
      commit();
    };

    const logicPaths = () => [...state.files.keys()]
      .filter((p) => p.startsWith('logic-ops/')).sort();

    const chooseLogicFile = async () => {
      const paths = logicPaths();
      if (paths.length === 0) {
        const answer = await askText({
          title: 'New logic file name (without .json):', initial: 'logic',
        });
        if (answer == null) return null;
        const fileName = sanitizeFileName(answer);
        if (fileName === '') { toast('That file name is not usable.', 'error'); return null; }
        if (!state.storage) { toast('Connect a data source first.', 'error'); return null; }
        const path = 'logic-ops/' + fileName + '.json';
        const text = JSON.stringify({ items: [] }, null, 2) + '\n';
        try {
          await state.storage.createFile(path, text);
          setFile(path, text);
        } catch (e) {
          toast(e.message, 'error');
          return null;
        }
        derive();
        return path;
      }
      if (paths.length === 1) return paths[0];
      const answer = await askText({
        title: 'Logic file for the new operation (one of: ' + paths.join(' · ') + ')',
        initial: paths[0],
      });
      if (answer == null) return null;
      const want = String(answer).trim().toLowerCase();
      const hit = paths.find((p) => p.toLowerCase() === want
        || p.split('/').pop().replace(/\.json$/i, '').toLowerCase() === want);
      if (!hit) { toast('Pick one of the listed logic files.', 'error'); return null; }
      return hit;
    };

    const createLogicOpInFile = async (path, name) => {
      const entry = state.files.get(path);
      if (!entry || entry.error || !entry.parsed) {
        toast('That logic file has a parse error — fix it in the JSON first.', 'error');
        return null;
      }
      if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
      const op = {
        id: 'op_' + randomIdHex(),
        name,
        purpose: '',
        script: '',
        outputTemplate: '',
        imports: [],
        exposed: [],
        bindings: {},
        occurrences: [],
      };
      entry.parsed.items.push(op);
      try {
        await persistLogicOpsFile(path);
      } catch (e) {
        entry.parsed.items.pop();
        toast(e.message, 'error');
        return null;
      }
      derive();
      return op;
    };

    const startNewOp = async () => {
      const answer = await askText({
        title: 'New operation name:', initial: String(searchInput.value || '').trim(),
      });
      if (answer == null) return;
      const name = String(answer).trim();
      if (name === '') { toast('Operation name cannot be empty.', 'error'); return; }
      const key = name.toLowerCase();
      const existing = state.logicOps.find((o) => strOf(o, 'name').trim().toLowerCase() === key);
      if (existing) { pickInsertOp(existing); return; }
      const file = await chooseLogicFile();
      if (file == null) { searchInput.focus(); return; }
      const created = await createLogicOpInFile(file, name);
      if (!created) return;
      pickInsertOp(created, name);
    };

    const pickerNav = { rows: [], hi: -1 };
    const paintPickerHi = () => {
      const opts = [...list.children];
      for (let i = 0; i < opts.length; i++) {
        opts[i].classList.toggle('active', i === pickerNav.hi);
        if (i === pickerNav.hi && opts[i].scrollIntoView) opts[i].scrollIntoView({ block: 'nearest' });
      }
    };
    const createRow = () => {
      const row = el('div', { class: 'gen-picker-item' },
        el('span', { class: 'mono' }, '+ New operation…'),
        el('span', { class: 'hint' }, 'create it, then insert'),
      );
      row.addEventListener('mousedown', (e) => { e.preventDefault(); startNewOp(); });
      return row;
    };
    const renderList = (query) => {
      const q = String(query).trim().toLowerCase();
      list.replaceChildren();
      pickerNav.rows = [{ op: null }];
      pickerNav.hi = -1;
      list.append(createRow());
      for (const op of state.logicOps) {
        const name = strOf(op, 'name').trim();
        if (name === '') continue;
        if (q !== '' && name.toLowerCase().indexOf(q) === -1
          && strOf(op, 'purpose').toLowerCase().indexOf(q) === -1
          && op.file.toLowerCase().indexOf(q) === -1) continue;
        pickerNav.rows.push({ op, name });
      }
      if (pickerNav.rows.length === 1) {
        list.append(el('div', { class: 'hint' }, 'No operations match.'));
        return;
      }
      for (const r of pickerNav.rows.slice(1)) {
        const opt = el('div', { class: 'gen-picker-item' },
          el('span', { class: 'mono' }, '{' + r.name + '}'),
          el('span', { class: 'hint file-path mono' }, (strOf(r.op, 'type') || 'operation') + ' · ' + r.op.file),
        );
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); pickInsertOp(r.op); });
        list.append(opt);
      }
    };
    const activate = (i) => {
      const row = pickerNav.rows[i];
      if (!row) return;
      if (row.op) pickInsertOp(row.op);
      else startNewOp();
    };
    searchInput.addEventListener('input', () => { renderList(searchInput.value); });
    searchInput.addEventListener('keydown', (e) => {
      const n = pickerNav.rows.length;
      if (n === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pickerNav.hi = e.key === 'ArrowDown'
          ? (pickerNav.hi < 0 ? (n > 1 ? 1 : 0) : (pickerNav.hi + 1) % n)
          : (pickerNav.hi < 0 ? n - 1 : (pickerNav.hi - 1 + n) % n);
        paintPickerHi();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const def = pickerNav.rows.length > 1 ? 1 : 0;
        activate(pickerNav.hi >= 0 ? pickerNav.hi : def);
      }
    });
    renderList('');
    searchInput.focus();
  }

  tpl.addEventListener('input', () => {
    syncTplHighlight();
    updateGenSuggest();
    refreshPanels();
  });
  tpl.addEventListener('scroll', () => {
    tplLayer.scrollTop = tpl.scrollTop;
    tplLayer.scrollLeft = tpl.scrollLeft;
  });
  tpl.addEventListener('keydown', (e) => {
    const open = !suggestBox.hidden && genSuggest.items.length > 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      const n = genSuggest.items.length;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      genSuggest.hi = genSuggest.hi < 0
        ? (e.key === 'ArrowDown' ? 0 : n - 1)
        : (genSuggest.hi + delta + n) % n;
      renderGenSuggest(genSuggest.hi);
      return;
    }
    if (e.key === 'Escape') {
      if (open) closeGenSuggest();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (open) {
        selectGenSuggestion(genSuggest.hi >= 0 ? genSuggest.hi : 0);
      } else {
        const s = tpl.selectionStart, en = tpl.selectionEnd;
        tpl.value = tpl.value.slice(0, s) + '  ' + tpl.value.slice(en);
        tpl.selectionStart = tpl.selectionEnd = s + 2;
        syncTplHighlight();
        updateGenSuggest();
        refreshPanels();
      }
      return;
    }
    if (e.key === 'Enter') {
      if (open && genSuggest.hi >= 0) {
        e.preventDefault();
        selectGenSuggestion(genSuggest.hi);
      }
    }
  });
  tpl.addEventListener('blur', () => {
    setTimeout(() => { closeGenSuggest(); }, 150);
  });
  tpl.addEventListener('keyup', () => { syncOpenOpBtn(); });
  tpl.addEventListener('click', () => { syncOpenOpBtn(); });
  tpl.addEventListener('select', () => { syncOpenOpBtn(); });
  nameInput.addEventListener('change', commitOnChange);
  descInput.addEventListener('change', commitOnChange);
  tpl.addEventListener('change', commitOnChange);
  modeSelect.addEventListener('change', async () => {
    const saved = await commit();
    if (saved === 'blocked') {
      applyInputsToItem();
      refreshPanels();
    } else if (saved !== 'ok') return;
    refreshPanels();
  });
  saveBtn.addEventListener('click', onSaveClick);
  cancelBtn.addEventListener('click', onCancelClick);
  insertBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
  insertLogicBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
  insertBtn.addEventListener('click', openGenPicker);
  insertLogicBtn.addEventListener('click', openOpPicker);
  openOpBtn.addEventListener('click', async () => {
    const id = openOpBtn.dataset.opId || '';
    const token = openOpBtn.dataset.token || '';
    const row = id !== ''
      ? state.logicOps.find((o) => o && o.id === id) || findLogicOpRow(token, item.operations)
      : findLogicOpRow(token, item.operations);
    const raw = row ? itemsOf(row.file)[row.index] : null;
    if (!row || !raw) {
      toast('That logic operation no longer exists.', 'error');
      syncOpenOpBtn();
      return;
    }
    const saved = await commit();
    if (saved === 'blocked') {
      applyInputsToItem();
    } else if (saved !== 'ok') {
      syncOpenOpBtn();
      return;
    }
    state.logicFile = row.file;
    state.logicOp = raw;
    state.logicSearch = '';
    switchTab('logic');
  });
  runBtn.addEventListener('click', () => {
    applyInputsToItem();
    runGenItem(file, item);
    renderGenEditor(box, ed);
  });

  refreshPanels();
  const resultNodes = genResultNodes(file, item, () => renderGenEditor(box, state.genEditor || ed));
  for (const n of resultNodes) runArea.append(n);
  if (resultNodes.length === 0) {
    runArea.append(el('div', { class: 'hint' }, 'Run this generator to preview its output here.'));
  }
}

async function onCreateContainerForToken(token, genFile, genItem) {
  if (!state.storage) { toast('Connect a data source first.', 'error'); return; }
  const tablePaths = [...state.files.keys()].filter((p) => p.startsWith('tables/')).sort();
  let targetFile = null;
  if (tablePaths.length === 0) {
    const raw = prompt('No table files yet.\nNew table file name (without extension):', 'tables');
    if (raw == null) return;
    const fileName = sanitizeFileName(raw);
    if (fileName === '') { toast('That file name is not usable.', 'error'); return; }
    targetFile = 'tables/' + fileName + '.json';
    const text = JSON.stringify({ items: [] }, null, 2) + '\n';
    try {
      await state.storage.createFile(targetFile, text);
      setFile(targetFile, text);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
  } else if (tablePaths.length === 1) {
    targetFile = tablePaths[0];
  } else {
    const answer = prompt(
      'Create the container in which file?\n\n' +
      tablePaths.map((p, i) => (i + 1) + '. ' + p).join('\n') +
      '\n\n(1 is the default)'
    );
    if (answer == null) return;
    const t = String(answer).trim();
    if (t === '' || t === '1') {
      targetFile = tablePaths[0];
    } else {
      const n = parseInt(t, 10);
      if (!isFinite(n) || n < 1 || n > tablePaths.length) { toast('Pick one of the listed file numbers.', 'error'); return; }
      targetFile = tablePaths[n - 1];
    }
  }
  const nameAnswer = prompt('New container name:', token);
  if (nameAnswer == null) return;
  const cname = String(nameAnswer).trim();
  if (cname === '') { toast('Container name cannot be empty.', 'error'); return; }
  const ok = await mutateTable(targetFile, (its) => { its.push({ name: cname, entries: [] }); });
  if (!ok) return;
  await ensureContainerIds(targetFile);
  derive();
  const gItems = itemsOf(genFile);
  if (gItems.indexOf(genItem) >= 0 && cname.toLowerCase() !== String(token).toLowerCase()) {
    genItem.template = rewriteTemplateTokens(String(genItem.template), String(token), cname);
  }
  const eng = genEngine();
  if (eng) {
    try {
      genItem.references = eng.resolveReferences(genItem.template, engineContainers(), genItem.references);
    } catch (_) {  }
  }
  if (String(genItem.name || '').trim() !== '') {
    try {
      await persistGeneratorFile(genFile);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
  }
  derive();
  renderAll();
  toast('Created container "' + cname + '" in ' + targetFile);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteTemplateTokens(template, oldT, newT) {
  if (typeof template !== 'string') return template;
  const o = String(oldT).trim();
  const n = String(newT).trim();
  if (o === '' || n === '' || o === n) return template;
  return template.replace(new RegExp('\\[\\s*' + escapeRegExp(o) + '\\s*\\]', 'gi'), '[' + n + ']');
}

function applyContainerRenameToOccurrences(occurrences, containerId, oldName, newName, uniquelyResolves) {
  const rows = Array.isArray(occurrences) ? occurrences : [];
  const id = (typeof containerId === 'string') ? containerId : '';
  const oldKey = String(oldName == null ? '' : oldName).trim().toLowerCase();
  const newT = String(newName == null ? '' : newName).trim();
  if (newT === '' || (id === '' && oldKey === '')) return rows;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.kind !== 'ref') continue;
    const byId = id !== '' && row.refId === id;
    const byOldToken = row.refId == null && oldKey !== ''
      && String(row.token == null ? '' : row.token).trim().toLowerCase() === oldKey;
    if (!byId && !byOldToken) continue;
    row.token = newT;
    if (row.refId == null && uniquelyResolves && id !== '') row.refId = id;
  }
  return rows;
}

function applyOpRenameToOccurrences(occurrences, operationId, oldTokenKeys, newName, resolvedRef) {
  const rows = Array.isArray(occurrences) ? occurrences : [];
  const id = (typeof operationId === 'string') ? operationId : '';
  const keys = new Set(Array.isArray(oldTokenKeys) ? oldTokenKeys : []);
  const newT = String(newName == null ? '' : newName).trim();
  if (newT === '' || (id === '' && keys.size === 0)) return rows;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.kind !== 'op') continue;
    const key = String(row.token == null ? '' : row.token).trim().toLowerCase();
    const byId = id !== '' && row.refId === id;
    const byOldToken = row.refId == null && key !== '' && keys.has(key);
    if (!byId && !byOldToken) continue;
    row.token = newT;
    if (row.refId == null && id !== '' && resolvedRef) row.refId = id;
  }
  return rows;
}

function propagateContainerRename(containerId, oldName, newName) {
  if (!containerId) return;
  const oldT = String(oldName).trim();
  const newT = String(newName).trim();
  if (oldT === '' || newT === '' || oldT === newT) return;
  const eng = genEngine();
  const dirtyFiles = new Set();
  let touched = 0;
  const newKey = newT.toLowerCase();
  const occMatches = engineContainers().filter((c) =>
    String(c.name == null ? '' : c.name).trim().toLowerCase() === newKey);
  const occUnique = occMatches.length === 1
    && typeof occMatches[0].id === 'string' && occMatches[0].id === containerId;
  for (const g of state.generators) {
    const raw = itemsOf(g.file)[g.index];
    if (!raw || typeof raw !== 'object') continue;
    if (!Array.isArray(raw.references)) raw.references = [];
    let changed = false;
    for (const ref of raw.references) {
      if (ref && ref.containerId === containerId) { ref.token = newT; changed = true; }
    }
    if (typeof raw.template === 'string') {
      const next = rewriteTemplateTokens(raw.template, oldT, newT);
      if (next !== raw.template) { raw.template = next; changed = true; }
    }
    if (!changed) continue;
    if (eng) {
      try {
        raw.references = eng.resolveReferences(raw.template, engineContainers(), raw.references);
      } catch (_) {  }
    }
    if (Array.isArray(raw.occurrences) && raw.occurrences.length > 0) {
      applyContainerRenameToOccurrences(raw.occurrences, containerId, oldT, newT, occUnique);
    }
    dirtyFiles.add(g.file);
    touched++;
  }
  for (const file of dirtyFiles) {
    persistGeneratorFile(file).catch((e) => { toast(e.message, 'error'); });
  }
  if (touched > 0) {
    toast('Renamed container — updated ' + touched + ' generator' + (touched === 1 ? '' : 's') + ' that reference it.');
  }
}

function findGeneratorOpRenameRefs(operationId, oldName) {
  const plan = [];
  const eng = genEngine();
  const id = typeof operationId === 'string' ? operationId : '';
  const oldKey = String(oldName == null ? '' : oldName).trim().toLowerCase();
  if (oldKey === '' && id === '') return plan;
  if (!eng || typeof eng.parseEmbeds !== 'function') return plan;
  for (const g of state.generators) {
    const raw = itemsOf(g.file)[g.index];
    if (!raw || typeof raw.template !== 'string') continue;
    const refs = Array.isArray(raw.operations) ? raw.operations : [];
    const byToken = new Map();
    for (const r of refs) {
      if (!r || typeof r.token !== 'string') continue;
      const k = r.token.trim().toLowerCase();
      if (k !== '') byToken.set(k, r);
    }
    const spans = [];
    const tokens = new Set();
    for (const seg of eng.parseEmbeds(raw.template)) {
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
    plan.push({ file: g.file, index: g.index, operationId: id, spans, tokens: Array.from(tokens) });
  }
  return plan;
}

async function rewriteGeneratorOpRefs(plan, newName) {
  const byFile = new Map();
  for (const p of plan) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  const name = String(newName == null ? '' : newName).trim();
  let files = 0;
  let templates = 0;
  let spans = 0;
  const failed = [];
  for (const [file, targets] of byFile) {
    const entry = state.files.get(file);
    if (!entry || !entry.parsed) continue;
    const items = itemsOf(file);
    const before = JSON.stringify(items);
    let changedSpans = 0;
    let changedItems = 0;
    for (const p of targets) {
      const it = items[p.index];
      if (!it || typeof it.template !== 'string') continue;
      const snapshot = JSON.stringify(it);
      let tpl = it.template;
      const ordered = p.spans.slice().sort((a, b) => b.start - a.start);
      for (const s of ordered) {
        const replacement = '{' + name + '}';
        if (tpl.slice(s.start, s.end) !== replacement) changedSpans++;
        tpl = tpl.slice(0, s.start) + replacement + tpl.slice(s.end);
      }
      if (tpl !== it.template) it.template = tpl;
      if (!Array.isArray(it.operations)) it.operations = [];
      const keys = new Set(p.tokens);
      for (const ref of it.operations) {
        if (!ref || typeof ref.token !== 'string') continue;
        const key = ref.token.trim().toLowerCase();
        const refId = typeof ref.operationId === 'string' ? ref.operationId : '';
        const idMatch = p.operationId !== '' && refId === p.operationId;
        if (idMatch || (keys.has(key) && refId === '')) ref.token = name;
      }
      it.operations = genOperationRefs(it.template, it.operations);
      if (Array.isArray(it.occurrences) && it.occurrences.length > 0) {
        const resolvedRef = it.operations.find((r) =>
          r && typeof r.operationId === 'string' && r.operationId === p.operationId) || null;
        applyOpRenameToOccurrences(it.occurrences, p.operationId, p.tokens, name, resolvedRef);
      }
      if (JSON.stringify(it) !== snapshot) changedItems++;
    }
    if (changedItems === 0) continue;
    try {
      await persistGeneratorFile(file);
      files++;
      templates += changedItems;
      spans += changedSpans;
    } catch (e) {
      const parsed = JSON.parse(before);
      entry.parsed.items = parsed;
      failed.push(file);
      toast(e.message, 'error');
    }
  }
  return { files, templates, spans, failed };
}

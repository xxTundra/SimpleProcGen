
function opReferences(name) {
  const key = (typeof name === 'string' ? name : '').trim().toLowerCase();
  const templates = [];
  const entries = [];
  let total = 0;
  const countSpans = (text) => {
    if (key === '' || typeof text !== 'string') return 0;
    let n = 0;
    for (const seg of GeneratorEngine.parseEmbeds(text)) {
      if (seg.type === 'op' && seg.inner.trim().toLowerCase() === key) n++;
    }
    return n;
  };
  for (const g of state.generators) {
    const n = countSpans(strOf(g, 'template'));
    if (n > 0) {
      templates.push({ file: g.file, name: strOf(g, 'name'), count: n });
      total += n;
    }
  }
  for (const t of state.tables) {
    const list = Array.isArray(t.entries) ? t.entries : [];
    for (const e of list) {
      const label = (e && typeof e.label === 'string') ? e.label : '';
      const n = countSpans(label);
      if (n > 0) {
        entries.push({ file: t.file, table: strOf(t, 'name'), label, count: n });
        total += n;
      }
    }
  }
  return { templates, entries, total };
}

async function persistLogicOpsFile(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) return;
  if (!Array.isArray(entry.parsed.items)) entry.parsed.items = [];
  const clean = entry.parsed.items.filter((it) => it && typeof it.name === 'string' && it.name.trim() !== '');
  const text = JSON.stringify({ items: clean }, null, 2) + '\n';
  await state.storage.writeFile(path, text);
  entry.text = text;
}


async function createNewLogicOpsFile(name) {
  const fileName = sanitizeFileName(name);
  if (fileName === '') {
    toast('That file name is not usable.', 'error');
    return;
  }
  const path = 'logic-ops/' + fileName + '.json';
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

async function onNewLogicOpsFile() {
  const name = await askText({ title: 'New logic file name (without .json):', initial: 'new-logic' });
  if (name == null) return;
  createNewLogicOpsFile(name);
}

async function renameLogicOpsFile(oldPath, name) {
  const entry = state.files.get(oldPath);
  if (!entry) return;
  const fileName = sanitizeFileName(name);
  if (fileName === '') {
    toast('That file name is not usable.', 'error');
    return;
  }
  const newPath = 'logic-ops/' + fileName + '.json';
  if (newPath === oldPath) {
    renderAll();
    return;
  }
  if (state.files.has(newPath)) {
    toast('A file named ' + newPath + ' already exists.', 'error');
    return;
  }
  try {
    await state.storage.createFile(newPath, entry.text);
    await state.storage.deleteFile(oldPath);
    state.files.delete(oldPath);
    setFile(newPath, entry.text);
    if (state.logicFile === oldPath) state.logicFile = newPath;
    derive();
    renderAll();
    toast('Renamed ' + oldPath + ' to ' + newPath);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onRenameLogicOpsFile(path) {
  const current = path.split('/').pop().replace(/\.json$/i, '');
  const name = await askText({ title: 'Rename ' + path + ' (without .json):', initial: current });
  if (name == null) return;
  renameLogicOpsFile(path, name);
}

async function deleteLogicOpsFile(path) {
  try {
    await state.storage.deleteFile(path);
    state.files.delete(path);
    if (state.logicFile === path) {
      state.logicFile = null;
      state.logicOp = null;
    }
    derive();
    renderAll();
    toast('Deleted ' + path);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function onLogicDeleteFile(path) {
  if (!confirm('Delete ' + path + '? This cannot be undone.')) return;
  deleteLogicOpsFile(path);
}


function filterLogicOps(items, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (q === '') return items;
  return items.filter((it) => it && typeof it === 'object' && !Array.isArray(it) &&
    (strOf(it, 'name').toLowerCase().includes(q) || strOf(it, 'purpose').toLowerCase().includes(q)));
}

function findOperationNameClash(item, name) {
  const key = String(name == null ? '' : name).trim().toLowerCase();
  if (key === '') return null;
  for (const [path, entry] of state.files) {
    if (!path.startsWith('logic-ops/') || !entry || !entry.parsed) continue;
    const items = Array.isArray(entry.parsed.items) ? entry.parsed.items : [];
    for (const it of items) {
      if (!it || typeof it !== 'object' || it === item) continue;
      if (strOf(it, 'name').trim().toLowerCase() === key) return { path, name: strOf(it, 'name') };
    }
  }
  return null;
}

async function renameOperation(path, item, newName) {
  if (!item || typeof item !== 'object') return { ok: false, reason: 'invalid-item' };
  const entry = state.files.get(path);
  if (!entry || !entry.parsed) {
    toast('That file has a parse error — fix it in the JSON first.', 'error');
    return { ok: false, reason: 'parse-error' };
  }
  const oldName = strOf(item, 'name').trim();
  const name = String(newName == null ? '' : newName).trim();
  if (name === '') {
    toast('An operation needs a name — rename cancelled.', 'error');
    return { ok: false, reason: 'empty-name' };
  }
  if (name.indexOf('{') !== -1 || name.indexOf('}') !== -1) {
    toast('Operation names cannot contain braces — {name} is how a reference is written.', 'error');
    return { ok: false, reason: 'invalid-name' };
  }
  const clash = findOperationNameClash(item, name);
  if (clash) {
    toast('An operation named "' + name + '" already exists in ' + clash.path
      + ' — operation names are case-insensitive.', 'error');
    return { ok: false, reason: 'duplicate-name' };
  }
  if (name === oldName) {
    try {
      await persistLogicOpsFile(path);
    } catch (e) {
      toast(e.message, 'error');
      return { ok: false, reason: 'write-failed' };
    }
    derive();
    renderAll();
    return { ok: true, partial: false, unchanged: true, templates: 0, entries: 0, spans: 0, entrySpans: 0, files: 1, failed: [] };
  }
  const opId = strOf(item, 'id');
  const genPlan = findGeneratorOpRenameRefs(opId, oldName);
  const entryPlan = findEntryOpRefs(opId, oldName);
  item.name = name;
  try {
    await persistLogicOpsFile(path);
  } catch (e) {
    item.name = oldName;
    toast(e.message, 'error');
    return { ok: false, reason: 'write-failed' };
  }
  derive();
  const gen = genPlan.length > 0
    ? await rewriteGeneratorOpRefs(genPlan, name)
    : { files: 0, templates: 0, spans: 0, failed: [] };
  const tbl = entryPlan.length > 0
    ? await rewriteEntryOpRefs(entryPlan, name)
    : { files: 0, entries: 0, spans: 0, failed: [] };
  derive();
  renderAll();
  const parts = [];
  if (gen.templates > 0) {
    parts.push(gen.templates + ' generator template' + (gen.templates === 1 ? '' : 's'));
  }
  if (tbl.entries > 0) parts.push(tbl.entries + ' table entr' + (tbl.entries === 1 ? 'y' : 'ies'));
  const from = oldName === '' ? 'the operation' : '"' + oldName + '"';
  const failed = gen.failed.concat(tbl.failed);
  if (failed.length > 0) {
    toast('Renamed ' + from + ' to "' + name + '" — updated '
      + (parts.length === 0 ? 'nothing' : parts.join(' and '))
      + ', but could not update ' + failed.join(', ')
      + '. Those files still contain the old token — fix them by hand, or rename '
      + 'the operation back to "' + oldName + '" and rename it again to retry.',
      'error');
  } else {
    toast(parts.length === 0
      ? 'Renamed ' + from + ' to "' + name + '" — no template or entry referenced it.'
      : 'Renamed ' + from + ' to "' + name + '" — updated ' + parts.join(' and ') + '.');
  }
  return {
    ok: true,
    partial: failed.length > 0,
    templates: gen.templates,
    entries: tbl.entries,
    spans: gen.spans,
    entrySpans: tbl.spans,
    files: 1 + gen.files + tbl.files,
    failed,
  };
}

async function onRenameLogicOp(path, item) {
  const name = await askText({ title: 'Rename operation:', initial: strOf(item, 'name') });
  if (name == null) return;
  await renameOperation(path, item, name);
}

async function deleteOperation(path, item) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed || !Array.isArray(entry.parsed.items)) return;
  const i = entry.parsed.items.indexOf(item);
  if (i < 0) return;
  entry.parsed.items.splice(i, 1);
  if (state.logicOp === item) state.logicOp = null;
  try {
    await persistLogicOpsFile(path);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  derive();
  renderAll();
}

async function onLogicDeleteOp(path, item) {
  const refs = opReferences(strOf(item, 'name'));
  const label = strOf(item, 'name').trim() === '' ? 'this operation' : '"' + strOf(item, 'name') + '"';
  const parts = [];
  if (refs.templates.length > 0) parts.push(refs.templates.length + ' generator template' + (refs.templates.length === 1 ? '' : 's'));
  if (refs.entries.length > 0) parts.push(refs.entries.length + ' table entr' + (refs.entries.length === 1 ? 'y' : 'ies'));
  const note = parts.length === 0
    ? 'Nothing references it yet.'
    : 'It is referenced by ' + parts.join(' and ') + '; those references are not updated (no cascade).';
  if (!confirm('Delete ' + label + '? ' + note + ' This cannot be undone.')) return;
  await deleteOperation(path, item);
}


let logicImportErrors = [];

function isScriptLogicOp(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  return strOf(item, 'type') === '' && typeof item.script === 'string';
}

function newLogicOpDraft() {
  return {
    id: newOpId(),
    name: '',
    purpose: '',
    script: '',
    outputTemplate: '',
    imports: [],
    exposed: [],
    bindings: {},
    occurrences: [],
  };
}

function reconcileOpOccurrences(oldRows, script) {
  const old = Array.isArray(oldRows) ? oldRows : [];
  const used = new Set();
  return computeOpOccurrences(script).map((row) => {
    for (const o of old) {
      if (!o || typeof o !== 'object') continue;
      if (used.has(o.instanceId)) continue;
      if (o.token !== row.token) continue;
      used.add(o.instanceId);
      return {
        instanceId: o.instanceId,
        token: row.token,
        refId: (o.refId === undefined ? null : o.refId),
        offset: row.offset,
      };
    }
    return row;
  });
}

function normalizeLogicOpInPlace(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  item.script = typeof item.script === 'string' ? item.script : '';
  item.outputTemplate = typeof item.outputTemplate === 'string' ? item.outputTemplate : '';
  item.imports = deriveScriptImports(item.script);
  item.exposed = deriveScriptExposed(item.script);
  item.occurrences = reconcileOpOccurrences(item.occurrences, item.script);
  item.bindings = (item.bindings && typeof item.bindings === 'object' && !Array.isArray(item.bindings))
    ? item.bindings
    : {};
  const ids = new Set(item.occurrences.map((r) => r.instanceId));
  for (const k of Object.keys(item.bindings)) {
    if (!ids.has(k)) delete item.bindings[k];
  }
  return item;
}

function allRawLogicOps() {
  const out = [];
  const paths = [...state.files.keys()].filter((p) => p.startsWith('logic-ops/')).sort();
  for (const p of paths) {
    for (const it of itemsOf(p)) {
      if (it && typeof it === 'object' && !Array.isArray(it)) out.push(it);
    }
  }
  return out;
}

function allScriptLogicOps() {
  return allRawLogicOps().filter(isScriptLogicOp);
}

function logicHighlightSpans(source) {
  const text = typeof source === 'string' ? source : '';
  const LL = (typeof LogicLanguage !== 'undefined') ? LogicLanguage : null;
  if (!LL || typeof LL.highlightTokens !== 'function') {
    return [{ text: text, category: 'text', cls: '', token: '' }];
  }
  const map = (LL.HIGHLIGHT && typeof LL.HIGHLIGHT === 'object') ? LL.HIGHLIGHT : {};
  return LL.highlightTokens(text).map((t) => {
    const cat = (t && typeof t.category === 'string') ? t.category : 'text';
    const h = (map[cat] && typeof map[cat] === 'object') ? map[cat] : null;
    return {
      text: (t && typeof t.text === 'string') ? t.text : '',
      category: cat,
      cls: (h && typeof h.cls === 'string') ? h.cls : '',
      token: (h && typeof h.token === 'string') ? h.token : '',
    };
  });
}

function templateHighlightSpans(template) {
  const text = typeof template === 'string' ? template : '';
  const out = [];
  const RE = /%([^%]*)%/g;
  let last = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    out.push({ text: text.slice(last, m.index), category: 'text', cls: '', token: '' });
    const name = normalizeOpVarName(m[1]);
    out.push({
      text: m[0],
      category: name === null ? 'text' : 'variable',
      cls: name === null ? '' : 'script-var',
      token: name === null ? '' : '--script-var',
    });
    last = m.index + m[0].length;
  }
  out.push({ text: text.slice(last), category: 'text', cls: '', token: '' });
  return out;
}

function scriptEditorModel(script) {
  const text = typeof script === 'string' ? script : '';
  const lineCount = text.split('\n').length;
  const gutter = [];
  for (let i = 1; i <= lineCount; i++) gutter.push(String(i));
  return { lineCount: lineCount, gutter: gutter, spans: logicHighlightSpans(text) };
}

function collectScriptNames(script) {
  const text = typeof script === 'string' ? script : '';
  const out = { ok: false, assigned: [], imported: [], exposed: [], errors: [] };
  const LL = (typeof LogicLanguage !== 'undefined') ? LogicLanguage : null;
  if (!LL || typeof LL.parseScript !== 'function') {
    out.errors = [{ kind: 'parse-unavailable', line: 0, message: 'script language not loaded' }];
    return out;
  }
  const parsed = LL.parseScript(text);
  out.errors = Array.isArray(parsed && parsed.errors) ? parsed.errors : [];
  out.ok = !!(parsed && parsed.ok === true);
  const assigned = new Set();
  const imported = new Set();
  const exposed = new Set();
  const walk = (list) => {
    for (const st of (Array.isArray(list) ? list : [])) {
      if (!st || typeof st !== 'object') continue;
      if (st.type === 'set' && typeof st.name === 'string') assigned.add(st.name);
      else if (st.type === 'import' && typeof st.name === 'string') imported.add(st.name);
      else if (st.type === 'expose' && typeof st.name === 'string') exposed.add(st.name);
      else if (st.type === 'if') {
        walk(st.thenBody);
        for (const ei of (Array.isArray(st.elseIfs) ? st.elseIfs : [])) walk(ei && ei.body);
        walk(st.elseBody);
      } else if (st.type === 'switch') {
        for (const cs of (Array.isArray(st.cases) ? st.cases : [])) walk(cs && cs.body);
      }
    }
  };
  walk(parsed && parsed.statements);
  out.assigned = [...assigned];
  out.imported = [...imported];
  out.exposed = [...exposed];
  return out;
}

function checkExposeDataflow(script, inputNames, names, errors, warnings) {
  const pushErrors = Array.isArray(errors) ? errors : null;
  const pushWarnings = Array.isArray(warnings) ? warnings : null;
  if (!pushErrors || !pushWarnings) return;
  const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null;
  const parser = (g && g.LogicLanguage && typeof g.LogicLanguage.parseScript === 'function')
    ? g.LogicLanguage.parseScript
    : null;
  if (!parser) return;
  const parsed = parser(script);
  if (!(parsed && parsed.ok === true)) return;
  const inputs = new Set();
  if (Array.isArray(inputNames)) {
    for (const n of inputNames) if (typeof n === 'string') inputs.add(n);
  }
  const assignedAll = new Set((Array.isArray(names && names.assigned) ? names.assigned : [])
    .map((x) => normalizeOpVarName(x)).filter((x) => x != null));
  const seen = new Set();
  const report = (n, line) => {
    if (seen.has(n)) return;
    seen.add(n);
    if (assignedAll.has(n)) {
      pushWarnings.push({
        severity: 'warning', line: line, kind: 'expose-branch-only-variable', varName: n,
        message: 'EXPOSE %' + n + '% can run with no value: %' + n + '% is only SET on some code paths',
      });
    } else {
      pushErrors.push({
        severity: 'error', line: line, kind: 'expose-undefined-variable', varName: n,
        message: 'EXPOSE %' + n + '% has no value: %' + n + '% is never SET or IMPORTed, so it can never be exposed',
      });
    }
  };
  const walk = (statements, acc) => {
    for (const st of (Array.isArray(statements) ? statements : [])) {
      if (!st || typeof st !== 'object') continue;
      const n = normalizeOpVarName(st.name);
      const line = (typeof st.line === 'number') ? st.line : 0;
      if (st.type === 'expose') {
        if (n != null && !acc.has(n)) report(n, line);
      } else if (st.type === 'set') {
        if (n != null) acc.add(n);
      } else if (st.type === 'import') {
        if (n != null && inputs.has(n)) acc.add(n);
      } else if (st.type === 'if') {
        const ends = [walk(st.thenBody, new Set(acc))];
        for (const ei of (Array.isArray(st.elseIfs) ? st.elseIfs : [])) ends.push(walk(ei && ei.body, new Set(acc)));
        ends.push(Array.isArray(st.elseBody) ? walk(st.elseBody, new Set(acc)) : new Set(acc));
        intersectInto(acc, ends);
      } else if (st.type === 'switch') {
        const cases = Array.isArray(st.cases) ? st.cases : [];
        const ends = [];
        let hasDefault = false;
        for (const cs of cases) {
          if (cs && cs.isDefault) hasDefault = true;
          ends.push(walk(cs && cs.body, new Set(acc)));
        }
        if (!hasDefault) ends.push(new Set(acc));
        intersectInto(acc, ends);
      }
    }
    return acc;
  };
  walk(parsed.statements, new Set(inputs));
}

function logicValidationReport(script, template, importNames) {
  const errors = [];
  const warnings = [];
  const names = collectScriptNames(script);
  const LL = (typeof LogicLanguage !== 'undefined') ? LogicLanguage : null;
  if (!LL || typeof LL.parseScript !== 'function') {
    errors.push({
      severity: 'error', line: 0, kind: 'parse-unavailable',
      message: 'The code language is not loaded, so the code cannot be checked.',
    });
    return { ok: false, errors: errors, warnings: warnings, names: names };
  }
  for (const e of names.errors) {
    errors.push({
      severity: 'error',
      line: (e && typeof e.line === 'number') ? e.line : 0,
      kind: (e && typeof e.kind === 'string') ? e.kind : 'parse-error',
      message: (e && typeof e.message === 'string' && e.message !== '')
        ? e.message
        : ('Parse error: ' + ((e && e.kind) || 'unknown')),
    });
  }
  const inputs = Array.isArray(importNames) ? importNames : names.imported;
  const tpl = typeof template === 'string' ? template : '';
  if (tpl.trim() !== '') {
    const flow = validateOutputTemplateDataflow(script, tpl, inputs);
    if (names.ok) {
      const known = new Set([].concat(names.assigned, names.imported));
      for (const n of flow.warnings) {
        if (!known.has(n)) {
          errors.push({
            severity: 'error', line: 0, kind: 'unknown-template-variable', varName: n,
            message: 'The Output Template uses %' + n + '%, but the code never sets it.',
          });
        } else {
          warnings.push({
            severity: 'warning', line: 0, kind: 'maybe-unset-template-variable', varName: n,
            message: '%' + n + '% is only set on some code paths, so the template can fail at runtime',
          });
        }
      }
    } else if (flow.warnings.length > 0) {
      warnings.push({
        severity: 'warning', line: 0, kind: 'dataflow-deferred',
        message: 'Fix the code errors first; Output Template variables cannot be checked yet.',
      });
    }
  }
  if (names.ok) checkExposeDataflow(script, inputs, names, errors, warnings);
  return { ok: errors.length === 0, errors: errors, warnings: warnings, names: names };
}


function dedupeStrings(list) {
  const seen = new Set();
  const out = [];
  for (const v of (Array.isArray(list) ? list : [])) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    const key = v.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function nearestOpenDelimiter(text, pos) {
  const pairs = [['%', '%'], ['[', ']'], ['{', '}'], ['|', '|']];
  let best = null;
  for (const pair of pairs) {
    const oi = text.lastIndexOf(pair[0], pos - 1);
    if (oi === -1) continue;
    if (text.slice(oi + 1, pos).indexOf(pair[1]) !== -1) continue;
    if (best === null || oi > best.index) best = { index: oi, open: pair[0], close: pair[1] };
  }
  return best;
}

function autocompleteSuggestions(script, caret, context, options) {
  const text = typeof script === 'string' ? script : '';
  const pos = Math.max(0, Math.min(typeof caret === 'number' ? caret : 0, text.length));
  const ctx = (context && typeof context === 'object' && !Array.isArray(context)) ? context : {};
  const opts = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
  const isTemplate = opts.templateOnly === true;
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const beforeLine = text.slice(lineStart, pos);
  if (((beforeLine.match(/"/g) || []).length % 2) === 1) return null;
  const names = collectScriptNames(text);
  const variables = dedupeStrings([].concat(ctx.variables || [], names.imported || [], names.assigned || []));
  const keywords = dedupeStrings(ctx.keywords || []);
  const containers = dedupeStrings(ctx.containers || []);
  const macros = dedupeStrings(ctx.macros || []);
  const operations = dedupeStrings(ctx.operations || []);
  const dice = dedupeStrings(ctx.dice || []);
  const match = (list, q) => list.filter((n) => q === '' || n.toLowerCase().indexOf(q) === 0);

  const delim = nearestOpenDelimiter(text, pos);
  if (delim) {
    if (isTemplate && delim.open !== '%') return null;
    const q = text.slice(delim.index + 1, pos).trim().toLowerCase();
    let items = [];
    if (delim.open === '%') {
      items = match(variables, q).map((n) => ({ label: '%' + n + '%', insert: '%' + n + '%', kind: 'variable' }));
    } else if (delim.open === '[') {
      items = match(containers, q).map((n) => ({ label: n, insert: '[' + n + ']', kind: 'container' }));
    } else if (delim.open === '{') {
      items = match(operations, q).map((n) => ({ label: n, insert: '{' + n + '}', kind: 'operation' }));
    } else if (delim.open === '|') {
      items = match(macros, q).map((n) => ({ label: n, insert: '|' + n + '|', kind: 'macro' }))
        .concat(match(dice, q).map((n) => ({ label: n, insert: '|' + n + '|', kind: 'dice' })));
    }
    if (items.length === 0) return null;
    return { start: delim.index, end: pos, items: items.slice(0, 8) };
  }
  if (isTemplate) return null;
  const word = /[\p{L}\p{M}_][\p{L}\p{M}\p{N}_ ]*$/u.exec(beforeLine);
  if (!word) return null;
  const prefix = word[0];
  const q = prefix.toLowerCase();
  const items = [];
  for (const k of keywords) {
    if (k.toLowerCase().indexOf(q) === 0) items.push({ label: k, insert: k, kind: 'keyword' });
  }
  for (const v of variables) {
    if (v.toLowerCase().indexOf(q) === 0) items.push({ label: v, insert: v, kind: 'variable' });
  }
  if (items.length === 0) return null;
  return { start: pos - prefix.length, end: pos, items: items.slice(0, 8) };
}

function applyAutocomplete(text, start, end, insert) {
  const src = typeof text === 'string' ? text : '';
  const s = Math.max(0, Math.min(typeof start === 'number' ? start : 0, src.length));
  const e = Math.max(s, Math.min(typeof end === 'number' ? end : s, src.length));
  const ins = typeof insert === 'string' ? insert : '';
  return { text: src.slice(0, s) + ins + src.slice(e), caret: s + ins.length };
}

function logicAutocompleteContext() {
  const LL = (typeof LogicLanguage !== 'undefined') ? LogicLanguage : null;
  const keywords = LL && Array.isArray(LL.KEYWORDS) ? LL.KEYWORDS.slice() : [];
  keywords.push('true', 'false');
  const containers = [];
  for (const t of (Array.isArray(state.tables) ? state.tables : [])) {
    if (t && typeof t.name === 'string') containers.push(t.name);
  }
  const macros = [];
  for (const m of (Array.isArray(state.macros) ? state.macros : [])) {
    if (m && typeof m.name === 'string') macros.push(m.name);
  }
  const operations = [];
  for (const o of allRawLogicOps()) {
    if (o && typeof o.name === 'string') operations.push(o.name);
  }
  return {
    keywords: keywords,
    variables: [],
    containers: containers,
    macros: macros,
    operations: operations,
    dice: ['1d20', '2d12', '2d6', '1d100', '1d8'],
  };
}

function logicTestInputType(raw) {
  const text = typeof raw === 'string' ? raw : String(raw == null ? '' : raw);
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (typeof isLogicNumericText === 'function' && isLogicNumericText(trimmed)) return 'number';
  return 'string';
}

function buildTestValues(names, rawByName) {
  const values = {};
  const types = {};
  const missing = [];
  const list = Array.isArray(names) ? names : [];
  const raw = (rawByName && typeof rawByName === 'object' && !Array.isArray(rawByName)) ? rawByName : {};
  for (const name of list) {
    const input = Object.prototype.hasOwnProperty.call(raw, name) ? raw[name] : '';
    const text = typeof input === 'string' ? input : String(input == null ? '' : input);
    const type = logicTestInputType(text);
    if (type === null) {
      missing.push(name);
      continue;
    }
    if (type === 'boolean') values[name] = text.trim() === 'true';
    else if (type === 'number') values[name] = Number(text.trim());
    else values[name] = text;
    types[name] = type;
  }
  return { values: values, types: types, missing: missing };
}

function runLogicOpTest(item, values) {
  const ctx = entryEmbedContext('');
  return GeneratorEngine.executeOperation(item, {
    macros: ctx.macros,
    evalExpr: ctx.evalExpr,
    containers: ctx.containers,
    operations: allRawLogicOps(),
    tableFile: '',
    rng: Math.random,
    values: (values && typeof values === 'object' && !Array.isArray(values)) ? values : {},
    operationDepth: 0,
  });
}

function traceValueText(v) {
  if (v && typeof v === 'object' && typeof v.type === 'string') {
    if (v.type === 'string') return '"' + String(v.value) + '"';
    return String(v.value);
  }
  return String(v);
}

function traceRowOf(entry) {
  const e = (entry && typeof entry === 'object') ? entry : {};
  const kind = typeof e.kind === 'string' ? e.kind : 'unknown';
  const row = {
    step: (typeof e.step === 'number') ? e.step : 0,
    kind: kind,
    line: (typeof e.line === 'number') ? e.line : 0,
    title: kind.toUpperCase(),
    details: [],
  };
  const roll = e.roll && typeof e.roll === 'object' ? e.roll : null;
  const rollText = () => {
    if (!roll) return null;
    let s = 'rolled ' + roll.token + ' → ' + roll.output;
    if (typeof roll.weight === 'number') s += ' (weight ' + roll.weight + ')';
    if (typeof roll.entryLabel === 'string' && roll.entryLabel !== '') s += ' (entry: ' + roll.entryLabel + ')';
    if (Array.isArray(roll.children) && roll.children.length > 0) s += ' · ' + roll.children.length + ' nested resolution(s)';
    return s;
  };
  if (kind === 'import') {
    row.title = 'IMPORT %' + String(e.name) + '%';
    row.details.push(String(e.name) + ' = ' + traceValueText({ type: e.type, value: e.value }) + '  (' + e.type + ')');
    row.details.push('source: ' + (e.source === 'test-input' ? 'test input' : (e.source || 'test input')));
  } else if (kind === 'set') {
    row.title = 'SET ' + String(e.name);
    row.details.push(String(e.name) + ' = ' + traceValueText({ type: e.type, value: e.value }) + '  (' + e.type + ')');
    if (e.source) row.details.push('from: ' + e.source);
    if (rollText()) row.details.push(rollText());
  } else if (kind === 'expose') {
    row.title = 'EXPOSE ' + String(e.name);
    row.details.push(String(e.name) + ' = ' + traceValueText({ type: e.type, value: e.value }) + '  (' + e.type + ')');
  } else if (kind === 'if') {
    row.title = 'IF' + (row.line > 0 ? ' (line ' + row.line + ')' : '');
    row.details.push('branch: ' + (e.branch ? e.branch : 'none (no ELSE)'));
    for (const ev of (Array.isArray(e.evaluations) ? e.evaluations : [])) {
      row.details.push(ev.clause + ' → ' + (ev.result ? 'true' : 'false'));
      for (const c of (Array.isArray(ev.checks) ? ev.checks : [])) {
        row.details.push('   ' + traceValueText(c.left) + ' ' + String(c.op) + ' ' + traceValueText(c.right) + ' → ' + (c.result ? 'true' : 'false'));
      }
    }
  } else if (kind === 'switch') {
    row.title = 'SWITCH' + (row.line > 0 ? ' (line ' + row.line + ')' : '');
    row.details.push('subject = ' + traceValueText(e.subject));
    for (const c of (Array.isArray(e.comparisons) ? e.comparisons : [])) {
      row.details.push(c.clause + ': ' + traceValueText(c.value) + (c.equal ? ' = ' : ' ≠ ') + traceValueText(e.subject) + ' → ' + (c.equal ? 'match' : 'no match'));
    }
    row.details.push('branch: ' + (e.branch ? e.branch : 'none'));
    if (roll) row.details.push(rollText());
  } else {
    row.details.push(JSON.stringify(e));
  }
  return row;
}

function traceRows(trace) {
  return (Array.isArray(trace) ? trace : []).map(traceRowOf);
}

function logicRunErrorMessage(err) {
  const e = (err && typeof err === 'object') ? err : {};
  const kind = typeof e.kind === 'string' ? e.kind : 'error';
  const line = (typeof e.line === 'number' && e.line > 0) ? 'line ' + e.line + ': ' : '';
  const msg = (typeof e.message === 'string' && e.message !== '') ? e.message : '';
  const varName = typeof e.varName === 'string' ? e.varName : '';
  switch (kind) {
    case 'missing-import':
      if (varName) {
        return 'Missing value for the imported variable %' + varName + '% — supply it in the test inputs (no defaults are used).';
      }
      return 'Missing value' + (msg ? ': ' + msg : ' — supply every imported variable in the test inputs (no defaults are used).');
    case 'invalid-import':
      return 'The test value' + (varName ? ' for %' + varName + '%' : '') + ' is not a number, string or boolean.';
    case 'missing-variable':
      if (e.origin === 'expose') {
        return 'EXPOSE: variable' + (varName ? ' %' + varName + '%' : '') +
          ' has no value (never assigned, or not on the executed path)';
      }
      return 'The Output Template variable ' + (varName ? '%' + varName + '%' : '') + ' has no value when the template renders';
    case 'type-mismatch':
      return 'Type mismatch' + (msg ? ': ' + msg : '') + ' — booleans only compare with booleans';
    case 'bad-script':
      return line + (msg || 'The code could not be parsed.');
    case 'unsupported-operation':
      return 'This operation is not executable.';
    case 'op-cycle': {
      const loop = Array.isArray(e.chain) && e.chain.length > 0
        ? e.chain.map((n) => '"' + n + '"').join(' -> ')
        : (typeof e.operationName === 'string' && e.operationName !== '')
          ? '"' + e.operationName + '"'
          : '';
      return line + (msg || ('Operation cycle: ' + loop + ' — remove one call to break the loop.'));
    }
    case 'cycle': {
      const cname = (typeof e.containerName === 'string' && e.containerName !== '') ? e.containerName : '';
      const loop = Array.isArray(e.chain) && e.chain.length > 0
        ? e.chain.concat([cname]).map((n) => '[' + n + ']').join(' -> ')
        : '[' + cname + '] -> [' + cname + ']';
      return 'Circular container reference: ' + loop + ' — remove one reference to break the loop.';
    }
    case 'nesting-limit':
      return line + (msg || 'Execution exceeded a nesting budget (operation depth 4, block depth 8, 1000 resolutions, or 100,000 characters) — simplify the script.');
    default:
      return line + (msg || ('Run failed: ' + kind));
  }
}


function exportLogicOperation(op) {
  const o = (op && typeof op === 'object' && !Array.isArray(op)) ? op : {};
  const script = typeof o.script === 'string' ? o.script : '';
  const bindings = {};
  if (o.bindings && typeof o.bindings === 'object' && !Array.isArray(o.bindings)) {
    for (const k of Object.keys(o.bindings)) {
      if (typeof o.bindings[k] === 'string') bindings[k] = o.bindings[k];
    }
  }
  const occurrences = [];
  for (const r of (Array.isArray(o.occurrences) ? o.occurrences : [])) {
    if (!r || typeof r !== 'object') continue;
    occurrences.push({
      instanceId: r.instanceId,
      token: r.token,
      refId: (r.refId === undefined ? null : r.refId),
      offset: r.offset,
    });
  }
  return {
    id: o.id,
    name: o.name,
    purpose: typeof o.purpose === 'string' ? o.purpose : '',
    script: script,
    outputTemplate: typeof o.outputTemplate === 'string' ? o.outputTemplate : '',
    imports: deriveScriptImports(script),
    exposed: deriveScriptExposed(script),
    bindings: bindings,
    occurrences: occurrences,
  };
}

function buildLogicOpsBundle(ops) {
  const list = (Array.isArray(ops) ? ops : []).filter(isScriptLogicOp);
  return {
    kind: LOGIC_OPS_BUNDLE_KIND,
    operations: list.map(exportLogicOperation),
  };
}

function parseLogicOpsBundle(text) {
  const src = typeof text === 'string' ? text : '';
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (e) {
    return {
      ok: false, operations: [],
      errors: [{ kind: 'invalid-json', message: 'Not valid JSON: ' + (e && e.message ? e.message : String(e)) }],
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      parsed.kind !== LOGIC_OPS_BUNDLE_KIND) {
    return {
      ok: false, operations: [],
      errors: [{
        kind: 'invalid-bundle',
        message: 'This file is not a valid logic-ops bundle.',
      }],
    };
  }
  const v = validateLogicOpsBundle(parsed);
  return { ok: v.ok, operations: v.ok ? v.operations : [], errors: v.errors };
}

function serializeLogicOpsFile(ops) {
  return JSON.stringify({ items: (Array.isArray(ops) ? ops : []) }, null, 2) + '\n';
}

function planLogicOpsImport(operations, existingOps) {
  const existing = Array.isArray(existingOps) ? existingOps : [];
  const names = new Set();
  const ids = new Set();
  for (const o of existing) {
    if (!o || typeof o !== 'object') continue;
    if (typeof o.name === 'string' && o.name.trim() !== '') names.add(o.name.trim().toLowerCase());
    if (typeof o.id === 'string' && o.id !== '') ids.add(o.id);
  }
  const out = [];
  const renamed = [];
  let idChanges = 0;
  for (const op of (Array.isArray(operations) ? operations : [])) {
    const copy = JSON.parse(JSON.stringify(op));
    const base = typeof copy.name === 'string' ? copy.name.trim() : '';
    let name = base;
    let k = 0;
    while (names.has(name.toLowerCase())) {
      k += 1;
      name = base + ' (imported' + (k === 1 ? '' : ' ' + k) + ')';
    }
    if (name !== base) renamed.push({ from: base, to: name });
    if (typeof copy.id !== 'string' || copy.id === '' || ids.has(copy.id)) {
      copy.id = newOpId();
      idChanges += 1;
    }
    copy.name = name;
    names.add(name.toLowerCase());
    ids.add(copy.id);
    out.push(copy);
  }
  return { operations: out, renamed: renamed, idChanges: idChanges };
}

function logicOpContentKey(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  return JSON.stringify({
    name: strOf(item, 'name'),
    purpose: strOf(item, 'purpose'),
    script: strOf(item, 'script'),
    outputTemplate: strOf(item, 'outputTemplate'),
  });
}

function logicOpIsDirty(item, savedKey) {
  return logicOpContentKey(item) !== (savedKey == null ? '' : String(savedKey));
}

let logicOpSaveTimer = null;

async function saveLogicOpQuiet(path, item) {
  try {
    normalizeLogicOpInPlace(item);
    await persistLogicOpsFile(path);
    derive();
    return true;
  } catch (e) {
    toast('Could not save ' + path + ': ' + (e && e.message ? e.message : String(e)), 'error');
    return false;
  }
}

function scheduleLogicOpSave(path, item, onSaved) {
  if (logicOpSaveTimer !== null) clearTimeout(logicOpSaveTimer);
  logicOpSaveTimer = setTimeout(() => {
    logicOpSaveTimer = null;
    saveLogicOpQuiet(path, item).then((ok) => { if (ok && onSaved) onSaved(); });
  }, 700);
}

function flushLogicOpSave(path, item, onSaved) {
  if (logicOpSaveTimer !== null) {
    clearTimeout(logicOpSaveTimer);
    logicOpSaveTimer = null;
  }
  return saveLogicOpQuiet(path, item).then((ok) => { if (ok && onSaved) onSaved(); return ok; });
}

function createNewLogicOperation(path) {
  const item = newLogicOpDraft();
  itemsOf(path).push(item);
  state.logicFile = path;
  state.logicOp = item;
  state.logicSearch = '';
  renderLogicOpsTab();
  const input = document.querySelector('#tab-logic .logic-editor input[aria-label="Operation name"]');
  if (input) input.focus();
}

function nextCopyName(base, taken) {
  const name = typeof base === 'string' ? base.trim() : '';
  const stem = name === '' ? 'Untitled' : name;
  const set = new Set((Array.isArray(taken) ? taken : []).map((n) => String(n).trim().toLowerCase()));
  if (!set.has((stem + ' (copy)').toLowerCase())) return stem + ' (copy)';
  for (let i = 2; i < 1000; i++) {
    const candidate = stem + ' (copy ' + i + ')';
    if (!set.has(candidate.toLowerCase())) return candidate;
  }
  return stem + ' (copy)';
}

async function duplicateLogicOperation(path, item) {
  const items = itemsOf(path);
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = newOpId();
  copy.name = nextCopyName(item.name, items.map((o) => o.name));
  copy.occurrences = computeOpOccurrences(copy.script);
  copy.bindings = {};
  const idx = items.indexOf(item);
  items.splice(idx === -1 ? items.length : idx + 1, 0, copy);
  state.logicOp = copy;
  await saveLogicOpQuiet(path, copy);
  renderLogicOpsTab();
  toast('Duplicated as "' + copy.name + '"');
}

function slugifyFileName(name) {
  const s = (typeof name === 'string' ? name : '').trim();
  const cleaned = s.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'operation' : cleaned;
}

function exportLogicOp(item) {
  const bundle = buildLogicOpsBundle([item]);
  if (bundle.operations.length === 0) {
    toast('Nothing to export.', 'warn');
    return;
  }
  downloadJsonPayload(bundle, 'logic-op-' + slugifyFileName(item.name) + '.json');
  toast('Exported "' + (strOf(item, 'name').trim() || '(unnamed)') + '"');
}

function exportAllLogicOps() {
  const ops = allScriptLogicOps();
  if (ops.length === 0) {
    toast('No operations to export.', 'warn');
    return;
  }
  downloadJsonPayload(buildLogicOpsBundle(ops), 'ttrpg-logic-ops.json');
  toast('Exported ' + ops.length + ' operation(s)');
}

async function importLogicOpsBundleFile(file) {
  if (!file) return false;
  const text = await file.text();
  const parsed = parseLogicOpsBundle(text);
  if (!parsed.ok) {
    logicImportErrors = parsed.errors.map((e) => e.message);
    renderLogicOpsTab();
    toast('Import rejected: ' + (parsed.errors[0] ? parsed.errors[0].message : 'invalid bundle'), 'error');
    return false;
  }
  const plan = planLogicOpsImport(parsed.operations, allRawLogicOps());
  if (plan.renamed.length > 0) {
    const list = plan.renamed.map((r) => '"' + r.from + '" → "' + r.to + '"').join(', ');
    if (!confirm('Name clash — these imported operations will be renamed: ' + list + '. Import anyway?')) {
      return false;
    }
  }
  const stem = String(file.name || 'imported').replace(/\.json$/i, '');
  const path = nextLogicOpsPath(stem);
  const text2 = serializeLogicOpsFile(plan.operations);
  try {
    await state.storage.createFile(path, text2);
  } catch (e) {
    logicImportErrors = [path + ': ' + (e && e.message ? e.message : String(e))];
    renderLogicOpsTab();
    toast(logicImportErrors[0], 'error');
    return false;
  }
  setFile(path, text2);
  derive();
  state.logicFile = path;
  state.logicOp = null;
  state.logicSearch = '';
  logicImportErrors = [];
  renderLogicOpsTab();
  const suffix = plan.renamed.length > 0 ? ' (' + plan.renamed.length + ' renamed to avoid a clash)' : '';
  toast('Imported ' + plan.operations.length + ' operation(s) into ' + path + suffix);
  return true;
}

function pickLogicOpsBundleFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0] ? input.files[0] : null;
    input.remove();
    if (file) importLogicOpsBundleFile(file);
  });
  input.click();
}



function renderScriptField(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const isTemplate = o.template === true;
  const wrap = el('div', { class: 'script-field' });
  const gutter = el('div', { class: 'script-gutter', 'aria-hidden': 'true' });
  const gutterInner = el('div', { class: 'script-gutter-inner' });
  gutter.append(gutterInner);
  const body = el('div', { class: 'script-body' });
  const fieldBox = el('div', { class: 'gen-tpl-field script-tpl' });
  const layer = el('div', { class: 'gen-tpl-highlight', 'aria-hidden': 'true' });
  const tpl = el('textarea', {
    class: 'field mono gen-template script-source' + (isTemplate ? ' script-template-source' : ''),
    rows: String(isTemplate ? 3 : 14),
    spellcheck: 'false',
    autoComplete: 'off',
    autoCapitalize: 'off',
    placeholder: typeof o.placeholder === 'string' ? o.placeholder : '',
    'aria-label': typeof o.ariaLabel === 'string' ? o.ariaLabel : (isTemplate ? 'Output Template' : 'Code'),
  });
  tpl.value = typeof o.value === 'string' ? o.value : '';
  const suggestBox = el('div', { class: 'suggest script-suggest', hidden: true });
  fieldBox.append(layer, tpl);
  body.append(fieldBox, suggestBox);
  wrap.append(gutter, body);

  let gutterCount = -1;
  const paintGutter = () => {
    const n = tpl.value.split('\n').length;
    if (n === gutterCount) return;
    gutterCount = n;
    gutterInner.replaceChildren();
    for (let i = 1; i <= n; i++) gutterInner.append(el('div', { class: 'script-line-no' }, String(i)));
  };

  const sync = () => {
    paintGutter();
    const spans = isTemplate ? templateHighlightSpans(tpl.value) : logicHighlightSpans(tpl.value);
    layer.replaceChildren();
    for (const s of spans) {
      if (s.cls) layer.append(el('span', { class: s.cls }, s.text));
      else layer.append(document.createTextNode(s.text));
    }
    layer.style.right = (tpl.offsetWidth - tpl.clientWidth) + 'px';
    layer.scrollTop = tpl.scrollTop;
    layer.scrollLeft = tpl.scrollLeft;
    gutterInner.style.transform = 'translateY(' + (-tpl.scrollTop) + 'px)';
  };

  const suggest = { items: [], hi: -1, start: 0, end: 0 };
  const closeSuggest = () => {
    suggest.items = [];
    suggest.hi = -1;
    suggestBox.hidden = true;
    suggestBox.replaceChildren();
  };
  const paintSuggest = (hi) => {
    suggest.hi = hi;
    suggestBox.replaceChildren();
    if (suggest.items.length === 0) { suggestBox.hidden = true; return; }
    suggestBox.hidden = false;
    suggest.items.forEach((s, i) => {
      const row = el('div', { class: 'suggest-item' + (i === hi ? ' active' : '') }, s.label);
      if (s.kind) row.append(el('span', { class: 'hint' }, ' · ' + s.kind));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      suggestBox.append(row);
    });
  };
  const pick = (idx) => {
    const s = suggest.items[idx];
    if (!s) { closeSuggest(); return; }
    const applied = applyAutocomplete(tpl.value, suggest.start, suggest.end, s.insert);
    tpl.value = applied.text;
    tpl.setSelectionRange(applied.caret, applied.caret);
    closeSuggest();
    sync();
    if (typeof o.onInput === 'function') o.onInput(tpl.value);
    tpl.focus();
  };
  const updateSuggest = () => {
    if (typeof o.autocomplete !== 'function') { closeSuggest(); return; }
    const res = o.autocomplete(tpl.value, tpl.selectionStart);
    if (!res || !Array.isArray(res.items) || res.items.length === 0) { closeSuggest(); return; }
    suggest.items = res.items;
    suggest.start = res.start;
    suggest.end = res.end;
    paintSuggest(-1);
  };

  tpl.addEventListener('input', () => {
    sync();
    if (typeof o.onInput === 'function') o.onInput(tpl.value);
    updateSuggest();
  });
  tpl.addEventListener('scroll', () => {
    layer.scrollTop = tpl.scrollTop;
    layer.scrollLeft = tpl.scrollLeft;
    gutterInner.style.transform = 'translateY(' + (-tpl.scrollTop) + 'px)';
  });
  tpl.addEventListener('blur', () => { setTimeout(closeSuggest, 150); });
  tpl.addEventListener('change', () => {
    if (typeof o.onSave === 'function') o.onSave();
  });
  tpl.addEventListener('keydown', (e) => {
    const open = !suggestBox.hidden && suggest.items.length > 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      const n = suggest.items.length;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      suggest.hi = suggest.hi < 0
        ? (e.key === 'ArrowDown' ? 0 : n - 1)
        : (suggest.hi + delta + n) % n;
      paintSuggest(suggest.hi);
      return;
    }
    if (e.key === 'Escape') {
      if (open) { e.preventDefault(); closeSuggest(); }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (open) {
        pick(suggest.hi >= 0 ? suggest.hi : 0);
      } else {
        const s = tpl.selectionStart;
        const en = tpl.selectionEnd;
        tpl.value = tpl.value.slice(0, s) + '  ' + tpl.value.slice(en);
        tpl.selectionStart = tpl.selectionEnd = s + 2;
        sync();
        if (typeof o.onInput === 'function') o.onInput(tpl.value);
      }
      return;
    }
    if (e.key === 'Enter' && open && suggest.hi >= 0) {
      e.preventDefault();
      pick(suggest.hi);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && typeof o.onSave === 'function') {
      e.preventDefault();
      o.onSave();
    }
  });

  sync();
  return { root: wrap, textarea: tpl, sync: sync, focus: () => tpl.focus() };
}

function messageSegments(text, varName) {
  const t = (typeof text === 'string') ? text : '';
  const v = (typeof varName === 'string' && varName !== '') ? ('%' + varName + '%') : '';
  if (v === '' || t.indexOf(v) === -1) return [{ text: t, highlight: false }];
  const out = [];
  let rest = t;
  for (;;) {
    const i = rest.indexOf(v);
    if (i === -1) {
      if (rest !== '') out.push({ text: rest, highlight: false });
      return out;
    }
    if (i > 0) out.push({ text: rest.slice(0, i), highlight: false });
    out.push({ text: v, highlight: true });
    rest = rest.slice(i + v.length);
  }
}

function appendMessageNodes(box, text, varName, cls) {
  for (const seg of messageSegments(text, varName)) {
    const c = [cls, seg.highlight ? 'var-hl' : ''].filter((x) => x !== '').join(' ');
    box.append(el('span', { class: c }, seg.text));
  }
}

function renderValidationInto(box, report) {
  box.replaceChildren();
  const r = (report && typeof report === 'object') ? report : { errors: [], warnings: [] };
  const issues = [].concat(r.errors || [], r.warnings || []);
  if (issues.length === 0) {
    box.append(el('div', { class: 'validation-ok' }, '✓ No problems found.'));
    return;
  }
  for (const issue of issues) {
    const severity = issue.severity === 'warning' ? 'warning' : 'error';
    const row = el('div', { class: 'script-issue ' + severity });
    const where = (typeof issue.line === 'number' && issue.line > 0) ? 'line ' + issue.line + ' · ' : '';
    row.append(el('span', { class: 'script-issue-where mono' }, where + (issue.kind || severity)));
    appendMessageNodes(row, issue.message, issue.varName, 'script-issue-msg');
    box.append(row);
  }
}

function renderTraceInto(box, rows) {
  box.replaceChildren();
  const list = el('div', { class: 'trace-list' });
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const row = el('div', { class: 'trace-row' });
    row.append(
      el('span', { class: 'trace-step mono' }, String(r.step)),
      el('span', { class: 'trace-kind mono' }, r.title),
    );
    const body = el('div', { class: 'trace-body' });
    for (const d of r.details) body.append(el('div', { class: 'trace-detail' }, d));
    row.append(body);
    list.append(row);
  }
  box.append(list);
}

function renderTestPanel(scriptValue, item) {
  const wrap = el('div', { class: 'logic-test-panel' });
  wrap.append(el('div', { class: 'logic-config-head' }, 'Test run'));
  wrap.append(el('div', { class: 'hint' },
    'Test values are entered per run and never saved. A missing value is reported, not defaulted.'));

  const inputsBox = el('div', { class: 'test-inputs' });
  const resultBox = el('div', { class: 'logic-test-result', hidden: true });
  const runBtn = el('button', { class: 'btn primary', type: 'button' }, 'run test');
  const runRow = el('div', { class: 'test-run-row' }, runBtn);
  const inputs = new Map();
  let names = [];

  const readValues = () => {
    const raw = {};
    for (const n of names) {
      const inp = inputs.get(n);
      raw[n] = inp ? inp.value : '';
    }
    return raw;
  };

  const buildInputs = (script) => {
    names = deriveScriptImports(script);
    const previous = new Map();
    for (const [n, inp] of inputs) previous.set(n, inp.value);
    inputs.clear();
    inputsBox.replaceChildren();
    if (names.length === 0) {
      inputsBox.append(el('div', { class: 'hint' }, 'No imported variables — this operation runs with no inputs.'));
      return;
    }
    for (const name of names) {
      const inp = el('input', {
        class: 'field mono test-input', type: 'text', spellcheck: 'false',
        value: previous.has(name) ? previous.get(name) : '',
        placeholder: 'value for ' + name,
        'aria-label': 'Test value for ' + name,
      });
      const typeHint = el('span', { class: 'test-input-type hint' });
      const paintType = () => {
        const t = logicTestInputType(inp.value);
        typeHint.textContent = t === null ? 'missing' : t;
        typeHint.className = 'test-input-type hint' + (t === null ? ' missing' : '');
      };
      inp.addEventListener('input', paintType);
      paintType();
      inputs.set(name, inp);
      inputsBox.append(el('div', { class: 'test-input-row' },
        el('span', { class: 'test-input-name mono' }, '%' + name + '%'), inp, typeHint));
    }
  };

  const run = () => {
    const current = deriveScriptImports(typeof item.script === 'string' ? item.script : '');
    if (current.join('\u0000') !== names.join('\u0000')) buildInputs(item.script);
    const built = buildTestValues(names, readValues());
    resultBox.replaceChildren();
    resultBox.hidden = false;
    if (built.missing.length > 0) {
      const err = el('div', { class: 'script-issue error' });
      err.append(el('span', { class: 'script-issue-where mono' }, 'missing values'));
      err.append(el('span', { class: 'script-issue-msg' },
        'Enter a value for ' + built.missing.map((n) => '%' + n + '%').join(', ') +
        ' before running — this panel never defaults a missing import.'));
      resultBox.append(err);
      return;
    }
    const res = runLogicOpTest(item, built.values);
    const head = el('div', { class: 'test-result-head' });
    head.append(el('span', { class: res.ok ? 'test-ok' : 'test-fail' }, res.ok ? '✓ success' : '✕ failed'));
    resultBox.append(head);

    if (res.ok) {
      const out = typeof res.output === 'string' ? res.output : '';
      if (out !== '') resultBox.append(el('div', { class: 'test-output mono' }, 'Output Template: ' + out));
      else resultBox.append(el('div', { class: 'hint' }, 'No Output Template — this run produced no text.'));
    }
    for (const e of (Array.isArray(res.errors) ? res.errors : [])) {
      const div = el('div', { class: 'test-error' });
      appendMessageNodes(div, logicRunErrorMessage(e), e && e.varName, '');
      resultBox.append(div);
    }

    resultBox.append(el('div', { class: 'trace-head' }, 'Execution trace'));
    const rows = traceRows(res.trace);
    if (rows.length === 0) resultBox.append(el('div', { class: 'hint' }, 'No statements executed.'));
    else {
      const traceBox = el('div', { class: 'trace-box' });
      renderTraceInto(traceBox, rows);
      resultBox.append(traceBox);
    }

    const exposed = Array.isArray(res.exposed) ? res.exposed : [];
    if (exposed.length > 0) {
      const chips = el('div', { class: 'logic-chips' });
      chips.append(el('span', { class: 'logic-config-head' }, 'Exposed'));
      for (const v of exposed) {
        chips.append(el('span', { class: 'logic-chip exposed' },
          v.name + ' = ' + traceValueText(v) + ' (' + v.type + ')'));
      }
      resultBox.append(chips);
    }

    const vars = (res.variables && typeof res.variables === 'object') ? res.variables : {};
    const varNames = Object.keys(vars);
    if (varNames.length > 0) {
      const table = el('div', { class: 'test-vars' });
      table.append(el('div', { class: 'test-var-row test-var-head' },
        el('span', {}, 'variable'), el('span', {}, 'type'), el('span', {}, 'value'), el('span', {}, 'source')));
      for (const n of varNames) {
        table.append(el('div', { class: 'test-var-row' },
          el('span', { class: 'mono' }, n),
          el('span', { class: 'hint' }, String(vars[n].type)),
          el('span', { class: 'mono' }, traceValueText(vars[n])),
          el('span', { class: 'hint' }, vars[n].source === 'import' ? 'import (test input)' : String(vars[n].source || ''))));
      }
      resultBox.append(table);
    }
  };

  runBtn.addEventListener('click', run);
  wrap.append(inputsBox, runRow, resultBox);
  buildInputs(scriptValue);
  return { root: wrap, refreshInputs: buildInputs, run: run };
}


function renderRefsPanel(item) {
  const opName = strOf(item, 'name');
  const refs = opReferences(opName);
  const panel = el('div', { class: 'logic-refs' });
  panel.append(el('div', { class: 'logic-config-head' },
    'Referenced by ' + refs.total + (refs.total === 1 ? ' place' : ' places')));
  if (opName.trim() === '') {
    panel.append(el('div', { class: 'hint' },
      'Give this operation a name — templates and entries can then reference it with {name}.'));
  } else if (refs.total === 0) {
    panel.append(el('div', { class: 'hint' },
      'No generator template or table entry references {' + opName.trim() + '} yet.'));
  } else {
    const list = el('div', { class: 'logic-refs-list' });
    for (const g of refs.templates) {
      list.append(el('div', { class: 'logic-ref-row' },
        el('span', { class: 'logic-ref-kind' }, 'generator'),
        el('span', { class: 'file-path mono' }, g.file),
        el('span', {}, '“' + g.name + '”'),
        el('span', { class: 'logic-ref-count mono' }, '×' + g.count)));
    }
    for (const e of refs.entries) {
      list.append(el('div', { class: 'logic-ref-row' },
        el('span', { class: 'logic-ref-kind' }, 'entry'),
        el('span', { class: 'file-path mono' }, e.file),
        el('span', {}, e.table + ' → “' + e.label + '”'),
        el('span', { class: 'logic-ref-count mono' }, '×' + e.count)));
    }
    panel.append(list);
    panel.append(el('div', { class: 'hint logic-refs-note' },
      'Renaming this operation updates these references. Deleting it does not (a delete is not cascaded).'));
  }
  return panel;
}

function renderLogicOpEditor(path, item) {
  normalizeLogicOpInPlace(item);
  const editor = el('div', { class: 'logic-editor' });

  const head = el('div', { class: 'logic-editor-head' });
  const saveState = el('span', { class: 'logic-save-state hint' }, 'saved');
  const saveBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Save');
  const closeBtn = el('button', { class: 'btn small', type: 'button' }, 'close editor');
  head.append(el('span', { class: 'file-path mono' }, path), saveState, saveBtn, closeBtn);
  editor.append(head);

  let savedKey = logicOpContentKey(item);
  const refreshSaveState = () => {
    const dirty = logicOpIsDirty(item, savedKey);
    saveState.textContent = dirty ? 'unsaved changes' : 'saved';
    saveState.className = dirty ? 'logic-save-state hint dirty' : 'logic-save-state hint';
  };
  const afterSaved = () => { savedKey = logicOpContentKey(item); refreshSaveState(); };
  const saveNow = () => flushLogicOpSave(path, item, afterSaved);
  saveBtn.addEventListener('click', saveNow);
  closeBtn.addEventListener('click', () => {
    flushLogicOpSave(path, item);
    state.logicOp = null;
    renderLogicOpsTab();
  });

  const nameInput = el('input', {
    class: 'field', type: 'text', value: strOf(item, 'name'),
    placeholder: 'name (used for {lookup})', spellcheck: 'false',
    'aria-label': 'Operation name',
  });
  const purposeInput = el('input', {
    class: 'field', type: 'text', value: strOf(item, 'purpose'),
    placeholder: 'purpose (notes, optional)',
  });
  editor.append(nameInput, purposeInput);

  const scriptField = renderScriptField({
    value: strOf(item, 'script'),
    ariaLabel: 'Code',
    rows: 16,
    placeholder: 'IMPORT %base_damage%\nSET damage = base_damage * 2\nROLL result = |1d6|\nIF damage >= 10 THEN\n  SET label = "heavy"\nELSE\n  SET label = "light"\nEXPOSE label',
    autocomplete: (text, caret) => autocompleteSuggestions(text, caret, logicAutocompleteContext()),
    onInput: (value) => {
      if (item.script !== value) {
        item.script = value;
        refreshSaveState();
        scheduleLogicOpSave(path, item, afterSaved);
      }
      scheduleValidation();
    },
    onSave: saveNow,
  });
  const templateField = renderScriptField({
    value: strOf(item, 'outputTemplate'),
    ariaLabel: 'Output Template',
    template: true,
    rows: 3,
    placeholder: '%label% — %damage%',
    autocomplete: (text, caret) => autocompleteSuggestions(
      text, caret,
      { variables: [].concat(collectScriptNames(scriptField.textarea.value).imported,
        collectScriptNames(scriptField.textarea.value).assigned) },
      { templateOnly: true },
    ),
    onInput: (value) => {
      if (item.outputTemplate !== value) {
        item.outputTemplate = value;
        refreshSaveState();
        scheduleLogicOpSave(path, item, afterSaved);
      }
      scheduleValidation();
    },
    onSave: saveNow,
  });

  editor.append(
    el('div', { class: 'logic-config-head' }, 'Code'),
    el('div', { class: 'hint' }, 'Ctrl+S saves · Tab inserts two spaces or accepts a suggestion · # starts a comment.'),
    scriptField.root,
    el('div', { class: 'logic-config-head' }, 'Output Template'),
    el('div', { class: 'hint' },
      'Presentation only: %variable% is substituted, everything else stays literal — no dice, containers or operations execute here.'),
    templateField.root,
  );

  const validationBox = el('div', { class: 'logic-validation', role: 'status' });
  editor.append(el('div', { class: 'logic-config-head' }, 'Validation'), validationBox);

  const chipsBox = el('div', { class: 'logic-chips' });
  const buildChips = () => {
    chipsBox.replaceChildren();
    const imports = deriveScriptImports(scriptField.textarea.value);
    const exposed = deriveScriptExposed(scriptField.textarea.value);
    chipsBox.append(el('span', { class: 'logic-config-head' }, 'Imports'));
    if (imports.length === 0) {
      chipsBox.append(el('span', { class: 'hint' }, 'none — this operation takes no generator variables.'));
    } else {
      for (const n of imports) chipsBox.append(el('span', { class: 'logic-chip' }, '%' + n + '%'));
    }
    chipsBox.append(el('span', { class: 'logic-config-head' }, 'Exposed'));
    if (exposed.length === 0) {
      chipsBox.append(el('span', { class: 'hint' }, 'none — local variables stay private.'));
    } else {
      for (const n of exposed) chipsBox.append(el('span', { class: 'logic-chip exposed' }, n));
    }
  };
  editor.append(chipsBox);

  editor.append(renderRefsPanel(item));

  const actions = el('div', { class: 'logic-actions' });
  const testBtn = el('button', { class: 'btn', type: 'button' }, 'test');
  const dupBtn = el('button', { class: 'btn small', type: 'button' }, 'duplicate');
  const expBtn = el('button', { class: 'btn small', type: 'button' }, 'export');
  const renameBtn = el('button', { class: 'btn small', type: 'button' }, 'rename');
  const delBtn = el('button', { class: 'btn small danger', type: 'button' }, 'delete');
  actions.append(testBtn, dupBtn, expBtn, renameBtn, delBtn);
  editor.append(actions);

  const testPanel = renderTestPanel(strOf(item, 'script'), item);
  editor.append(testPanel.root);

  let validationTimer = null;
  let lastImportKey = deriveScriptImports(item.script).join('\u0000');
  const refreshDynamic = () => {
    const script = scriptField.textarea.value;
    const imports = deriveScriptImports(script);
    renderValidationInto(validationBox, logicValidationReport(script, templateField.textarea.value, imports));
    const key = imports.join('\u0000');
    if (key !== lastImportKey) {
      lastImportKey = key;
      testPanel.refreshInputs(script);
      buildChips();
    }
  };
  const scheduleValidation = () => {
    if (validationTimer !== null) clearTimeout(validationTimer);
    validationTimer = setTimeout(() => { validationTimer = null; refreshDynamic(); }, 220);
  };
  refreshDynamic();
  buildChips();

  testBtn.addEventListener('click', () => {
    refreshDynamic();
    testPanel.run();
    if (testPanel.root.scrollIntoView) testPanel.root.scrollIntoView({ block: 'nearest' });
  });
  dupBtn.addEventListener('click', () => {
    flushLogicOpSave(path, item, afterSaved).then(() => duplicateLogicOperation(path, item));
  });
  expBtn.addEventListener('click', () => {
    flushLogicOpSave(path, item, afterSaved).then(() => exportLogicOp(item));
  });
  renameBtn.addEventListener('click', () => { onRenameLogicOp(path, item); });
  delBtn.addEventListener('click', () => { onLogicDeleteOp(path, item); });

  nameInput.addEventListener('change', () => {
    const prev = strOf(item, 'name');
    const next = String(nameInput.value == null ? '' : nameInput.value).trim();
    if (next === '' || next === prev.trim()) {
      item.name = nameInput.value;
      refreshSaveState();
      saveNow();
      return;
    }
    renameOperation(path, item, nameInput.value).then((res) => {
      if (!res || !res.ok) nameInput.value = prev;
    }).catch((e) => {
      toast(e && e.message ? e.message : String(e), 'error');
      nameInput.value = prev;
    });
  });
  purposeInput.addEventListener('change', () => {
    item.purpose = purposeInput.value;
    refreshSaveState();
    saveNow();
  });

  return editor;
}

function renderLogicOpsTab() {
  const box = document.getElementById('tab-logic');
  box.replaceChildren();

  const newFileBtn = el('button', { class: 'btn small', type: 'button' }, '+ new file');
  newFileBtn.addEventListener('click', onNewLogicOpsFile);
  const exportAllBtn = el('button', { class: 'btn small', type: 'button' }, 'export all');
  exportAllBtn.addEventListener('click', exportAllLogicOps);
  const importBtn = el('button', { class: 'btn small', type: 'button' }, 'import…');
  importBtn.addEventListener('click', pickLogicOpsBundleFile);
  const helpBtn = el('button', { class: 'btn small', type: 'button' }, 'Help');
  helpBtn.addEventListener('click', () => window.open('help/logic.html', '_blank'));
  box.append(el('div', { class: 'tab-actions' }, newFileBtn, exportAllBtn, importBtn, helpBtn));

  if (logicImportErrors.length > 0) {
    const errBox = el('div', { class: 'logic-import-errors' });
    errBox.append(el('div', { class: 'logic-config-head' }, 'Import rejected'));
    for (const msg of logicImportErrors) errBox.append(el('div', { class: 'script-issue error' }, msg));
    const dismiss = el('button', { class: 'btn small', type: 'button' }, 'dismiss');
    dismiss.addEventListener('click', () => { logicImportErrors = []; renderLogicOpsTab(); });
    errBox.append(dismiss);
    box.append(errBox);
  }

  const paths = [...state.files.keys()].filter((p) => p.startsWith('logic-ops/')).sort();
  if (paths.length === 0) {
    box.append(el('div', { class: 'hint' },
      'No logic files yet. Click "+ new file" to start one.'));
    return;
  }

  for (const p of paths) {
    const entry = state.files.get(p);
    const items = itemsOf(p);
    const section = el('div', { class: 'file-section' + (state.logicFile === p ? ' selected' : '') });
    const pathSpan = el('span', { class: 'file-path mono logic-file-path' }, p);
    pathSpan.title = 'Select this file';
    pathSpan.addEventListener('click', () => {
      state.logicFile = p;
      state.logicOp = null;
      state.logicSearch = '';
      renderLogicOpsTab();
    });
    const addBtn = el('button', { class: 'btn small', type: 'button' }, '+ add operation');
    addBtn.addEventListener('click', () => createNewLogicOperation(p));
    const renameBtn = el('button', { class: 'btn small', type: 'button' }, 'rename');
    renameBtn.addEventListener('click', () => onRenameLogicOpsFile(p));
    const delBtn = el('button', { class: 'btn small danger', type: 'button' }, 'delete');
    delBtn.addEventListener('click', () => onLogicDeleteFile(p));
    section.append(el('div', { class: 'file-head' },
      pathSpan,
      el('span', { class: 'file-count' },
        items.length + (items.length === 1 ? ' operation' : ' operations')),
      addBtn, renameBtn, delBtn,
    ));
    if (entry.error) {
      section.append(el('div', { class: 'error' }, 'Parse error: ' + entry.error));
    }
    box.append(section);
  }

  const file = state.logicFile && state.files.has(state.logicFile) ? state.logicFile : null;
  if (file == null) {
    box.append(el('div', { class: 'hint' }, 'Select a file above to list its operations.'));
    return;
  }
  const entry = state.files.get(file);
  if (entry.error) {
    box.append(el('div', { class: 'error' }, 'Parse error: ' + entry.error));
    return;
  }
  const items = itemsOf(file);

  const panel = el('div', { class: 'logic-panel' });
  panel.append(el('div', { class: 'logic-panel-head' },
    el('span', { class: 'gen-panel-label' }, 'Operations in ' + file),
  ));

  const search = el('input', {
    class: 'field logic-search', type: 'search', value: state.logicSearch,
    placeholder: 'filter by name or purpose…', spellcheck: 'false',
  });
  search.addEventListener('input', () => {
    state.logicSearch = search.value;
    renderLogicOpsTab();
    const fresh = document.getElementById('tab-logic').querySelector('.logic-search');
    if (fresh) {
      fresh.focus();
      const n = fresh.value.length;
      fresh.setSelectionRange(n, n);
    }
  });
  panel.append(el('div', { class: 'logic-search-row' }, search));

  const list = el('div', { class: 'logic-op-list' });
  const visible = filterLogicOps(items, state.logicSearch);
  if (visible.length === 0) {
    list.append(el('div', { class: 'hint' },
      items.length === 0
        ? 'No operations yet — "+ add operation" starts a new operation.'
        : 'No operations match the filter.'));
  }
  for (const it of visible) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const name = strOf(it, 'name');
    const row = el('div', { class: 'logic-op-row' + (state.logicOp === it ? ' selected' : '') });
    row.append(
      el('span', { class: 'logic-op-name' + (name.trim() === '' ? ' logic-op-unnamed' : '') },
        name.trim() === '' ? '(unnamed)' : name),
      el('span', { class: 'logic-badge' }, 'code'),
    );
    row.addEventListener('click', () => {
      state.logicOp = it;
      renderLogicOpsTab();
    });
    list.append(row);
  }
  panel.append(list);

  const item = state.logicOp;
  if (item && itemsOf(file).includes(item)) {
    panel.append(renderLogicOpEditor(file, item));
  } else {
    panel.append(el('div', { class: 'hint' },
      'Select an operation to edit, or add one. Operations are code-based.'));
  }
  box.append(panel);
}



const LOGIC_OPS_BUNDLE_KIND = 'ttrpg-logic-ops';

function newOpId() {
  return 'op_' + randomIdHex();
}

function newOpOccurrenceId() {
  if (typeof newOccurrenceId === 'function') return newOccurrenceId();
  return 'occ_' + randomIdHex();
}

function normalizeOpVarName(raw) {
  if (typeof raw !== 'string') return null;
  if (typeof LogicLanguage !== 'undefined' && typeof LogicLanguage.normalizeName === 'function') {
    try {
      return LogicLanguage.normalizeName(raw, 0);
    } catch (e) {
      return null;
    }
  }
  const s = raw.trim();
  if (s === '') return null;
  const NAME_CHAR_RE = /^[\p{L}\p{M}\p{N}_ ]$/u;
  for (const ch of s) {
    if (!NAME_CHAR_RE.test(ch)) return null;
  }
  const nf = s.normalize('NFC');
  if (nf === 'true' || nf === 'false') return null;
  return nf;
}

function scriptStatementsOf(script, type) {
  const text = typeof script === 'string' ? script : '';
  if (typeof LogicLanguage !== 'undefined' && typeof LogicLanguage.parseScript === 'function') {
    let r;
    try {
      r = LogicLanguage.parseScript(text);
    } catch (e) {
      return [];
    }
    if (!r || !r.ok || !Array.isArray(r.statements)) return [];
    const out = [];
    for (const st of r.statements) {
      if (st && st.type === type && typeof st.name === 'string') {
        out.push({ name: st.name, line: (typeof st.line === 'number') ? st.line : 1 });
      }
    }
    return out;
  }
  const RE = new RegExp('^\\s*' + type.toUpperCase() + '\\s+%([^%\\n]+)%\\s*$');
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = RE.exec(lines[i]);
    if (m) out.push({ name: m[1], line: i + 1 });
  }
  return out;
}

function scriptImportStatements(script) {
  return scriptStatementsOf(script, 'import');
}

function computeOpOccurrences(script) {
  const out = [];
  for (const st of scriptImportStatements(script)) {
    const name = normalizeOpVarName(st.name);
    out.push({
      instanceId: newOpOccurrenceId(),
      token: (name == null) ? st.name : name,
      refId: null,
      offset: st.line,
    });
  }
  return out;
}

function deriveScriptImports(script) {
  const seen = new Set();
  const out = [];
  for (const st of scriptImportStatements(script)) {
    const n = normalizeOpVarName(st.name);
    if (n == null || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function deriveScriptExposed(script) {
  const seen = new Set();
  const out = [];
  for (const st of scriptStatementsOf(script, 'expose')) {
    const n = normalizeOpVarName(st.name);
    if (n == null || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function createLogicOperation(fields) {
  const f = (fields && typeof fields === 'object' && !Array.isArray(fields)) ? fields : {};
  const errors = [];
  const name = typeof f.name === 'string' ? f.name : '';
  if (name.trim() === '') {
    errors.push({ kind: 'missing-name', message: 'Name is required.' });
  }
  let purpose = '';
  if (f.purpose != null) {
    if (typeof f.purpose !== 'string') {
      errors.push({ kind: 'invalid-type', message: 'purpose must be a string.' });
    } else {
      purpose = f.purpose;
    }
  }
  let script = '';
  if (typeof f.script !== 'string') {
    errors.push({ kind: 'invalid-type', message: 'code must be a string.' });
  } else {
    script = f.script;
  }
  let outputTemplate = '';
  if (typeof f.outputTemplate !== 'string') {
    errors.push({ kind: 'invalid-type', message: 'outputTemplate must be a string.' });
  } else {
    outputTemplate = f.outputTemplate;
  }
  let exposed;
  if (Array.isArray(f.exposed)) {
    exposed = f.exposed.slice();
  } else {
    if (f.exposed != null) {
      errors.push({ kind: 'invalid-type', message: 'exposed must be an array of names.' });
    }
    exposed = deriveScriptExposed(script);
  }
  const op = {
    id: (typeof f.id === 'string' && f.id !== '') ? f.id : newOpId(),
    name: name,
    purpose: purpose,
    script: script,
    outputTemplate: outputTemplate,
    imports: deriveScriptImports(script),
    exposed: exposed,
    bindings: {},
    occurrences: computeOpOccurrences(script),
  };
  return { ok: errors.length === 0, op: op, errors: errors };
}

function validateLogicOperation(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return [{ kind: 'invalid-type', message: 'operation must be a plain object.' }];
  }
  const out = [];
  if (op.id === undefined) {
    out.push({ kind: 'missing-field', message: 'id is required.' });
  } else if (typeof op.id !== 'string' || op.id === '') {
    out.push({ kind: 'invalid-type', message: 'id must be a non-empty string.' });
  }
  if (op.name === undefined) {
    out.push({ kind: 'missing-field', message: 'name is required.' });
  } else if (typeof op.name !== 'string' || op.name.trim() === '') {
    out.push({ kind: 'invalid-type', message: 'name must be a non-empty (after trim) string.' });
  }
  if (op.purpose !== undefined && typeof op.purpose !== 'string') {
    out.push({ kind: 'invalid-type', message: 'purpose must be a string.' });
  }
  if (op.script === undefined) {
    out.push({ kind: 'missing-field', message: 'code is required.' });
  } else if (typeof op.script !== 'string') {
    out.push({ kind: 'invalid-type', message: 'code must be a string.' });
  }
  if (op.outputTemplate === undefined) {
    out.push({ kind: 'missing-field', message: 'outputTemplate is required.' });
  } else if (typeof op.outputTemplate !== 'string') {
    out.push({ kind: 'invalid-type', message: 'outputTemplate must be a string.' });
  }
  for (const field of ['imports', 'exposed']) {
    const v = op[field];
    if (v === undefined) {
      out.push({ kind: 'missing-field', message: field + ' is required.' });
    } else if (!Array.isArray(v)) {
      out.push({ kind: 'invalid-type', message: field + ' must be an array of names.' });
    } else {
      const seen = new Set();
      for (const entry of v) {
        const n = normalizeOpVarName(entry);
        if (n === null) {
          out.push({ kind: 'bad-name', message: field + ' contains a name that is not a valid variable name: ' + JSON.stringify(entry) });
          continue;
        }
        if (seen.has(n)) {
          out.push({ kind: 'duplicate-name', message: field + ' contains a duplicate name: "' + n + '".' });
          continue;
        }
        seen.add(n);
      }
    }
  }
  const knownInstances = new Set();
  if (op.occurrences === undefined) {
    out.push({ kind: 'missing-field', message: 'occurrences is required.' });
  } else if (!Array.isArray(op.occurrences)) {
    out.push({ kind: 'invalid-type', message: 'occurrences must be an array.' });
  } else {
    const seenIds = new Set();
    for (const row of op.occurrences) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        out.push({ kind: 'invalid-type', message: 'each occurrence must be a plain object.' });
        continue;
      }
      if (typeof row.instanceId !== 'string' || row.instanceId === '') {
        out.push({ kind: 'invalid-type', message: 'occurrence instanceId must be a non-empty string.' });
      } else {
        if (seenIds.has(row.instanceId)) {
          out.push({ kind: 'duplicate-instance', message: 'duplicate occurrence instanceId: "' + row.instanceId + '".' });
        } else {
          seenIds.add(row.instanceId);
          knownInstances.add(row.instanceId);
        }
      }
      if (typeof row.token !== 'string') {
        out.push({ kind: 'invalid-type', message: 'occurrence token must be a string.' });
      }
      if (row.refId !== null && typeof row.refId !== 'string') {
        out.push({ kind: 'invalid-type', message: 'occurrence refId must be null or a string.' });
      }
      if (!Number.isInteger(row.offset) || row.offset < 1) {
        out.push({ kind: 'invalid-type', message: 'occurrence offset must be an integer >= 1.' });
      }
    }
  }
  if (op.bindings === undefined) {
    out.push({ kind: 'missing-field', message: 'bindings is required.' });
  } else if (!op.bindings || typeof op.bindings !== 'object' || Array.isArray(op.bindings)) {
    out.push({ kind: 'invalid-type', message: 'bindings must be an object of instanceId -> name.' });
  } else {
    for (const k of Object.keys(op.bindings)) {
      const v = op.bindings[k];
      if (typeof v !== 'string') {
        out.push({ kind: 'invalid-type', message: 'binding "' + k + '" must map to a name string.' });
      } else if (!knownInstances.has(k)) {
        out.push({ kind: 'unknown-binding-instance', message: 'binding references unknown instanceId "' + k + '".' });
      }
    }
  }
  const KNOWN = ['id', 'name', 'purpose', 'script', 'outputTemplate', 'imports', 'exposed', 'occurrences', 'bindings'];
  for (const k of Object.keys(op)) {
    if (KNOWN.indexOf(k) === -1) {
      out.push({ kind: 'unknown-field', message: 'unknown field "' + k + '".' });
    }
  }
  return out;
}

function validateLogicOpsBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return {
      ok: false,
      operations: [],
      errors: [{ kind: 'invalid-type', message: 'bundle must be a plain object.' }],
    };
  }
  const errors = [];
  if (typeof bundle.kind !== 'string' || bundle.kind !== LOGIC_OPS_BUNDLE_KIND) {
    errors.push({ kind: 'unknown-kind', message: 'kind must be "' + LOGIC_OPS_BUNDLE_KIND + '".' });
  }
  for (const k of Object.keys(bundle)) {
    if (k !== 'kind' && k !== 'operations') {
      errors.push({ kind: 'unknown-field', message: 'unknown field "' + k + '".' });
    }
  }
  let operations = [];
  if (!Array.isArray(bundle.operations)) {
    errors.push({ kind: 'invalid-type', message: 'operations must be an array.' });
  } else {
    operations = bundle.operations;
    for (let i = 0; i < bundle.operations.length; i++) {
      for (const e of validateLogicOperation(bundle.operations[i])) {
        errors.push({ kind: e.kind, message: 'operations[' + i + ']: ' + e.message });
      }
    }
  }
  return { ok: errors.length === 0, operations: operations, errors: errors };
}

function substituteOutputTemplate(template, values) {
  const text = typeof template === 'string' ? template : '';
  const vals = (values && typeof values === 'object' && !Array.isArray(values)) ? values : {};
  const parts = [];
  const missing = [];
  const seenMissing = new Set();
  let last = 0;
  const RE = /%([^%]*)%/g;
  let m;
  while ((m = RE.exec(text)) !== null) {
    parts.push(text.slice(last, m.index));
    const name = normalizeOpVarName(m[1]);
    let replaced = null;
    if (name !== null) {
      const v = Object.prototype.hasOwnProperty.call(vals, name)
        ? makeTypedValue(vals[name])
        : undefined;
      if (v === undefined) {
        if (!seenMissing.has(name)) {
          seenMissing.add(name);
          missing.push(name);
        }
      } else {
        replaced = String(v);
      }
    }
    parts.push((replaced === null) ? m[0] : replaced);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((n) => ({ kind: 'missing-variable', varName: n })),
    };
  }
  return { ok: true, text: parts.join('') };
}

function templateReferencedNames(template) {
  const text = typeof template === 'string' ? template : '';
  const names = [];
  const seen = new Set();
  const RE = /%([^%]*)%/g;
  let m;
  while ((m = RE.exec(text)) !== null) {
    const n = normalizeOpVarName(m[1]);
    if (n !== null && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  return names;
}

function dataflowStatements(statements, acc, inputs) {
  const list = Array.isArray(statements) ? statements : [];
  for (const st of list) {
    if (!st || typeof st !== 'object') continue;
    if (st.type === 'set') {
      if (typeof st.name === 'string') acc.add(st.name);
    } else if (st.type === 'import') {
      if (typeof st.name === 'string' && inputs.has(st.name)) acc.add(st.name);
    } else if (st.type === 'if') {
      const ends = [dataflowEnd(st.thenBody, acc, inputs)];
      const elseIfs = Array.isArray(st.elseIfs) ? st.elseIfs : [];
      for (const ei of elseIfs) ends.push(dataflowEnd(ei && ei.body, acc, inputs));
      ends.push(Array.isArray(st.elseBody)
        ? dataflowEnd(st.elseBody, acc, inputs)
        : new Set(acc));
      intersectInto(acc, ends);
    } else if (st.type === 'switch') {
      const cases = Array.isArray(st.cases) ? st.cases : [];
      const ends = [];
      let hasDefault = false;
      for (const cs of cases) {
        if (cs && cs.isDefault) hasDefault = true;
        ends.push(dataflowEnd(cs && cs.body, acc, inputs));
      }
      if (!hasDefault) ends.push(new Set(acc));
      intersectInto(acc, ends);
    }
  }
  return acc;
}

function dataflowEnd(body, acc, inputs) {
  return dataflowStatements(body, new Set(acc), inputs);
}

function intersectInto(acc, sets) {
  if (sets.length === 0) return;
  const first = sets[0];
  for (let i = 1; i < sets.length; i++) {
    for (const n of Array.from(first)) {
      if (!sets[i].has(n)) first.delete(n);
    }
  }
  acc.clear();
  for (const n of first) acc.add(n);
}

function scriptGuaranteedNames(script, inputNames) {
  const inputs = new Set();
  if (Array.isArray(inputNames)) {
    for (const n of inputNames) if (typeof n === 'string') inputs.add(n);
  }
  const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null;
  const parser = (g && g.LogicLanguage && typeof g.LogicLanguage.parseScript === 'function')
    ? g.LogicLanguage.parseScript
    : null;
  if (!parser) {
    return {
      ok: false, guaranteed: new Set(inputs),
      parseErrors: [{ kind: 'parse-unavailable', line: 0, message: 'script language not loaded' }],
    };
  }
  const parsed = parser(script);
  const parseErrors = (parsed && Array.isArray(parsed.errors)) ? parsed.errors : [];
  if (!(parsed && parsed.ok === true)) {
    return { ok: false, guaranteed: new Set(inputs), parseErrors: parseErrors };
  }
  const guaranteedSet = new Set(inputs);
  dataflowStatements(parsed.statements, guaranteedSet, inputs);
  return { ok: true, guaranteed: guaranteedSet, parseErrors: parseErrors };
}

function validateOutputTemplateDataflow(script, template, inputNames) {
  const referenced = templateReferencedNames(template);
  const flow = scriptGuaranteedNames(script, inputNames);
  const guaranteedSet = flow.guaranteed;
  const guaranteed = referenced.filter((n) => guaranteedSet.has(n));
  const warnings = referenced.filter((n) => !guaranteedSet.has(n));
  return { referenced: referenced, guaranteed: guaranteed, warnings: warnings, parseErrors: flow.parseErrors };
}

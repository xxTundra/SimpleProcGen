










function buildGenExportPayload(items, opts) {
  const includeContainers = !!(opts && opts.includeContainers);
  const gens = (Array.isArray(items) ? items : []).map((it) =>
    JSON.parse(JSON.stringify((it && typeof it === 'object') ? it : {})));
  const payload = { kind: 'ttrpg-generators', generators: gens };
  const liveOps = (opts && Array.isArray(opts.operations))
    ? opts.operations
    : (typeof state !== 'undefined' && Array.isArray(state.logicOps) ? state.logicOps : []);
  const ops = collectGenBundleOperations(gens, liveOps);
  if (ops.length > 0) payload.operations = ops;
  if (includeContainers) {
    const live = engineContainers();
    const containers = [];
    const seen = new Set();
    for (const g of gens) {
      const refs = Array.isArray(g.references) ? g.references : [];
      for (const r of refs) {
        if (!r || typeof r !== 'object') continue;
        const id = typeof r.containerId === 'string' && r.containerId !== '' ? r.containerId : '';
        const name = (typeof r.containerName === 'string' && r.containerName !== '')
          ? r.containerName
          : (typeof r.token === 'string' ? r.token : '');
        const key = id !== '' ? 'id:' + id : (name !== '' ? 'name:' + name.trim().toLowerCase() : '');
        if (key === '' || seen.has(key)) continue;
        const c = live.find((lc) =>
          (id !== '' && lc.id === id)
          || (name !== '' && String(lc.name).trim().toLowerCase() === name.trim().toLowerCase()));
        if (!c) continue;
        seen.add(key);
        containers.push({
          id: (typeof c.id === 'string' && c.id !== '') ? c.id : '',
          name: c.name,
          entries: JSON.parse(JSON.stringify(Array.isArray(c.entries) ? c.entries : [])),
        });
      }
    }
    payload.containers = containers;
  }
  return payload;
}

function downloadJsonPayload(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportGenerator(file, item) {
  const name = strOf(item, 'name');
  const fileName = (sanitizeFileName(name) !== '' ? sanitizeFileName(name) : 'generator') + '.json';
  downloadJsonPayload(buildGenExportPayload([item]), fileName);
}

function exportAllGenerators(includeContainers) {
  const all = [];
  for (const g of state.generators) {
    const raw = itemsOf(g.file)[g.index];
    if (raw && typeof raw === 'object') all.push(raw);
  }
  if (all.length === 0) {
    toast('No generators to export.', 'warn');
    return;
  }
  const payload = buildGenExportPayload(all, { includeContainers });
  downloadJsonPayload(payload, 'ttrpg-generators.json');
  const extras = [];
  if (includeContainers) {
    extras.push(payload.containers.length + ' container' + (payload.containers.length === 1 ? '' : 's'));
  }
  const opCount = Array.isArray(payload.operations) ? payload.operations.length : 0;
  if (opCount > 0) extras.push(opCount + ' operation' + (opCount === 1 ? '' : 's'));
  toast('Exported ' + all.length + ' generator' + (all.length === 1 ? '' : 's') +
    (extras.length > 0 ? ' + ' + extras.join(' + ') : ''));
}

function exportAllTables() {
  const files = {};
  let count = 0;
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('tables/')).sort()) {
    const parsed = state.files.get(p).parsed;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast(p + ': skipped export — file has no parsed content.', 'error');
      continue;
    }
    files[p] = JSON.parse(JSON.stringify(parsed));
    count++;
  }
  if (count === 0) {
    toast('No tables to export.', 'warn');
    return;
  }
  const entries = [];
  for (const f of Object.values(files)) {
    if (f && Array.isArray(f.items)) {
      for (const it of f.items) {
        if (it && Array.isArray(it.entries)) entries.push(...it.entries);
      }
    }
  }
  const liveOps = (typeof state !== 'undefined' && Array.isArray(state.logicOps)) ? state.logicOps : [];
  const ops = collectGenBundleOperations(entries, liveOps);
  const payload = { kind: 'ttrpg-tables', files };
  if (ops.length > 0) payload.operations = ops;
  downloadJsonPayload(payload, 'ttrpg-tables.json');
  toast('Exported ' + count + ' tables file' + (count === 1 ? '' : 's') +
    (ops.length > 0 ? ' + ' + ops.length + ' operation' + (ops.length === 1 ? '' : 's') : ''));
}

function exportAllMacros() {
  const files = {};
  let count = 0;
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('dice-macros/')).sort()) {
    const parsed = state.files.get(p).parsed;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast(p + ': skipped export — file has no parsed content.', 'error');
      continue;
    }
    files[p] = JSON.parse(JSON.stringify(parsed));
    count++;
  }
  if (count === 0) {
    toast('No macros to export.', 'warn');
    return;
  }
  const payload = { kind: 'ttrpg-macros', files };
  downloadJsonPayload(payload, 'ttrpg-macros.json');
  toast('Exported ' + count + ' macros file' + (count === 1 ? '' : 's'));
}


function canonJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonJson).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map((k) => JSON.stringify(k) + ':' + canonJson(value[k])).join(',') + '}';
}

function opContentOf(op) {
  const it = (op && typeof op === 'object' && !Array.isArray(op)) ? op : {};
  const out = JSON.parse(JSON.stringify(it));
  delete out.id;
  delete out.imports;
  delete out.exposed;
  delete out.occurrences;
  delete out.file;
  delete out.index;
  return canonJson(out);
}

function opsContentEqual(a, b) {
  return opContentOf(a) === opContentOf(b);
}

function cloneOperation(op, id) {
  const it = (op && typeof op === 'object' && !Array.isArray(op)) ? op : {};
  const out = JSON.parse(JSON.stringify(it));
  delete out.file;
  delete out.index;
  out.id = id != null ? String(id) : (typeof it.id === 'string' ? it.id : '');
  return out;
}

function freshOpId(taken) {
  const used = taken instanceof Set ? taken : new Set();
  let id = '';
  do {
    id = 'op_' + (typeof randomIdHex === 'function'
      ? randomIdHex()
      : Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'));
  } while (used.has(id));
  return id;
}

function collectGenBundleOperations(items, allOps) {
  const ops = (Array.isArray(allOps) ? allOps : [])
    .filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  const byId = new Map();
  for (const o of ops) {
    if (typeof o.id === 'string' && o.id !== '') byId.set(o.id, o);
  }
  const nameCount = new Map();
  for (const o of ops) {
    const key = String(o.name == null ? '' : o.name).trim().toLowerCase();
    if (key === '') continue;
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }
  const out = [];
  const seen = new Set();
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    for (const r of (Array.isArray(it.operations) ? it.operations : [])) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      const refId = typeof r.operationId === 'string' ? r.operationId : '';
      const token = String(r.token == null ? '' : r.token).trim();
      let op = refId !== '' ? byId.get(refId) : null;
      if (!op && token !== '') {
        const key = token.toLowerCase();
        if (nameCount.get(key) === 1) {
          op = ops.find((o) => String(o.name == null ? '' : o.name).trim().toLowerCase() === key) || null;
        }
      }
      if (!op) continue;
      const id = typeof op.id === 'string' ? op.id : '';
      const dedupe = id !== '' ? 'id:' + id : 'name:' + String(op.name).trim().toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(cloneOperation(op));
    }
  }
  return out;
}

function planOperationsImport(payloadOps, localOps) {
  const list = Array.isArray(payloadOps) ? payloadOps : [];
  const locals = (Array.isArray(localOps) ? localOps : [])
    .filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  const localById = new Map();
  const localByName = new Map();
  for (const o of locals) {
    if (typeof o.id === 'string' && o.id !== '') localById.set(o.id, o);
    const key = String(o.name == null ? '' : o.name).trim().toLowerCase();
    if (key !== '' && !localByName.has(key)) localByName.set(key, o);
  }
  const payloadById = new Map();
  for (const o of list) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    if (typeof o.id === 'string' && o.id !== '' && !payloadById.has(o.id)) payloadById.set(o.id, o);
  }
  const taken = new Set(localById.keys());
  for (const id of payloadById.keys()) taken.add(id);

  const rows = [];
  const remaps = [];
  const nameConflicts = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      rows.push({ index: i, id: '', name: '(invalid item)', status: 'invalid', newId: null });
      continue;
    }
    const name = String(raw.name == null ? '' : raw.name).trim();
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (name === '') {
      rows.push({ index: i, id, name: '(unnamed)', status: 'invalid', newId: null });
      continue;
    }
    let status = 'new';
    let newId = null;
    const localSameId = id !== '' ? localById.get(id) : null;
    if (localSameId) {
      if (opsContentEqual(localSameId, raw)) {
        status = 'identical';
      } else {
        status = 'remap';
        newId = freshOpId(taken);
        taken.add(newId);
      }
    } else if (id === '') {
      newId = freshOpId(taken);
      taken.add(newId);
    } else {
      const earlier = payloadById.get(id);
      if (earlier && earlier !== raw) {
        status = 'remap';
        newId = freshOpId(taken);
        taken.add(newId);
      }
    }
    const effectiveId = newId || id;
    const localSameName = localByName.get(name.toLowerCase());
    const remapOwnsName = status === 'remap' && localSameId && localSameName
      && localSameName.id === localSameId.id;
    if (!remapOwnsName && localSameName && effectiveId !== '' && localSameName.id !== effectiveId) {
      if (status === 'new') status = 'name-conflict';
      nameConflicts.push({ index: i, id: effectiveId, name });
    }
    const row = { index: i, id, name, status, newId };
    rows.push(row);
    if (status === 'remap') remaps.push({ index: i, id, newId, name });
  }
  const byName = new Map();
  for (const r of rows) {
    if (r.status === 'invalid' || r.status === 'identical') continue;
    const key = String(r.name).trim().toLowerCase();
    const eff = r.newId || r.id || '';
    if (key === '' || eff === '') continue;
    if (!byName.has(key)) byName.set(key, []);
    const list = byName.get(key);
    if (!list.some((x) => (x.newId || x.id || '') === eff)) list.push(r);
  }
  const reported = new Set(nameConflicts.map((c) => c.index));
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      if (reported.has(r.index)) continue;
      reported.add(r.index);
      nameConflicts.push({ index: r.index, id: r.newId || r.id || '', name: r.name, source: 'payload' });
    }
  }
  return { rows, remaps, nameConflicts };
}

function remapOperationRefs(items, mapping, planRows) {
  const map = (mapping && typeof mapping.get === 'function' && typeof mapping.has === 'function')
    ? mapping
    : new Map(Object.entries(mapping || {}));
  if (map.size === 0) return 0;
  const rowsById = new Map();
  for (const r of (Array.isArray(planRows) ? planRows : [])) {
    if (!r || r.status === 'invalid') continue;
    if (typeof r.id !== 'string' || r.id === '') continue;
    if (!rowsById.has(r.id)) rowsById.set(r.id, []);
    rowsById.get(r.id).push(r);
  }
  let count = 0;
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    for (const r of (Array.isArray(it.operations) ? it.operations : [])) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      const id = typeof r.operationId === 'string' ? r.operationId : '';
      if (id === '' || !map.has(id)) continue;
      let next = map.get(id);
      const group = rowsById.get(id);
      if (group && group.length > 1) {
        const names = [];
        for (const cand of [r.operationName, r.token]) {
          const t = String(cand == null ? '' : cand).trim().toLowerCase();
          if (t !== '' && names.indexOf(t) === -1) names.push(t);
        }
        let pick = null;
        for (const t of names) {
          const matches = group.filter((row) =>
            String(row.name == null ? '' : row.name).trim().toLowerCase() === t);
          if (matches.length === 1) pick = matches[0];
          if (matches.length !== 0) break;
        }
        if (!pick) continue;
        next = pick.newId || pick.id || id;
      }
      if (next !== id) {
        r.operationId = next;
        count++;
      }
    }
  }
  return count;
}

function remapGenOccurrenceRefs(items, mapping, planRows) {
  const map = (mapping && typeof mapping.get === 'function' && typeof mapping.has === 'function')
    ? mapping
    : new Map(Object.entries(mapping || {}));
  if (map.size === 0) return 0;
  const rowsById = new Map();
  for (const r of (Array.isArray(planRows) ? planRows : [])) {
    if (!r || r.status === 'invalid') continue;
    if (typeof r.id !== 'string' || r.id === '') continue;
    if (!rowsById.has(r.id)) rowsById.set(r.id, []);
    rowsById.get(r.id).push(r);
  }
  let count = 0;
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    for (const row of (Array.isArray(it.occurrences) ? it.occurrences : [])) {
      if (!row || typeof row !== 'object') continue;
      if (row.kind !== 'op') continue;
      const id = typeof row.refId === 'string' ? row.refId : '';
      if (id === '' || !map.has(id)) continue;
      let next = map.get(id);
      const group = rowsById.get(id);
      if (group && group.length > 1) {
        const t = String(row.token == null ? '' : row.token).trim().toLowerCase();
        let pick = null;
        if (t !== '') {
          const matches = group.filter((row2) =>
            String(row2.name == null ? '' : row2.name).trim().toLowerCase() === t);
          if (matches.length === 1) pick = matches[0];
        }
        if (!pick) continue;
        next = pick.newId || pick.id || id;
      }
      if (next !== id) {
        row.refId = next;
        count++;
      }
    }
  }
  return count;
}

function remapEntryOpRefs(fileObj, mapping, planRows) {
  const map = (mapping && typeof mapping.get === 'function' && typeof mapping.has === 'function')
    ? mapping
    : new Map(Object.entries(mapping || {}));
  if (map.size === 0) return 0;
  const rowsById = new Map();
  for (const r of (Array.isArray(planRows) ? planRows : [])) {
    if (!r || r.status === 'invalid') continue;
    if (typeof r.id !== 'string' || r.id === '') continue;
    if (!rowsById.has(r.id)) rowsById.set(r.id, []);
    rowsById.get(r.id).push(r);
  }
  let count = 0;
  for (const it of (fileObj && Array.isArray(fileObj.items) ? fileObj.items : [])) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    for (const e of (Array.isArray(it.entries) ? it.entries : [])) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
      for (const r of (Array.isArray(e.operations) ? e.operations : [])) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
        const id = typeof r.operationId === 'string' ? r.operationId : '';
        if (id === '' || !map.has(id)) continue;
        let next = map.get(id);
        const group = rowsById.get(id);
        if (group && group.length > 1) {
          const names = [];
          for (const cand of [r.operationName, r.token]) {
            const t = String(cand == null ? '' : cand).trim().toLowerCase();
            if (t !== '' && names.indexOf(t) === -1) names.push(t);
          }
          let pick = null;
          for (const t of names) {
            const matches = group.filter((row) =>
              String(row.name == null ? '' : row.name).trim().toLowerCase() === t);
            if (matches.length === 1) pick = matches[0];
            if (matches.length !== 0) break;
          }
          if (!pick) continue;
          next = pick.newId || pick.id || id;
        }
        if (next !== id) {
          r.operationId = next;
          count++;
        }
      }
    }
  }
  return count;
}

function operationReportSuffix(analysis) {
  const a = (analysis && typeof analysis === 'object') ? analysis : {};
  const parts = [];
  const remaps = Array.isArray(a.remaps) ? a.remaps : [];
  if (remaps.length > 0) {
    parts.push(remaps.length + ' id remap' + (remaps.length === 1 ? '' : 's') + ': ' +
      remaps.map((r) => r.id + ' \u2192 ' + r.newId + ' (' + r.name + ')').join(', '));
  }
  const clashes = Array.isArray(a.nameConflicts) ? a.nameConflicts : [];
  if (clashes.length > 0) {
    parts.push(clashes.length + ' name conflict' + (clashes.length === 1 ? '' : 's') +
      ' (imported separately, no merge): ' + clashes.map((c) => c.name).join(', '));
  }
  return parts;
}

function opImportStatusText(o) {
  const r = (o && typeof o === 'object') ? o : {};
  if (r.status === 'identical') return 'same id + same content — link only, nothing written';
  if (r.status === 'remap') return 'id conflict — new id ' + (r.newId || '') + ', refs rewritten';
  if (r.status === 'name-conflict') return 'name exists locally — imported separately (no merge)';
  if (r.status === 'invalid') return 'no name / invalid — skipped';
  return 'new — will be imported';
}

function nextLogicOpsPath(stem) {
  const base = sanitizeFileName(String(stem || '')) || 'operations';
  let path = 'logic-ops/' + base + '.json';
  let n = 2;
  while (state.files.has(path)) {
    path = 'logic-ops/' + base + '-' + n + '.json';
    n++;
  }
  return path;
}

function genImportSnapshot(sourceName) {
  const generators = [];
  for (const g of state.generators) {
    const raw = itemsOf(g.file)[g.index];
    if (!raw || typeof raw !== 'object') continue;
    generators.push({ file: g.file, name: strOf(raw, 'name'), id: typeof raw.id === 'string' ? raw.id : '' });
  }
  const containers = [];
  for (const t of state.tables) {
    const raw = itemsOf(t.file)[t.index];
    containers.push({
      id: raw && typeof raw.id === 'string' ? raw.id : '',
      name: t.name,
      entries: Array.isArray(t.entries) ? t.entries : [],
    });
  }
  const operations = Array.isArray(state.logicOps) ? state.logicOps : [];
  const stem = String(sourceName || '').replace(/\.json$/i, '').trim();
  return {
    generators,
    containers,
    operations,
    generatorFiles: [...state.files.keys()].filter((p) => p.startsWith('generators/')).sort(),
    sourceStem: stem !== '' ? stem : 'import',
  };
}

function analyzeGenImportPayload(parsed, snapshot) {
  const out = {
    generators: [], containers: [],
    operations: [], remaps: [], nameConflicts: [],
    targetFile: 'generators/import.json', targetFileExists: false,
  };
  const p = (parsed && typeof parsed === 'object') ? parsed : {};
  const items = Array.isArray(p.items) ? p.items
    : (Array.isArray(p.generators) ? p.generators : []);
  const payloadContainers = Array.isArray(p.containers) ? p.containers : [];
  const s = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const localGens = Array.isArray(s.generators) ? s.generators : [];
  const localContainers = Array.isArray(s.containers) ? s.containers : [];
  const localOps = Array.isArray(s.operations) ? s.operations : [];
  const genFiles = Array.isArray(s.generatorFiles) ? s.generatorFiles : [];
  const stem = (typeof s.sourceStem === 'string' && s.sourceStem.trim() !== '') ? s.sourceStem.trim() : 'import';
  out.targetFile = 'generators/' + stem + '.json';
  out.targetFileExists = genFiles.indexOf(out.targetFile) !== -1;

  const nameLower = (x) => String(x == null ? '' : x).trim().toLowerCase();

  if (Array.isArray(p.operations) && p.operations.length > 0) {
    const plan = planOperationsImport(p.operations, localOps);
    out.operations = plan.rows;
    out.remaps = plan.remaps;
    out.nameConflicts = plan.nameConflicts;
  }

  for (const c of payloadContainers) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const id = typeof c.id === 'string' ? c.id : '';
    const name = c.name != null ? String(c.name) : '';
    const localById = localContainers.find((l) => l && typeof l.id === 'string' && l.id !== '' && l.id === id);
    const localByName = localContainers.find((l) => l && nameLower(l.name) !== '' && nameLower(l.name) === nameLower(name));
    let status;
    if (localById) status = 'id-exists';
    else if (localByName) status = 'name-conflict';
    else status = 'new';
    out.containers.push({ id, name, status, entries: Array.isArray(c.entries) ? c.entries : [] });
  }

  items.forEach((g, i) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      out.generators.push({
        name: '(invalid item)', id: '', status: 'no-name',
        issues: [{ kind: 'no-name', note: 'item is not an object' }],
        itemIndex: i, skip: true, missing: [], empty: [],
      });
      return;
    }
    const name = typeof g.name === 'string' ? g.name.trim() : '';
    const id = typeof g.id === 'string' ? g.id.trim() : '';
    const issues = [];
    if (name === '') {
      issues.push({ kind: 'no-name' });
    } else if (localGens.some((l) => nameLower(l.name) === nameLower(name) && nameLower(name) !== '')) {
      issues.push({ kind: 'duplicate-name', name });
    }
    if (id !== '' && localGens.some((l) => typeof l.id === 'string' && l.id === id)) {
      issues.push({ kind: 'duplicate-id', id });
    }
    const missing = [];
    const empty = [];
    const seenTokens = new Set();
    const refs = Array.isArray(g.references) ? g.references : [];
    for (const r of refs) {
      if (!r || typeof r !== 'object') continue;
      const token = r.token != null ? String(r.token).trim() : '';
      if (token === '') continue;
      const key = token.toLowerCase();
      if (seenTokens.has(key)) continue;
      seenTokens.add(key);
      let local = null;
      for (const l of localContainers) {
        if (l && nameLower(l.name) === key) { local = l; break; }
      }
      let pay = null;
      for (const c of out.containers) {
        if (nameLower(c.name) === key) { pay = c; break; }
      }
      if (!pay) {
        const refId = typeof r.containerId === 'string' ? r.containerId : '';
        if (refId !== '') {
          for (const c of out.containers) {
            if (c.id === refId) { pay = c; break; }
          }
        }
      }
      const resolved = local || pay;
      if (!resolved) {
        missing.push(token);
      } else if (!Array.isArray(resolved.entries) || resolved.entries.length === 0) {
        empty.push(token);
      }
    }
    for (const t of missing) issues.push({ kind: 'missing-container', token: t });
    for (const t of empty) issues.push({ kind: 'empty-container', token: t });
    out.generators.push({
      name: name !== '' ? name : '(unnamed)',
      id,
      status: issues.length === 0 ? 'OK' : issues[0].kind,
      issues,
      itemIndex: i,
      skip: issues.some((it) => it.kind === 'no-name' || it.kind === 'duplicate-name' || it.kind === 'duplicate-id'),
      missing,
      empty,
    });
  });
  return out;
}

function openGenImportDialog(sourceName, analysis) {
  return new Promise((resolve) => {
    let targetFile = analysis.targetFile;
    let decided = !analysis.targetFileExists;
    let finished = false;

    const overlay = el('div', { class: 'gen-import-overlay', id: 'gen-import-panel' });
    const dialog = el('div', {
      class: 'gen-import-dialog', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Import generators preview',
    });
    const closeBtn = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Close import preview' }, '✕');
    dialog.append(el('div', { class: 'examples-head' },
      el('h2', { class: 'examples-title' }, 'Import generators — ' + sourceName),
      closeBtn,
    ));

    const body = el('div', { class: 'gen-import-body' });

    const targetRow = el('div', { class: 'gen-import-row gen-import-target' });
    const renderTarget = () => {
      targetRow.replaceChildren(
        el('span', {}, 'Target file: '),
        el('span', { class: 'mono' }, targetFile),
      );
      if (analysis.targetFileExists) {
        targetRow.append(el('span', { class: 'gen-import-issue' },
          decided
            ? ' — new name chosen, will be created.'
            : ' — already exists locally; pick a new name or skip.'));
      } else {
        targetRow.append(el('span', { class: 'hint' }, ' — will be created.'));
      }
    };
    renderTarget();
    if (analysis.targetFileExists) {
      const newNameBtn = el('button', { class: 'btn tiny', type: 'button' }, 'use new name…');
      newNameBtn.addEventListener('click', () => {
        const defaultStem = targetFile.replace(/^generators\//, '').replace(/\.json$/i, '') + '-2';
        const answer = prompt('generators/' + targetFile + ' already exists.\nNew generator file name (without .json):', defaultStem);
        if (answer == null) return;
        const stem = String(answer).trim().replace(/\.json$/i, '').trim();
        if (stem === '') { toast('That file name is not usable.', 'error'); return; }
        const candidate = 'generators/' + stem + '.json';
        if (state.files.has(candidate)) { toast(candidate + ' already exists too — pick another.', 'error'); return; }
        targetFile = candidate;
        decided = true;
        renderTarget();
        importBtn.disabled = false;
      });
      const skipBtn = el('button', { class: 'btn tiny danger', type: 'button' }, 'skip import');
      skipBtn.addEventListener('click', () => finish(false, null));
      targetRow.append(newNameBtn, skipBtn);
    }
    body.append(el('div', { class: 'gen-import-section-label' }, 'Target'), targetRow);

    body.append(el('div', { class: 'gen-import-section-label' }, 'Generators (' + analysis.generators.length + ')'));
    if (analysis.generators.length === 0) {
      body.append(el('div', { class: 'hint' }, 'No generators in this file.'));
    }
    for (const g of analysis.generators) {
      const row = el('div', { class: 'gen-import-row' });
      row.append(el('span', { class: 'gen-import-name' },
        (g.skip ? '⊘ ' : '') + g.name + (g.id !== '' ? '  (id ' + g.id + ')' : '')));
      if (g.status === 'OK') {
        row.append(el('span', { class: 'gen-import-issue ok' }, 'OK'));
      } else {
        for (const iss of g.issues) {
          const txt = iss.kind === 'missing-container' ? 'missing container [' + iss.token + ']'
            : iss.kind === 'empty-container' ? 'empty container [' + iss.token + ']'
            : iss.kind === 'duplicate-name' ? 'duplicate name — skipped'
            : iss.kind === 'duplicate-id' ? 'duplicate id — skipped'
            : 'no name — skipped';
          row.append(el('span', { class: 'gen-import-issue' }, txt));
        }
      }
      body.append(row);
    }

    if (analysis.containers.length > 0) {
      body.append(el('div', { class: 'gen-import-section-label' }, 'Containers in file (' + analysis.containers.length + ')'));
      for (const c of analysis.containers) {
        const row = el('div', { class: 'gen-import-row' });
        row.append(el('span', { class: 'gen-import-name' },
          (c.name !== '' ? c.name : '(unnamed)') + (c.id !== '' ? '  (id ' + c.id + ')' : '')));
        const txt = c.status === 'new' ? 'new — will be imported'
          : c.status === 'id-exists' ? 'id exists locally — link only, local container is NOT overwritten'
          : 'name conflict — skipped';
        row.append(el('span', { class: 'gen-import-issue' + (c.status === 'new' ? ' ok' : '') }, txt));
        body.append(row);
      }
    }

    if (Array.isArray(analysis.operations) && analysis.operations.length > 0) {
      body.append(el('div', { class: 'gen-import-section-label' },
        'Operations in file (' + analysis.operations.length + ')'));
      for (const o of analysis.operations) {
        const row = el('div', { class: 'gen-import-row' });
        row.append(el('span', { class: 'gen-import-name' },
          (o.status === 'invalid' ? '⊘ ' : '') + o.name
          + (o.id !== '' ? '  (id ' + o.id + ')' : '')
          + (o.status === 'remap' && o.newId ? '  → ' + o.newId : '')));
        row.append(el('span', {
          class: 'gen-import-issue' + (o.status === 'new' ? ' ok' : ''),
        }, opImportStatusText(o)));
        body.append(row);
      }
    }

    const importBtn = el('button', { class: 'btn primary', type: 'button' }, 'Import');
    const cancelBtn = el('button', { class: 'btn small', type: 'button' }, 'Cancel');
    if (analysis.targetFileExists) importBtn.disabled = true;
    importBtn.addEventListener('click', () => finish(true, targetFile));
    cancelBtn.addEventListener('click', () => finish(false, null));
    dialog.append(body, el('div', { class: 'gen-import-foot' }, importBtn, cancelBtn));
    overlay.append(dialog);
    document.body.append(overlay);

    function finish(applied, target) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      resolve({ applied: !!applied, targetFile: target || null });
    }
    const escHandler = (e) => { if (e.key === 'Escape') finish(false, null); };
    closeBtn.addEventListener('click', () => finish(false, null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(false, null); });
    document.addEventListener('keydown', escHandler);
    importBtn.focus();
  });
}

async function applyGenImport(parsed, analysis, targetFile) {
  const imported = analysis.generators.filter((g) => !g.skip);
  const skippedGens = analysis.generators.length - imported.length;
  const newContainers = analysis.containers.filter((c) => c.status === 'new');

  let containerFile = null;
  if (newContainers.length > 0) {
    const stem = targetFile.replace(/^generators\//, '').replace(/\.json$/i, '');
    containerFile = 'tables/' + stem + '-containers.json';
    const clones = newContainers.map((c) =>
      JSON.parse(JSON.stringify({ id: c.id, name: c.name, entries: c.entries })));
    if (state.files.has(containerFile)) {
      if (!(await mutateTable(containerFile, (its) => { for (const c of clones) its.push(c); }))) return null;
    } else {
      const text = JSON.stringify({ items: clones }, null, 2) + '\n';
      try {
        await state.storage.createFile(containerFile, text);
        setFile(containerFile, text);
      } catch (e) {
        toast(containerFile + ': ' + e.message, 'error');
        return null;
      }
    }
    await ensureContainerIds(containerFile);
  }

  const opRemap = new Map();
  let opsFile = null;
  let opsImported = 0;
  const opRows = Array.isArray(analysis.operations) ? analysis.operations : [];
  for (const r of opRows) {
    if (r.status === 'remap' && r.id !== '' && r.newId) opRemap.set(r.id, r.newId);
  }
  const opsToWrite = opRows.filter((r) =>
    r.status === 'new' || r.status === 'remap' || r.status === 'name-conflict');
  if (opsToWrite.length > 0) {
    const stem = targetFile.replace(/^generators\//, '').replace(/\.json$/i, '');
    opsFile = nextLogicOpsPath(stem + '-ops');
    const payloadOps = Array.isArray(parsed.operations) ? parsed.operations : [];
    const clones = opsToWrite.map((r) =>
      cloneOperation(payloadOps[r.index], r.newId || r.id || ''));
    const text = JSON.stringify({ items: clones }, null, 2) + '\n';
    try {
      await state.storage.createFile(opsFile, text);
      setFile(opsFile, text);
    } catch (e) {
      toast(opsFile + ': ' + e.message, 'error');
      return null;
    }
    opsImported = clones.length;
  }

  const gensToWrite = [];
  for (const g of imported) {
    const raw = (parsed && Array.isArray(parsed.items)) ? parsed.items[g.itemIndex] : (parsed && Array.isArray(parsed.generators) ? parsed.generators[g.itemIndex] : null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    gensToWrite.push(JSON.parse(JSON.stringify(raw)));
  }
  const refsRewritten = remapOperationRefs(gensToWrite, opRemap, opRows);
  const occRewritten = remapGenOccurrenceRefs(gensToWrite, opRemap, opRows);
  const skippedOps = opRows.filter((r) => r.status === 'invalid').length;
  if (gensToWrite.length === 0 && newContainers.length === 0 && opsToWrite.length === 0) {
    toast('Nothing importable in this file.' + (skippedOps > 0
      ? ' ' + skippedOps + ' operation' + (skippedOps === 1 ? '' : 's') + ' skipped (invalid).'
      : ''), 'warn');
    return null;
  }
  if (gensToWrite.length > 0) {
    const text = JSON.stringify({ items: gensToWrite }, null, 2) + '\n';
    try {
      await state.storage.createFile(targetFile, text);
      setFile(targetFile, text);
    } catch (e) {
      toast(targetFile + ': ' + e.message, 'error');
      return null;
    }

    derive();
    const eng = genEngine();
    for (const g of itemsOf(targetFile)) {
      if (!g || typeof g !== 'object') continue;
      g.template = typeof g.template === 'string' ? g.template : '';
      if (typeof normalizeGeneratorItem === 'function' && g.template !== '' && eng) {
        normalizeGeneratorItem(g, { macros: state.macros });
        continue;
      }
      g.references = eng
        ? eng.resolveReferences(g.template, engineContainers(), Array.isArray(g.references) ? g.references : [])
        : [];
      const priorOps = Array.isArray(g.operations) ? g.operations : [];
      if (typeof genOperationRefs === 'function') {
        g.operations = genOperationRefs(g.template, priorOps);
      } else if (eng && typeof eng.resolveOperationRefs === 'function') {
        g.operations = eng.resolveOperationRefs(g.template, state.logicOps, priorOps);
      } else {
        g.operations = priorOps;
      }
    }
    try {
      await persistGeneratorFile(targetFile);
    } catch (e) {
      toast(targetFile + ': ' + e.message, 'error');
      return null;
    }
  }
  derive();
  renderAll();

  const keptFlagged = imported.filter((g) => g.missing.length > 0 || g.empty.length > 0).length;
  const skippedContainers = analysis.containers.filter((c) => c.status === 'name-conflict').length;
  const parts = [];
  parts.push('Imported ' + gensToWrite.length + ' generator' + (gensToWrite.length === 1 ? '' : 's'));
  if (newContainers.length > 0) {
    parts.push(newContainers.length + ' container' + (newContainers.length === 1 ? '' : 's') + (containerFile ? ' in ' + containerFile : ''));
  }
  if (opsImported > 0) {
    parts.push(opsImported + ' operation' + (opsImported === 1 ? '' : 's') + (opsFile ? ' in ' + opsFile : ''));
  }
  const linkedOps = opRows.filter((r) => r.status === 'identical').length;
  if (linkedOps > 0) parts.push(linkedOps + ' operation' + (linkedOps === 1 ? '' : 's') + ' linked (identical)');
  let summary = parts.join(', ');
  const skips = [];
  if (skippedGens > 0) skips.push(skippedGens + ' generator' + (skippedGens === 1 ? '' : 's') + ' skipped (duplicate/no name)');
  if (skippedContainers > 0) skips.push(skippedContainers + ' container' + (skippedContainers === 1 ? '' : 's') + ' skipped (name conflict)');
  if (keptFlagged > 0) skips.push(keptFlagged + ' generator' + (keptFlagged === 1 ? '' : 's') + ' kept with missing/empty containers');
  if (skippedOps > 0) skips.push(skippedOps + ' operation' + (skippedOps === 1 ? '' : 's') + ' skipped (invalid)');
  for (const line of operationReportSuffix(analysis)) skips.push(line);
  if (refsRewritten > 0) skips.push(refsRewritten + ' operation ref' + (refsRewritten === 1 ? '' : 's') + ' rewritten');
  if (occRewritten > 0) skips.push(occRewritten + ' occurrence ref' + (occRewritten === 1 ? '' : 's') + ' rewritten');
  if (skips.length > 0) summary += '; ' + skips.join('; ');
  toast(summary);
  return summary;
}

function tablesImportSnapshot(sourceName) {
  const tableFiles = {};
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('tables/')).sort()) {
    const parsed = state.files.get(p).parsed;
    tableFiles[p] = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.items)
      ? parsed.items.length : 0;
  }
  const operations = Array.isArray(state.logicOps) ? state.logicOps : [];
  const stem = String(sourceName || '').replace(/\.json$/i, '').trim();
  return { tableFiles, operations, sourceStem: stem !== '' ? stem : 'import' };
}

function analyzeTablesImportPayload(parsed, snapshot) {
  const tableFiles = (snapshot && typeof snapshot.tableFiles === 'object' && snapshot.tableFiles) || {};
  const entries = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.kind === 'ttrpg-tables' && parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
      for (const [p, v] of Object.entries(parsed.files)) entries.push([p, v]);
    } else if (Array.isArray(parsed.items)) {
      const stem = (snapshot && typeof snapshot.sourceStem === 'string' && snapshot.sourceStem !== '')
        ? snapshot.sourceStem : 'import';
      entries.push(['tables/' + stem + '.json', parsed]);
    }
  }
  const targetFiles = entries.map(([p, v]) => {
    const path = typeof p === 'string' ? p : '';
    if (path === '' || !/^tables\/[^/]+\.json$/.test(path)) {
      return { path: path === '' ? '(unknown path)' : path, status: 'invalid', items: 0, reason: 'bad-path', skip: true };
    }
    const okShape = v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.items)
      && v.items.every((it) => it && typeof it === 'object' && !Array.isArray(it) && Array.isArray(it.entries));
    if (!okShape) {
      return { path, status: 'invalid', items: 0, reason: 'not-tables', skip: true };
    }
    return {
      path,
      status: Object.prototype.hasOwnProperty.call(tableFiles, path) ? 'overwrite' : 'new',
      items: v.items.length,
      reason: null,
      skip: false,
    };
  });
  const opsPlan = planOperationsImport(
    parsed && Array.isArray(parsed.operations) ? parsed.operations : [],
    snapshot && Array.isArray(snapshot.operations) ? snapshot.operations : []);
  return {
    targetFiles,
    operations: opsPlan.rows,
    remaps: opsPlan.remaps,
    nameConflicts: opsPlan.nameConflicts,
    sourceStem: (snapshot && typeof snapshot.sourceStem === 'string' && snapshot.sourceStem !== '')
      ? snapshot.sourceStem : 'import',
  };
}

function openTablesImportDialog(sourceName, analysis) {
  return new Promise((resolve) => {
    let finished = false;

    const overlay = el('div', { class: 'gen-import-overlay', id: 'tables-import-panel' });
    const dialog = el('div', {
      class: 'gen-import-dialog', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Import tables preview',
    });
    const closeBtn = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Close import preview' }, '✕');
    dialog.append(el('div', { class: 'examples-head' },
      el('h2', { class: 'examples-title' }, 'Import tables — ' + sourceName),
      closeBtn,
    ));

    const body = el('div', { class: 'gen-import-body' });
    const rows = analysis.targetFiles;
    body.append(el('div', { class: 'gen-import-section-label' }, 'Tables files (' + rows.length + ')'));
    if (rows.length === 0) {
      body.append(el('div', { class: 'hint' }, 'No importable tables files in this payload.'));
    }
    for (const r of rows) {
      const row = el('div', { class: 'gen-import-row' });
      row.append(el('span', { class: 'gen-import-name' },
        (r.skip ? '⊘ ' : '') + r.path));
      const txt = r.status === 'invalid'
        ? (r.reason === 'not-tables' ? 'not a tables file — skipped' : 'invalid path — skipped')
        : r.status === 'new'
          ? 'new — will be created (' + r.items + ' item' + (r.items === 1 ? '' : 's') + ')'
          : 'overwrite — will be replaced (' + r.items + ' item' + (r.items === 1 ? '' : 's') + ')';
      row.append(el('span', { class: 'gen-import-issue' + (r.status === 'new' ? ' ok' : '') }, txt));
      body.append(row);
    }

    if (Array.isArray(analysis.operations) && analysis.operations.length > 0) {
      body.append(el('div', { class: 'gen-import-section-label' },
        'Operations in file (' + analysis.operations.length + ')'));
      for (const o of analysis.operations) {
        const row = el('div', { class: 'gen-import-row' });
        row.append(el('span', { class: 'gen-import-name' },
          (o.status === 'invalid' ? '⊘ ' : '') + o.name
          + (o.id !== '' ? '  (id ' + o.id + ')' : '')
          + (o.status === 'remap' && o.newId ? '  → ' + o.newId : '')));
        row.append(el('span', {
          class: 'gen-import-issue' + (o.status === 'new' ? ' ok' : ''),
        }, opImportStatusText(o)));
        body.append(row);
      }
    }

    const fileCount = rows.filter((r) => !r.skip).length;
    const opWriteCount = (Array.isArray(analysis.operations) ? analysis.operations : [])
      .filter((o) => o.status === 'new' || o.status === 'remap' || o.status === 'name-conflict').length;
    const validCount = fileCount + opWriteCount;
    const importBtn = el('button', { class: 'btn primary', type: 'button' },
      validCount === 0 ? 'Import (nothing to do)'
        : 'Import '
          + (fileCount > 0 ? fileCount + ' file' + (fileCount === 1 ? '' : 's') : '')
          + (fileCount > 0 && opWriteCount > 0 ? ' + ' : '')
          + (opWriteCount > 0 ? opWriteCount + ' operation' + (opWriteCount === 1 ? '' : 's') : ''));
    const cancelBtn = el('button', { class: 'btn small', type: 'button' }, 'Cancel');
    if (validCount === 0) importBtn.disabled = true;
    importBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    dialog.append(body, el('div', { class: 'gen-import-foot' }, importBtn, cancelBtn));
    overlay.append(dialog);
    document.body.append(overlay);

    function finish(applied) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      resolve({ applied: !!applied });
    }
    const escHandler = (e) => { if (e.key === 'Escape') finish(false); };
    closeBtn.addEventListener('click', () => finish(false));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(false); });
    document.addEventListener('keydown', escHandler);
    importBtn.focus();
  });
}

async function applyTablesImport(parsed, analysis) {
  const rows = analysis.targetFiles.filter((r) => !r.skip);
  const opRows = Array.isArray(analysis.operations) ? analysis.operations : [];
  const opRemap = new Map();
  for (const r of opRows) {
    if (r.status === 'remap' && r.id !== '' && r.newId) opRemap.set(r.id, r.newId);
  }
  const opsToWrite = opRows.filter((r) =>
    r.status === 'new' || r.status === 'remap' || r.status === 'name-conflict');
  const skippedOps = opRows.filter((r) => r.status === 'invalid').length;
  if (rows.length === 0 && opsToWrite.length === 0) {
    toast('Nothing importable in this file.' + (skippedOps > 0
      ? ' ' + skippedOps + ' operation' + (skippedOps === 1 ? '' : 's') + ' skipped (invalid).'
      : ''), 'warn');
    return null;
  }
  let opsFile = null;
  let opsImported = 0;
  if (opsToWrite.length > 0) {
    const stem = (typeof analysis.sourceStem === 'string' && analysis.sourceStem !== '')
      ? analysis.sourceStem : 'import';
    opsFile = nextLogicOpsPath(stem + '-ops');
    const payloadOps = Array.isArray(parsed.operations) ? parsed.operations : [];
    const clones = opsToWrite.map((r) =>
      cloneOperation(payloadOps[r.index], r.newId || r.id || ''));
    const text = JSON.stringify({ items: clones }, null, 2) + '\n';
    try {
      await state.storage.createFile(opsFile, text);
      setFile(opsFile, text);
    } catch (e) {
      toast(opsFile + ': ' + e.message, 'error');
      return null;
    }
    opsImported = clones.length;
  }
  let newCount = 0;
  let overwriteCount = 0;
  let refsRewritten = 0;
  for (const r of rows) {
    const isBundle = parsed.kind === 'ttrpg-tables' && parsed.files
      && typeof parsed.files === 'object' && !Array.isArray(parsed.files);
    const fileObj = JSON.parse(JSON.stringify(
      isBundle ? parsed.files[r.path] : parsed));
    refsRewritten += remapEntryOpRefs(fileObj, opRemap, opRows);
    const text = JSON.stringify(fileObj, null, 2) + '\n';
    try {
      if (state.files.has(r.path)) {
        await state.storage.writeFile(r.path, text);
        overwriteCount++;
      } else {
        await state.storage.createFile(r.path, text);
        newCount++;
      }
      setFile(r.path, text);
      await ensureContainerIds(r.path);
    } catch (e) {
      toast(r.path + ': ' + e.message, 'error');
      return null;
    }
  }
  derive();
  renderAll();

  const parts = ['Imported ' + rows.length + ' tables file' + (rows.length === 1 ? '' : 's')];
  if (newCount > 0) parts.push(newCount + ' new');
  if (overwriteCount > 0) parts.push(overwriteCount + ' overwrite' + (overwriteCount === 1 ? '' : 's'));
  if (opsImported > 0) {
    parts.push(opsImported + ' operation' + (opsImported === 1 ? '' : 's') + (opsFile ? ' in ' + opsFile : ''));
  }
  const linkedOps = opRows.filter((r) => r.status === 'identical').length;
  if (linkedOps > 0) parts.push(linkedOps + ' operation' + (linkedOps === 1 ? '' : 's') + ' linked (identical)');
  let summary = parts.join(', ');
  const skips = [];
  const skipped = analysis.targetFiles.length - rows.length;
  if (skipped > 0) skips.push(skipped + ' file' + (skipped === 1 ? '' : 's') + ' skipped (invalid)');
  if (skippedOps > 0) skips.push(skippedOps + ' operation' + (skippedOps === 1 ? '' : 's') + ' skipped (invalid)');
  if (refsRewritten > 0) skips.push(refsRewritten + ' operation ref' + (refsRewritten === 1 ? '' : 's') + ' rewritten');
  for (const line of operationReportSuffix(analysis)) skips.push(line);
  if (skips.length > 0) summary += '; ' + skips.join('; ');
  toast(summary);
  return summary;
}

async function importTablesPayload(sourceName, parsed) {
  const analysis = analyzeTablesImportPayload(parsed, tablesImportSnapshot(sourceName));
  const decision = await openTablesImportDialog(sourceName, analysis);
  if (!decision.applied) return false;
  const summary = await applyTablesImport(parsed, analysis);
  return summary != null;
}

async function importGeneratorPayload(sourceName, parsed) {
  const analysis = analyzeGenImportPayload(parsed, genImportSnapshot(sourceName));
  const decision = await openGenImportDialog(sourceName, analysis);
  if (!decision.applied) return false;
  const summary = await applyGenImport(parsed, analysis, decision.targetFile);
  return summary != null;
}

function macrosImportSnapshot(sourceName) {
  const macroFiles = {};
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('dice-macros/')).sort()) {
    const parsed = state.files.get(p).parsed;
    macroFiles[p] = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.items)
      ? parsed.items.length : 0;
  }
  const stem = String(sourceName || '').replace(/\.json$/i, '').trim();
  return { macroFiles, sourceStem: stem !== '' ? stem : 'import' };
}

function analyzeMacrosImportPayload(parsed, snapshot) {
  const macroFiles = (snapshot && typeof snapshot.macroFiles === 'object' && snapshot.macroFiles) || {};
  const entries = [];
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.kind === 'ttrpg-macros' && parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
      for (const [p, v] of Object.entries(parsed.files)) entries.push([p, v]);
    } else if (Array.isArray(parsed.items)) {
      const stem = (snapshot && typeof snapshot.sourceStem === 'string' && snapshot.sourceStem !== '')
        ? snapshot.sourceStem : 'import';
      entries.push(['dice-macros/' + stem + '.json', parsed]);
    }
  }
  const targetFiles = entries.map(([p, v]) => {
    const path = typeof p === 'string' ? p : '';
    if (path === '' || !/^dice-macros\/[^/]+\.json$/.test(path)) {
      return { path: path === '' ? '(unknown path)' : path, status: 'invalid', items: 0, reason: 'bad-path', skip: true };
    }
    const okShape = v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.items)
      && v.items.every((it) => it && typeof it === 'object' && !Array.isArray(it)
        && typeof it.name === 'string' && it.name.trim() !== ''
        && typeof it.formula === 'string' && it.formula.trim() !== '');
    if (!okShape) {
      return { path, status: 'invalid', items: 0, reason: 'not-macros', skip: true };
    }
    return {
      path,
      status: Object.prototype.hasOwnProperty.call(macroFiles, path) ? 'overwrite' : 'new',
      items: v.items.length,
      reason: null,
      skip: false,
    };
  });
  return { targetFiles };
}

function openMacrosImportDialog(sourceName, analysis) {
  return new Promise((resolve) => {
    let finished = false;

    const overlay = el('div', { class: 'gen-import-overlay', id: 'macros-import-panel' });
    const dialog = el('div', {
      class: 'gen-import-dialog', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Import macros preview',
    });
    const closeBtn = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Close import preview' }, '✕');
    dialog.append(el('div', { class: 'examples-head' },
      el('h2', { class: 'examples-title' }, 'Import macros — ' + sourceName),
      closeBtn,
    ));

    const body = el('div', { class: 'gen-import-body' });
    const rows = analysis.targetFiles;
    body.append(el('div', { class: 'gen-import-section-label' }, 'Macros files (' + rows.length + ')'));
    if (rows.length === 0) {
      body.append(el('div', { class: 'hint' }, 'No importable macros files in this payload.'));
    }
    for (const r of rows) {
      const row = el('div', { class: 'gen-import-row' });
      row.append(el('span', { class: 'gen-import-name' },
        (r.skip ? '⊘ ' : '') + r.path));
      const txt = r.status === 'invalid'
        ? (r.reason === 'not-macros' ? 'not a macros file — skipped' : 'invalid path — skipped')
        : r.status === 'new'
          ? 'new — will be created (' + r.items + ' item' + (r.items === 1 ? '' : 's') + ')'
          : 'overwrite — will be replaced (' + r.items + ' item' + (r.items === 1 ? '' : 's') + ')';
      row.append(el('span', { class: 'gen-import-issue' + (r.status === 'new' ? ' ok' : '') }, txt));
      body.append(row);
    }

    const validCount = rows.filter((r) => !r.skip).length;
    const importBtn = el('button', { class: 'btn primary', type: 'button' },
      validCount === 0 ? 'Import (nothing to do)' : 'Import ' + validCount + ' file' + (validCount === 1 ? '' : 's'));
    const cancelBtn = el('button', { class: 'btn small', type: 'button' }, 'Cancel');
    if (validCount === 0) importBtn.disabled = true;
    importBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    dialog.append(body, el('div', { class: 'gen-import-foot' }, importBtn, cancelBtn));
    overlay.append(dialog);
    document.body.append(overlay);

    function finish(applied) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', escHandler);
      overlay.remove();
      resolve({ applied: !!applied });
    }
    const escHandler = (e) => { if (e.key === 'Escape') finish(false); };
    closeBtn.addEventListener('click', () => finish(false));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(false); });
    document.addEventListener('keydown', escHandler);
    importBtn.focus();
  });
}

async function applyMacrosImport(parsed, analysis) {
  const rows = analysis.targetFiles.filter((r) => !r.skip);
  if (rows.length === 0) {
    toast('Nothing importable in this file.', 'warn');
    return null;
  }
  let newCount = 0;
  let overwriteCount = 0;
  for (const r of rows) {
    const isBundle = parsed.kind === 'ttrpg-macros' && parsed.files
      && typeof parsed.files === 'object' && !Array.isArray(parsed.files);
    const fileObj = isBundle ? parsed.files[r.path] : parsed;
    const text = JSON.stringify(fileObj, null, 2) + '\n';
    try {
      if (state.files.has(r.path)) {
        await state.storage.writeFile(r.path, text);
        overwriteCount++;
      } else {
        await state.storage.createFile(r.path, text);
        newCount++;
      }
      setFile(r.path, text);
    } catch (e) {
      toast(r.path + ': ' + e.message, 'error');
      return null;
    }
  }
  derive();
  renderAll();

  const parts = ['Imported ' + rows.length + ' macros file' + (rows.length === 1 ? '' : 's')];
  if (newCount > 0) parts.push(newCount + ' new');
  if (overwriteCount > 0) parts.push(overwriteCount + ' overwrite' + (overwriteCount === 1 ? '' : 's'));
  let summary = parts.join(', ');
  const skipped = analysis.targetFiles.length - rows.length;
  if (skipped > 0) summary += '; ' + skipped + ' file' + (skipped === 1 ? '' : 's') + ' skipped (invalid)';
  toast(summary);
  return summary;
}

async function importMacrosPayload(sourceName, parsed) {
  const analysis = analyzeMacrosImportPayload(parsed, macrosImportSnapshot(sourceName));
  const decision = await openMacrosImportDialog(sourceName, analysis);
  if (!decision.applied) return false;
  const summary = await applyMacrosImport(parsed, analysis);
  return summary != null;
}

const BUNDLE_KIND_BY_TAG = {
  'ttrpg-generators': 'generators',
  'ttrpg-tables': 'tables',
  'ttrpg-macros': 'macros',
  'ttrpg-logic-ops': 'logic-ops',
};

function sniffKind(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.kind === 'string'
      && Object.prototype.hasOwnProperty.call(BUNDLE_KIND_BY_TAG, parsed.kind)) {
    return BUNDLE_KIND_BY_TAG[parsed.kind];
  }
  if (!Array.isArray(parsed.items)) return null;
  const hasTemplate = parsed.items.some((it) =>
    it && typeof it === 'object' && typeof it.template === 'string' && it.template.trim() !== '');
  const hasFormula = parsed.items.some((it) =>
    it && typeof it === 'object' && typeof it.formula === 'string' && it.formula.trim() !== '');
  const hasEntries = parsed.items.some((it) =>
    it && typeof it === 'object' && Array.isArray(it.entries));
  const hasScriptOp = parsed.items.some((it) =>
    it && typeof it === 'object' && !Array.isArray(it)
    && typeof it.script === 'string' && it.script.trim() !== '');
  if (hasTemplate) return 'generators';
  if (hasFormula) return 'macros';
  if (hasEntries) return 'tables';
  if (hasScriptOp) return 'logic-ops';
  return null;
}

async function handleDroppedFiles(files) {
  const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
  if (jsonFiles.length === 0) {
    toast(files.length === 1 ? files[0].name + ' is not a .json file.' : 'Drop .json files to import.', 'error');
    return;
  }
  let ok = 0;
  let failed = 0;
  for (const f of jsonFiles) {
    let text;
    try {
      text = await f.text();
    } catch (_) {
      failed++;
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      toast(f.name + ': not valid JSON — ' + e.message, 'error');
      failed++;
      continue;
    }
    const isGenPayload = (parsed && parsed.kind === 'ttrpg-generators')
      || (parsed && Array.isArray(parsed.generators))
      || sniffKind(parsed) === 'generators';
    if (isGenPayload) {
      try {
        await importGeneratorPayload(f.name, parsed);
      } catch (e) {
        toast(f.name + ': ' + e.message, 'error');
        failed++;
      }
      continue;
    }
    const isTablesPayload = (parsed && parsed.kind === 'ttrpg-tables'
        && parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files))
      || sniffKind(parsed) === 'tables';
    if (isTablesPayload) {
      try {
        await importTablesPayload(f.name, parsed);
      } catch (e) {
        toast(f.name + ': ' + e.message, 'error');
        failed++;
      }
      continue;
    }
    const isMacrosPayload = (parsed && parsed.kind === 'ttrpg-macros'
        && parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files))
      || sniffKind(parsed) === 'macros';
    if (isMacrosPayload) {
      try {
        await importMacrosPayload(f.name, parsed);
      } catch (e) {
        toast(f.name + ': ' + e.message, 'error');
        failed++;
      }
      continue;
    }
    const isOpsPayload = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && parsed.kind === 'ttrpg-logic-ops')
      || sniffKind(parsed) === 'logic-ops';
    if (isOpsPayload) {
      try {
        await importLogicOpsBundleFile(f);
      } catch (e) {
        toast(f.name + ': ' + e.message, 'error');
        failed++;
      }
      continue;
    }
    const kind = sniffKind(parsed);
    if (!kind) {
      toast(f.name + ': rejected — items need a "template" field (generators), a "formula" field (macros) or an "entries" array (tables).', 'error');
      failed++;
      continue;
    }
    const path = (kind === 'macros' ? 'dice-macros/' : 'tables/') + f.name;
    try {
      await state.storage.writeFile(path, text);
      setFile(path, text);
      if (kind === 'tables') await ensureContainerIds(path);
      ok++;
    } catch (e) {
      toast(f.name + ': ' + e.message, 'error');
      failed++;
    }
  }
  derive();
  renderAll();
  if (ok > 0) {
    const where = state.mode === 'server' ? 'the server' : state.mode === 'folder' ? 'the folder' : 'local storage';
    toast(ok + (ok === 1 ? ' file' : ' files') + ' imported into ' + where);
  } else if (failed > 0) {
    toast(failed + ' file' + (failed === 1 ? '' : 's') + ' rejected', 'error');
  }
}

'use strict';



function parseTemplate(template) {
  const text = typeof template === 'string' ? template : '';
  const segments = [];
  for (const seg of parseEmbeds(text)) {
    if (seg.type === 'text') {
      segments.push({ type: 'text', text: seg.text });
    } else if (seg.type === 'container') {
      segments.push({
        type: 'ref',
        token: seg.inner.trim(),
        start: seg.start,
        end: seg.start + seg.raw.length,
      });
    } else {
      segments.push({ type: seg.type, inner: seg.inner, raw: seg.raw, start: seg.start });
    }
  }
  return { segments };
}

const INLINE_RANGE_RE = /^([+-]?\d+)\s*-\s*([+-]?\d+)$/;
function classifyInline(inner) {
  const t = (typeof inner === 'string') ? inner.trim() : '';
  if (t === '') return '';
  if (t.indexOf('|') !== -1) return 'choice';
  const m = INLINE_RANGE_RE.exec(t);
  if (m && parseInt(m[1], 10) <= parseInt(m[2], 10)) return 'range';
  return 'text';
}


function templateOf(gen) {
  if (typeof gen === 'string') return gen;
  if (gen && typeof gen === 'object' && typeof gen.template === 'string') return gen.template;
  return '';
}

function matchContainers(token, containers) {
  const list = Array.isArray(containers) ? containers : [];
  if (typeof token !== 'string' || token === '') return [];
  const key = token.trim().toLowerCase();
  const matches = [];
  for (const c of list) {
    if (c && typeof c === 'object' && typeof c.name === 'string' &&
        c.name.trim().toLowerCase() === key) {
      matches.push(c);
    }
  }
  return matches;
}

function distinctTokens(template, kind) {
  const want = (kind === 'op') ? 'op' : 'ref';
  const segments = parseTemplate(template).segments;
  const tokens = [];
  const byToken = new Map();
  for (const seg of segments) {
    if (seg.type !== want) continue;
    const token = (want === 'op') ? String(seg.inner == null ? '' : seg.inner).trim() : seg.token;
    let rec = byToken.get(token);
    if (!rec) {
      rec = { token, occurrences: [] };
      byToken.set(token, rec);
      tokens.push(rec);
    }
    rec.occurrences.push({ index: rec.occurrences.length, position: seg.start });
  }
  return tokens;
}


function operationName(op) {
  return (op && typeof op === 'object' && typeof op.name === 'string') ? op.name.trim() : '';
}

function operationId(op) {
  return (op && typeof op === 'object' && typeof op.id === 'string') ? op.id : '';
}

function operationType(op) {
  return (op && typeof op === 'object' && typeof op.type === 'string')
    ? op.type.trim().toLowerCase()
    : '';
}

function isSupportedOperationType(type) {
  return type === 'script';
}

function isScriptOperation(op) {
  if (!op || typeof op !== 'object') return false;
  const type = operationType(op);
  if (type !== '') return type === 'script';
  return typeof op.script === 'string';
}

function isRunnableOperation(op) {
  return isSupportedOperationType(operationType(op)) || isScriptOperation(op);
}

function operationScript(op) {
  if (!op || typeof op !== 'object') return null;
  if (typeof op.script === 'string') return op.script;
  const config = (op.config && typeof op.config === 'object' && !Array.isArray(op.config))
    ? op.config
    : {};
  return (typeof config.script === 'string') ? config.script : null;
}

function matchOperations(token, operations) {
  const list = Array.isArray(operations) ? operations : [];
  const key = typeof token === 'string' ? token.trim().toLowerCase() : '';
  if (key === '') return [];
  const matches = [];
  for (const o of list) {
    if (operationName(o).toLowerCase() === key) matches.push(o);
  }
  return matches;
}

function findOperation(token, storedRefs, operations) {
  const key = typeof token === 'string' ? token.trim().toLowerCase() : '';
  if (key === '') return { ok: false, kind: 'missing' };
  const list = Array.isArray(operations) ? operations : [];
  const refs = Array.isArray(storedRefs) ? storedRefs : [];
  const stored = refs.find((r) =>
    r && typeof r === 'object' && typeof r.token === 'string' &&
    r.token.trim().toLowerCase() === key);
  if (stored && typeof stored.operationId === 'string' && stored.operationId !== '') {
    const byId = list.find((o) => operationId(o) === stored.operationId);
    if (byId) return { ok: true, operation: byId };
  }
  const matches = matchOperations(token, list);
  if (matches.length === 1) return { ok: true, operation: matches[0] };
  return { ok: false, kind: 'missing' };
}

function placeOperationError(e, seg, opName, path) {
  const chain = Array.isArray(path) ? path : [];
  const err = {
    kind: e.kind,
    token: (typeof e.token === 'string' && e.token !== '') ? e.token : seg.raw,
    position: seg.start,
    operationName: opName,
  };
  if (typeof e.macroName === 'string') err.macroName = e.macroName;
  if (typeof e.containerName === 'string') err.containerName = e.containerName;
  if (typeof e.message === 'string' && e.message !== '') err.message = e.message;
  if (typeof e.line === 'number') err.line = e.line;
  if (typeof e.varName === 'string' && e.varName !== '') err.varName = e.varName;
  if (typeof e.origin === 'string' && e.origin !== '') err.origin = e.origin;
  if (isContainerErrorKind(e.kind) || chain.length > 0) {
    err.chain = chain.map((p) => String(p.name));
  }
  if (e.kind === 'op-cycle' && Array.isArray(e.chain)) err.chain = e.chain;
  return err;
}


function validateGenerator(gen, containers, operations, tableFile) {
  const template = templateOf(gen);
  const refs = [];
  const errors = [];
  for (const rec of distinctTokens(template)) {
    const ref = {
      token: rec.token,
      containerId: null,
      containerName: null,
      occurrences: rec.occurrences,
    };
    refs.push(ref);
    if (rec.token === '') {
      errors.push({ kind: 'malformed', token: rec.token, occurrences: rec.occurrences });
      continue;
    }
    const matches = matchContainers(rec.token, containers);
    if (matches.length === 0) {
      errors.push({ kind: 'missing', token: rec.token, occurrences: rec.occurrences });
    } else if (matches.length > 1) {
      errors.push({ kind: 'ambiguous', token: rec.token, occurrences: rec.occurrences });
    } else {
      const c = matches[0];
      ref.containerId = (typeof c.id === 'string' && c.id !== '') ? c.id : null;
      ref.containerName = (typeof c.name === 'string') ? c.name : null;
      if (!Array.isArray(c.entries) || c.entries.length === 0) {
        errors.push({ kind: 'empty', token: rec.token, occurrences: rec.occurrences });
      }
    }
  }
  if (Array.isArray(operations)) {
    for (const rec of distinctTokens(template, 'op')) {
      if (rec.token === '') {
        errors.push({ kind: 'malformed', token: rec.token, occurrences: rec.occurrences });
        continue;
      }
      const found = findOperation(rec.token, gen && gen.operations, operations);
      if (!found.ok) {
        errors.push({ kind: 'missing-operation', token: rec.token, occurrences: rec.occurrences });
      } else if (!isRunnableOperation(found.operation)) {
        errors.push({ kind: 'unsupported-operation', token: rec.token, occurrences: rec.occurrences });
      } else {
        const script = operationScript(found.operation);
        if (script == null || script === '') {
          const nonString = found.operation.script !== undefined
            && typeof found.operation.script !== 'string';
          errors.push({
            kind: 'unsupported-operation',
            token: rec.token,
            occurrences: rec.occurrences,
            message: 'operations[' + operations.indexOf(found.operation) + ']: '
              + (nonString ? 'code must be a string.' : 'code is required.'),
          });
        } else {
          const uniques = validateScriptUniques(script, containers, rec, tableFile);
          for (const u of uniques) errors.push(u);
        }
      }
    }
  }
  errors.sort((a, b) => {
    const pa = (a.occurrences && a.occurrences[0]) ? a.occurrences[0].position : 0;
    const pb = (b.occurrences && b.occurrences[0]) ? b.occurrences[0].position : 0;
    return pa - pb;
  });
  return { ok: errors.length === 0, errors, refs };
}

function uniqueErrorOf(node, n, containers, rec, tableFile) {
  const refName = String(node.ref == null ? '' : node.ref).trim();
  const found = findContainer(refName, containers, tableFile);
  const container = (found && found.ok === true) ? found.container : null;
  const name = (container && typeof container.name === 'string' && container.name !== '')
    ? container.name
    : refName;
  const entries = (container && Array.isArray(container.entries)) ? container.entries : [];
  let drawable = 0;
  for (const e of entries) {
    const w = Number(e && e.weight);
    if (isFinite(w) && w > 0) drawable += 1;
  }
  if (drawable >= n) return null;
  return {
    kind: 'bad-unique',
    token: rec.token,
    occurrences: rec.occurrences,
    line: (typeof node.line === 'number') ? node.line : 0,
    message: 'UNIQUE group needs ' + n + ' rows, "' + name + '" has ' + drawable + ' drawable',
  };
}

function validateScriptUniques(script, containers, rec, tableFile) {
  const out = [];
  const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null;
  const ll = (g && g.LogicLanguage && typeof g.LogicLanguage.parseScript === 'function')
    ? g.LogicLanguage : null;
  if (!ll) return out;
  let parsed = null;
  try { parsed = ll.parseScript(script); } catch (e) { parsed = null; }
  if (!parsed || parsed.ok !== true || !Array.isArray(parsed.statements)) return out;
  const visit = (stmts) => {
    for (const st of stmts) {
      if (!st || typeof st !== 'object') continue;
      if (st.type === 'set' && st.value && st.value.type === 'unique') {
        const u = uniqueErrorOf(st.value, 1, containers, rec, tableFile);
        if (u) out.push(u);
      } else if (st.type === 'multi-set') {
        const vals = Array.isArray(st.values) ? st.values : [];
        for (const v of vals) {
          if (v && v.type === 'unique') {
            const n = Array.isArray(st.names) ? st.names.length : 1;
            const u = uniqueErrorOf(v, n, containers, rec, tableFile);
            if (u) out.push(u);
          }
        }
      } else if (st.type === 'if') {
        if (Array.isArray(st.thenBody)) visit(st.thenBody);
        const eifs = Array.isArray(st.elseIfs) ? st.elseIfs : [];
        for (const eif of eifs) if (Array.isArray(eif.body)) visit(eif.body);
        if (Array.isArray(st.elseBody)) visit(st.elseBody);
      } else if (st.type === 'switch') {
        const cases = Array.isArray(st.cases) ? st.cases : [];
        for (const c of cases) if (Array.isArray(c.body)) visit(c.body);
      }
    }
  };
  visit(parsed.statements);
  return out;
}


function resolveReferences(template, containers, existingRefs) {
  const text = typeof template === 'string' ? template : '';
  const list = Array.isArray(containers) ? containers : [];
  const existing = Array.isArray(existingRefs) ? existingRefs : [];
  const tokens = distinctTokens(text);

  const byId = new Map();
  for (const c of list) {
    if (c && typeof c === 'object' && typeof c.id === 'string' && c.id !== '') byId.set(c.id, c);
  }

  const out = [];
  for (const rec of tokens) {
    const token = rec.token;
    let resolved = null;
    if (token !== '') {
      const key = token.toLowerCase();
      const stored = existing.find((r) =>
        r && typeof r === 'object' && typeof r.token === 'string' &&
        r.token.trim().toLowerCase() === key);
      if (stored) {
        const c = byId.get(stored.containerId);
        if (c && typeof c.name === 'string' && c.name.trim().toLowerCase() === key) resolved = c;
      }
      if (!resolved) {
        const matches = matchContainers(token, list);
        if (matches.length === 1) resolved = matches[0];
      }
    }
    out.push(resolved
      ? { token, containerId: resolved.id, containerName: resolved.name }
      : { token, containerId: null, containerName: null });
  }
  return out;
}


function resolveOperationRefs(template, operations, existingRefs) {
  const text = typeof template === 'string' ? template : '';
  const list = Array.isArray(operations) ? operations : [];
  const existing = Array.isArray(existingRefs) ? existingRefs : [];

  const byId = new Map();
  for (const o of list) {
    const id = operationId(o);
    if (id !== '') byId.set(id, o);
  }

  const out = [];
  for (const rec of distinctTokens(text, 'op')) {
    const token = rec.token;
    let resolved = null;
    if (token !== '') {
      const key = token.toLowerCase();
      const stored = existing.find((r) =>
        r && typeof r === 'object' && typeof r.token === 'string' &&
        r.token.trim().toLowerCase() === key);
      if (stored && typeof stored.operationId === 'string') {
        const o = byId.get(stored.operationId);
        if (o) resolved = o;
      }
      if (!resolved) {
        const matches = matchOperations(token, list);
        if (matches.length === 1) resolved = matches[0];
      }
    }
    out.push(resolved
      ? { token, operationId: operationId(resolved) || null, operationName: operationName(resolved) }
      : { token, operationId: null, operationName: null });
  }
  return out;
}


function runGenerator(gen, containers, rollEntry, ctx) {
  const template = templateOf(gen);
  const withEmbeds = !!ctx && typeof ctx === 'object' && !Array.isArray(ctx);
  const operations = (withEmbeds && Array.isArray(ctx.operations)) ? ctx.operations : [];
  const validation = validateGenerator(gen, containers, operations,
    withEmbeds ? ctx.tableFile : '');
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const segments = parseTemplate(template).segments;

  const occRows = (gen && Array.isArray(gen.occurrences)) ? gen.occurrences : [];
  const occBindings = (gen && gen.bindings && typeof gen.bindings === 'object' && !Array.isArray(gen.bindings))
    ? gen.bindings : {};
  const isConsuming = (seg) =>
    seg.type === 'ref' || seg.type === 'op' || seg.type === 'embed'
    || (seg.type === 'inline'
        && (classifyInline(seg.inner) === 'choice' || classifyInline(seg.inner) === 'range'));
  const consuming = segments.filter(isConsuming);
  let rowsTrusted = occRows.length === consuming.length;
  if (rowsTrusted) {
    for (let i = 0; i < consuming.length; i += 1) {
      const row = occRows[i];
      if (!row || typeof row !== 'object' || row.kind !== consuming[i].type) {
        rowsTrusted = false;
        break;
      }
    }
  }
  const occurrenceResults = {};
  let occIndex = 0;
  const runVariables = Object.create(null);
  const opExposedByOcc = {};
  const exposeRunVariable = (name, value, type) => {
    if (!rowsTrusted) return;
    if (typeof name !== 'string' || name === '') return;
    let t, v;
    if (type === 'boolean' && typeof value === 'boolean') { t = 'boolean'; v = value; }
    else if (type === 'number' && typeof value === 'number' && isFinite(value)) { t = 'number'; v = value; }
    else if (type === 'string' && typeof value === 'string') { t = 'string'; v = value; }
    else {
      const numeric = (typeof value === 'number' && isFinite(value));
      t = numeric ? 'number' : 'string';
      v = numeric ? value : String(value);
    }
    runVariables[name] = {
      type: t,
      value: v,
      source: 'generator',
    };
  };
  const recordOccurrence = (row, value, exposedVars) => {
    if (!rowsTrusted || !row || typeof row.instanceId !== 'string' || row.instanceId === '') return;
    occurrenceResults[row.instanceId] = {
      kind: (typeof row.kind === 'string') ? row.kind : '',
      token: (typeof row.token === 'string') ? row.token : '',
      refId: (row.refId == null) ? null : row.refId,
      value,
    };
    const varName = occBindings[row.instanceId];
    if (typeof varName === 'string' && varName !== '') exposeRunVariable(varName, value);
    if (exposedVars) opExposedByOcc[row.instanceId] = exposedVars;
  };

  const containerByToken = new Map();
  for (const seg of segments) {
    if (seg.type !== 'ref' || containerByToken.has(seg.token)) continue;
    const matches = matchContainers(seg.token, containers);
    containerByToken.set(seg.token, (matches.length === 1) ? matches[0] : null);
  }

  const occurrenceCount = new Map();
  const errors = [];
  const trace = [];
  const rolls = [];
  const labelBudget = { resolutions: 0, chars: 0 };
  const parts = [];
  const uniquePool = Object.create(null);

  const unresolvedSpans = (text, offset) => {
    let found = 0;
    for (const span of parseEmbeds(text)) {
      if (span.type === 'op') {
        found += 1;
        errors.push({ kind: 'missing-operation', token: span.raw, position: offset + span.start });
        continue;
      }
      if (span.type !== 'embed' && span.type !== 'inline') continue;
      found += 1;
      errors.push({ kind: 'unresolved', token: span.raw, position: offset + span.start });
    }
    return found > 0;
  };
  const pushDiagnostic = (raw) => {
    parts.push({ segs: [{ type: 'error', text: raw }], text: raw });
  };

  for (const seg of segments) {
    const occRow = (rowsTrusted && isConsuming(seg))
      ? occRows[occIndex++] : null;
    if (seg.type === 'text') {
      parts.push({ segs: [{ type: 'text', text: seg.text }], text: seg.text });
      continue;
    }
    if (seg.type === 'embed' || seg.type === 'inline') {
      if (!withEmbeds) {
        errors.push({ kind: 'unresolved', token: seg.raw, position: seg.start });
        pushDiagnostic(seg.raw);
        continue;
      }
      const res = resolveEmbed(seg.raw, ctx);
      if (!res.ok) {
        for (const e of res.errors) {
          const err = Object.assign({}, e);
          err.position = seg.start + (typeof e.position === 'number' ? e.position : 0);
          errors.push(err);
        }
        pushDiagnostic(seg.raw);
        continue;
      }
      parts.push({ segs: res.segments, text: res.output });
      recordOccurrence(occRow, (seg.type === 'inline' && classifyInline(seg.inner) === 'range')
        ? Number(res.output)
        : res.output);
      continue;
    }
    if (seg.type === 'op') {
      const found = findOperation(seg.inner.trim(), gen && gen.operations, operations);
      if (!found.ok) {
        errors.push({ kind: 'missing-operation', token: seg.raw, position: seg.start });
        pushDiagnostic(seg.raw);
        continue;
      }
      const op = found.operation;
      labelBudget.resolutions += 1;
      if (labelBudget.resolutions > MAX_RESOLUTIONS) {
        errors.push({ kind: 'nesting-limit', token: seg.raw, position: seg.start,
          message: 'execution exceeded ' + LIMITS.MAX_RESOLUTIONS + ' resolutions' });
        pushDiagnostic(seg.raw);
        continue;
      }
      if (labelBudget.chars > MAX_OUTPUT_CHARS) {
        errors.push({ kind: 'nesting-limit', token: seg.raw, position: seg.start,
          message: 'execution exceeded ' + LIMITS.MAX_OUTPUT_CHARS + ' generated characters' });
        pushDiagnostic(seg.raw);
        continue;
      }
      const res = executeOperation(op, Object.assign({}, ctx, {
        operations,
        values: runVariables,
        importSource: 'generator',
        raw: seg.raw,
        budget: labelBudget,
        uniquePool: uniquePool,
      }));
      if (!res.ok) {
        for (const e of res.errors) {
          errors.push(placeOperationError(e, seg, operationName(op), []));
        }
        pushDiagnostic(seg.raw);
        continue;
      }
      trace.push({
        token: seg.raw,
        operationId: operationId(op) || null,
        operationName: operationName(op),
        type: operationType(op),
        output: res.output,
        segments: res.segments,
        children: res.trace,
        depth: 0,
      });
      parts.push({
        segs: [{
          type: 'op',
          text: res.output,
          operationId: operationId(op) || null,
          operationName: operationName(op),
          token: seg.raw,
        }],
        text: res.output,
      });
      recordOccurrence(occRow, res.output, res.exposed);
      if (res.exposed) {
        const opBind = (rowsTrusted && occRow && typeof occRow.instanceId === 'string'
          && occRow.instanceId !== '')
          ? occBindings[occRow.instanceId] : undefined;
        const objBind = (opBind && typeof opBind === 'object' && !Array.isArray(opBind))
          ? opBind : null;
        for (const v of res.exposed) {
          const name = (v && typeof v.name === 'string') ? v.name : '';
          const hasKey = (objBind && name !== '')
            && Object.prototype.hasOwnProperty.call(objBind, name);
          const bound = hasKey ? objBind[name] : null;
          if (hasKey && typeof bound === 'string' && bound !== '') {
            exposeRunVariable(bound, v.value, v.type);
          } else if (!hasKey || typeof bound !== 'string') {
            exposeRunVariable(name, v.value, v.type);
          }
        }
      }
      continue;
    }
    const container = containerByToken.get(seg.token);
    const entry = (container && typeof rollEntry === 'function') ? rollEntry(container) : null;
    if (entry == null) {
      const ref = validation.refs.find((r) => r.token === seg.token);
      errors.push({ kind: 'empty', token: seg.token, occurrences: ref ? ref.occurrences : [] });
      return {
        ok: false,
        errors,
      };
    }
    const raw = template.slice(seg.start, seg.end);
    const n = (occurrenceCount.get(seg.token) || 0) + 1;
    occurrenceCount.set(seg.token, n);
    const containerId = (container && typeof container.id === 'string') ? container.id : null;
    const containerName = (container && typeof container.name === 'string') ? container.name : null;
    const weight = (entry && entry.weight != null) ? entry.weight : null;
    rolls.push({
      token: seg.token,
      containerId,
      containerName,
      entry,
      weight,
      occurrence: n,
      position: seg.start,
    });
    const label = String(entry.label != null ? entry.label : '');
    if (!withEmbeds) {
      if (unresolvedSpans(label, 0)) {
        pushDiagnostic(raw);
        continue;
      }
      parts.push({ segs: [{ type: 'ref', text: label, containerId, containerName, token: raw }], text: label });
      recordOccurrence(occRow, label);
      continue;
    }
    const labelFile = (container && typeof container.file === 'string' && container.file !== '')
      ? container.file
      : (typeof ctx.tableFile === 'string' ? ctx.tableFile : '');
    const res = resolveEmbed(label, Object.assign({}, ctx, {
      tableFile: labelFile,
      entryOperations: Array.isArray(entry.operations) ? entry.operations : [],
      values: runVariables,
      importSource: 'generator',
      depth: 1,
      path: [{ id: containerId || '', name: containerName || '' }],
      budget: labelBudget,
    }));
    if (!res.ok) {
      for (const e of res.errors) errors.push(e);
      pushDiagnostic(raw);
      continue;
    }
    trace.push({
      token: raw,
      containerId,
      containerName,
      entryLabel: label,
      weight: isFinite(Number(entry.weight)) ? Number(entry.weight) : 0,
      depth: 0,
      segments: res.segments,
      children: res.trace,
    });
    parts.push({ segs: [{ type: 'ref', text: res.output, containerId, containerName, token: raw }], text: res.output });
    recordOccurrence(occRow, res.output);
  }
  const out = [];
  let output = '';
  for (const part of parts) {
    for (const s of part.segs) out.push(s);
    output += part.text;
  }
  const exposed = {};
  if (errors.length === 0) {
    for (const row of occRows) {
      if (!row || typeof row.instanceId !== 'string' || row.instanceId === '') continue;
      const b = occBindings[row.instanceId];
      if (typeof b === 'string') {
        if (b === '') continue;
        const r = occurrenceResults[row.instanceId];
        if (r) exposed[b] = r.value;
        continue;
      }
      if (row.kind !== 'op' || !b || typeof b !== 'object' || Array.isArray(b)) continue;
      const vars = opExposedByOcc[row.instanceId];
      if (!Array.isArray(vars)) continue;
      for (const v of vars) {
        const name = (v && typeof v.name === 'string') ? v.name : '';
        if (name === '' || !Object.prototype.hasOwnProperty.call(b, name)) continue;
        const bound = b[name];
        if (typeof bound === 'string' && bound !== '') exposed[bound] = v.value;
      }
    }
  }
  return {
    ok: errors.length === 0,
    output,
    segments: out,
    trace,
    rolls,
    errors,
    occurrenceResults,
    exposed,
  };
}


function parseEmbeds(text) {
  const str = typeof text === 'string' ? text : '';
  const segments = [];
  let textStart = 0;
  let i = 0;
  const flushText = (end) => {
    if (end > textStart) segments.push({ type: 'text', text: str.slice(textStart, end), start: textStart });
    textStart = end;
  };
  while (i < str.length) {
    const pipe = str.indexOf('|', i);
    const paren = str.indexOf('((', i);
    const bracket = str.indexOf('[', i);
    const brace = str.indexOf('{', i);
    let open = -1;
    let kind = '';
    if (pipe !== -1) { open = pipe; kind = 'pipe'; }
    if (paren !== -1 && (open === -1 || paren < open)) { open = paren; kind = 'paren'; }
    if (bracket !== -1 && (open === -1 || bracket < open)) { open = bracket; kind = 'bracket'; }
    if (brace !== -1 && (open === -1 || brace < open)) { open = brace; kind = 'brace'; }
    if (open === -1) break;
    if (kind === 'paren') {
      const close = str.indexOf('))', open + 2);
      if (close === -1) {
        i = open + 1;
      } else {
        flushText(open);
        segments.push({
          type: 'inline',
          inner: str.slice(open + 2, close),
          raw: str.slice(open, close + 2),
          start: open,
        });
        i = close + 2;
        textStart = i;
      }
    } else if (kind === 'bracket') {
      const close = str.indexOf(']', open + 1);
      if (close === -1) {
        i = open + 1;
      } else {
        flushText(open);
        segments.push({
          type: 'container',
          inner: str.slice(open + 1, close),
          raw: str.slice(open, close + 1),
          start: open,
        });
        i = close + 1;
        textStart = i;
      }
    } else if (kind === 'brace') {
      const close = str.indexOf('}', open + 1);
      if (close === -1) {
        i = open + 1;
      } else {
        flushText(open);
        segments.push({
          type: 'op',
          inner: str.slice(open + 1, close),
          raw: str.slice(open, close + 1),
          start: open,
        });
        i = close + 1;
        textStart = i;
      }
    } else {
      const close = str.indexOf('|', open + 1);
      if (close === -1) {
        i = open + 1;
      } else {
        flushText(open);
        segments.push({
          type: 'embed',
          inner: str.slice(open + 1, close),
          raw: str.slice(open, close + 1),
          start: open,
        });
        i = close + 1;
        textStart = i;
      }
    }
  }
  flushText(str.length);
  if (segments.length === 0) segments.push({ type: 'text', text: '', start: 0 });
  return segments;
}


const LIMITS = Object.freeze({
  MAX_DEPTH: 8,
  MAX_RESOLUTIONS: 1000,
  MAX_OUTPUT_CHARS: 100000,
  MAX_NESTED_OPERATION_DEPTH: 4,
});

const MAX_DEPTH = LIMITS.MAX_DEPTH;
const MAX_RESOLUTIONS = LIMITS.MAX_RESOLUTIONS;
const MAX_OUTPUT_CHARS = LIMITS.MAX_OUTPUT_CHARS;

const CONTAINER_ERROR_KINDS = {
  'missing-container': true,
  'ambiguous-container': true,
  'empty-container': true,
  cycle: true,
  'nesting-limit': true,
};

function isContainerErrorKind(kind) {
  return CONTAINER_ERROR_KINDS[kind] === true;
}

function findContainer(token, containers, tableFile) {
  const list = Array.isArray(containers) ? containers : [];
  const want = String(token == null ? '' : token).trim().toLowerCase();
  const file = typeof tableFile === 'string' ? tableFile : '';
  if (want === '') return { ok: false, kind: 'missing' };
  const inFile = [];
  const anywhere = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.name == null ? '' : c.name).trim();
    if (name === '' || name.toLowerCase() !== want) continue;
    anywhere.push(c);
    if (file !== '' && c.file === file) inFile.push(c);
  }
  const scope = inFile.length > 0 ? inFile : anywhere;
  if (scope.length === 0) return { ok: false, kind: 'missing' };
  if (scope.length > 1) return { ok: false, kind: 'ambiguous' };
  return { ok: true, container: scope[0] };
}

function sameContainer(a, b) {
  const ai = (a && typeof a.id === 'string') ? a.id : '';
  const bi = (b && typeof b.id === 'string') ? b.id : '';
  if (ai !== '' && bi !== '') return ai === bi;
  const an = String(a && a.name != null ? a.name : '').trim().toLowerCase();
  const bn = String(b && b.name != null ? b.name : '').trim().toLowerCase();
  return an !== '' && an === bn;
}

function pickWeightedEntry(entries, rng) {
  const list = Array.isArray(entries) ? entries : [];
  let total = 0;
  for (const e of list) {
    const w = Number(e && e.weight);
    if (isFinite(w) && w > 0) total += w;
  }
  if (total <= 0) return null;
  let r = rng() * total;
  for (const e of list) {
    const w = Number(e && e.weight);
    if (!isFinite(w) || w <= 0) continue;
    r -= w;
    if (r < 0) return e;
  }
  return list[list.length - 1];
}


function executeOperation(op, ctx) {
  const o = (op && typeof op === 'object' && !Array.isArray(op)) ? op : null;
  const c = (ctx && typeof ctx === 'object') ? ctx : {};
  const name = operationName(o);
  const raw = (typeof c.raw === 'string' && c.raw !== '') ? c.raw : ('{' + name + '}');
  const rng = (typeof c.rng === 'function') ? c.rng : Math.random;
  const evalExpr = (typeof c.evalExpr === 'function') ? c.evalExpr : null;
  const errors = [];
  const trace = [];
  const finish = (output, segments) => ({ ok: errors.length === 0, output, segments, errors, trace });
  const failOp = (kind) => {
    errors.push({ kind, token: raw, position: 0, operationName: name });
    return finish(raw, [{ type: 'error', text: raw }]);
  };

  if (!o) return failOp('unsupported-operation');

  if (isScriptOperation(o)) {
    let inFlight = (Array.isArray(c.inFlightOps)) ? c.inFlightOps : null;
    if (inFlight === null) {
      inFlight = [];
      c.inFlightOps = inFlight;
    }
    const opKey = (operationId(o) !== '') ? operationId(o) : ('#' + name);
    const cycleAt = inFlight.findIndex((k) => k && k.key === opKey);
    if (cycleAt !== -1) {
      const cycle = inFlight.slice(cycleAt).concat([{ key: opKey, name: name }])
        .map((k) => k.name);
      errors.push({
        kind: 'op-cycle', token: raw, position: 0, operationName: name, chain: cycle,
        message: 'circular operation reference '
          + cycle.map((n) => '"' + n + '"').join(' -> ')
          + ' - remove one call to break the loop',
      });
      return finish(raw, [{ type: 'error', text: raw }]);
    }
    inFlight.push({ key: opKey, name: name });
    try {
      return executeScriptOperation(o, c, raw, name, rng, evalExpr);
    } finally {
      inFlight.pop();
    }
  }

  return failOp('unsupported-operation');
}

function flattenEvaluatorVariables(vars) {
  const out = {};
  if (vars && typeof vars === 'object' && !Array.isArray(vars)) {
    for (const k of Object.keys(vars)) {
      const rec = vars[k];
      out[k] = (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec.value : rec;
    }
  }
  return out;
}

function executeScriptOperation(o, c, raw, name, rng, evalExpr) {
  const config = (o.config && typeof o.config === 'object' && !Array.isArray(o.config))
    ? o.config
    : {};
  const script = (typeof o.script === 'string') ? o.script
    : ((typeof config.script === 'string') ? config.script : null);
  const g = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null;
  const evaluator = (g && g.LogicEvaluator && typeof g.LogicEvaluator.evaluate === 'function')
    ? g.LogicEvaluator
    : null;
  const errors = [];
  const failOp = (kind, message) => {
    const err = { kind, token: raw, position: 0, operationName: name };
    if (typeof message === 'string' && message !== '') err.message = message;
    errors.push(err);
    return { ok: false, output: raw, segments: [{ type: 'error', text: raw }], errors, trace: [] };
  };
  if (script === null) return failOp('unsupported-operation');
  if (!evaluator) return failOp('unsupported-operation');

  const opDepth = (typeof c.operationDepth === 'number' && c.operationDepth >= 0)
    ? c.operationDepth
    : 0;
  if (opDepth >= LIMITS.MAX_NESTED_OPERATION_DEPTH) {
    return failOp('nesting-limit',
      'nested operation depth exceeded ' + LIMITS.MAX_NESTED_OPERATION_DEPTH + ' levels');
  }

  const res = evaluator.evaluate(script, {
    values: (c.values && typeof c.values === 'object' && !Array.isArray(c.values)) ? c.values : {},
    importSource: c.importSource,
    rng: rng,
    evalExpr: evalExpr,
    macros: c.macros,
    containers: c.containers,
    operations: c.operations,
    tableFile: c.tableFile,
    depth: c.depth,
    path: c.path,
    budget: c.budget,
    operationDepth: opDepth + 1,
    inFlightOps: (Array.isArray(c.inFlightOps)) ? c.inFlightOps : [],
    uniquePool: (c.uniquePool && typeof c.uniquePool === 'object'
      && !Array.isArray(c.uniquePool))
      ? c.uniquePool : null,
  });
  const trace = Array.isArray(res && res.trace) ? res.trace : [];
  if (!res || res.ok !== true) {
    const list = (res && Array.isArray(res.errors)) ? res.errors : [];
    for (const e of list) {
      const err = {
        kind: (e && typeof e.kind === 'string') ? e.kind : 'evaluation-failed',
        token: raw,
        position: 0,
        operationName: name,
        line: (e && typeof e.line === 'number') ? e.line : 0,
        message: (e && typeof e.message === 'string') ? e.message : '',
        varName: (e && typeof e.varName === 'string') ? e.varName : '',
        origin: (e && typeof e.origin === 'string') ? e.origin : '',
      };
      if (err.kind === 'op-cycle' && Array.isArray(e.chain)) err.chain = e.chain;
      errors.push(err);
    }
    if (errors.length === 0) errors.push({ kind: 'evaluation-failed', token: raw, position: 0, operationName: name });
    return { ok: false, output: raw, segments: [{ type: 'error', text: raw }], errors, trace };
  }
  const out = { ok: true, output: '', segments: [], errors, trace };
  Object.defineProperty(out, 'variables', {
    value: (res && res.variables) ? res.variables : {}, enumerable: false, writable: true, configurable: true,
  });
  Object.defineProperty(out, 'exposed', {
    value: (res && Array.isArray(res.exposed)) ? res.exposed : [], enumerable: false, writable: true, configurable: true,
  });

  const template = (typeof o.outputTemplate === 'string') ? o.outputTemplate
    : ((typeof config.outputTemplate === 'string') ? config.outputTemplate : '');
  if (template !== '') {
    const sub = (g && typeof g.substituteOutputTemplate === 'function')
      ? g.substituteOutputTemplate(template, flattenEvaluatorVariables(res.variables))
      : null;
    if (sub === null) {
      return failOp('unsupported-operation');
    }
    if (sub.ok !== true) {
      for (const e of sub.errors) {
        const vn = (e && typeof e.varName === 'string') ? e.varName : '';
        errors.push({
          kind: 'missing-variable',
          token: raw,
          position: 0,
          operationName: name,
          line: 0,
          varName: vn,
          origin: 'output-template',
          message: 'template variable not set: %' + vn + '%',
        });
      }
      return { ok: false, output: raw, segments: [{ type: 'error', text: raw }], errors, trace };
    }
    const budget = (c.budget && typeof c.budget === 'object') ? c.budget : null;
    if (budget) {
      const before = (typeof budget.chars === 'number') ? budget.chars : 0;
      budget.chars = before + sub.text.length;
      if (budget.chars > MAX_OUTPUT_CHARS) {
        return failOp('nesting-limit',
          'operation output exceeded ' + LIMITS.MAX_OUTPUT_CHARS + ' characters');
      }
    }
    out.output = sub.text;
    out.segments = [{ type: 'text', text: sub.text }];
  }
  return out;
}

function resolveEmbed(text, ctx) {
  const c = (ctx && typeof ctx === 'object') ? ctx : {};
  const run = {
    macros: Array.isArray(c.macros) ? c.macros : [],
    evalExpr: typeof c.evalExpr === 'function' ? c.evalExpr : null,
    rng: typeof c.rng === 'function' ? c.rng : Math.random,
    containers: Array.isArray(c.containers) ? c.containers : [],
    operations: Array.isArray(c.operations) ? c.operations : [],
    entryOperations: Array.isArray(c.entryOperations) ? c.entryOperations : [],
    tableFile: typeof c.tableFile === 'string' ? c.tableFile : '',
    depth: (typeof c.depth === 'number' && c.depth >= 0) ? c.depth : 0,
    operationDepth: (typeof c.operationDepth === 'number' && c.operationDepth >= 0) ? c.operationDepth : 0,
    inFlightOps: Array.isArray(c.inFlightOps) ? c.inFlightOps : null,
    path: Array.isArray(c.path) ? c.path : [],
    budget: (c.budget && typeof c.budget === 'object') ? c.budget : { resolutions: 0, chars: 0 },
    values: (c.values && typeof c.values === 'object' && !Array.isArray(c.values)) ? c.values : {},
    importSource: (typeof c.importSource === 'string' && c.importSource !== '') ? c.importSource : '',
    errors: [],
  };
  if (typeof run.budget.resolutions !== 'number') run.budget.resolutions = 0;
  if (typeof run.budget.chars !== 'number') run.budget.chars = 0;
  const res = resolveSpans(text, run);
  const result = { ok: res.ok, output: res.output, segments: res.segments, errors: run.errors };
  Object.defineProperty(result, 'trace', {
    value: res.trace, enumerable: false, writable: true, configurable: true,
  });
  return result;
}

function resolveSpans(text, run) {
  const macros = run.macros;
  const evalExpr = run.evalExpr;
  const rng = run.rng;
  const errStart = run.errors.length;
  const out = [];
  const trace = [];
  let lastCharged = null;
  let overBudget = false;
  const push = (s) => {
    out.push(s);
    if (s.type === 'ref' || s.type === 'op' || s.type === 'error') return;
    const t = String(s.text == null ? '' : s.text);
    run.budget.chars += t.length;
    if (run.budget.chars > MAX_OUTPUT_CHARS && !overBudget) {
      overBudget = true;
      fail('nesting-limit', { raw: t, start: lastCharged.start }, null);
    }
  };
  const fail = (kind, seg, extra) => {
    const err = { kind, token: seg.raw, position: seg.start };
    if (extra && typeof extra.containerName === 'string') err.containerName = extra.containerName;
    if (extra && typeof extra.macroName === 'string') err.macroName = extra.macroName;
    if (extra && typeof extra.operationName === 'string') err.operationName = extra.operationName;
    if (extra && typeof extra.message === 'string' && extra.message !== '') err.message = extra.message;
    if (isContainerErrorKind(kind) || run.path.length > 0) {
      err.chain = run.path.map((p) => String(p.name));
    }
    run.errors.push(err);
    push({ type: 'error', text: seg.raw });
  };
  const drawIndex = (count) => {
    let idx = Math.floor(rng() * count);
    if (!(idx >= 0)) idx = 0;
    if (idx >= count) idx = count - 1;
    return idx;
  };
  const noteRef = (seg, containerId, containerName, entryLabel, weight, segments, children) => {
    trace.push({
      token: seg.raw,
      containerId,
      containerName,
      entryLabel,
      weight,
      depth: run.depth,
      segments,
      children,
    });
  };
  const failRef = (kind, seg, containerName) => {
    fail(kind, seg, { containerName });
  };
  for (const seg of parseEmbeds(text)) {
    lastCharged = seg;
    if (seg.type === 'container') {
      const inner = seg.inner.trim();
      if (inner === '') {
        failRef('malformed', seg, '');
        continue;
      }
      const found = findContainer(inner, run.containers, run.tableFile);
      if (!found.ok) {
        failRef(found.kind === 'ambiguous' ? 'ambiguous-container' : 'missing-container', seg, inner);
        continue;
      }
      const container = found.container;
      const cname = String(container.name == null ? '' : container.name).trim();
      const cid = (typeof container.id === 'string') ? container.id : '';
      if (run.path.some((p) => sameContainer(p, container))) {
        failRef('cycle', seg, cname);
        continue;
      }
      if (run.depth >= MAX_DEPTH) {
        failRef('nesting-limit', seg, cname);
        continue;
      }
      const picked = pickWeightedEntry(container.entries, rng);
      if (!picked) {
        failRef('empty-container', seg, cname);
        continue;
      }
      run.budget.resolutions += 1;
      if (run.budget.resolutions > MAX_RESOLUTIONS || run.budget.chars > MAX_OUTPUT_CHARS) {
        failRef('nesting-limit', seg, cname);
        continue;
      }
      const entryLabel = typeof picked.label === 'string' ? picked.label : '';
      const childFile = (typeof container.file === 'string' && container.file !== '')
        ? container.file
        : run.tableFile;
      const child = resolveSpans(entryLabel, {
        macros,
        evalExpr,
        rng,
        containers: run.containers,
        operations: run.operations,
        values: run.values,
        importSource: run.importSource,
        entryOperations: Array.isArray(picked.operations) ? picked.operations : [],
        tableFile: childFile,
        depth: run.depth + 1,
        path: run.path.concat([{ id: cid, name: cname }]),
        budget: run.budget,
        inFlightOps: run.inFlightOps,
        operationDepth: (typeof run.operationDepth === 'number' && run.operationDepth >= 0)
          ? run.operationDepth
          : 0,
        errors: run.errors,
      });
      const weight = Number(picked.weight);
      noteRef(seg, cid, cname, entryLabel, isFinite(weight) ? weight : 0, child.segments, child.trace);
      if (child.ok && run.budget.chars <= MAX_OUTPUT_CHARS) {
        push({
          type: 'ref',
          text: child.output,
          containerId: cid,
          containerName: cname,
          token: seg.raw,
        });
      } else if (!child.ok) {
        push({ type: 'error', text: seg.raw });
      } else {
        fail('nesting-limit', seg, { containerName: cname });
      }
      continue;
    }
    if (seg.type === 'inline') {
      const inner = seg.inner.trim();
      if (inner === '') {
        fail('malformed', seg);
        continue;
      }
      if (inner.indexOf('|') !== -1) {
        const options = inner.split('|').map((o) => o.trim());
        if (options.some((o) => o === '')) {
          fail('malformed', seg);
          continue;
        }
        const choices = [];
        let badOption = false;
        for (const o of options) {
          const ci = o.indexOf(':');
          if (ci === -1) {
            choices.push({ label: o, weight: 1 });
          } else {
            const label = o.slice(0, ci).trim();
            const w = o.slice(ci + 1).trim();
            if (label === '' || !/^[0-9]+$/.test(w)) { badOption = true; break; }
            choices.push({ label, weight: parseInt(w, 10) });
          }
        }
        if (badOption) {
          fail('malformed', seg);
          continue;
        }
        const picked = pickWeightedEntry(choices, rng);
        if (!picked) {
          fail('malformed', seg);
          continue;
        }
        push({ type: 'pick', text: picked.label });
        continue;
      }
      if (/^[+-]?\d/.test(inner) && inner.indexOf('-') !== -1) {
        const match = INLINE_RANGE_RE.exec(inner);
        if (!match) {
          fail('invalid-range', seg);
          continue;
        }
        const min = parseInt(match[1], 10);
        const max = parseInt(match[2], 10);
        if (min > max) {
          fail('reversed-range', seg);
          continue;
        }
        push({ type: 'pick', text: String(min + drawIndex(max - min + 1)) });
        continue;
      }
      push({ type: 'pick', text: inner });
      continue;
    }
    if (seg.type === 'op') {
      const inner = seg.inner.trim();
      if (inner === '') {
        fail('malformed', seg);
        continue;
      }
      const found = findOperation(inner, run.entryOperations, run.operations);
      if (!found.ok) {
        fail('missing-operation', seg, { operationName: inner });
        continue;
      }
      const op = found.operation;
      const res = executeOperation(op, {
        macros,
        evalExpr,
        rng,
        containers: run.containers,
        operations: run.operations,
        values: run.values,
        importSource: run.importSource,
        tableFile: run.tableFile,
        depth: run.depth,
        path: run.path,
        budget: run.budget,
        operationDepth: run.operationDepth,
        inFlightOps: run.inFlightOps,
        raw: seg.raw,
      });
      if (!res.ok) {
        for (const e of res.errors) {
          run.errors.push(placeOperationError(e, seg,
            operationName(op) || inner, run.path));
        }
        push({ type: 'error', text: seg.raw });
        continue;
      }
      run.budget.resolutions += 1;
      if (run.budget.resolutions > MAX_RESOLUTIONS) {
        fail('nesting-limit', seg, {
          operationName: operationName(op),
          message: 'execution exceeded ' + LIMITS.MAX_RESOLUTIONS + ' resolutions',
        });
        continue;
      }
      trace.push({
        token: seg.raw,
        operationId: operationId(op) || null,
        operationName: operationName(op),
        type: operationType(op),
        output: res.output,
        segments: res.segments,
        children: res.trace,
        depth: run.depth,
      });
      push({
        type: 'op',
        text: res.output,
        operationId: operationId(op) || null,
        operationName: operationName(op),
        token: seg.raw,
      });
      continue;
    }
    if (seg.type !== 'embed') {
      push({ type: 'text', text: seg.text });
      continue;
    }
    const inner = seg.inner.trim();
    if (inner === '') {
      fail('malformed', seg);
      continue;
    }
    const macro = macros.find((m) =>
      m && typeof m === 'object' && typeof m.name === 'string' &&
      m.name.trim().toLowerCase() === inner.toLowerCase());
    let value;
    let failed = null;
    if (macro) {
      const expression = '(' + String(macro.formula == null ? '' : macro.formula).trim() + ')';
      if (!evalExpr) {
        failed = { kind: 'invalid-expression', macroName: macro.name };
      } else {
        try {
          value = evalExpr(expression);
        } catch (e) {
          failed = { kind: 'invalid-expression', macroName: macro.name };
        }
      }
    } else if (!evalExpr) {
      failed = { kind: 'unresolved' };
    } else {
      try {
        value = evalExpr(inner);
      } catch (e) {
        failed = { kind: 'unresolved' };
      }
    }
    if (failed) {
      fail(failed.kind, seg, failed.macroName === undefined ? null : { macroName: failed.macroName });
      continue;
    }
    push({ type: 'value', text: String(value) });
  }
  let output = '';
  for (const s of out) output += s.text;
  return { ok: run.errors.length === errStart, output, segments: out, trace };
}


const GeneratorEngine = {
  parseTemplate,
  classifyInline,
  validateGenerator,
  resolveReferences,
  resolveOperationRefs,
  runGenerator,
  parseEmbeds,
  resolveEmbed,
  executeOperation,
  findContainer,
  LIMITS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = GeneratorEngine;
if (typeof window !== 'undefined') window.GeneratorEngine = GeneratorEngine;


(function () {
  'use strict';

  const EVAL_ERR = Object.freeze({
    MISSING_LANGUAGE: 'missing-language',
    MISSING_ENGINE: 'missing-engine',
    MISSING_VARIABLE: 'missing-variable',
    MISSING_IMPORT: 'missing-import',
    INVALID_IMPORT: 'invalid-import',
    TYPE_MISMATCH: 'type-mismatch',
    INVALID_CASE: 'invalid-case',
    EMPTY_CHOICE: 'empty-choice',
    UNSUPPORTED_VALUE: 'unsupported-value',
    UNSUPPORTED_CONDITION: 'unsupported-condition',
    NESTING_LIMIT: 'nesting-limit',
    BAD_SCRIPT: 'bad-script',
    EVALUATION_FAILED: 'evaluation-failed',
  });

  function globalOf() {
    if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
    if (typeof window !== 'undefined' && window) return window;
    return null;
  }

  function languageOf() {
    const g = globalOf();
    const ll = g ? g.LogicLanguage : null;
    return (ll && typeof ll.parseScript === 'function' &&
      typeof ll.validateProgram === 'function' &&
      typeof ll.isNumericText === 'function') ? ll : null;
  }

  function engineOf() {
    const g = globalOf();
    const e = g ? g.GeneratorEngine : null;
    return (e && typeof e.resolveEmbed === 'function' &&
      e.LIMITS && typeof e.LIMITS === 'object') ? e : null;
  }


  function mkNumber(n) {
    return { type: 'number', value: Number(n) };
  }

  function mkString(s) {
    return { type: 'string', value: String(s) };
  }

  function mkBoolean(b) {
    return { type: 'boolean', value: b === true };
  }

  function isTypedValue(v) {
    if (!v || typeof v !== 'object') return false;
    if (v.type === 'number') return typeof v.value === 'number' && isFinite(v.value);
    if (v.type === 'string') return typeof v.value === 'string';
    if (v.type === 'boolean') return typeof v.value === 'boolean';
    return false;
  }

  function renderTyped(v) {
    if (!v) return 'nothing';
    if (v.type === 'string') return '"' + v.value + '"';
    return String(v.value);
  }

  function describeTyped(v) {
    if (!v) return 'nothing';
    return 'the ' + v.type + ' ' + renderTyped(v);
  }

  function asTyped(raw) {
    if (isTypedValue(raw)) {
      return { type: raw.type, value: raw.value };
    }
    if (typeof raw === 'number' && isFinite(raw)) return mkNumber(raw);
    if (typeof raw === 'string') return mkString(raw);
    if (typeof raw === 'boolean') return mkBoolean(raw);
    return null;
  }

  function fail(kind, line, message, extra) {
    const err = { kind, line: line, message: message };
    if (extra && typeof extra === 'object') {
      for (const k of Object.keys(extra)) {
        if (extra[k] !== undefined) err[k] = extra[k];
      }
    }
    err.evalError = true;
    throw err;
  }

  function drawIndex(n, rng) {
    const size = (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
    if (size <= 0) return -1;
    const raw = Number(rng());
    let r = isFinite(raw) ? raw : 0;
    if (r < 0) r = 0;
    if (r >= 1) r = 1 - 1e-12;
    const i = Math.floor(r * size);
    return (i >= 0 && i < size) ? i : size - 1;
  }

  function pickOption(options, rng) {
    const list = Array.isArray(options) ? options : [];
    let total = 0;
    for (const o of list) {
      const w = Number(o && o.weight);
      if (isFinite(w) && w > 0) total += w;
    }
    if (total <= 0) return null;
    let r = Number(rng()) * total;
    if (!isFinite(r)) r = total;
    for (const o of list) {
      const w = Number(o && o.weight);
      if (!isFinite(w) || w <= 0) continue;
      r -= w;
      if (r < 0) return o;
    }
    return list[list.length - 1];
  }


  function evalValue(node, state) {
    if (!node || typeof node !== 'object') {
      fail(EVAL_ERR.UNSUPPORTED_VALUE, 0, 'a value is missing from the statement tree');
    }
    const line = node.line;
    switch (node.type) {
      case 'number':
        return { value: mkNumber(node.value), roll: null };
      case 'string':
        return { value: mkString(node.value), roll: null };
      case 'boolean':
        return { value: mkBoolean(node.value === true), roll: null };
      case 'name':
        return { value: readVariable(node.name, line, state), roll: null };
      case 'inline':
        return rollInline(node, line, state);
      case 'roll':
        return rollRef(node, line, state);
      default:
        fail(EVAL_ERR.UNSUPPORTED_VALUE, line,
          'unknown value node "' + String(node.type) + '"');
        return null;
    }
  }

  function readVariable(name, line, state, origin) {
    const rec = state.vars[name];
    if (!rec) {
      fail(EVAL_ERR.MISSING_VARIABLE, line,
        'variable "' + name + '" has no value here (never assigned, or not on the executed path)',
        { varName: name, origin: origin });
    }
    return { type: rec.type, value: rec.value };
  }

  function rollInline(node, line, state) {
    const parsed = node.parsed;
    const token = '((' + String(node.inner == null ? '' : node.inner) + '))';
    if (!parsed || typeof parsed !== 'object') {
      fail(EVAL_ERR.UNSUPPORTED_VALUE, line, 'inline span "' + token + '" has no parsed form');
    }
    if (parsed.type === 'range') {
      const min = Number(parsed.min);
      const max = Number(parsed.max);
      chargeResolution(line, state);
      const n = min + drawIndex(max - min + 1, state.rng);
      chargeChars(String(n).length, line, state);
      return {
        value: mkNumber(n),
        roll: { kind: 'range', token: token, output: String(n) },
      };
    }
    if (parsed.type === 'choice') {
      const options = Array.isArray(parsed.options) ? parsed.options : [];
      const picked = pickOption(options, state.rng);
      if (!picked) {
        fail(EVAL_ERR.EMPTY_CHOICE, line,
          'inline choice "' + token + '" has no option with a positive weight');
      }
      const label = String(picked.label);
      chargeResolution(line, state);
      chargeChars(label.length, line, state);
      return {
        value: mkString(label),
        roll: { kind: 'choice', token: token, output: label, weight: Number(picked.weight) },
      };
    }
    fail(EVAL_ERR.UNSUPPORTED_VALUE, line,
      'inline span "' + token + '" is neither a range nor a choice');
    return null;
  }

  function engineCtx(state) {
    return {
      macros: state.macros,
      evalExpr: state.evalExpr,
      rng: state.rng,
      containers: state.containers,
      operations: state.operations,
      tableFile: state.tableFile,
      depth: state.depth,
      path: state.path,
      budget: state.budget,
      operationDepth: state.operationDepth,
      inFlightOps: state.inFlightOps,
    };
  }

  function failResolve(token, line, res) {
    const first = (res.errors && res.errors[0]) ? res.errors[0] : null;
    const kind = (first && typeof first.kind === 'string') ? first.kind : 'unresolved';
    const extra = { token: token };
    if (first && first.chain) extra.chain = first.chain;
    if (first && first.containerName) extra.containerName = first.containerName;
    if (first && first.macroName) extra.macroName = first.macroName;
    if (first && typeof first.message === 'string' && first.message !== '') {
      extra.message = first.message;
    }
    fail(kind, line, 'ROLL ' + token + ' failed (' + kind + ')', extra);
  }

  function rollRef(node, line, state) {
    if (node.kind === 'inline') {
      return rollInline({ inner: node.inner, parsed: node.parsed }, line, state);
    }
    let token;
    if (node.kind === 'container') {
      token = '[' + String(node.ref == null ? '' : node.ref) + ']';
    } else if (node.kind === 'pipe') {
      token = '|' + String(node.inner == null ? '' : node.inner) + '|';
    } else {
      fail(EVAL_ERR.UNSUPPORTED_VALUE, line,
        'unknown ROLL form "' + String(node.kind) + '"');
      return null;
    }
    const res = state.engine.resolveEmbed(token, engineCtx(state));
    if (!res || res.ok !== true) {
      failResolve(token, line, res || { errors: [] });
    }
    const text = String(res.output);
    chargeChars(0, line, state);
    const detail = { kind: node.kind, token: token, output: text };
    if (Array.isArray(res.trace) && res.trace.length > 0) {
      const last = res.trace[res.trace.length - 1];
      if (last && typeof last.entryLabel === 'string') detail.entryLabel = last.entryLabel;
      detail.children = res.trace;
    }
    return { value: mkString(text), roll: detail };
  }

  function evalUnique(node, names, state) {
    const line = (typeof node.line === 'number') ? node.line : 0;
    const refName = String(node.ref == null ? '' : node.ref).trim();
    const token = '[' + refName + ']';
    const found = state.engine.findContainer(refName, state.containers, state.tableFile);
    if (!found || found.ok !== true) {
      const kind = (found && found.kind === 'ambiguous')
        ? 'ambiguous-container' : 'missing-container';
      fail(kind, line, 'UNIQUE ' + token + ' failed (' + kind + ')', { token: token });
    }
    const container = found.container;
    const containerName = (typeof container.name === 'string' && container.name !== '')
      ? container.name : token;
    const entries = Array.isArray(container.entries) ? container.entries : [];
    if (entries.length === 0) {
      fail('empty-container', line, 'UNIQUE ' + token + ' failed (empty-container)',
        { token: token, containerName: containerName });
    }
    const poolKey = (typeof container.id === 'string' && container.id !== '')
      ? 'id:' + container.id
      : 'name:' + String(container.name).trim().toLowerCase();
    const n = names.length;
    const excluded = state.uniquePool[poolKey] || null;
    const rows = [];
    for (let i = 0; i < entries.length; i += 1) {
      if (excluded && excluded[i]) continue;
      const w = Number(entries[i] && entries[i].weight);
      if (isFinite(w) && w > 0) rows.push(entries[i]);
    }
    if (rows.length < n) {
      fail('bad-unique', line,
        'UNIQUE group needs ' + n + ' rows, "' + containerName + '" has ' + rows.length + ' drawable',
        { token: token, containerName: containerName });
    }
    const picked = weightedPickDistinct(rows, n, state.rng);
    if (!Array.isArray(picked) || picked.length !== n) {
      fail('bad-unique', line,
        'UNIQUE group needs ' + n + ' rows, "' + containerName + '" has ' + rows.length + ' drawable',
        { token: token, containerName: containerName });
    }
    const pool = state.uniquePool[poolKey] || {};
    for (const row of picked) pool[entries.indexOf(row)] = true;
    state.uniquePool[poolKey] = pool;
    return picked.map(function (row) {
      const label = String(row.label != null ? row.label : '');
      return {
        value: mkString(label),
        roll: { kind: 'container', token: token, output: label, entryLabel: label },
      };
    });
  }

  function chargeResolution(line, state) {
    const budget = state.budget;
    budget.resolutions = (typeof budget.resolutions === 'number' ? budget.resolutions : 0) + 1;
    if (budget.resolutions > state.limits.MAX_RESOLUTIONS) {
      fail(EVAL_ERR.NESTING_LIMIT, line,
        'execution exceeded ' + state.limits.MAX_RESOLUTIONS + ' resolutions');
    }
  }

  function chargeChars(count, line, state) {
    const budget = state.budget;
    if (typeof budget.chars !== 'number') budget.chars = 0;
    budget.chars += (typeof count === 'number' && count > 0) ? count : 0;
    if (budget.chars > state.limits.MAX_OUTPUT_CHARS) {
      fail(EVAL_ERR.NESTING_LIMIT, line,
        'execution exceeded ' + state.limits.MAX_OUTPUT_CHARS + ' generated characters');
    }
  }

  function numericOf(v, line, op, state) {
    if (v.type === 'number') return v.value;
    if (v.type === 'string') {
      if (state.isNumeric(v.value)) return Number(v.value);
      fail(EVAL_ERR.TYPE_MISMATCH, line,
        '"' + v.value + '" is not a number, so "' + op + '" cannot compare it');
    }
    fail(EVAL_ERR.TYPE_MISMATCH, line,
      'a boolean (' + renderTyped(v) + ') cannot be used with "' + op + '"');
    return 0;
  }

  function equalTyped(a, b) {
    return a.type === b.type && a.value === b.value;
  }

  function compare(a, b, op, line, state) {
    if (op === '==' || op === '!=') {
      if (a.type !== b.type) {
        fail(EVAL_ERR.TYPE_MISMATCH, line,
          'cannot compare ' + describeTyped(a) + ' with ' + describeTyped(b) +
          ' using "' + op + '" — the two values have different types and comparisons need matching types');
      }
      const eq = equalTyped(a, b);
      return op === '==' ? eq : !eq;
    }
    if (op === '>' || op === '<' || op === '>=' || op === '<=') {
      const x = numericOf(a, line, op, state);
      const y = numericOf(b, line, op, state);
      if (op === '>') return x > y;
      if (op === '<') return x < y;
      if (op === '>=') return x >= y;
      return x <= y;
    }
    fail(EVAL_ERR.UNSUPPORTED_CONDITION, line, 'unknown comparison operator "' + op + '"');
    return false;
  }

  function caseEqual(subject, candidate) {
    return subject.type === candidate.type && subject.value === candidate.value;
  }

  function evalCondition(node, state, checks) {
    if (!node || typeof node !== 'object') {
      fail(EVAL_ERR.UNSUPPORTED_CONDITION, 0, 'a condition node is missing');
    }
    const line = node.line;
    if (node.type === 'group') return evalCondition(node.inner, state, checks);
    if (node.type === 'and' || node.type === 'or') {
      const left = evalCondition(node.left, state, checks);
      const right = evalCondition(node.right, state, checks);
      return node.type === 'and' ? (left && right) : (left || right);
    }
    if (node.type === 'cmp') {
      const l = evalValue(node.left, state).value;
      const r = evalValue(node.right, state).value;
      const result = compare(l, r, node.op, line, state);
      checks.push({ op: node.op, left: l, right: r, result: result });
      return result;
    }
    fail(EVAL_ERR.UNSUPPORTED_CONDITION, line,
      'unknown condition node "' + String(node.type) + '"');
    return false;
  }

  function record(state, entry) {
    state.step += 1;
    entry.step = state.step;
    state.trace.push(entry);
    return entry;
  }

  function storeValue(name, value, source, line, state) {
    state.vars[name] = { type: value.type, value: value.value, source: source, line: line };
  }

  function execSet(st, state) {
    const res = evalValue(st.value, state);
    const source = (st.value && typeof st.value.type === 'string') ? st.value.type : 'unknown';
    storeValue(st.name, res.value, source, st.line, state);
    const entry = {
      kind: 'set',
      line: st.line,
      name: st.name,
      type: res.value.type,
      value: res.value.value,
      source: source,
    };
    if (res.roll) entry.roll = res.roll;
    record(state, entry);
  }

  function uniqueSet(names, node, line, state) {
    const draws = evalUnique(node, names, state);
    for (let i = 0; i < names.length; i += 1) {
      const d = draws[i];
      storeValue(names[i], d.value, 'unique', line, state);
      const entry = {
        kind: 'set',
        line: line,
        name: names[i],
        type: d.value.type,
        value: d.value.value,
        source: 'unique',
      };
      if (d.roll) entry.roll = d.roll;
      record(state, entry);
    }
  }

  function execMultiSet(st, state) {
    const names = (Array.isArray(st.names) ? st.names : [])
      .map(function (x) { return x.name; });
    const values = Array.isArray(st.values) ? st.values : [];
    if (st.mode === 'unique') {
      uniqueSet(names, values[0], st.line, state);
      return;
    }
    if (st.mode === 'each') {
      const node = values[0];
      const source = (node && typeof node.type === 'string') ? node.type : 'unknown';
      for (let i = 0; i < names.length; i += 1) {
        const res = evalValue(node, state);
        storeValue(names[i], res.value, source, st.line, state);
        const entry = {
          kind: 'set',
          line: st.line,
          name: names[i],
          type: res.value.type,
          value: res.value.value,
          source: source,
        };
        if (res.roll) entry.roll = res.roll;
        record(state, entry);
      }
      return;
    }
    if (st.mode === 'zip') {
      for (let i = 0; i < names.length; i += 1) {
        const node = values[i];
        const res = evalValue(node, state);
        const source = (node && typeof node.type === 'string') ? node.type : 'unknown';
        storeValue(names[i], res.value, source, st.line, state);
        const entry = {
          kind: 'set',
          line: st.line,
          name: names[i],
          type: res.value.type,
          value: res.value.value,
          source: source,
        };
        if (res.roll) entry.roll = res.roll;
        record(state, entry);
      }
      return;
    }
    const node = values[0];
    const res = evalValue(node, state);
    const source = (node && typeof node.type === 'string') ? node.type : 'unknown';
    for (let i = 0; i < names.length; i += 1) {
      storeValue(names[i], res.value, source, st.line, state);
      const entry = {
        kind: 'set',
        line: st.line,
        name: names[i],
        type: res.value.type,
        value: res.value.value,
        source: source,
      };
      if (res.roll) entry.roll = res.roll;
      record(state, entry);
    }
  }

  function execImport(st, state) {
    const supplied = state.importValues[st.name];
    if (!supplied) {
      fail(EVAL_ERR.MISSING_IMPORT, st.line,
        state.importSource === 'generator'
          ? 'IMPORT "' + st.name + '" has no value in this generator run — no earlier part of the run supplied it'
          : 'IMPORT "' + st.name + '" has no value — supply it for this run',
        { varName: st.name });
    }
    const value = { type: supplied.type, value: supplied.value };
    state.vars[st.name] = { type: value.type, value: value.value, source: 'import', line: st.line };
    record(state, {
      kind: 'import',
      line: st.line,
      name: st.name,
      type: value.type,
      value: value.value,
      source: supplied.source,
    });
  }

  function execExpose(st, state) {
    const value = readVariable(st.name, st.line, state, 'expose');
    if (state.exposed.indexOf(st.name) === -1) state.exposed.push(st.name);
    record(state, {
      kind: 'expose',
      line: st.line,
      name: st.name,
      type: value.type,
      value: value.value,
    });
  }

  function execIf(st, state, depth) {
    const evaluations = [];
    let branch = null;
    let body = null;
    const checks = [];
    if (evalCondition(st.condition, state, checks)) {
      branch = 'then';
      body = st.thenBody;
    }
    evaluations.push({ clause: 'if', result: branch === 'then', checks: checks });
    const elseIfs = Array.isArray(st.elseIfs) ? st.elseIfs : [];
    for (let i = 0; body === null && i < elseIfs.length; i++) {
      const eif = elseIfs[i];
      const eifChecks = [];
      const hit = evalCondition(eif.condition, state, eifChecks);
      evaluations.push({ clause: 'else-if ' + i, result: hit, checks: eifChecks });
      if (hit) {
        branch = 'else-if ' + i;
        body = eif.body;
      }
    }
    if (body === null && st.elseBody) {
      branch = 'else';
      body = st.elseBody;
    }
    record(state, { kind: 'if', line: st.line, evaluations: evaluations, branch: branch });
    if (body) runBlock(body, state, depth + 1, st.line);
  }

  function evalCaseValue(node, state, line) {
    if (node && node.type === 'inline') {
      const options = (node.parsed && node.parsed.type === 'choice' && Array.isArray(node.parsed.options))
        ? node.parsed.options
        : [];
      if (node.parsed && node.parsed.type === 'choice' && options.length === 1) {
        return mkString(options[0].label);
      }
      fail(EVAL_ERR.INVALID_CASE, line,
        'a CASE label must be a single comparable value, not ((...))',
        { token: '((' + String(node.inner == null ? '' : node.inner) + '))' });
    }
    return evalValue(node, state).value;
  }

  function execSwitch(st, state, depth) {
    const subjectRes = evalValue(st.subject, state);
    const subject = subjectRes.value;
    const cases = Array.isArray(st.cases) ? st.cases : [];
    const comparisons = [];
    let branch = null;
    let body = null;
    for (let i = 0; i < cases.length; i++) {
      const cs = cases[i];
      if (cs.isDefault) continue;
      const clause = 'case ' + i;
      const candidate = evalCaseValue(cs.value, state, cs.line != null ? cs.line : st.line);
      const equal = caseEqual(subject, candidate);
      comparisons.push({ clause: clause, value: candidate, equal: equal });
      if (equal && body === null) {
        branch = clause;
        body = cs.body;
        break;
      }
    }
    if (body === null) {
      for (let i = 0; i < cases.length; i++) {
        if (cases[i].isDefault) {
          branch = 'default';
          body = cases[i].body;
          break;
        }
      }
    }
    const entry = {
      kind: 'switch',
      line: st.line,
      subject: subject,
      comparisons: comparisons,
      branch: branch,
    };
    if (subjectRes.roll) entry.roll = subjectRes.roll;
    record(state, entry);
    if (body) runBlock(body, state, depth + 1, st.line);
  }

  function execStatement(st, state, depth) {
    switch (st.type) {
      case 'set':
        if (st.value && typeof st.value === 'object' && st.value.type === 'unique') {
          uniqueSet([st.name], st.value, st.line, state);
          return;
        }
        execSet(st, state);
        return;
      case 'multi-set': execMultiSet(st, state); return;
      case 'import': execImport(st, state); return;
      case 'expose': execExpose(st, state); return;
      case 'if': execIf(st, state, depth); return;
      case 'switch': execSwitch(st, state, depth); return;
      default:
        fail(EVAL_ERR.BAD_SCRIPT, st.line,
          'unknown statement "' + String(st.type) + '"');
    }
  }

  function runBlock(list, state, depth, parentLine) {
    if (depth >= state.limits.MAX_DEPTH) {
      fail(EVAL_ERR.NESTING_LIMIT, parentLine || 0,
        'blocks are nested deeper than ' + state.limits.MAX_DEPTH + ' levels');
    }
    const stmts = Array.isArray(list) ? list : [];
    for (let i = 0; i < stmts.length; i++) {
      execStatement(stmts[i], state, depth);
    }
  }

  function statementsOf(input, language) {
    if (typeof input === 'string') {
      const parsed = language.parseScript(input);
      if (parsed && parsed.ok === true) return { ok: true, statements: parsed.statements };
      return {
        ok: false,
        errors: (parsed && Array.isArray(parsed.errors)) ? parsed.errors : [],
      };
    }
    if (Array.isArray(input)) {
      const v = language.validateProgram(input);
      if (v && v.ok === true) return { ok: true, statements: input };
      return {
        ok: false,
        errors: (v && Array.isArray(v.errors)) ? v.errors : [],
      };
    }
    return {
      ok: false,
      errors: [{ kind: EVAL_ERR.BAD_SCRIPT, line: 0, message: 'a script string or a statement array is required' }],
    };
  }

  function importValuesOf(options) {
    const out = Object.create(null);
    const raw = (options.values && typeof options.values === 'object' && !Array.isArray(options.values))
      ? options.values
      : {};
    const origin = (typeof options.importSource === 'string' && options.importSource !== '')
      ? options.importSource
      : 'test-input';
    const errors = [];
    for (const key of Object.keys(raw)) {
      const supplied = raw[key];
      const typed = asTyped(supplied);
      if (!typed) {
        errors.push({
          kind: EVAL_ERR.INVALID_IMPORT,
          line: 0,
          message: 'the supplied value for "' + key + '" is not a number, string or boolean',
          varName: key,
        });
        continue;
      }
      const source = (isTypedValue(supplied)
        && typeof supplied.source === 'string' && supplied.source !== '')
        ? supplied.source
        : origin;
      out[key] = { type: typed.type, value: typed.value, source: source };
    }
    return { values: out, errors: errors };
  }

  function evaluate(input, options) {
    const o = (options && typeof options === 'object' && !Array.isArray(options)) ? options : {};
    const empty = {
      ok: false,
      output: '',
      segments: [],
      errors: [],
      trace: [],
      variables: {},
      exposed: [],
    };
    const language = languageOf();
    const engine = engineOf();
    if (!language) {
      empty.errors.push({
        kind: EVAL_ERR.MISSING_LANGUAGE,
        line: 0,
        message: 'js/logic-language.js must load before js/logic-evaluator.js',
      });
      return empty;
    }
    if (!engine) {
      empty.errors.push({
        kind: EVAL_ERR.MISSING_ENGINE,
        line: 0,
        message: 'generator-engine.js must load before js/logic-evaluator.js',
      });
      return empty;
    }

    const prepared = statementsOf(input, language);
    if (!prepared.ok) {
      empty.errors = prepared.errors;
      return empty;
    }

    const supplied = importValuesOf(o);
    if (supplied.errors.length > 0) {
      empty.errors = supplied.errors;
      return empty;
    }

    const budget = (o.budget && typeof o.budget === 'object')
      ? o.budget
      : { resolutions: 0, chars: 0 };
    if (typeof budget.resolutions !== 'number') budget.resolutions = 0;
    if (typeof budget.chars !== 'number') budget.chars = 0;

    const state = {
      engine: engine,
      limits: engine.LIMITS,
      isNumeric: function (text) { return language.isNumericText(text); },
      rng: (typeof o.rng === 'function') ? o.rng : Math.random,
      evalExpr: (typeof o.evalExpr === 'function') ? o.evalExpr : null,
      macros: Array.isArray(o.macros) ? o.macros : [],
      containers: Array.isArray(o.containers) ? o.containers : [],
      operations: Array.isArray(o.operations) ? o.operations : [],
      tableFile: (typeof o.tableFile === 'string') ? o.tableFile : '',
      depth: (typeof o.depth === 'number' && o.depth >= 0) ? o.depth : 0,
      path: Array.isArray(o.path) ? o.path : [],
      budget: budget,
      operationDepth: (typeof o.operationDepth === 'number' && o.operationDepth >= 0)
        ? o.operationDepth
        : 0,
      inFlightOps: Array.isArray(o.inFlightOps) ? o.inFlightOps : [],
      importSource: (typeof o.importSource === 'string' && o.importSource !== '')
        ? o.importSource
        : 'test-input',
      importValues: supplied.values,
      uniquePool: (o.uniquePool && typeof o.uniquePool === 'object'
        && !Array.isArray(o.uniquePool))
        ? o.uniquePool : Object.create(null),
      vars: Object.create(null),
      exposed: [],
      trace: [],
      step: 0,
    };

    const errors = [];
    try {
      runBlock(prepared.statements, state, 0, 0);
    } catch (e) {
      if (e && e.evalError === true) {
        const entry = { kind: e.kind, line: e.line, message: e.message };
        for (const k of Object.keys(e)) {
          if (k === 'evalError' || k === 'kind' || k === 'line' || k === 'message') continue;
          entry[k] = e[k];
        }
        errors.push(entry);
      } else {
        errors.push({
          kind: EVAL_ERR.EVALUATION_FAILED,
          line: 0,
          message: (e && e.message) ? String(e.message) : String(e),
        });
      }
    }

    const variables = Object.create(null);
    for (const name of Object.keys(state.vars)) {
      const rec = state.vars[name];
      variables[name] = { type: rec.type, value: rec.value, source: rec.source };
    }
    const exposed = state.exposed.map((name) => ({
      name: name,
      type: state.vars[name].type,
      value: state.vars[name].value,
    }));

    return {
      ok: errors.length === 0,
      output: '',
      segments: [],
      errors: errors,
      trace: state.trace,
      variables: variables,
      exposed: exposed,
    };
  }

  const api = {
    evaluate,
    EVAL_ERR,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LogicEvaluator = api;
  if (typeof globalThis !== 'undefined') globalThis.LogicEvaluator = api;
})();

'use strict';
/*
 * ttrpg-rollflow-test.js — deterministic Node test harness for the TTRPG Tools
 * roll flow through app.js (macros -> evaluate -> history -> generators).
 * Zero npm dependencies.
 *
 * Technique: the app's <script src> sources (index.html, in document order:
 * generator-engine.js, the js/ state+toasts modules, app.js) are loaded
 * verbatim into a fresh vm context (vm.createContext) with a localStorage
 * stub and no document at load (so app.js's boot guard at the tail never
 * fires). A probe appended to the source reassigns renderHistory/renderAll
 * to no-ops, captures toast calls (no DOM), exports the bindings we exercise
 * plus a Math.random patcher, and — for the gen-mode checks only — installs
 * a minimal fake `document` after the app source has evaluated.
 * window->sandbox is set so genEngine() finds window.GeneratorEngine.
 *
 * Determinism: every Math.random usage is pinned with a scripted rng.
 *   - evaluate takes an rng parameter directly.
 *   - weightedPick / genRollEntry use the context Math.random, patched through
 *     a __setRng probe.
 * No assertion can fail on a legitimate random outcome.
 *
 * Run:  node ttrpg-rollflow-test.js
 * Output: one line per failed check, then "N checks / N passed".
 * Exit: 0 all pass, 1 any failure, 2 fatal load error.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ check kit
let checks = 0;
let passed = 0;

function check(name, cond) {
  checks++;
  if (cond) passed++;
  else console.log('FAIL: ' + name);
}

function checkEq(name, actual, expected) {
  checks++;
  if (actual === expected) passed++;
  else console.log('FAIL: ' + name + ' \u2014 expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEq(a[k], b[k])) return false;
  }
  return true;
}

function checkDeep(name, actual, expected) {
  checks++;
  if (deepEq(actual, expected)) passed++;
  else console.log('FAIL: ' + name + ' \u2014 expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// Deterministic rng; last value repeats on overflow.
function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

// ------------------------------------------------------- load app.js in vm
// index.html drives the load order: every <script src="..."> tag (document
// order) is read relative to the repo root and concatenated here, so this
// harness tracks the modular split without further changes.
const scriptSrcs = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
const appSource = scriptSrcs.map((src) => fs.readFileSync(path.join(ROOT, src), 'utf8')).join('\n');

const store = new Map();
const sandbox = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  },
};

const probe = [
  'renderHistory = function() { /* DOM stub: no-op in the Node harness */ };',
  'renderAll = function() { /* DOM stub: no-op in the Node harness */ };',
  'renderLogicOpsTab = function() { /* DOM stub: no-op in the Node harness */ };',
  'toast = function(msg, kind) { globalThis.__toastLog.push([msg, kind]); };',
  'globalThis.__toastLog = [];',
  'globalThis.__downloads = [];',
  'downloadJsonPayload = function(payload, name) { globalThis.__downloads.push([name, JSON.parse(JSON.stringify(payload))]); };',
  'globalThis.__T = {',
  '  state: state,',
  '  evaluate: evaluate,',
  '  matchMacro: matchMacro,',
  '  weightedPick: weightedPick,',
  '  addHistory: addHistory,',
  '  runGenItem: runGenItem,',
  '  derive: derive,',
  '  genEngine: genEngine,',
  '  engineContainers: engineContainers,',
  '  genRollEntry: genRollEntry,',
  '  resolveEntryEmbeds: resolveEntryEmbeds,',
  '  entryEmbedContext: entryEmbedContext,',
  '  embedErrorMessage: embedErrorMessage,',
  '  genErrorMessage: genErrorMessage,',
  '  validateGen: validateGen,',
  '  genOperationRefs: genOperationRefs,',
  '  insertGenOperationRef: insertGenOperationRef,',
  '  findLogicOpRow: findLogicOpRow,',
  '  opSpanAt: opSpanAt,',
  '  opSuggestItems: opSuggestItems,',
  '  isEmptyOpError: isEmptyOpError,',
  '  isOpErrorKind: isOpErrorKind,',
  '  genResultNodes: genResultNodes,',
  '  unclosedSpanAt: unclosedSpanAt,',
  '  pipeSuggestItems: pipeSuggestItems,',
  '  GEN_DICE_PRESETS: GEN_DICE_PRESETS,',
  '  createNewTableFile: createNewTableFile,',
  '  createNewMacroFile: createNewMacroFile,',
  '  createNewGenFile: createNewGenFile,',
  '  createNewLogicOpsFile: createNewLogicOpsFile,',
  '  renameLogicOpsFile: renameLogicOpsFile,',
  '  deleteLogicOpsFile: deleteLogicOpsFile,',
  '  opReferences: opReferences,',
  '  persistLogicOpsFile: persistLogicOpsFile,',
  '  renameOperation: renameOperation,',
  '  duplicateLogicOperation: duplicateLogicOperation,',
  '  findOperationNameClash: findOperationNameClash,',
  '  findGeneratorOpRenameRefs: findGeneratorOpRenameRefs,',
  '  rewriteGeneratorOpRefs: rewriteGeneratorOpRefs,',
  '  findEntryOpRefs: findEntryOpRefs,',
  '  rewriteEntryOpRefs: rewriteEntryOpRefs,',
  '  entryOperationRefs: entryOperationRefs,',
  '  ensureEntryOpRefs: ensureEntryOpRefs,',
  '  deleteOperation: deleteOperation,',
  '  onLogicDeleteOp: onLogicDeleteOp,',
  '  filterLogicOps: filterLogicOps,',
  '  ensureOperationIds: ensureOperationIds,',
  '  sanitizeFileName: sanitizeFileName,',
  '  sniffKind: sniffKind,',
  '  planOperationsImport: planOperationsImport,',
  '  remapOperationRefs: remapOperationRefs,',
  '  remapGenOccurrenceRefs: remapGenOccurrenceRefs,',
  '  remapEntryOpRefs: remapEntryOpRefs,',
  '  analyzeTablesImportPayload: analyzeTablesImportPayload,',
  '  applyTablesImport: applyTablesImport,',
  '  tablesImportSnapshot: tablesImportSnapshot,',
  '  exportAllTables: exportAllTables,',
  '  loadAllFiles: loadAllFiles,',
  '  persistGeneratorFile: persistGeneratorFile,',
  '  setFile: setFile,',
  '  collectGenBundleOperations: collectGenBundleOperations,',
  '  buildGenExportPayload: buildGenExportPayload,',
  '  analyzeGenImportPayload: analyzeGenImportPayload,',
  '  applyGenImport: applyGenImport,',
  '  operationReportSuffix: operationReportSuffix,',
  '  createLogicOperation: createLogicOperation,',
  '  validateLogicOperation: validateLogicOperation,',
  '  runLogicOpTest: runLogicOpTest,',
  '  logicRunErrorMessage: logicRunErrorMessage,',
  '  isScriptLogicOp: isScriptLogicOp,',
  '  newLogicOpDraft: newLogicOpDraft,',
  '  buildLogicOpsBundle: buildLogicOpsBundle,',
  '  parseLogicOpsBundle: parseLogicOpsBundle,',
  '  validateLogicOpsBundle: validateLogicOpsBundle,',
  '  exportLogicOperation: exportLogicOperation,',
  '  serializeLogicOpsFile: serializeLogicOpsFile,',
  '  planLogicOpsImport: planLogicOpsImport,',
  '  nextLogicOpsPath: nextLogicOpsPath,',
  '  HISTORY_KEY: HISTORY_KEY,',
  '  HISTORY_MAX: HISTORY_MAX,',
  '  normalizeGeneratorItem: normalizeGeneratorItem,',
  '  addGeneratorToFile: addGeneratorToFile,',
  '  onAddGeneratorTo: onAddGeneratorTo,',
  '  renderGenEditor: renderGenEditor,',
  '  __dispatch: __dispatchNode,',
  '  __node: __node,',
  '};',
  'globalThis.__origRandom = Math.random;',
  'globalThis.__setRng = (fn) => { Math.random = fn; };',
  '/* Fake DOM: the minimal surface renderGenEditor and its panels need in the */',
  '/* Node harness. el() (js/toasts.js) is the only builder: createElement, */',
  '/* className, value, hidden, textContent, setAttribute, appendChild/append/ */',
  '/* replaceChildren, classList, dataset, addEventListener, focus/selection, */',
  '/* offset/client width, scroll offsets, contains, tag/.class/tag.class queries. */',
  'function __makeTextNode(text) {',
  '  return { nodeType: 3, tagName: "#text", textContent: String(text), childNodes: [] };',
  '}',
  'function __makeNode(tagName) {',
  '  const el2 = {',
  '    nodeType: 1,',
  '    tagName: String(tagName || "div").toUpperCase(),',
  '    childNodes: [],',
  '    __cls: new Set(),',
  '    dataset: {},',
  '    style: {},',
  '    value: "",',
  '    hidden: false,',
  '    textContent: "",',
  '    title: "",',
  '    offsetWidth: 100,',
  '    clientWidth: 100,',
  '    scrollTop: 0,',
  '    scrollLeft: 0,',
  '    selectionStart: 0,',
  '    selectionEnd: 0,',
  '    _listeners: {},',
  '    _attrs: {},',
  '    get className() { return Array.from(this.__cls).join(" "); },',
  '    set className(v) {',
  '      this.__cls.clear();',
  '      for (const c of String(v == null ? "" : v).split(/\\s+/)) if (c !== "") this.__cls.add(c);',
  '    },',
  '  };',
  '  el2.classList = {',
  '    add: function () { for (let i = 0; i < arguments.length; i++) el2.__cls.add(arguments[i]); },',
  '    remove: function () { for (let i = 0; i < arguments.length; i++) el2.__cls.delete(arguments[i]); },',
  '    contains: function (c) { return el2.__cls.has(c); },',
  '    toggle: function (c, force) {',
  '      const on = force === undefined ? !el2.__cls.has(c) : !!force;',
  '      if (on) el2.__cls.add(c); else el2.__cls.delete(c);',
  '      return on;',
  '    },',
  '  };',
  '  el2.appendChild = function (c) { el2.childNodes.push(c); return c; };',
  '  el2.append = function () { for (let i = 0; i < arguments.length; i++) el2.childNodes.push(arguments[i]); };',
  '  el2.replaceChildren = function () {',
  '    el2.childNodes.length = 0;',
  '    for (let i = 0; i < arguments.length; i++) el2.childNodes.push(arguments[i]);',
  '  };',
  '  el2.contains = function (n) {',
  '    if (!n) return false;',
  '    const stack = el2.childNodes.slice();',
  '    while (stack.length > 0) {',
  '      const c = stack.pop();',
  '      if (c === n) return true;',
  '      const kids = Array.isArray(c.childNodes) ? c.childNodes : [];',
  '      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);',
  '    }',
  '    return false;',
  '  };',
  '  el2.setAttribute = function (k, v) { el2._attrs[k] = String(v); };',
  '  el2.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(el2._attrs, k) ? el2._attrs[k] : null; };',
  '  el2.addEventListener = function (t, fn) { (el2._listeners[t] = el2._listeners[t] || []).push(fn); };',
  '  el2.removeEventListener = function () {};',
  '  el2.focus = function () {};',
  '  el2.blur = function () {};',
  '  el2.setSelectionRange = function () {};',
  '  el2.querySelector = function (sel) { return __queryIn(el2, sel); };',
  '  el2.querySelectorAll = function (sel) { return __queryAllIn(el2, sel); };',
  '  return el2;',
  '}',
  'function __parseSel(sel) {',
  '  const m = String(sel == null ? "" : sel).trim().match(/^([a-zA-Z][\\w-]*)?(\\.[\\w-]+)?$/);',
  '  if (!m) return null;',
  '  return { tag: m[1] ? m[1].toLowerCase() : null, cls: m[2] ? m[2].slice(1) : null };',
  '}',
  'function __queryAllIn(root, sel) {',
  '  const p = __parseSel(sel);',
  '  const out = [];',
  '  if (!p) return out;',
  '  (function walk(n) {',
  '    const kids = Array.isArray(n.childNodes) ? n.childNodes : [];',
  '    for (let i = 0; i < kids.length; i++) {',
  '      const c = kids[i];',
  '      const tagOk = !p.tag || (c.tagName || "").toLowerCase() === p.tag;',
  '      const clsOk = !p.cls || (c.classList && c.classList.contains(p.cls));',
  '      if (tagOk && clsOk) out.push(c);',
  '      walk(c);',
  '    }',
  '  })(root);',
  '  return out;',
  '}',
  'function __queryIn(root, sel) {',
  '  const all = __queryAllIn(root, sel);',
  '  return all.length > 0 ? all[0] : null;',
  '}',
  'function __dispatchNode(node, type, evt) {',
  '  const listeners = (node && node._listeners && node._listeners[type]) || [];',
  '  const e = evt || { type: type, target: node, preventDefault: function () {}, stopPropagation: function () {} };',
  '  let r;',
  '  for (let i = 0; i < listeners.length; i++) r = listeners[i](e);',
  '  return r;',
  '}',
  'function __node(tag) { return document.createElement(tag); }',
  'var document = {',
  '  documentElement: null,',
  '  body: null,',
  '  activeElement: null,',
  '  title: "",',
  '  createElement: function (t) { return __makeNode(t); },',
  '  createTextNode: function (t) { return __makeTextNode(t); },',
  '  querySelector: function () { return null; },',
  '  querySelectorAll: function () { return []; },',
  '  getElementById: function () { return null; },',
  '  addEventListener: function () {},',
  '  removeEventListener: function () {},',
  '};',
  'document.body = __makeNode("body");',
  'document.documentElement = __makeNode("html");',
  'document.documentElement.appendChild(document.body);',
  '',
].join('\n');

let T;
try {
  const context = vm.createContext(sandbox);
  sandbox.window = sandbox; // window -> sandbox so gen-engine's window.GeneratorEngine lands here
  vm.runInContext(appSource + '\n' + probe, context, { filename: 'app.js' });
  T = sandbox.__T;
} catch (e) {
  console.log('FATAL: could not load app.js / generator-engine.js in vm context: ' + (e && e.message ? e.message : String(e)));
  process.exit(2);
}

check('load: __T exported', !!T);
check('load: evaluate is a function', typeof T.evaluate === 'function');
check('load: addHistory is a function', typeof T.addHistory === 'function');
check('load: window.GeneratorEngine present', typeof sandbox.GeneratorEngine === 'object' && !!sandbox.GeneratorEngine);
check('load: genEngine() finds the engine', T.genEngine() === sandbox.GeneratorEngine);

// ----------------------------------------------------------------- matchMacro
{
  T.state.macros = [
    { file: 'dice-macros/fire.json', index: 0, name: 'fire', label: 'Fire', formula: '1d6' },
    { file: 'dice-macros/fire.json', index: 1, name: 'fire bolt', label: 'Fire Bolt', formula: '2d8' },
  ];

  let m = T.matchMacro('fire');
  check('macro: exact match returns object', !!m);
  checkEq('macro: exact match expression', m ? m.expression : null, '(1d6)');
  checkEq('macro: exact match display', m ? m.display : null, 'fire \u2192 (1d6)');
  checkEq('macro: exact match macro name', m ? m.macro.name : null, 'fire');

  m = T.matchMacro('fire bolt');
  checkEq('macro: longest name wins (name)', m ? m.macro.name : null, 'fire bolt');
  checkEq('macro: longest name wins (expression)', m ? m.expression : null, '(2d8)');
  checkEq('macro: longest name wins (display)', m ? m.display : null, 'fire bolt \u2192 (2d8)');

  m = T.matchMacro('fire +5');
  checkEq('macro: plus remainder expression', m ? m.expression : null, '(1d6) + 5');
  checkEq('macro: plus remainder display', m ? m.display : null, 'fire +5 \u2192 (1d6) + 5');

  m = T.matchMacro('fire (1d6)');
  checkEq('macro: paren remainder expression', m ? m.expression : null, '(1d6) + (1d6)');

  m = T.matchMacro('fire 1d6');
  checkEq('macro: digit remainder expression', m ? m.expression : null, '(1d6) + 1d6');

  m = T.matchMacro('fire *2');
  checkEq('macro: star remainder expression', m ? m.expression : null, '(1d6) * 2');
  checkEq('macro: star remainder display', m ? m.display : null, 'fire *2 \u2192 (1d6) * 2');

  m = T.matchMacro('fire -1');
  checkEq('macro: minus remainder expression', m ? m.expression : null, '(1d6) - 1');
  checkEq('macro: minus remainder display', m ? m.display : null, 'fire -1 \u2192 (1d6) - 1');

  m = T.matchMacro('fire /2');
  checkEq('macro: slash remainder expression', m ? m.expression : null, '(1d6) / 2');
  checkEq('macro: slash remainder display', m ? m.display : null, 'fire /2 \u2192 (1d6) / 2');

  checkEq('macro: boundary (firewall) no match', T.matchMacro('firewall'), null);
  checkEq('macro: empty input no match', T.matchMacro(''), null);
}

// ------------------------------------------- evaluate through the roll path
{
  const r1 = T.evaluate('2d6+3', seqRng([0.5]));
  checkEq('evaluate: 2d6+3 value', r1.value, 11);
  checkDeep('evaluate: 2d6+3 steps', r1.steps, ['2d6 = 4 + 4 = 8', '8 + 3 = 11']);

  const r2 = T.evaluate('1d20+5', seqRng([0.5]));
  checkEq('evaluate: 1d20+5 value', r2.value, 16);
  checkDeep('evaluate: 1d20+5 steps', r2.steps, ['1d20 = 11', '11 + 5 = 16']);

  // matchMacro -> evaluate flow (the actual roll bar path)
  const mm = T.matchMacro('fire +5');
  checkEq('flow: matchMacro expression', mm ? mm.expression : null, '(1d6) + 5');
  const r3 = T.evaluate(mm.expression, seqRng([0.5]));
  checkEq('flow: evaluate macro expression value', r3.value, 9);

  T.state.macros = [];
  checkEq('macro: no macros -> null', T.matchMacro('fire'), null);
}

// ---------------------------------------------------------------- weightedPick
{
  sandbox.__setRng(seqRng([0.5]));
  const a = { label: 'A', weight: 1 };
  checkEq('weightedPick: single usable entry always returned', T.weightedPick([a]), a);

  const zero = { label: 'Z', weight: 0 };
  const absent = { label: 'N' };
  const pos = { label: 'P', weight: 5 };
  checkEq('weightedPick: zero/absent skipped, positive wins', T.weightedPick([zero, absent, pos]), pos);

  checkEq('weightedPick: all non-positive -> null',
    T.weightedPick([{ label: 'A', weight: 0 }, { label: 'B', weight: -1 }, { label: 'C' }]), null);

  const A = { label: 'A', weight: 1 };
  const B = { label: 'B', weight: 1 };
  sandbox.__setRng(seqRng([0.25]));
  checkEq('weightedPick: pinned low -> first entry', T.weightedPick([A, B]), A);
  sandbox.__setRng(seqRng([0.75]));
  checkEq('weightedPick: pinned high -> second entry', T.weightedPick([A, B]), B);

  // Float-edge fallback: Math.random()===1.0 -> r===total -> walk ends at 0
  // (never < 0) -> falls through to the LAST entry.
  sandbox.__setRng(seqRng([1.0]));
  checkEq('weightedPick: fallback returns last entry', T.weightedPick([A, B]), B);

  sandbox.__setRng(sandbox.__origRandom);
}

// ------------------------------------------------------------- history (55x)
{
  T.state.history = [];
  for (let i = 1; i <= 55; i++) {
    T.addHistory({ time: 't' + i, display: 'hist-' + i, value: i });
  }
  const h = T.state.history;
  checkEq('history: truncated to HISTORY_MAX (50)', h.length, 50);
  checkEq('history: HISTORY_MAX constant', T.HISTORY_MAX, 50);
  checkEq('history: HISTORY_KEY constant', T.HISTORY_KEY, 'ttrpg-history');
  checkEq('history: newest first (top value)', h[0].value, 55);
  checkEq('history: top display', h[0].display, 'hist-55');
  checkEq('history: oldest kept is #6', h[49].value, 6);
  checkDeep('history: entry shape keys', Object.keys(h[0]).sort(), ['display', 'time', 'value']);
  const raw = store.get(T.HISTORY_KEY);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {}
  checkEq('history: persisted to localStorage (50 entries)', parsed && parsed.length, 50);
}

// ------------------------------------ random validity (unpinned rng)
// Verify random rolls. Validity/range only — never exact values:
// the context Math.random is left untouched (restored to the original below),
// so no assertion can fail on a legitimate random outcome.
{
  sandbox.__setRng(sandbox.__origRandom);
  let dice = true;
  for (let i = 0; i < 200; i++) {
    const v = T.evaluate('1d20').value;
    if (!Number.isInteger(v) || v < 1 || v > 20) { dice = false; break; }
  }
  check('random: 1d20 always lands in 1..20 as an integer (unpinned rng)', dice);

  let range = true;
  for (let i = 0; i < 200; i++) {
    const out = T.resolveEntryEmbeds('((10-20))').output;
    const v = Number(out);
    if (!Number.isInteger(v) || v < 10 || v > 20) { range = false; break; }
  }
  check('random: ((10-20)) always lands in 10..20 as an integer (unpinned rng)', range);

  const pickA = { label: 'A', weight: 1 };
  const pickB = { label: 'B', weight: 1 };
  const pickC = { label: 'C', weight: 1 };
  let inList = true;
  for (let i = 0; i < 200; i++) {
    const p = T.weightedPick([pickA, pickB, pickC]);
    if (p !== pickA && p !== pickB && p !== pickC) { inList = false; break; }
  }
  check('random: weightedPick always returns one of the entries (unpinned rng)', inList);
}

// ------------------------------------------------------------ generators flow
{
  // Seed state.files (engineContainers reads the live id off the raw item)
  // and state.tables with two containers: one populated, one empty.
  T.state.files.set('tables/flow.json', {
    text: '',
    parsed: {
      items: [
        { id: 'w1', name: 'Weapons', entries: [{ label: 'Sword', weight: 1 }, { label: 'Axe', weight: 1 }] },
        { id: 'e1', name: 'EmptyBox', entries: [] },
      ],
    },
    error: null,
  });
  T.state.tables = [
    { file: 'tables/flow.json', index: 0, name: 'Weapons', entries: [{ label: 'Sword', weight: 1 }, { label: 'Axe', weight: 1 }] },
    { file: 'tables/flow.json', index: 1, name: 'EmptyBox', entries: [] },
  ];

  const containers = T.engineContainers();
  checkEq('gen: engineContainers length', containers.length, 2);
  checkEq('gen: engineContainers ids', containers.map((c) => c.id).join(','), 'w1,e1');
  checkEq('gen: engineContainers names', containers.map((c) => c.name).join(','), 'Weapons,EmptyBox');

  const file = 'tables/flow.json';

  // SUCCESS: repeated token -> two independent rolls (pinned Math.random).
  // Reset history so the 50-entry cap from the history test cannot mask
  // the added entry via truncation (unshift -> 51 -> truncate -> 50).
  T.state.history = [];
  const histBefore = T.state.history.length;
  T.state.genLastRun = null;
  T.state.genLastSuccess = null;
  sandbox.__setRng(seqRng([0.25, 0.75]));
  const successItem = { id: 'g1', name: 'LootGen', template: '[Weapons] and [Weapons]', references: [] };
  T.runGenItem(file, successItem);
  const run = T.state.genLastRun;
  checkEq('gen: success ok', run.ok, true);
  checkEq('gen: success name', run.name, 'LootGen');
  checkEq('gen: success output', run.output, 'Sword and Axe');
  checkEq('gen: success errors empty', run.errors.length, 0);
  checkEq('gen: success rolls length', run.rolls.length, 2);
  checkDeep('gen: success roll #1', run.rolls[0], {
    token: 'Weapons', containerId: 'w1', containerName: 'Weapons',
    entry: { label: 'Sword', weight: 1 }, weight: 1, occurrence: 1, position: 0,
  });
  checkDeep('gen: success roll #2', run.rolls[1], {
    token: 'Weapons', containerId: 'w1', containerName: 'Weapons',
    entry: { label: 'Axe', weight: 1 }, weight: 1, occurrence: 2, position: 14,
  });
  checkEq('gen: success genLastSuccess set', T.state.genLastSuccess != null, true);
  checkEq('gen: success genLastSuccess output', T.state.genLastSuccess.output, 'Sword and Axe');
  const h = T.state.history;
  checkEq('gen: success adds exactly one history entry', h.length - histBefore, 1);
  const genEntry = h[0];
  checkEq('gen: success history kind', genEntry.kind, 'generation');
  checkEq('gen: success history display', genEntry.display, 'Generated: LootGen');
  checkEq('gen: success history value', genEntry.value, 'Sword and Axe');
  checkDeep('gen: success history details deep-equals run.rolls', genEntry.details, run.rolls);

  // MISSING container: no history added, genLastSuccess preserved
  const histBefore2 = T.state.history.length;
  const prevSuccess = T.state.genLastSuccess;
  const missItem = { id: 'g2', name: 'MissingGen', template: '[Nope]', references: [] };
  T.runGenItem(file, missItem);
  const runM = T.state.genLastRun;
  checkEq('gen: missing ok=false', runM.ok, false);
  checkEq('gen: missing error kind', runM.errors.length ? runM.errors[0].kind : null, 'missing');
  checkEq('gen: missing error token', runM.errors.length ? runM.errors[0].token : null, 'Nope');
  checkEq('gen: missing adds no history', T.state.history.length - histBefore2, 0);
  checkEq('gen: missing preserves genLastSuccess', T.state.genLastSuccess, prevSuccess);

  // EMPTY container
  const emptyItem = { id: 'g3', name: 'EmptyGen', template: '[EmptyBox]', references: [] };
  T.runGenItem(file, emptyItem);
  const runE = T.state.genLastRun;
  checkEq('gen: empty ok=false', runE.ok, false);
  checkEq('gen: empty error kind', runE.errors.length ? runE.errors[0].kind : null, 'empty');
  checkEq('gen: empty error token', runE.errors.length ? runE.errors[0].token : null, 'EmptyBox');

  // MALFORMATED: empty token -> kind 'malformed' (the engine's real malformed kind)
  const malItem = { id: 'g4', name: 'MalGen', template: '[]', references: [] };
  T.runGenItem(file, malItem);
  const runX = T.state.genLastRun;
  checkEq('gen: malformed ok=false', runX.ok, false);
  checkEq('gen: malformed error kind', runX.errors.length ? runX.errors[0].kind : null, 'malformed');
  checkEq('gen: malformed error token (empty)', runX.errors.length ? runX.errors[0].token : null, '');

  // Unclosed bracket is PLAIN TEXT (not an error) — documents real engine behavior
  const uncItem = { id: 'g5', name: 'UncGen', template: 'x [unclosed y', references: [] };
  T.runGenItem(file, uncItem);
  const runU = T.state.genLastRun;
  checkEq('gen: unclosed bracket ok (plain text)', runU.ok, true);
  checkEq('gen: unclosed bracket output', runU.output, 'x [unclosed y');

  sandbox.__setRng(sandbox.__origRandom);
}

// ----------------------------------------------- derive() generators branch
{
  T.state.files.clear();
  T.state.files.set('generators/derive.json', {
    text: '',
    parsed: {
      items: [
        { id: 'g1', name: 'NamedGen', template: '[Weapons]', references: [] },
        { id: 'g2', name: '', template: '[Weapons]', references: [] },
        'not an object',
      ],
    },
    error: null,
  });
  T.derive();
  const gens = T.state.generators;
  const warns = T.state.warnings;
  checkEq('derive: generators kept (named + nameless)', gens.length, 2);
  checkEq('derive: named generator name', gens[0] ? gens[0].name : null, 'NamedGen');
  checkEq('derive: nameless generator name empty', gens[1] ? gens[1].name : null, '');
  checkEq('derive: exactly two generator warnings', warns.length, 2);
  const namelessWarn = warns.find((w) => w.message && w.message.indexOf('has no name') !== -1);
  check('derive: nameless warning present', !!namelessWarn);
  checkEq('derive: nameless warning exact string', namelessWarn ? namelessWarn.message : null,
    'Generator #2 has no name; it is kept in memory until this file is next saved.');
  const notObjWarn = warns.find((w) => w.message && w.message.indexOf('is not an object') !== -1);
  check('derive: non-object warning present', !!notObjWarn);
  checkEq('derive: non-object warning exact string', notObjWarn ? notObjWarn.message : null,
    'Generator #3 is not an object; it is ignored.');
}

// ------------------------------------------ template embeds
// resolveEntryEmbeds(label) = generator-engine.resolveEmbed(label, ctx)
// with the app's own ctx: state.macros (name+formula, file order) and
// rollExpression honoring state.rollMode (the roll bar wiring).
{
  T.state.macros = [
    { file: 'dice-macros/test.json', index: 0, name: 'Sword', label: 'Sword', formula: '1d6' },
  ];
  T.state.rollMode = 'normal';

  // ctx shape: macro list reduced to name+formula; evalExpr is a function
  const ctx = T.entryEmbedContext();
  checkDeep('embed ctx: macros reduced to name+formula', ctx.macros, [{ name: 'Sword', formula: '1d6' }]);
  check('embed ctx: evalExpr is a function', typeof ctx.evalExpr === 'function');

  // dice only (no macro match)
  sandbox.__setRng(seqRng([0.25]));
  let r = T.resolveEntryEmbeds('|1d4|');
  checkEq('embed: |1d4| @0.25', r.output, '2');
  checkEq('embed: |1d4| ok', r.ok, true);
  checkDeep('embed: value segment', r.segments, [{ type: 'value', text: '2' }]);

  sandbox.__setRng(seqRng([0.1]));
  r = T.resolveEntryEmbeds('The party finds |2d6+3| gold pieces.');
  checkEq('embed: sentence with |2d6+3| @0.1', r.output, 'The party finds 5 gold pieces.');

  // macro (paren-wrapped formula, case-insensitive, no remainder)
  sandbox.__setRng(seqRng([0.5]));
  r = T.resolveEntryEmbeds('You deal |Sword| damage.');
  checkEq('embed: macro |Sword|', r.output, 'You deal 4 damage.');
  r = T.resolveEntryEmbeds('|sword|');
  checkEq('embed: macro case-insensitive', r.output, '4');

  sandbox.__setRng(seqRng([0.5]));
  r = T.resolveEntryEmbeds('|Sword 1d6|');
  checkEq('embed: macro with remainder -> unresolved', r.ok, false);
  checkEq('embed: remainder error kind', r.errors.length ? r.errors[0].kind : null, 'unresolved');

  // broken macro formula -> invalid-expression with macroName
  T.state.macros = [
    { file: 'dice-macros/test.json', index: 0, name: 'Bad', label: 'Bad', formula: '2d' },
  ];
  sandbox.__setRng(seqRng([0.5]));
  r = T.resolveEntryEmbeds('|Bad|');
  checkEq('embed: broken macro -> ok false', r.ok, false);
  checkEq('embed: broken macro kind', r.errors.length ? r.errors[0].kind : null, 'invalid-expression');
  checkEq('embed: broken macro name carried', r.errors.length ? r.errors[0].macroName : null, 'Bad');

  // unknown token -> unresolved (QA's broken entry)
  T.state.macros = [];
  sandbox.__setRng(seqRng([0.5]));
  r = T.resolveEntryEmbeds('|nosuchmacro99|');
  checkEq('embed: unknown token unresolved', r.ok, false);
  checkEq('embed: unknown token kind', r.errors.length ? r.errors[0].kind : null, 'unresolved');
  checkEq('embed: unknown token carries raw', r.errors.length ? r.errors[0].token : null, '|nosuchmacro99|');

  // empty span -> malformed
  sandbox.__setRng(seqRng([0.5]));
  r = T.resolveEntryEmbeds('a || b');
  checkEq('embed: empty span malformed', r.ok, false);
  checkEq('embed: empty span kind', r.errors.length ? r.errors[0].kind : null, 'malformed');

  // independence: two spans draw in order from one stream
  sandbox.__setRng(seqRng([0.25, 0.75]));
  r = T.resolveEntryEmbeds('|1d4| and |1d4|');
  checkEq('embed: two spans independent', r.output, '2 and 4');

  // roll bar mode flows through: advantage takes the better draw
  sandbox.__setRng(seqRng([0.1, 0.8]));
  T.state.rollMode = 'advantage';
  r = T.resolveEntryEmbeds('|1d20|');
  checkEq('embed: advantage 1d20 (max of two draws)', r.output, '17');
  T.state.rollMode = 'normal';

  T.state.macros = [];
  sandbox.__setRng(sandbox.__origRandom);
}

// ---------------------- template embeds: ((...)) inline spans
// Same wiring as the block above: resolveEntryEmbeds(label) with the app's own ctx
// (no rng field, so picks draw from Math.random, which we patch).
{
  T.state.macros = [];
  T.state.rollMode = 'normal';

  sandbox.__setRng(seqRng([0.5]));
  let r = T.resolveEntryEmbeds('An old ((Gold | Bronze | Silver)) ring.');
  checkEq('inline: ring label picks middle option', r.output, 'An old Bronze ring.');
  checkEq('inline: ring label ok', r.ok, true);
  checkDeep('inline: ring label pick segment', r.segments[1], { type: 'pick', text: 'Bronze' });

  sandbox.__setRng(seqRng([0]));
  checkEq('inline: ring label first option reachable', T.resolveEntryEmbeds('An old ((Gold | Bronze | Silver)) ring.').output, 'An old Gold ring.');
  sandbox.__setRng(seqRng([0.999]));
  checkEq('inline: ring label last option reachable', T.resolveEntryEmbeds('An old ((Gold | Bronze | Silver)) ring.').output, 'An old Silver ring.');

  sandbox.__setRng(seqRng([0.999, 0.5]));
  r = T.resolveEntryEmbeds('((She | He)) was carrying ((1-3)) books.');
  checkEq('inline: pronoun + range in one label', r.output, 'He was carrying 2 books.');
  checkDeep('inline: pronoun + range segment types', r.segments.map((s) => s.type), ['pick', 'text', 'pick', 'text']);

  sandbox.__setRng(seqRng([0.999]));
  checkEq('inline: adjacent 0 concatenates', T.resolveEntryEmbeds('The creature was ((15-20))0 cm tall.').output, 'The creature was 200 cm tall.');
  sandbox.__setRng(seqRng([0]));
  checkEq('inline: range low endpoint reachable', T.resolveEntryEmbeds('The creature was ((15-20))0 cm tall.').output, 'The creature was 150 cm tall.');

  sandbox.__setRng(seqRng([0, 0.999]));
  checkEq('inline: multiple independent inline spans', T.resolveEntryEmbeds('((A|B)) then ((C|D))').output, 'A then D');

 // Weighted inline choice (parity): `label:weight`, default weight 1
  // drawn with the same weighted scheme table entries use; the weight
  // suffix must never reach the output.
  sandbox.__setRng(seqRng([0]));
  r = T.resolveEntryEmbeds('An old ((Gold | Silver:2 | Bronze:3)) ring.');
  checkEq('inline weighted: bug repro outputs the label only (Gold)', r.output, 'An old Gold ring.');
  checkDeep('inline weighted: pick segment carries the label only', r.segments[1], { type: 'pick', text: 'Gold' });
  checkEq('inline weighted: ok', r.ok, true);
  sandbox.__setRng(seqRng([0.25]));
  checkEq('inline weighted: mixed weights pick Silver', T.resolveEntryEmbeds('An old ((Gold | Silver:2 | Bronze:3)) ring.').output, 'An old Silver ring.');
  sandbox.__setRng(seqRng([0.5]));
  checkEq('inline weighted: mixed weights pick Bronze', T.resolveEntryEmbeds('An old ((Gold | Silver:2 | Bronze:3)) ring.').output, 'An old Bronze ring.');
  sandbox.__setRng(seqRng([1]));
  checkEq('inline weighted: rng 1 falls back to the last entry', T.resolveEntryEmbeds('((Gold | Silver:2 | Bronze:3))').output, 'Bronze');
  sandbox.__setRng(seqRng([0.999]));
  checkEq('inline weighted: zero-weight option is skipped', T.resolveEntryEmbeds('((A:0|B))').output, 'B');
  sandbox.__setRng(seqRng([0.5]));
  checkEq('inline weighted: all-zero weights malformed', T.resolveEntryEmbeds('((A:0|B:0))').errors[0].kind, 'malformed');
  checkEq('inline weighted: bad weight kind', T.resolveEntryEmbeds('((A|B:two))').errors[0].kind, 'malformed');
  checkEq('inline weighted: empty option label kind', T.resolveEntryEmbeds('((:1|B))').errors[0].kind, 'malformed');

  // mixed with a dice/macro span: each span draws once, left to right
  T.state.macros = [{ file: 'dice-macros/test.json', index: 0, name: 'Sword', label: 'Sword', formula: '1d6' }];
  sandbox.__setRng(seqRng([0.5, 0.999]));
  r = T.resolveEntryEmbeds('|Sword| ((Gold | Silver))');
  checkEq('inline: macro + choice in one label', r.output, '4 Silver');
  checkDeep('inline: macro + choice segment types', r.segments.map((s) => s.type), ['value', 'text', 'pick']);

  // error cases: no history entry is the UI's job; the engine reports kinds
  T.state.macros = [];
  sandbox.__setRng(seqRng([0.5]));
  r = T.resolveEntryEmbeds('((5-1))');
  checkEq('inline: reversed range kind', r.errors[0].kind, 'reversed-range');
  checkEq('inline: reversed range token', r.errors[0].token, '((5-1))');
  checkEq('inline: reversed range ok false', r.ok, false);
  r = T.resolveEntryEmbeds('((1.5-3))');
  checkEq('inline: invalid range kind', r.errors[0].kind, 'invalid-range');
  r = T.resolveEntryEmbeds('((a||b))');
  checkEq('inline: empty option kind', r.errors[0].kind, 'malformed');
  checkEq('inline: text around a failing span preserved', T.resolveEntryEmbeds('A ((5-1)) B').output, 'A ((5-1)) B');

  sandbox.__setRng(sandbox.__origRandom);
}

/* -------------------------------------------------- [containers]
 * Real wiring: state.files -> derive() -> state.tables -> embedContainers()
 * -> GeneratorEngine.resolveEmbed, with ids read off the raw items.
 */
{
  T.state.files.clear();
  T.state.files.set('tables/p3.json', {
    text: '',
    error: null,
    parsed: {
      items: [
        {
          id: 'tbl_mat', name: 'Materials',
          entries: [{ label: 'Gold', weight: 1 }, { label: 'Silver', weight: 1 }, { label: 'Iron', weight: 1 }],
        },
        { id: 'tbl_wep', name: 'Weapon', entries: [{ label: 'Sword of [material]', weight: 1 }] },
        { id: 'tbl_mtl', name: 'Material', entries: [{ label: 'oak', weight: 1 }] },
        { id: 'tbl_skw', name: 'Skew', entries: [{ label: 'Common', weight: 9 }, { label: 'Rare', weight: 1 }] },
        { id: 'tbl_cyc', name: 'CycA', entries: [{ label: 'A sees [cycb]', weight: 1 }] },
        { id: 'tbl_cy2', name: 'CycB', entries: [{ label: 'B sees [cyca]', weight: 1 }] },
      ],
    },
  });
  T.state.files.set('tables/p3b.json', {
    text: '',
    error: null,
    parsed: {
      items: [
        { id: 'tbl_cb', name: 'Coins', entries: [{ label: 'Platinum', weight: 1 }] },
      ],
    },
  });
  T.derive();
  const FILE = 'tables/p3.json';

  // Local helper mirroring itemsOf in js/storage.js: the probe exposes
  // state.files but not the storage helper itself.
  const itemsOf = (f) => {
    const entry = T.state.files.get(f);
    if (!entry || entry.parsed === null || !Array.isArray(entry.parsed.items)) return [];
    return entry.parsed.items;
  };

  check('p3flow: derive picked up the containers', T.state.tables.length === 7);
  checkEq('p3flow: container ids come from the raw items', T.engineContainers().map((c) => c.id).join(','),
    'tbl_mat,tbl_wep,tbl_mtl,tbl_skw,tbl_cyc,tbl_cy2,tbl_cb');

  sandbox.__setRng(seqRng([0]));
  let r = T.resolveEntryEmbeds('An old [materials] ring.', FILE);
  checkEq('p3flow: An old [materials] ring.', r.output, 'An old Gold ring.');
  checkEq('p3flow: ok', r.ok, true);
  checkDeep('p3flow: ref segment types', r.segments.map((s) => s.type), ['text', 'ref', 'text']);
  checkEq('p3flow: ref carries the derived id', r.segments[1].containerId, 'tbl_mat');

  // two levels: [weapon] -> 'Sword of [material]' -> 'oak'
  sandbox.__setRng(seqRng([0, 0]));
  checkEq('p3flow: two-level chain', T.resolveEntryEmbeds('[weapon]', FILE).output, 'Sword of oak');

  // mixed label: container, container, dice (draws in source order)
  sandbox.__setRng(seqRng([0, 0, 0, 0.5]));
  r = T.resolveEntryEmbeds('A [weapon] made from [material], with |1d4| gems.', FILE);
  checkEq('p3flow: mixed container/dice label', r.output, 'A Sword of oak made from oak, with 3 gems.');
  checkDeep('p3flow: mixed segment types', r.segments.map((s) => s.type),
    ['text', 'ref', 'text', 'ref', 'text', 'value', 'text']);

  // repeated references roll independently
  sandbox.__setRng(seqRng([0, 0.9]));
  checkEq('p3flow: repeated [materials] differs', T.resolveEntryEmbeds('[materials] [materials]', FILE).output,
    'Gold Iron');

  // weights
  sandbox.__setRng(seqRng([0.5]));
  checkEq('p3flow: heavy entry wins at 0.5', T.resolveEntryEmbeds('[skew]', FILE).output, 'Common');
  sandbox.__setRng(seqRng([0.95]));
  checkEq('p3flow: light entry at 0.95', T.resolveEntryEmbeds('[skew]', FILE).output, 'Rare');

  // cycle: fails quickly instead of hanging
  sandbox.__setRng(seqRng([0, 0]));
  r = T.resolveEntryEmbeds('[cyca]', FILE);
  checkEq('p3flow: cycle ok false', r.ok, false);
  checkEq('p3flow: cycle kind', r.errors[0].kind, 'cycle');
  checkDeep('p3flow: cycle chain', r.errors[0].chain, ['CycA', 'CycB']);
  checkEq('p3flow: cycle reports the enclosing container', r.errors[0].containerName, 'CycA');

  // trace: ids, raw labels and depths
  sandbox.__setRng(seqRng([0, 0]));
  r = T.resolveEntryEmbeds('[weapon]', FILE);
  checkEq('p3flow: trace has one node', r.trace.length, 1);
  checkEq('p3flow: trace id', r.trace[0].containerId, 'tbl_wep');
  checkEq('p3flow: trace raw entry label', r.trace[0].entryLabel, 'Sword of [material]');
  checkEq('p3flow: trace depth', r.trace[0].depth, 0);
  checkEq('p3flow: trace child id', r.trace[0].children[0].containerId, 'tbl_mtl');
  checkEq('p3flow: trace child depth', r.trace[0].children[0].depth, 1);

  // label stays raw: resolution never mutates the stored entry
  const rawLabel = itemsOf(FILE)[0].entries[0].label;
  checkEq('p3flow: stored label stays raw', rawLabel, 'Gold');
  checkEq('p3flow: nested source label stays raw', itemsOf(FILE)[1].entries[0].label, 'Sword of [material]');

  // missing after the container is removed from state.tables (UI delete path)
  const removed = T.state.tables.filter((t) => t.name !== 'Materials');
  const kept = T.state.tables;
  T.state.tables = removed;
  sandbox.__setRng(seqRng([0]));
  r = T.resolveEntryEmbeds('An old [materials] ring.', FILE);
  checkEq('p3flow: deleted container -> missing', r.errors[0].kind, 'missing-container');
  checkEq('p3flow: missing message names the token', r.errors[0].containerName, 'materials');
  checkEq('p3flow: missing keeps the rest of the label', r.output, 'An old [materials] ring.');
  T.state.tables = kept;

  // same-name container in two files prefers the entry's own file
  sandbox.__setRng(seqRng([0]));
  checkEq('p3flow: same-file preference', T.resolveEntryEmbeds('[coins]', 'tables/p3b.json').output, 'Platinum');
  sandbox.__setRng(seqRng([0]));
  r = T.resolveEntryEmbeds('[coins]', 'tables/none.json');
  checkEq('p3flow: one global candidate falls back', r.output, 'Platinum');

  // a failing label never throws and yields no ref segments (the roll handler
  // uses ok to skip the history entry)
  sandbox.__setRng(seqRng([0]));
  r = T.resolveEntryEmbeds('[nope]', FILE);
  checkEq('p3flow: missing container ok false', r.ok, false);
  checkEq('p3flow: missing container has no ref segments',
    r.segments.filter((s) => s.type === 'ref').length, 0);
  checkEq('p3flow: trace is empty for a failed ref', r.trace.length, 0);

  sandbox.__setRng(sandbox.__origRandom);
}

// ------------------------------------------------- "+ new file" creation flow
// The three "+ new file" buttons now ask for a name through the in-page
// askText dialog (js/toasts.js) and create through createNew*File. The dialog
// needs a DOM, so the harness drives the create functions directly, with a
// minimal in-memory storage adapter mirroring the server adapter's contract
// (js/storage.js: 409 -> Error('File already exists')). renderAll and toast
// are probed as no-op/capture above (no DOM in the harness).
function runNewFileChecks() {
  return (async () => {
    const memFiles = new Map();
    T.state.storage = {
      mode: 'test',
      async createFile(p, text) {
        if (memFiles.has(p)) throw new Error('File already exists');
        memFiles.set(p, text);
      },
    };
    const DEFAULT_TEXT = JSON.stringify({ items: [] }, null, 2) + '\n';
    const lastToast = () => (sandbox.__toastLog.length ? sandbox.__toastLog[sandbox.__toastLog.length - 1] : null);
    const clearToasts = () => { sandbox.__toastLog.length = 0; };
    const flows = [
      { fn: 'createNewTableFile', prefix: 'tables/' },
      { fn: 'createNewMacroFile', prefix: 'dice-macros/' },
      { fn: 'createNewGenFile', prefix: 'generators/' },
    ];
    for (const { fn, prefix } of flows) {
      const create = T[fn];

      // valid name: sanitized path, exact default content, success toast
      clearToasts();
      await create('My Loot File');
      const p = prefix + 'my-loot-file.json';
      check('newfile: ' + fn + ' creates the file at the sanitized path', T.state.files.has(p));
      checkEq('newfile: ' + fn + ' file has the exact default content',
        T.state.files.has(p) ? T.state.files.get(p).text : null, DEFAULT_TEXT);
      checkEq('newfile: ' + fn + ' success toast', lastToast() ? lastToast()[0] : null, 'Created ' + p);

      // derive() keeps the new empty file in state and adds no containers
      T.derive();
      check('newfile: ' + fn + ' derive keeps the new empty file in state',
        T.state.files.has(p) && T.state.tables.filter((t) => t.file === p).length === 0);

      // a name that sanitizes to empty creates nothing
      const sizeBefore = memFiles.size;
      clearToasts();
      await create('...');
      checkEq('newfile: ' + fn + ' unusable name leaves storage untouched', memFiles.size, sizeBefore);
      checkEq('newfile: ' + fn + ' unusable name error toast', lastToast() ? lastToast()[0] : null,
        'That file name is not usable.');

      // a duplicate path surfaces the existing-path error and leaves state unchanged
      clearToasts();
      await create('my-loot-file');
      checkEq('newfile: ' + fn + ' duplicate surfaces the existing-path error', lastToast() ? lastToast()[0] : null,
        'File already exists');
      checkEq('newfile: ' + fn + ' duplicate leaves the file content unchanged',
        T.state.files.has(p) ? T.state.files.get(p).text : null, DEFAULT_TEXT);

      // spaces/special chars sanitize into a usable file name
      await create('My Loot: Set*');
      check('newfile: ' + fn + ' spaces/special chars sanitize to a usable name',
        T.state.files.has(prefix + 'my-loot-set.json'));
    }

    // sanitizeFileName (exported for the new-file handlers)
    checkEq('newfile: sanitizeFileName strips a dots-only name', T.sanitizeFileName('...'), '');
    checkEq('newfile: sanitizeFileName lowercases, dashes spaces, strips specials',
      T.sanitizeFileName('My Loot: Set*'), 'my-loot-set');

    T.state.storage = null;
  })();
}

// ------------------------------------- generator embeds end-to-end
// The Generators tab now passes the shared embed context (js/templates.js
// entryEmbedContext) as runGenerator's 4th argument, so a template-level
// `|dice|`/`((inline))` span AND a span inside a picked label resolve with the
// real macros/containers, engineContainers carries each container's file, and
// the success panel renders the engine's segment list. Raw text stays raw.
{
  T.state.history = [];
  T.state.genLastRun = null;
  T.state.genLastSuccess = null;
  T.state.rollMode = 'normal';
  T.state.macros = [
    { file: 'dice-macros/starter-macros.json', index: 0, name: 'Sword', label: 'Sword', formula: '1d6' },
  ];
  const lootEntries = [
    { label: '|2d3| throwing knives', weight: 1 },
    { label: 'a rusted key |sword|', weight: 1 },
  ];
  const tableFile = 'tables/p4loot.json';
  const genFile = 'generators/p4.json';
  const genText = '{"items":[]}';
  T.state.files.clear();
  T.state.files.set(tableFile, {
    text: '{"items":[{"id":"p4w","name":"Loot","entries":[]}]}',
    parsed: { items: [{ id: 'p4w', name: 'Loot', entries: lootEntries }] },
    error: null,
  });
  T.state.files.set(genFile, { text: genText, parsed: { items: [] }, error: null });
  T.state.tables = [{ file: tableFile, index: 0, name: 'Loot', entries: lootEntries }];

  checkEq('p4 gen: engineContainers carries the container file',
    T.engineContainers()[0].file, tableFile);

  // User example 1 — a template-level dice span.
  sandbox.__setRng(seqRng([0.5, 0.5]));
  const knives = { id: 'p4a', name: 'Knives', template: 'You found |2d3| throwing knives.', references: [] };
  T.runGenItem(genFile, knives);
  const runA = T.state.genLastRun;
  checkEq('p4 gen: knives ok', runA.ok, true);
  checkEq('p4 gen: knives exact output', runA.output, 'You found 4 throwing knives.');
  checkDeep('p4 gen: knives segments are the rendered values', runA.segments, [
    { type: 'text', text: 'You found ' },
    { type: 'value', text: '4' },
    { type: 'text', text: ' throwing knives.' },
  ]);
  checkDeep('p4 gen: history details deep-equal the rolls', T.state.history[0].details, runA.rolls);
  checkEq('p4 gen: history value is the output', T.state.history[0].value, runA.output);
  checkDeep('p4 gen: genLastSuccess keeps the segments', T.state.genLastSuccess.segments, runA.segments);
  check('p4 gen: ref-free run trace is an array', Array.isArray(runA.trace) && runA.trace.length === 0);
  checkEq('p4 gen: item.template unchanged', knives.template, 'You found |2d3| throwing knives.');
  checkEq('p4 gen: file text unchanged', T.state.files.get(genFile).text, genText);

  // User example 2 — a macro span and a dice span in one template.
  sandbox.__setRng(seqRng([0.5, 0.5]));
  const attack = {
    id: 'p4b', name: 'Attack',
    template: 'You attack with |Sword| and deal |1d6| bonus damage.', references: [],
  };
  T.runGenItem(genFile, attack);
  const runB = T.state.genLastRun;
  checkEq('p4 gen: macro + dice exact output', runB.output,
    'You attack with 4 and deal 4 bonus damage.');
  checkDeep('p4 gen: macro + dice segment types', runB.segments.map((s) => s.type),
    ['text', 'value', 'text', 'value', 'text']);
  checkEq('p4 gen: macro run adds its own history entry', T.state.history[0].value, runB.output);

  // A picked label resolves through the same context (ctx flows into labels).
  sandbox.__setRng(seqRng([0.1, 0.5, 0.5])); // pick #1, then 2d3
  const loot = { id: 'p4c', name: 'Loot', template: 'You found [loot].', references: [] };
  T.runGenItem(genFile, loot);
  const runC = T.state.genLastRun;
  checkEq('p4 gen: ref + label embed output', runC.output, 'You found 4 throwing knives.');
  checkEq('p4 gen: one roll for one token', runC.rolls.length, 1);
  checkEq('p4 gen: ref segment type', runC.segments[1].type, 'ref');
  checkEq('p4 gen: ref segment text is the resolved label', runC.segments[1].text, '4 throwing knives');
  checkEq('p4 gen: trace has one template node', runC.trace.length, 1);
  checkEq('p4 gen: template ref trace depth is 0', runC.trace[0].depth, 0);
  checkEq('p4 gen: trace records the raw entry label', runC.trace[0].entryLabel, '|2d3| throwing knives');
  // The success snapshot and history entry for a run that actually rolled.
  checkDeep('p4 gen: genLastSuccess keeps the ref segments', T.state.genLastSuccess.segments, runC.segments);
  checkDeep('p4 gen: genLastSuccess keeps the ref trace', T.state.genLastSuccess.trace, runC.trace);
  checkDeep('p4 gen: history details deep-equal the ref run rolls',
    T.state.history[0].details, runC.rolls);

  // A macro inside a picked label (name match is case-insensitive).
  sandbox.__setRng(seqRng([0.9, 0.5])); // pick #2, then |sword|
  T.runGenItem(genFile, loot);
  checkEq('p4 gen: macro inside a picked label', T.state.genLastRun.output, 'You found a rusted key 4.');

  // A template-level inline span uses the same rng.
  sandbox.__setRng(seqRng([0.99]));
  const inline = {
    id: 'p4e', name: 'Inline',
    template: 'You find ((Gold | Silver | Bronze)).', references: [],
  };
  T.runGenItem(genFile, inline);
  checkEq('p4 gen: template inline pick', T.state.genLastRun.output, 'You find Bronze.');

  // A weighted inline span in a template: same engine path as the Tables
  // tab, so the weight suffix must not leak into the generator output.
  sandbox.__setRng(seqRng([0.25]));
  const weightedInline = {
    id: 'p4i', name: 'Weighted Inline',
    template: 'You find ((Gold | Silver:2 | Bronze:3)).', references: [],
  };
  T.runGenItem(genFile, weightedInline);
  checkEq('p4 gen: template weighted inline pick', T.state.genLastRun.output, 'You find Silver.');
  checkEq('p4 gen: template weighted inline ok', T.state.genLastRun.ok, true);

  // An inline span inside a picked label.
  const things = [{ label: 'a ((Red|Blue)) gem', weight: 1 }];
  T.state.files.get(tableFile).parsed.items.push({ id: 'p4t', name: 'Things', entries: things });
  T.state.tables.push({ file: tableFile, index: 1, name: 'Things', entries: things });
  sandbox.__setRng(seqRng([0, 0.9]));
  const gem = { id: 'p4f', name: 'Gem', template: 'Bag: [things]', references: [] };
  T.runGenItem(genFile, gem);
  checkEq('p4 gen: inline inside a picked label', T.state.genLastRun.output, 'Bag: a Blue gem');

  // Error path: no history entry, last success preserved, no segments/trace.
  const histBefore = T.state.history.length;
  const prevSuccess = T.state.genLastSuccess;
  sandbox.__setRng(seqRng([0.5]));
  const bad = { id: 'p4g', name: 'Bad', template: 'You found |nope| knives.', references: [] };
  T.runGenItem(genFile, bad);
  const runF = T.state.genLastRun;
  checkEq('p4 gen: embed error ok=false', runF.ok, false);
  checkEq('p4 gen: embed error kind', runF.errors[0].kind, 'unresolved');
  checkEq('p4 gen: embed error token', runF.errors[0].token, '|nope|');
  checkEq('p4 gen: embed error adds no history', T.state.history.length - histBefore, 0);
  checkEq('p4 gen: embed error preserves genLastSuccess', T.state.genLastSuccess, prevSuccess);
  checkEq('p4 gen: failed run output is empty', runF.output, '');
  checkDeep('p4 gen: failed run keeps no segments', runF.segments, []);
  checkDeep('p4 gen: failed run keeps no trace', runF.trace, []);

  // Every kind has a message (10 shared + the generator-validation kinds).
  const SHARED_KINDS = ['unresolved', 'invalid-expression', 'malformed', 'invalid-range',
    'reversed-range', 'missing-container', 'ambiguous-container', 'empty-container',
    'cycle', 'nesting-limit'];
  check('p4 gen: all 10 shared kinds produce a message', SHARED_KINDS.every((k) => {
    const m = T.genErrorMessage({
      kind: k, token: '|x|', chain: ['A'], macroName: 'M', containerName: 'C',
    });
    return typeof m === 'string' && m.length > 0 && m.indexOf('undefined') === -1;
  }));
  check('p4 gen: validation kinds name the token', ['missing', 'ambiguous', 'empty'].every((k) => {
    const m = T.genErrorMessage({ kind: k, token: 'Nope' });
    return typeof m === 'string' && m.indexOf('Nope') !== -1 && m.indexOf('undefined') === -1;
  }));
  checkEq('p4 gen: an unknown kind still yields a message',
    T.genErrorMessage({ kind: 'weird', token: 'X' }),
    'Entry embed error: "X" could not be resolved');
  checkEq('p4 gen: the engine-catch malformed has a message',
    T.genErrorMessage({ kind: 'malformed', token: '', occurrences: [] }),
    'Generator error: this template could not be run.');
  // An empty `[]` token is validateGenerator's malformed: same kind and token as
  // the catch shape, but it carries occurrences and must read differently.
  T.runGenItem(genFile, { id: 'p4h', name: 'EmptyTok', template: 'You find a [] key.', references: [] });
  const runH = T.state.genLastRun;
  checkEq('p4 gen: empty [] token ok=false', runH.ok, false);
  checkEq('p4 gen: empty [] token kind', runH.errors[0].kind, 'malformed');
  checkEq('p4 gen: empty [] token gets the template wording',
    T.genErrorMessage(runH.errors[0]),
    'Generator error: the template has an empty [] token - put a container name between the brackets.');
  checkEq('p4 gen: missing uses generator wording',
    T.genErrorMessage({ kind: 'missing', token: 'Nope' }),
    'Generator error: no container named "Nope" - create a container with that name or fix the token.');
  checkEq('p4 gen: shared kinds keep the exact table wording',
    T.genErrorMessage({ kind: 'missing-container', token: '[x]', containerName: 'X' }),
    'Entry embed error: container "X" not found - create a container with that name or reference an existing one');
  checkEq('p4 gen: entry unresolved wording unchanged',
    T.embedErrorMessage({ kind: 'unresolved', token: '|1d|' }),
    'Entry embed error: "|1d|" is not a macro or a valid dice expression');
  checkEq('p4 gen: entry cycle wording unchanged',
    T.embedErrorMessage({ kind: 'cycle', token: '[a]', containerName: 'A', chain: ['A', 'B'] }),
    'Entry embed error: circular container reference [A] -> [B] -> [A] - remove one reference to break the loop');
  checkEq('p4 gen: entry malformed wording unchanged (pipe)',
    T.embedErrorMessage({ kind: 'malformed', token: '||' }),
    'Entry embed error: empty dice/macro reference "||"');
  checkEq('p4 gen: entry malformed wording covers invalid weights (inline)',
    T.embedErrorMessage({ kind: 'malformed', token: '(( ))' }),
    'Entry embed error: empty inline expression, empty option, or invalid option weight in "(( ))"');
  checkEq('p4 gen: entry nesting-limit wording unchanged (chain)',
    T.embedErrorMessage({ kind: 'nesting-limit', token: '[x]', containerName: 'X', chain: ['A'] }),
    'Entry embed error: container references exceeded the nesting budget (depth 8, 1000 picks, or 100,000 characters) - simplify the chain (inside [A])');
  // the new operation kinds surface through the same shared
  // mapper. op-cycle names the cycle path (no container-style suffix);
  // missing-import names the variable; nesting-limit keeps the general
  // sentence only when no specific limit was named.
  checkEq('p4 gen: entry op-cycle wording names the cycle path (fallback)',
    T.embedErrorMessage({ kind: 'op-cycle', token: '{A}', operationName: 'A', chain: ['A', 'B', 'A'] }),
    'Entry embed error: circular operation reference "A" -> "B" -> "A" - remove one call to break the loop');
  checkEq('p4 gen: entry op-cycle wording uses the engine diagnostic when present',
    T.embedErrorMessage({ kind: 'op-cycle', token: '{A}', operationName: 'A', chain: ['B', 'C', 'B'], message: 'circular operation reference "B" -> "C" -> "B" - remove one call to break the loop' }),
    'Entry embed error: circular operation reference "B" -> "C" -> "B" - remove one call to break the loop');
  checkEq('p4 gen: entry missing-import wording names the variable (engine diagnostic)',
    T.embedErrorMessage({ kind: 'missing-import', token: '{A}', operationName: 'A', varName: 'x', message: 'IMPORT "x" has no value in this generator run \u2014 no earlier part of the run supplied it' }),
    'Entry embed error: IMPORT "x" has no value in this generator run \u2014 no earlier part of the run supplied it');
  checkEq('p4 gen: entry missing-import fallback names the variable',
    T.embedErrorMessage({ kind: 'missing-import', token: '{A}', operationName: 'A', varName: 'x' }),
    'Entry embed error: the imported value for %x% is missing - supply it for this run');
  checkEq('p4 gen: entry nesting-limit names the specific limit when the engine supplies one',
    T.embedErrorMessage({ kind: 'nesting-limit', token: '{E}', operationName: 'E', message: 'nested operation depth exceeded 4 levels' }),
    'Entry embed error: nested operation depth exceeded 4 levels');
  checkEq('p4 gen: generator op-cycle surfaces the same shared wording',
    T.genErrorMessage({ kind: 'op-cycle', token: '{A}', operationName: 'A', chain: ['A', 'B', 'A'] }),
    'Entry embed error: circular operation reference "A" -> "B" -> "A" - remove one call to break the loop');
  checkEq('p4 gen: generator missing-import surfaces the same shared wording',
    T.genErrorMessage({ kind: 'missing-import', token: '{A}', operationName: 'A', varName: 'x', message: 'IMPORT "x" has no value in this generator run \u2014 no earlier part of the run supplied it' }),
    'Entry embed error: IMPORT "x" has no value in this generator run \u2014 no earlier part of the run supplied it');

  sandbox.__setRng(sandbox.__origRandom);
}

// ---------------------------------- template autocomplete helpers
// The template field now has two autocompletes: `[` (containers, unchanged) and
// `|` (macros + dice presets). The DOM-free half is testable here: the unclosed
// span scanner the two triggers share, and the `|` candidate list. The menu,
// the keyboard flow and the highlight layer are DOM-only and covered by browser
// QA.
{
  const span = T.unclosedSpanAt;
  checkDeep('ac: [ token under the caret', span('You found [Ch', 13, '[', ']'),
    { open: 10, inner: 'Ch' });
  checkEq('ac: [ token when already closed is null', span('[Chest]', 7, '[', ']'), null);
  checkEq('ac: [ token before the bracket is null', span('[Chest]', 0, '[', ']'), null);
  checkEq('ac: [ token with no bracket in the text is null', span('plain text', 10, '[', ']'), null);
  checkDeep('ac: [ token uses the LAST open bracket', span('[a] and [B', 10, '[', ']'),
    { open: 8, inner: 'B' });
  checkEq('ac: [ token stops at a close bracket', span('[a [b]', 7, '[', ']'), null);

  checkDeep('ac: | token under the caret', span('You found |2d', 13, '|', '|'),
    { open: 10, inner: '2d' });
  checkDeep('ac: | token after a closed span', span('|2d3| and |Sw', 13, '|', '|'),
    { open: 10, inner: 'Sw' });
  checkEq('ac: | token when already closed is null', span('|2d3|', 5, '|', '|'), null);
  checkEq('ac: | token stays closed right after an inserted span', span('|Sword|', 7, '|', '|'), null);
  checkDeep('ac: | token reopens on a new pipe', span('|a| |', 5, '|', '|'), { open: 4, inner: '' });
  checkDeep('ac: | token is empty right after the pipe', span('roll |', 6, '|', '|'),
    { open: 5, inner: '' });
  checkEq('ac: | caret past the end clamps', span('|2d', 99, '|', '|').inner, '2d');
  checkEq('ac: | negative caret is null', span('|2d', -3, '|', '|'), null);

  const macros = [
    { file: 'dice-macros/starter-macros.json', index: 0, name: 'Sword', label: 'Sword', formula: '1d6' },
    { file: 'dice-macros/starter-macros.json', index: 1, name: 'Axe', label: 'Axe', formula: '1d12' },
  ];
  checkDeep('ac: empty query offers dice first, then macros',
    T.pipeSuggestItems('', macros, ['1d4', '1d6']), [
      { text: '1d4', hint: 'dice' },
      { text: '1d6', hint: 'dice' },
      { text: 'Sword', hint: 'macro' },
      { text: 'Axe', hint: 'macro' },
    ]);
  // The seeded data already has 8 macros; the six presets must still be offered
  // (they are the fixed, always-useful half of the list).
  checkEq('ac: all six presets survive a full macro list', (() => {
    const eight = [];
    for (let i = 0; i < 8; i += 1) eight.push({ name: 'Seeded' + i });
    const dense = T.pipeSuggestItems('', eight, T.GEN_DICE_PRESETS);
    return dense.filter((s) => s.hint === 'dice').length;
  })(), 6);
  checkEq('ac: a full macro list still caps the menu at 8', (() => {
    const eight = [];
    for (let i = 0; i < 8; i += 1) eight.push({ name: 'Seeded' + i });
    return T.pipeSuggestItems('', eight, T.GEN_DICE_PRESETS).length;
  })(), 8);
  checkDeep('ac: a deep macro still beats the cap when typed',
    T.pipeSuggestItems('seeded5', (() => {
      const eight = [];
      for (let i = 0; i < 8; i += 1) eight.push({ name: 'Seeded' + i });
      return eight;
    })(), T.GEN_DICE_PRESETS),
    [{ text: 'Seeded5', hint: 'macro' }]);
  checkDeep('ac: prefix filter is case-insensitive',
    T.pipeSuggestItems('sw', macros, ['1d6']), [{ text: 'Sword', hint: 'macro' }]);
  checkDeep('ac: a dice query filters to the presets',
    T.pipeSuggestItems('1d', macros, ['1d4', '1d6', '1d20']).map((s) => s.text),
    ['1d4', '1d6', '1d20']);
  checkDeep('ac: a preset shadows an identical macro name',
    T.pipeSuggestItems('', [{ name: '1d6' }], ['1d6', '1d8']),
    [{ text: '1d6', hint: 'dice' }, { text: '1d8', hint: 'dice' }]);
  checkEq('ac: the list caps at 8', (() => {
    const ten = [];
    for (let i = 0; i < 10; i += 1) ten.push({ name: 'Macro' + i });
    return T.pipeSuggestItems('', ten, []).length;
  })(), 8);
  checkDeep('ac: a macro row without a name falls back to its label',
    T.pipeSuggestItems('', [{ label: 'LabelOnly' }], []), [{ text: 'LabelOnly', hint: 'macro' }]);
  checkDeep('ac: blank and non-object macro rows are skipped',
    T.pipeSuggestItems('', [null, { name: '  ' }, { name: 'Ok' }], []), [{ text: 'Ok', hint: 'macro' }]);
  checkDeep('ac: no match yields an empty list', T.pipeSuggestItems('zz', macros, ['1d6']), []);
  checkDeep('ac: presets default to the six dice', T.pipeSuggestItems('', []).map((s) => s.text),
    ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20']);
  checkDeep('ac: the six dice presets are exposed', T.GEN_DICE_PRESETS,
    ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20']);
}

// ------------------------------------------------- logic tab (step 2)
// js/logic-ops.js is a data-management shell: create / rename / delete
// logic-ops/*.json files, create / select / edit operations, and a search
// filter. The DOM-only parts (askText, confirm, renderAll) are probed away
// above, so the harness drives the storage-backed functions directly with an
// in-memory adapter mirroring the server contract (js/storage.js: createFile
// throws Error('File already exists') on a 409, writeFile overwrites,
// deleteFile removes). derive's logic-ops branch and ensureOperationIds come
// from the step-1 engine in js/storage.js.
function runLogicChecks() {
  return (async () => {
    const memFiles = new Map();
    const writes = [];
    T.state.storage = {
      mode: 'test',
      async createFile(p, text) {
        if (memFiles.has(p)) throw new Error('File already exists');
        memFiles.set(p, text);
      },
      async writeFile(p, text) {
        writes.push([p, text]);
        memFiles.set(p, text);
      },
      async deleteFile(p) {
        memFiles.delete(p);
      },
    };
    const DEFAULT_TEXT = JSON.stringify({ items: [] }, null, 2) + '\n';
    const lastToast = () => (sandbox.__toastLog.length ? sandbox.__toastLog[sandbox.__toastLog.length - 1] : null);
    const clearToasts = () => { sandbox.__toastLog.length = 0; };

    // --- derive: the logic-ops branch (js/storage.js:428-466) ---
    T.state.files.clear();
    const flowText = JSON.stringify({ items: [
      { id: 'op_aaaa1111', name: 'Attack', purpose: 'hit', script: 'IMPORT %a%' },
      { id: 'op_bbbb2222', name: 'Door', script: '' },
      { id: 'op_cccc3333', name: 'Door', script: 'EXPOSE a' },
      { name: 'Orphan', script: 'SET a = 1' },
      { script: 'SET b = 2' },
      { name: 'NoScript' },
    ] }, null, 2) + '\n';
    T.state.files.set('logic-ops/flow.json', { text: flowText, parsed: JSON.parse(flowText), error: null });
    T.derive();
    checkEq('logic: derive lists the four complete operations', T.state.logicOps.length, 4);
    checkDeep('logic: an op carries file/index/id/name/purpose/script/outputTemplate/config', T.state.logicOps[0],
      { file: 'logic-ops/flow.json', index: 0, id: 'op_aaaa1111', name: 'Attack', purpose: 'hit', script: 'IMPORT %a%', outputTemplate: '', config: {} });
    checkEq('logic: a missing purpose derives to an empty string', T.state.logicOps[1].purpose, '');
    checkDeep('logic: a missing config derives to an empty object', T.state.logicOps[1].config, {});
    checkEq('logic: an op without an id derives with an empty id', T.state.logicOps[3].id, '');
    check('logic: a duplicate operation name raises a dup warning',
      T.state.warnings.some((w) => w.kind === 'dup' && w.what === 'operation' && w.name === 'Door' && w.path === 'logic-ops/flow.json'));
    const opItemWarns = T.state.warnings.filter((w) => w.kind === 'item' && w.path === 'logic-ops/flow.json');
    checkEq('logic: exactly one row without a script is flagged', opItemWarns.length, 1);
    check('logic: the incomplete-op warning asks for a script',
      opItemWarns.length === 1 && /has no code/.test(opItemWarns[0].message));

    // --- ensureOperationIds: 13b migration (js/storage.js:474-493) ---
    T.state.files.clear();
    writes.length = 0;
    const seedPath = 'logic-ops/seed.json';
    const seedText = JSON.stringify({ items: [
      { name: 'Alpha', script: 'SET a = 1' },
      { id: 'op_keepkeep', name: 'Beta', script: 'SET b = 2' },
    ] }, null, 2) + '\n';
    T.state.files.set(seedPath, { text: seedText, parsed: JSON.parse(seedText), error: null });
    sandbox.__setRng(seqRng([0.5, 0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4]));
    await T.ensureOperationIds(seedPath);
    const seedItems = T.state.files.get(seedPath).parsed.items;
    check('logic: ensureOperationIds assigns an op_ id to the idless op', /^op_[0-9a-f]{8}$/.test(seedItems[0].id));
    checkEq('logic: an existing op id is kept untouched', seedItems[1].id, 'op_keepkeep');
    checkEq('logic: the migrated file is written exactly once', writes.length, 1);
    checkEq('logic: the written bytes carry the new id',
      writes.length === 1 ? JSON.parse(writes[0][1]).items[0].id : null, seedItems[0].id);
    checkEq('logic: the state entry text matches the written bytes',
      writes.length === 1 && T.state.files.get(seedPath).text === writes[0][1], true);
    await T.ensureOperationIds(seedPath);
    checkEq('logic: a second ensure pass writes nothing', writes.length, 1);
    // the seed file was a migration fixture, not part of the tab scenario
    memFiles.delete(seedPath);

    // --- create: createNewLogicOpsFile (js/logic-ops.js:24-41) ---
    T.state.files.clear();
    writes.length = 0;
    clearToasts();
    await T.createNewLogicOpsFile('My Logic File');
    const logicPath = 'logic-ops/my-logic-file.json';
    check('logic: create stores the file in state', T.state.files.has(logicPath));
    check('logic: create stores the file in storage', memFiles.has(logicPath));
    checkEq('logic: the created file has the exact default content',
      T.state.files.has(logicPath) ? T.state.files.get(logicPath).text : null, DEFAULT_TEXT);
    checkEq('logic: create success toast', lastToast() ? lastToast()[0] : null, 'Created ' + logicPath);
    checkEq('logic: an empty items file derives to no operations', T.state.logicOps.length, 0);

    const sizeBefore = memFiles.size;
    clearToasts();
    await T.createNewLogicOpsFile('   ');
    checkEq('logic: a blank name leaves storage untouched', memFiles.size, sizeBefore);
    checkEq('logic: a blank name error toast', lastToast() ? lastToast()[0] : null,
      'That file name is not usable.');

    clearToasts();
    await T.createNewLogicOpsFile('my-logic-file');
    checkEq('logic: a duplicate name surfaces the existing-path error', lastToast() ? lastToast()[0] : null,
      'File already exists');
    checkEq('logic: the duplicate leaves the original intact',
      T.state.files.get(logicPath).text, DEFAULT_TEXT);

    await T.createNewLogicOpsFile('My Logic: Set*');
    check('logic: spaces/special chars sanitize to a usable name', memFiles.has('logic-ops/my-logic-set.json'));

    // --- rename: renameLogicOpsFile (js/logic-ops.js:49-80) ---
    // No backend has a rename endpoint: the shell creates the new path with
    // the old bytes and deletes the old one.
    const oldPath = 'logic-ops/old-name.json';
    memFiles.set(oldPath, DEFAULT_TEXT);
    T.state.files.set(oldPath, { text: DEFAULT_TEXT, parsed: JSON.parse(DEFAULT_TEXT), error: null });
    T.state.logicFile = oldPath;
    clearToasts();
    await T.renameLogicOpsFile(oldPath, 'renamed target');
    const newPath = 'logic-ops/renamed-target.json';
    check('logic: rename moves the file in state', T.state.files.has(newPath) && !T.state.files.has(oldPath));
    check('logic: rename moves the file in storage', memFiles.has(newPath) && !memFiles.has(oldPath));
    checkEq('logic: rename preserves the file content',
      T.state.files.has(newPath) ? T.state.files.get(newPath).text : null, DEFAULT_TEXT);
    checkEq('logic: rename updates the selected file', T.state.logicFile, newPath);
    checkEq('logic: rename success toast', lastToast() ? lastToast()[0] : null,
      'Renamed ' + oldPath + ' to ' + newPath);

    clearToasts();
    await T.renameLogicOpsFile(newPath, '   ');
    checkEq('logic: a blank rename is rejected', lastToast() ? lastToast()[0] : null,
      'That file name is not usable.');

    clearToasts();
    await T.renameLogicOpsFile(newPath, 'renamed-target');
    checkEq('logic: renaming to the same name is a no-op', lastToast(), null);

    clearToasts();
    await T.renameLogicOpsFile(newPath, 'my-logic-file');
    checkEq('logic: renaming onto an existing file is rejected', lastToast() ? lastToast()[0] : null,
      'A file named logic-ops/my-logic-file.json already exists.');

    // --- delete: deleteLogicOpsFile (js/logic-ops.js:89-103) ---
    const delPath = 'logic-ops/my-logic-set.json';
    T.state.logicFile = delPath;
    T.state.logicOp = { id: 'op_deadbeef', name: 'Doomed', script: 'SET d = 1' };
    clearToasts();
    await T.deleteLogicOpsFile(delPath);
    check('logic: delete removes the file from state', !T.state.files.has(delPath));
    check('logic: delete removes the file from storage', !memFiles.has(delPath));
    checkEq('logic: delete clears the selected file', T.state.logicFile, null);
    checkEq('logic: delete clears the selected operation', T.state.logicOp, null);
    checkEq('logic: delete success toast', lastToast() ? lastToast()[0] : null, 'Deleted ' + delPath);

    // --- persistence: named script rows only (persistLogicOpsFile) + reload ---
    const opsPath = 'logic-ops/ops.json';
    memFiles.set(opsPath, DEFAULT_TEXT);
    T.state.files.clear();
    T.state.files.set(opsPath, { text: DEFAULT_TEXT, parsed: JSON.parse(DEFAULT_TEXT), error: null });
    T.state.logicFile = opsPath;
    T.state.logicOp = null;
    writes.length = 0;
    const scriptItem = { id: 'op_attack01', name: 'Attack roll', purpose: 'roll to hit', script: 'SET a = 1' };
    const unnamedItem = { id: 'op_unnamed1', name: '', purpose: '', script: '' };
    T.state.files.get(opsPath).parsed.items.push(scriptItem, unnamedItem);
    await T.persistLogicOpsFile(opsPath);
    checkEq('logic: persist writes the file exactly once', writes.length, 1);
    checkEq('logic: only the named row is written to disk',
      writes.length === 1 ? JSON.parse(writes[0][1]).items.length : null, 1);
    checkDeep('logic: the named row is written verbatim',
      writes.length === 1 ? JSON.parse(writes[0][1]).items[0] : null, scriptItem);
    checkEq('logic: the unnamed row stays in memory',
      T.state.files.get(opsPath).parsed.items.length, 2);
    T.derive();
    check('logic: derive lists the named script op without an item warning',
      T.state.logicOps.length === 1 && !('type' in T.state.logicOps[0])
        && !T.state.warnings.some((w) => w.kind === 'item' && w.path === opsPath));

    // --- simulated reload: state rebuilt from the disk bytes only ---
    T.state.files.clear();
    T.state.logicFile = null;
    T.state.logicOp = null;
    for (const [p, text] of memFiles) {
      T.state.files.set(p, { text, parsed: JSON.parse(text), error: null });
    }
    T.derive();
    checkEq('logic: after a reload the committed op survives from disk', T.state.logicOps.length, 1);
    checkEq('logic: the reloaded op keeps its name and script',
      T.state.logicOps.length === 1 ? T.state.logicOps[0].name + '|' + T.state.logicOps[0].script : null,
      'Attack roll|SET a = 1');

    // --- search: filterLogicOps (js/logic-ops.js:138-143) ---
    T.state.files.clear();
    const searchPath = 'logic-ops/search.json';
    const searchItems = [
      { id: 'op_a1a1a1a1', name: 'Attack roll', purpose: 'roll to hit' },
      { id: 'op_b2b2b2b2', name: 'Open door', purpose: '' },
      { id: 'op_c3c3c3c3', name: 'Trap', purpose: 'check dexterity' },
    ];
    T.state.files.set(searchPath, {
      text: JSON.stringify({ items: searchItems }, null, 2) + '\n',
      parsed: { items: searchItems },
      error: null,
    });
    check('logic: an empty query returns the full list unchanged',
      T.filterLogicOps(searchItems, '') === searchItems);
    const qAttack = T.filterLogicOps(searchItems, 'attack');
    check('logic: a name match filters case-insensitively', qAttack.length === 1 && qAttack[0] === searchItems[0]);
    const qOpen = T.filterLogicOps(searchItems, 'open');
    check('logic: the second row matches on its name', qOpen.length === 1 && qOpen[0] === searchItems[1]);
    const qTrap = T.filterLogicOps(searchItems, '  TRAP  ');
    check('logic: the query is trimmed before matching', qTrap.length === 1 && qTrap[0] === searchItems[2]);
    const qPurpose = T.filterLogicOps(searchItems, 'dexterity');
    check('logic: a purpose match is found', qPurpose.length === 1 && qPurpose[0] === searchItems[2]);
    checkEq('logic: a no-match query returns an empty list', T.filterLogicOps(searchItems, 'zzz').length, 0);

 // --- operation editor pure fns (step 2b, js/logic-ops.js) ---
    T.state.files.clear();
    writes.length = 0;
    clearToasts();
    const edPath = 'logic-ops/editor.json';
    const edEntry = {
      text: '',
      parsed: { items: [
        { id: 'op_e1e1e1e1', name: 'Attack roll', purpose: 'roll to hit', script: 'SET a = ROLL ((1-6))', outputTemplate: '%a%', imports: [], exposed: [], occurrences: [], bindings: {} },
        { id: 'op_e2e2e2e2', name: 'Door', purpose: 'door state', script: 'SET d = ROLL ((Locked:3 | Open:1))', outputTemplate: '%d%', imports: [], exposed: [], occurrences: [], bindings: {} },
        { id: 'op_e3e3e3e3', name: 'Weather', purpose: '', type: 'conditional', config: {} },
      ] },
      error: null,
    };
    T.state.files.set(edPath, edEntry);
    const edItems = edEntry.parsed.items;
    T.state.logicFile = edPath;
    T.state.logicOp = edItems[0];

    // isScriptLogicOp: only plain rows with a string script are logic ops
    const scriptRow = { name: 'Scripty', purpose: '', script: 'SET a = 1', outputTemplate: '%a%' };
    checkEq('logic: a row with a string script is a script logic op', T.isScriptLogicOp(scriptRow), true);
    checkEq('logic: a missing type still counts when the script is a string', T.isScriptLogicOp({ name: 'X', script: 'SET a = 1' }), true);
    checkEq('logic: a row with a non-empty type is not a script logic op', T.isScriptLogicOp({ name: 'X', type: 'conditional', script: 'SET a = 1' }), false);
    checkEq('logic: another legacy type value is not a script logic op', T.isScriptLogicOp({ name: 'Y', type: 'nested', script: 'SET a = 1' }), false);
    checkEq('logic: a conditional op is not a script logic op', T.isScriptLogicOp(edItems[2]), false);
    checkEq('logic: a row without a script is not a script logic op', T.isScriptLogicOp({ name: 'X', type: '' }), false);
    checkEq('logic: a row with a non-string script is not a script logic op', T.isScriptLogicOp({ name: 'X', type: '', script: 42 }), false);
    checkEq('logic: a non-object is not a script logic op', T.isScriptLogicOp(null), false);

    // validateLogicOperation: structural checks on one operation
    const validOp = {
      id: 'op_v0000001', name: 'Valid', purpose: '', script: 'SET a = 1', outputTemplate: '%a%',
      imports: [], exposed: [], occurrences: [], bindings: {},
    };
    checkDeep('logic: a fully-formed script op validates clean', T.validateLogicOperation(validOp), []);
    checkDeep('logic: a missing name is a missing-field problem',
      T.validateLogicOperation({ id: 'op_z', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} }),
      [{ kind: 'missing-field', message: 'name is required.' }]);
    checkDeep('logic: an empty id is an invalid-type problem',
      T.validateLogicOperation(Object.assign({}, validOp, { id: '' })),
      [{ kind: 'invalid-type', message: 'id must be a non-empty string.' }]);
    const noScriptOp = { id: 'op_z', name: 'Z', purpose: '', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} };
    checkDeep('logic: a missing script is a missing-field problem', T.validateLogicOperation(noScriptOp),
      [{ kind: 'missing-field', message: 'code is required.' }]);
    checkDeep('logic: duplicate import names are flagged',
      T.validateLogicOperation(Object.assign({}, validOp, { imports: ['a', 'a'] })),
      [{ kind: 'duplicate-name', message: 'imports contains a duplicate name: "a".' }]);
    check('logic: a leftover type field is an unknown field',
      T.validateLogicOperation(Object.assign({}, validOp, { type: 'conditional' })).some((p) => p.kind === 'unknown-field' && p.message.indexOf('"type"') !== -1));

    // opReferences: generator templates + table entry labels
    const genPath = 'generators/scenes.json';
    const tablePath = 'tables/rooms.json';
    T.state.files.set(genPath, {
      text: JSON.stringify({ items: [
        { id: 'gen_1', name: 'Scene', description: '', template: 'A { Attack roll } happens, then { attack roll } again.' },
        { id: 'gen_2', name: 'Quiet', description: '', template: 'nothing referenced here' },
      ] }, null, 2) + '\n',
      parsed: { items: [
        { id: 'gen_1', name: 'Scene', description: '', template: 'A { Attack roll } happens, then { attack roll } again.' },
        { id: 'gen_2', name: 'Quiet', description: '', template: 'nothing referenced here' },
      ] },
      error: null,
    });
    T.state.files.set(tablePath, {
      text: JSON.stringify({ items: [
        { name: 'Rooms', entries: [ { label: 'Door { Attack roll } locked' }, { label: '{Door} state' }, { label: 'plain label' } ] },
      ] }, null, 2) + '\n',
      parsed: { items: [
        { name: 'Rooms', entries: [ { label: 'Door { Attack roll } locked' }, { label: '{Door} state' }, { label: 'plain label' } ] },
      ] },
      error: null,
    });
    T.derive();
    const refs = T.opReferences('Attack roll');
    checkEq('logic: opReferences counts every template and entry span', refs.total, 3);
    checkDeep('logic: the template reference carries file, name and count',
      refs.templates[0],
      { file: 'generators/scenes.json', name: 'Scene', count: 2 });
    checkDeep('logic: the entry reference carries file, table, label and count',
      refs.entries[0],
      { file: 'tables/rooms.json', table: 'Rooms', label: 'Door { Attack roll } locked', count: 1 });
    checkEq('logic: opReferences matches case-insensitively, trimmed', T.opReferences('  ATTACK ROLL  ').total, 3);
    checkEq('logic: an unknown op name has no references', T.opReferences('Nope').total, 0);
    checkEq('logic: an empty op name has no references', T.opReferences('').total, 0);
    checkEq('logic: the entry label referencing Door is found', T.opReferences('Door').total, 1);

    // runLogicOpTest + logicRunErrorMessage
    sandbox.__setRng(seqRng([0.5]));
    const scriptRes = T.runLogicOpTest(edItems[0], {});
    checkEq('logic: a script op test succeeds', scriptRes.ok, true);
    checkEq('logic: the script test output is the template-rendered value', scriptRes.output, '4');
    checkDeep('logic: the script test returns one text segment', scriptRes.segments, [{ type: 'text', text: '4' }]);
    const constRes = T.runLogicOpTest({ id: 'op_const', name: 'Constant', script: 'SET a = 1', outputTemplate: '%b%' }, {});
    checkEq('logic: an unset template variable fails the test', constRes.ok, false);
    checkEq('logic: the failure kind is missing-variable', constRes.errors.length === 1 ? constRes.errors[0].kind : null, 'missing-variable');
    sandbox.__setRng(seqRng([0.9]));
    const pickRes = T.runLogicOpTest(edItems[1], {});
    checkEq('logic: an inline-pick op test succeeds', pickRes.ok, true);
    checkEq('logic: the inline pick chooses the second option at rng 0.9', pickRes.output, 'Open');
    const condRes = T.runLogicOpTest(edItems[2], {});
    checkEq('logic: a conditional op test fails as unsupported', condRes.ok, false);
    checkDeep('logic: the unsupported error carries kind, token and name',
      condRes.errors[0],
      { kind: 'unsupported-operation', token: '{Weather}', position: 0, operationName: 'Weather' });
    checkEq('logic: the unsupported test result message',
      T.logicRunErrorMessage(condRes.errors[0]), 'This operation is not executable.');
    checkEq('logic: an invalid-expression error falls through to the generic message',
      T.logicRunErrorMessage({ kind: 'invalid-expression' }), 'Run failed: invalid-expression');
    checkEq('logic: an unknown error kind falls through to the generic message',
      T.logicRunErrorMessage({ kind: 'weird' }), 'Run failed: weird');
    checkEq('logic: a bad-script error carries its line and message',
      T.logicRunErrorMessage({ kind: 'bad-script', line: 2, message: 'unexpected token' }),
      'line 2: unexpected token');

    // persistLogicOpsFile: named rows only, in-memory rows untouched
    const anonItem = { id: 'op_99999999', name: '', purpose: '', script: 'SET x = 1', outputTemplate: '%x%', imports: [], exposed: [], occurrences: [], bindings: {} };
    edEntry.parsed.items.push(anonItem);
    writes.length = 0;
    await T.persistLogicOpsFile(edPath);
    checkEq('logic: persist writes the named rows to disk',
      writes.length === 1 ? JSON.parse(writes[0][1]).items.length : null, 3);
    checkEq('logic: the unnamed row stays in memory', edEntry.parsed.items.length, 4);
    check('logic: the unnamed row is not on disk',
      writes.length === 1 && JSON.parse(writes[0][1]).items.every((it) => it.id !== 'op_99999999'));
    checkEq('logic: the state entry text matches the written bytes',
      writes.length === 1 && edEntry.text === writes[0][1], true);

    // duplicateLogicOperation (returns nothing: the copy is state.logicOp)
    sandbox.__setRng(seqRng([0.25, 0.75, 0.125]));
    writes.length = 0;
    await T.duplicateLogicOperation(edPath, edItems[0]);
    const copy = T.state.logicOp;
    check('logic: a duplicate is a new object', copy !== null && copy !== edItems[0]);
    check('logic: the duplicate gets a fresh op_ id', copy !== null && /^op_[0-9a-f]{8}$/.test(copy.id) && copy.id !== edItems[0].id);
    checkEq('logic: the duplicate name gets the copy suffix', copy !== null ? copy.name : null, 'Attack roll (copy)');
    check('logic: the duplicate bindings are a deep copy',
      copy !== null && copy.bindings !== edItems[0].bindings && deepEq(copy.bindings, edItems[0].bindings));
    checkEq('logic: the duplicate sits directly after the original', edEntry.parsed.items[1] === copy, true);
    checkEq('logic: the duplicate becomes the selected op', T.state.logicOp === copy, true);
    checkEq('logic: the duplicate persists the file once', writes.length, 1);
    check('logic: the duplicate is present on disk',
      writes.length === 1 && JSON.parse(writes[0][1]).items.some((it) => it.id === copy.id));
    sandbox.__setRng(seqRng([0.5]));
    writes.length = 0;
    await T.duplicateLogicOperation(edPath, anonItem);
    const anonCopy = T.state.logicOp;
    checkEq('logic: a duplicate of an unnamed op is named for the copy',
      anonCopy !== null ? anonCopy.name : null, 'Untitled (copy)');
    check('logic: the now-named duplicate is written to disk',
      writes.length === 1 && JSON.parse(writes[0][1]).items.some((it) => it.id === anonCopy.id));

    // renameOperation: propagates into generator templates (ID-first) and
    // table entry labels (name-only), refuses name collisions, persists every
    // affected file, and never touches ids.
    const doorRow = edEntry.parsed.items.find((it) => it.id === 'op_e2e2e2e2');
    const weatherRow = edEntry.parsed.items.find((it) => it.id === 'op_e3e3e3e3');
    const renGenPath = 'generators/ren.json';
    const renGenSeed = { items: [
      { id: 'gen_r1', name: 'Ren', description: '',
        template: 'You open {Door} and { door }.',
        operations: [ { token: 'Door', operationId: 'op_e2e2e2e2', operationName: 'Door' } ] },
      { id: 'gen_r2', name: 'IdOnly', description: '',
        template: 'Stale token {OldDoorToken} here.',
        operations: [ { token: 'OldDoorToken', operationId: 'op_e2e2e2e2', operationName: 'Door' } ] },
      { id: 'gen_r3', name: 'Other', description: '',
        template: 'Unrelated {Doorlike} and {Weather}.',
        operations: [] },
      { id: 'gen_r4', name: 'NameOnly', description: '',
        template: 'Unrecorded {Door} span.',
        operations: [ { token: 'Door', operationId: null, operationName: null } ] },
    ] };
    const renGenText = JSON.stringify(renGenSeed, null, 2) + '\n';
    T.state.files.set(renGenPath, { text: renGenText, parsed: JSON.parse(renGenText), error: null });
    const renGenItems = T.state.files.get(renGenPath).parsed.items;
    const renTblPath = 'tables/ren.json';
    const renTblSeed = { items: [
      { name: 'Ren', entries: [
        { label: 'A { door } B', weight: 1 },
        { label: 'C {Door} D {door}', weight: 1 },
        { label: 'keep {doorway} and [Door]', weight: 1 },
      ] },
    ] };
    const renTblText = JSON.stringify(renTblSeed, null, 2) + '\n';
    T.state.files.set(renTblPath, { text: renTblText, parsed: JSON.parse(renTblText), error: null });
    const renTblItems = T.state.files.get(renTblPath).parsed.items;
    T.derive();
    T.state.logicOp = doorRow;

    // plans (pure, pre-rename state): id spans + the name fallback
    const genPlan = T.findGeneratorOpRenameRefs('op_e2e2e2e2', 'Door');
    checkEq('rename: the generator plan finds the id spans plus the name fallback',
      genPlan.reduce((n, p) => n + p.spans.length, 0), 4);
    const entryPlan = T.findEntryOpRefs('', '  door  ');
    checkEq('rename: the entry plan is name-only and case-insensitive',
      entryPlan.reduce((n, p) => n + p.spans.length, 0), 4);

    // collision guard: names are matched case-insensitively
    writes.length = 0;
    clearToasts();
    const clash = await T.renameOperation(edPath, weatherRow, '  DOOR  ');
    checkEq('rename: a case-insensitive name collision is refused', clash.ok, false);
    checkEq('rename: the refusal reports duplicate-name', clash.reason, 'duplicate-name');
    checkEq('rename: the refused op keeps its name', weatherRow.name, 'Weather');
    checkEq('rename: the refusal writes nothing', writes.length, 0);
    check('rename: the refusal toast explains the clash',
      lastToast() !== null && /"DOOR" already exists/.test(lastToast()[0])
        && /case-insensitive/.test(lastToast()[0]));
    const blankRename = await T.renameOperation(edPath, weatherRow, '   ');
    checkEq('rename: a blank name is refused', blankRename.reason, 'empty-name');
    checkEq('rename: a blank name keeps the old name', weatherRow.name, 'Weather');
    const braceRename = await T.renameOperation(edPath, weatherRow, 'bad{name}');
    checkEq('rename: a brace in the new name is refused', braceRename.reason, 'invalid-name');
    checkEq('rename: the brace refusal happens before any write', writes.length, 0);
    const tableNameRename = await T.renameOperation(edPath, weatherRow, 'Rooms');
    checkEq('rename: only operation names collide, not a table with the same name',
      tableNameRename.ok, true);
    const backToWeather = await T.renameOperation(edPath, weatherRow, 'Weather');
    check('rename: renaming back restores the name', backToWeather.ok === true && weatherRow.name === 'Weather');

    // the real rename
    writes.length = 0;
    clearToasts();
    const ren = await T.renameOperation(edPath, doorRow, '  Door of doom  ');
    checkEq('rename: the trimmed name is stored', doorRow.name, 'Door of doom');
    checkEq('rename: the renamed op stays selected', T.state.logicOp === doorRow, true);
    checkEq('rename: the rename reports success', ren.ok, true);
    checkEq('rename: the report counts the updated templates', ren.templates, 3);
    checkEq('rename: the report counts the rewritten template spans', ren.spans, 4);
    checkEq('rename: the report counts the rewritten entry spans', ren.entrySpans, 4);
    checkEq('rename: the report counts updated entry labels, not spans', ren.entries, 3);
    checkEq('rename: the report counts the persisted files', ren.files, 4);
    check('rename: the toast reports templates and entries',
      lastToast() !== null && /3 generator templates/.test(lastToast()[0])
        && /3 table entries/.test(lastToast()[0]));
    checkEq('rename: exactly one write per affected file', writes.length, 4);
    check('rename: the logic, generator and table files are all persisted',
      writes.some((w) => w[0] === edPath) && writes.some((w) => w[0] === renGenPath)
        && writes.some((w) => w[0] === renTblPath) && writes.some((w) => w[0] === tablePath));

    // generator templates: ID first, old name as the fallback
    checkEq('rename: ID-matched spans are rewritten, padding dropped',
      renGenItems[0].template, 'You open {Door of doom} and {Door of doom}.');
    checkEq('rename: an ID-recorded span is rewritten even when its text is stale',
      renGenItems[1].template, 'Stale token {Door of doom} here.');
    checkEq('rename: name-matching unrecorded spans are rewritten too',
      renGenItems[3].template, 'Unrecorded {Door of doom} span.');
    checkEq('rename: longer tokens and other operations are untouched',
      renGenItems[2].template, 'Unrelated {Doorlike} and {Weather}.');
    checkDeep('rename: a stale-token ref is retargeted by id', renGenItems[1].operations,
      [{ token: 'Door of doom', operationId: 'op_e2e2e2e2', operationName: 'Door of doom' }]);
    checkDeep('rename: a name-only ref is retargeted and re-resolved', renGenItems[0].operations,
      [{ token: 'Door of doom', operationId: 'op_e2e2e2e2', operationName: 'Door of doom' }]);
    checkDeep('rename: a ref that never resolved is retargeted and gains the id',
      renGenItems[3].operations,
      [{ token: 'Door of doom', operationId: 'op_e2e2e2e2', operationName: 'Door of doom' }]);

    // table entry labels: name-only, case-insensitive
    checkEq('rename: entry labels rewrite every op span of the old name',
      renTblItems[0].entries[1].label, 'C {Door of doom} D {Door of doom}');
    checkEq('rename: entry padding inside the braces is dropped',
      renTblItems[0].entries[0].label, 'A {Door of doom} B');
    checkEq('rename: longer tokens and container brackets are untouched',
      renTblItems[0].entries[2].label, 'keep {doorway} and [Door]');
    checkEq('rename: an existing table file is rewritten in place',
      T.state.files.get(tablePath).parsed.items[0].entries[1].label, '{Door of doom} state');

    // persisted bytes + invariants
    checkEq('rename: the persisted generator bytes carry the new token',
      JSON.parse(writes.find((w) => w[0] === renGenPath)[1]).items[1].template,
      'Stale token {Door of doom} here.');
    checkEq('rename: the persisted table bytes carry the rewritten labels',
      JSON.parse(writes.find((w) => w[0] === renTblPath)[1]).items[0].entries[1].label,
      'C {Door of doom} D {Door of doom}');
    checkEq('rename: the operation id never changes', doorRow.id, 'op_e2e2e2e2');
    checkEq('rename: the old name matches no span any more', T.opReferences('Door').total, 0);
    checkEq('rename: every old reference now matches the new name',
      T.opReferences('door of doom').total, 8);

    // id-first safety: a {Name} span recorded against a DIFFERENT op is not
    // touched by the name fallback
    const negOpSeed = JSON.stringify({ items: [
      { id: 'op_neg0001', name: 'Gate', purpose: '', script: 'SET g = 1', outputTemplate: '%g%', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }, null, 2) + '\n';
    T.state.files.set('logic-ops/neg.json', { text: negOpSeed, parsed: JSON.parse(negOpSeed), error: null });
    const negGenSeed = JSON.stringify({ items: [
      { id: 'gen_n1', name: 'Neg', description: '', template: 'Open {Gate} now',
        operations: [ { token: 'Gate', operationId: 'op_other0000', operationName: 'Other' } ] },
    ] }, null, 2) + '\n';
    T.state.files.set('generators/neg.json', { text: negGenSeed, parsed: JSON.parse(negGenSeed), error: null });
    T.derive();
    writes.length = 0;
    clearToasts();
    const neg = await T.renameOperation('logic-ops/neg.json',
      T.state.files.get('logic-ops/neg.json').parsed.items[0], 'Gate II');
    checkEq('rename: a span bound to another op id is not hijacked by the name fallback',
      T.state.files.get('generators/neg.json').parsed.items[0].template, 'Open {Gate} now');
    checkDeep('rename: the other-op ref is left exactly as it was',
      T.state.files.get('generators/neg.json').parsed.items[0].operations,
      [{ token: 'Gate', operationId: 'op_other0000', operationName: 'Other' }]);
    checkEq('rename: an untouched generator file is not persisted', writes.length, 1);
    check('rename: the no-reference toast variant is only used when nothing matched',
      neg.ok === true && lastToast() !== null && /no template or entry referenced it/.test(lastToast()[0]));

    // a failed cascade write is reported, never silently swallowed
    const fragOpSeed = JSON.stringify({ items: [
      { id: 'op_f1f1f1f1', name: 'Fragile', purpose: '', script: 'SET f = 1', outputTemplate: '%f%', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }, null, 2) + '\n';
    T.state.files.set('logic-ops/frag.json', { text: fragOpSeed, parsed: JSON.parse(fragOpSeed), error: null });
    const fragGenSeed = JSON.stringify({ items: [
      { id: 'gen_g1', name: 'Frag', description: '', template: 'X {Fragile} Y', operations: [] },
    ] }, null, 2) + '\n';
    T.state.files.set('generators/frag.json', { text: fragGenSeed, parsed: JSON.parse(fragGenSeed), error: null });
    const fragTblSeed = JSON.stringify({ items: [
      { name: 'Frag', entries: [ { label: 'A {Fragile} B', weight: 1 } ] },
    ] }, null, 2) + '\n';
    T.state.files.set('tables/frag.json', { text: fragTblSeed, parsed: JSON.parse(fragTblSeed), error: null });
    T.derive();
    const origWrite = T.state.storage.writeFile;
    T.state.storage.writeFile = async (p, text) => {
      if (p === 'generators/frag.json' || p === 'tables/frag.json') throw new Error('simulated write failure');
      return origWrite(p, text);
    };
    clearToasts();
    let partial;
    try {
      partial = await T.renameOperation('logic-ops/frag.json',
        T.state.files.get('logic-ops/frag.json').parsed.items[0], 'Fragile II');
    } finally {
      T.state.storage.writeFile = origWrite;
    }
    checkEq('rename: a failed cascade still reports the rename as applied', partial.ok, true);
    checkEq('rename: a failed cascade is flagged partial', partial.partial, true);
    checkDeep('rename: every file that could not be updated is listed', partial.failed,
      ['generators/frag.json', 'tables/frag.json']);
    checkEq('rename: a failed generator write reverts the template',
      T.state.files.get('generators/frag.json').parsed.items[0].template, 'X {Fragile} Y');
    checkEq('rename: a failed table write reverts the label',
      T.state.files.get('tables/frag.json').parsed.items[0].entries[0].label, 'A {Fragile} B');
    check('rename: the partial toast names the stale files instead of claiming success',
      lastToast() !== null && lastToast()[1] === 'error'
        && /could not update/.test(lastToast()[0])
        && /generators\/frag\.json/.test(lastToast()[0])
        && /tables\/frag\.json/.test(lastToast()[0]));
    checkEq('rename: the operation rename itself stuck',
      T.state.files.get('logic-ops/frag.json').parsed.items[0].name, 'Fragile II');
    check('rename: the failed-cascade rename still persisted the logic file',
      writes.some((w) => w[0] === 'logic-ops/frag.json'));

    // deleteOperation: removes the row, no cascade
    // edItems[1] is no longer the Door op here — the duplicate block above
    // inserted a copy at index 1 — so grab the Door row by id, select it,
    // then delete it.
    const doorItem = edEntry.parsed.items.find((it) => it.id === 'op_e2e2e2e2');
    T.state.logicOp = doorItem;
    writes.length = 0;
    await T.deleteOperation(edPath, doorItem);
    check('logic: the deleted row is gone from memory', !edEntry.parsed.items.includes(doorItem));
    checkEq('logic: deleting the selected op deselects it', T.state.logicOp, null);
    checkEq('logic: the delete persists the file once', writes.length, 1);
    check('logic: the deleted op is not on disk',
      writes.length === 1 && JSON.parse(writes[0][1]).items.every((it) => it.id !== doorItem.id));
    checkEq('logic: the stale reference survives the delete (no cascade)',
      T.state.tables.some((t) => t.entries.some((e) => e.label === '{Door of doom} state')), true);
    const lenBefore = edEntry.parsed.items.length;
    await T.deleteOperation(edPath, { id: 'op_missing' });
    checkEq('logic: deleting a missing row changes nothing', edEntry.parsed.items.length, lenBefore);

    // onLogicDeleteOp: the confirm path awaits the deletion (and its
    // follow-up derive/renderAll), so state settles before the confirm
    // handler resolves — a Run fired right after cannot resolve the op from
    // stale state (DOM-free: confirm is stubbed, storage is in-memory).
    {
      const cdPath = 'logic-ops/confirm-del.json';
      const cdText = JSON.stringify({ items: [
        { id: 'op_ghost001', name: 'Ghost', purpose: '', script: 'SET g = ROLL |1d6|', outputTemplate: '%g%', imports: [], exposed: [], occurrences: [], bindings: {} },
        { id: 'op_keeper01', name: 'Keeper', purpose: '', script: 'SET k = ROLL |2d6|', outputTemplate: '%k%', imports: [], exposed: [], occurrences: [], bindings: {} },
      ] }, null, 2) + '\n';
      T.state.files.set(cdPath, { text: cdText, parsed: JSON.parse(cdText), error: null });
      T.derive();
      const ghostItem = T.state.files.get(cdPath).parsed.items[0];
      checkEq('confirm-del: the op is live in state before the delete',
        T.state.logicOps.some((o) => o.id === ghostItem.id), true);
      T.state.logicOp = ghostItem;
      writes.length = 0;
      sandbox.confirm = () => true;
      try {
        await T.onLogicDeleteOp(cdPath, ghostItem);
      } finally {
        delete sandbox.confirm;
      }
      check('confirm-del: the confirmed delete removes the row',
        !T.state.files.get(cdPath).parsed.items.includes(ghostItem));
      checkEq('confirm-del: deleting the selected op deselects it', T.state.logicOp, null);
      checkEq('confirm-del: the confirm path persists the file exactly once', writes.length, 1);
      check('confirm-del: the written bytes no longer carry the op',
        writes.length === 1 && JSON.parse(writes[0][1]).items.every((it) => it.id !== ghostItem.id));
      checkEq('confirm-del: derive has dropped the op from live state',
        T.state.logicOps.some((o) => o.id === ghostItem.id), false);
      // A generator Run fired immediately after the awaited confirm sees
      // the removal instead of rolling the stale op.
      T.state.history = [];
      sandbox.__setRng(seqRng([0.25]));
      T.runGenItem(cdPath, { id: 'g_ghost', name: 'GhostGen', template: '{Ghost}', references: [] });
      const ghostRun = T.state.genLastRun;
      checkEq('confirm-del: an immediate Run no longer resolves the deleted op', ghostRun.ok, false);
      checkEq('confirm-del: the immediate Run reports missing-operation',
        ghostRun.errors.length ? ghostRun.errors[0].kind : null, 'missing-operation');
      checkEq('confirm-del: the failed Run adds no history', T.state.history.length, 0);
      sandbox.__setRng(sandbox.__origRandom);
    }

    T.state.logicFile = null;
    T.state.logicOp = null;
    T.state.logicSearch = '';
    T.state.storage = null;
    sandbox.__setRng(sandbox.__origRandom);
  })();
}

// -------------------------------------------------- logic ops in generators
// `{operation}` spans in a generator template and in entry text. The
// engine half (validateGenerator/resolveOperationRefs/runGenerator) is covered
// by ttrpg-engine-test.js; these checks cover the app glue: derive carries the
// refs, the save-time reconciliation resolves token -> id, the editor's pure
// helpers behave, and runGenItem/entryEmbedContext wire the live operations
// into the run.
function runGenOpChecks() {
  return (async () => {
    T.state.files.set('logic-ops/zz-ops.json', {
      text: '',
      parsed: {
        items: [
          { id: 'op_zzloot', name: 'ZzLoot', purpose: 'gold', script: 'SET l = ROLL |1d6|', outputTemplate: '%l%', imports: [], exposed: [], occurrences: [], bindings: {} },
          { id: 'op_zztwin1', name: 'ZzTwin', purpose: '', script: 'SET t1 = 1', outputTemplate: '%t1%', imports: [], exposed: [], occurrences: [], bindings: {} },
          { id: 'op_zztwin2', name: 'ZzTwin', purpose: '', script: 'SET t2 = 2', outputTemplate: '%t2%', imports: [], exposed: [], occurrences: [], bindings: {} },
          { id: 'op_zzblank', name: '', purpose: '', script: 'SET z = 0', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
        ],
      },
      error: null,
    });
    T.state.files.set('generators/zz-gen.json', {
      text: '',
      parsed: {
        items: [
          {
            id: 'gzz1',
            name: 'ZzGen',
            template: '{ZzLoot}',
            references: [],
            operations: [{ token: 'ZzLoot', operationId: 'op_zzloot', operationName: 'ZzLoot' }],
          },
          { id: 'gzz2', name: 'ZzBare', template: 'plain' },
          { id: 'gzz3', name: 'ZzBadOps', template: 'plain', operations: 'nope' },
        ],
      },
      error: null,
    });
    T.derive();

    // --- derive: the row carries the operation refs (and defaults to []) ----
    const gzz1 = T.state.generators.find((g) => g.id === 'gzz1');
    const gzz2 = T.state.generators.find((g) => g.id === 'gzz2');
    const gzz3 = T.state.generators.find((g) => g.id === 'gzz3');
    checkDeep('ops derive: the row carries item.operations', gzz1 ? gzz1.operations : null,
      [{ token: 'ZzLoot', operationId: 'op_zzloot', operationName: 'ZzLoot' }]);
    checkDeep('ops derive: a generator without operations gets []', gzz2 ? gzz2.operations : null, []);
    checkDeep('ops derive: a non-array operations value becomes []', gzz3 ? gzz3.operations : null, []);

    // --- genOperationRefs: the save-time reconciliation ---------------------
    checkDeep('ops refs: a name match records the id', T.genOperationRefs('{ZzLoot}', []),
      [{ token: 'ZzLoot', operationId: 'op_zzloot', operationName: 'ZzLoot' }]);
    checkDeep('ops refs: a stored id survives a stale token',
      T.genOperationRefs('{OldName}', [{ token: 'OldName', operationId: 'op_zzloot' }]),
      [{ token: 'OldName', operationId: 'op_zzloot', operationName: 'ZzLoot' }]);
    checkDeep('ops refs: an unknown name stays unresolved', T.genOperationRefs('{ZzNope}', []),
      [{ token: 'ZzNope', operationId: null, operationName: null }]);
    checkDeep('ops refs: an empty {} token stays unresolved', T.genOperationRefs('{}', []),
      [{ token: '', operationId: null, operationName: null }]);
    checkDeep('ops refs: a duplicated name stays unresolved', T.genOperationRefs('{ZzTwin}', []),
      [{ token: 'ZzTwin', operationId: null, operationName: null }]);
    checkDeep('ops refs: a template with no braces yields no refs', T.genOperationRefs('plain text', []), []);

    // --- insertGenOperationRef: record the id at insert time ----------------
    const refsBefore = [];
    const refsAfter = T.insertGenOperationRef(refsBefore, { name: ' ZzLoot ', id: 'op_zzloot' });
    checkDeep('ops insert: records token/id/name', refsAfter,
      [{ token: 'ZzLoot', operationId: 'op_zzloot', operationName: 'ZzLoot' }]);
    checkEq('ops insert: never mutates the input list', refsBefore.length, 0);
    checkEq('ops insert: dedupes case-insensitively',
      T.insertGenOperationRef(refsAfter, { name: 'zzloot', id: 'op_other' }).length, 1);
    checkEq('ops insert: keeps the first id',
      T.insertGenOperationRef(refsAfter, { name: 'zzloot', id: 'op_other' })[0].operationId, 'op_zzloot');
    checkDeep('ops insert: an unnamed operation is ignored',
      T.insertGenOperationRef([], { name: '   ', id: 'op_x' }), []);
    checkEq('ops insert: a missing list starts a new one',
      T.insertGenOperationRef(null, { name: 'ZzLoot', id: 'op_zzloot' }).length, 1);

    // --- opSpanAt: the caret-in-op-span detector ---------------------------
    checkDeep('ops caret: inside a span', T.opSpanAt('a {ZzLoot} b', 4),
      { start: 2, end: 9, inner: 'ZzLoot', raw: '{ZzLoot}' });
    checkEq('ops caret: at the opening brace counts', T.opSpanAt('a {ZzLoot} b', 2).inner, 'ZzLoot');
    checkEq('ops caret: before the span is null', T.opSpanAt('a {ZzLoot} b', 1), null);
    checkEq('ops caret: right after the closing brace still counts',
      T.opSpanAt('a {ZzLoot} b', 10).inner, 'ZzLoot');
    checkEq('ops caret: past the span is null', T.opSpanAt('a {ZzLoot} b', 11), null);
    checkEq('ops caret: empty braces are not a span', T.opSpanAt('x {} y', 4), null);
    checkEq('ops caret: an unclosed brace is not a span', T.opSpanAt('x {ZzLoot', 6), null);
    checkEq('ops caret: picks the span under the caret, not the first',
      T.opSpanAt('{A} {B}', 5).inner, 'B');
    checkEq('ops caret: trims the inner text', T.opSpanAt('{ ZzLoot }', 5).inner, 'ZzLoot');
    checkEq('ops caret: a missing caret means end of text', T.opSpanAt('{ZzLoot}', undefined).inner, 'ZzLoot');

    // --- opSuggestItems: the `{` autocomplete ------------------------------
    const suggestFixture = [
      { id: 'op_zzloot', name: 'ZzLoot', script: 'SET l = 1', outputTemplate: '%l%' },
      { id: 'op_zztwin1', name: 'ZzTwin', script: 'SET t1 = 1', outputTemplate: '%t1%' },
      { id: 'op_zztwin2', name: 'ZzTwin', script: 'SET t2 = 2', outputTemplate: '%t2%' },
      { id: 'op_zzweather', name: 'ZzWeather', type: 'weather' },
      { id: 'op_zzblank', name: '' },
    ];
    checkDeep('ops suggest: an empty query lists each name once', T.opSuggestItems('', suggestFixture),
      [{ text: 'ZzLoot', hint: 'operation', kind: 'op' },
        { text: 'ZzTwin', hint: 'operation', kind: 'op' },
        { text: 'ZzWeather', hint: 'weather', kind: 'op' }]);
    checkDeep('ops suggest: prefix match is case-insensitive', T.opSuggestItems('zzW', suggestFixture),
      [{ text: 'ZzWeather', hint: 'weather', kind: 'op' }]);
    checkDeep('ops suggest: a non-prefix match is not offered', T.opSuggestItems('oot', suggestFixture), []);
    checkDeep('ops suggest: a null list is empty', T.opSuggestItems('zz', null), []);

    // --- messages ---------------------------------------------------------
    checkEq('ops msg: generator missing-operation',
      T.genErrorMessage({ kind: 'missing-operation', token: 'ZzNope' }),
      'Generator error: no logic operation named "ZzNope" - insert one with the Insert logic button or fix the {token}.');
    checkEq('ops msg: generator unsupported-operation',
      T.genErrorMessage({ kind: 'unsupported-operation', token: 'ZzWeather' }),
      'Generator error: logic operation "ZzWeather" is not executable.');
    checkEq('ops msg: entry missing-operation',
      T.embedErrorMessage({ kind: 'missing-operation', token: '{ZzNope}', operationName: 'ZzNope' }),
      'Entry embed error: no logic operation named "ZzNope" - create the operation in the Logic tab or fix the {token}');
    checkEq('ops msg: entry unsupported-operation (inside a container)',
      T.embedErrorMessage({ kind: 'unsupported-operation', token: '{ZzWeather}', chain: ['A'] }),
      'Entry embed error: logic operation "ZzWeather" is not executable. (inside [A])');
    checkEq('ops msg: entry invalid formula names the operation',
      T.embedErrorMessage({ kind: 'invalid-expression', token: '{Bad}', operationName: 'Bad' }),
      'Entry embed error: logic operation "Bad" has an invalid formula');
    checkEq('ops msg: an empty {} run error names braces, not brackets',
      T.genErrorMessage({ kind: 'malformed', token: '', occurrences: [{ index: 0, position: 0 }] }, '{}'),
      'Generator error: the template has an empty {} token - put an operation name between the braces.');
    checkEq('ops msg: an empty [] run error keeps the bracket wording',
      T.genErrorMessage({ kind: 'malformed', token: '', occurrences: [{ index: 0, position: 0 }] }, '[]'),
      'Generator error: the template has an empty [] token - put a container name between the brackets.');
    checkEq('ops msg: a macro failure inside a choice op keeps the macro name',
      T.embedErrorMessage({
        kind: 'invalid-expression', token: '|BrokenMacro|',
        macroName: 'BrokenMacro', operationName: 'ZzPick',
      }),
      'Entry embed error: macro "BrokenMacro" has an invalid formula (inside logic operation "ZzPick")');
    // the Logic-tab test panel renders the new kinds through
    // logicRunErrorMessage (the messageSegments/appendMessageNodes path).
    checkEq('ops msg: logic test panel op-cycle surfaces the engine diagnostic',
      T.logicRunErrorMessage({ kind: 'op-cycle', token: '{A}', operationName: 'A', chain: ['A', 'B', 'A'], message: 'circular operation reference "A" -> "B" -> "A" - remove one call to break the loop' }),
      'circular operation reference "A" -> "B" -> "A" - remove one call to break the loop');
    checkEq('ops msg: logic test panel op-cycle fallback names the cycle path',
      T.logicRunErrorMessage({ kind: 'op-cycle', token: '{A}', operationName: 'A', chain: ['A', 'B', 'A'] }),
      'Operation cycle: "A" -> "B" -> "A" — remove one call to break the loop.');
    checkEq('ops msg: logic test panel nesting-limit passes the engine diagnostic through',
      T.logicRunErrorMessage({ kind: 'nesting-limit', token: '{E}', operationName: 'E', message: 'nested operation depth exceeded 4 levels' }),
      'nested operation depth exceeded 4 levels');
    checkEq('ops msg: logic test panel nesting-limit fallback names the budgets',
      T.logicRunErrorMessage({ kind: 'nesting-limit', token: '{E}' }),
      'Execution exceeded a nesting budget (operation depth 4, block depth 8, 1000 resolutions, or 100,000 characters) — simplify the script.');
    checkEq('ops msg: logic test panel container cycle names the loop',
      T.logicRunErrorMessage({ kind: 'cycle', token: '[a]', containerName: 'A', chain: ['A', 'B'] }),
      'Circular container reference: [A] -> [B] -> [A] — remove one reference to break the loop.');

    // --- error classification: `{}` vs `[]` and container vs operation -----
    const emptyBrace = { kind: 'malformed', token: '', occurrences: [{ index: 0, position: 0 }] };
    const emptyBracket = { kind: 'malformed', token: '', occurrences: [{ index: 0, position: 0 }] };
    checkEq('ops classify: an empty {} at its position is an operation error',
      T.isEmptyOpError(emptyBrace, '{}'), true);
    checkEq('ops classify: an empty [] at its position is not',
      T.isEmptyOpError(emptyBracket, '[]'), false);
    checkEq('ops classify: no occurrences is never an empty-op error',
      T.isEmptyOpError({ kind: 'malformed', token: '' }, '{}'), false);
    checkEq('ops classify: a missing container is not an operation error',
      T.isOpErrorKind({ kind: 'missing', token: 'Foo', occurrences: [{ index: 0, position: 1 }] }, '[Foo]'), false);
    checkEq('ops classify: missing-operation is an operation error',
      T.isOpErrorKind({ kind: 'missing-operation', token: 'Foo' }, '{Foo}'), true);
    checkEq('ops classify: the second empty token in []{} is the operation one',
      T.isOpErrorKind({ kind: 'malformed', token: '', occurrences: [{ index: 0, position: 2 }] }, '[]{}'), true);

    // --- findLogicOpRow: the "Open {name}" lookup (ID-first, then name) ----
    checkEq('ops lookup: resolves by name', (T.findLogicOpRow('ZzLoot', []) || {}).id, 'op_zzloot');
    checkEq('ops lookup: is case-insensitive and trims',
      (T.findLogicOpRow('  zzLOOT ', []) || {}).id, 'op_zzloot');
    checkEq('ops lookup: a stored id wins over the token spelling',
      (T.findLogicOpRow('ZzWeather', [{ token: 'ZzWeather', operationId: 'op_zzloot' }]) || {}).id,
      'op_zzloot');
    checkEq('ops lookup: a duplicated name is ambiguous -> null', T.findLogicOpRow('ZzTwin', []), null);
    checkEq('ops lookup: an empty token is null', T.findLogicOpRow('', []), null);
    checkEq('ops lookup: an unknown name is null', T.findLogicOpRow('ZzNope', []), null);

    // --- entryEmbedContext: name-based operation list ----------------------
    const opCtx = T.entryEmbedContext('tables/zz.json').operations;
    const zzLootCtx = opCtx.find((o) => o.name === 'ZzLoot');
    checkDeep('ops ctx: the operation row is name-based', zzLootCtx ? Object.keys(zzLootCtx).sort() : null,
      ['config', 'id', 'name', 'outputTemplate', 'script', 'type']);
    checkEq('ops ctx: the operation keeps its id for the engine', zzLootCtx ? zzLootCtx.id : null, 'op_zzloot');

 // --- entries resolve {operation} ----------------------------
    sandbox.__setRng(seqRng([0.5]));
    let r = T.resolveEntryEmbeds('You find {ZzLoot} coins.');
    checkEq('ops entry: {ZzLoot} resolves', r.output, 'You find 4 coins.');
    checkDeep('ops entry: the op segment is purple-rendered data',
      r.segments.length === 3 ? r.segments[1] : null,
      { type: 'op', text: '4', operationId: 'op_zzloot', operationName: 'ZzLoot', token: '{ZzLoot}' });
    r = T.resolveEntryEmbeds('{ZzNope}');
    checkEq('ops entry: an unknown op is missing-operation',
      r.errors.length ? r.errors[0].kind : null, 'missing-operation');

    // --- runGenItem: ops in the run context, ID-first ---------------------
    sandbox.__setRng(seqRng([0.5]));
    const opGen = {
      id: 'gzz1', name: 'ZzGen', template: '{ZzLoot}', references: [],
      operations: [{ token: 'ZzLoot', operationId: 'op_zzloot', operationName: 'ZzLoot' }],
    };
    T.runGenItem('generators/zz-gen.json', opGen);
    let run = T.state.genLastRun;
    checkEq('ops run: a template op span succeeds', run.ok, true);
    checkEq('ops run: the output is the operation value', run.output, '4');
    checkDeep('ops run: one op segment with id and name', run.segments,
      [{ type: 'op', text: '4', operationId: 'op_zzloot', operationName: 'ZzLoot', token: '{ZzLoot}' }]);
    checkEq('ops run: an op-only template rolls no containers', run.rolls.length, 0);
    const staleGen = {
      id: 'gzz4', name: 'ZzStale', template: '{OldName}', references: [],
      operations: [{ token: 'OldName', operationId: 'op_zzloot', operationName: 'ZzLoot' }],
    };
    T.runGenItem('generators/zz-gen.json', staleGen);
    checkEq('ops run: a stale token still resolves through its stored id',
      T.state.genLastRun.ok, true);
    checkEq('ops run: the ID-first output', T.state.genLastRun.output, '4');

    // --- validateGen: op errors reach the generator panel ------------------
    let v = T.validateGen({ name: 'x', template: '{ZzNope}', references: [], operations: [] });
    checkEq('ops validate: an unknown op is missing-operation',
      v.errors.length === 1 ? v.errors[0].kind : null, 'missing-operation');
    v = T.validateGen({
      name: 'x', template: '{ZzLoot}', references: [],
      operations: [{ token: 'ZzLoot', operationId: 'op_zzloot', operationName: 'ZzLoot' }],
    });
    checkEq('ops validate: a resolvable op has no errors', v.ok, true);
    v = T.validateGen({ name: 'x', template: '{}', references: [], operations: [] });
    checkEq('ops validate: an empty {} token is malformed',
      v.errors.length === 1 ? v.errors[0].kind : null, 'malformed');

    sandbox.__setRng(sandbox.__origRandom);
  })();
}

// ---------------------------------------------- entry op ref checks
// Table entries store {token, operationId} rows for their {op} spans;
// resolution is ID-first with a unique-name fallback for legacy entries, and
// a rename retargets the stored rows. No DOM: the touch points are state
// (Map-backed files), the mem storage adapter and toast (probe stubs).
function runEntryOpRefChecks() {
  return (async () => {
    const memFiles = new Map();
    const writes = [];
    T.state.storage = {
      mode: 'test',
      async createFile(p, text) {
        if (memFiles.has(p)) throw new Error('File already exists');
        memFiles.set(p, text);
      },
      async writeFile(p, text) {
        writes.push([p, text]);
        memFiles.set(p, text);
      },
      async deleteFile(p) { memFiles.delete(p); },
    };
    const lastToast = () => (sandbox.__toastLog.length ? sandbox.__toastLog[sandbox.__toastLog.length - 1] : null);
    T.state.files.clear();
    T.state.logicOps = [];

    T.state.files.set('logic-ops/c4ops.json', {
      text: '',
      parsed: { items: [
        { id: 'op_c4twin1', name: 'Twin', purpose: '', script: 'SET t1 = 44', outputTemplate: '%t1%', imports: [], exposed: [], occurrences: [], bindings: {} },
        { id: 'op_c4twin2', name: 'Twin', purpose: '', script: 'SET t2 = 45', outputTemplate: '%t2%', imports: [], exposed: [], occurrences: [], bindings: {} },
        { id: 'op_c4solo', name: 'Solo', purpose: '', script: 'SET s = 42', outputTemplate: '%s%', imports: [], exposed: [], occurrences: [], bindings: {} },
      ] },
      error: null,
    });
    T.state.files.set('tables/c4t.json', {
      text: '',
      parsed: { items: [
        {
          id: 'tbl_c4t', name: 'C4Table',
          entries: [
            { label: 'Legacy {solo} end', weight: 1 },
            { label: 'Bound {solo} end', weight: 1,
              operations: [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }] },
            { label: 'Ambig {twin} end', weight: 1 },
            { label: 'Old {solo} end', weight: 1 },
          ],
        },
      ] },
      error: null,
    });
    T.derive();
    const c4tItem = T.state.files.get('tables/c4t.json').parsed.items[0];
    const c4tEntries = c4tItem.entries;

    // --- entryOperationRefs: the save-time reconciliation ------------------
    checkDeep('c4 refs: a unique name records the id and name',
      T.entryOperationRefs('Legacy {solo} end', []),
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }]);
    checkDeep('c4 refs: a stored id is kept and the name refreshed',
      T.entryOperationRefs('Bound {solo} end', [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Stale' }]),
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }]);
    checkDeep('c4 refs: repeated spans dedupe to one row',
      T.entryOperationRefs('A {solo} B {solo} C', []),
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }]);
    checkDeep('c4 refs: a duplicated name records no id',
      T.entryOperationRefs('Ambig {twin} end', []),
      [{ token: 'twin', operationId: null, operationName: null }]);
    checkDeep('c4 refs: an unknown name records no id',
      T.entryOperationRefs('Miss {nope} end', []),
      [{ token: 'nope', operationId: null, operationName: null }]);
    checkDeep('c4 refs: a stale id with no name match records no id',
      T.entryOperationRefs('X {gone} Y', [{ token: 'gone', operationId: 'op_gone444', operationName: 'Gone' }]),
      [{ token: 'gone', operationId: null, operationName: null }]);
    checkDeep('c4 refs: a label without spans yields no rows', T.entryOperationRefs('no spans here', []), []);

    // --- findEntryOpRefs: the rename plan (pre-migration) -------------------
    const idPlan = T.findEntryOpRefs('op_c4solo', 'Solo');
    checkEq('c4 plan: the id plan finds the id row plus both name fallbacks', idPlan.length, 3);
    checkDeep('c4 plan: one span per entry, in entry order',
      idPlan.map((p) => [p.entry, p.spans.length, p.tokens]),
      [[0, 1, ['solo']], [1, 1, ['solo']], [3, 1, ['solo']]]);
    check('c4 plan: every plan item carries the operation id',
      idPlan.length === 3 && idPlan.every((p) => p.operationId === 'op_c4solo'));
    const hijackPlan = T.findEntryOpRefs('op_c4twin1', 'Solo');
    checkEq('c4 plan: another operation rename never hijacks an id-bound row', hijackPlan.length, 2);
    checkDeep('c4 plan: only the row-less entries match the other rename',
      hijackPlan.map((p) => p.entry), [0, 3]);
    const namePlan = T.findEntryOpRefs('', '  SOLO  ');
    checkEq('c4 plan: a name-only plan matches only rows without a recorded id', namePlan.length, 2);
    checkDeep('c4 plan: the name-only match is trimmed and case-insensitive',
      namePlan.map((p) => p.entry), [0, 3]);

    // --- resolveEntryEmbeds: legacy fallback, ID-first, and the guards ------
    sandbox.__setRng(seqRng([0.5]));
    let r = T.resolveEntryEmbeds('Legacy {solo} end', 'tables/c4t.json');
    checkEq('c4 embed: a legacy entry falls back to the unique name', r.output, 'Legacy 42 end');
    checkDeep('c4 embed: the legacy op segment carries the resolved id', r.segments[1],
      { type: 'op', text: '42', operationId: 'op_c4solo', operationName: 'Solo', token: '{solo}' });
    r = T.resolveEntryEmbeds('Bound {solo} end', 'tables/c4t.json', c4tEntries[1].operations);
    checkEq('c4 embed: a stored ref row resolves through its id', r.output, 'Bound 42 end');
    checkDeep('c4 embed: the stored-ref segment names the operation', r.segments[1],
      { type: 'op', text: '42', operationId: 'op_c4solo', operationName: 'Solo', token: '{solo}' });
    r = T.resolveEntryEmbeds('Ambig {twin} end', 'tables/c4t.json');
    check('c4 embed: an ambiguous name is reported, never substituted',
      r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'missing-operation');
    r = T.resolveEntryEmbeds('Miss {nope} end', 'tables/c4t.json');
    check('c4 embed: a missing name is reported',
      r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'missing-operation');

    // --- ensureEntryOpRefs: the load migration ------------------------------
    writes.length = 0;
    await T.ensureEntryOpRefs('tables/c4t.json');
    checkEq('c4 migrate: one write for the changed file', writes.length, 1);
    checkDeep('c4 migrate: the legacy entry gained its stored row', c4tEntries[0].operations,
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }]);
    checkDeep('c4 migrate: the bound entry keeps its row', c4tEntries[1].operations,
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }]);
    checkDeep('c4 migrate: the ambiguous entry keeps an unresolved row', c4tEntries[2].operations,
      [{ token: 'twin', operationId: null, operationName: null }]);
    checkDeep('c4 migrate: the fourth entry gained its row', c4tEntries[3].operations,
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo' }]);
    check('c4 migrate: the persisted bytes carry the rows',
      writes.length === 1 && JSON.parse(writes[0][1]).items[0].entries[0].operations.length === 1);
    writes.length = 0;
    await T.ensureEntryOpRefs('tables/c4t.json');
    checkEq('c4 migrate: a second pass writes nothing', writes.length, 0);

    // --- renameOperation: the cascade keeps every binding intact ------------
    const soloItem = T.state.files.get('logic-ops/c4ops.json').parsed.items.find((it) => it.id === 'op_c4solo');
    writes.length = 0;
    const ren = await T.renameOperation('logic-ops/c4ops.json', soloItem, '  Solo Renamed  ');
    checkEq('c4 rename: the rename reports success', ren.ok, true);
    checkEq('c4 rename: the report counts the rewritten entry spans', ren.entrySpans, 3);
    checkEq('c4 rename: the report counts the changed labels, not the spans', ren.entries, 3);
    checkEq('c4 rename: the report counts the persisted files', ren.files, 2);
    checkEq('c4 rename: no generator templates were affected', ren.templates, 0);
    checkEq('c4 rename: exactly one write per affected file', writes.length, 2);
    check('c4 rename: the toast names the updated entries',
      lastToast() !== null && /3 table entries/.test(lastToast()[0]));
    checkEq('c4 rename: the stored name is trimmed', soloItem.name, 'Solo Renamed');
    checkEq('c4 rename: the legacy label was rewritten', c4tEntries[0].label, 'Legacy {Solo Renamed} end');
    checkEq('c4 rename: the bound label was rewritten', c4tEntries[1].label, 'Bound {Solo Renamed} end');
    checkEq('c4 rename: the unrelated label is untouched', c4tEntries[2].label, 'Ambig {twin} end');
    checkEq('c4 rename: the name-fallback label was rewritten', c4tEntries[3].label, 'Old {Solo Renamed} end');
    checkDeep('c4 rename: the id-bound row was retargeted and re-resolved', c4tEntries[1].operations,
      [{ token: 'Solo Renamed', operationId: 'op_c4solo', operationName: 'Solo Renamed' }]);
    checkDeep('c4 rename: the legacy entry gained its retargeted row', c4tEntries[0].operations,
      [{ token: 'Solo Renamed', operationId: 'op_c4solo', operationName: 'Solo Renamed' }]);
    checkDeep('c4 rename: the name-fallback entry gained its row', c4tEntries[3].operations,
      [{ token: 'Solo Renamed', operationId: 'op_c4solo', operationName: 'Solo Renamed' }]);
    checkDeep('c4 rename: the persisted table file matches the in-memory item',
      JSON.parse(writes[1][1]), { items: [c4tItem] });
    checkEq('c4 rename: the persisted ops file carries the new name',
      JSON.parse(writes[0][1]).items.find((it) => it.id === 'op_c4solo').name, 'Solo Renamed');
    checkEq('c4 rename: derive exposes the renamed operation',
      T.state.logicOps.find((o) => o.id === 'op_c4solo').name, 'Solo Renamed');

    // --- ID-first beats a same-named newcomer -------------------------------
    const c4opsEntry = T.state.files.get('logic-ops/c4ops.json');
    const c4opsItems = c4opsEntry.parsed.items;
    c4opsItems.push({ id: 'op_c4new1', name: 'Solo', purpose: '', script: 'SET n = 77', outputTemplate: '%n%', imports: [], exposed: [], occurrences: [], bindings: {} });
    c4opsEntry.text = JSON.stringify({ items: c4opsItems }, null, 2) + '\n';
    T.derive();
    c4tEntries[1].label = 'X {solo} Y';
    c4tEntries[1].operations = [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo Renamed' }];
    r = T.resolveEntryEmbeds(c4tEntries[1].label, 'tables/c4t.json', c4tEntries[1].operations);
    checkEq('c4 drift: the stored id beats a same-named newcomer', r.output, 'X 42 Y');
    r = T.resolveEntryEmbeds(c4tEntries[1].label, 'tables/c4t.json');
    checkEq('c4 drift: without stored rows the unique name owns the token', r.output, 'X 77 Y');
    r = T.resolveEntryEmbeds('Ambig {twin} end', 'tables/c4t.json',
      [{ token: 'twin', operationId: 'op_gone444', operationName: 'Twin' }]);
    check('c4 drift: a stale stored id falls back and stays ambiguous',
      r.ok === false && r.errors[0].kind === 'missing-operation');

    // --- migration edge: a stale row on a span-less label is pruned ---------
    c4tEntries[0].label = 'no spans here';
    writes.length = 0;
    await T.ensureEntryOpRefs('tables/c4t.json');
    checkEq('c4 migrate: the stale row is pruned with one write', writes.length, 1);
    checkDeep('c4 migrate: the span-less entry lost its operations field',
      Object.keys(c4tEntries[0]).sort(), ['label', 'weight']);
    checkDeep('c4 migrate: the live rows are kept', c4tEntries[1].operations,
      [{ token: 'solo', operationId: 'op_c4solo', operationName: 'Solo Renamed' }]);
    checkDeep('c4 migrate: the persisted bytes match the in-memory item',
      JSON.parse(writes[0][1]), { items: [c4tItem] });
    writes.length = 0;
    await T.ensureEntryOpRefs('tables/c4t.json');
    checkEq('c4 migrate: the prune is idempotent', writes.length, 0);

    sandbox.__setRng(sandbox.__origRandom);
  })();
}

// ---------------------------------------------- import/export (DOM-free) checks
// Bundle round trip, id conflict handling and sniffKind. No DOM: the only
// touch points are state.storage (a Map-backed adapter), toast (stubbed by the
// probe) and renderAll (stubbed by the probe).
function runImportExportChecks() {
  return (async () => {
    const memFiles = new Map();
    T.state.storage = {
      mode: 'test',
      async createFile(p, text) {
        if (memFiles.has(p)) throw new Error('File already exists');
        memFiles.set(p, text);
      },
      async writeFile(p, text) { memFiles.set(p, text); },
      async deleteFile(p) { memFiles.delete(p); },
      async listFiles() {
        const out = [];
        for (const [p, text] of memFiles) out.push([p, { text: text }]);
        return out;
      },
    };
    T.state.files.clear();
    T.state.logicOps = [];

    const ops = [
      { id: 'op_aaaaaaaa', name: 'Attack', purpose: 'hit', script: 'IMPORT %a%\nSET dmg = a', outputTemplate: '%dmg%', imports: ['a'], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_bbbbbbbb', name: 'Loot', purpose: '', script: 'SET x = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ];

    // --- export payload shape ------------------------------------------------
    const bundle = T.buildLogicOpsBundle(ops);
    checkEq('ie: the ops bundle carries the kind tag', bundle.kind, 'ttrpg-logic-ops');
    checkEq('ie: the ops bundle carries no version field', Object.prototype.hasOwnProperty.call(bundle, 'version'), false);
    checkDeep('ie: id/name/purpose/script/outputTemplate/imports survive export', bundle.operations[0], ops[0]);

    // --- round trip into an empty app ---------------------------------------
    // Current flow (importLogicOpsBundleFile): parseLogicOpsBundle ->
    // planLogicOpsImport -> storage.createFile -> setFile -> derive.
    const parsed = T.parseLogicOpsBundle(JSON.stringify(bundle));
    checkEq('ie: the bundle parses cleanly', parsed.ok, true);
    checkEq('ie: the parsed bundle carries both operations', parsed.operations.length, 2);
    const first = T.planLogicOpsImport(parsed.operations, []);
    checkEq('ie: a fresh import renames nothing', first.renamed.length, 0);
    checkEq('ie: a fresh import changes no ids', first.idChanges, 0);
    const roundPath = 'logic-ops/round-trip.json';
    const roundText = T.serializeLogicOpsFile(first.operations);
    await T.state.storage.createFile(roundPath, roundText);
    T.state.files.set(roundPath, { text: roundText, parsed: JSON.parse(roundText), error: null });
    T.derive();
    check('ie: apply writes the operations file', memFiles.has(roundPath));
    const written = memFiles.has(roundPath) ? JSON.parse(memFiles.get(roundPath)) : null;
    checkDeep('ie: the round-tripped operation is byte-identical', written && written.items[1], ops[1]);
    checkEq('ie: the imported file derives live operations', T.state.logicOps.length, 2);

    // --- comments/formatting survive save/load and import ------------------
    // In the current data model, "comments and formatting" live inside the
    // operation's raw `script` string (the editor stores the textarea text
    // verbatim; derived fields are rebuilt from it, never rewritten).
    const fScript = '# pick a weapon\n\n' +
      'SET x = ROLL ((30-50)) # damage\n' +
      'IF x > 45 THEN:\n' +
      '    SET label = "heavy" # branch\n' +
      'ELSE:\n' +
      '    SET label = "light"\n';
    const fOp = { id: 'op_f1111111', name: 'FScript', purpose: '', script: fScript, outputTemplate: '%label%', imports: [], exposed: [], occurrences: [], bindings: {} };
    const fText = T.serializeLogicOpsFile([fOp]);
    await T.state.storage.createFile('logic-ops/f-script.json', fText);
    T.state.files.set('logic-ops/f-script.json', { text: fText, parsed: JSON.parse(fText), error: null });
    T.derive();
    const fLoaded = T.state.logicOps.filter((o) => o.id === 'op_f1111111');
    checkEq('ie: F save/load derives one commented operation', fLoaded.length, 1);
    checkEq('ie: F the saved script is byte-identical (comments, blanks, blocks)',
      fLoaded.length === 1 ? fLoaded[0].script : null, fScript);
    const fParsed = T.parseLogicOpsBundle(JSON.stringify(T.buildLogicOpsBundle([fLoaded[0]])));
    check('ie: F the exported bundle parses', fParsed.ok === true);
    checkEq('ie: F the exported script is byte-identical',
      fParsed.ok && fParsed.operations.length === 1 ? fParsed.operations[0].script : null, fScript);

    // --- re-import: clashing names rename, clashing ids get fresh ids --------
    const again = T.planLogicOpsImport(T.parseLogicOpsBundle(JSON.stringify(bundle)).operations, T.state.logicOps);
    checkEq('ie: both re-imported names clash and are renamed', again.renamed.length, 2);
    checkDeep('ie: the first rename carries the imported suffix', again.renamed[0], { from: 'Attack', to: 'Attack (imported)' });
    checkDeep('ie: the second rename carries the imported suffix', again.renamed[1], { from: 'Loot', to: 'Loot (imported)' });
    checkEq('ie: both clashing ids are replaced', again.idChanges, 2);
    check('ie: both renamed operations carry fresh ids',
      /^op_[0-9a-f]{8}$/.test(again.operations[0].id) && /^op_[0-9a-f]{8}$/.test(again.operations[1].id));

    // --- id conflict: fresh id + refs rewritten -----------------------------
    const conflict = {
      kind: 'ttrpg-logic-ops',
      operations: [{ id: 'op_aaaaaaaa', name: 'Attack', purpose: 'CHANGED', script: 'SET dmg = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} }],
    };
    const plan = T.planLogicOpsImport(T.parseLogicOpsBundle(JSON.stringify(conflict)).operations, T.state.logicOps);
    check('ie: same id + different content gets a fresh id',
      plan.operations[0].id !== 'op_aaaaaaaa' && /^op_[0-9a-f]{8}$/.test(plan.operations[0].id));
    checkEq('ie: the id clash is counted once', plan.idChanges, 1);
    checkDeep('ie: the clashing name is renamed', plan.renamed[0], { from: 'Attack', to: 'Attack (imported)' });
    const refItems = [{
      name: 'G', template: '{Attack}', references: [],
      operations: [{ token: 'Attack', operationId: 'op_aaaaaaaa', operationName: 'Attack' }],
    }];
    const rewritten = T.remapOperationRefs(refItems, new Map([['op_aaaaaaaa', plan.operations[0].id]]));
    checkEq('ie: ref rewrite counts one reference', rewritten, 1);
    checkEq('ie: the ref points at the remapped id', refItems[0].operations[0].operationId, plan.operations[0].id);

    // --- name-only collision: renamed, never merged -------------------------
    const nameClash = {
      kind: 'ttrpg-logic-ops',
      operations: [{ id: 'op_99999999', name: 'Loot', purpose: 'other', script: 'SET x = 2', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} }],
    };
    const clash = T.planLogicOpsImport(T.parseLogicOpsBundle(JSON.stringify(nameClash)).operations, T.state.logicOps);
    checkEq('ie: a name-only collision is reported', clash.renamed.length, 1);
    checkDeep('ie: the colliding name gets the imported suffix', clash.renamed[0], { from: 'Loot', to: 'Loot (imported)' });
    checkEq('ie: a fresh id needs no id change', clash.idChanges, 0);

    // --- sniffKind ----------------------------------------------------------
    checkEq('ie: sniffKind sees the ops bundle tag',
      T.sniffKind({ kind: 'ttrpg-logic-ops', version: 1, operations: [] }), 'logic-ops');
    checkEq('ie: sniffKind sees a raw logic-ops file',
      T.sniffKind({ items: [{ name: 'X', script: 'SET x = 1' }] }), 'logic-ops');
    checkEq('ie: sniffKind still sees generators', T.sniffKind({ items: [{ name: 'G', template: 'x' }] }), 'generators');
    checkEq('ie: sniffKind keeps macros distinct', T.sniffKind({ items: [{ name: 'M', formula: '1d6' }] }), 'macros');
    checkEq('ie: sniffKind ignores junk', T.sniffKind({ items: [{ name: 'nope' }] }), null);

    // --- generator bundle carries the operations its items reference --------
    const genItem = {
      id: 'gen_1', name: 'Loot gen', template: '{Attack} and {Loot}', references: [],
      operations: [
        { token: 'Attack', operationId: 'op_aaaaaaaa', operationName: 'Attack' },
        { token: 'Loot', operationId: 'op_bbbbbbbb', operationName: 'Loot' },
      ],
    };
    const genBundle = T.buildGenExportPayload([genItem], { operations: T.state.logicOps });
    checkEq('ie: the generator bundle carries its operations',
      Array.isArray(genBundle.operations) ? genBundle.operations.length : -1, 2);
    checkDeep('ie: the carried operations keep their ids',
      genBundle.operations.map((o) => o.id), ['op_aaaaaaaa', 'op_bbbbbbbb']);
    checkDeep('ie: the generator item keeps its refs',
      genBundle.generators[0].operations.map((r) => r.operationId), ['op_aaaaaaaa', 'op_bbbbbbbb']);
    const genLinked = T.analyzeGenImportPayload(genBundle,
      { generators: [], containers: [], operations: T.state.logicOps, generatorFiles: [], sourceStem: 'gen-round-trip' });
    checkEq('ie: a generator bundle links ops already present',
      genLinked.operations.map((o) => o.status).join(','), 'identical,identical');
    const genFresh = T.analyzeGenImportPayload(genBundle,
      { generators: [], containers: [], operations: [], generatorFiles: [], sourceStem: 'gen-fresh' });
    checkEq('ie: a generator bundle on a fresh app imports its ops',
      genFresh.operations.filter((o) => o.status === 'new').length, 2);

    // --- step 4b: generator bundle + id remap, end to end -------------------
    // Fresh pool so these expectations do not depend on the sections above.
    memFiles.clear();
    T.state.files.clear();
    T.state.logicOps = [];
    const localSeed = [
      { id: 'op_11111111', name: 'Damage', purpose: 'local', script: 'SET dmg = 2d6', outputTemplate: '%dmg%', imports: [], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_22222222', name: 'MoodType', purpose: '', script: 'SET m = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ];
    const seedText = JSON.stringify({ items: localSeed }, null, 2) + '\n';
    memFiles.set('logic-ops/ie-local.json', seedText);
    T.state.files.set('logic-ops/ie-local.json', { text: seedText, parsed: JSON.parse(seedText), error: null });
    T.derive();
    checkEq('ie: the local operation pool is seeded', T.state.logicOps.length, 2);

    // Incoming bundle: Damage reuses a local id with DIFFERENT content (remap),
    // Luck is new, and the item's refs point at both.
    const genPayload = {
      kind: 'ttrpg-generators',
      version: 1,
      generators: [{
        id: 'gen_ie0001', name: 'IE Loot', description: '', template: '{Damage} {Luck}',
        references: [],
        operations: [
          { token: 'Damage', operationId: 'op_11111111', operationName: 'Damage' },
          { token: 'Luck', operationId: 'op_33333333', operationName: 'Luck' },
        ],
      }],
      operations: [
        { id: 'op_11111111', name: 'Damage', purpose: 'incoming', script: 'SET dmg = 1d8', outputTemplate: '%dmg%', imports: [], exposed: [], occurrences: [], bindings: {} },
        { id: 'op_33333333', name: 'Luck', purpose: 'reroll', script: 'SET l = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      ],
    };
    const genSnap = { generators: [], containers: [], operations: T.state.logicOps, generatorFiles: [], sourceStem: 'ie-gen' };
    const genPlan = T.analyzeGenImportPayload(genPayload, genSnap);
    checkEq('ie: gen bundle ops are decided id-first', genPlan.operations.map((o) => o.status).join(','), 'remap,new');
    checkEq('ie: the gen bundle remap keeps the old id on record',
      genPlan.remaps.length === 1 ? genPlan.remaps[0].id : null, 'op_11111111');
    const genReport = T.operationReportSuffix(genPlan);
    checkEq('ie: a gen-analysis remap reaches the report line', genReport.length, 1);
    check('ie: the gen report line names both ids and the operation',
      genReport.length === 1 && genReport[0].indexOf('op_11111111') !== -1
      && genReport[0].indexOf(genPlan.remaps[0].newId) !== -1
      && genReport[0].indexOf('Damage') !== -1);
    // The remap line already names the row: the local operation that holds the
    // name IS the remapped one, so a second "name conflict" line would report
    // one event twice. A name owned by a DIFFERENT local id is still a clash.
    const remapForeignName = T.planOperationsImport([
      { id: 'op_own00001', name: 'Spark', purpose: '', script: 'SET s = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ], [
      { id: 'op_own00001', name: 'Ember', purpose: '', script: 'SET e = 2', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_own00002', name: 'Spark', purpose: '', script: 'SET p = 3', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ]);
    check('ie: a remapped same-name row is not double-reported as a name conflict',
      genReport.every((line) => line.indexOf('name conflict') === -1)
      && remapForeignName.nameConflicts.length === 1
      && remapForeignName.nameConflicts[0].name === 'Spark');

    const genSummary = await T.applyGenImport(genPayload, genPlan, 'generators/ie-gen.json');
    check('ie: the generator import reports a summary', typeof genSummary === 'string' && genSummary !== '');
    check('ie: the generator import summary names the remap',
      String(genSummary).indexOf('id remap') !== -1
      && String(genSummary).indexOf(genPlan.remaps[0].newId) !== -1);
    const genOpsPath = 'logic-ops/ie-gen-ops.json';
    check('ie: the carried operations land in their own file', memFiles.has(genOpsPath));
    const genOpsWritten = memFiles.has(genOpsPath) ? JSON.parse(memFiles.get(genOpsPath)).items : [];
    checkEq('ie: both carried operations are written', genOpsWritten.length, 2);
    checkEq('ie: the conflicting operation is written under its fresh id',
      genOpsWritten[0].id, genPlan.remaps[0].newId);
    checkEq('ie: the fresh copy keeps the imported content', genOpsWritten[0].script, 'SET dmg = 1d8');
    checkEq('ie: the written operation carries no file key', Object.prototype.hasOwnProperty.call(genOpsWritten[0], 'file'), false);
    checkEq('ie: the written operation carries no index key', Object.prototype.hasOwnProperty.call(genOpsWritten[0], 'index'), false);
    checkEq('ie: the local operation is not overwritten',
      T.state.logicOps.filter((o) => o.id === 'op_11111111' && o.purpose === 'local').length, 1);
    const genFile = T.state.files.has('generators/ie-gen.json')
      ? JSON.parse(memFiles.get('generators/ie-gen.json')) : null;
    const genWrittenRefs = (genFile && genFile.items[0] && Array.isArray(genFile.items[0].operations))
      ? genFile.items[0].operations : [];
    checkEq('ie: the imported ref follows the remapped id',
      genWrittenRefs.length === 2 ? genWrittenRefs[0].operationId : null, genPlan.remaps[0].newId);
    checkEq('ie: an untouched ref keeps its id',
      genWrittenRefs.length === 2 ? genWrittenRefs[1].operationId : null, 'op_33333333');
    // Re-exporting the pool the import built: every carried operation matches
    // its own row, so the bundle links instead of remapping.
    const reExport = T.buildGenExportPayload(genFile.items, { operations: T.state.logicOps });
    const rePlan = T.analyzeGenImportPayload(reExport,
      { generators: [], containers: [], operations: T.state.logicOps, generatorFiles: [], sourceStem: 'ie-gen' });
    checkEq('ie: a re-exported bundle links every operation it carries',
      rePlan.operations.map((o) => o.status).join(','), 'identical,identical');

    // --- planner edges: duplicate id in one payload, missing id, invalid ----
    const dupe = T.planOperationsImport([
      { id: 'op_dupe0001', name: 'First', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_dupe0001', name: 'Second', purpose: '', script: 'SET b = 2', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ], []);
    checkEq('ie: a duplicated payload id keeps it on the first row', dupe.rows[0].newId, null);
    checkEq('ie: a duplicated payload id is remapped on the second', dupe.rows[1].status, 'remap');
    checkEq('ie: the duplicate remap is reported once', dupe.remaps.length, 1);

    const noId = T.planOperationsImport([{ name: 'NoId', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} }], []);
    checkEq('ie: an operation without an id is new', noId.rows[0].status, 'new');
    check('ie: a missing id is replaced with a fresh op_ id', /^op_[0-9a-f]{8}$/.test(String(noId.rows[0].newId)));

    const junk = T.planOperationsImport([{ script: 'SET a = 1' }], []);
    checkEq('ie: an unnamed operation is counted invalid', junk.rows.length === 1 ? junk.rows[0].status : null, 'invalid');

    const rawFile = T.parseLogicOpsBundle(JSON.stringify({ items: [
      { id: 'op_77777777', name: 'Raw', purpose: '', script: 'SET r = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }));
    checkEq('ie: a raw logic-ops file is not a bundle', rawFile.ok, false);
    checkEq('ie: the raw-file rejection is invalid-bundle',
      rawFile.errors.length === 1 ? rawFile.errors[0].kind : null, 'invalid-bundle');

    const missingScript = T.parseLogicOpsBundle(JSON.stringify({
      kind: 'ttrpg-logic-ops',
      operations: [{ id: 'op_88888888', name: 'NoScript', purpose: '', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} }],
    }));
    checkEq('ie: an op without a script is rejected at parse', missingScript.ok, false);
    check('ie: the rejection names the missing script',
      missingScript.errors.some((e) => e.message.indexOf('code is required.') !== -1));

    const objRefs = [{ operations: [
      { token: 'A', operationId: 'op_aaaa0001', operationName: 'A' },
      { token: 'B', operationId: 'op_keep0001', operationName: 'B' },
      { token: 'C' },
    ] }];
    checkEq('ie: a plain-object remap map rewrites matching refs',
      T.remapOperationRefs(objRefs, { op_aaaa0001: 'op_new00001' }), 1);
    checkEq('ie: refs outside the remap are untouched', objRefs[0].operations[1].operationId, 'op_keep0001');
    checkEq('ie: a ref without an id is untouched', objRefs[0].operations[2].operationId, undefined);

    const plainBundle = T.buildGenExportPayload(
      [{ name: 'Plain', template: 'no tokens here', operations: [] }], { operations: T.state.logicOps });
    check('ie: a generator bundle with no op refs omits the key',
      !Object.prototype.hasOwnProperty.call(plainBundle, 'operations'));

    // --- one payload id, two operations: the ref name picks the copy --------
    const dupPayload = [
      { id: 'op_shared01', name: 'One', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_shared01', name: 'Two', purpose: '', script: 'SET b = 2', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ];
    const dupPlan = T.planOperationsImport(dupPayload, []);
    checkEq('ie: the first copy of a shared payload id keeps it',
      dupPlan.rows[0].newId, null);
    const dupItems = [{ operations: [
      { token: 'One', operationId: 'op_shared01', operationName: 'One' },
      { token: 'Two', operationId: 'op_shared01', operationName: 'Two' },
      { token: 'Ghost', operationId: 'op_shared01', operationName: 'Ghost' },
    ] }];
    checkEq('ie: a shared payload id rewrites only the ref that names the remapped copy',
      T.remapOperationRefs(dupItems, new Map([['op_shared01', dupPlan.rows[1].newId]]), dupPlan.rows), 1);
    checkEq('ie: the ref named after the first copy keeps the old id',
      dupItems[0].operations[0].operationId, 'op_shared01');
    checkEq('ie: the ref named after the remapped copy moves with it',
      dupItems[0].operations[1].operationId, dupPlan.rows[1].newId);
    checkEq('ie: a ref that names neither copy is left alone',
      dupItems[0].operations[2].operationId, 'op_shared01');

    // --- same-name twins inside one payload are reported, not merged --------
    const twins = T.planOperationsImport([
      { id: 'op_twin0001', name: 'Twin', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_twin0002', name: 'twin', purpose: '', script: 'SET b = 2', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ], []);
    checkEq('ie: same-name twins keep their own rows', twins.rows.map((r) => r.status).join(','), 'new,new');
    checkEq('ie: same-name twins in one payload are both reported', twins.nameConflicts.length, 2);
    checkEq('ie: the twin report marks its source', twins.nameConflicts[0].source, 'payload');

    // A linking ('identical') row imports nothing, so it is not a twin.
    T.state.logicOps = [{
      id: 'op_twin0003', name: 'LinkTwin', purpose: '', script: 'SET a = 1',
      outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {},
    }];
    const linkTwin = T.planOperationsImport([
      { id: 'op_twin0003', name: 'LinkTwin', purpose: '', script: 'SET a = 1',
        outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      { id: 'op_twin0004', name: 'LinkTwin', purpose: 'other', script: 'SET a = 2',
        outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ], T.state.logicOps);
    checkEq('ie: the linking row is not reported as a twin', linkTwin.nameConflicts.length, 1);
    checkEq('ie: only the separately-imported twin is reported', linkTwin.nameConflicts[0].index, 1);

    // Two rows of one id group share a name: the ref cannot be placed.
    const ambRows = [
      { index: 0, id: 'op_amb00001', name: 'Amb', status: 'remap', newId: 'op_fresh001' },
      { index: 1, id: 'op_amb00001', name: 'Amb', status: 'remap', newId: 'op_fresh002' },
    ];
    const ambItems = [{ operations: [{ token: 'Amb', operationName: 'Amb', operationId: 'op_amb00001' }] }];
    checkEq('ie: two same-named rows with one id leave the ref alone',
      T.remapOperationRefs(ambItems, new Map([['op_amb00001', 'op_fresh002']]), ambRows), 0);
    checkEq('ie: the ambiguous ref keeps its id', ambItems[0].operations[0].operationId, 'op_amb00001');

    // Precedence is pinned: the recorded name wins over the token.
    const precItems = [{ operations: [{ token: 'One', operationName: 'Two', operationId: 'op_shared01' }] }];
    checkEq('ie: the recorded operation name wins over the token',
      T.remapOperationRefs(precItems, new Map([['op_shared01', dupPlan.rows[1].newId]]), dupPlan.rows), 1);
    checkEq('ie: the name-driven pick points at the remapped copy',
      precItems[0].operations[0].operationId, dupPlan.rows[1].newId);

    const staleItems = [{ operations: [{ token: 'Two', operationName: 'OldName', operationId: 'op_shared01' }] }];
    checkEq('ie: a stale name falls back to the token',
      T.remapOperationRefs(staleItems, new Map([['op_shared01', dupPlan.rows[1].newId]]), dupPlan.rows), 1);
    checkEq('ie: the token-matched ref moves to the remapped copy',
      staleItems[0].operations[0].operationId, dupPlan.rows[1].newId);

    // --- an invalid carried operation is counted in the gen report ----------
    const genInvalid = {
      kind: 'ttrpg-generators',
      version: 1,
      generators: [{ id: 'gen_ie0002', name: 'IE Bad Op', description: '', template: 'plain', references: [], operations: [] }],
      operations: [{ id: 'op_bad00001', script: 'SET a = 1' }],
    };
    const badPlan = T.analyzeGenImportPayload(genInvalid,
      { generators: [], containers: [], operations: T.state.logicOps, generatorFiles: [], sourceStem: 'ie-bad' });
    checkEq('ie: an unnamed carried operation is invalid in the gen plan',
      badPlan.operations[0].status, 'invalid');
    const badSummary = await T.applyGenImport(genInvalid, badPlan, 'generators/ie-bad.json');
    check('ie: the generator import summary counts the skipped operation',
      /skipped \(invalid\)/.test(String(badSummary)));

    const badOnly = { kind: 'ttrpg-generators', version: 1, operations: [{ id: 'op_bad00002', script: 'SET a = 1' }] };
    const badOnlyPlan = T.analyzeGenImportPayload(badOnly,
      { generators: [], containers: [], operations: T.state.logicOps, generatorFiles: [], sourceStem: 'ie-bad2' });
    const toastsBefore = sandbox.__toastLog.length;
    const badOnlySummary = await T.applyGenImport(badOnly, badOnlyPlan, 'generators/ie-bad2.json');
    const badOnlyToast = sandbox.__toastLog.length > toastsBefore
      ? String(sandbox.__toastLog[sandbox.__toastLog.length - 1][0]) : '';
    check('ie: an invalid-only bundle still reports the skip',
      badOnlySummary === null && /skipped \(invalid\)/.test(badOnlyToast));
    // --- C7a: generator bundle with occurrences + bindings, end to end ------
    // The remap must follow into the operations rows AND the op-kind
    // occurrence rows; instanceIds + bindings + mode survive; a ref that can
    // no longer resolve lands in unresolvedBindings, reported not masked.
    memFiles.clear();
    T.state.files.clear();
    T.state.logicOps = [];
    T.state.macros = [];
    const c7aSeed = JSON.stringify({ items: [
      { id: 'op_c7loc01', name: 'Damage', purpose: 'local', script: 'SET d = 0', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }, null, 2) + '\n';
    T.state.files.set('logic-ops/ie-c7a-local.json', { text: c7aSeed, parsed: JSON.parse(c7aSeed), error: null });
    T.derive();
    checkEq('ie: the C7a pool is seeded', T.state.logicOps.length, 1);

    const c7aItem = {
      id: 'gen_c7a001', name: 'C7 Loot', description: '', template: '{Damage} and {Ghost}',
      mode: 'advanced',
      references: [],
      operations: [
        { token: 'Damage', operationId: 'op_c7loc01', operationName: 'Damage' },
        { token: 'Ghost', operationId: 'op_ghost01', operationName: 'Ghost' },
      ],
      occurrences: [
        { instanceId: 'occ_c7a001', kind: 'op', token: 'Damage', refId: 'op_c7loc01', offset: 0 },
        { instanceId: 'occ_c7a002', kind: 'op', token: 'Ghost', refId: 'op_ghost01', offset: 13 },
      ],
      bindings: { occ_c7a001: 'dmg', occ_c7a002: 'ghostvar' },
      unresolvedBindings: [],
    };
    const c7aPayload = {
      kind: 'ttrpg-generators',
      version: 1,
      generators: [c7aItem],
      operations: [
        { id: 'op_c7loc01', name: 'Damage', purpose: 'incoming', script: 'SET d = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
      ],
    };
    const c7aPlan = T.analyzeGenImportPayload(c7aPayload,
      { generators: [], containers: [], operations: T.state.logicOps, generatorFiles: [], sourceStem: 'ie-c7a' });
    checkEq('ie: the C7a carried op is decided remap', c7aPlan.operations.map((o) => o.status).join(','), 'remap');
    const c7aSummary = await T.applyGenImport(c7aPayload, c7aPlan, 'generators/ie-c7a.json');
    check('ie: the C7a import summary counts the occurrence rewrite',
      String(c7aSummary).indexOf('occurrence ref rewritten') !== -1);
    const c7aFile = memFiles.has('generators/ie-c7a.json') ? JSON.parse(memFiles.get('generators/ie-c7a.json')) : null;
    const c7aWritten = c7aFile && c7aFile.items[0];
    check('ie: the C7a generator file was written', !!c7aWritten);
    checkEq('ie: the imported item keeps its advanced mode', c7aWritten ? c7aWritten.mode : null, 'advanced');
    const c7aOps = c7aWritten && Array.isArray(c7aWritten.operations) ? c7aWritten.operations : [];
    checkEq('ie: the imported op row follows the remapped id',
      c7aOps.length === 2 ? c7aOps[0].operationId : null, c7aPlan.remaps[0].newId);
    checkEq('ie: the ghost op row is left unresolved',
      c7aOps.length === 2 ? c7aOps[1].operationId : null, null);
    const c7aOccs = c7aWritten && Array.isArray(c7aWritten.occurrences) ? c7aWritten.occurrences : [];
    checkEq('ie: the imported item keeps its two occurrence rows', c7aOccs.length, 2);
    checkEq('ie: the kept occurrence follows the remapped refId',
      c7aOccs.length === 2 ? c7aOccs[0].refId : null, c7aPlan.remaps[0].newId);
    checkEq('ie: the kept occurrence keeps its instanceId',
      c7aOccs.length === 2 ? c7aOccs[0].instanceId : null, 'occ_c7a001');
    checkEq('ie: the ghost occurrence loses its refId',
      c7aOccs.length === 2 ? c7aOccs[1].refId : null, null);
    checkDeep('ie: the kept binding survives under its instanceId',
      c7aWritten ? c7aWritten.bindings : null, { occ_c7a001: 'dmg' });
    checkDeep('ie: the ghost binding is reported, not masked',
      c7aWritten ? c7aWritten.unresolvedBindings : null,
      [{ varName: 'ghostvar', reason: 'occurrence-deleted' }]);

    // --- C7b: tables bundle end to end: entry op ids remap, ops file written --
    memFiles.clear();
    T.state.files.clear();
    T.state.logicOps = [];
    T.state.macros = [];
    const c7bSeedText = JSON.stringify({ items: [
      { id: 'op_t111111', name: 'Damage', purpose: 'local', script: 'SET d = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }, null, 2) + '\n';
    T.state.files.set('logic-ops/c7b-local.json', { text: c7bSeedText, parsed: JSON.parse(c7bSeedText), error: null });
    const c7bSrc = { items: [
      { id: 'tbl_c7b001', name: 'C7 Loot Table', entries: [
        { label: '{Damage} hit', operations: [{ token: 'Damage', operationId: 'op_t111111', operationName: 'Damage' }] },
      ] },
    ] };
    const c7bSrcText = JSON.stringify(c7bSrc, null, 2) + '\n';
    T.state.files.set('tables/c7b-src.json', { text: c7bSrcText, parsed: JSON.parse(c7bSrcText), error: null });
    T.derive();
    checkEq('ie: the C7b pool is seeded', T.state.logicOps.length, 1);

    sandbox.__downloads.length = 0;
    T.exportAllTables();
    checkEq('ie: the tables export downloads one bundle', sandbox.__downloads.length, 1);
    const c7bBundle = sandbox.__downloads.length === 1 ? sandbox.__downloads[0][1] : null;
    checkEq('ie: the tables bundle carries the kind tag', c7bBundle ? c7bBundle.kind : null, 'ttrpg-tables');
    checkDeep('ie: the tables bundle carries the referenced operation',
      c7bBundle && Array.isArray(c7bBundle.operations) ? c7bBundle.operations.map((o) => o.id) : null,
      ['op_t111111']);

    // Import into a fresh app that owns the same id with different content.
    memFiles.clear();
    T.state.files.clear();
    T.state.logicOps = [];
    const c7bTargetText = JSON.stringify({ items: [
      { id: 'op_t111111', name: 'Damage', purpose: 'local', script: 'SET d = 99', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }, null, 2) + '\n';
    T.state.files.set('logic-ops/c7b-target.json', { text: c7bTargetText, parsed: JSON.parse(c7bTargetText), error: null });
    T.derive();
    const c7bSnap = T.tablesImportSnapshot('c7b-src.json');
    const c7bPlan = T.analyzeTablesImportPayload(c7bBundle, c7bSnap);
    checkEq('ie: the tables bundle op is decided id-first',
      c7bPlan.operations.map((o) => o.status).join(','), 'remap');
    checkEq('ie: the tables analysis records the old id on the remap',
      c7bPlan.remaps.length === 1 ? c7bPlan.remaps[0].id : null, 'op_t111111');
    checkEq('ie: the tables analysis carries the source stem', c7bPlan.sourceStem, 'c7b-src');
    const c7bSummary = await T.applyTablesImport(c7bBundle, c7bPlan);
    check('ie: the tables import summary names the remap',
      String(c7bSummary).indexOf('id remap') !== -1
      && String(c7bSummary).indexOf(c7bPlan.remaps[0].newId) !== -1);
    check('ie: the tables import summary counts the rewritten entry ref',
      String(c7bSummary).indexOf('operation ref rewritten') !== -1);
    const c7bOpsPath = 'logic-ops/c7b-src-ops.json';
    check('ie: the carried tables ops land in their own file', memFiles.has(c7bOpsPath));
    const c7bOpsWritten = memFiles.has(c7bOpsPath) ? JSON.parse(memFiles.get(c7bOpsPath)).items : [];
    checkEq('ie: the carried table operation is written under its fresh id',
      c7bOpsWritten.length === 1 ? c7bOpsWritten[0].id : null, c7bPlan.remaps[0].newId);
    checkEq('ie: the carried table operation keeps the imported content',
      c7bOpsWritten.length === 1 ? c7bOpsWritten[0].script : null, 'SET d = 1');
    checkEq('ie: the local table operation is not overwritten',
      T.state.logicOps.filter((o) => o.id === 'op_t111111' && o.purpose === 'local').length, 1);
    const c7bFile = memFiles.has('tables/c7b-src.json') ? JSON.parse(memFiles.get('tables/c7b-src.json')) : null;
    const c7bEntryOps = c7bFile && c7bFile.items[0] && Array.isArray(c7bFile.items[0].entries[0].operations)
      ? c7bFile.items[0].entries[0].operations : [];
    checkEq('ie: the entry-label op ref follows the remapped id',
      c7bEntryOps.length === 1 ? c7bEntryOps[0].operationId : null, c7bPlan.remaps[0].newId);

    // Re-exporting the pool the import built: the entry names an op the pool
    // already owns with identical content, so the bundle links, not remaps.
    sandbox.__downloads.length = 0;
    T.exportAllTables();
    const c7bReBundle = sandbox.__downloads.length === 1 ? sandbox.__downloads[0][1] : null;
    const c7bRePlan = T.analyzeTablesImportPayload(c7bReBundle, T.tablesImportSnapshot('c7b-src.json'));
    checkEq('ie: a re-exported tables bundle links its operation',
      c7bRePlan.operations.map((o) => o.status).join(','), 'identical');

    // --- C7c: pure remap edges ------------------------------------------------
    const occNoMap = [{ occurrences: [{ kind: 'op', token: 'A', refId: 'op_ocx001' }] }];
    checkEq('ie: no remap map rewrites no occurrences',
      T.remapGenOccurrenceRefs(occNoMap, new Map(), []), 0);
    const occMixed = [{ occurrences: [
      { kind: 'ref', token: 'Box', refId: 'tbl_ocx001' },
      { kind: 'op', token: 'A', refId: 'op_ocx001' },
    ] }];
    checkEq('ie: the occurrence remap rewrites only op-kind rows',
      T.remapGenOccurrenceRefs(occMixed, new Map([['op_ocx001', 'op_ocx002'], ['tbl_ocx001', 'tbl_ocx002']]), []), 1);
    checkEq('ie: the ref-kind occurrence keeps its container id',
      occMixed[0].occurrences[0].refId, 'tbl_ocx001');
    checkEq('ie: the op-kind occurrence follows the remap',
      occMixed[0].occurrences[1].refId, 'op_ocx002');

    const occDupRows = [
      { index: 0, id: 'op_ocdup01', name: 'One', status: 'new', newId: null },
      { index: 1, id: 'op_ocdup01', name: 'Two', status: 'remap', newId: 'op_ocdup02' },
    ];
    const occDupItems = [{ occurrences: [
      { kind: 'op', token: 'One', refId: 'op_ocdup01' },
      { kind: 'op', token: 'Two', refId: 'op_ocdup01' },
      { kind: 'op', token: 'Ghost', refId: 'op_ocdup01' },
    ] }];
    checkEq('ie: a shared payload id rewrites only the token-matched occurrence',
      T.remapGenOccurrenceRefs(occDupItems, new Map([['op_ocdup01', 'op_ocdup02']]), occDupRows), 1);
    checkEq('ie: the occurrence named after the first copy keeps the id',
      occDupItems[0].occurrences[0].refId, 'op_ocdup01');
    checkEq('ie: the occurrence named after the remapped copy moves with it',
      occDupItems[0].occurrences[1].refId, 'op_ocdup02');
    checkEq('ie: an occurrence naming neither copy is left alone',
      occDupItems[0].occurrences[2].refId, 'op_ocdup01');

    const occAmbRows = [
      { index: 0, id: 'op_ocamb01', name: 'Amb', status: 'remap', newId: 'op_ocfresh1' },
      { index: 1, id: 'op_ocamb01', name: 'Amb', status: 'remap', newId: 'op_ocfresh2' },
    ];
    const occAmbItems = [{ occurrences: [{ kind: 'op', token: 'Amb', refId: 'op_ocamb01' }] }];
    checkEq('ie: two same-named rows leave the occurrence alone',
      T.remapGenOccurrenceRefs(occAmbItems, new Map([['op_ocamb01', 'op_ocfresh2']]), occAmbRows), 0);

    const entryNoMap = { items: [{ entries: [{ operations: [{ token: 'A', operationId: 'op_enc001' }] }] }] };
    checkEq('ie: no remap map rewrites no entry rows',
      T.remapEntryOpRefs(entryNoMap, new Map(), []), 0);
    const entryPlain = { items: [{ entries: [
      { operations: [{ token: 'A', operationId: 'op_enc001', operationName: 'A' }] },
      { operations: [{ token: 'B', operationId: 'op_enc002', operationName: 'B' }] },
    ] }] };
    checkEq('ie: entry rows follow the remap map',
      T.remapEntryOpRefs(entryPlain, { op_enc001: 'op_enc003' }, []), 1);
    checkEq('ie: an entry ref outside the remap is untouched',
      entryPlain.items[0].entries[1].operations[0].operationId, 'op_enc002');
    checkEq('ie: the rewritten entry row points at the fresh id',
      entryPlain.items[0].entries[0].operations[0].operationId, 'op_enc003');

    const entryDupRows = [
      { index: 0, id: 'op_encedup1', name: 'One', status: 'new', newId: null },
      { index: 1, id: 'op_encedup1', name: 'Two', status: 'remap', newId: 'op_encedup2' },
    ];
    const entryDup = { items: [{ entries: [{ operations: [{ token: 'One', operationName: 'Two', operationId: 'op_encedup1' }] }] }] };
    checkEq('ie: the recorded operation name wins over the token for entry rows',
      T.remapEntryOpRefs(entryDup, new Map([['op_encedup1', 'op_encedup2']]), entryDupRows), 1);
    checkEq('ie: the name-driven entry row moves to the remapped copy',
      entryDup.items[0].entries[0].operations[0].operationId, 'op_encedup2');

    const identPlan = T.planOperationsImport([
      { file: 'logic-ops/other-machine-ops.json', index: 2, id: 'op_ident01', name: 'Same', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ], [
      { file: 'logic-ops/local-ops.json', index: 0, id: 'op_ident01', name: 'Same', purpose: '', script: 'SET a = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ]);
    checkEq('ie: same id + same content at a different file/index links identical',
      identPlan.rows[0].status, 'identical');
    checkEq('ie: the file/index difference produces no remap', identPlan.remaps.length, 0);

    // --- C7d: save/load round trip --------------------------------------------
    memFiles.clear();
    T.state.files.clear();
    T.state.logicOps = [];
    T.state.macros = [];
    const c7dItem = {
      id: 'gen_c7d001', name: 'Round Trip', description: '', template: 'x',
      mode: 'advanced',
      references: [],
      operations: [{ token: 'A', operationId: 'op_rdc001', operationName: 'A' }],
      occurrences: [{ instanceId: 'occ_rdc001', kind: 'op', token: 'A', refId: 'op_rdc001', offset: 0 }],
      bindings: { occ_rdc001: 'keepme' },
      unresolvedBindings: [],
    };
    const c7dText = JSON.stringify({ items: [c7dItem] }, null, 2) + '\n';
    T.state.files.set('generators/rd.json', { text: c7dText, parsed: JSON.parse(c7dText), error: null });
    await T.persistGeneratorFile('generators/rd.json');
    checkDeep('ie: the persisted generator file keeps the item verbatim',
      JSON.parse(memFiles.get('generators/rd.json')).items, [c7dItem]);
    await T.loadAllFiles();
    const c7dLoaded = T.state.files.has('generators/rd.json') ? T.state.files.get('generators/rd.json').parsed : null;
    checkDeep('ie: a fresh load restores the persisted item verbatim',
      c7dLoaded && c7dLoaded.items, [c7dItem]);
    checkEq('ie: the reloaded item keeps its mode',
      c7dLoaded && c7dLoaded.items[0] ? c7dLoaded.items[0].mode : null, 'advanced');

    // --- import strictness: unknown kind, version, per-op errors, missing refs ---
    // Validate imported scripts and references; report missing references
    // without silently substituting. No backward compatibility: unsupported or
    // outdated formats are rejected with a clear error, never silently
    // migrated or substituted.
    const sOp = { id: 'op_str0001', name: 'Strict', purpose: '', script: 'SET s = 1', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} };

    // unknown kind: the validator names it unknown-kind; the import rejects
    // with one generic message and migrates nothing (no partial import)
    const ukV = T.validateLogicOpsBundle({ kind: 'ttrpg-logic-ops-v1', operations: [sOp] });
    checkEq('ie: the validator flags an unknown kind as unknown-kind',
      ukV.ok === false && ukV.errors.length === 1 ? ukV.errors[0].kind : null, 'unknown-kind');
    checkEq('ie: the unknown-kind message is generic and clear',
      ukV.errors.length === 1 ? ukV.errors[0].message : null, 'kind must be "ttrpg-logic-ops".');
    const ukParse = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops-v1', operations: [sOp] }));
    checkEq('ie: an unknown kind is rejected on import', ukParse.ok, false);
    checkEq('ie: the unknown-kind rejection is one generic message',
      ukParse.errors.length === 1 ? ukParse.errors[0].kind : null, 'invalid-bundle');
    checkEq('ie: the unknown-kind import migrates nothing (no partial import)',
      ukParse.operations.length, 0);

    // v1-style bundle: carries a version field → rejected, never migrated
    const v1 = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', version: 1, operations: [sOp] }));
    checkEq('ie: a v1-style bundle carrying a version field is rejected', v1.ok, false);
    checkEq('ie: the version rejection names the version field',
      v1.errors.length === 1 ? v1.errors[0].message : null, 'unknown field "version".');
    checkEq('ie: the v1-style bundle is not silently migrated', v1.operations.length, 0);

    // missing required fields / invalid field types → per-op operations[i]: errors
    const noOpsArr = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: 'Attack' }));
    checkEq('ie: a non-array operations field is rejected as invalid-type',
      noOpsArr.ok === false && noOpsArr.errors.length === 1 ? noOpsArr.errors[0].kind : null, 'invalid-type');
    const noName = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: [
      { id: 'op_str0002', purpose: '', script: 'SET s = 2', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }));
    checkEq('ie: an op missing its name is rejected per-op',
      noName.ok === false && noName.errors.length === 1 ? noName.errors[0].kind : null, 'missing-field');
    checkEq('ie: the missing-name error is prefixed operations[0]:',
      noName.errors.length === 1 ? noName.errors[0].message : null, 'operations[0]: name is required.');
    const badImports = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: [
      { id: 'op_str0003', name: 'BadImports', purpose: '', script: 'SET s = 3', outputTemplate: '', imports: 'a', exposed: [], occurrences: [], bindings: {} },
    ] }));
    checkEq('ie: an invalid imports type is rejected per-op',
      badImports.errors.length === 1 ? badImports.errors[0].message : null, 'operations[0]: imports must be an array of names.');

    // no partial import: a valid op next to an invalid one changes nothing
    const mixed = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: [
      sOp,
      { id: 'op_str0004', purpose: '', script: 'SET s = 4', outputTemplate: '', imports: [], exposed: [], occurrences: [], bindings: {} },
    ] }));
    checkEq('ie: a bundle mixing valid and invalid ops imports nothing',
      mixed.ok === false && mixed.operations.length === 0, true);
    checkEq('ie: the mixed bundle reports the invalid op by index',
      mixed.errors.length === 1 ? mixed.errors[0].message : null, 'operations[1]: name is required.');

    // non-object / non-JSON payloads (the engine suite pins the same codec
    // edges; re-pinned here at the rollflow import entry point)
    const arrParse = T.parseLogicOpsBundle('[1,2]');
    checkEq('ie: a top-level array payload is rejected as invalid-bundle',
      arrParse.ok === false && arrParse.errors.length === 1 ? arrParse.errors[0].kind : null, 'invalid-bundle');
    const numParse = T.parseLogicOpsBundle(42);
    checkEq('ie: a non-text payload is rejected as invalid-json',
      numParse.ok === false && numParse.errors.length === 1 ? numParse.errors[0].kind : null, 'invalid-json');
    const vNonObj = T.validateLogicOpsBundle('not a bundle');
    checkEq('ie: a non-object bundle is invalid-type in the validator',
      vNonObj.ok === false && vNonObj.errors.length === 1 ? vNonObj.errors[0].kind : null, 'invalid-type');

    // missing references are reported on import, never silently substituted
    // logic-ops import (js/logic-ops.js): a binding naming an unknown instance
    const badBind = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: [
      { id: 'op_str0005', name: 'BadBind', purpose: '', script: 'SET x = 1', outputTemplate: '', imports: [], exposed: [],
        occurrences: [{ instanceId: 'occ_str001', token: 'x', refId: null, offset: 1 }],
        bindings: { occ_str001: 'x', ghost: 'y' } },
    ] }));
    checkEq('ie: a binding to an unknown instance is rejected at parse', badBind.ok, false);
    check('ie: the missing reference is named in the rejection',
      badBind.errors.some((e) => e.kind === 'unknown-binding-instance'
        && e.message === 'operations[0]: binding references unknown instanceId "ghost".'));
    checkEq('ie: the missing reference is reported, never substituted', badBind.operations.length, 0);

    // generator import (js/import-export.js): a reference to a missing container
    const ghostGen = {
      kind: 'ttrpg-generators',
      generators: [{
        id: 'gen_str001', name: 'Missing Ref', description: '', template: '[Nope]', mode: 'basic',
        references: [{ token: 'Nope', containerId: 'tbl_str001' }],
        operations: [],
      }],
    };
    const mrPlan = T.analyzeGenImportPayload(ghostGen,
      { generators: [], containers: [], operations: [], generatorFiles: [], sourceStem: 'ie-strict' });
    const mrGen = mrPlan.generators.length === 1 ? mrPlan.generators[0] : null;
    checkEq('ie: a missing container reference is reported on import',
      !!mrGen && mrGen.issues.some((i) => i.kind === 'missing-container' && i.token === 'Nope'), true);
    checkEq('ie: the missing-container report names the token',
      mrGen && mrGen.missing.length === 1 ? mrGen.missing[0] : null, 'Nope');
    checkEq('ie: the missing reference is flagged, not substituted (item kept)',
      mrGen ? mrGen.skip : null, false);
    const mrSummary = await T.applyGenImport(ghostGen, mrPlan, 'generators/ie-strict.json');
    check('ie: the generator import summary reports the kept reference',
      typeof mrSummary === 'string' && mrSummary.indexOf('kept with missing/empty containers') !== -1);
    const mrFile = memFiles.has('generators/ie-strict.json') ? JSON.parse(memFiles.get('generators/ie-strict.json')) : null;
    const mrRefs = mrFile && Array.isArray(mrFile.items[0].references) ? mrFile.items[0].references : [];
    check('ie: the imported item keeps its unresolved container reference',
      mrRefs.length === 1 && mrRefs[0].token === 'Nope' && mrRefs[0].containerId === null);

    // tables import (js/import-export.js): an entry ref naming no known operation
    const ghostTables = {
      kind: 'ttrpg-tables',
      files: { 'tables/ie-strict-ghost.json': { items: [{
        name: 'Ghost Table', entries: [{
          label: '{Ghost} hit',
          operations: [{ token: 'Ghost', operationId: 'op_str9999', operationName: 'Ghost' }],
        }] },
      ] } },
    };
    const ghostPlan = T.analyzeTablesImportPayload(ghostTables, T.tablesImportSnapshot('ie-strict-ghost.json'));
    checkEq('ie: a tables file with a dangling op ref still imports',
      ghostPlan.targetFiles.length === 1 ? ghostPlan.targetFiles[0].status : null, 'new');
    checkEq('ie: the dangling ref bundle carries no operations', ghostPlan.operations.length, 0);
    const ghostSummary = await T.applyTablesImport(ghostTables, ghostPlan);
    check('ie: the tables import completes without inventing operations',
      typeof ghostSummary === 'string' && T.state.logicOps.length === 0);
    const ghostFile = memFiles.has('tables/ie-strict-ghost.json') ? JSON.parse(memFiles.get('tables/ie-strict-ghost.json')) : null;
    const ghostEntry = ghostFile && Array.isArray(ghostFile.items[0].entries) && ghostFile.items[0].entries[0]
      ? ghostFile.items[0].entries[0] : null;
    const ghostRefs = ghostEntry && Array.isArray(ghostEntry.operations) ? ghostEntry.operations : [];
    check('ie: the dangling entry reference is kept, not substituted',
      ghostRefs.length === 1 && ghostRefs[0].token === 'Ghost' && ghostRefs[0].operationId === 'op_str9999');
  })();
}

// ------------------------------------ generator Basic/Advanced mode checks
// The per-generator mode defaults to 'basic', invalid modes are repaired,
// the editor toggle commits and persists, the two advanced-only panels gate
// on the mode, the mode round-trips export/import, and both modes run
// through the same engine (which never reads mode). The editor is driven
// through the real renderGenEditor on the probe's fake DOM.
function runGenModeChecks() {
  return (async () => {
    // --- fresh in-memory storage (same adapter as the import/export section)
    const memFiles = new Map();
    T.state.storage = {
      mode: 'test',
      async createFile(p, text) {
        if (memFiles.has(p)) throw new Error('File already exists');
        memFiles.set(p, text);
      },
      async writeFile(p, text) { memFiles.set(p, text); },
      async deleteFile(p) { memFiles.delete(p); },
      async listFiles() {
        const out = [];
        for (const [p, text] of memFiles) out.push([p, { text: text }]);
        return out;
      },
    };
    T.state.files.clear();
    T.state.logicOps = [];

    const seedFiles = {
      'generators/mode-new.json': { items: [] },
      'generators/mode-ed.json': { items: [{ id: 'gen_modeed1', name: 'Mode Ed', description: 'toggle test', template: 'You found [Chest].', references: [], mode: 'basic' }] },
      'generators/mode-eng.json': { items: [] },
      'tables/mode-chest.json': { items: [{ id: 'tbl_modec1', name: 'Chest', entries: [{ label: 'Gold', weight: 1 }, { label: 'Gem', weight: 1 }] }] },
    };
    for (const p of Object.keys(seedFiles)) {
      const text = JSON.stringify(seedFiles[p], null, 2) + '\n';
      memFiles.set(p, text);
      T.state.files.set(p, { text: text, parsed: JSON.parse(text), error: null });
    }
    // The blocked item lives in memory only: its file is never on disk, so a
    // blocked commit has nothing to write.
    T.state.files.set('generators/mode-blk.json', {
      text: '',
      parsed: { items: [{ id: 'gen_modeblk1', name: '', description: '', template: 'x', references: [], mode: 'basic' }] },
      error: null,
    });
    T.derive();

    // --- new items default to basic -----------------------------------------
    T.onAddGeneratorTo('generators/mode-new.json');
    const newGen = T.state.genEditor;
    check('gm: "Add generator" opens the editor on a fresh row',
      !!(newGen && newGen.file === 'generators/mode-new.json' && newGen.newGen === true));
    checkEq('gm: a fresh generator row defaults to basic mode', newGen && newGen.item ? newGen.item.mode : null, 'basic');
    await T.addGeneratorToFile('generators/mode-new.json', { name: 'Added', template: 'plain' });
    const newFile = memFiles.has('generators/mode-new.json') ? JSON.parse(memFiles.get('generators/mode-new.json')) : null;
    check('gm: the added generator is persisted as the only row',
      !!(newFile && newFile.items.length === 1 && newFile.items[0].name === 'Added'));
    checkEq('gm: the added generator is stored with basic mode', newFile && newFile.items.length === 1 ? newFile.items[0].mode : null, 'basic');
    checkEq('gm: the nameless skeleton is dropped from the parsed file',
      T.state.files.get('generators/mode-new.json').parsed.items.length, 1);

    // --- normalizeGeneratorItem repairs the mode field ----------------------
    const nBare = T.normalizeGeneratorItem({}, { macros: [] });
    checkEq('gm: normalize gives a bare item basic mode', nBare.mode, 'basic');
    checkDeep('gm: normalize ensures empty occurrences and unresolvedBindings',
      [nBare.occurrences, nBare.unresolvedBindings], [[], []]);
    checkDeep('gm: normalize gives a bare item an empty bindings map', nBare.bindings, {});
    checkEq('gm: normalize repairs an invalid mode to basic', T.normalizeGeneratorItem({ mode: 'supreme' }, { macros: [] }).mode, 'basic');
    checkEq('gm: normalize repairs a null mode to basic', T.normalizeGeneratorItem({ mode: null }, { macros: [] }).mode, 'basic');
    checkEq('gm: normalize keeps a valid basic mode', T.normalizeGeneratorItem({ mode: 'basic' }, { macros: [] }).mode, 'basic');
    checkEq('gm: normalize keeps a valid advanced mode', T.normalizeGeneratorItem({ mode: 'advanced' }, { macros: [] }).mode, 'advanced');
    const nSpanless = T.normalizeGeneratorItem({ template: 'plain text' }, { macros: [] });
    checkEq('gm: normalize runs the template path for a spanless template', nSpanless.mode, 'basic');
    checkDeep('gm: the spanless template derives no occurrences', nSpanless.occurrences, []);
    checkEq('gm: normalize passes a null item straight through', T.normalizeGeneratorItem(null, { macros: [] }), null);
    checkEq('gm: normalize leaves a non-object item untouched', T.normalizeGeneratorItem('x', { macros: [] }), 'x');

    // --- both modes share the engine path ------------------------------------
    const runEng = (mode) => {
      const it = {
        id: 'gen_modeeng1', name: 'Eng', description: '',
        template: 'You found [Chest].', references: [],
        occurrences: [], bindings: {}, unresolvedBindings: [],
      };
      if (mode !== undefined) it.mode = mode;
      sandbox.__setRng(seqRng([0.2]));
      T.runGenItem('generators/mode-eng.json', it);
      return { ok: T.state.genLastRun.ok, output: T.state.genLastRun.output, rolls: T.state.genLastRun.rolls };
    };
    const basicRun = runEng('basic');
    const advRun = runEng('advanced');
    const legRun = runEng(undefined);
    check('gm: the basic run succeeds', !!basicRun.ok);
    checkEq('gm: the basic run resolves the container roll', basicRun.output, 'You found Gold.');
    check('gm: the advanced run succeeds', !!advRun.ok);
    checkEq('gm: advanced mode produces the identical output', advRun.output, 'You found Gold.');
    checkDeep('gm: advanced mode rolls the identical dice', advRun.rolls, basicRun.rolls);
    checkEq('gm: a legacy modeless item produces the identical output', legRun.output, 'You found Gold.');
    checkDeep('gm: the modeless item rolls the identical dice', legRun.rolls, basicRun.rolls);
    sandbox.__setRng(sandbox.__origRandom);
    check('gm: the engine source never mentions a mode field',
      !/\bmode\b/.test(fs.readFileSync(path.join(ROOT, 'js', 'generator-engine.js'), 'utf8')));

    // --- the editor: toggle commits, persists, and gates the panels ---------
    const ed = T.state.files.get('generators/mode-ed.json').parsed.items[0];
    T.state.genEditor = { file: 'generators/mode-ed.json', item: ed, newGen: false };
    const box = T.__node('div');
    T.renderGenEditor(box, { file: 'generators/mode-ed.json', item: ed });
    const sel = box.querySelector('.gen-mode-select');
    check('gm: the editor renders a mode select', !!sel);
    checkEq('gm: the select starts on the item basic mode', sel ? sel.value : null, 'basic');
    const bindPanel = box.querySelector('.gen-bindings-panel');
    const prevPanel = box.querySelector('.gen-preview-panel');
    check('gm: basic mode hides the bindings panel', !!(bindPanel && bindPanel.hidden === true));
    check('gm: basic mode hides the preview panel', !!(prevPanel && prevPanel.hidden === true));

    sel.value = 'advanced';
    await T.__dispatch(sel, 'change');
    checkEq('gm: toggling to advanced commits the mode on the item', ed.mode, 'advanced');
    checkEq('gm: the toggle persists the advanced mode',
      memFiles.has('generators/mode-ed.json') ? JSON.parse(memFiles.get('generators/mode-ed.json')).items[0].mode : null, 'advanced');
    check('gm: advanced mode shows the bindings panel', !!(bindPanel && bindPanel.hidden === false));
    check('gm: advanced mode shows the preview panel', !!(prevPanel && prevPanel.hidden === false));
    checkEq('gm: the commit re-resolved the container reference', ed.references.length === 1 ? ed.references[0].containerId : null, 'tbl_modec1');
    checkEq('gm: the commit derived exactly one occurrence', ed.occurrences.length, 1);
    checkEq('gm: the occurrence points at the container id', ed.occurrences.length === 1 ? ed.occurrences[0].refId : null, 'tbl_modec1');
    const rows = bindPanel ? bindPanel.querySelectorAll('input.gen-binding-input') : [];
    checkEq('gm: advanced mode renders one binding row', rows.length, 1);
    const occId = rows.length === 1 ? (rows[0].dataset.occId || '') : '';
    check('gm: the binding row carries the occurrence id', occId !== '');
    const bindInp = rows.length === 1 ? rows[0] : null;
    if (bindInp) {
      bindInp.value = 'keepme';
      T.__dispatch(bindInp, 'input');
    }

    sel.value = 'basic';
    await T.__dispatch(sel, 'change');
    checkEq('gm: toggling back commits basic on the item', ed.mode, 'basic');
    checkEq('gm: the toggle back persists basic mode',
      memFiles.has('generators/mode-ed.json') ? JSON.parse(memFiles.get('generators/mode-ed.json')).items[0].mode : null, 'basic');
    check('gm: basic mode hides the bindings panel again', !!(bindPanel && bindPanel.hidden === true));
    check('gm: basic mode hides the preview panel again', !!(prevPanel && prevPanel.hidden === true));
    checkDeep('gm: the typed binding survives into the item', ed.bindings, { [occId]: 'keepme' });
    const edFileMid = memFiles.has('generators/mode-ed.json') ? JSON.parse(memFiles.get('generators/mode-ed.json')) : null;
    checkDeep('gm: the file stores the typed binding',
      edFileMid && Array.isArray(edFileMid.items) && edFileMid.items.length === 1 ? edFileMid.items[0].bindings : null,
      { [occId]: 'keepme' });
    checkEq('gm: the mode toggle leaves the template untouched', ed.template, 'You found [Chest].');
    checkEq('gm: the mode toggle leaves the reference untouched', ed.references.length === 1 ? ed.references[0].containerId : null, 'tbl_modec1');

    sel.value = 'advanced';
    await T.__dispatch(sel, 'change');
    checkEq('gm: re-toggling persists the advanced mode again',
      memFiles.has('generators/mode-ed.json') ? JSON.parse(memFiles.get('generators/mode-ed.json')).items[0].mode : null, 'advanced');
    check('gm: re-toggling shows the bindings panel', !!(bindPanel && bindPanel.hidden === false));
    checkEq('gm: the binding row still holds the typed value', bindInp ? bindInp.value : null, 'keepme');

    // --- an unnamed generator is blocked from persisting --------------------
    const blk = T.state.files.get('generators/mode-blk.json').parsed.items[0];
    const box3 = T.__node('div');
    T.state.genEditor = { file: 'generators/mode-blk.json', item: blk, newGen: false };
    T.renderGenEditor(box3, { file: 'generators/mode-blk.json', item: blk });
    const sel3 = box3.querySelector('.gen-mode-select');
    checkEq('gm: the unnamed editor starts on basic', sel3 ? sel3.value : null, 'basic');
    sel3.value = 'advanced';
    await T.__dispatch(sel3, 'change');
    checkEq('gm: the blocked toggle syncs the mode into memory', blk.mode, 'advanced');
    check('gm: the blocked toggle persists nothing', !memFiles.has('generators/mode-blk.json'));
    check('gm: the unnamed row stays in memory', T.state.files.get('generators/mode-blk.json').parsed.items.length === 1);
    const warn3 = box3.querySelector('.row-warn');
    check('gm: the blocked editor shows the name warning', !!(warn3 && warn3.hidden === false));

    // --- persistence across a full reload ------------------------------------
    await T.loadAllFiles();
    const reloaded = T.state.files.has('generators/mode-ed.json')
      ? T.state.files.get('generators/mode-ed.json').parsed.items[0] : null;
    check('gm: the reload re-reads the generator file', !!reloaded);
    checkEq('gm: the reloaded item keeps its advanced mode', reloaded ? reloaded.mode : null, 'advanced');
    checkDeep('gm: the reloaded item keeps its binding', reloaded ? reloaded.bindings : null, { [occId]: 'keepme' });
    checkEq('gm: the reloaded item keeps its template', reloaded ? reloaded.template : null, 'You found [Chest].');
    const box2 = T.__node('div');
    T.state.genEditor = { file: 'generators/mode-ed.json', item: reloaded, newGen: false };
    T.renderGenEditor(box2, { file: 'generators/mode-ed.json', item: reloaded });
    const sel2 = box2.querySelector('.gen-mode-select');
    checkEq('gm: the re-rendered select starts on advanced', sel2 ? sel2.value : null, 'advanced');
    const bindPanel2 = box2.querySelector('.gen-bindings-panel');
    check('gm: the re-rendered editor shows the bindings panel', !!(bindPanel2 && bindPanel2.hidden === false));
    const row2 = box2.querySelector('input.gen-binding-input');
    checkEq('gm: the binding row prefills the stored value', row2 ? row2.value : null, 'keepme');

    // --- the mode round-trips export and import ------------------------------
    const exportPayload = T.buildGenExportPayload([reloaded]);
    checkEq('gm: the export payload carries the generators kind tag', exportPayload.kind, 'ttrpg-generators');
    checkEq('gm: the export payload keeps the advanced mode',
      exportPayload.generators.length === 1 ? exportPayload.generators[0].mode : null, 'advanced');
    checkDeep('gm: the export copies the item verbatim',
      exportPayload.generators.length === 1 ? exportPayload.generators[0] : null, JSON.parse(JSON.stringify(reloaded)));

    const nomodePayload = {
      kind: 'ttrpg-generators',
      version: 1,
      generators: [{ id: 'gen_modenomode', name: 'NoMode', template: 'x' }],
      operations: [],
    };
    const nomodePlan = T.analyzeGenImportPayload(nomodePayload, {
      generators: [], containers: [], operations: T.state.logicOps,
      generatorFiles: [...memFiles.keys()].filter((p) => p.startsWith('generators/')),
      sourceStem: 'mode-nomode',
    });
    checkEq('gm: the modeless import plans exactly one generator', nomodePlan.generators.length, 1);
    const nomodeSummary = await T.applyGenImport(nomodePayload, nomodePlan, 'generators/mode-nomode.json');
    check('gm: the modeless import writes its target file', !!nomodeSummary && memFiles.has('generators/mode-nomode.json'));
    const nomodeFile = memFiles.has('generators/mode-nomode.json') ? JSON.parse(memFiles.get('generators/mode-nomode.json')) : null;
    checkEq('gm: the imported generator is normalized to basic mode',
      nomodeFile && Array.isArray(nomodeFile.items) && nomodeFile.items.length === 1 ? nomodeFile.items[0].mode : null, 'basic');
  })();
}

// ------------------------------------------------------------------ summary
runNewFileChecks()
  .then(() => runLogicChecks())
  .then(() => runGenOpChecks())
  .then(() => runEntryOpRefChecks())
  .then(() => runImportExportChecks())
  .then(() => runGenModeChecks())
  .then(() => {
    console.log(checks + ' checks / ' + passed + ' passed');
    process.exit(passed === checks ? 0 : 1);
  }).catch((e) => {
    console.error('FATAL: new-file/logic checks aborted: ' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  });

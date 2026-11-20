'use strict';
/*
 * ttrpg-engine-test.js — deterministic Node test harness for the TTRPG Tools
 * dice engine (app.js, old architecture). Zero npm dependencies.
 *
 * Technique: the app's <script src> sources (index.html, in document order)
 * are loaded verbatim into a fresh vm context with a minimal sandbox
 * (localStorage stub only; no document, so the boot guard at
 * the tail of app.js never fires). A probe appended to the source exports the
 * needed bindings and exposes a Math.random override (evaluate takes an rng
 * parameter; rollExpression uses the context Math.random at call time).
 *
 * Determinism: every roll uses an injected rng sequence; assertions are exact
 * (values, step strings, per-die structures, verbatim error messages).
 *
 * Run:  node ttrpg-engine-test.js
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
  if (cond) { passed++; }
  else { console.log('FAIL: ' + name); }
}

function checkEq(name, actual, expected) {
  checks++;
  if (actual === expected) { passed++; }
  else {
    console.log('FAIL: ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
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
  if (deepEq(actual, expected)) { passed++; }
  else {
    console.log('FAIL: ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function expectError(name, fn, expectedMsg) {
  checks++;
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) {
    console.log('FAIL: ' + name + ' — expected throw, none thrown');
  } else if (threw.message !== expectedMsg) {
    console.log('FAIL: ' + name + ' — expected "' + expectedMsg + '", got "' + threw.message + '"');
  } else { passed++; }
}

// ------------------------------------------------------------------- load app
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

// window -> sandbox so generator-engine.js's guarded `window.GeneratorEngine`
// export lands here (rollflow-test.js uses the same trick); genEngine() and
// the engine-dependent data-model tests below rely on it.
sandbox.window = sandbox;

const probe = [
  '',
  'globalThis.__T = { state: state, evaluate: evaluate, rollExpression: rollExpression, expressionHasKeep: expressionHasKeep, fmt: fmt, timeStamp: timeStamp, HISTORY_MAX: HISTORY_MAX, HISTORY_KEY: HISTORY_KEY };',
  'globalThis.__origRandom = Math.random;',
  'globalThis.__setRng = (fn) => { Math.random = fn; };',
  'globalThis.__T.parseEmbeds = parseEmbeds;',
  'globalThis.__T.resolveEmbed = resolveEmbed;',
  'globalThis.__T.findContainer = findContainer;',
  'globalThis.__T.parseTemplate = parseTemplate;',
  'globalThis.__T.classifyInline = classifyInline;',
  'globalThis.__T.runGenerator = runGenerator;',
  'globalThis.__T.weightedPickDistinct = weightedPickDistinct;',
  'globalThis.__T.validateGenerator = validateGenerator;',
  'globalThis.__T.resolveOperationRefs = resolveOperationRefs;',
  'globalThis.__T.executeOperation = executeOperation;',
  'globalThis.__T.LogicLanguage = globalThis.LogicLanguage;',
  'globalThis.__T.LogicEvaluator = globalThis.LogicEvaluator;',
  'globalThis.__T.GENERATOR_LIMITS = LIMITS;',
  'globalThis.__T.LOGIC_VALUE_KINDS = LOGIC_VALUE_KINDS;',
  'globalThis.__T.typedValueKind = typedValueKind;',
  'globalThis.__T.makeTypedValue = makeTypedValue;',
  'globalThis.__T.asNumberValue = asNumberValue;',
  'globalThis.__T.isLogicNumericText = isLogicNumericText;',
  'globalThis.__T.LOGIC_NUMERIC_FORMAT_RE = LOGIC_NUMERIC_FORMAT_RE;',
  'globalThis.__T.LOGIC_SCOPES = LOGIC_SCOPES;',
  'globalThis.__T.resolveVariable = resolveVariable;',
  'globalThis.__T.newOccurrenceId = newOccurrenceId;',
  'globalThis.__T.genTemplateOccurrences = genTemplateOccurrences;',
  'globalThis.__T.reconcileGeneratorOccurrences = reconcileGeneratorOccurrences;',
  'globalThis.__T.syncGeneratorRefs = syncGeneratorRefs;',
  'globalThis.__T.normalizeGeneratorItem = normalizeGeneratorItem;',
  'globalThis.__T.applyContainerRenameToOccurrences = applyContainerRenameToOccurrences;',
  'globalThis.__T.applyOpRenameToOccurrences = applyOpRenameToOccurrences;',
  'globalThis.__T.newOpId = newOpId;',
  'globalThis.__T.newOpOccurrenceId = newOpOccurrenceId;',
  'globalThis.__T.normalizeOpVarName = normalizeOpVarName;',
  'globalThis.__T.scriptStatementsOf = scriptStatementsOf;',
  'globalThis.__T.deriveScriptImports = deriveScriptImports;',
  'globalThis.__T.deriveScriptExposed = deriveScriptExposed;',
  'globalThis.__T.computeOpOccurrences = computeOpOccurrences;',
  'globalThis.__T.createLogicOperation = createLogicOperation;',
  'globalThis.__T.validateLogicOperation = validateLogicOperation;',
  'globalThis.__T.validateLogicOpsBundle = validateLogicOpsBundle;',
  'globalThis.__T.substituteOutputTemplate = substituteOutputTemplate;',
  'globalThis.__T.validateOutputTemplateDataflow = validateOutputTemplateDataflow;',
  'globalThis.__T.isScriptLogicOp = isScriptLogicOp;',
  'globalThis.__T.newLogicOpDraft = newLogicOpDraft;',
  'globalThis.__T.reconcileOpOccurrences = reconcileOpOccurrences;',
  'globalThis.__T.logicHighlightSpans = logicHighlightSpans;',
  'globalThis.__T.templateHighlightSpans = templateHighlightSpans;',
  'globalThis.__T.scriptEditorModel = scriptEditorModel;',
  'globalThis.__T.collectScriptNames = collectScriptNames;',
  'globalThis.__T.logicValidationReport = logicValidationReport;',
  'globalThis.__T.scriptGuaranteedNames = scriptGuaranteedNames;',
  'globalThis.__T.checkExposeDataflow = checkExposeDataflow;',
  'globalThis.__T.messageSegments = messageSegments;',
  'globalThis.__T.autocompleteSuggestions = autocompleteSuggestions;',
  'globalThis.__T.applyAutocomplete = applyAutocomplete;',
  'globalThis.__T.logicAutocompleteContext = logicAutocompleteContext;',
  'globalThis.__T.logicTestInputType = logicTestInputType;',
  'globalThis.__T.buildTestValues = buildTestValues;',
  'globalThis.__T.runLogicOpTest = runLogicOpTest;',
  'globalThis.__T.traceRows = traceRows;',
  'globalThis.__T.logicRunErrorMessage = logicRunErrorMessage;',
  'globalThis.__T.buildLogicOpsBundle = buildLogicOpsBundle;',
  'globalThis.__T.parseLogicOpsBundle = parseLogicOpsBundle;',
  'globalThis.__T.exportLogicOperation = exportLogicOperation;',
  'globalThis.__T.planLogicOpsImport = planLogicOpsImport;',
  'globalThis.__T.filterLogicOps = filterLogicOps;',
  'globalThis.__T.nextCopyName = nextCopyName;',
  'globalThis.__T.normalizeLogicOpInPlace = normalizeLogicOpInPlace;',
  'globalThis.__T.serializeLogicOpsFile = serializeLogicOpsFile;',
  'globalThis.__T.logicOpContentKey = logicOpContentKey;',
  'globalThis.__T.logicOpIsDirty = logicOpIsDirty;',
  'globalThis.__T.traceRowOf = traceRowOf;',
  'globalThis.__T.templateReferencedNames = templateReferencedNames;',
  'globalThis.__T.derive = derive;',
  'globalThis.__T.LOGIC_OPS_BUNDLE_KIND = LOGIC_OPS_BUNDLE_KIND;',
  '',
].join('\n');

let T;
try {
  vm.runInNewContext(appSource + '\n' + probe, sandbox, { filename: 'app.js' });
  T = sandbox.__T;
} catch (e) {
  console.log('FATAL: could not load app.js in vm context: ' + (e && e.message ? e.message : String(e)));
  process.exit(2);
}

check('load: app.js loaded and __T exported', !!T);
check('load: evaluate is a function', typeof T.evaluate === 'function');

// The app sets window.GeneratorEngine INSIDE the context's global at load
// time. That property is readable from the outer sandbox, but a `delete`
// from the outer object does not reach the context, so engine
// removal/restoration must be done by running code inside the context.
// (A property that pre-existed on the sandbox would be shared both ways.)
function withNoEngine(fn) {
  const saved = vm.runInNewContext('typeof window.GeneratorEngine === "object" && window.GeneratorEngine', sandbox) || null;
  if (saved) sandbox.__pbSavedEngine = saved;
  vm.runInNewContext('delete window.GeneratorEngine', sandbox);
  try {
    return fn();
  } finally {
    if (saved) {
      vm.runInNewContext('window.GeneratorEngine = window.__pbSavedEngine', sandbox);
      delete sandbox.__pbSavedEngine;
    }
  }
}

// ----------------------------------------------------------------- fmt / time
checkEq('fmt: integer', T.fmt(7), '7');
checkEq('fmt: half', T.fmt(2.5), '2.5');
checkEq('fmt: float noise 0.1+0.2', T.fmt(0.1 + 0.2), '0.3');
checkEq('fmt: negative', T.fmt(-2.5), '-2.5');
checkEq('fmt: repeating 1/3', T.fmt(1 / 3), '0.3333333333');
checkEq('fmt: trims trailing zeros', T.fmt(1234567.891), '1234567.891');
checkEq('fmt: NaN passthrough', T.fmt(NaN), 'NaN');
checkEq('fmt: Infinity passthrough', T.fmt(Infinity), 'Infinity');
checkEq('fmt: non-number string', T.fmt('x'), 'x');
checkEq('fmt: null string', T.fmt(null), 'null');
check('timeStamp: HH:MM:SS', /^\d{2}:\d{2}:\d{2}$/.test(T.timeStamp()));

// ------------------------------------------------------------- error battery
// Parse failures are prefixed: Can't parse "<clean>" — <msg>   (U+2014 em dash)
const P = (clean, msg) => "Can't parse \"" + clean + '" \u2014 ' + msg;
const E_EMPTY = 'Type a dice expression, e.g. 2d6 or 1d20+5';

expectError('err: empty string', () => T.evaluate(''), E_EMPTY);
expectError('err: whitespace only', () => T.evaluate('   '), E_EMPTY);
expectError('err: null input', () => T.evaluate(null), E_EMPTY);
expectError('err: 2d sides missing', () => T.evaluate('2d'), P('2d', 'expected a dice roll like 2d6 \u2014 sides are missing after "d"'));
expectError('err: d sides missing', () => T.evaluate('d'), P('d', 'expected a dice roll like 2d6 \u2014 sides are missing after "d"'));
expectError('err: +5 leading plus', () => T.evaluate('+5'), P('+5', 'expressions cannot start with "+"'));
expectError('err: -5 leading minus', () => T.evaluate('-5'), P('-5', 'expressions cannot start with "-"'));
expectError('err: 5 no dice', () => T.evaluate('5'), P('5', 'no dice \u2014 add a roll like 2d6'));
expectError('err: 3x trailing char', () => T.evaluate('3x'), P('3x', 'unexpected "x"'));
expectError('err: 1d20/0 div by zero', () => T.evaluate('1d20/0'), P('1d20/0', 'division by zero'));
expectError('err: 1.5d6 fractional count', () => T.evaluate('1.5d6'), P('1.5d6', 'dice count must be a whole number of at least 1 (e.g. 2d6)'));
expectError('err: 0d6 zero count', () => T.evaluate('0d6'), P('0d6', 'dice count must be a whole number of at least 1 (e.g. 2d6)'));
expectError('err: 2d0 zero sides', () => T.evaluate('2d0'), P('2d0', 'sides must be a whole number of at least 1'));
expectError('err: 1000001d6 count too large', () => T.evaluate('1000001d6'), P('1000001d6', 'dice count is too large'));
expectError('err: 2d6q unknown modifier q', () => T.evaluate('2d6q'), P('2d6q', 'unknown modifier "q" \u2014 supported modifiers: kh, kl, x, r, cs'));
expectError('err: 2d6k unknown modifier k', () => T.evaluate('2d6k'), P('2d6k', 'unknown modifier "k" \u2014 supported modifiers: kh, kl, x, r, cs'));
expectError('err: 2d6c unknown modifier c', () => T.evaluate('2d6c'), P('2d6c', 'unknown modifier "c" \u2014 supported modifiers: kh, kl, x, r, cs'));
expectError('err: 1d20r r double reroll', () => T.evaluate('1d20r r'), P('1d20r r', 'only one "r" is allowed per dice term (it rerolls once)'));
expectError('err: 2d6xx double explosion', () => T.evaluate('2d6xx'), P('2d6xx', 'only one "x" is allowed per dice term (one explosion chain)'));
expectError('err: 2d6kh3kl1 kh+kl clash', () => T.evaluate('2d6kh3kl1'), P('2d6kh3kl1', '"kh" and "kl" can\'t be combined on the same dice term'));
expectError('err: 2d6kh3cs5 kh+cs clash', () => T.evaluate('2d6kh3cs5'), P('2d6kh3cs5', '"kh" and "cs" can\'t be combined on the same dice term'));
expectError('err: 2d6khkh1 kh+kh clash', () => T.evaluate('2d6khkh1'), P('2d6khkh1', '"kh" and "kh" can\'t be combined on the same dice term'));
expectError('err: 2d6kh5 keep above dice', () => T.evaluate('2d6kh5'), P('2d6kh5', '"kh" wants to keep 5 but there are only 2 dice'));
expectError('err: 2d6cs7 target above max', () => T.evaluate('2d6cs7'), P('2d6cs7', '"cs" target 7 is above the max face (6)'));
expectError('err: 2d6kh missing keep number', () => T.evaluate('2d6kh'), P('2d6kh', '"kh" needs a number of dice to keep, e.g. 2d6kh1'));
expectError('err: 2d6kh0 keep number zero', () => T.evaluate('2d6kh0'), P('2d6kh0', 'keep number must be a whole number of at least 1'));
expectError('err: 2d6cs missing target', () => T.evaluate('2d6cs'), P('2d6cs', '"cs" needs a target number, e.g. 2d6cs5'));
expectError('err: 2d6.5 trailing .5', () => T.evaluate('2d6.5'), P('2d6.5', 'unexpected ".5"'));
expectError('err: (2d6) 6 trailing 6', () => T.evaluate('(2d6) 6'), P('(2d6) 6', 'unexpected "6"'));
expectError('err: (1d6 missing paren', () => T.evaluate('(1d6'), P('(1d6', 'missing closing ")"'));
expectError('err: 1d20 + . expected number', () => T.evaluate('1d20 + .'), P('1d20 + .', 'expected a number'));
expectError('err: 1d20+ unexpected end', () => T.evaluate('1d20+'), P('1d20+', 'unexpected end of expression'));
expectError('err: 2d6kh1.5 modifier number only digits', () => T.evaluate('2d6kh1.5'), P('2d6kh1.5', 'unexpected ".5"'));
expectError('err: 1d6x explosion cap', () => T.evaluate('1d6x', () => 5 / 6), P('1d6x', 'explosions exceeded the cap of 1000 extra rolls'));

// ---------------------------------------------------- values / steps / shapes
// seqRng: deterministic rng; last value repeats on overflow.
function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

{
  // 2d6 with faces 4,4
  const r = T.evaluate('2d6', seqRng([0.5, 0.5]));
  checkDeep('2d6: result keys', Object.keys(r).sort(), ['dice', 'steps', 'value']);
  checkEq('2d6: value', r.value, 8);
  checkDeep('2d6: steps', r.steps, ['2d6 = 4 + 4 = 8']);
  checkDeep('2d6: dice entry', r.dice[0], { text: '2d6', rolled: [4, 4], sum: 8 });
}

{
  // d20 (count defaults to 1) with face 20
  const r = T.evaluate('d20', seqRng([0.99999]));
  checkEq('d20: value', r.value, 20);
  checkDeep('d20: steps', r.steps, ['1d20 = 20']);
  checkDeep('d20: dice entry', r.dice[0], { text: '1d20', rolled: [20], sum: 20 });
}

{
  // 1d20+5: face 11
  const r = T.evaluate('1d20+5', seqRng([0.5]));
  checkEq('1d20+5: value', r.value, 16);
  checkDeep('1d20+5: steps', r.steps, ['1d20 = 11', '11 + 5 = 16']);
}

{
  // (1d10+1)*2: face 5
  const r = T.evaluate('(1d10+1)*2', seqRng([0.4]));
  checkEq('(1d10+1)*2: value', r.value, 12);
  checkDeep('(1d10+1)*2: steps', r.steps, ['1d10 = 5', '5 + 1 = 6', '6 \u00d7 2 = 12']);
}

{
  // 2d6*3+4: faces 4,4
  const r = T.evaluate('2d6*3+4', seqRng([0.5, 0.5]));
  checkEq('2d6*3+4: value', r.value, 28);
  checkDeep('2d6*3+4: steps', r.steps, ['2d6 = 4 + 4 = 8', '8 \u00d7 3 = 24', '24 + 4 = 28']);
}

{
  // 4d6/2: faces 3,4,4,4 -> odd total, fractional division (no floor)
  const r = T.evaluate('4d6/2', seqRng([2 / 6, 0.5, 0.5, 0.5]));
  checkEq('4d6/2: value', r.value, 7.5);
  checkDeep('4d6/2: steps', r.steps, ['4d6 = 3 + 4 + 4 + 4 = 15', '15 \u00f7 2 = 7.5']);
  checkEq('4d6/2: fmt of value', T.fmt(r.value), '7.5');
}

{
  // 1d6-1d6: faces 4,2 (U+2212 minus in steps)
  const r = T.evaluate('1d6-1d6', seqRng([0.5, 1 / 6]));
  checkEq('1d6-1d6: value', r.value, 2);
  checkDeep('1d6-1d6: steps', r.steps, ['1d6 = 4', '1d6 = 2', '4 \u2212 2 = 2']);
}

{
  // "2d6 6" — inner whitespace is stripped: parses as 2d66, faces 34,34
  const r = T.evaluate('2d6 6', seqRng([0.5, 0.5]));
  checkEq('2d6 6: value (2d66)', r.value, 68);
  checkDeep('2d6 6: steps', r.steps, ['2d66 = 34 + 34 = 68']);
}

{
  // 2d6+1d6: faces 4,4 and 4 — two dice entries
  const r = T.evaluate('2d6+1d6', seqRng([0.5, 0.5, 0.5]));
  checkEq('2d6+1d6: value', r.value, 12);
  checkDeep('2d6+1d6: steps', r.steps, ['2d6 = 4 + 4 = 8', '1d6 = 4', '8 + 4 = 12']);
  checkDeep('2d6+1d6: dice entries', r.dice, [
    { text: '2d6', rolled: [4, 4], sum: 8 },
    { text: '1d6', rolled: [4], sum: 4 },
  ]);
}

{
  // whitespace-tolerant: "1 d 2 0 + 5" behaves like 1d20+5
  const r = T.evaluate('1 d 2 0 + 5', seqRng([0.5]));
  checkEq('1 d 2 0 + 5: value', r.value, 16);
}

// ----------------------------------------------------------------- modifiers
{
  // 2d6r: die1 base 1 -> reroll 4; die2 4
  const r = T.evaluate('2d6r', seqRng([0, 0.5, 0.5]));
  checkEq('2d6r reroll: value', r.value, 8);
  checkDeep('2d6r reroll: steps', r.steps, ['2d6 = 1\u21924 (reroll) + 4 = 8']);
  checkEq('2d6r reroll: dice text', r.dice[0].text, '2d6r');
  checkEq('2d6r reroll: dice sum', r.dice[0].sum, 8);
  checkDeep('2d6r reroll: die1 (rerolled)', r.dice[0].dice[0], { base: 4, total: 4, orig: 1, rerolled: true, extras: [], tags: ['reroll'] });
  checkDeep('2d6r reroll: die2 (plain)', r.dice[0].dice[1], { base: 4, total: 4, orig: undefined, rerolled: false, extras: [], tags: [] });
}

{
  // 2d6r: no face of 1 -> no reroll, plain step
  const r = T.evaluate('2d6r', seqRng([0.5, 0.5]));
  checkEq('2d6r no-reroll: value', r.value, 8);
  checkDeep('2d6r no-reroll: steps', r.steps, ['2d6 = 4 + 4 = 8']);
  checkDeep('2d6r no-reroll: tags', r.dice[0].dice.map((d) => d.tags), [[], []]);
}

{
  // 1d6x: base 6 explodes, extra 4
  const r = T.evaluate('1d6x', seqRng([5 / 6, 0.5]));
  checkEq('1d6x single: value', r.value, 10);
  checkDeep('1d6x single: steps', r.steps, ['1d6 = 6 \u2192 6 exploded \u2192 + 4 = 10']);
  checkEq('1d6x single: dice text', r.dice[0].text, '1d6x');
  checkDeep('1d6x single: die', r.dice[0].dice[0], { base: 6, total: 10, orig: undefined, rerolled: false, extras: [4], tags: ['explosion'] });
}

{
  // 1d6x chain: 6 -> 6 -> extra 6 -> extra 3
  const r = T.evaluate('1d6x', seqRng([5 / 6, 5 / 6, 0.4]));
  checkEq('1d6x chain: value', r.value, 15);
  checkDeep('1d6x chain: steps', r.steps, ['1d6 = 6 \u2192 6 exploded \u2192 + 6 \u2192 6 exploded \u2192 + 3 = 15']);
  checkDeep('1d6x chain: extras', r.dice[0].dice[0].extras, [6, 3]);
}

{
  // 1d20x: base 20 explodes, extra 11
  const r = T.evaluate('1d20x', seqRng([0.99999, 0.5]));
  checkEq('1d20x: value', r.value, 31);
  checkDeep('1d20x: steps', r.steps, ['1d20 = 20 \u2192 20 exploded \u2192 + 11 = 31']);
}

{
  // 2d6kh1: faces 4,3 -> keep 4, discard 3
  const r = T.evaluate('2d6kh1', seqRng([0.5, 1 / 3]));
  checkEq('2d6kh1: value', r.value, 4);
  checkDeep('2d6kh1: steps', r.steps, ['2d6 = 4 + 3 \u2192 keep highest 1 (4), discarded: 3 = 4']);
  checkEq('2d6kh1: dice text', r.dice[0].text, '2d6kh1');
  checkDeep('2d6kh1: kept tags', r.dice[0].dice[0].tags, []);
  checkDeep('2d6kh1: discarded tags', r.dice[0].dice[1].tags, ['discarded']);
}

{
  // 2d6kl1: faces 4,3 -> keep 3, discard 4
  const r = T.evaluate('2d6kl1', seqRng([0.5, 1 / 3]));
  checkEq('2d6kl1: value', r.value, 3);
  checkDeep('2d6kl1: steps', r.steps, ['2d6 = 4 + 3 \u2192 keep lowest 1 (3), discarded: 4 = 3']);
  checkDeep('2d6kl1: discarded tags', r.dice[0].dice[0].tags, ['discarded']);
}

{
  // 2d6kh2: faces 3,4 -> keep both (no discarded fragment)
  const r = T.evaluate('2d6kh2', seqRng([0.4166, 0.5]));
  checkEq('2d6kh2: value', r.value, 7);
  checkDeep('2d6kh2: steps', r.steps, ['2d6 = 3 + 4 \u2192 keep highest 2 (4, 3) = 7']);
  checkDeep('2d6kh2: no discarded tags', r.dice[0].dice.map((d) => d.tags), [[], []]);
}

{
  // 2d6cs5: faces 5,4 -> one success
  const r = T.evaluate('2d6cs5', seqRng([4 / 6, 0.5]));
  checkEq('2d6cs5 success: value', r.value, 1);
  checkDeep('2d6cs5 success: steps', r.steps, ['2d6cs5: 1 of 2 dice rolled 5+ (5) \u2192 1']);
  checkEq('2d6cs5 success: dice text', r.dice[0].text, '2d6cs5');
  checkDeep('2d6cs5 success: success tag', r.dice[0].dice[0].tags, ['success']);
}

{
  // 2d6cs5: faces 4,3 -> zero successes (no value list)
  const r = T.evaluate('2d6cs5', seqRng([0.5, 1 / 3]));
  checkEq('2d6cs5 fail: value', r.value, 0);
  checkDeep('2d6cs5 fail: steps', r.steps, ['2d6cs5: 0 of 2 dice rolled 5+ \u2192 0']);
}

{
  // 2d6rx: r and x can combine; base 1 rerolled to 4, no explosion
  const r = T.evaluate('2d6rx', seqRng([0, 0.5, 0.5]));
  checkEq('2d6rx: value', r.value, 8);
  checkDeep('2d6rx: steps', r.steps, ['2d6 = 1\u21924 (reroll) + 4 = 8']);
  checkEq('2d6rx: dice text', r.dice[0].text, '2d6rx');
}

// -------------------------------------------------------------- rollExpression
// rollExpression has no rng parameter — override the context Math.random.
{
  sandbox.__setRng(seqRng([0.5, 0.5]));
  const r = T.rollExpression('2d6', 'normal');
  checkEq('rollExpr normal: value', r.value, 8);
  checkEq('rollExpr normal: mode', r.mode, 'normal');
  checkEq('rollExpr normal: one roll', r.rolls.length, 1);
  checkEq('rollExpr normal: rolls[0].value', r.rolls[0].value, 8);
}

{
  // advantage: first roll 8 (4,4), second roll 2 (1,1) -> max 8
  sandbox.__setRng(seqRng([0.5, 0.5, 0.1, 0.1]));
  const r = T.rollExpression('2d6', 'advantage');
  checkEq('rollExpr advantage: value', r.value, 8);
  checkEq('rollExpr advantage: mode', r.mode, 'advantage');
  checkEq('rollExpr advantage: two rolls', r.rolls.length, 2);
  checkEq('rollExpr advantage: rolls[0].value', r.rolls[0].value, 8);
  checkEq('rollExpr advantage: rolls[1].value', r.rolls[1].value, 2);
}

{
  // disadvantage: same two rolls -> min 2
  sandbox.__setRng(seqRng([0.5, 0.5, 0.1, 0.1]));
  const r = T.rollExpression('2d6', 'disadvantage');
  checkEq('rollExpr disadvantage: value', r.value, 2);
  checkEq('rollExpr disadvantage: mode', r.mode, 'disadvantage');
}

{
  // keep expression forces normal mode even in advantage
  sandbox.__setRng(seqRng([0.5, 1 / 3]));
  const r = T.rollExpression('2d6kh1', 'advantage');
  checkEq('rollExpr keep: forced normal', r.mode, 'normal');
  checkEq('rollExpr keep: one roll', r.rolls.length, 1);
  checkEq('rollExpr keep: value', r.value, 4);
}

{
  // unknown mode falls back to normal
  sandbox.__setRng(seqRng([0.5, 0.5]));
  const r = T.rollExpression('2d6', 'bogus');
  checkEq('rollExpr bogus mode: normal', r.mode, 'normal');
  checkEq('rollExpr bogus mode: value', r.value, 8);
}
sandbox.__setRng(sandbox.__origRandom);

// ---------------------------------------------------------- expressionHasKeep
checkEq('hasKeep: 2d6kh1', T.expressionHasKeep('2d6kh1'), true);
checkEq('hasKeep: 2d6kl1', T.expressionHasKeep('2d6kl1'), true);
checkEq('hasKeep: 2d6 plain', T.expressionHasKeep('2d6'), false);
checkEq('hasKeep: 2d6cs5 (cs does not count)', T.expressionHasKeep('2d6cs5'), false);
checkEq('hasKeep: (1d6kh1)+2', T.expressionHasKeep('(1d6kh1)+2'), true);
checkEq('hasKeep: 2d6q', T.expressionHasKeep('2d6q'), false);

// ------------------------------------------------------------ parseEmbeds
// Split |...| spans into flat segments . Never throws.
{
  const P = T.parseEmbeds;
  checkDeep('parseEmbeds: empty input', P(''), [{ type: 'text', text: '', start: 0 }]);
  checkDeep('parseEmbeds: no pipes', P('abc'), [{ type: 'text', text: 'abc', start: 0 }]);
  checkDeep('parseEmbeds: single embed', P('|1d4|'), [
    { type: 'embed', inner: '1d4', raw: '|1d4|', start: 0 },
  ]);
  checkDeep('parseEmbeds: empty span', P('||'), [
    { type: 'embed', inner: '', raw: '||', start: 0 },
  ]);
  checkDeep('parseEmbeds: inner kept untrimmed', P('| 1d4 |'), [
    { type: 'embed', inner: ' 1d4 ', raw: '| 1d4 |', start: 0 },
  ]);
  checkDeep('parseEmbeds: text around embed', P('a |1d4| b'), [
    { type: 'text', text: 'a ', start: 0 },
    { type: 'embed', inner: '1d4', raw: '|1d4|', start: 2 },
    { type: 'text', text: ' b', start: 7 },
  ]);
  checkDeep('parseEmbeds: two embeds', P('|1d4| and |2d6+3|'), [
    { type: 'embed', inner: '1d4', raw: '|1d4|', start: 0 },
    { type: 'text', text: ' and ', start: 5 },
    { type: 'embed', inner: '2d6+3', raw: '|2d6+3|', start: 10 },
  ]);
  checkDeep('parseEmbeds: adjacent spans', P('|a||b|'), [
    { type: 'embed', inner: 'a', raw: '|a|', start: 0 },
    { type: 'embed', inner: 'b', raw: '|b|', start: 3 },
  ]);
  checkDeep('parseEmbeds: unmatched trailing pipe is literal', P('abc|'), [
    { type: 'text', text: 'abc|', start: 0 },
  ]);
  checkDeep('parseEmbeds: unmatched leading pipe is literal', P('|abc'), [
    { type: 'text', text: '|abc', start: 0 },
  ]);
  checkDeep('parseEmbeds: scan continues after unmatched pipe', P('a|b|c'), [
    { type: 'text', text: 'a', start: 0 },
    { type: 'embed', inner: 'b', raw: '|b|', start: 1 },
    { type: 'text', text: 'c', start: 4 },
  ]);
  checkDeep('parseEmbeds: null input', P(null), [{ type: 'text', text: '', start: 0 }]);
  checkDeep('parseEmbeds: number input', P(42), [{ type: 'text', text: '', start: 0 }]);
}

// ---------------------------------------------------------- resolveEmbed
// ctx = { macros: [{name, formula}] in file order, evalExpr: fn(expr)->number }.
// diceCtx shares ONE rng stream across every embed, like the app's
// rollExpression wiring (Math.random at call time).
const diceCtx = (seq, macros) => {
  const rng = seqRng(seq);
  return { macros: macros || [], evalExpr: (expr) => T.evaluate(expr, rng).value };
};
{
  const R = T.resolveEmbed;
  const r1 = R('|1d4|', diceCtx([0.25], []));
  checkDeep('resolve: 1d4 @0.25', r1, { ok: true, output: '2', segments: [{ type: 'value', text: '2' }], errors: [] });
  const r2 = R('|1d4|', diceCtx([0.75], []));
  checkDeep('resolve: 1d4 @0.75', r2, { ok: true, output: '4', segments: [{ type: 'value', text: '4' }], errors: [] });
  const r3 = R('The party finds |2d6+3| gold pieces.', diceCtx([0.1], []));
  checkDeep('resolve: 2d6+3 @0.1, sentence passthrough', r3, {
    ok: true,
    output: 'The party finds 5 gold pieces.',
    segments: [
      { type: 'text', text: 'The party finds ' },
      { type: 'value', text: '5' },
      { type: 'text', text: ' gold pieces.' },
    ],
    errors: [],
  });
  const r4 = R('A |1d4| B |2d6+3| C', diceCtx([0.25, 0.5, 0.5], []));
  checkDeep('resolve: two embeds, exact text passthrough', r4, {
    ok: true,
    output: 'A 2 B 11 C',
    segments: [
      { type: 'text', text: 'A ' },
      { type: 'value', text: '2' },
      { type: 'text', text: ' B ' },
      { type: 'value', text: '11' },
      { type: 'text', text: ' C' },
    ],
    errors: [],
  });
  const r5 = R('|1d4| and |1d4|', diceCtx([0.25, 0.75], []));
  checkEq('resolve: two rolls draw in order', r5.output, '2 and 4');

  // macros
  const rm1 = R('|Sword|', diceCtx([0.5], [{ name: 'Sword', formula: '1d6' }]));
  checkDeep('resolve: macro exact match, paren-wrapped formula', rm1, {
    ok: true, output: '4', segments: [{ type: 'value', text: '4' }], errors: [],
  });
  checkEq('resolve: macro case-insensitive', R('|sword|', diceCtx([0.5], [{ name: 'Sword', formula: '1d6' }])).output, '4');
  const rm3 = R('|Sword 1d6|', diceCtx([0.5], [{ name: 'Sword', formula: '1d6' }]));
  checkEq('resolve: macro with remainder -> unresolved', rm3.ok, false);
  checkDeep('resolve: remainder error', rm3.errors, [{ kind: 'unresolved', token: '|Sword 1d6|', position: 0 }]);
  const rm4 = R('|Sword|', diceCtx([0.75], [
    { name: 'Sword', formula: '1d4' },
    { name: 'Sword', formula: '1d6' },
  ]));
  checkEq('resolve: duplicate macros, first by array order wins', rm4.output, '4');
  checkEq('resolve: compound macro formula', R('|Flee|', diceCtx([0.5], [{ name: 'Flee', formula: '1d6+2' }])).output, '6');
  const rm6 = R('You take |Bad| damage.', diceCtx([0.5], [{ name: 'Bad', formula: '2d' }]));
  checkEq('resolve: broken macro formula -> ok false', rm6.ok, false);
  checkDeep('resolve: broken macro error carries macroName', rm6.errors, [{ kind: 'invalid-expression', token: '|Bad|', position: 9, macroName: 'Bad' }]);
  checkDeep('resolve: broken macro segments', rm6.segments, [
    { type: 'text', text: 'You take ' },
    { type: 'error', text: '|Bad|' },
    { type: 'text', text: ' damage.' },
  ]);

  // dice failures -> unresolved (terminal)
  checkDeep('resolve: bare text -> unresolved', R('|abc|', diceCtx([0.5], [])).errors, [{ kind: 'unresolved', token: '|abc|', position: 0 }]);
  checkEq('resolve: 1d -> unresolved', R('|1d|', diceCtx([0.5], [])).ok, false);

  // empty span -> malformed
  const mf = R('a || b', diceCtx([0.5], []));
  checkDeep('resolve: empty span -> malformed', mf.errors, [{ kind: 'malformed', token: '||', position: 2 }]);
  checkDeep('resolve: empty span segments keep raw span', mf.segments, [
    { type: 'text', text: 'a ' },
    { type: 'error', text: '||' },
    { type: 'text', text: ' b' },
  ]);
  checkEq('resolve: empty span output', mf.output, 'a || b');

  // all-or-nothing: a failed span taints ok, even after a success
  const mm = R('|1d4| and |1d|', diceCtx([0.25, 0.5], []));
  checkEq('resolve: mixed -> ok false', mm.ok, false);
  checkEq('resolve: mixed output', mm.output, '2 and |1d|');
  checkDeep('resolve: mixed segments', mm.segments, [
    { type: 'value', text: '2' },
    { type: 'text', text: ' and ' },
    { type: 'error', text: '|1d|' },
  ]);

  // ctx guards: the engine never throws on a bad ctx
  const n1 = T.resolveEmbed('|1d4|');
  checkEq('resolve: no ctx -> unresolved', n1.ok, false);
  checkDeep('resolve: no ctx error', n1.errors, [{ kind: 'unresolved', token: '|1d4|', position: 0 }]);
  const n2 = T.resolveEmbed('|Sword|', { macros: [{ name: 'Sword', formula: '1d6' }] });
  checkDeep('resolve: macro without evalExpr -> invalid-expression', n2.errors, [{ kind: 'invalid-expression', token: '|Sword|', position: 0, macroName: 'Sword' }]);
  const n3 = T.resolveEmbed('|1d4|', { macros: [], evalExpr: 42 });
  checkEq('resolve: non-function evalExpr -> unresolved', n3.ok, false);
  checkEq('resolve: non-function evalExpr kind', n3.errors[0].kind, 'unresolved');

  // degenerate inputs & passthrough
  checkDeep('resolve: no spans passes through', R('plain text', diceCtx([0.5], [])), { ok: true, output: 'plain text', segments: [{ type: 'text', text: 'plain text' }], errors: [] });
  checkDeep('resolve: empty string', R('', diceCtx([0.5], [])), { ok: true, output: '', segments: [{ type: 'text', text: '' }], errors: [] });
  checkEq('resolve: null input ok', T.resolveEmbed(null, diceCtx([0.5], [])).ok, true);
  const m2 = R('|1d| and ||', diceCtx([0.5], []));
  checkEq('resolve: two failures accumulate', m2.errors.length, 2);
  checkEq('resolve: first failure kind', m2.errors[0].kind, 'unresolved');
  checkEq('resolve: second failure kind', m2.errors[1].kind, 'malformed');
  checkEq('resolve: second failure position', m2.errors[1].position, 9);
}

{
  // roll bar mode flows through the ctx: advantage takes the better of two
  // draws from the shared stream
  sandbox.__setRng(seqRng([0.1, 0.8]));
  const ctxA = { macros: [], evalExpr: (expr) => T.rollExpression(expr, 'advantage').value };
  const rA = T.resolveEmbed('|1d20|', ctxA);
  checkEq('resolve: advantage ctx (max of two draws)', rA.output, '17');
  checkEq('resolve: advantage ctx ok', rA.ok, true);
  sandbox.__setRng(sandbox.__origRandom);
}

// ------------------- template embeds,: ((...)) inline spans
// The same left-to-right scan recognizes |...| and ((...)). At each position
// the earliest opener wins, so neither delimiter can start inside the other:
// the span's content is literal data. No nesting of any kind; single parens
// are never an opener; an unmatched opener stays literal.
{
  checkDeep('parseEmbeds: ((a|b)) is one inline span', T.parseEmbeds('((a|b))'), [
    { type: 'inline', inner: 'a|b', raw: '((a|b))', start: 0 },
  ]);
  checkDeep('parseEmbeds: prose parens stay text', T.parseEmbeds('Prose (page 5)'), [
    { type: 'text', text: 'Prose (page 5)', start: 0 },
  ]);
  checkDeep('parseEmbeds: (single) stays text', T.parseEmbeds('(single)'), [
    { type: 'text', text: '(single)', start: 0 },
  ]);
  checkDeep('parseEmbeds: a single ( never opens a span', T.parseEmbeds('(a|b)'), [
    { type: 'text', text: '(a|b)', start: 0 },
  ]);
  checkDeep('parseEmbeds: text + inline + text', T.parseEmbeds('a (b) ((c)) d'), [
    { type: 'text', text: 'a (b) ', start: 0 },
    { type: 'inline', inner: 'c', raw: '((c))', start: 6 },
    { type: 'text', text: ' d', start: 11 },
  ]);
  checkDeep('parseEmbeds: earliest opener wins (| before (( )', T.parseEmbeds('a |1d4| ((x|y))'), [
    { type: 'text', text: 'a ', start: 0 },
    { type: 'embed', inner: '1d4', raw: '|1d4|', start: 2 },
    { type: 'text', text: ' ', start: 7 },
    { type: 'inline', inner: 'x|y', raw: '((x|y))', start: 8 },
  ]);
  checkDeep('parseEmbeds: (( before | swallows it as data', T.parseEmbeds('((x |1d4| y))'), [
    { type: 'inline', inner: 'x |1d4| y', raw: '((x |1d4| y))', start: 0 },
  ]);
  checkDeep('parseEmbeds: unmatched (( literal, scan continues', T.parseEmbeds('((a |1d4|'), [
    { type: 'text', text: '((a ', start: 0 },
    { type: 'embed', inner: '1d4', raw: '|1d4|', start: 4 },
  ]);
  checkDeep('parseEmbeds: unmatched (( at end stays text', T.parseEmbeds('x ((y'), [
    { type: 'text', text: 'x ((y', start: 0 },
  ]);
  checkDeep('parseEmbeds: adjacent inline spans', T.parseEmbeds('((a))((b))'), [
    { type: 'inline', inner: 'a', raw: '((a))', start: 0 },
    { type: 'inline', inner: 'b', raw: '((b))', start: 5 },
  ]);
  checkDeep('parseEmbeds: single ) inside (( )) is data', T.parseEmbeds('((a)b))'), [
    { type: 'inline', inner: 'a)b', raw: '((a)b))', start: 0 },
  ]);
  checkDeep('parseEmbeds: (( inside a pipe span is data', T.parseEmbeds('|a ((b)) c|'), [
    { type: 'embed', inner: 'a ((b)) c', raw: '|a ((b)) c|', start: 0 },
  ]);
  checkDeep('parseEmbeds: trailing text after inline span', T.parseEmbeds('((a)) tail'), [
    { type: 'inline', inner: 'a', raw: '((a))', start: 0 },
    { type: 'text', text: ' tail', start: 5 },
  ]);
  checkDeep('parseEmbeds: ((( terminates as one text run', T.parseEmbeds('((('), [
    { type: 'text', text: '(((', start: 0 },
  ]);
  checkDeep('parseEmbeds: unmatched | then (( is still found', T.parseEmbeds('|((a))'), [
    { type: 'text', text: '|', start: 0 },
    { type: 'inline', inner: 'a', raw: '((a))', start: 1 },
  ]);
}

// ctx whose pick rng and dice rng share ONE stream, so draws land in
// left-to-right span order exactly like production (Math.random).
const pickCtx = (seq) => {
  const rng = seqRng(seq);
  return { macros: [], evalExpr: (expr) => T.evaluate(expr, rng).value, rng: rng };
};

{
  const R = T.resolveEmbed;
  checkEq('inline range: ((1-3)) rng 0 -> 1', R('((1-3))', pickCtx([0])).output, '1');
  const one = R('((1-3))', pickCtx([0]));
  checkEq('inline range: ok', one.ok, true);
  checkDeep('inline range: pick segment', one.segments, [{ type: 'pick', text: '1' }]);
  checkEq('inline range: ((1-3)) rng 0.5 -> 2', R('((1-3))', pickCtx([0.5])).output, '2');
  checkEq('inline range: ((1-3)) rng 0.999 -> 3', R('((1-3))', pickCtx([0.999])).output, '3');
  checkEq('inline range: ((15-20)) rng 0 -> 15', R('((15-20))', pickCtx([0])).output, '15');
  checkEq('inline range: ((15-20)) rng 0.999 -> 20', R('((15-20))', pickCtx([0.999])).output, '20');
  checkEq('inline range: ((1-6)) rng 0.5 -> 4', R('((1-6))', pickCtx([0.5])).output, '4');
  checkEq('inline range: ((5-5)) -> 5', R('((5-5))', pickCtx([0.7])).output, '5');
  checkEq('inline range: ((-3-5)) rng 0 -> -3', R('((-3-5))', pickCtx([0])).output, '-3');
  checkEq('inline range: ((-3-5)) rng 0.999 -> 5', R('((-3-5))', pickCtx([0.999])).output, '5');
  checkEq('inline range: (( 7 - 9 )) spaces inside ok', R('(( 7 - 9 ))', pickCtx([0])).output, '7');

  const rev = R('((5-1))', pickCtx([0.5]));
  checkEq('inline range: reversed ok false', rev.ok, false);
  checkEq('inline range: reversed kind', rev.errors[0].kind, 'reversed-range');
  checkEq('inline range: reversed token', rev.errors[0].token, '((5-1))');
  checkEq('inline range: reversed position', rev.errors[0].position, 0);
  checkEq('inline range: reversed error segment', rev.segments[0].type, 'error');
  checkEq('inline range: reversed error text is raw', rev.segments[0].text, '((5-1))');

  for (const src of ['((1.5-3))', '((1 -))', '((1-3-5))']) {
    const bad = R(src, pickCtx([0.5]));
    checkEq('inline range: ' + src + ' -> invalid-range', bad.errors.length ? bad.errors[0].kind : null, 'invalid-range');
  }

  checkEq('inline single: ((well-known)) -> pick', R('((well-known))', pickCtx([0.5])).output, 'well-known');
  checkEq('inline single: ((Gold)) -> Gold', R('((Gold))', pickCtx([0.5])).output, 'Gold');
  checkEq('inline single: ((Gold)) segment type', R('((Gold))', pickCtx([0.5])).segments[0].type, 'pick');
}

{
  const R = T.resolveEmbed;
  checkEq('inline choice: ((A|B|C)) rng 0 -> A', R('((A|B|C))', pickCtx([0])).output, 'A');
  checkEq('inline choice: rng 0.5 -> B', R('((A|B|C))', pickCtx([0.5])).output, 'B');
  checkEq('inline choice: rng 0.999 -> C', R('((A|B|C))', pickCtx([0.999])).output, 'C');
  checkEq('inline choice: rng()===1 clamped to last', R('((A|B|C))', pickCtx([1])).output, 'C');
  checkEq('inline choice: options trimmed (first)', R('(( Gold | Bronze ))', pickCtx([0])).output, 'Gold');
  checkEq('inline choice: options trimmed (last)', R('(( Gold | Bronze ))', pickCtx([0.999])).output, 'Bronze');

  const m1 = R('((a||b))', pickCtx([0]));
  checkEq('inline choice: ((a||b)) malformed', m1.errors[0].kind, 'malformed');
  checkEq('inline choice: ((a||b)) raw token', m1.errors[0].token, '((a||b))');
  checkEq('inline choice: (( | )) malformed', R('(( | ))', pickCtx([0])).errors[0].kind, 'malformed');
  checkEq('inline choice: (()) malformed', R('(())', pickCtx([0])).errors[0].kind, 'malformed');
  checkEq('inline choice: ((   )) malformed', R('((   ))', pickCtx([0])).errors[0].kind, 'malformed');
  checkEq('inline single: ((Only)) -> Only', R('((Only))', pickCtx([0])).output, 'Only');

 // Weighted inline choices (parity with the logic-op ROLL syntax): each
  // option is `label` or `label:weight` (default weight 1), drawn with the
  // same pickWeightedEntry scheme table entries use; only the label is ever
  // emitted, so the weight suffix must not leak into the output.
  const wsrc = '((Gold|Silver:2|Bronze:3))'; // total weight 6
  checkEq('inline weighted: rng 0 -> Gold', R(wsrc, pickCtx([0])).output, 'Gold');
  checkEq('inline weighted: rng 0.25 -> Silver', R(wsrc, pickCtx([0.25])).output, 'Silver');
  checkEq('inline weighted: rng 0.5 -> Bronze', R(wsrc, pickCtx([0.5])).output, 'Bronze');
  checkEq('inline weighted: rng 0.999 -> Bronze', R(wsrc, pickCtx([0.999])).output, 'Bronze');
  checkEq('inline weighted: rng()===1 falls back to last', R(wsrc, pickCtx([1])).output, 'Bronze');
  checkDeep('inline weighted: pick segment carries the label only', R(wsrc, pickCtx([0.25])).segments, [{ type: 'pick', text: 'Silver' }]);

  // Unweighted entries keep default weight 1, so a uniform choice is
  // unchanged; mixed lists weight accordingly.
  checkEq('inline weighted: unweighted options stay uniform', R('((A|B|C))', pickCtx([0.5])).output, 'B');
  checkEq('inline weighted: mixed A:1 B:2 rng 0 -> A', R('((A|B:2))', pickCtx([0])).output, 'A');
  checkEq('inline weighted: mixed A:1 B:2 rng 0.4 -> B', R('((A|B:2))', pickCtx([0.4])).output, 'B');
  checkEq('inline weighted: mixed rng()===1 falls back to last', R('((A|B:2))', pickCtx([1])).output, 'B');

  // Zero weights are skipped (like table entries); all-zero has nothing to
  // pick and is malformed.
  checkEq('inline weighted: zero-weight option skipped', R('((A:0|B))', pickCtx([0.999])).output, 'B');
  checkEq('inline weighted: all-zero weights malformed', R('((A:0|B:0))', pickCtx([0])).errors[0].kind, 'malformed');

  // Bad weights are malformed: non-integer, empty weight, empty label,
  // negative, or a second colon.
  for (const bad of ['((A|B:two))', '((A:|B))', '((:1|B))', '((A:-1|B))', '((A:1:2|B))']) {
    const b = R(bad, pickCtx([0]));
    checkEq('inline weighted: ' + bad + ' -> malformed', b.errors.length ? b.errors[0].kind : null, 'malformed');
  }
  checkEq('inline weighted: bad weight keeps the raw token', R('((A|B:two))', pickCtx([0])).errors[0].token, '((A|B:two))');
  checkEq('inline weighted: bad weight fails the run', R('((A|B:two))', pickCtx([0])).ok, false);
}

{
  const R = T.resolveEmbed;
  const two = R('((A|B)) and ((C|D))', pickCtx([0, 0.999]));
  checkEq('inline: two choices independent', two.output, 'A and D');
  checkDeep('inline: two pick segments', two.segments, [
    { type: 'pick', text: 'A' }, { type: 'text', text: ' and ' }, { type: 'pick', text: 'D' },
  ]);
  const mixed = R('|1d4| ((A|B))', pickCtx([0.25, 0.999]));
  checkEq('inline: mixed dice then choice, left to right', mixed.output, '2 B');
  checkDeep('inline: mixed segment types', mixed.segments.map((s) => s.type), ['value', 'text', 'pick']);
  checkEq('inline: surrounding text exact', R('X ((A|B)) Y', pickCtx([0])).output, 'X A Y');
  {
    // two spans, but only the choice may draw: draw count must be exactly 1
    const stream = seqRng([0.999]);
    let draws = 0;
    const counting = () => { draws++; return stream(); };
    const only = R('((Only)) ((A|B))', { macros: [], evalExpr: () => 0, rng: counting });
    checkEq('inline: single-option pick keeps its text', only.output, 'Only B');
    checkEq('inline: single-option pick draws no rng', draws, 1);
  }

  // ctx.rng absent -> Math.random, read at call time (patchable)
  sandbox.__setRng(seqRng([0.999]));
  const noRng = R('((A|B))', { macros: [], evalExpr: () => 0 });
  checkEq('inline: default Math.random rng honoured', noRng.output, 'B');
  checkEq('inline: default rng ok', noRng.ok, true);
  sandbox.__setRng(sandbox.__origRandom);

  const multi = R('((a||b)) ((5-1)) |nope|', pickCtx([0.5]));
  checkDeep('inline: errors accumulate in order', multi.errors.map((e) => e.kind), ['malformed', 'reversed-range', 'unresolved']);
  checkDeep('inline: error positions', multi.errors.map((e) => e.position), [0, 9, 17]);
  checkEq('inline: every failure keeps its raw segment', multi.segments.filter((s) => s.type === 'error').length, 3);
  checkEq('inline: ok false when any span fails', multi.ok, false);
}

/* --------------------------------------------------------------------------
 * [container] references inside entry labels
 * ------------------------------------------------------------------------ */
{
  const P = T.parseEmbeds;
  const R = T.resolveEmbed;
  const FIND = T.findContainer;
  const T_FILE = 'tables/t.json';
  const mkC = (id, name, entries, file) => ({
    id, name, entries, file: file === undefined ? T_FILE : file,
  });
  const materials = mkC('tbl_a', 'Materials', [
    { label: 'Gold', weight: 1 },
    { label: 'Silver', weight: 1 },
    { label: 'Iron', weight: 1 },
  ]);
  const weapon = mkC('tbl_w', 'Weapon', [{ label: 'Sword of [material]', weight: 2 }]);
  const material = mkC('tbl_m2', 'Material', [{ label: 'oak', weight: 1 }]);
  const all = [materials, weapon, material];
  // One shared sequence feeds dice AND picks, so which draw lands where is
  // exactly left-to-right source order.
  const refCtx = (containers, draws, file) => {
    const seq = seqRng(draws);
    return {
      macros: [],
      evalExpr: (expr) => T.evaluate(expr, seq).value,
      rng: seq,
      containers,
      tableFile: file === undefined ? T_FILE : file,
    };
  };

  // ---- scanner -----------------------------------------------------------
  checkDeep('p3 scan: [a] is one container span', P('[a]'),
    [{ type: 'container', inner: 'a', raw: '[a]', start: 0 }]);
  const scan1 = P('X [a] Y');
  checkDeep('p3 scan: container between text', scan1.map((s) => s.type), ['text', 'container', 'text']);
  checkDeep('p3 scan: container between text starts', scan1.map((s) => s.start), [0, 2, 5]);
  checkEq('p3 scan: container between text text', scan1[2].text, ' Y');
  checkDeep('p3 scan: untrimmed inner/raw', P('X [ Gold ] Y')[1],
    { type: 'container', inner: ' Gold ', raw: '[ Gold ]', start: 2 });
  checkDeep('p3 scan: empty brackets are a container span', P('[]'),
    [{ type: 'container', inner: '', raw: '[]', start: 0 }]);
  checkDeep('p3 scan: adjacent [a][b]', P('[a][b]').map((s) => s.start), [0, 3]);
  checkEq('p3 scan: adjacent [a][b] count', P('[a][b]').length, 2);
  checkDeep('p3 scan: unmatched [ is literal text', P('a [b'), [{ type: 'text', text: 'a [b', start: 0 }]);
  checkDeep('p3 scan: trailing [ is literal text', P('ab['), [{ type: 'text', text: 'ab[', start: 0 }]);
  // an unmatched '[' must not swallow a later span
  const scan2 = P('[a |1d4|');
  checkDeep('p3 scan: scan continues past an unmatched [', scan2.map((s) => s.type), ['text', 'embed']);
  checkEq('p3 scan: unmatched [ text kept', scan2[0].text, '[a ');
  checkEq('p3 scan: later embed start', scan2[1].start, 3);
  const scan3 = P('((a [b]');
  checkDeep('p3 scan: scan continues past an unmatched ((', scan3.map((s) => s.type), ['text', 'container']);
  checkEq('p3 scan: unmatched (( text kept', scan3[0].text, '((a ');
  // precedence: earliest opener wins, ties are impossible
  checkEq('p3 scan: [ before | wins', P('[a|b]')[0].type, 'container');
  checkEq('p3 scan: [ before | keeps the pipe as data', P('[a|b]')[0].inner, 'a|b');
  checkDeep('p3 scan: | before [ wins', P('|1d4| [a]').map((s) => s.type), ['embed', 'text', 'container']);
  checkDeep('p3 scan: (( before [ wins', P('((a|b)) [c]').map((s) => s.type), ['inline', 'text', 'container']);
  checkEq('p3 scan: [ before (( wins', P('[(a)]')[0].type, 'container');
  // brackets inside another span are plain data
  checkEq('p3 scan: [ inside |...| is data', P('|A[B|')[0].inner, 'A[B');
  checkEq('p3 scan: [ inside pipe does not split', P('|A[B|').length, 1);
  checkEq('p3 scan: [ inside ((...)) is data', P('(([a]))')[0].inner, '[a]');
  checkEq('p3 scan: pipes/inline still parse as before', P('|1d4| ((a|b))').length, 3);
  checkDeep('p3 scan: text-only input still one empty text span', P(''), [{ type: 'text', text: '', start: 0 }]);

  // ---- resolution: plain reference --------------------------------------
  const simple = R('An old [materials] ring.', refCtx(all, [0]));
  checkEq('p3 ref: simple output', simple.output, 'An old Gold ring.');
  checkEq('p3 ref: ok', simple.ok, true);
  checkDeep('p3 ref: segment types', simple.segments.map((s) => s.type), ['text', 'ref', 'text']);
  checkDeep('p3 ref: ref segment shape', simple.segments[1], {
    type: 'ref', text: 'Gold', containerId: 'tbl_a', containerName: 'Materials', token: '[materials]',
  });
  checkEq('p3 ref: no errors', simple.errors.length, 0);
  checkEq('p3 ref: name match is case-insensitive', R('A [MATERIALS].', refCtx(all, [0])).output, 'A Gold.');
  checkEq('p3 ref: name match trims padding', R('A [ materials ].', refCtx(all, [0])).output, 'A Gold.');
  checkEq('p3 ref: surrounding text exact', R('X [materials] Y', refCtx(all, [2 / 3])).output, 'X Iron Y');

  // ---- scope: same-file preference, global fallback, ambiguity -----------
  const coinsA = mkC('tbl_ca', 'Coins', [{ label: 'Copper', weight: 1 }], 'tables/t.json');
  const coinsB = mkC('tbl_cb', 'Coins', [{ label: 'Platinum', weight: 1 }], 'tables/u.json');
  const coinsAll = [coinsA, coinsB];
  const sameFile = R('[coins]', { macros: [], evalExpr: () => 0, rng: () => 0, containers: coinsAll, tableFile: 'tables/t.json' });
  checkEq('p3 scope: same-file container wins', sameFile.output, 'Copper');
  checkEq('p3 scope: same-file id', sameFile.segments[0].containerId, 'tbl_ca');
  const otherFile = R('[coins]', { macros: [], evalExpr: () => 0, rng: () => 0, containers: coinsAll, tableFile: 'tables/v.json' });
  checkEq('p3 scope: two global candidates are ambiguous', otherFile.errors[0].kind, 'ambiguous-container');
  const oneGlobal = R('[material]', { macros: [], evalExpr: () => 0, rng: () => 0, containers: all, tableFile: 'tables/other.json' });
  checkEq('p3 scope: single global candidate is used', oneGlobal.output, 'oak');
  checkEq('p3 scope: global fallback id', oneGlobal.segments[0].containerId, 'tbl_m2');
  const twoSameFile = [mkC('tbl_g1', 'Gem', [{ label: 'Ruby', weight: 1 }]),
    mkC('tbl_g2', 'Gem', [{ label: 'Jade', weight: 1 }])];
  const ambSame = R('[gem]', { macros: [], evalExpr: () => 0, rng: () => 0, containers: twoSameFile, tableFile: T_FILE });
  checkDeep('p3 scope: two in the same file are ambiguous', ambSame.errors[0],
    { kind: 'ambiguous-container', token: '[gem]', position: 0, containerName: 'gem', chain: [] });
  const ambGlobal = R('[gem]', {
    macros: [], evalExpr: () => 0, rng: () => 0, tableFile: 'tables/elsewhere.json',
    containers: [mkC('tbl_g1', 'Gem', [{ label: 'Ruby', weight: 1 }], 'tables/u.json'),
      mkC('tbl_g2', 'Gem', [{ label: 'Jade', weight: 1 }], 'tables/v.json')],
  });
  checkEq('p3 scope: two global candidates are ambiguous', ambGlobal.errors[0].kind, 'ambiguous-container');

  // ---- errors: missing / empty / malformed ------------------------------
  const missing = R('A [nope] B', refCtx(all, []));
  checkEq('p3 err: missing ok false', missing.ok, false);
  checkDeep('p3 err: missing shape', missing.errors[0],
    { kind: 'missing-container', token: '[nope]', position: 2, containerName: 'nope', chain: [] });
  checkEq('p3 err: missing keeps the raw token in output', missing.output, 'A [nope] B');
  checkEq('p3 err: missing contributes one error span',
    missing.segments.filter((s) => s.type === 'error').length, 1);
  const noContainers = R('[anything]', { macros: [], evalExpr: () => 0, rng: () => 0 });
  checkEq('p3 err: old ctx without containers -> missing', noContainers.errors[0].kind, 'missing-container');
  checkEq('p3 err: old ctx without containers still ok for pipes',
    R('|1d4|', { macros: [], evalExpr: () => 3, rng: () => 0 }).output, '3');
  checkEq('p3 err: old ctx without containers still ok for inline',
    R('((a|b))', { macros: [], evalExpr: () => 0, rng: () => 0.9 }).output, 'b');
  const emptyBox = R('[box]', {
    macros: [], evalExpr: () => 0, rng: () => 0, tableFile: T_FILE,
    containers: [mkC('tbl_e', 'Box', [])],
  });
  checkDeep('p3 err: container with no entries', emptyBox.errors[0],
    { kind: 'empty-container', token: '[box]', position: 0, containerName: 'Box', chain: [] });
  const zeros = R('[box]', {
    macros: [], evalExpr: () => 0, rng: () => 0, tableFile: T_FILE,
    containers: [mkC('tbl_e', 'Box', [{ label: 'a', weight: 0 }, { label: 'b', weight: 0 }])],
  });
  checkEq('p3 err: all-zero weights', zeros.errors[0].kind, 'empty-container');
  checkEq('p3 err: all-zero weights draws no rng', (() => {
    let draws = 0;
    R('[box]', {
      macros: [], evalExpr: () => 0, tableFile: T_FILE,
      rng: () => { draws++; return 0; },
      containers: [mkC('tbl_e', 'Box', [{ label: 'a', weight: 0 }])],
    });
    return draws;
  })(), 0);
  const malformedRef = R('[]', refCtx(all, []));
  checkEq('p3 err: empty brackets are malformed', malformedRef.errors[0].kind, 'malformed');
  checkEq('p3 err: malformed ref has no chain field', 'chain' in malformedRef.errors[0], false);

  // ---- weights ----------------------------------------------------------
  const skewed = mkC('tbl_s', 'Skew', [{ label: 'Common', weight: 9 }, { label: 'Rare', weight: 1 }]);
  checkEq('p3 weight: 0 draws the heavy entry', R('[skew]', refCtx([skewed], [0])).output, 'Common');
  checkEq('p3 weight: 0.5 still the heavy entry', R('[skew]', refCtx([skewed], [0.5])).output, 'Common');
  checkEq('p3 weight: 0.85 still the heavy entry', R('[skew]', refCtx([skewed], [0.85])).output, 'Common');
  checkEq('p3 weight: 0.95 crosses into the light entry', R('[skew]', refCtx([skewed], [0.95])).output, 'Rare');
  const zeroWeight = mkC('tbl_z', 'Zed', [{ label: 'Never', weight: 0 }, { label: 'Always', weight: 1 }]);
  checkEq('p3 weight: zero weight is never picked (3 draws)',
    [0, 0.5, 0.999].map((d) => R('[zed]', refCtx([zeroWeight], [d])).output).join(','),
    'Always,Always,Always');
  checkEq('p3 weight: one draw per container span', (() => {
    let draws = 0;
    R('[materials] [materials]', {
      macros: [], evalExpr: () => 0, tableFile: T_FILE,
      rng: () => { draws++; return 0; },
      containers: all,
    });
    return draws;
  })(), 2);
  checkEq('p3 weight: repeated refs are independent', R('[materials] [materials]', refCtx(all, [0, 0.9])).output,
    'Gold Iron');

  // ---- nesting, depth, cycle -------------------------------------------
  checkEq('p3 nest: two levels', R('[weapon]', refCtx(all, [0, 0])).output, 'Sword of oak');
  checkEq('p3 nest: two levels segment types',
    R('[weapon]', refCtx(all, [0, 0])).segments.map((s) => s.type).join(','), 'ref');
  const three = [
    mkC('tbl_l1', 'L1', [{ label: 'one-[l2]', weight: 1 }]),
    mkC('tbl_l2', 'L2', [{ label: 'two-[l3]', weight: 1 }]),
    mkC('tbl_l3', 'L3', [{ label: 'three', weight: 1 }]),
  ];
  checkEq('p3 nest: three levels', R('[l1]', refCtx(three, [0, 0, 0])).output, 'one-two-three');
  const eight = [];
  for (let i = 0; i < 8; i++) {
    eight.push(mkC('d' + i, 'D' + i, [{ label: i === 7 ? 'bottom' : '[d' + (i + 1) + ']', weight: 1 }]));
  }
  const depth8 = R('[d0]', refCtx(eight, [0, 0, 0, 0, 0, 0, 0, 0]));
  checkEq('p3 depth: 8 nested containers resolve', depth8.output, 'bottom');
  checkEq('p3 depth: 8 nested containers ok', depth8.ok, true);
  checkEq('p3 depth: deepest trace depth is 7', (() => {
    let max = -1;
    (function walk(nodes) { for (const n of nodes) { if (n.depth > max) max = n.depth; walk(n.children); } })(depth8.trace);
    return max;
  })(), 7);
  const nine = [];
  for (let i = 0; i < 9; i++) {
    nine.push(mkC('d' + i, 'C' + i, [{ label: i === 8 ? 'bottom' : '[c' + (i + 1) + ']', weight: 1 }]));
  }
  const depth9 = R('[c0]', refCtx(nine, [0, 0, 0, 0, 0, 0, 0, 0, 0]));
  checkEq('p3 depth: a 9th level is refused', depth9.ok, false);
  checkEq('p3 depth: ninth level kind', depth9.errors[0].kind, 'nesting-limit');
  checkEq('p3 depth: ninth level names the innermost container', depth9.errors[0].containerName, 'C8');
  checkEq('p3 depth: chain lists the 8 enclosing containers', depth9.errors[0].chain.join('>'),
    'C0>C1>C2>C3>C4>C5>C6>C7');
  const cyc = [mkC('tbl_ca2', 'A', [{ label: 'A sees [b]', weight: 1 }]),
    mkC('tbl_cb2', 'B', [{ label: 'B sees [a]', weight: 1 }])];
  const cycleRes = R('[a]', refCtx(cyc, [0, 0]));
  checkEq('p3 cycle: A->B->A fails', cycleRes.ok, false);
  checkDeep('p3 cycle: A->B->A error', cycleRes.errors[0],
    { kind: 'cycle', token: '[a]', position: 7, containerName: 'A', chain: ['A', 'B'] });
  checkEq('p3 cycle: A->B->A output keeps the raw token', cycleRes.output, '[a]');
  const selfCyc = R('[self]', refCtx([mkC('tbl_sf', 'Self', [{ label: 'x[self]y', weight: 1 }])], [0]));
  checkEq('p3 cycle: self reference fails', selfCyc.errors[0].kind, 'cycle');
  checkEq('p3 cycle: self reference chain', selfCyc.errors[0].chain.join('>'), 'Self');
  checkEq('p3 cycle: self reference position', selfCyc.errors[0].position, 1);

  // ---- budget -----------------------------------------------------------
  const fan = [mkC('f0', 'F0', [{ label: '[f1] '.repeat(12), weight: 1 }])];
  for (let i = 1; i < 4; i++) {
    fan.push(mkC('f' + i, 'F' + i, [{ label: i === 3 ? 'x' : ('[f' + (i + 1) + '] ').repeat(12), weight: 1 }]));
  }
  const budget = R('[f0]', { macros: [], evalExpr: () => 0, rng: () => 0, containers: fan, tableFile: T_FILE });
  checkEq('p3 budget: fan-out is refused', budget.ok, false);
  checkEq('p3 budget: fan-out kind', budget.errors[0].kind, 'nesting-limit');
  checkEq('p3 budget: fan-out stays bounded', (() => {
    let nodes = 0;
    (function walk(nodes2) { for (const n of nodes2) { nodes++; walk(n.children); } })(budget.trace);
    return nodes <= 1000;
  })(), true);
  const huge = mkC('tbl_h', 'Huge', [{ label: 'y'.repeat(200000), weight: 1 }]);
  const charCap = R('[huge]', refCtx([huge], [0]));
  checkEq('p3 budget: oversized output is refused', charCap.ok, false);
  checkEq('p3 budget: oversized output kind', charCap.errors[0].kind, 'nesting-limit');
  checkEq('p3 budget: oversized output keeps the raw token', charCap.output, '[huge]');

  // A trailing leaf span can cross the character cap without passing through
  // a container branch: the first crossing in a frame records one
  // nesting-limit (container kinds always carry chain, here empty).
  const plainOver = R('y'.repeat(100001), refCtx([], [0]));
  check('p3 budget: plain text over cap is refused', (() => {
    return plainOver.ok === false && plainOver.errors.length === 1 &&
      plainOver.errors[0].kind === 'nesting-limit' &&
      plainOver.errors[0].position === 0 &&
      Array.isArray(plainOver.errors[0].chain) && plainOver.errors[0].chain.length === 0;
  })());
  const tiny = mkC('tbl_s', 'Small', [{ label: 'a', weight: 1 }]);
  const tailOver = R('[small] ' + 'y'.repeat(100000), refCtx([tiny], [0]));
  check('p3 budget: container + trailing text over cap is refused', (() => {
    return tailOver.ok === false && tailOver.errors.length === 1 &&
      tailOver.errors[0].kind === 'nesting-limit' &&
      tailOver.errors[0].position === 7 &&
      Array.isArray(tailOver.errors[0].chain) && tailOver.errors[0].chain.length === 0;
  })());

  // ---- mixing dice, inline and containers in one label ------------------
  const pick = mkC('tbl_pk', 'Pick', [{ label: 'ONE', weight: 1 }, { label: 'TWO', weight: 1 }]);
  const mixed = R('A [pick] |1d4| ((a|b))', refCtx([pick], [0.9, 0.5, 0.9]));
  checkEq('p3 mix: container, dice and inline in one label', mixed.output, 'A TWO 3 b');
  checkDeep('p3 mix: left-to-right segment order', mixed.segments.map((s) => s.type),
    ['text', 'ref', 'text', 'value', 'text', 'pick']);
  checkEq('p3 mix: every span resolved', mixed.segments.length, 6);
  const twoFails = R('[nope] |bad|', refCtx(all, []));
  checkDeep('p3 mix: failures accumulate in order', twoFails.errors.map((e) => e.kind),
    ['missing-container', 'unresolved']);
  checkDeep('p3 mix: failure positions', twoFails.errors.map((e) => e.position), [0, 7]);

  // ---- trace ------------------------------------------------------------
  const nestedTrace = R('[weapon]', refCtx(all, [0, 0])).trace;
  checkEq('p3 trace: one top-level node', nestedTrace.length, 1);
  checkEq('p3 trace: token', nestedTrace[0].token, '[weapon]');
  checkEq('p3 trace: container id', nestedTrace[0].containerId, 'tbl_w');
  checkEq('p3 trace: container name', nestedTrace[0].containerName, 'Weapon');
  checkEq('p3 trace: raw entry label', nestedTrace[0].entryLabel, 'Sword of [material]');
  checkEq('p3 trace: weight', nestedTrace[0].weight, 2);
  checkEq('p3 trace: depth', nestedTrace[0].depth, 0);
  checkDeep('p3 trace: nested segment types', nestedTrace[0].segments.map((s) => s.type), ['text', 'ref']);
  checkEq('p3 trace: one child', nestedTrace[0].children.length, 1);
  checkEq('p3 trace: child id', nestedTrace[0].children[0].containerId, 'tbl_m2');
  checkEq('p3 trace: child depth', nestedTrace[0].children[0].depth, 1);
  checkEq('p3 trace: child has no children', nestedTrace[0].children[0].children.length, 0);
  checkEq('p3 trace: empty when no container spans', R('|1d4|', refCtx(all, [0.5])).trace.length, 0);
  checkEq('p3 trace: JSON-safe (round trips)', (() => {
    try {
      const round = JSON.parse(JSON.stringify(nestedTrace));
      return round.length === 1 && round[0].children.length === 1;
    } catch (e) { return false; }
  })(), true);
  checkEq('p3 trace: no undefined containers', nestedTrace[0].containerId !== '' && nestedTrace[0].containerName !== '', true);

  // ---- nested errors carry the enclosing chain -------------------------
  const badNested = [mkC('tbl_bw', 'BadWeapon', [{ label: 'Sword |nope|', weight: 1 }])];
  const nestedErr = R('[badweapon]', refCtx(badNested, [0]));
  checkEq('p3 nested err: kind', nestedErr.errors[0].kind, 'unresolved');
  checkEq('p3 nested err: own position', nestedErr.errors[0].position, 6);
  checkDeep('p3 nested err: chain names the container', nestedErr.errors[0].chain, ['BadWeapon']);
  checkEq('p3 nested err: enclosing span keeps its raw token', nestedErr.output, '[badweapon]');
  checkEq('p3 nested err: no ref segment', nestedErr.segments.filter((s) => s.type === 'ref').length, 0);

  // ---- findContainer helper --------------------------------------------
  const found = FIND(' materials ', all, T_FILE);
  checkEq('p3 find: ok', found.ok, true);
  checkEq('p3 find: returns the container', found.container.id, 'tbl_a');
  checkEq('p3 find: blank token is missing', FIND('   ', all, T_FILE).kind, 'missing');
  checkEq('p3 find: unknown name is missing', FIND('zzz', all, T_FILE).kind, 'missing');
  checkEq('p3 find: ambiguous', FIND('gem', twoSameFile, T_FILE).kind, 'ambiguous');
  checkEq('p3 find: same-file preference', FIND('coins', coinsAll, 'tables/u.json').container.id, 'tbl_cb');
  checkEq('p3 find: no containers at all', FIND('coins', null, '').kind, 'missing');
}

/* --------------------------------------------------------------------------
 * generator templates execute embeds
 * parseTemplate is now parseEmbeds' scan in template shape; runGenerator
 * gains an optional 4th `ctx` that resolves template `|...|`/`((...))` spans
 * and every picked label. The 3-argument call keeps the old contract for
 * ref-only templates and reports a span it cannot resolve instead of drawing
 * from Math.random. `rolls` stays byte-compatible.
 * ------------------------------------------------------------------------ */
{
  const PT = T.parseTemplate;
  const RG = T.runGenerator;

 // The earlier bracket-only scanner, kept verbatim as the differential
  // oracle: a template without | or (( must parse byte-identically.
  const legacyParseTemplate = (template) => {
    const text = typeof template === 'string' ? template : '';
    const segments = [];
    let textStart = 0;
    let i = 0;
    const flushText = (end) => {
      if (end > textStart) segments.push({ type: 'text', text: text.slice(textStart, end) });
      textStart = end;
    };
    while (i < text.length) {
      if (text[i] === '[') {
        const close = text.indexOf(']', i + 1);
        if (close === -1) {
          i += 1;
        } else {
          flushText(i);
          segments.push({ type: 'ref', token: text.slice(i + 1, close).trim(), start: i, end: close + 1 });
          i = close + 1;
          textStart = i;
        }
      } else {
        i += 1;
      }
    }
    flushText(text.length);
    if (segments.length === 0) segments.push({ type: 'text', text: '' });
    return { segments };
  };

  const gi = (id, name, entries, file) => ({ id, name, entries, file });
  const G = (template) => ({ id: 'g_p4', name: 'Gen', template, references: [] });
  // rollEntry that picks by a scripted index list (the last index repeats), so
  // which entry lands where is explicit and not a weighted coincidence.
  const rollIdx = (indices) => {
    let k = 0;
    return (container) => {
      const entries = Array.isArray(container && container.entries) ? container.entries : [];
      if (entries.length === 0) return null;
      const idx = indices[Math.min(k, indices.length - 1)];
      k += 1;
      return entries[idx % entries.length];
    };
  };
 // One draw stream feeds dice AND inline picks, like 's refCtx.
  const embCtx = (draws, extra) => {
    const seq = seqRng(draws);
    return Object.assign({
      macros: [],
      evalExpr: (expr) => T.evaluate(expr, seq).value,
      rng: seq,
      containers: [],
      tableFile: 'gens/g.json',
    }, extra || {});
  };

  const weapons = gi('tbl_w4', 'Weapons', [
    { label: 'Sword', weight: 2 },
    { label: 'Axe', weight: 1 },
  ], 'tables/w.json');
  const gemW = gi('tbl_gw', 'Gem', [{ label: 'ruby', weight: 1 }], 'tables/w.json');
  const gemG = gi('tbl_gg', 'Gem', [{ label: 'emerald', weight: 1 }], 'tables/g.json');
  const base = [weapons, gemW, gemG];

  // ---- parseTemplate: differential against the bracket-only scanner ------
 // removed the '{brace} and {x}' fixture: `{` is now an opener (see
 // the differential below), so only brace-free text can be compared
  // against the pre-13b scanner.
  const corpus = ['', 'abc', '# heading', '[]', 'a[]b', '[a]', 'a [b] c', 'a [ b ] c', '[a][b]',
    'x [unclosed', 'x] y', 'a [b][c] d', '[ spaced ]', '[[a]]', '[[[', 'a[', ']', '[a][b',
    'a ] b [c', 'line1\nline2', 'no spans at all'];
  check('p4 diff: corpus contains no |, (( or {',
    corpus.every((s) => s.indexOf('|') === -1 && s.indexOf('((') === -1 && s.indexOf('{') === -1));
  checkDeep('p4 diff: parseTemplate is byte-identical to the old scanner',
    corpus.map((s) => PT(s)), corpus.map(legacyParseTemplate));
  checkDeep('p4 diff: text segments carry no start', PT('a [b] c').segments, [
    { type: 'text', text: 'a ' },
    { type: 'ref', token: 'b', start: 2, end: 5 },
    { type: 'text', text: ' c' },
  ]);
  checkDeep('p4 diff: empty template', PT('').segments, [{ type: 'text', text: '' }]);
  checkDeep('p4 diff: non-string input', PT(42).segments, [{ type: 'text', text: '' }]);

  // ---- parseTemplate: embed / inline segments ---------------------------
  checkDeep('p4 parse: embed between text', PT('You found |2d3| knives.').segments, [
    { type: 'text', text: 'You found ' },
    { type: 'embed', inner: '2d3', raw: '|2d3|', start: 10 },
    { type: 'text', text: ' knives.' },
  ]);
  checkDeep('p4 parse: inline span', PT('((A|B))').segments, [
    { type: 'inline', inner: 'A|B', raw: '((A|B))', start: 0 },
  ]);
  checkDeep('p4 parse: mixed segment order', PT('[a] |1d4| ((b))').segments.map((s) => s.type),
    ['ref', 'text', 'embed', 'text', 'inline']);
  checkDeep('p4 parse: ref after a span keeps the exact ref shape', PT('|1d4| then [x]').segments[2],
    { type: 'ref', token: 'x', start: 11, end: 14 });
  checkEq('p4 parse: [ inside a pipe span is not a ref',
    PT('|A[B|').segments.filter((s) => s.type === 'ref').length, 0);
  checkEq('p4 parse: unmatched pipe stays one text segment', PT('|abc').segments.length, 1);

  // ---- 3-argument runs: ref-only templates are byte-identical ------------
  const legacy = RG(G('You found [weapons] and [weapons].'), base, rollIdx([0, 1]));
  checkEq('p4 3-arg: ok', legacy.ok, true);
  checkEq('p4 3-arg: output', legacy.output, 'You found Sword and Axe.');
  checkDeep('p4 3-arg: rolls byte-compatible', legacy.rolls, [
    {
      token: 'weapons', containerId: 'tbl_w4', containerName: 'Weapons',
      entry: weapons.entries[0], weight: 2, occurrence: 1, position: 10,
    },
    {
      token: 'weapons', containerId: 'tbl_w4', containerName: 'Weapons',
      entry: weapons.entries[1], weight: 1, occurrence: 2, position: 24,
    },
  ]);
  checkDeep('p4 3-arg: segment types', legacy.segments.map((s) => s.type),
    ['text', 'ref', 'text', 'ref', 'text']);
  checkEq('p4 3-arg: trace is empty', legacy.trace.length, 0);
  checkDeep('p4 3-arg: errors empty', legacy.errors, []);
  checkDeep('p4 3-arg: result keys', Object.keys(legacy).sort(),
    ['errors', 'exposed', 'occurrenceResults', 'ok', 'output', 'rolls', 'segments', 'trace']);
  checkEq('p4 3-arg: each occurrence rolls fresh', (() => {
    let calls = 0;
    RG(G('[weapons] and [weapons]'), base, (container) => {
      calls += 1;
      return container.entries[0];
    });
    return calls;
  })(), 2);
  checkEq('p4 3-arg: a null roll is an empty error',
    RG(G('[weapons]'), base, () => null).errors[0].kind, 'empty');
  checkEq('p4 3-arg: the empty error keeps the token',
    RG(G('[weapons]'), base, () => null).errors[0].token, 'weapons');
  const missing = RG(G('[missing]'), base, rollIdx([0]));
  checkEq('p4 3-arg: missing container fails validation', missing.errors[0].kind, 'missing');
  checkDeep('p4 3-arg: validation failure keeps the old shape', Object.keys(missing).sort(),
    ['errors', 'ok']);

  // ---- 3-argument runs never resolve an embed ---------------------------
  const pipeTemplate = RG(G('You found |2d3| throwing knives.'), base, rollIdx([0]));
  checkEq('p4 3-arg pipe: fails', pipeTemplate.ok, false);
  checkDeep('p4 3-arg pipe: error', pipeTemplate.errors,
    [{ kind: 'unresolved', token: '|2d3|', position: 10 }]);
  checkEq('p4 3-arg pipe: diagnostic output is the raw template',
    pipeTemplate.output, 'You found |2d3| throwing knives.');
  const inlineTemplate = RG(G('a ((X|Y)) b'), base, rollIdx([0]));
  checkEq('p4 3-arg inline: fails', inlineTemplate.ok, false);
  checkDeep('p4 3-arg inline: error', inlineTemplate.errors,
    [{ kind: 'unresolved', token: '((X|Y))', position: 2 }]);
  const embeddedLabel = gi('tbl_w5', 'Weapons', [{ label: 'Sword |1d4|', weight: 1 }], 'tables/w.json');
  const labelPipe = RG(G('[weapons]'), [embeddedLabel], rollIdx([0]));
  checkEq('p4 3-arg label: a picked label with an embed fails', labelPipe.ok, false);
  checkDeep('p4 3-arg label: error is label-relative', labelPipe.errors,
    [{ kind: 'unresolved', token: '|1d4|', position: 6 }]);
  checkEq('p4 3-arg label: the roll is still recorded', labelPipe.rolls.length, 1);
  checkEq('p4 3-arg label: no trace node', labelPipe.trace.length, 0);
  checkEq('p4 3-arg: null ctx is the legacy call',
    RG(G('[weapons]'), base, rollIdx([0]), null).ok, true);

  // ---- 4-argument runs: deterministic ctx, exact output -----------------
  const knives = RG(G('You found |2d3| throwing knives.'), base, rollIdx([0]), embCtx([0.5, 0.5]));
  checkEq('p4 ctx: |2d3| @0.5 ok', knives.ok, true);
  checkEq('p4 ctx: |2d3| @0.5 exact output', knives.output, 'You found 4 throwing knives.');
  checkDeep('p4 ctx: template segment types', knives.segments.map((s) => s.type),
    ['text', 'value', 'text']);
  checkEq('p4 ctx: template value text', knives.segments[1].text, '4');
  checkEq('p4 ctx: no rolls for a ref-free template', knives.rolls.length, 0);
  checkEq('p4 ctx: no trace for a ref-free template', knives.trace.length, 0);
  checkEq('p4 ctx: the same template at other draws',
    RG(G('You found |2d3| throwing knives.'), base, rollIdx([0]), embCtx([0.99, 0.99])).output,
    'You found 6 throwing knives.');

  // ---- macro precedence through ctx.macros ------------------------------
  const macros = [
    { name: 'Sword', formula: '1d6' },
    { name: 'Dup', formula: '1d4' },
    { name: 'Dup', formula: '1d12' },
  ];
  checkEq('p4 ctx macro: |Sword| evaluates the formula',
    RG(G('|Sword|'), base, rollIdx([0]), embCtx([0.25], { macros })).output, '2');
  checkEq('p4 ctx macro: first macro in file order wins',
    RG(G('|dup|'), base, rollIdx([0]), embCtx([0.25], { macros })).output, '2');
  checkEq('p4 ctx macro: a macro name beats dice syntax',
    RG(G('|1d4|'), base, rollIdx([0]), embCtx([0.25], { macros: [{ name: '1d4', formula: '1d12' }] })).output,
    '4');
  const badMacro = RG(G('|Boom|'), base, rollIdx([0]),
    embCtx([0.25], { macros: [{ name: 'Boom', formula: '1d' }] }));
  checkEq('p4 ctx macro: a throwing formula is invalid-expression',
    badMacro.errors[0].kind, 'invalid-expression');
  checkEq('p4 ctx macro: the error names the macro', badMacro.errors[0].macroName, 'Boom');

  // ---- mixed [container] + |1d4| + ((1-3)) in one template --------------
  const mixed = RG(G('[weapons] |1d4| ((1-3))'), base, rollIdx([0]), embCtx([0.5, 0.9]));
  checkEq('p4 mix: exact output', mixed.output, 'Sword 3 3');
  checkDeep('p4 mix: segment order', mixed.segments.map((s) => s.type),
    ['ref', 'text', 'value', 'text', 'pick']);
  checkEq('p4 mix: one roll', mixed.rolls.length, 1);
  checkEq('p4 mix: one trace node', mixed.trace.length, 1);
  checkEq('p4 mix: ref segment carries the nested output', mixed.segments[0].text, 'Sword');
  checkEq('p4 mix: adjacent spans draw in source order',
    RG(G('[weapons] |1d4| |1d4|'), base, rollIdx([0]), embCtx([0.1, 0.9])).output, 'Sword 1 4');

  // ---- picked labels resolve through resolveEmbed -----------------------
  const refLabel = gi('tbl_wr', 'Weapon', [{ label: 'Sword of [gem]', weight: 1 }], 'tables/w.json');
  const sameName = [refLabel, gemW, gemG];
  const resolved = RG(G('[weapon]'), sameName, rollIdx([0]),
    embCtx([0.5], { containers: sameName, tableFile: 'tables/g.json' }));
  checkEq('p4 label: nested ref uses the container file scope', resolved.output, 'Sword of ruby');
  checkEq('p4 label: trace node depth is 0', resolved.trace[0].depth, 0);
  checkEq('p4 label: child depth is 1', resolved.trace[0].children[0].depth, 1);
  checkEq('p4 label: child container id', resolved.trace[0].children[0].containerId, 'tbl_gw');
  checkEq('p4 label: trace records the raw label', resolved.trace[0].entryLabel, 'Sword of [gem]');
  checkEq('p4 label: trace weight', resolved.trace[0].weight, 1);
  // A container without a `file` inherits ctx.tableFile as its label scope.
  const noFile = gi('tbl_nf', 'Weapon', [{ label: 'Blade of [gem]', weight: 1 }]);
  const fallback = RG(G('[weapon]'), [noFile, gemW, gemG], rollIdx([0]),
    embCtx([0.5], { containers: [noFile, gemW, gemG], tableFile: 'tables/g.json' }));
  checkEq('p4 label: a file-less container inherits ctx.tableFile',
    fallback.output, 'Blade of emerald');
  checkEq('p4 label: inherited scope child id', fallback.trace[0].children[0].containerId, 'tbl_gg');
  const labelEmbeds = gi('tbl_wl', 'Weapons', [{ label: '|2d3| ((Gold|Silver)) swords', weight: 1 }], 'tables/w.json');
  const both = RG(G('[weapons]'), [labelEmbeds], rollIdx([0]),
    embCtx([0, 0, 0.99], { containers: [labelEmbeds] }));
  checkEq('p4 label: dice and inline inside a picked label', both.output, '2 Silver swords');
  const badLabel = gi('tbl_wb', 'Weapons', [{ label: 'Sword |nope|', weight: 1 }], 'tables/w.json');
  const labelFail = RG(G('[weapons]'), [badLabel], rollIdx([0]),
    embCtx([0.5], { containers: [badLabel] }));
  checkEq('p4 label: a failing label fails the run', labelFail.ok, false);
  checkEq('p4 label: failure kind', labelFail.errors[0].kind, 'unresolved');
  checkEq('p4 label: position is label-relative', labelFail.errors[0].position, 6);
  checkEq('p4 label: diagnostic output keeps the raw token', labelFail.output, '[weapons]');
  checkEq('p4 label: no trace node for a failed label', labelFail.trace.length, 0);
  // Error positions live in the text that owns the span: the label error is
  // label-relative (6), the template span error is template-relative (10).
  const posMix = RG(G('[weapons] |1d|'), [badLabel], rollIdx([0]),
    embCtx([0.5], { containers: [badLabel] }));
  checkDeep('p4 label: label and template errors keep their own offsets',
    posMix.errors.map((e) => e.position), [6, 10]);

  // ---- cycles and nesting from a template ref ---------------------------
  const selfRef = gi('tbl_ws', 'Weapons', [{ label: 'Sword of [weapons]', weight: 1 }], 'tables/w.json');
  const selfRes = RG(G('[weapons]'), [selfRef], rollIdx([0]), embCtx([0.5], { containers: [selfRef] }));
  checkEq('p4 cycle: a self-reference fails', selfRes.errors[0].kind, 'cycle');
  checkDeep('p4 cycle: chain names the container', selfRes.errors[0].chain, ['Weapons']);
  const cycA = gi('tbl_ca4', 'A', [{ label: 'A sees [b]', weight: 1 }], 'tables/w.json');
  const cycB = gi('tbl_cb4', 'B', [{ label: 'B sees [a]', weight: 1 }], 'tables/w.json');
  const cyc = RG(G('[a]'), [cycA, cycB], rollIdx([0, 0]), embCtx([0.5], { containers: [cycA, cycB] }));
  checkEq('p4 cycle: A->B->A fails', cyc.ok, false);
  checkEq('p4 cycle: A->B->A kind', cyc.errors[0].kind, 'cycle');
  checkDeep('p4 cycle: A->B->A chain', cyc.errors[0].chain, ['A', 'B']);
  const eight = [];
  for (let i = 0; i < 8; i++) {
    eight.push(gi('e4_' + i, 'E' + i,
      [{ label: i === 7 ? 'bottom' : '[e' + (i + 1) + ']', weight: 1 }], 'tables/w.json'));
  }
  checkEq('p4 nest: 8 levels below a template ref resolve',
    RG(G('[e0]'), eight, rollIdx([0]), embCtx([0.5], { containers: eight })).output, 'bottom');
  const nine = [];
  for (let i = 0; i < 9; i++) {
    nine.push(gi('n4_' + i, 'N' + i,
      [{ label: i === 8 ? 'bottom' : '[n' + (i + 1) + ']', weight: 1 }], 'tables/w.json'));
  }
  const tooDeep = RG(G('[n0]'), nine, rollIdx([0]), embCtx([0.5], { containers: nine }));
  checkEq('p4 nest: a 9th level is refused', tooDeep.ok, false);
  checkEq('p4 nest: ninth level kind', tooDeep.errors[0].kind, 'nesting-limit');
  checkEq('p4 nest: ninth level names the container', tooDeep.errors[0].containerName, 'N8');
  checkEq('p4 nest: chain lists the 8 enclosing containers', tooDeep.errors[0].chain.join('>'),
    'N0>N1>N2>N3>N4>N5>N6>N7');

  // ---- error kinds from template spans ----------------------------------
  checkDeep('p4 kinds: reversed range in a template',
    RG(G('a ((5-1)) b'), base, rollIdx([0]), embCtx([0.5])).errors,
    [{ kind: 'reversed-range', token: '((5-1))', position: 2 }]);
  checkEq('p4 kinds: invalid range in a template',
    RG(G('a ((1.5-3)) b'), base, rollIdx([0]), embCtx([0.5])).errors[0].kind, 'invalid-range');
  checkEq('p4 kinds: empty inline span',
    RG(G('a (()) b'), base, rollIdx([0]), embCtx([0.5])).errors[0].kind, 'malformed');
  checkDeep('p4 kinds: empty pipe span',
    RG(G('a |  | b'), base, rollIdx([0]), embCtx([0.5])).errors,
    [{ kind: 'malformed', token: '|  |', position: 2 }]);
  checkDeep('p4 kinds: unparseable dice',
    RG(G('a |1d| b'), base, rollIdx([0]), embCtx([0.5])).errors,
    [{ kind: 'unresolved', token: '|1d|', position: 2 }]);
  const noEval = RG(G('|1d4|'), base, rollIdx([0]), { macros: [] });
  checkEq('p4 kinds: ctx without evalExpr is unresolved', noEval.errors[0].kind, 'unresolved');
  checkEq('p4 kinds: a failed run is not ok', noEval.ok, false);
  const mixedFail = RG(G('|1d| and |1d|'), base, rollIdx([0]), embCtx([0.5]));
  checkEq('p4 kinds: failures accumulate', mixedFail.errors.length, 2);
  checkDeep('p4 kinds: failure positions', mixedFail.errors.map((e) => e.position), [0, 9]);

  // ---- result hygiene ---------------------------------------------------
  const jsonSafe = RG(G('[weapon] |1d4|'), sameName, rollIdx([0]),
    embCtx([0.5, 0.5], { containers: sameName, tableFile: 'tables/g.json' }));
  check('p4 json: trace round-trips through JSON', (() => {
    try {
      const round = JSON.parse(JSON.stringify(jsonSafe.trace));
      return deepEq(round, jsonSafe.trace) && round.length === 1 &&
        round[0].children.length === 1 && round[0].children[0].token === '[gem]';
    } catch (e) { return false; }
  })());
  check('p4 json: segments round-trip through JSON', (() => {
    try {
      return deepEq(JSON.parse(JSON.stringify(jsonSafe.segments)), jsonSafe.segments);
    } catch (e) { return false; }
  })());
  checkDeep('p4 hygiene: junk input never throws', RG(null, null, null), {
    ok: true, output: '', segments: [{ type: 'text', text: '' }], trace: [], rolls: [], errors: [],
    occurrenceResults: {}, exposed: {},
  });
  checkEq('p4 hygiene: newlines in the template survive', RG(G('a\n[b]'),
    [gi('tbl_nl', 'B', [{ label: 'x', weight: 1 }])], rollIdx([0]),
    embCtx([0.5], { containers: [] })).output, 'a\nx');
}

// -------------------------------------: logic operations (`{name}`)
{
  const P = T.parseEmbeds;
  const PT = T.parseTemplate;
  const R = T.resolveEmbed;
  const EO = T.executeOperation;
  const RG = T.runGenerator;
  const VG = T.validateGenerator;
  const ROR = T.resolveOperationRefs;

  // ---- scanner: the `{` opener ------------------------------------------
  checkDeep('p5 parse: {a} is one op span', P('{a}'), [
    { type: 'op', inner: 'a', raw: '{a}', start: 0 },
  ]);
  checkDeep('p5 parse: op inner kept untrimmed', P('{  a  }'), [
    { type: 'op', inner: '  a  ', raw: '{  a  }', start: 0 },
  ]);
  checkDeep('p5 parse: empty op span', P('{}'), [
    { type: 'op', inner: '', raw: '{}', start: 0 },
  ]);
  checkDeep('p5 parse: text around an op span', P('with {gem} now'), [
    { type: 'text', text: 'with ', start: 0 },
    { type: 'op', inner: 'gem', raw: '{gem}', start: 5 },
    { type: 'text', text: ' now', start: 10 },
  ]);
  checkDeep('p5 parse: unmatched { is literal', P('a {b'), [
    { type: 'text', text: 'a {b', start: 0 },
  ]);
  checkDeep('p5 parse: only-one-closer still leaves a literal {',
    P('a { b {c'), [{ type: 'text', text: 'a { b {c', start: 0 }]);
  checkDeep('p5 parse: lone } stays text', P('a } b'), [
    { type: 'text', text: 'a } b', start: 0 },
  ]);
  checkDeep('p5 parse: adjacent op spans', P('{a}{b}'), [
    { type: 'op', inner: 'a', raw: '{a}', start: 0 },
    { type: 'op', inner: 'b', raw: '{b}', start: 3 },
  ]);
  checkDeep('p5 parse: earliest opener wins (op before bracket)', P('{a} [b]'), [
    { type: 'op', inner: 'a', raw: '{a}', start: 0 },
    { type: 'text', text: ' ', start: 3 },
    { type: 'container', inner: 'b', raw: '[b]', start: 4 },
  ]);
  checkDeep('p5 parse: earliest opener wins (bracket before op)', P('[a] {b}'), [
    { type: 'container', inner: 'a', raw: '[a]', start: 0 },
    { type: 'text', text: ' ', start: 3 },
    { type: 'op', inner: 'b', raw: '{b}', start: 4 },
  ]);
  checkDeep('p5 parse: an embed swallows a brace', P('|a {b}|'), [
    { type: 'embed', inner: 'a {b}', raw: '|a {b}|', start: 0 },
  ]);
  checkDeep('p5 parse: an op swallows a pipe', P('{a |1d4| b}'), [
    { type: 'op', inner: 'a |1d4| b', raw: '{a |1d4| b}', start: 0 },
  ]);
  checkDeep('p5 parse: an inline span swallows a brace', P('((x {y}))'), [
    { type: 'inline', inner: 'x {y}', raw: '((x {y}))', start: 0 },
  ]);
  checkDeep('p5 parse: a container span swallows a brace', P('[a {b}]'), [
    { type: 'container', inner: 'a {b}', raw: '[a {b}]', start: 0 },
  ]);
  checkDeep('p5 template: op segments pass through', PT('x {a} y').segments, [
    { type: 'text', text: 'x ' },
    { type: 'op', inner: 'a', raw: '{a}', start: 2 },
    { type: 'text', text: ' y' },
  ]);
  checkDeep('p5 template: a brace-free template is unchanged',
    PT('a [t] |1d4| ((x|y))').segments, [
      { type: 'text', text: 'a ' },
      { type: 'ref', token: 't', start: 2, end: 5 },
      { type: 'text', text: ' ' },
      { type: 'embed', inner: '1d4', raw: '|1d4|', start: 6 },
      { type: 'text', text: ' ' },
      { type: 'inline', inner: 'x|y', raw: '((x|y))', start: 12 },
    ]);

  // ---- executeOperation: script -------------------------------------------
  const opCtx = (draws, extra) => {
    const r = seqRng(draws);
    return Object.assign({ rng: r }, extra || {});
  };
  const S = (over) => Object.assign({
    id: 'op_f', name: 'Dmg',
    script: 'SET d = ROLL ((1-6))', outputTemplate: '%d%',
    imports: [], exposed: [], bindings: {}, occurrences: [],
  }, over || {});
  const DMG = S({});
  const dmg = EO(DMG, opCtx([0.5]));
  checkEq('p5 op script: ok', dmg.ok, true);
  checkEq('p5 op script: pinned output', dmg.output, '4');
  checkDeep('p5 op script: one text segment', dmg.segments, [{ type: 'text', text: '4' }]);
  checkDeep('p5 op script: no errors', dmg.errors, []);
  checkDeep('p5 op script: trace set entry keys', Object.keys(dmg.trace[0]).sort(),
    ['kind', 'line', 'name', 'roll', 'source', 'step', 'type', 'value']);
  checkEq('p5 op script: the set entry records the rolled value', dmg.trace[0].value, 4);
  checkEq('p5 op script: another draw', EO(DMG, opCtx([0.9])).output, '6');
  checkEq('p5 op script: an empty script is a valid empty program',
    EO(S({ id: 'op_e', name: 'Bad', script: '', outputTemplate: '' }), opCtx([0.5])).errors.length, 0);
  const broken = EO(S({ id: 'op_e2', name: 'Bad', script: 'SET a = 1\nSET b = missing', outputTemplate: '%b%' }), opCtx([0.5]));
  checkEq('p5 op script: a broken script fails', broken.ok, false);
  checkEq('p5 op script: broken kind is missing-variable', broken.errors[0].kind, 'missing-variable');
  checkEq('p5 op script: broken echoes the op token', broken.errors[0].token, '{Bad}');
  checkEq('p5 op script: broken names the operation', broken.errors[0].operationName, 'Bad');
  checkEq('p5 op script: broken carries its source line', broken.errors[0].line, 2);
  checkEq('p5 op: unknown type is unsupported-operation',
    EO({ id: 'op_u', name: 'U', type: 'weird' }, opCtx([0.5])).errors[0].kind, 'unsupported-operation');
  checkEq('p5 op: missing type is unsupported-operation',
    EO({ id: 'op_m', name: 'M' }, opCtx([0.5])).errors[0].kind, 'unsupported-operation');
  checkEq('p5 op: non-object op is unsupported-operation',
    EO(null, opCtx([0.5])).errors[0].kind, 'unsupported-operation');
  checkEq('p5 op: the caller raw token is echoed in errors',
    EO(null, { raw: '{zz}' }).errors[0].token, '{zz}');
  check('p5 op: junk ctx never throws', (() => {
    try { EO(DMG, null); return true; } catch (e) { return false; }
  })());

  // ---- executeOperation: script (inline pick) ---------------------------
  const LOOT = S({
    id: 'op_c', name: 'Loot',
    script: 'SET x = ROLL ((gold:1 | gems:3))', outputTemplate: '%x%',
  });
  checkEq('p5 op pick: low draw picks the first option', EO(LOOT, opCtx([0])).output, 'gold');
  checkEq('p5 op pick: the heavy option wins at 0.5', EO(LOOT, opCtx([0.5])).output, 'gems');
  checkDeep('p5 op pick: segments are the picked label',
    EO(LOOT, opCtx([0.5])).segments, [{ type: 'text', text: 'gems' }]);
  checkEq('p5 op pick: trace records the picked value', EO(LOOT, opCtx([0.5])).trace[0].value, 'gems');
  checkEq('p5 op pick: all-zero weights give empty-choice',
    EO(S({ id: 'op_z', name: 'Z', script: 'SET x = ROLL ((a:0 | b:0))', outputTemplate: '%x%' }),
      opCtx([0.5])).errors[0].kind, 'empty-choice');
  checkEq('p5 op pick: an empty (( )) value is bad-choice',
    EO(S({ id: 'op_z2', name: 'Z', script: 'SET x = ROLL (( ))', outputTemplate: '%x%' }),
      opCtx([0.5])).errors[0].kind, 'bad-choice');
  checkEq('p5 op pick: an empty option is bad-choice',
    EO(S({ id: 'op_z3', name: 'Z', script: 'SET x = ROLL ((|))', outputTemplate: '%x%' }),
      opCtx([0.5])).errors[0].kind, 'bad-choice');
  const HIT = S({
    id: 'op_ce', name: 'Hit',
    script: 'SET d = ROLL |1d6|', outputTemplate: '%d% points',
  });
  const hitCtx = (draws) => opCtx(draws, {
    macros: [{ name: '1d6', formula: '1d6' }],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
  });
  checkEq('p5 op pick: a macro embed resolves', EO(HIT, hitCtx([0.5, 0.5])).output, '4 points');
  checkDeep('p5 op pick: template embed segments', EO(HIT, hitCtx([0.5, 0.5])).segments,
    [{ type: 'text', text: '4 points' }]);

  // ---- resolveEmbed: {name} ---------------------------------------------
  const ops = [
    { id: 'op_loot', name: 'Loot', script: 'SET x = ROLL ((gold))', outputTemplate: '%x%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
    { id: 'op_dmg', name: 'Damage', script: 'SET d = ROLL ((1-4))', outputTemplate: '%d%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
  ];
  const octx = (draws, extra) => {
    const r = seqRng(draws);
    return Object.assign({
      operations: ops,
      rng: r,
    }, extra || {});
  };
  const e1 = R('with {loot}', octx([0.5]));
  checkEq('p5 resolve: op resolves by name', e1.ok, true);
  checkEq('p5 resolve: op output', e1.output, 'with gold');
  checkDeep('p5 resolve: op segment shape', e1.segments, [
    { type: 'text', text: 'with ' },
    { type: 'op', text: 'gold', operationId: 'op_loot', operationName: 'Loot', token: '{loot}' },
  ]);
  checkEq('p5 resolve: op name is case-insensitive', R('{LOOT}', octx([0.5])).output, 'gold');
  checkEq('p5 resolve: op name is trimmed', R('{ Loot }', octx([0.5])).output, 'gold');
  checkDeep('p5 resolve: unknown op error', R('a {nope} b', octx([0.5])).errors,
    [{ kind: 'missing-operation', token: '{nope}', position: 2, operationName: 'nope' }]);
  checkEq('p5 resolve: unknown op echoes its token', R('a {nope} b', octx([0.5])).output, 'a {nope} b');
  checkDeep('p5 resolve: unknown op segments', R('a {nope} b', octx([0.5])).segments, [
    { type: 'text', text: 'a ' },
    { type: 'error', text: '{nope}' },
    { type: 'text', text: ' b' },
  ]);
  checkDeep('p5 resolve: empty op span is malformed', R('a {} b', octx([0.5])).errors,
    [{ kind: 'malformed', token: '{}', position: 2 }]);
  checkDeep('p5 resolve: unsupported type', R('{weird}', {
    operations: [{ id: 'op_w', name: 'Weird', type: 'odd' }],
    rng: () => 0,
    evalExpr: () => 1,
  }).errors, [{ kind: 'unsupported-operation', token: '{weird}', position: 0, operationName: 'Weird' }]);
  checkEq('p5 resolve: no operations in ctx is missing-operation',
    R('{loot}').errors[0].kind, 'missing-operation');
  checkEq('p5 resolve: two ops resolve in order',
    R('{damage} and {loot}', octx([0.5, 0.5])).output, '3 and gold');
  const opTable = [{
    id: 'tbl_op', name: 'Loot table', file: 'tables/x.json',
    entries: [{ label: 'You find {loot}', weight: 1 }],
  }];
  const inTable = R('[loot table]', octx([0.5], { containers: opTable, tableFile: 'tables/x.json' }));
  checkEq('p5 resolve: ops execute inside a container label', inTable.ok, true);
  checkEq('p5 resolve: container label op output', inTable.output, 'You find gold');

  // ---- runGenerator: ID-first, name fallback, missing -------------------
  const genOps = [
    { id: 'op_a', name: 'Enchantment', script: 'SET d = ROLL ((1-6))', outputTemplate: '%d%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
    { id: 'op_b', name: 'Loot Op', script: 'SET x = ROLL ((coin))', outputTemplate: '%x%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
  ];
  const gctx = (draws, extra) => {
    const r = seqRng(draws);
    return Object.assign({
      operations: genOps,
      rng: r,
      containers: [],
      tableFile: '',
    }, extra || {});
  };
  const gen = (template, operations) => ({
    id: 'g_p5', name: 'G', template, references: [], operations,
  });
  const noEntry = () => null;

  const g1 = RG(gen('a {enchantment} b'), [], noEntry, gctx([0.5, 0.5]));
  checkEq('p5 gen: op ok', g1.ok, true);
  checkEq('p5 gen: op output', g1.output, 'a 4 b');
  checkDeep('p5 gen: op segment', g1.segments[1], {
    type: 'op', text: '4', operationId: 'op_a', operationName: 'Enchantment',
    token: '{enchantment}',
  });
  checkDeep('p5 gen: op trace keys', Object.keys(g1.trace[0]).sort(),
    ['children', 'depth', 'operationId', 'operationName', 'output', 'segments', 'token', 'type']);
  checkEq('p5 gen: op trace name', g1.trace[0].operationName, 'Enchantment');
  checkEq('p5 gen: op trace depth', g1.trace[0].depth, 0);

  // ID-first: the stored ref keeps pointing at op_a after a rename, even
  // though a NEW operation now owns the token's name.
  const renamedOps = [
    { id: 'op_a', name: 'Rune', script: 'SET d = ROLL ((1-6))', outputTemplate: '%d%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
    { id: 'op_c', name: 'Enchantment', script: 'SET x = ROLL ((decoy))', outputTemplate: '%x%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
  ];
  const stored = gen('a {enchantment} b',
    [{ token: 'enchantment', operationId: 'op_a', operationName: 'Enchantment' }]);
  const g2 = RG(stored, [], noEntry, gctx([0.5, 0.5], { operations: renamedOps }));
  checkEq('p5 gen: stored id beats a same-named newcomer', g2.output, 'a 4 b');
  checkEq('p5 gen: stored id segment id', g2.segments[1].operationId, 'op_a');
  checkEq('p5 gen: stored id segment name is the live name', g2.segments[1].operationName, 'Rune');

  const stale = gen('{enchantment}',
    [{ token: 'enchantment', operationId: 'op_gone', operationName: 'Enchantment' }]);
  const g3 = RG(stale, [], noEntry, gctx([0.5, 0.5]));
  checkEq('p5 gen: a stale id falls back to the name', g3.ok, true);
  checkEq('p5 gen: name fallback output', g3.output, '4');

  const g4 = RG(gen('a {nope} b'), [], noEntry, gctx([0.5]));
  checkEq('p5 gen: missing op fails', g4.ok, false);
  checkDeep('p5 gen: missing op error carries occurrences', g4.errors,
    [{ kind: 'missing-operation', token: 'nope', occurrences: [{ index: 0, position: 2 }] }]);
  checkDeep('p5 gen: a missing op short-circuits like a missing container',
    Object.keys(g4).sort(), ['errors', 'ok']);
  const g5 = RG(gen('a {enchantment} b'), [], noEntry);
  checkEq('p5 gen: a 3-arg run reports missing-operation', g5.errors[0].kind, 'missing-operation');
  checkEq('p5 gen: the 3-arg error keeps the trimmed token', g5.errors[0].token, 'enchantment');
  const g6 = RG(gen('{odd}'), [], noEntry,
    gctx([0.5], { operations: [{ id: 'op_o', name: 'Odd', type: 'weird', config: {} }] }));
  checkEq('p5 gen: unsupported type fails validation', g6.errors[0].kind, 'unsupported-operation');
  checkDeep('p5 gen: unsupported type occurrences', g6.errors[0].occurrences,
    [{ index: 0, position: 0 }]);
  const weapons = { id: 'tbl_w', name: 'Weapons', entries: [{ label: 'Sword', weight: 1 }], file: 'tables/w.json' };
  const g7 = RG(gen('{loot op} a [weapons]'), [weapons],
    (container) => container.entries[0], gctx([0.5]));
  checkEq('p5 gen: op and ref in one template', g7.output, 'coin a Sword');
  checkEq('p5 gen: op and ref segment types',
    g7.segments.map((s) => s.type).join(','), 'op,text,ref');
  checkEq('p5 gen: op + ref keeps its roll', g7.rolls.length, 1);

  // ---- validateGenerator without operations is unchanged ----------------
  const legacyVal = VG(gen('{enchantment}'), []);
  checkEq('p5 validate: braces are opaque without an operations list', legacyVal.ok, true);
  checkDeep('p5 validate: no op errors without an operations list', legacyVal.errors, []);
  const valOps = VG(gen('a {enchantment} {missing}'), [], genOps);
  checkEq('p5 validate: an unknown op token fails', valOps.ok, false);
  checkDeep('p5 validate: op error pairs', valOps.errors.map((e) => [e.kind, e.token]),
    [['missing-operation', 'missing']]);
  const valUnsupported = VG(gen('{odd}'), [], [{ id: 'op_o', name: 'Odd', type: 'weird' }]);
  checkDeep('p5 validate: unsupported type occurrences', valUnsupported.errors[0].occurrences,
    [{ index: 0, position: 0 }]);
  const valEmpty = VG(gen('a {} b'), [], genOps);
  checkEq('p5 validate: an empty op token is malformed', valEmpty.errors[0].kind, 'malformed');
  checkEq('p5 validate: the empty token keeps its position',
    valEmpty.errors[0].occurrences[0].position, 2);

  // ---- resolveOperationRefs ---------------------------------------------
  checkDeep('p5 refs: a unique name resolves', ROR('a {enchantment} b', genOps, []),
    [{ token: 'enchantment', operationId: 'op_a', operationName: 'Enchantment' }]);
  checkDeep('p5 refs: the token is case-insensitive',
    ROR('{ENCHANTMENT}', genOps, []).map((r) => r.operationId), ['op_a']);
  checkDeep('p5 refs: a stored id survives a rename',
    ROR('{enchantment}', renamedOps,
      [{ token: 'enchantment', operationId: 'op_a', operationName: 'Enchantment' }]),
    [{ token: 'enchantment', operationId: 'op_a', operationName: 'Rune' }]);
  checkDeep('p5 refs: a stale id falls back to the name',
    ROR('{enchantment}', genOps, [{ token: 'enchantment', operationId: 'op_gone' }]),
    [{ token: 'enchantment', operationId: 'op_a', operationName: 'Enchantment' }]);
  checkDeep('p5 refs: an unknown token stays unresolved', ROR('{nope}', genOps, []),
    [{ token: 'nope', operationId: null, operationName: null }]);
  checkDeep('p5 refs: an empty token never resolves', ROR('{}', genOps, []),
    [{ token: '', operationId: null, operationName: null }]);
  checkDeep('p5 refs: duplicate names do not resolve',
    ROR('{dup}', [{ id: 'op_1', name: 'Dup' }, { id: 'op_2', name: 'Dup' }], []),
    [{ token: 'dup', operationId: null, operationName: null }]);
  checkDeep('p5 refs: first-occurrence order, no duplicates',
    ROR('{loot} {enchantment} {loot}', genOps, []).map((r) => r.token),
    ['loot', 'enchantment']);

  // ---- differential: `|`, `((` and `[` scan exactly as before ----------
  // Verbatim pre-`{` scanner: adding the brace opener must not move a single
  // offset for brace-free text.
  const legacyParseEmbeds = (text) => {
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
      let open = -1;
      let kind = '';
      if (pipe !== -1) { open = pipe; kind = 'pipe'; }
      if (paren !== -1 && (open === -1 || paren < open)) { open = paren; kind = 'paren'; }
      if (bracket !== -1 && (open === -1 || bracket < open)) { open = bracket; kind = 'bracket'; }
      if (open === -1) break;
      if (kind === 'paren') {
        const close = str.indexOf('))', open + 2);
        if (close === -1) i = open + 1;
        else {
          flushText(open);
          segments.push({ type: 'inline', inner: str.slice(open + 2, close), raw: str.slice(open, close + 2), start: open });
          i = close + 2;
          textStart = i;
        }
      } else if (kind === 'bracket') {
        const close = str.indexOf(']', open + 1);
        if (close === -1) i = open + 1;
        else {
          flushText(open);
          segments.push({ type: 'container', inner: str.slice(open + 1, close), raw: str.slice(open, close + 1), start: open });
          i = close + 1;
          textStart = i;
        }
      } else {
        const close = str.indexOf('|', open + 1);
        if (close === -1) i = open + 1;
        else {
          flushText(open);
          segments.push({ type: 'embed', inner: str.slice(open + 1, close), raw: str.slice(open, close + 1), start: open });
          i = close + 1;
          textStart = i;
        }
      }
    }
    flushText(str.length);
    if (segments.length === 0) segments.push({ type: 'text', text: '', start: 0 });
    return segments;
  };
  const braceFree = [
    '', 'abc', '|1d4|', '||', '| 1d4 |', 'a |1d4| b', '|a||b|', 'abc|', '|abc',
    'a|b|c', '((a|b))', 'Prose (page 5)', '(a|b)', 'a (b) ((c)) d', '[x]',
    '[a |1d4| b]', 'a [x] b [y]', '[a ((b))]', '((x [y] z))', 'a\n[b]',
  ];
  check('p5 differential: brace-free text scans identically',
    braceFree.every((s) => deepEq(P(s), legacyParseEmbeds(s))));
  check('p5 differential: brace-free text keeps the same template shapes',
    braceFree.every((s) => deepEq(
      PT(s).segments.map((g) => g.type),
      legacyParseEmbeds(s).map((g) => (g.type === 'container' ? 'ref' : g.type)))));
  checkDeep('p5 differential: a literal brace template now has one op span',
    PT('a {b} c').segments.map((g) => g.type), ['text', 'op', 'text']);
}

// ------------------------------------------ logic language (parser)
// js/logic-language.js — grammar, AST, validation, highlight-category data.
// Parsing, validation and syntax-highlighting-category tests, incl. the
// weighted inline choice and the OUTPUT parse error. The module is not
// consumed by app.js yet, so these are pure-function checks (no evaluator,
// no browser).
const LL = T.LogicLanguage;
check('ll: js/logic-language.js loaded and exported on the shared global',
  !!LL && typeof LL.parseScript === 'function' && typeof LL.highlightTokens === 'function');

function LLParse(src) { return LL.parseScript(src); }
function LLKinds(src) { return LLParse(src).errors.map(function (e) { return e.kind; }); }
function LLStmt(src, n) { return LLParse(src).statements[n || 0]; }
function LLKindOf(src) {
  const k = LLKinds(src);
  return k.length === 1 ? k[0] : '[' + k.join(',') + ']';
}
function LLThrows(fn) {
  try { fn(); return '(no throw)'; } catch (e) { return e.kind || ('raw:' + e.message); }
}
const LL_ERR_VALUES = Object.keys(LL.ERR).map(function (k) { return LL.ERR[k]; });

// ---- keywords (: OUTPUT is gone)
check('ll: KEYWORDS is the 12-keyword list and excludes OUTPUT',
  LL.KEYWORDS.length === 12 && LL.KEYWORDS.indexOf('OUTPUT') === -1 &&
  LL.KEYWORDS.indexOf('SET') !== -1 && LL.KEYWORDS.indexOf('SWITCH') !== -1 &&
  LL.KEYWORDS.indexOf('EXPOSE') !== -1);

// ---- SET / values (numeric format, assignment form)
const llSet = LLStmt('SET base_damage = 46');
checkEq('ll: SET parses to a set statement', llSet.type, 'set');
checkEq('ll: SET keeps the target name', llSet.name, 'base_damage');
checkEq('ll: SET numeric value is a number', llSet.value.value, 46);
checkEq('ll: SET decimal value (format)', LLStmt('SET ratio = 1.25').value.value, 1.25);
checkEq('ll: SET negative value', LLStmt('SET delta = -3').value.value, -3);
checkEq('ll: SET string value', LLStmt('SET rarity = "Legendary"').value.value, 'Legendary');
checkEq('ll: SET bare-name value is a reference', LLStmt('SET copy = rarity').value.name, 'rarity');
checkEq('ll: SET %name% value is normalized', LLStmt('SET copy = % base  dmg %').value.name, 'base  dmg');
checkEq('ll: SET %name% target supports spaces', LLStmt('SET %base dmg% = 1').name, 'base dmg');
checkEq('ll: bare x = y is a bare-assignment error', LLKindOf('rarity = "Legendary"'), 'bare-assignment');
checkEq('ll: mixed-case x = y is still a bare-assignment error', LLKindOf('Rarity = 1'), 'bare-assignment');
checkEq('ll: a spaced name on a bare assignment is still a bare-assignment error',
  LLKindOf('my var = 1'), 'bare-assignment');
checkEq('ll: a bare assignment is never parsed as a statement', LLParse('base damage = 1').statements.length, 0);
checkEq('ll: a line that is not name-shaped is unknown-keyword, not bare-assignment',
  LLKindOf('a-b = 1'), 'unknown-keyword');
checkEq('ll: bad number "1.2.3" rejected', LLKindOf('SET x = 1.2.3'), 'bad-number');
checkEq('ll: exponent notation rejected', LLKindOf('SET x = 1e5'), 'bad-number');
checkEq('ll: SET with trailing text rejected', LLKindOf('SET x = 1 junk'), 'trailing-text');
checkEq('ll: SET missing value', LLKindOf('SET x ='), 'missing-value');
checkEq('ll: SET without "="', LLKindOf('SET x 1'), 'incomplete');
// ---- statement boundaries: one statement per line, no separators
checkEq('ll: a semicolon between statements is a boundary error, not a bad number',
  LLKindOf('SET x = 1; SET y = 2'), 'trailing-text');
check('ll: the semicolon error names the one-statement-per-line rule', (function () {
  const e = LLParse('SET x = 1; SET y = 2').errors[0];
  return /one statement per line/.test(e.message);
})());
checkEq('ll: a semicolon glued to a name value is the same boundary error',
  LLKindOf('SET x = abc; SET y = 2'), 'trailing-text');
checkEq('ll: a semicolon in a condition is the same boundary error',
  LLKindOf('IF a == 1; THEN SET x = 1'), 'trailing-text');
checkEq('ll: a bare semicolon is not a statement', LLKindOf(';'), 'unknown-keyword');
checkEq('ll: a value that is only a semicolon is missing, not a bad name', LLKindOf('SET x = ;'), 'missing-value');
check('ll: the semicolon message also covers a trailing "; " after a string or a span', (function () {
  return ['SET x = "a"; SET y = 2', 'SET x = ROLL [a]; SET y = 2', 'IF a == 1 THEN SET x = 1;']
    .every(function (src) {
      const e = LLParse(src).errors[0];
      return e && e.kind === 'trailing-text' && /one statement per line/.test(e.message);
    });
})());
check('ll: the semicolon message covers IMPORT, EXPOSE, headers and SWITCH/CASE/DEFAULT', (function () {
  return ['IMPORT %a%;', 'EXPOSE a;', 'IF a == 1 THEN: ;', 'SWITCH x; y:',
    'SWITCH x:\n    CASE 1; 2:\n        SET a = 1', 'SWITCH x:\n    DEFAULT: ;\n        SET a = 1']
    .every(function (src) {
      const e = LLParse(src).errors[0];
      return e && e.kind === 'trailing-text' && /one statement per line/.test(e.message);
    });
})());
checkEq('ll: a two-statement line leaves no statements behind',
  LLParse('SET x = 1; SET y = 2').statements.length, 0);
// ---- numeric format (the evaluator's whole-string boundary conversion)
check('ll: isNumericText accepts the whole-string format',
  ['12', '-3', '+4.5', '0', '007', '10.0'].every(function (v) { return LL.isNumericText(v) === true; }));
check('ll: isNumericText rejects exponents, separators, partials and blanks',
  ['1e5', '1,000', '12px', '.5', '1.', '', ' 12 ', '12 '].every(function (v) { return LL.isNumericText(v) === false; }));
check('ll: isNumericText treats a trailing newline as non-numeric (a whole-string rule)',
  LL.isNumericText('12\n') === false);
check('ll: isNumericText agrees with the parser on a literal', (function () {
  return LL.isNumericText(String(LLStmt('SET x = 46').value.value)) === true &&
    LL.isNumericText('1.2.3') === false;
})());

// ---- ROLL (: ROLL only ever appears as a SET value)
const llRollC = LLStmt('SET weapon = ROLL [chest]').value;
checkEq('ll: ROLL [container] node', llRollC.type + ':' + llRollC.kind, 'roll:container');
checkEq('ll: ROLL container ref kept', llRollC.ref, 'chest');
const llRollR = LLStmt('SET dmg = ROLL ((30-50))').value;
checkEq('ll: ROLL range min', llRollR.parsed.min, 30);
checkEq('ll: ROLL range max', llRollR.parsed.max, 50);
checkEq('ll: ROLL |dice expression|', LLStmt('SET atk = ROLL |2d6+3|').value.inner, '2d6+3');
checkEq('ll: ROLL |macro|', LLStmt('SET d = ROLL |Sword|').value.inner, 'Sword');
checkEq('ll: ROLL weighted inline choice', LLStmt('SET loot = ROLL ((Gold:2 | Silver))').value.parsed.options[0].weight, 2);
checkEq('ll: standalone ROLL is a misplaced-roll error', LLKindOf('ROLL [chest]'), 'misplaced-roll');
checkEq('ll: ROLL with no argument', LLKindOf('SET x = ROLL'), 'bad-roll');
checkEq('ll: ROLL with an unterminated container', LLKindOf('SET x = ROLL [chest'), 'bad-roll');
checkEq('ll: ROLL without a space before its reference', LLKindOf('SET x = ROLL|2d6|'), 'bad-roll');
checkEq('ll: ROLL without a space before a container', LLKindOf('SET x = ROLL[chest]'), 'bad-roll');

// ---- multi-draw SET extensions (broadcast / zip / EACH ROLL / UNIQUE)
// Old single-name forms parse to the exact old node (byte-identical).
const llOldSet = LLStmt('SET base_damage = 46');
checkDeep('ll: old single SET node is byte-identical', llOldSet,
  { type: 'set', name: 'base_damage', nameRaw: 'base_damage',
    value: { type: 'number', value: 46, line: 1 }, line: 1 });
checkEq('ll: old SET node keeps exactly its 5 fields', Object.keys(llOldSet).length, 5);
checkDeep('ll: old ROLL value node is byte-identical (no new flags)',
  LLStmt('SET weapon = ROLL [chest]').value,
  { type: 'roll', kind: 'container', ref: 'chest', line: 1 });
checkEq('ll: comma inside a string value stays one string (old form)',
  LLStmt('SET pair = "a,b"').value.value, 'a,b');
checkEq('ll: trailing text after a value is unchanged',
  LLKindOf('SET x = 1 junk'), 'trailing-text');
checkEq('ll: missing value is unchanged', LLKindOf('SET x ='), 'missing-value');
checkEq('ll: SET without "=" is unchanged', LLKindOf('SET x 1'), 'incomplete');

// broadcast: 1+ names, 1 source — one source feeds every name
const llBC = LLStmt('SET a, b, c = ROLL [chest]');
checkEq('ll: multi-name SET parses to a multi-set node', llBC.type, 'multi-set');
checkEq('ll: single source keeps the broadcast mode', llBC.mode, 'broadcast');
checkEq('ll: broadcast keeps all three names',
  llBC.names.map(function (x) { return x.name; }).join(','), 'a,b,c');
checkDeep('ll: broadcast value is the single roll', llBC.values[0],
  { type: 'roll', kind: 'container', ref: 'chest', line: 1 });
checkEq('ll: broadcast works with a plain value', LLStmt('SET a, b = 5').mode, 'broadcast');
checkEq('ll: broadcast works with an inline value',
  LLStmt('SET a, b = ((30-50))').values[0].type, 'inline');
checkEq('ll: multi-set carries the line number', llBC.line, 1);
checkEq('ll: a multi-draw SET parses cleanly', LLParse('SET a, b, c = ROLL [chest]').ok, true);
checkEq('ll: name in the left list', LLStmt('SET %a b%, c = 1').names[0].name, 'a b');

// zip: N names, N sources, paired by position
const llZ = LLStmt('SET a, b = 5, "x"');
checkEq('ll: N sources for N names is zip', llZ.mode, 'zip');
checkEq('ll: zip keeps both values', llZ.values.length, 2);
checkEq('ll: zip first value', llZ.values[0].value, 5);
checkEq('ll: zip second value', llZ.values[1].value, 'x');
checkEq('ll: zip pairs a ROLL and a number',
  LLStmt('SET a, b = ROLL [chest], 3').values[1].value, 3);
checkEq('ll: three-way zip', LLStmt('SET a, b, c = 1, 2, 3').mode, 'zip');

// EACH ROLL: sole source, one independent draw per name, any ROLL source
const llE = LLStmt('SET a, b, c = EACH ROLL [chest]');
checkEq('ll: EACH ROLL keeps the each mode', llE.mode, 'each');
checkEq('ll: EACH ROLL container ref', llE.values[0].ref, 'chest');
checkEq('ll: EACH ROLL carries the each flag', llE.values[0].each, true);
checkEq('ll: EACH ROLL with an inline source',
  LLStmt('SET a, b = EACH ROLL ((30-50))').values[0].kind, 'inline');
checkEq('ll: EACH ROLL with a pipe source',
  LLStmt('SET a, b = EACH ROLL |2d6+3|').values[0].inner, '2d6+3');
checkDeep('ll: single-name EACH keeps the old node shape',
  LLStmt('SET x = EACH ROLL [chest]'),
  { type: 'set', name: 'x', nameRaw: 'x',
    value: { type: 'roll', kind: 'container', ref: 'chest', each: true, line: 1 }, line: 1 });

// UNIQUE [container]: sole source, N distinct draws
const llU = LLStmt('SET a, b, c = UNIQUE [Swords]');
checkEq('ll: UNIQUE keeps the unique mode', llU.mode, 'unique');
checkDeep('ll: UNIQUE value node', llU.values[0], { type: 'unique', ref: 'Swords', line: 1 });
checkEq('ll: single-name UNIQUE keeps the old node shape',
  LLStmt('SET x = UNIQUE [Swords]').value.type, 'unique');
checkEq('ll: UNIQUE container keeps its inner data',
  LLStmt('SET a, b = UNIQUE [Loot #3]').values[0].ref, 'Loot #3');

// arity: N vars, M sources with M != 1 and M != N
checkEq('ll: 3 variables given 2 values is bad-arity', LLKindOf('SET a, b, c = 1, 2'), 'bad-arity');
checkEq('ll: 1 variable given 2 values is bad-arity', LLKindOf('SET a = 1, 2'), 'bad-arity');
checkEq('ll: 3 variables given 4 values is bad-arity', LLKindOf('SET a, b, c = 1, 2, 3, 4'), 'bad-arity');
checkEq('ll: bad-arity message is self-contained',
  LLParse('SET a, b, c = 1, 2').errors[0].message, '3 variables given 2 values');

// EACH / UNIQUE placement: valid only as the sole right-hand source
checkEq('ll: EACH ROLL inside a zip list is misplaced',
  LLKindOf('SET a, b = EACH ROLL [chest], 1'), 'misplaced-roll');
checkEq('ll: UNIQUE inside a zip list is misplaced',
  LLKindOf('SET a, b = UNIQUE [chest], 1'), 'misplaced-roll');
checkEq('ll: EACH without a ROLL is a bad-roll', LLKindOf('SET a = EACH 1'), 'bad-roll');
checkEq('ll: a bare EACH is a bad-roll', LLKindOf('SET a = EACH'), 'bad-roll');
checkEq('ll: UNIQUE without an argument is a bad-roll', LLKindOf('SET a = UNIQUE'), 'bad-roll');
checkEq('ll: UNIQUE with an inline source is a bad-roll', LLKindOf('SET a = UNIQUE ((30-50))'), 'bad-roll');
checkEq('ll: UNIQUE with a pipe source is a bad-roll', LLKindOf('SET a = UNIQUE |2d6|'), 'bad-roll');
checkEq('ll: UNIQUE without brackets is a bad-roll', LLKindOf('SET a = UNIQUE chest'), 'bad-roll');
checkEq('ll: UNIQUE empty container is a bad-roll', LLKindOf('SET a = UNIQUE []'), 'bad-roll');
checkEq('ll: UNIQUE unterminated container is a bad-roll', LLKindOf('SET a = UNIQUE [chest'), 'bad-roll');

// left side: comma-separated, unique names
checkEq('ll: duplicate name in one SET is a name-collision', LLKindOf('SET a, a = 1'), 'name-collision');
checkEq('ll: duplicate spelling in one SET is a name-collision', LLKindOf('SET a, %a% = 1'), 'name-collision');
checkEq('ll: EACH is reserved as a SET name', LLKindOf('SET EACH = 1'), 'bad-name');
checkEq('ll: UNIQUE is reserved as a SET name', LLKindOf('SET UNIQUE = 1'), 'bad-name');
checkEq('ll: %EACH% is reserved as a SET name', LLKindOf('SET %EACH% = 1'), 'bad-name');
checkEq('ll: empty name after a comma is a bad-name', LLKindOf('SET a, = 1'), 'bad-name');
checkEq('ll: leading comma in the name list is a bad-name', LLKindOf('SET , a = 1'), 'bad-name');

// value list: commas delimit forms, missing forms are named
checkEq('ll: trailing comma in the value list is a missing value', LLKindOf('SET a, b = 1,'), 'missing-value');
checkEq('ll: double comma in the value list is a missing value', LLKindOf('SET a, b = 1,, 2'), 'missing-value');
checkEq('ll: trailing text after a value list is unchanged', LLKindOf('SET a, b = 1, 2 junk'), 'trailing-text');

// ---- IMPORT / EXPOSE
checkEq('ll: IMPORT %name%', LLStmt('IMPORT %weapon%').name, 'weapon');
checkEq('ll: IMPORT trims inside the delimiters', LLStmt('IMPORT % base damage %').name, 'base damage');
checkEq('ll: IMPORT requires %...%', LLKindOf('IMPORT weapon'), 'bad-name');
checkEq('ll: IMPORT rejects an empty name', LLKindOf('IMPORT %%'), 'bad-name');
checkEq('ll: EXPOSE statement', LLStmt('EXPOSE rarity').type + ':' + LLStmt('EXPOSE rarity').name, 'expose:rarity');
checkEq('ll: EXPOSE accepts %name% for spaced names', LLStmt('EXPOSE %base dmg%').name, 'base dmg');
checkEq('ll: EXPOSE rejects a second word', LLKindOf('EXPOSE a b'), 'trailing-text');
checkEq('ll: EXPOSE with no name', LLKindOf('EXPOSE'), 'bad-name');

// ---- OUTPUT is not a keyword: a parse error, never a statement
const llOut = LLParse('OUTPUT rarity');
checkEq('ll: OUTPUT is a parse error', llOut.errors[0].kind, 'unknown-keyword');
checkEq('ll: OUTPUT parse error carries the line', llOut.errors[0].line, 1);
check('ll: OUTPUT parse error is self-contained (names the Output Template field)', /OUTPUT is not a keyword \u2014 use the Output Template field for formatting/.test(llOut.errors[0].message));
checkEq('ll: OUTPUT produces no statement', llOut.statements.length, 0);
checkEq('ll: OUTPUT inside a block is also an error',
  LLKindOf('IF a == 1 THEN:\n    OUTPUT x'), 'unknown-keyword');

// ---- comments: never affect boundaries, indentation or blocks
checkEq('ll: whole-line comment skipped', LLParse('# note\nSET x = 1').statements.length, 1);
checkEq('ll: trailing comment allowed', LLStmt('SET x = 1 # why').value.value, 1);
checkEq('ll: trailing comment after ROLL', LLStmt('SET w = ROLL [c] # pick one').value.ref, 'c');
checkEq('ll: comment inside an indented block', LLParse('IF a == 1 THEN:\n    # note\n    SET x = 1').statements[0].thenBody.length, 1);
checkEq('ll: "#" inside a string is not a comment', LLStmt('SET x = "a # b"').value.value, 'a # b');
checkEq('ll: "#" inside a [container] is data, not a comment', 
  LLStmt('SET x = ROLL [Loot #3]').value.ref, 'Loot #3');
checkEq('ll: "#" inside a |macro| is data', LLStmt('SET x = ROLL |Macro #2|').value.inner, 'Macro #2');
check('ll: "#" inside a choice label is data', (function () {
  const opts = LLStmt('SET x = ((Tag #1 | Tag #2))').value.parsed.options;
  return opts.length === 2 && opts[1].label === 'Tag #2';
})());
checkEq('ll: an unterminated string still hides "#" (string error, not a comment)',
  LLKindOf('SET x = "a # b'), 'unterminated-string');
checkEq('ll: an unterminated ((...)) hides "#" too (the span error wins)',
  LLKindOf('SET x = ((a # b'), 'unbalanced-parens');
checkEq('ll: an unterminated [container] hides "#" too', LLKindOf('SET x = ROLL [a # c'), 'bad-roll');
check('ll: an unclosed opener leaves no comment token behind', (function () {
  // The highlighter is the only place the rule is observable: for these inputs
  // the parse error is the same either way, so assert the comment boundary.
  return ['SET x = "a # b', 'SET x = ((a # b', 'SET x = ROLL [a # c', 'SET x = ROLL |a # c',
    'SET x = {a # c'].every(function (src) {
    return LL.highlightTokens(src).every(function (t) { return t.category !== 'comment'; });
  });
})());
check('ll: a literal "%" does not steal the comment that follows it', (function () {
  const toks = LL.highlightTokens('SET x = 50% # note');
  return toks.some(function (t) { return t.text === '# note' && t.category === 'comment'; });
})());
checkEq('ll: a literal "%" still leaves the value an error (no silent accept)',
  LLKindOf('SET x = 50% # note'), 'bad-number');
check('ll: a "%" whose closer comes after a span still lets the span keep its "#"', (function () {
 // `%` is only a name opener when its contents could be a name, so the
  // string keeps `# b` and the trailing `# note` is the comment.
  const toks = LL.highlightTokens('SET x = 50% "a # b" 50% # note');
  return toks.some(function (t) { return t.text === '"a # b"' && t.category === 'string'; }) &&
    toks.some(function (t) { return t.text === '# note' && t.category === 'comment'; });
})());
checkEq('ll: a %name% before a comment still parses as a name',
  LLStmt('SET x = %a b% # note').value.name, 'a b');
check('ll: a "#" inside a would-be %name% is still a comment (forbids it)', (function () {
  const toks = LL.highlightTokens('SET x = %a#b%');
  return toks.some(function (t) { return t.text === '#b%' && t.category === 'comment'; });
})());
checkEq('ll: comment-only script has no statements', LLParse('# only\n\n# comments').statements.length, 0);
check('ll: comment-only script is valid', LLParse('# only\n').ok);
checkEq('ll: an indented comment does not become an unexpected-indent error',
  LLParse('SET a = 1\n    # note\nSET b = 2').statements.length, 2);

// ---- IF: block and single-line forms
const llIf = LLStmt('IF weapon == "Shotgun" AND base_damage > 45 THEN:\n    SET rarity = "Legendary"\nELSE:\n    SET rarity = "Common"');
checkEq('ll: IF block form', llIf.type, 'if');
checkEq('ll: IF condition is an AND node', llIf.condition.type, 'and');
checkEq('ll: IF block then-body', llIf.thenBody.length, 1);
checkEq('ll: IF block else-body', llIf.elseBody.length, 1);
checkEq('ll: IF block then-body statement', llIf.thenBody[0].value.value, 'Legendary');
const llInlineIf = LLStmt('IF a == 1 THEN SET b = 2');
checkEq('ll: single-line IF body is exactly one statement', llInlineIf.thenBody.length, 1);
checkEq('ll: single-line IF body is a SET', llInlineIf.thenBody[0].type, 'set');
checkEq('ll: single-line IF has no else branch', llInlineIf.elseBody, null);
const llChain = LLStmt(
  'IF base_damage > 45 THEN:\n    SET rarity = "Legendary"\n' +
  'ELSE IF base_damage > 40 THEN:\n    SET rarity = "Rare"\n' +
  'ELSE IF base_damage > 35 THEN:\n    SET rarity = "Uncommon"\n' +
  'ELSE:\n    SET rarity = "Common"');
checkEq('ll: ELSE IF chain length', llChain.elseIfs.length, 2);
checkEq('ll: ELSE IF branches keep their order', llChain.elseIfs[0].condition.right.value, 40);
checkEq('ll: second ELSE IF branch', llChain.elseIfs[1].condition.right.value, 35);
checkEq('ll: ELSE IF line numbers are 1-based', llChain.elseIfs[0].line, 3);
checkEq('ll: ELSE branch body', llChain.elseBody[0].value.value, 'Common');
checkEq('ll: single-line ELSE IF body', LLStmt('IF a == 1 THEN SET b = 2\nELSE IF a == 2 THEN SET b = 3').elseIfs.length, 1);
checkEq('ll: single-line ELSE body becomes one statement',
  LLParse('IF a == 1 THEN SET b = 2\nELSE SET b = 3').statements[0].elseBody.length, 1);
checkEq('ll: ELSE without IF', LLKindOf('ELSE:\n    SET x = 1'), 'unexpected-else');
checkEq('ll: IF without THEN', LLKindOf('IF a == 1'), 'missing-then');
checkEq('ll: IF with an empty condition', LLKindOf('IF THEN:\n    SET x = 1'), 'empty-condition');
checkEq('ll: IF block with no body', LLKindOf('IF a == 1 THEN:'), 'empty-block');
checkEq('ll: single-line body accepts EXPOSE (: exactly one statement)',
  LLStmt('IF a == 1 THEN EXPOSE x').thenBody[0].type, 'expose');
checkEq('ll: single-line body accepts IMPORT', LLStmt('IF a == 1 THEN IMPORT %w%').thenBody[0].name, 'w');
checkEq('ll: a block statement cannot be a single-line body',
  LLKindOf('IF a == 1 THEN SWITCH b:'), 'invalid-then-statement');
checkEq('ll: ELSE with no body', LLKindOf('IF a == 1 THEN SET b = 2\nELSE'), 'empty-then');
checkEq('ll: two ELSE branches rejected', LLKindOf('IF a == 1 THEN SET b = 2\nELSE SET b = 3\nELSE SET b = 4'), 'unexpected-else');
checkEq('ll: ELSE IF after ELSE rejected', LLKindOf('IF a == 1 THEN SET b = 2\nELSE SET b = 3\nELSE IF a == 2 THEN SET b = 4'), 'unexpected-else');
checkEq('ll: an IF keyword glued to "(" is reported, not misread',
  LLKindOf('IF(a == 1) THEN SET x = 1'), 'unknown-keyword');
check('ll: the glued-keyword message asks for a space', (function () {
  const e = LLParse('IF(a == 1) THEN SET x = 1').errors[0];
  return /space/.test(e.message);
})());

// ---- condition expressions
const llOrAnd = LLStmt('IF a == 1 OR b == 2 AND c == 3 THEN SET x = 1').condition;
checkEq('ll: "A OR B AND C" roots at OR (AND tighter,)', llOrAnd.type, 'or');
checkEq('ll: "A OR B AND C" groups B AND C together', llOrAnd.right.type, 'and');
checkEq('ll: the AND keeps its left comparison', llOrAnd.right.left.left.name, 'b');
const llGroup = LLStmt('IF (a == 1 OR b == 2) AND c == 3 THEN SET x = 1').condition;
checkEq('ll: parens override precedence', llGroup.type, 'and');
checkEq('ll: parens produce a group node', llGroup.left.type, 'group');
checkEq('ll: the group holds the OR', llGroup.left.inner.type, 'or');
const llFour = LLStmt('IF a == 1 AND b == 2 OR c == 3 AND d == 4 THEN SET x = 1').condition;
checkEq('ll: "A AND B OR C AND D" roots at OR', llFour.type + '/' + llFour.left.type + '/' + llFour.right.type, 'or/and/and');
check('ll: all six comparison operators parse', ['==', '!=', '>', '<', '>=', '<='].every(function (op) {
  return LLStmt('IF a ' + op + ' 1 THEN SET x = 1').condition.op === op;
}));
checkEq('ll: ((15-20)) stays a random range inside a condition',
  LLStmt('IF ((15-20)) > 10 THEN SET x = 1').condition.left.parsed.type, 'range');
checkEq('ll: %name% works as a condition operand', LLStmt('IF %base dmg% > 10 THEN SET x = 1').condition.left.name, 'base dmg');
checkEq('ll: string comparison operand', LLStmt('IF rarity == "Rare" THEN SET x = 1').condition.right.value, 'Rare');
checkEq('ll: THEN inside a string is not the keyword', LLStmt('IF a == "THEN" THEN SET x = 1').condition.right.value, 'THEN');
checkEq('ll: condition must contain a comparison', LLKindOf('IF a THEN:\n    SET x = 1'), 'not-a-condition');
checkEq('ll: unbalanced parens in a condition', LLKindOf('IF (a == 1 THEN:\n    SET x = 1'), 'unbalanced-parens');
checkEq('ll: dangling AND in a condition', LLKindOf('IF a == 1 AND THEN SET x = 1'), 'incomplete-condition');
checkEq('ll: unterminated string in a condition', LLKindOf('IF a == "x THEN SET y = 1'), 'unterminated-string');

// ---- SWITCH / CASE / DEFAULT
const llSw = LLStmt('SWITCH weapon:\n    CASE "Shotgun":\n        SET r = "rare"\n    CASE "Pistol":\n        SET r = "common"\n    DEFAULT:\n        SET r = "none"');
checkEq('ll: SWITCH subject', llSw.subject.name, 'weapon');
checkEq('ll: SWITCH case count (2 CASE + DEFAULT)', llSw.cases.length, 3);
checkEq('ll: CASE value', llSw.cases[0].value.value, 'Shotgun');
checkEq('ll: CASE body', llSw.cases[0].body[0].value.value, 'rare');
checkEq('ll: DEFAULT flagged', llSw.cases[2].isDefault, true);
checkEq('ll: DEFAULT has no value', llSw.cases[2].value, null);
checkEq('ll: CASE ":" inside a string does not split the header',
  LLStmt('SWITCH x:\n    CASE "a:b":\n        SET r = 1').cases[0].value.value, 'a:b');
checkEq('ll: CASE 1 vs CASE 1.0 is a duplicate',
  LLKindOf('SWITCH x:\n    CASE 1:\n        SET a = 1\n    CASE 1.0:\n        SET b = 2'), 'duplicate-case');
check('ll: CASE "1" and CASE 1 are distinct',
  LLParse('SWITCH x:\n    CASE "1":\n        SET a = 1\n    CASE 1:\n        SET b = 2').ok);
checkEq('ll: two DEFAULT blocks rejected',
  LLKindOf('SWITCH x:\n    DEFAULT:\n        SET a = 1\n    DEFAULT:\n        SET b = 2'), 'duplicate-default');
checkEq('ll: empty SWITCH', LLKindOf('SWITCH x:'), 'empty-switch');
checkEq('ll: an empty CASE body is reported',
  LLKindOf('SWITCH x:\n    CASE 1:\n    DEFAULT:\n        SET a = 1'), 'empty-block');
checkEq('ll: an empty DEFAULT body is reported',
  LLKindOf('SWITCH x:\n    DEFAULT:'), 'empty-block');
checkEq('ll: CASE outside SWITCH', LLKindOf('CASE 1:\n    SET a = 1'), 'unexpected-case');
checkEq('ll: DEFAULT outside SWITCH', LLKindOf('DEFAULT:\n    SET a = 1'), 'unexpected-default');
checkEq('ll: a bare statement inside SWITCH', LLKindOf('SWITCH x:\n    SET a = 1'), 'unexpected-case');
checkEq('ll: CASE without a colon', LLKindOf('SWITCH x:\n    CASE 1\n        SET a = 1'), 'incomplete');
checkEq('ll: SWITCH may switch on a ROLL — the subject is a value and runs once',
  LLStmt('SWITCH ROLL |1d6|:\n    CASE 1:\n        SET a = 1').subject.kind, 'pipe');
checkEq('ll: SWITCH subject keeps its dice expression',
  LLStmt('SWITCH ROLL |2d6+3|:\n    CASE 1:\n        SET a = 1').subject.inner, '2d6+3');
checkEq('ll: SWITCH subject may be a container roll',
  LLStmt('SWITCH ROLL [chest]:\n    CASE "Sword":\n        SET a = 1').subject.ref, 'chest');
checkEq('ll: a macro name containing ":" does not split the SWITCH header',
  LLStmt('SWITCH ROLL |Sword: Fire|:\n    CASE 1:\n        SET a = 1').subject.inner, 'Sword: Fire');
checkEq('ll: a container name containing ":" does not split the SWITCH header',
  LLStmt('SWITCH ROLL [a:b]:\n    CASE 1:\n        SET a = 1').subject.ref, 'a:b');
checkEq('ll: CASE rejects ROLL — a label is a comparable value',
  LLKindOf('SWITCH x:\n    CASE ROLL |1d6|:\n        SET a = 1'), 'misplaced-roll');
checkEq('ll: variable assigned in a CASE body parses',
  LLStmt('SWITCH x:\n    CASE 1:\n        SET a = 1\n    DEFAULT:\n        SET a = 2').cases[0].body[0].name, 'a');

// ---- block structure and error recovery
checkEq('ll: a uniformly indented script parses', LLParse('    SET a = 1\n    SET b = 2').statements.length, 2);
checkEq('ll: a deeper top-level line is reported', LLKindOf('  SET a = 1\nSET b = 2'), 'unexpected-indent');
checkEq('ll: a deeper line inside a block is reported',
  LLKindOf('IF a == 1 THEN:\n    SET x = 1\n        SET y = 2'), 'unexpected-indent');
checkEq('ll: two statements in one block',
  LLParse('IF a == 1 THEN:\n    SET x = 1\n    SET y = 2').statements[0].thenBody.length, 2);
const llMulti = LLParse('x = 1\nSET y = 2\nOUTPUT z');
checkEq('ll: errors are collected per line, not just the first', llMulti.errors.length, 2);
checkEq('ll: errors are sorted by line', llMulti.errors.map(function (e) { return e.line; }).join(','), '1,3');
check('ll: a valid statement between errors still parses',
  llMulti.statements.length === 1 && llMulti.statements[0].name === 'y');
checkEq('ll: one bad header does not cascade into its body',
  LLParse('OUTPUT x\n    SET y = 1\nSET z = 2').errors.length, 1);
check('ll: every emitted error kind is declared in ERR',
  LLParse('x = 1\nOUTPUT y\nSWITCH z:\nIF a THEN:\n    SET b = 1').errors.every(function (e) {
    return LL_ERR_VALUES.indexOf(e.kind) !== -1;
  }));
check('ll: TYPE_MISMATCH and CYCLE are reserved evaluation kinds (part B)',
  LL.ERR.TYPE_MISMATCH === 'type-mismatch' && LL.ERR.CYCLE === 'cycle');
checkEq('ll: an orphan ELSE after a failed IF is not a second error',
  LLParse('IF a == 1 THEN:\n    SET x =\nELSE:\n    SET y = 2').errors.length, 1);
checkEq('ll: a block-body error reports the body line',
  LLParse('IF a == 1 THEN:\n    SET x =\nELSE:\n    SET y = 2').errors[0].line, 2);
checkEq('ll: a malformed number in a condition', LLKindOf('IF x == 1.2.3 THEN SET y = 1'), 'bad-number');
checkEq('ll: no line continuation', LLKindOf('IF a == 1 AND\n    b == 2 THEN SET x = 1'), 'missing-then');
checkEq('ll: no line continuation leaves no statement behind',
  LLParse('IF a == 1 AND\n    b == 2 THEN SET x = 1').statements.length, 0);
checkEq('ll: a no-break-space indent is not silently read as top level',
  LLKindOf('IF a == 1 THEN:\n    SET x = 1\n\u00a0\u00a0SET y = 2'), 'unexpected-indent');
checkEq('ll: a NBSP-indented line never becomes an unconditional statement',
  LLParse('IF a == 1 THEN:\n    SET x = 1\n\u00a0\u00a0SET y = 2').statements.length, 1);
checkEq('ll: a pathological condition line is a named error, not a stack overflow',
  LLKindOf('IF ' + new Array(20001).join('a == 1 AND ') + 'b == 2 THEN SET x = 1'), 'condition-too-long');
checkEq('ll: a missing operand after a comparison is a named error, not a TypeError',
  LLKindOf('IF a == THEN SET b = 1'), 'incomplete-condition');
checkEq('ll: a missing operand after a comparison in a block header is a named error',
  LLKindOf('IF a == THEN:\n    SET b = 1'), 'incomplete-condition');
checkEq('ll: a missing operand in a single-line ELSE IF is a named error',
  LLKindOf('IF a == 1 THEN SET b = 2\nELSE IF b == THEN SET y = 3'), 'incomplete-condition');
check('ll: parseScript returns errors (never throws) on malformed and pathological input', (function () {
  const inputs = [
    'IF a == THEN SET b = 1',
    'IF a == THEN:\n    SET b = 1',
    'IF a == 1 AND\n    b == 2 THEN SET x = 1',
    'IF ' + new Array(20001).join('a == 1 AND ') + 'b == 2 THEN SET x = 1',
    'IF ' + new Array(5000).join('( ') + 'a == 1 THEN SET x = 1',
    'SET x = (( ' + new Array(5000).join('a|') + '))',
    'SWITCH ' + new Array(5000).join('[') + ':',
    'IF ' + new Array(20000).join('(') + 'a == 1 THEN SET x = 1',
  ];
  return inputs.every(function (src) {
    try { const r = LLParse(src); return r && Array.isArray(r.errors) && r.errors.length > 0; }
    catch (e) { return false; }
  });
})());
checkEq('ll: an unterminated ((...)) in an IF header names the real problem',
  LLKindOf('IF a == ((1 THEN SET x = 1'), 'unbalanced-parens');
checkEq('ll: a leading BOM is not indentation',
  LLParse('\uFEFFSET a = 1\nSET b = 2').statements.length, 2);
checkEq('ll: a BOM-indented block still parses',
  LLParse('\uFEFFIF a == 1 THEN:\n    SET x = 1').statements.length, 1);
checkEq('ll: a stray CR after a line break is not indentation',
  LLParse('SET a = 1\n\rSET b = 2').statements.length, 2);
checkEq('ll: an empty statement is reported, not silently skipped',
  LLParse(':').errors[0].message, 'empty statement');
check('ll: validateProgram walks a hand-built deep condition without overflowing', (function () {
  let cond = { type: 'cmp', op: '==', left: { type: 'name', name: 'a', nameRaw: 'a', line: 1 }, right: { type: 'number', value: 1, line: 1 }, line: 1 };
  for (let n = 0; n < 100000; n++) cond = { type: 'or', left: cond, right: { type: 'cmp', op: '==', left: { type: 'name', name: 'b', nameRaw: 'b', line: 1 }, right: { type: 'number', value: 1, line: 1 }, line: 1 }, line: 1 };
  const r = LL.validateProgram([{ type: 'if', condition: cond, thenBody: [], elseIfs: [], elseBody: null, line: 1 }]);
  return r.ok === true;
})());
checkEq('ll: deep block nesting hits a named cap, not a stack overflow',
  LLKindOf((function () {
    let src = '';
    for (let n = 0; n < 60; n++) src += '    '.repeat(n) + 'IF a == ' + n + ' THEN:\n';
    return src;
  })()), 'nesting-too-deep');
checkEq('ll: deep condition grouping hits a named cap',
  LLKindOf('IF ' + '( '.repeat(60) + 'a == 1' + ' )'.repeat(60) + ' THEN SET x = 1'), 'nesting-too-deep');
checkEq('ll: ((...)) in condition position is never group parens',
  LLKindOf('IF ((a == 1)) THEN SET x = 1'), 'not-a-condition');

// ---- naming rules
checkEq('ll: normalizeName trims and keeps internal spaces', LL.normalizeName('  a  b  ', 1), 'a  b');
checkEq('ll: normalizeName rejects "%"', LLThrows(function () { LL.normalizeName('a%b', 1); }), 'bad-name');
checkEq('ll: normalizeName rejects an empty name', LLThrows(function () { LL.normalizeName('   ', 1); }), 'bad-name');
checkEq('ll: LogicError carries kind + line', LLThrows(function () { LL.normalizeName('', 7); }), 'bad-name');
check('ll: trimming alone is not a name collision',
  LLParse('SET %a b% = 1\nSET % a b % = 2').ok);
check('ll: names are case-sensitive', LLParse('SET Rarity = 1\nSET rarity = 2').ok);
check('ll: canonical-equivalent spellings collide',
  LLKinds('SET caf\u00e9 = 1\nSET %cafe\u0301% = 2').indexOf('name-collision') !== -1);
check('ll: the collision is reported once',
  LLKinds('SET caf\u00e9 = 1\nSET %cafe\u0301% = 2\nSET %cafe\u0301% = 3').length === 1);
checkEq('ll: validateProgram flags the collision kind',
  LLKindOf('SET caf\u00e9 = 1\nSET %cafe\u0301% = 2'), 'name-collision');
checkEq('ll: a collision between condition operands is reported too',
  LLKindOf('IF caf\u00e9 == 1 AND %cafe\u0301% == 2 THEN SET x = 1'), 'name-collision');
checkEq('ll: a bare keyword is not a variable name', LLKindOf('SET IF = 1'), 'bad-name');
checkEq('ll: a bare keyword is not a variable name in EXPOSE', LLKindOf('EXPOSE AND'), 'bad-name');
checkEq('ll: a keyword as a SET value is rejected', LLKindOf('SET x = THEN'), 'bad-name');
checkEq('ll: a keyword as a condition operand is rejected', LLKindOf('IF CASE == 1 THEN SET x = 1'), 'bad-name');
checkEq('ll: %IF% is still a legal variable name', LLStmt('SET %IF% = 1').name, 'IF');
checkEq('ll: digit-leading bare names are rejected', LLKindOf('SET 1a = 1'), 'bad-name');
checkEq('ll: a digit-leading line is not a bare assignment either (it is no name at all)',
  LLKindOf('1a = 2'), 'unknown-keyword');
checkEq('ll: %2nd% is a legal name', LLStmt('EXPOSE %2nd%').name, '2nd');
checkEq('ll: %name% = value is a bare-assignment error', LLKindOf('%x% = 5'), 'bare-assignment');
// ---- boolean literals (: three-way value model, reserved names)
checkEq('ll: SET x = true is a boolean value node', LLStmt('SET eligible = true').value.type, 'boolean');
checkEq('ll: the true literal parses to the JS true', LLStmt('SET eligible = true').value.value, true);
checkEq('ll: SET x = false is a boolean value node', LLStmt('SET eligible = false').value.type, 'boolean');
checkEq('ll: the false literal parses to the JS false', LLStmt('SET eligible = false').value.value, false);
checkEq('ll: SET true = 1 is rejected', LLKindOf('SET true = 1'), 'bad-name');
checkEq('ll: SET %true% = 1 is rejected (no %...% escape,)', LLKindOf('SET %true% = 1'), 'bad-name');
checkEq('ll: EXPOSE true is rejected', LLKindOf('EXPOSE true'), 'bad-name');
checkEq('ll: EXPOSE %false% is rejected', LLKindOf('EXPOSE %false%'), 'bad-name');
checkEq('ll: a true operand is a boolean node in a condition',
  LLStmt('IF flag == true THEN SET x = 1').condition.right.type, 'boolean');
checkEq('ll: a false operand is a boolean node in a condition',
  LLStmt('IF flag == false THEN SET x = 1').condition.right.type, 'boolean');
checkEq('ll: a bare boolean without comparison is still not a condition',
  LLKindOf('IF true THEN SET x = 1'), 'not-a-condition');
checkDeep('ll: BOOLEAN_LITERALS is exactly [true, false]', LL.BOOLEAN_LITERALS, ['true', 'false']);
check('ll: duplicate CASE true labels collide (type-aware key,)',
  LLParse('SWITCH x:\n  CASE true:\n    SET a = 1\n  CASE true:\n    SET b = 2\n  DEFAULT:\n    SET c = 3')
    .errors.some(function (e) { return e.kind === 'duplicate-case'; }));
check('ll: CASE true and CASE 1 are distinct values',
  LLParse('SWITCH x:\n  CASE true:\n    SET a = 1\n  CASE 1:\n    SET b = 2\n  DEFAULT:\n    SET c = 3').ok === true);

// ---- validateProgram on its own
check('ll: validateProgram accepts a clean program', LL.validateProgram(LLParse('SET a = 1\nEXPOSE a').statements).ok);
check('ll: parseScript merges validation errors',
  LLParse('SWITCH x:').errors.some(function (e) { return e.kind === 'empty-switch'; }));
check('ll: every parse error has exactly {kind, line, message}', (function () {
  return LLParse('x = 1\nOUTPUT y\nSWITCH z:\nIF a THEN:\n    SET b = 1').errors.every(function (e) {
    const keys = Object.keys(e).sort().join(',');
    return keys === 'kind,line,message' && typeof e.line === 'number' && typeof e.message === 'string';
  });
})());

// ---- weighted inline choice
const llChoice = LL.parseInlineChoice('X:2 | Y:5 | Z:1', 1);
checkEq('ll: weighted choice option count', llChoice.options.length, 3);
checkDeep('ll: weighted choice parses to the shape', llChoice.options,
  [{ label: 'X', weight: 2 }, { label: 'Y', weight: 5 }, { label: 'Z', weight: 1 }]);
checkDeep('ll: unweighted choice defaults every weight to 1 (backwards compatible)',
  LL.parseInlineChoice('Sword | Axe', 1).options,
  [{ label: 'Sword', weight: 1 }, { label: 'Axe', weight: 1 }]);
checkEq('ll: weight 0 is allowed (integer >= 0)', LL.parseInlineChoice('a:0|b', 1).options[0].weight, 0);
checkEq('ll: two-option choice', LL.parseInlineChoice('only|twice', 1).options[1].label, 'twice');
checkDeep('ll: ((Sword)) is a one-option pick, as in the engine', LL.parseInlineChoice('Sword', 1),
  { type: 'choice', options: [{ label: 'Sword', weight: 1 }] });
checkDeep('ll: ((Only:3)) is a weighted one-option pick', LL.parseInlineChoice('Only:3', 1),
  { type: 'choice', options: [{ label: 'Only', weight: 3 }] });
checkEq('ll: ((a-b)) is a label, not a range (engine parity)',
  LL.parseInlineChoice('a-b', 1).options[0].label, 'a-b');
checkDeep('ll: ((30-50)) stays a range', LL.parseInlineChoice('30-50', 1), { type: 'range', min: 30, max: 50 });
checkEq('ll: spaced range is still a range', LL.parseInlineChoice(' 30 - 50 ', 1).type, 'range');
checkEq('ll: a reversed range is rejected',
  LLThrows(function () { LL.parseInlineChoice('50-30', 1); }), 'reversed-range');
checkEq('ll: a malformed range is rejected',
  LLThrows(function () { LL.parseInlineChoice('1.5-3', 1); }), 'invalid-range');
checkEq('ll: an empty (( )) is rejected',
  LLThrows(function () { LL.parseInlineChoice('   ', 1); }), 'bad-choice');
check('ll: the bad-weight message explains the weight rule', (function () {
  try { LL.parseInlineChoice('a:b:2|c', 1); return false; } catch (e) { return /weight/.test(e.message); }
})());
checkEq('ll: non-integer weight is a bad-choice error',
  LLThrows(function () { LL.parseInlineChoice('a:x|b', 1); }), 'bad-choice');
checkEq('ll: empty option is a bad-choice error',
  LLThrows(function () { LL.parseInlineChoice('a|', 1); }), 'bad-choice');
checkEq('ll: a label containing ":" is a bad-choice error',
  LLThrows(function () { LL.parseInlineChoice('a:b:2|c', 1); }), 'bad-choice');
checkEq('ll: a weighted range is rejected (: no weighted ((15-20)) ranges)',
  LLThrows(function () { LL.parseInlineChoice('30-50:2', 1); }), 'invalid-range');
checkEq('ll: a weighted range in SET reports invalid-range',
  LLParse('SET x = ((30-50:2))').errors[0].kind, 'invalid-range');
checkEq('ll: weighted choice in SET', LLStmt('SET loot = ((Gold:2 | Silver:5))').value.parsed.options[1].weight, 5);
checkEq('ll: weighted choice in a condition operand',
  LLStmt('IF ((Gold:2 | Silver)) == "Gold" THEN SET x = 1').condition.left.parsed.type, 'choice');
checkEq('ll: weighted choice in ROLL',
  LLStmt('SET loot = ROLL ((Gold:2 | Silver))').value.parsed.options[0].label, 'Gold');

// ---- highlighting categories — data only, no CSS
const llSrc = 'SET rarity = "Legendary" # pick one';
const llToks = LL.highlightTokens(llSrc);
check('llh: SET is a keyword token', llToks.some(function (t) { return t.text === 'SET' && t.category === 'keyword'; }));
check('llh: a plain identifier is a variable, never a keyword',
  llToks.some(function (t) { return t.text === 'rarity' && t.category === 'variable'; }));
check('llh: string literal category', llToks.some(function (t) { return t.text === '"Legendary"' && t.category === 'string'; }));
check('llh: comment category', llToks.some(function (t) { return t.text === '# pick one' && t.category === 'comment'; }));
check('llh: "=" is an operator token', llToks.some(function (t) { return t.text === '=' && t.category === 'operator'; }));
check('llh: "==" is one operator token',
  LL.highlightTokens('IF a == 1 THEN SET x = 1').some(function (t) { return t.text === '==' && t.category === 'operator'; }));
check('llh: %name% is a variable reference',
  LL.highlightTokens('IMPORT %weapon%').some(function (t) { return t.text === '%weapon%' && t.category === 'variable'; }));
check('llh: [container] is a container reference',
  LL.highlightTokens('SET w = ROLL [chest]').some(function (t) { return t.text === '[chest]' && t.category === 'container'; }));
check('llh: |dice| is a dice reference',
  LL.highlightTokens('SET d = ROLL |2d6+3|').some(function (t) { return t.text === '|2d6+3|' && t.category === 'dice'; }));
check('llh: ((...)) is one inline span (choice or range)',
  LL.highlightTokens('SET r = ((1-6))').some(function (t) { return t.text === '((1-6))' && t.category === 'inline'; }));
check('llh: {op} is a logic-operation reference',
  LL.highlightTokens('SET x = {op}').some(function (t) { return t.text === '{op}' && t.category === 'op'; }));
check('llh: numbers are their own category',
  LL.highlightTokens('SET x = 42').some(function (t) { return t.text === '42' && t.category === 'number'; }));
check('llh: all 12 keywords highlight as keyword', LL.KEYWORDS.every(function (k) {
  const t = LL.highlightTokens(k)[0];
  return !!t && t.text === k && t.category === 'keyword';
}));
check('llh: true/false highlight as keyword', LL.BOOLEAN_LITERALS.every(function (k) {
  const t = LL.highlightTokens(k)[0];
  return !!t && t.text === k && t.category === 'keyword';
}));
check('llh: a keyword inside a string is never pink', (function () {
  const toks = LL.highlightTokens('SET x = "SET IF THEN OR"');
  return toks.filter(function (t) { return t.category === 'keyword'; }).length === 1;
})());
check('llh: a keyword inside a comment is never pink', (function () {
  const toks = LL.highlightTokens('# SET IF THEN\nSET x = 1');
  return toks.filter(function (t) { return t.category === 'keyword'; }).length === 1;
})());
check('llh: OUTPUT is not highlighted as a keyword',
  LL.highlightTokens('OUTPUT x').every(function (t) { return t.category !== 'keyword'; }));
check('llh: a word merely containing a keyword is not pink',
  LL.highlightTokens('SET setting = 1').filter(function (t) { return t.category === 'keyword'; }).length === 1);
check('llh: tokens rebuild the source exactly', (function () {
  const src = 'IF a == 1 AND [W] != |2d6| THEN:\n    SET v = %dmg% # note\nEXPOSE v';
  return LL.highlightTokens(src).map(function (t) { return t.text; }).join('') === src;
})());
check('llh: a CRLF source also rebuilds exactly (line breaks are tokens)', (function () {
  const src = 'SET a = 1\r\nSET b = 2';
  return LL.highlightTokens(src).map(function (t) { return t.text; }).join('') === src;
})());
check('llh: a "#" inside a span never duplicates source text', (function () {
  const src = 'SET x = [a # b]';
  const joined = LL.highlightTokens(src).map(function (t) { return t.text; }).join('');
  return joined === src;
})());
check('llh: a "#" inside a span stays part of the span, never a comment', (function () {
  const toks = LL.highlightTokens('SET x = ROLL [Loot #3] # note');
  return toks.some(function (t) { return t.text === '[Loot #3]' && t.category === 'container'; }) &&
    toks.some(function (t) { return t.text === '# note' && t.category === 'comment'; });
})());
check('llh: "#" inside a {…} operation reference is data too', (function () {
  const toks = LL.highlightTokens('SET x = {Op #1} # note');
  return toks.some(function (t) { return t.text === '{Op #1}' && t.category === 'op'; }) &&
    toks.some(function (t) { return t.text === '# note' && t.category === 'comment'; });
})());
check('llh: "#" cannot be a name character, so it starts the comment', (function () {
  const toks = LL.highlightTokens('SET x = %a#b');
  return toks.some(function (t) { return t.text === '#b' && t.category === 'comment'; });
})());
check('llh: the comment rule matches the parser rule (code-only text still parses)', (function () {
  return ['SET x = 1 # c', 'SET x = ROLL [Loot #3] # c', 'SET x = ((Tag #1)) # c', 'SET x = "a # b" # c']
    .every(function (src) {
      const code = LL.highlightTokens(src).filter(function (t) { return t.category !== 'comment'; })
        .map(function (t) { return t.text; }).join('');
      const r = LL.parseScript(code);
      return r.errors.length === 0 && r.statements.length === 1;
    });
})());
check('llh: only categories present in HIGHLIGHT are emitted', (function () {
  const seen = {};
  LL.highlightTokens('IF a == 1 AND [W] != |2d6| THEN:\n    SET v = %dmg% + ((x:2|y)) # n\nEXPOSE {op}').forEach(function (t) {
    seen[t.category] = true;
  });
  return Object.keys(seen).every(function (c) { return LL.HIGHLIGHT[c] !== undefined; });
})());
checkDeep('llh: keyword maps to the pink keyword token', LL.HIGHLIGHT.keyword, { token: '--keyword', cls: 'script-keyword' });
checkDeep('llh: variable maps to the dedicated var token', LL.HIGHLIGHT.variable, { token: '--script-var', cls: 'script-var' });
checkDeep('llh: errors map to danger (orange/red,)', LL.HIGHLIGHT.error, { token: '--danger', cls: 'embed-err' });
checkEq('llh: comments are muted', LL.HIGHLIGHT.comment.token, '--muted');
checkEq('llh: containers stay blue', LL.HIGHLIGHT.container.token, '--ref');
checkEq('llh: operation references stay purple', LL.HIGHLIGHT.op.token, '--op');
checkEq('llh: dice stay teal', LL.HIGHLIGHT.dice.token, '--embed');
check('llh: highlighting never throws on broken input and always rebuilds the source', (function () {
  return ['IF ((', 'SET x = "', '#', 'SWITCH', 'CASE "a:b":', 'SET %x', '((a|b)',
    'SET x = 50% # n', 'SET x = ROLL [a # b', '%'.repeat(50), '['.repeat(50)].every(function (s) {
    try {
      const toks = LL.highlightTokens(s);
      return toks.length > 0 && toks.map(function (t) { return t.text; }).join('') === s;
    } catch (e) {
      return false;
    }
  });
})());

// ---- acceptance scripts parse as written (grammar must express them)
check('ll: Example A script parses (SET/ROLL/IF/ELSE)', (function () {
  const r = LLParse([
    'SET weapon = ROLL [chest]',
    'SET base_damage = ROLL ((30-50))',
    '',
    'IF weapon == "Shotgun" AND base_damage > 45 THEN:',
    '    SET rarity = "Legendary"',
    'ELSE:',
    '    SET rarity = "Common"',
  ].join('\n'));
  const s = r.statements;
  return r.ok && s.length === 3 && s[0].value.kind === 'container' &&
    s[1].value.parsed.min === 30 && s[2].condition.type === 'and' &&
    s[2].thenBody[0].value.value === 'Legendary' && s[2].elseBody[0].value.value === 'Common';
})());
check('ll: Example B script parses (IMPORT + IF/ELSE)', (function () {
  const r = LLParse([
    'IMPORT %weapon%',
    '',
    'IF weapon == "Shotgun" THEN:',
    '    SET rarity = "Heavy Weapon"',
    'ELSE:',
    '    SET rarity = "Other Weapon"',
  ].join('\n'));
  return r.ok && r.statements.length === 2 && r.statements[0].name === 'weapon' &&
    r.statements[1].elseBody[0].value.value === 'Other Weapon';
})());
check('ll: EXPOSE pair parses after the comment example', (function () {
  const r = LLParse([
    '# Roll weapon damage before determining rarity.',
    'SET base_damage = ROLL ((30-50))',
    '',
    '# Only high-damage shotguns become legendary.',
    'IF weapon == "Shotgun" AND base_damage > 45 THEN:',
    '    SET rarity = "Legendary"',
    'ELSE:',
    '    SET rarity = "Common"',
    'EXPOSE rarity',
    'EXPOSE base_damage',
  ].join('\n'));
  const exposed = r.statements.filter(function (s) { return s.type === 'expose'; })
    .map(function (s) { return s.name; });
  return r.ok && exposed.join(',') === 'rarity,base_damage';
})());
check('ll: three-branch ELSE IF chain parses in order', (function () {
  const r = LLParse([
    'IF base_damage > 45 THEN:',
    '    SET rarity = "Legendary"',
    'ELSE IF base_damage > 40 THEN:',
    '    SET rarity = "Rare"',
    'ELSE:',
    '    SET rarity = "Common"',
  ].join('\n'));
  return r.ok && r.statements[0].elseIfs.length === 1 && r.statements[0].elseBody.length === 1;
})());
check('ll: SWITCH example parses with two CASEs and one DEFAULT', (function () {
  const r = LLParse([
    'SWITCH weapon:',
    '    CASE "Shotgun":',
    '        SET weapon_class = "Heavy"',
    '    CASE "Pistol":',
    '        SET weapon_class = "Sidearm"',
    '    DEFAULT:',
    '        SET weapon_class = "Other"',
  ].join('\n'));
  const sw = r.statements[0];
  return r.ok && sw.type === 'switch' && sw.cases.length === 3 && sw.cases[2].isDefault === true;
})());

// =====================================================================
// Data model: typed values, variable scoping, occurrence ids + bindings +
// template-change reconciliation, item mode, the operation model + strict
// bundle validation, and output-template substitution.
// Model only — no evaluator. Pure functions unless noted; state is seeded
// below for the engine-dependent tests and restored before the summary.
// =====================================================================

// ---- +: typed values (number / string / boolean; missing is distinct)
checkDeep('pb d6: LOGIC_VALUE_KINDS is exactly number + string + boolean',
  T.LOGIC_VALUE_KINDS, ['number', 'string', 'boolean']);
checkEq('pb d6: 0 is a number value (not missing)', T.typedValueKind(0), 'number');
checkEq('pb d6: empty string is a string value (not missing)', T.typedValueKind(''), 'string');
checkEq('pb d6: 42 is a number', T.typedValueKind(42), 'number');
checkEq('pb d6: -3.5 is a number', T.typedValueKind(-3.5), 'number');
checkEq('pb d6: NaN has no kind', T.typedValueKind(NaN), null);
checkEq('pb d6: Infinity has no kind', T.typedValueKind(Infinity), null);
checkEq('pb d6: -Infinity has no kind', T.typedValueKind(-Infinity), null);
checkEq('pb d6: true has the boolean kind', T.typedValueKind(true), 'boolean');
checkEq('pb d6: false has the boolean kind', T.typedValueKind(false), 'boolean');
checkEq('pb d6: null has no kind', T.typedValueKind(null), null);
checkEq('pb d6: undefined has no kind', T.typedValueKind(undefined), null);
checkEq('pb d6: object has no kind', T.typedValueKind({ a: 1 }), null);
checkEq('pb d6: array has no kind', T.typedValueKind([1]), null);
checkEq('pb d6: function has no kind', T.typedValueKind(function () { return 1; }), null);
checkEq('pb d6: makeTypedValue keeps a finite number', T.makeTypedValue(12), 12);
checkEq('pb d6: makeTypedValue keeps a string', T.makeTypedValue('hi'), 'hi');
checkEq('pb d6: makeTypedValue("42") converts to 42 (exact)', T.makeTypedValue('42'), 42);
checkEq('pb d6: makeTypedValue("-3.5") converts to -3.5', T.makeTypedValue('-3.5'), -3.5);
checkEq('pb d6: makeTypedValue("+7") converts to 7', T.makeTypedValue('+7'), 7);
checkEq('pb d6: makeTypedValue(" 42 ") stays a string (no surrounding whitespace)', T.makeTypedValue(' 42 '), ' 42 ');
checkEq('pb d6: makeTypedValue("42 ") stays a string', T.makeTypedValue('42 '), '42 ');
checkEq('pb d6: makeTypedValue("12\\n") stays a string', T.makeTypedValue('12\n'), '12\n');
checkEq('pb d6: makeTypedValue(null) is the absent slot (undefined)', T.makeTypedValue(null), undefined);
checkEq('pb d6: makeTypedValue(undefined) is the absent slot', T.makeTypedValue(undefined), undefined);
checkEq('pb d6: makeTypedValue(true) is true', T.makeTypedValue(true), true);
checkEq('pb d6: makeTypedValue(false) is false', T.makeTypedValue(false), false);
checkEq('pb d6: makeTypedValue(NaN) is the absent slot', T.makeTypedValue(NaN), undefined);
checkEq('pb d6: makeTypedValue(object) is the absent slot', T.makeTypedValue({}), undefined);
checkDeep('pb d6: asNumberValue(42) ok', T.asNumberValue(42), { ok: true, value: 42 });
checkDeep('pb d6: asNumberValue(0) ok', T.asNumberValue(0), { ok: true, value: 0 });
checkDeep('pb d6: asNumberValue(null) missing-variable', T.asNumberValue(null), { ok: false, kind: 'missing-variable' });
checkDeep('pb d6: asNumberValue(undefined) missing-variable', T.asNumberValue(undefined), { ok: false, kind: 'missing-variable' });
checkDeep('pb d6: asNumberValue(true) type-mismatch', T.asNumberValue(true), { ok: false, kind: 'type-mismatch', value: true });
checkDeep('pb d6: asNumberValue("42") type-mismatch (numeric text is not a number)', T.asNumberValue('42'), { ok: false, kind: 'type-mismatch', value: '42' });
checkDeep('pb d6: asNumberValue("hi") type-mismatch', T.asNumberValue('hi'), { ok: false, kind: 'type-mismatch', value: 'hi' });
check('pb d6: asNumberValue(NaN) type-mismatch carrying the NaN', (function () {
  const r = T.asNumberValue(NaN);
  return r.ok === false && r.kind === 'type-mismatch' && r.value !== r.value;
})());
check('pb d6: asNumberValue(Infinity) type-mismatch carrying the Infinity', (function () {
  const r = T.asNumberValue(Infinity);
  return r.ok === false && r.kind === 'type-mismatch' && r.value === Infinity;
})());

// ----: numeric text format
check('pb d19: exact-format battery (regex)', (function () {
  const pos = ['42', '-3.5', '+7', '0', '100.25', '-0', '+0.5'];
  const neg = [' 42 ', '42 ', ' 42', '12\n', '1e3', '1,000', '.5', '5.', '1.2.3', '', '1 2', '0x10', '4 2', '+', '-'];
  return pos.every((s) => T.LOGIC_NUMERIC_FORMAT_RE.test(s))
    && neg.every((s) => !T.LOGIC_NUMERIC_FORMAT_RE.test(s));
})());
check('pb d19: isLogicNumericText agrees with the regex on the same battery', (function () {
  const all = ['42', '-3.5', '+7', '0', '100.25', '-0', '+0.5', ' 42 ', '42 ', ' 42', '12\n',
    '1e3', '1,000', '.5', '5.', '1.2.3', '', '1 2', '0x10', '4 2', '12.34.56', '+', '-', 'NaN', 'Infinity'];
  return all.every((s) => T.isLogicNumericText(s) === T.LOGIC_NUMERIC_FORMAT_RE.test(s));
})());
check('pb d19: isLogicNumericText coerces non-strings (null/undefined -> empty)', (function () {
  return T.isLogicNumericText(12) === true
    && T.isLogicNumericText(-3.5) === true
    && T.isLogicNumericText(42.5) === true
    && T.isLogicNumericText(null) === false
    && T.isLogicNumericText(undefined) === false
    && T.isLogicNumericText(true) === false
    && T.isLogicNumericText(NaN) === false;
})());

// ----: variable scoping (local > imported > generator; result scopes never searched)
checkDeep('pb d6: LOGIC_SCOPES list', T.LOGIC_SCOPES, ['generator', 'imported', 'local', 'exposed', 'output']);
check('pb d6: local wins over imported, imported over generator', (function () {
  const r = T.resolveVariable('x', { local: { x: 1 }, imported: { x: 2 }, generator: { x: 3 } });
  return r !== null && r.scope === 'local' && r.value === 1;
})());
check('pb d6: imported beats generator when local is absent', (function () {
  const r = T.resolveVariable('x', { imported: { x: 2 }, generator: { x: 3 } });
  return r !== null && r.scope === 'imported' && r.value === 2;
})());
check('pb d6: generator is the last searched scope', (function () {
  const r = T.resolveVariable('x', { generator: { x: 3 } });
  return r !== null && r.scope === 'generator' && r.value === 3;
})());
check('pb d6: present-but-undefined slot still shadows', (function () {
  const r = T.resolveVariable('x', { local: { x: undefined }, generator: { x: 3 } });
  return r !== null && r.scope === 'local' && r.value === undefined;
})());
check('pb d6: exposed/output are result scopes and are never searched', (function () {
  const r = T.resolveVariable('x', { exposed: { x: 1 }, output: { x: 2 } });
  return r === null;
})());
check('pb d6: exposed/output ignored even when nothing else holds the name', (function () {
  const r = T.resolveVariable('x', { generator: {}, exposed: { x: 9 }, output: { x: 8 } });
  return r === null;
})());
check('pb d6: array scope bag is treated as empty', (function () {
  const r = T.resolveVariable('x', { local: [1, 2], generator: { x: 3 } });
  return r !== null && r.scope === 'generator' && r.value === 3;
})());
checkEq('pb d6: null scopes -> null', T.resolveVariable('x', null), null);
checkEq('pb d6: undefined scopes -> null', T.resolveVariable('x', undefined), null);
checkEq('pb d6: array scopes -> null', T.resolveVariable('x', [{}]), null);
checkEq('pb d6: numeric name -> null (no coercion)', T.resolveVariable(42, { local: { 42: 1 } }), null);
checkEq('pb d6: empty name -> null', T.resolveVariable('', { local: { '': 1 } }), null);
checkEq('pb d6: missing name -> null', T.resolveVariable(undefined, { local: {} }), null);

// ----: occurrence ids
check('pb d2: newOccurrenceId has the occ_ shape', T.newOccurrenceId().match(/^occ_[0-9a-f]{8}$/) !== null);
check('pb d2: newOpId has the op_ shape', T.newOpId().match(/^op_[0-9a-f]{8}$/) !== null);
check('pb d2: newOpOccurrenceId shape, distinct per call (delegates to generators)', (function () {
  const a = T.newOpOccurrenceId();
  const b = T.newOpOccurrenceId();
  return /^occ_[0-9a-f]{8}$/.test(a) && /^occ_[0-9a-f]{8}$/.test(b) && a !== b;
})());

// ----: occurrence rows (engine-dependent; state seeded below)
const pbFile = 'tables/pb-d2-test.json';
const pbSaved = {
  tables: T.state.tables,
  macros: T.state.macros,
  logicOps: T.state.logicOps,
  hadFile: T.state.files.has(pbFile),
  file: T.state.files.get(pbFile),
};
T.state.files.set(pbFile, {
  text: '',
  parsed: { items: [ { id: 'tbl_test1234', name: 'Weapons', entries: [ { name: 'Sword', roll: '1d6' } ] } ] },
  error: null,
});
T.state.tables = [ { file: pbFile, index: 0, name: 'Weapons', entries: [ { name: 'Sword', roll: '1d6' } ] } ];
T.state.macros = [
  { file: 'macros/pb.json', index: 0, name: 'Sharp', label: 'Sharp', formula: '1d6' },
  { file: 'macros/pb.json', index: 1, name: '  SHARP  ', label: 'Alt', formula: '2d6' },
];
T.state.logicOps = [
  { file: 'logic-ops/pb.json', index: 0, id: 'op_test1111', name: 'Sharp', purpose: '',
    script: 'SET x = ROLL ((1-6))', outputTemplate: '%x%', config: {} },
];
function pbSyncItem(template) {
  const item = { id: 'gen_pbtmp', name: 'Tmp', template: template, references: [], operations: [] };
  T.syncGeneratorRefs(item);
  return item;
}
const pbTpl = 'Roll [Weapons] and |Sword| then {Sharp}';
check('pb d2 occ: one row per ref/op/embed span, in template order, engine-resolved', (function () {
  const item = pbSyncItem(pbTpl);
  const r = T.genTemplateOccurrences(item.template, T.state.macros, item.references, item.operations);
  const ids = r.map((o) => o.instanceId);
  return r.length === 3
    && r[0].kind === 'ref' && r[0].token === 'Weapons' && r[0].refId === 'tbl_test1234' && r[0].offset === pbTpl.indexOf('[Weapons]')
    && r[1].kind === 'embed' && r[1].token === 'Sword' && r[1].refId === null && r[1].offset === pbTpl.indexOf('|Sword|')
    && r[2].kind === 'op' && r[2].token === 'Sharp' && r[2].refId === 'op_test1111' && r[2].offset === pbTpl.indexOf('{Sharp}')
    && ids.every((id) => /^occ_[0-9a-f]{8}$/.test(id))
    && new Set(ids).size === 3;
})());
check('pb d2 occ: embed matches a macro case-insensitively, first in file order', (function () {
  const item = pbSyncItem('|Sharp|');
  const r = T.genTemplateOccurrences(item.template, T.state.macros, item.references, item.operations);
  return r.length === 1 && r[0].kind === 'embed' && r[0].token === 'Sharp'
    && r[0].refId === 'Sharp' && r[0].offset === item.template.indexOf('|Sharp|');
})());
check('pb d2 occ: unresolved ref keeps the span with refId null', (function () {
  const item = pbSyncItem('[Nope]');
  const r = T.genTemplateOccurrences(item.template, T.state.macros, item.references, item.operations);
  return r.length === 1 && r[0].kind === 'ref' && r[0].token === 'Nope' && r[0].refId === null
    && r[0].offset === item.template.indexOf('[Nope]');
})());
check('pb d2 occ: unknown operation keeps the span with refId null', (function () {
  const item = pbSyncItem('{Nope}');
  const r = T.genTemplateOccurrences(item.template, T.state.macros, item.references, item.operations);
  return r.length === 1 && r[0].kind === 'op' && r[0].token === 'Nope' && r[0].refId === null
    && r[0].offset === item.template.indexOf('{Nope}');
})());
check('pb d2 occ: plain text, empty, inline-only, and non-string templates -> []', (function () {
  const item = pbSyncItem('plain text');
  return T.genTemplateOccurrences('plain text', T.state.macros, item.references, item.operations).length === 0
    && T.genTemplateOccurrences('', [], [], []).length === 0
    && T.genTemplateOccurrences('((1d6))', [], [], []).length === 0
    && T.genTemplateOccurrences(42, [], [], []).length === 0
    && T.genTemplateOccurrences(null, [], [], []).length === 0;
})());
check('pb d2 occ: no engine -> [] (engine deleted, then restored)', (function () {
  return withNoEngine(() =>
    T.genTemplateOccurrences(pbTpl, T.state.macros, [], []).length === 0
    && syncGeneratorRefsKeepsPrev());
})());
function syncGeneratorRefsKeepsPrev() { return true; }
check('pb d2 sync: no engine keeps the previous refs/ops lists', (function () {
  const item = {
    template: 'Roll [Weapons]',
    references: [ { token: 'Weapons', containerId: 'tbl_old', containerName: 'Weapons' } ],
    operations: [ { token: 'Sharp', operationId: 'op_old', operationName: 'Sharp' } ],
  };
  return withNoEngine(() => {
    T.syncGeneratorRefs(item);
    return item.references.length === 1 && item.references[0].containerId === 'tbl_old'
      && item.operations.length === 1 && item.operations[0].operationId === 'op_old';
  });
})());

// ----: template-change reconciliation (pure)
check('pb d2 rec: unique candidate keeps the old instanceId and binding', (function () {
  const old = [ { instanceId: 'occ_11111111', kind: 'ref', token: 'A', refId: 'c1', offset: 0 } ];
  const fresh = [ { kind: 'ref', token: 'A', refId: 'c1', offset: 99 } ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, { occ_11111111: 'varA' });
  return r.occurrences.length === 1
    && r.occurrences[0].instanceId === 'occ_11111111'
    && r.occurrences[0].offset === 99
    && r.bindings.occ_11111111 === 'varA'
    && r.unresolvedBindings.length === 0;
})());
check('pb d2 rec: deleted occurrence -> occurrence-deleted, binding dropped', (function () {
  const old = [ { instanceId: 'occ_22222222', kind: 'ref', token: 'A', refId: 'c1', offset: 0 } ];
  const r = T.reconcileGeneratorOccurrences(old, [], { occ_22222222: 'varA' });
  return r.occurrences.length === 0
    && Object.keys(r.bindings).length === 0
    && r.unresolvedBindings.length === 1
    && r.unresolvedBindings[0].varName === 'varA'
    && r.unresolvedBindings[0].reason === 'occurrence-deleted';
})());
check('pb d2 rec: deleted occurrence without a binding leaves no unresolved entry', (function () {
  const old = [ { instanceId: 'occ_22222223', kind: 'ref', token: 'A', refId: 'c1', offset: 0 } ];
  const r = T.reconcileGeneratorOccurrences(old, [], {});
  return r.unresolvedBindings.length === 0 && Object.keys(r.bindings).length === 0;
})());
check('pb d2 rec: multiple candidates, offset tie-break keeps the matching row', (function () {
  const old = [ { instanceId: 'occ_33333333', kind: 'ref', token: 'A', refId: 'c1', offset: 10 } ];
  const fresh = [
    { kind: 'ref', token: 'A', refId: 'c1', offset: 5 },
    { kind: 'ref', token: 'A', refId: 'c1', offset: 10 },
  ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, { occ_33333333: 'varA' });
  return r.occurrences.length === 2
    && r.occurrences[1].instanceId === 'occ_33333333'
    && r.occurrences[0].instanceId !== 'occ_33333333' && /^occ_[0-9a-f]{8}$/.test(r.occurrences[0].instanceId)
    && r.bindings.occ_33333333 === 'varA'
    && Object.keys(r.bindings).length === 1
    && r.unresolvedBindings.length === 0;
})());
check('pb d2 rec: multiple candidates, no shared offset -> occurrence-ambiguous', (function () {
  const old = [ { instanceId: 'occ_44444444', kind: 'ref', token: 'A', refId: 'c1', offset: 10 } ];
  const fresh = [
    { kind: 'ref', token: 'A', refId: 'c1', offset: 5 },
    { kind: 'ref', token: 'A', refId: 'c1', offset: 15 },
  ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, { occ_44444444: 'varA' });
  return r.occurrences.length === 2
    && r.occurrences.every((o) => o.instanceId !== 'occ_44444444' && /^occ_[0-9a-f]{8}$/.test(o.instanceId))
    && Object.keys(r.bindings).length === 0
    && r.unresolvedBindings.length === 1
    && r.unresolvedBindings[0].varName === 'varA'
    && r.unresolvedBindings[0].reason === 'occurrence-ambiguous';
})());
check('pb d2 rec: ambiguous old row without a binding leaves no unresolved entry', (function () {
  const old = [ { instanceId: 'occ_44444445', kind: 'ref', token: 'A', refId: 'c1', offset: 10 } ];
  const fresh = [
    { kind: 'ref', token: 'A', refId: 'c1', offset: 5 },
    { kind: 'ref', token: 'A', refId: 'c1', offset: 15 },
  ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, {});
  return r.unresolvedBindings.length === 0 && Object.keys(r.bindings).length === 0;
})());
check('pb d2 rec: fresh-only rows get new ids, no bindings, in fresh (template) order', (function () {
  const fresh = [
    { kind: 'ref', token: 'B', refId: null, offset: 1 },
    { kind: 'embed', token: 'M', refId: 'M', offset: 2 },
  ];
  const r = T.reconcileGeneratorOccurrences([], fresh, {});
  return r.occurrences.length === 2
    && r.occurrences[0].token === 'B' && r.occurrences[1].token === 'M'
    && /^occ_[0-9a-f]{8}$/.test(r.occurrences[0].instanceId)
    && /^occ_[0-9a-f]{8}$/.test(r.occurrences[1].instanceId)
    && Object.keys(r.bindings).length === 0
    && r.unresolvedBindings.length === 0;
})());
check('pb d2 rec: first old row wins a contested candidate (no double mapping)', (function () {
  const old = [
    { instanceId: 'occ_55555555', kind: 'ref', token: 'A', refId: 'c1', offset: 0 },
    { instanceId: 'occ_66666666', kind: 'ref', token: 'A', refId: 'c1', offset: 1 },
  ];
  const fresh = [ { kind: 'ref', token: 'A', refId: 'c1', offset: 7 } ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, { occ_55555555: 'alpha', occ_66666666: 'beta' });
  return r.occurrences.length === 1
    && r.occurrences[0].instanceId === 'occ_55555555'
    && r.bindings.occ_55555555 === 'alpha'
    && Object.keys(r.bindings).length === 1
    && r.unresolvedBindings.length === 1
    && r.unresolvedBindings[0].varName === 'beta'
    && r.unresolvedBindings[0].reason === 'occurrence-deleted';
})());
check('pb d2 rec: result order is the fresh (template) order', (function () {
  const old = [ { instanceId: 'occ_77777777', kind: 'ref', token: 'A', refId: 'c1', offset: 1 } ];
  const fresh = [
    { kind: 'ref', token: 'A', refId: 'c1', offset: 1 },
    { kind: 'embed', token: 'M', refId: 'M', offset: 2 },
    { kind: 'ref', token: 'A', refId: 'c1', offset: 3 },
  ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, { occ_77777777: 'vA' });
  return r.occurrences.length === 3
    && r.occurrences[0].token === 'A' && r.occurrences[0].instanceId === 'occ_77777777'
    && r.occurrences[1].token === 'M'
    && r.occurrences[2].token === 'A' && r.occurrences[2].instanceId !== 'occ_77777777'
    && r.bindings.occ_77777777 === 'vA'
    && Object.keys(r.bindings).length === 1
    && r.unresolvedBindings.length === 0;
})());
check('pb d2 rec: unresolved bindings deduped by varName (first reason wins)', (function () {
  const old = [
    { instanceId: 'occ_88888888', kind: 'ref', token: 'A', refId: 'c1', offset: 0 },
    { instanceId: 'occ_99999999', kind: 'ref', token: 'B', refId: 'c2', offset: 1 },
  ];
  const fresh = [
    { kind: 'ref', token: 'A', refId: 'c1', offset: 5 },
    { kind: 'ref', token: 'A', refId: 'c1', offset: 6 },
  ];
  const r = T.reconcileGeneratorOccurrences(old, fresh, { occ_88888888: 'vA', occ_99999999: 'vA' });
  return r.unresolvedBindings.length === 1
    && r.unresolvedBindings[0].varName === 'vA'
    && r.unresolvedBindings[0].reason === 'occurrence-ambiguous';
})());
check('pb d2 rec: inputs are not mutated', (function () {
  const old = [ { instanceId: 'occ_aaaaaaaa', kind: 'ref', token: 'A', refId: 'c1', offset: 0 } ];
  const fresh = [ { kind: 'ref', token: 'A', refId: 'c1', offset: 0 } ];
  const oldBindings = { occ_aaaaaaaa: 'vA' };
  const before = JSON.stringify({ old: old, fresh: fresh, oldBindings: oldBindings });
  const r = T.reconcileGeneratorOccurrences(old, fresh, oldBindings);
  return JSON.stringify({ old: old, fresh: fresh, oldBindings: oldBindings }) === before
    && r.occurrences[0].instanceId === 'occ_aaaaaaaa';
})());

// ----: normalizeGeneratorItem (in place)
check('pb d2 norm: runs in place (same object identity)', (function () {
  const item = { id: 'gen_x', name: 'X', template: '', references: [], operations: [] };
  const r = T.normalizeGeneratorItem(item, { macros: [] });
  return r === item;
})());
check('pb d2 norm: bare item normalized to default mode with ensured fields', (function () {
  const item = { id: 'gen_p4', name: 'P4', template: '', references: [], operations: [] };
  T.normalizeGeneratorItem(item, { macros: [] });
  return !('version' in item) && item.mode === 'basic'
    && Array.isArray(item.occurrences) && item.occurrences.length === 0
    && typeof item.bindings === 'object' && item.bindings !== null && Object.keys(item.bindings).length === 0
    && Array.isArray(item.unresolvedBindings) && item.unresolvedBindings.length === 0;
})());
check('pb d2 norm: invalid mode repaired to basic; basic/advanced kept', (function () {
  const a = { id: 'g1', template: '', mode: 'wild' };
  const b = { id: 'g2', template: '', mode: 'advanced' };
  const c = { id: 'g3', template: '', mode: 'basic' };
  T.normalizeGeneratorItem(a, { macros: [] });
  T.normalizeGeneratorItem(b, { macros: [] });
  T.normalizeGeneratorItem(c, { macros: [] });
  return a.mode === 'basic' && b.mode === 'advanced' && c.mode === 'basic';
})());
check('pb d2 norm: non-object item returned as-is', (function () {
  return T.normalizeGeneratorItem(null, { macros: [] }) === null
    && T.normalizeGeneratorItem('nope', { macros: [] }) === 'nope'
    && T.normalizeGeneratorItem(42, { macros: [] }) === 42;
})());
check('pb d2 norm: empty template leaves existing occurrences/bindings untouched', (function () {
  const item = {
    id: 'gen_p2', name: 'P2', template: '', references: [], operations: [],
    occurrences: [ { instanceId: 'occ_bbbbbbbb', kind: 'ref', token: 'X', refId: null, offset: 0 } ],
    bindings: { occ_bbbbbbbb: 'vX' },
    unresolvedBindings: [],
  };
  T.normalizeGeneratorItem(item, { macros: [] });
  return !('version' in item) && item.mode === 'basic'
    && item.occurrences.length === 1 && item.occurrences[0].instanceId === 'occ_bbbbbbbb'
    && item.bindings.occ_bbbbbbbb === 'vX';
})());
check('pb d2 norm: no engine -> fields ensured, occurrences untouched (engine deleted, then restored)', (function () {
  const item = {
    id: 'gen_p3', name: 'P3', template: pbTpl, references: [], operations: [],
    occurrences: [ { instanceId: 'occ_cccccccc', kind: 'ref', token: 'Weapons', refId: 'tbl_test1234', offset: 5 } ],
  };
  return withNoEngine(() => {
    T.normalizeGeneratorItem(item, { macros: [] });
    return !('version' in item) && item.mode === 'basic'
      && item.occurrences.length === 1 && item.occurrences[0].instanceId === 'occ_cccccccc'
      && typeof item.bindings === 'object' && item.bindings !== null && Object.keys(item.bindings).length === 0
      && Array.isArray(item.unresolvedBindings) && item.unresolvedBindings.length === 0;
  });
})());
check('pb d2 norm: template + engine -> occurrences derived, bindings survive an unchanged template', (function () {
  const item1 = { id: 'gen_p1', name: 'P1', template: pbTpl, references: [], operations: [] };
  T.normalizeGeneratorItem(item1, { macros: T.state.macros });
  const idRef = item1.occurrences[0].instanceId;
  const idEmbed = item1.occurrences[1].instanceId;
  const idOp = item1.occurrences[2].instanceId;
  item1.bindings[idRef] = 'weaponVar';
  item1.bindings[idOp] = 'sharpVar';
  T.normalizeGeneratorItem(item1, { macros: T.state.macros });
  sandbox.__pbItem1 = item1;
  sandbox.__pbIdRef = idRef;
  return item1 === sandbox.__pbItem1
    && !('version' in item1) && item1.mode === 'basic'
    && item1.occurrences.length === 3
    && item1.occurrences[0].instanceId === idRef
    && item1.occurrences[1].instanceId === idEmbed
    && item1.occurrences[2].instanceId === idOp
    && item1.bindings[idRef] === 'weaponVar'
    && item1.bindings[idOp] === 'sharpVar'
    && Object.keys(item1.bindings).length === 2
    && item1.unresolvedBindings.length === 0;
})());
check('pb d2 norm: template change -> deleted occurrence binding becomes occurrence-deleted', (function () {
  const item1 = sandbox.__pbItem1;
  const idRef = sandbox.__pbIdRef;
  item1.template = 'Roll [Weapons] only';
  T.normalizeGeneratorItem(item1, { macros: T.state.macros });
  return item1.occurrences.length === 1
    && item1.occurrences[0].instanceId === idRef
    && item1.bindings[idRef] === 'weaponVar'
    && Object.keys(item1.bindings).length === 1
    && item1.unresolvedBindings.length === 1
    && item1.unresolvedBindings[0].varName === 'sharpVar'
    && item1.unresolvedBindings[0].reason === 'occurrence-deleted';
})());

// ----: operation model (pure)
checkEq('pb: bundle kind constant', T.LOGIC_OPS_BUNDLE_KIND, 'ttrpg-logic-ops');
check('pb: newOpId shape, distinct per call', (function () {
  const a = T.newOpId();
  const b = T.newOpId();
  return /^op_[0-9a-f]{8}$/.test(a) && /^op_[0-9a-f]{8}$/.test(b) && a !== b;
})());
check('pb: normalizeOpVarName trims and keeps internal spaces', (function () {
  return T.normalizeOpVarName('  base damage  ') === 'base damage'
    && T.normalizeOpVarName('a b') === 'a b';
})());
check('pb: normalizeOpVarName rejects empty, %-bearing, and non-name characters', (function () {
  return T.normalizeOpVarName('') === null
    && T.normalizeOpVarName('   ') === null
    && T.normalizeOpVarName('%') === null
    && T.normalizeOpVarName('a%b') === null
    && T.normalizeOpVarName('a-b') === null
    && T.normalizeOpVarName('a.b') === null
    && T.normalizeOpVarName('a/b') === null;
})());
check('pb: normalizeOpVarName rejects non-strings (no String coercion)', (function () {
  return T.normalizeOpVarName(null) === null
    && T.normalizeOpVarName(undefined) === null
    && T.normalizeOpVarName(12) === null
    && T.normalizeOpVarName(true) === null
    && T.normalizeOpVarName({}) === null;
})());
check('pb: normalizeOpVarName NFC-folds composed names', T.normalizeOpVarName('e\u0301x'), '\u00e9x');
check('pb: keyword spellings are NOT rejected here (reservation is the parser business)', (function () {
  return ['IF', 'ELSE', 'OUTPUT', 'SET'].every((k) => T.normalizeOpVarName(k) === k);
})());
check('pb: scriptStatementsOf IMPORT statements, 1-based lines', (function () {
  const r = T.scriptStatementsOf('IMPORT %weapon%\n\nIMPORT %base_damage%\nEXPOSE rarity', 'import');
  return r.length === 2
    && r[0].name === 'weapon' && r[0].line === 1
    && r[1].name === 'base_damage' && r[1].line === 3;
})());
check('pb: scriptStatementsOf EXPOSE statements', (function () {
  const r = T.scriptStatementsOf('EXPOSE rarity\nEXPOSE base_damage', 'expose');
  return r.length === 2
    && r[0].name === 'rarity' && r[0].line === 1
    && r[1].name === 'base_damage' && r[1].line === 2;
})());
check('pb: parse error (or no statements of the type) -> []', (function () {
  return T.scriptStatementsOf('IMPORT', 'import').length === 0
    && T.scriptStatementsOf('IMPORT %%', 'import').length === 0
    && T.scriptStatementsOf('SET x = 1', 'import').length === 0;
})());
checkEq('pb: scriptStatementsOf non-string script -> []', T.scriptStatementsOf(null, 'import').length, 0);
check('pb: computeOpOccurrences rows: no kind field, null refId, 1-based offsets', (function () {
  const r = T.computeOpOccurrences('IMPORT %weapon%\nIMPORT %base_damage%');
  return r.length === 2
    && /^occ_[0-9a-f]{8}$/.test(r[0].instanceId)
    && r[0].token === 'weapon' && r[0].refId === null && r[0].offset === 1
    && r[1].token === 'base_damage' && r[1].refId === null && r[1].offset === 2
    && !('kind' in r[0]) && !('kind' in r[1]);
})());
check('pb: blank lines shift the 1-based offsets', (function () {
  const r = T.computeOpOccurrences('IMPORT %a%\n\n\nIMPORT %b%');
  return r.length === 2 && r[0].offset === 1 && r[1].offset === 4;
})());
checkEq('pb: EXPOSE statements are not occurrences', T.computeOpOccurrences('EXPOSE a\nEXPOSE b').length, 0);
check('pb: deriveScriptImports names, deduped after normalization, first-appearance order', (function () {
 // Case is preserved, so %a% and % A % are distinct names; the repeated %a% dedupes.
  return deepEq(T.deriveScriptImports('IMPORT %a%\nIMPORT % A %\nIMPORT %b%\nIMPORT %a%\nIMPORT % c %'), ['a', 'A', 'b', 'c']);
})());
check('pb: deriveScriptImports NFC-folds composed spellings into one name', (function () {
 // a single decomposed spelling folds to its NFC form in the derived list
  // a script holding two raw spellings of the same NFC name is a parse-level
  // name-collision (reported, never silently merged), so it yields no imports.
  return deepEq(T.deriveScriptImports('IMPORT %e\u0301x%'), ['\u00e9x'])
    && deepEq(T.deriveScriptImports('IMPORT %\u00e9x%\nIMPORT %e\u0301x%'), []);
})());
checkEq('pb: deriveScriptImports EXPOSE statements are not imports', T.deriveScriptImports('EXPOSE a\nEXPOSE b').length, 0);
checkEq('pb: deriveScriptImports empty script -> []', T.deriveScriptImports('').length, 0);
checkEq('pb: deriveScriptImports non-string script -> []', T.deriveScriptImports(null).length, 0);
checkEq('pb: deriveScriptImports parse error -> []', T.deriveScriptImports('IMPORT %%').length, 0);
check('pb: deriveScriptExposed names, deduped after normalization, first-appearance order', (function () {
  return deepEq(T.deriveScriptExposed('EXPOSE a\nEXPOSE % b %\nEXPOSE c\nEXPOSE %b%'), ['a', 'b', 'c']);
})());
checkEq('pb: deriveScriptExposed IMPORT statements are not exposed', T.deriveScriptExposed('IMPORT %a%').length, 0);
checkEq('pb: deriveScriptExposed empty / non-string script -> []', T.deriveScriptExposed('').length + T.deriveScriptExposed(null).length, 0);
checkEq('pb: deriveScriptExposed parse error -> []', T.deriveScriptExposed('EXPOSE').length, 0);
check('pb: createLogicOperation happy path (defaults + derived fields)', (function () {
  const r = T.createLogicOperation({ name: 'Test', script: 'IMPORT %a%\nEXPOSE out', outputTemplate: '%a% + %out%' });
  const op = r.op;
  return r.ok === true && r.errors.length === 0
    && !('version' in op)
    && /^op_[0-9a-f]{8}$/.test(op.id)
    && op.name === 'Test' && op.purpose === ''
    && op.script === 'IMPORT %a%\nEXPOSE out'
    && op.outputTemplate === '%a% + %out%'
    && deepEq(op.imports, ['a'])
    && deepEq(op.exposed, ['out'])
    && deepEq(op.bindings, {})
    && op.occurrences.length === 1
    && op.occurrences[0].token === 'a' && op.occurrences[0].refId === null && op.occurrences[0].offset === 1;
})());
check('pb: createLogicOperation keeps a provided id and a provided exposed array', (function () {
  const r = T.createLogicOperation({ id: 'op_zzzz1111', name: 'T', script: 'EXPOSE a', outputTemplate: '', exposed: ['x', 'y'] });
  return r.ok === true && r.op.id === 'op_zzzz1111'
    && r.op.exposed.length === 2 && r.op.exposed[0] === 'x' && r.op.exposed[1] === 'y';
})());
check('pb: createLogicOperation missing name -> missing-name error, empty name kept', (function () {
  const r = T.createLogicOperation({ script: '', outputTemplate: '' });
  return r.ok === false && r.op.name === ''
    && r.errors.some((e) => e.kind === 'missing-name' && e.message === 'Name is required.');
})());
check('pb: createLogicOperation non-string script/outputTemplate/purpose -> invalid-type, defaults kept', (function () {
  const r = T.createLogicOperation({ name: 'T', script: 42, outputTemplate: null, purpose: 7 });
  return r.ok === false
    && r.op.script === '' && r.op.outputTemplate === '' && r.op.purpose === ''
    && r.errors.filter((e) => e.kind === 'invalid-type').length === 3;
})());
check('pb: createLogicOperation exposed given as a non-array -> error + derived fallback', (function () {
  const r = T.createLogicOperation({ name: 'T', script: 'EXPOSE a', exposed: 'nope' });
  return r.ok === false && r.errors.some((e) => e.kind === 'invalid-type')
    && r.op.exposed.length === 1 && r.op.exposed[0] === 'a';
})());
check('pb: createLogicOperation imports deduped after normalization; occurrences keep every line', (function () {
  const r = T.createLogicOperation({ name: 'T', script: 'IMPORT %a%\nIMPORT % A %\nIMPORT %a%', outputTemplate: '' });
  const op = r.op;
 // Case is preserved: imports are ['a', 'A'] (repeated %a% deduped)
  // occurrences keep every line with its normalized token.
  return r.ok === true
    && op.imports.length === 2 && deepEq(op.imports, ['a', 'A'])
    && op.occurrences.length === 3
    && op.occurrences[0].token === 'a' && op.occurrences[1].token === 'A' && op.occurrences[2].token === 'a'
    && op.occurrences[0].offset === 1 && op.occurrences[1].offset === 2 && op.occurrences[2].offset === 3;
})());
check('pb: createLogicOperation non-object fields -> {} defaults', (function () {
  const r = T.createLogicOperation(null);
  return r.ok === false && r.op.name === '' && /^op_[0-9a-f]{8}$/.test(r.op.id);
})());
function pbHasErr(list, kind, msg) {
  return list.some((e) => e && e.kind === kind && (msg === undefined || e.message === msg));
}
function pbCleanOp() {
  return {
    id: 'op_x', name: 'T', script: '', outputTemplate: '',
    imports: [], exposed: [], occurrences: [], bindings: {},
  };
}
check('pb: validateLogicOperation clean op (with real occurrence + binding) -> []', (function () {
  const op = pbCleanOp();
  op.occurrences = [ { instanceId: 'occ_abc12345', token: 'a', refId: null, offset: 1 } ];
  op.bindings = { occ_abc12345: 'varA' };
  return T.validateLogicOperation(op).length === 0;
})());
check('pb: validateLogicOperation op produced by createLogicOperation -> []', (function () {
  const r = T.createLogicOperation({ name: 'T', script: 'IMPORT %a%', outputTemplate: '%a%' });
  return T.validateLogicOperation(r.op).length === 0;
})());
check('pb: validateLogicOperation non-object ops -> single invalid-type', (function () {
  const e1 = T.validateLogicOperation(null);
  const e2 = T.validateLogicOperation('nope');
  const e3 = T.validateLogicOperation([]);
  return e1.length === 1 && pbHasErr(e1, 'invalid-type', 'operation must be a plain object.')
    && e2.length === 1 && pbHasErr(e2, 'invalid-type')
    && e3.length === 1 && pbHasErr(e3, 'invalid-type');
})());
check('pb: validateLogicOperation reports every missing field', (function () {
  const e = T.validateLogicOperation({ name: 'T' });
  return pbHasErr(e, 'missing-field', 'id is required.')
    && pbHasErr(e, 'missing-field', 'code is required.')
    && pbHasErr(e, 'missing-field', 'outputTemplate is required.')
    && pbHasErr(e, 'missing-field', 'imports is required.')
    && pbHasErr(e, 'missing-field', 'exposed is required.')
    && pbHasErr(e, 'missing-field', 'occurrences is required.')
    && pbHasErr(e, 'missing-field', 'bindings is required.');
})());
check('pb: validateLogicOperation bad id / name', (function () {
  const mk = (over) => Object.assign(pbCleanOp(), over);
  return pbHasErr(T.validateLogicOperation(mk({ id: '' })), 'invalid-type', 'id must be a non-empty string.')
    && pbHasErr(T.validateLogicOperation(mk({ name: '   ' })), 'invalid-type', 'name must be a non-empty (after trim) string.');
})());
check('pb: validateLogicOperation purpose / script / outputTemplate type errors', (function () {
  const mk = (over) => Object.assign(pbCleanOp(), over);
  return pbHasErr(T.validateLogicOperation(mk({ purpose: 7 })), 'invalid-type', 'purpose must be a string.')
    && pbHasErr(T.validateLogicOperation(mk({ script: 7 })), 'invalid-type', 'code must be a string.')
    && pbHasErr(T.validateLogicOperation(mk({ outputTemplate: 7 })), 'invalid-type', 'outputTemplate must be a string.');
})());
check('pb: validateLogicOperation imports/exposed array rules (duplicate, bad name, spaced names distinct)', (function () {
  const mk = (over) => Object.assign(pbCleanOp(), over);
  return pbHasErr(T.validateLogicOperation(mk({ imports: 'nope' })), 'invalid-type', 'imports must be an array of names.')
    && pbHasErr(T.validateLogicOperation(mk({ exposed: 3 })), 'invalid-type', 'exposed must be an array of names.')
    && pbHasErr(T.validateLogicOperation(mk({ imports: ['weapon', ' weapon '] })), 'duplicate-name', 'imports contains a duplicate name: "weapon".')
    && pbHasErr(T.validateLogicOperation(mk({ imports: ['a-b'] })), 'bad-name')
    && T.validateLogicOperation(mk({ imports: ['a b', 'a  b'] })).length === 0;
})());
check('pb: validateLogicOperation occurrence row rules', (function () {
  const mk = (over) => Object.assign(pbCleanOp(), over);
  const good = { instanceId: 'occ_00000001', token: 'a', refId: null, offset: 1 };
  return T.validateLogicOperation(mk({ occurrences: [good] })).length === 0
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: 'nope' })), 'invalid-type', 'occurrences must be an array.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [null] })), 'invalid-type', 'each occurrence must be a plain object.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [{ instanceId: '', token: 'a', refId: null, offset: 1 }] })), 'invalid-type', 'occurrence instanceId must be a non-empty string.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [{ instanceId: 'occ_00000001', token: 7, refId: null, offset: 1 }] })), 'invalid-type', 'occurrence token must be a string.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [{ instanceId: 'occ_00000001', token: 'a', refId: 7, offset: 1 }] })), 'invalid-type', 'occurrence refId must be null or a string.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [{ instanceId: 'occ_00000001', token: 'a', refId: null, offset: 0 }] })), 'invalid-type', 'occurrence offset must be an integer >= 1.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [{ instanceId: 'occ_00000001', token: 'a', refId: null, offset: 1.5 }] })), 'invalid-type', 'occurrence offset must be an integer >= 1.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [good, Object.assign({}, good)] })), 'duplicate-instance', 'duplicate occurrence instanceId: "occ_00000001".');
})());
check('pb: validateLogicOperation binding rules (type, unknown instance)', (function () {
  const mk = (over) => Object.assign(pbCleanOp(), over);
  const good = { instanceId: 'occ_00000001', token: 'a', refId: null, offset: 1 };
  return T.validateLogicOperation(mk({ occurrences: [good], bindings: { occ_00000001: 'varA' } })).length === 0
    && pbHasErr(T.validateLogicOperation(mk({ bindings: 'nope' })), 'invalid-type', 'bindings must be an object of instanceId -> name.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [good], bindings: { occ_00000001: 7 } })), 'invalid-type', 'binding "occ_00000001" must map to a name string.')
    && pbHasErr(T.validateLogicOperation(mk({ occurrences: [good], bindings: { occ_unknown: 'v' } })), 'unknown-binding-instance', 'binding references unknown instanceId "occ_unknown".');
})());
check('pb: validateLogicOperation unknown field flagged (known set is the 9 fields)', (function () {
  const op = Object.assign(pbCleanOp(), { extra: 1 });
  const e = T.validateLogicOperation(op);
  return e.length === 1 && pbHasErr(e, 'unknown-field', 'unknown field "extra".');
})());
check('pb: validateLogicOpsBundle valid bundle passes', (function () {
  const op = T.createLogicOperation({ name: 'T', script: 'IMPORT %a%', outputTemplate: '%a%' }).op;
  const r = T.validateLogicOpsBundle({ kind: T.LOGIC_OPS_BUNDLE_KIND, operations: [op] });
  return r.ok === true && r.errors.length === 0 && r.operations.length === 1 && r.operations[0] === op;
})());
check('pb: unknown kind rejected', (function () {
  const r = T.validateLogicOpsBundle({ kind: 'other', operations: [] });
  return r.ok === false && pbHasErr(r.errors, 'unknown-kind', 'kind must be "ttrpg-logic-ops".');
})());
check('pb: non-object bundles -> single invalid-type', (function () {
  const e1 = T.validateLogicOpsBundle(null);
  const e2 = T.validateLogicOpsBundle([]);
  const e3 = T.validateLogicOpsBundle('nope');
  return e1.ok === false && e1.operations.length === 0 && pbHasErr(e1.errors, 'invalid-type', 'bundle must be a plain object.')
    && e2.ok === false && e2.errors.length === 1
    && e3.ok === false && e3.errors.length === 1;
})());
check('pb: missing / non-array operations rejected', (function () {
  const e1 = T.validateLogicOpsBundle({ kind: 'ttrpg-logic-ops' });
  const e2 = T.validateLogicOpsBundle({ kind: 'ttrpg-logic-ops', operations: 'nope' });
  return e1.ok === false && pbHasErr(e1.errors, 'invalid-type', 'operations must be an array.')
    && e2.ok === false && pbHasErr(e2.errors, 'invalid-type', 'operations must be an array.');
})());
check('pb: per-op errors prefixed operations[i]:', (function () {
  const bad = Object.assign(pbCleanOp(), { name: '' });
  const r = T.validateLogicOpsBundle({ kind: 'ttrpg-logic-ops', operations: [bad] });
  return r.ok === false
    && r.errors.length > 0
    && r.errors.every((e) => e.message.indexOf('operations[0]: ') === 0)
    && pbHasErr(r.errors, 'invalid-type', 'operations[0]: name must be a non-empty (after trim) string.');
})());
check('pb: unknown top-level bundle field rejected', (function () {
  const r = T.validateLogicOpsBundle({ kind: 'ttrpg-logic-ops', operations: [], extra: 1 });
  return r.ok === false && pbHasErr(r.errors, 'unknown-field', 'unknown field "extra".');
})());
check('pb: a bundle carrying an extra header field (e.g. version) is rejected', (function () {
  const r = T.validateLogicOpsBundle({ kind: 'ttrpg-logic-ops', version: 1, operations: [] });
  return r.ok === false && r.errors.length === 1
    && pbHasErr(r.errors, 'unknown-field', 'unknown field "version".');
})());
check('pb: bundle accumulates kind + top-level + per-op errors', (function () {
  const bad = Object.assign(pbCleanOp(), { name: '' });
  const r = T.validateLogicOpsBundle({ kind: 'x', operations: [bad], note: 'n' });
  return r.ok === false
    && pbHasErr(r.errors, 'unknown-kind')
    && pbHasErr(r.errors, 'unknown-field', 'unknown field "note".')
    && pbHasErr(r.errors, 'invalid-type', 'operations[0]: name must be a non-empty (after trim) string.');
})());

// ----: output-template substitution (pure)
check('pb d4: typed substitution (string as-is, number stringified)', (function () {
  const r = T.substituteOutputTemplate('%a% and %n%', { a: 'two', n: 42 });
  return r.ok === true && r.text === 'two and 42';
})());
check('pb d4: numbers stringified exactly (0, negative, fractional)', (function () {
  return T.substituteOutputTemplate('%n%', { n: 0 }).text === '0'
    && T.substituteOutputTemplate('%n%', { n: -3.5 }).text === '-3.5'
    && T.substituteOutputTemplate('%n%', { n: 100 }).text === '100';
})());
checkEq('pb d4: numeric-string value converts via the typed value', T.substituteOutputTemplate('%n%', { n: '12' }).text, '12');
checkEq('pb d4: " 12 " (spaced) stays a string value', T.substituteOutputTemplate('%n%', { n: ' 12 ' }).text, ' 12 ');
checkEq('pb d4: repeated refs reuse the same value', T.substituteOutputTemplate('%a%-%a%', { a: 5 }).text, '5-5');
check('pb d4: "% x %" normalizes to the name x', (function () {
  const r = T.substituteOutputTemplate('  % x %  ', { x: 5 });
  return r.ok === true && r.text === '  5  ';
})());
check('pb d4: non-name spans stay fully literal (never parsed as embeds)', (function () {
  return T.substituteOutputTemplate('%a-b% and % x%', { x: 'y' }).text === '%a-b% and y'
    && T.substituteOutputTemplate('% [A] %', {}).text === '% [A] %'
    && T.substituteOutputTemplate('%  %', {}).text === '%  %';
})());
check('pb d4: "%%" and lone "%" are literal', (function () {
  return T.substituteOutputTemplate('a%%b', {}).text === 'a%%b'
    && T.substituteOutputTemplate('100% off', {}).text === '100% off'
    && T.substituteOutputTemplate('%a', { a: 1 }).text === '%a';
})());
check('pb d4: present-but-not-typed values count as missing (null/undefined/NaN/Infinity/object)', (function () {
  const r1 = T.substituteOutputTemplate('%b%', { b: null });
  const r2 = T.substituteOutputTemplate('%b%', { b: undefined });
  const r3 = T.substituteOutputTemplate('%n%', { n: NaN });
  const r4 = T.substituteOutputTemplate('%i%', { i: Infinity });
  const r5 = T.substituteOutputTemplate('%o%', { o: {} });
  return [r1, r2, r3, r4, r5].every((r) =>
    r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'missing-variable');
})());
check('pb d4: boolean true is a typed value and renders as the text "true"', (function () {
  const r = T.substituteOutputTemplate('%b%', { b: true });
  return r.ok === true && r.text === 'true';
})());
check('pb d4: boolean false is a typed value and renders as the text "false"', (function () {
  const r = T.substituteOutputTemplate('%b%', { b: false });
  return r.ok === true && r.text === 'false';
})());
check('pb d4: absent key is missing-variable', (function () {
  const r = T.substituteOutputTemplate('%a%', {});
  return r.ok === false && r.errors.length === 1
    && r.errors[0].kind === 'missing-variable' && r.errors[0].varName === 'a';
})());
check('pb d4: ALL distinct missing vars, first-appearance order, deduped', (function () {
  const r = T.substituteOutputTemplate('%b% %a% %b%', { c: 1 });
  return r.ok === false && r.errors.length === 2
    && r.errors[0].kind === 'missing-variable' && r.errors[0].varName === 'b'
    && r.errors[1].kind === 'missing-variable' && r.errors[1].varName === 'a';
})());
checkEq('pb d4: outside-span text preserved byte-for-byte', T.substituteOutputTemplate('A %x% B', { x: 1 }).text, 'A 1 B');
check('pb d4: lookup is by NFC name (NFC key matches)', (function () {
  const r = T.substituteOutputTemplate('%e\u0301x%', { '\u00e9x': 5 });
  return r.ok === true && r.text === '5';
})());
check('pb d4: lookup is by NFC name (NFD key does NOT match)', (function () {
  const r = T.substituteOutputTemplate('%e\u0301x%', { 'e\u0301x': 5 });
  return r.ok === false && r.errors.length === 1 && r.errors[0].varName === '\u00e9x';
})());
check('pb d4: non-string template -> empty text; non-object values -> empty bag', (function () {
  const r1 = T.substituteOutputTemplate(42, { a: 1 });
  const r2 = T.substituteOutputTemplate(null, { a: 1 });
  const r3 = T.substituteOutputTemplate('%a%', null);
  const r4 = T.substituteOutputTemplate('%a%', [1]);
  return r1.ok === true && r1.text === ''
    && r2.ok === true && r2.text === ''
    && r3.ok === false && r3.errors.length === 1
    && r4.ok === false && r4.errors.length === 1;
})());

// Restore the state seeded above.
T.state.tables = pbSaved.tables;
T.state.macros = pbSaved.macros;
T.state.logicOps = pbSaved.logicOps;
if (pbSaved.hadFile) { T.state.files.set(pbFile, pbSaved.file); } else { T.state.files.delete(pbFile); }

// ------------------------------------------------ evaluator
// js/logic-evaluator.js — executes the js/logic-language.js AST:
// SET/ROLL/IMPORT/EXPOSE, IF/THEN/ELSE IF/ELSE (both forms), SWITCH/CASE/
// DEFAULT, AND/OR/comparisons with parens.
// Everything here is a pure-function check (no DOM, no UI, no app.js change):
// the module is reached through the engine's executeOperation contract.
const LE = T.LogicEvaluator;
const GLIMITS = T.GENERATOR_LIMITS;

check('p3: js/logic-evaluator.js loaded and exported on the shared global',
  !!LE && typeof LE.evaluate === 'function' && !!LE.EVAL_ERR);
check('p3: the evaluator carries no limit literal of its own (one source of truth)',
  (function () {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'logic-evaluator.js'), 'utf8');
    return !/MAX_DEPTH\s*[:=]/.test(src) && !/MAX_RESOLUTIONS\s*[:=]/.test(src) &&
      !/MAX_OUTPUT_CHARS\s*[:=]/.test(src) && !/MAX_NESTED_OPERATION_DEPTH\s*[:=]/.test(src) &&
      /state\.limits\.MAX_DEPTH/.test(src) &&
      /state\.limits\.MAX_RESOLUTIONS/.test(src) &&
      /state\.limits\.MAX_OUTPUT_CHARS/.test(src) &&
      /engine\.LIMITS/.test(src);
  })());
check('p3: GeneratorEngine.LIMITS exports the magnitudes as named constants',
  !!GLIMITS && GLIMITS.MAX_DEPTH === 8 && GLIMITS.MAX_RESOLUTIONS === 1000 &&
  GLIMITS.MAX_OUTPUT_CHARS === 100000 && GLIMITS.MAX_NESTED_OPERATION_DEPTH === 4);
check('p3: the engine defines its limits once and aliases them (no raw literals left)',
  (function () {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'generator-engine.js'), 'utf8');
    return /MAX_DEPTH:\s*8,/.test(src) && /MAX_RESOLUTIONS:\s*1000,/.test(src) &&
      /MAX_OUTPUT_CHARS:\s*100000,/.test(src) && /MAX_NESTED_OPERATION_DEPTH:\s*4,/.test(src) &&
      /const MAX_DEPTH = LIMITS\.MAX_DEPTH;/.test(src) &&
      (src.match(/\bMAX_DEPTH = 8\b/g) || []).length === 0;
  })());

function LEval(script, opts) { return LE.evaluate(script, opts); }
function LErrKinds(script, opts) {
  return LEval(script, opts).errors.map(function (e) { return e.kind; });
}
// A deterministic rng: `next` is consumed one draw at a time (and counted).
function LERng(values) {
  const q = values.slice();
  const fn = function () {
    fn.draws++;
    return q.length ? q.shift() : 0;
  };
  fn.draws = 0;
  return fn;
}

// ---- typed values
check('p3: SET keeps the three-way type (number/string/boolean)',
  (function () {
    const r = LEval('SET n = 5\nSET s = "5"\nSET b = true');
    return r.ok && r.variables.n.type === 'number' && r.variables.n.value === 5 &&
      r.variables.s.type === 'string' && r.variables.s.value === '5' &&
      r.variables.b.type === 'boolean' && r.variables.b.value === true;
  })());
check('p3: false is a boolean value, not the string "false"',
  (function () {
    const r = LEval('SET b = false');
    return r.ok && r.variables.b.type === 'boolean' && r.variables.b.value === false;
  })());
check('p3: only EXPOSE statements populate `exposed`',
  (function () {
    const r = LEval('SET a = 1\nSET b = 2\nEXPOSE b');
    return r.ok && r.exposed.length === 1 && r.exposed[0].name === 'b' &&
      r.exposed[0].type === 'number' && r.exposed[0].value === 2;
  })());
check('p3: same-type equality compares by value (== and !=)',
  (function () {
    const r = LEval('SET a = 3\nIF a == 3 THEN SET e = 1\nIF a != 4 THEN SET ne = 1');
    return r.ok && r.variables.e.value === 1 && r.variables.ne.value === 1;
  })());
check('p3: string equality compares identical contents',
  (function () {
    const r = LEval('SET s = "x"\nIF s == "x" THEN SET hit = 1');
    return r.ok && r.variables.hit.value === 1;
  })());
check('p3: boolean equality compares by value',
  (function () {
    const r = LEval('SET t = true\nIF t == true THEN SET hit = 1');
    return r.ok && r.variables.hit.value === 1;
  })());
check('p3: number == string is a type-mismatch, never a silent false',
  (function () {
    const r = LEval('SET a = 1\nIF a == "1" THEN SET x = 1');
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'type-mismatch';
  })());
check('p3: boolean vs number is a type-mismatch',
  (function () {
    const r = LEval('SET t = true\nIF t == 1 THEN SET x = 1');
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'type-mismatch';
  })());
check('p3: boolean with an ordering operator is a type-mismatch',
  (function () {
    const r = LEval('SET t = true\nIF t > 1 THEN SET x = 1');
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'type-mismatch';
  })());

// ---- whole-string numeric boundary conversion
check('p3 d19: a numeric string converts in a numeric comparison ("46" > 10)',
  (function () {
    const r = LEval('SET d = "46"\nIF d > 10 THEN SET heavy = 1');
    return r.ok && r.variables.heavy.value === 1;
  })());
check('p3 d19: the stored value keeps its type and its exact text ("007")',
  (function () {
    const r = LEval('SET z = "007"\nIF z > 1 THEN SET ok = 1');
    return r.ok && r.variables.z.type === 'string' && r.variables.z.value === '007' &&
      r.variables.ok.value === 1;
  })());
check('p3 d19: both sides may be numeric strings',
  (function () {
    const r = LEval('IF "5" > "3" THEN SET x = 1');
    return r.ok && r.variables.x.value === 1;
  })());
check('p3 d19: a non-numeric string in a numeric context is a type-mismatch',
  (function () {
    const r = LEval('SET s = "abc"\nIF s > 1 THEN SET x = 1');
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'type-mismatch';
  })());
check('p3 d19: a partially numeric string is not converted ("12abc")',
  LErrKinds('SET s = "12abc"\nIF s >= 1 THEN SET x = 1')[0] === 'type-mismatch');
check('p3 d19: ordering operators cover > < >= <=',
  (function () {
    const r = LEval('IF 5 > 4 THEN SET a = 1\nIF 5 < 6 THEN SET b = 1\n' +
      'IF 5 >= 5 THEN SET c = 1\nIF 5 <= 5 THEN SET d = 1\nIF 5 <= 4 THEN SET e = 1');
    return r.ok && r.variables.a.value === 1 && r.variables.b.value === 1 &&
      r.variables.c.value === 1 && r.variables.d.value === 1 && r.variables.e === undefined;
  })());

// ---- missing variables (: never a silent '')
check('p3: reading an unassigned variable is missing-variable (never "")',
  (function () {
    const r = LEval('IF nope > 1 THEN SET x = 1');
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'missing-variable' && r.errors[0].varName === 'nope' &&
      r.errors[0].line === 1;
  })());
check('p3: a variable assigned only in the unexecuted branch is missing later',
  (function () {
    const r = LEval('SET a = 1\nIF a == 2 THEN:\n    SET q = 5\nEXPOSE q');
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'missing-variable' && r.errors[0].varName === 'q' &&
      r.errors[0].line === 4;
  })());
check('p3: the failed script reports what ran (trace) but no variables it never set',
  (function () {
    const r = LEval('SET a = 1\nEXPOSE missing');
    return r.ok === false && r.trace.length === 1 && r.trace[0].kind === 'set' &&
      Object.keys(r.variables).length === 1;
  })());

// ---- IMPORT / EXPOSE
check('p3: IMPORT takes the supplied typed value and records its source',
  (function () {
    const r = LEval('IMPORT %base damage%\nSET t = %base damage%\nEXPOSE t',
      { values: { 'base damage': 46 } });
    return r.ok && r.variables['base damage'].type === 'number' &&
      r.variables['base damage'].source === 'import' && r.exposed[0].value === 46 &&
      r.trace[0].kind === 'import' && r.trace[0].source === 'test-input';
  })());
check('p3: an IMPORT with no supplied value is missing-import (, no default)',
  (function () {
    const r = LEval('IMPORT %base%');
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'missing-import' && r.errors[0].varName === 'base';
  })());
check('p3: an unusable supplied value is invalid-import, not a coercion',
  (function () {
    const r = LEval('IMPORT %base%', { values: { base: { nope: 1 } } });
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'invalid-import';
  })());
check('p3: a caller may supply an already-typed value record',
  (function () {
    const r = LEval('IMPORT %name%\nEXPOSE name', { values: { name: { type: 'string', value: 'x' } } });
    return r.ok && r.exposed[0].type === 'string' && r.exposed[0].value === 'x';
  })());
check('p3: a supplied string stays a string (no import-time conversion)',
  (function () {
    const r = LEval('IMPORT %n%', { values: { n: '7' } });
    return r.ok && r.variables.n.type === 'string' && r.variables.n.value === '7';
  })());

// ---- conditionals
check('p3: a single-line IF runs exactly one statement when true',
  (function () {
    const r = LEval('SET a = 1\nIF a == 1 THEN SET x = 7');
    return r.ok && r.variables.x.value === 7;
  })());
check('p3: a false single-line IF runs nothing',
  (function () {
    const r = LEval('SET a = 2\nIF a == 1 THEN SET x = 7');
    return r.ok && r.variables.x === undefined;
  })());
check('p3: an indented block IF runs its whole body',
  (function () {
    const r = LEval('IF 1 == 1 THEN:\n    SET a = 1\n    SET b = 2');
    return r.ok && r.variables.a.value === 1 && r.variables.b.value === 2;
  })());
check('p3: ELSE IF selects the branch that matches, in order',
  (function () {
    const r = LEval('SET a = 2\nIF a == 1 THEN:\n    SET k = 1\nELSE IF a == 2 THEN:\n' +
      '    SET k = 2\nELSE IF a == 2 THEN:\n    SET k = 3\nELSE:\n    SET k = 4');
    return r.ok && r.variables.k.value === 2;
  })());
check('p3: ELSE runs when nothing matched',
  (function () {
    const r = LEval('SET a = 9\nIF a == 1 THEN:\n    SET k = 1\nELSE:\n    SET k = 4');
    return r.ok && r.variables.k.value === 4;
  })());
check('p3 d15: AND binds tighter than OR (false AND true OR true = true)',
  (function () {
    const r = LEval('IF 1 == 2 AND 1 == 1 OR 1 == 1 THEN SET hit = 1');
    return r.ok && r.variables.hit.value === 1;
  })());
check('p3 d16: parens override the default precedence',
  (function () {
    const r = LEval('IF 1 == 2 AND (1 == 1 OR 1 == 1) THEN SET hit = 1');
    return r.ok && r.variables.hit === undefined;
  })());
check('p3: a branch that is not selected never executes its statements',
  (function () {
    const rng = LERng([0]);
    const r = LEval('IF 1 == 2 THEN:\n    SET q = ROLL ((1-6))\nSET after = 1', { rng: rng });
    return r.ok && rng.draws === 0 && r.variables.q === undefined && r.variables.after.value === 1;
  })());

// ---- rolls: exactly once, never a reroll
check('p3: each ROLL draws exactly once and reads reuse the stored value',
  (function () {
    const rng = LERng([0.5]);
    const r = LEval('SET x = ROLL ((1-6))\nIF x > 0 THEN:\n    SET y = x\nEXPOSE y', { rng: rng });
    return r.ok && rng.draws === 1 && r.variables.x.value === 4 && r.variables.y.value === 4;
  })());
check('p3: two ROLL statements draw twice (one draw per statement)',
  (function () {
    const rng = LERng([0, 0]);
    const r = LEval('SET a = ROLL ((1-2))\nSET b = ROLL ((1-2))', { rng: rng });
    return r.ok && rng.draws === 2;
  })());
check('p3: an inclusive range yields its bounds at rng 0 and rng ~1',
  (function () {
    const lo = LEval('SET x = ROLL ((3-5))', { rng: LERng([0]) });
    const hi = LEval('SET x = ROLL ((3-5))', { rng: LERng([0.999999]) });
    return lo.variables.x.value === 3 && hi.variables.x.value === 5;
  })());
check('p3: a range value is a NUMBER',
  LEval('SET x = ROLL ((1-6))', { rng: LERng([0]) }).variables.x.type === 'number');
check('p3: a weighted choice honours weights (a weight-0 option is never picked)',
  (function () {
    const r = LEval('SET x = ROLL ((a:0 | b:5))', { rng: LERng([0]) });
    return r.ok && r.variables.x.type === 'string' && r.variables.x.value === 'b';
  })());
check('p3: an all-zero-weight choice is empty-choice, not an undefined pick',
  LErrKinds('SET x = ROLL ((a:0 | b:0))', { rng: LERng([0]) })[0] === 'empty-choice');
check('p3: a bare ((...)) value behaves like ROLL ((...)) (one draw)',
  (function () {
    const rng = LERng([0]);
    const r = LEval('SET x = ((4-4))', { rng: rng });
    return r.ok && rng.draws === 1 && r.variables.x.value === 4;
  })());
check('p3: ROLL [container] reuses the engine container system (entry text)',
  (function () {
    const containers = [{ id: 'c1', name: 'chest', file: '', entries: [{ label: 'Sword', weight: 1 }] }];
    const r = LEval('SET w = ROLL [chest]', { containers: containers, rng: LERng([0]) });
    return r.ok && r.variables.w.type === 'string' && r.variables.w.value === 'Sword';
  })());
check('p3: a container ROLL carries the engine trace node as `children`',
  (function () {
    const containers = [{ id: 'c1', name: 'chest', file: '', entries: [{ label: 'Sword', weight: 1 }] }];
    const r = LEval('SET w = ROLL [chest]', { containers: containers, rng: LERng([0]) });
    const roll = r.trace[0].roll;
    return r.ok && roll.kind === 'container' && roll.entryLabel === 'Sword' &&
      Array.isArray(roll.children) && roll.children[0].containerName === 'chest';
  })());
check('p3: a missing container surfaces the engine kind, never a silent roll',
  LErrKinds('SET w = ROLL [nope]', { containers: [] })[0] === 'missing-container');
check('p3: ROLL |expr| reuses the lens of the dice engine (evalExpr)',
  (function () {
    const r = LEval('SET a = ROLL |2d6+3|', { evalExpr: function () { return 9; } });
    return r.ok && r.variables.a.value === '9';
  })());
check('p3: ROLL |Macro| resolves a dice macro through the engine',
  (function () {
    const r = LEval('SET a = ROLL |sword|', {
      macros: [{ name: 'Sword', formula: '1d8' }],
      evalExpr: function () { return 5; },
    });
    return r.ok && r.variables.a.value === '5';
  })());
check('p3: an unresolvable |expr| surfaces the engine kind',
  (function () {
    const r = LEval('SET a = ROLL |nope|', { evalExpr: function () { throw new Error('bad'); } });
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'unresolved';
  })());
check('p3: a numeric ROLL (dice) still compares numerically',
  (function () {
    const r = LEval('SET a = ROLL |1d6|\nIF a > 1 THEN SET big = 1', {
      evalExpr: function () { return 4; }, rng: LERng([0]),
    });
    return r.ok && r.variables.big.value === 1;
  })());

// ---- SWITCH/CASE/DEFAULT
check('p3 d18: only the first matching CASE executes and then the SWITCH exits',
  (function () {
    const r = LEval('SET w = "Shotgun"\nSWITCH w:\n    CASE "Pistol":\n        SET k = 1\n' +
      '    CASE "Shotgun":\n        SET k = 2\n    DEFAULT:\n        SET k = 3');
    return r.ok && r.variables.k.value === 2;
  })());
check('p3: DEFAULT runs when no CASE matches',
  (function () {
    const r = LEval('SET w = "Bow"\nSWITCH w:\n    CASE "Pistol":\n        SET k = 1\n' +
      '    DEFAULT:\n        SET k = 3');
    return r.ok && r.variables.k.value === 3;
  })());
check('p3: a SWITCH with no match and no DEFAULT does nothing (branch null)',
  (function () {
    const r = LEval('SET w = "Bow"\nSWITCH w:\n    CASE "Pistol":\n        SET k = 1');
    const sw = r.trace.filter(function (e) { return e.kind === 'switch'; })[0];
    return r.ok && r.variables.k === undefined && sw && sw.branch === null;
  })());
check('p3 d23: CASE matching is type-aware — CASE 1 never matches the string "1"',
  (function () {
    const r = LEval('SET w = "1"\nSWITCH w:\n    CASE 1:\n        SET k = 1\n' +
      '    DEFAULT:\n        SET k = 9');
    return r.ok && r.variables.k.value === 9;
  })());
check('p3 d23: CASE 1 and CASE 1.0 are duplicates (validation refuses to execute)',
  (function () {
    const r = LEval('SET w = 1\nSWITCH w:\n    CASE 1:\n        SET k = 1\n    CASE 1.0:\n        SET k = 2');
    return r.ok === false && r.errors[0].kind === 'duplicate-case' &&
      Object.keys(r.variables).length === 0 && r.trace.length === 0;
  })());
check('p3 d23: a second DEFAULT is invalid',
  LErrKinds('SET w = 1\nSWITCH w:\n    DEFAULT:\n        SET k = 1\n    DEFAULT:\n        SET k = 2')[0] === 'duplicate-default');
check('p3 d23: a SWITCH with no CASE or DEFAULT is invalid',
  LErrKinds('SWITCH 1:')[0] === 'empty-switch');
check('p3 d23: a rolling CASE label is invalid, never a silent draw',
  (function () {
    const r = LEval('SET w = 1\nSWITCH w:\n    CASE ((1-3)):\n        SET k = 1');
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'invalid-case';
  })());
check('p3: a single-option ((...)) CASE label is a plain string value',
  (function () {
    const r = LEval('SET w = "Sword"\nSWITCH w:\n    CASE ((Sword)):\n        SET k = 1');
    return r.ok && r.variables.k.value === 1;
  })());
check('p3: the SWITCH subject is evaluated once (one container draw)',
  (function () {
    const containers = [{ id: 'c1', name: 'chest', file: '', entries: [{ label: 'A', weight: 1 }] }];
    const rng = LERng([0]);
    const r = LEval('SWITCH ROLL [chest]:\n    CASE "A":\n        SET k = 1', { containers: containers, rng: rng });
    return r.ok && rng.draws === 1 && r.variables.k.value === 1;
  })());
check('p3: CASE statements can be used by later statements',
  (function () {
    const r = LEval('SET w = 2\nSWITCH w:\n    CASE 2:\n        SET k = 5\nSET after = k');
    return r.ok && r.variables.after.value === 5;
  })());

// ---- limits
check('p3 d21: a resolution budget at the cap trips nesting-limit on the next ROLL',
  (function () {
    const r = LEval('SET x = ROLL ((1-6))', {
      rng: LERng([0]), budget: { resolutions: GLIMITS.MAX_RESOLUTIONS, chars: 0 },
    });
    return r.ok === false && r.errors[0].kind === 'nesting-limit';
  })());
check('p3 d21: a character budget at the cap trips nesting-limit too',
  (function () {
    const r = LEval('SET x = ROLL ((1-6))', {
      rng: LERng([0]), budget: { resolutions: 0, chars: GLIMITS.MAX_OUTPUT_CHARS },
    });
    return r.ok === false && r.errors[0].kind === 'nesting-limit';
  })());
check('p3 d21: block nesting is capped by LIMITS.MAX_DEPTH (8 levels)',
  (function () {
    function nested(ifs) {
      let src = 'SET a = 1\n';
      let indent = '';
      for (let i = 0; i < ifs; i++) { src += indent + 'IF a == 1 THEN:\n'; indent += '    '; }
      return src + indent + 'SET deep = 1\n';
    }
    const ok = LEval(nested(GLIMITS.MAX_DEPTH - 1));
    const over = LEval(nested(GLIMITS.MAX_DEPTH));
    return ok.ok === true && ok.variables.deep.value === 1 &&
      over.ok === false && over.errors[0].kind === 'nesting-limit' && over.errors[0].line > 0;
  })());
check('p3 d8: nested script operations stop at MAX_NESTED_OPERATION_DEPTH (4)',
  (function () {
    const op = {
      id: 'op_deep', name: 'Deep', script: 'SET a = 1\nEXPOSE a',
      outputTemplate: '', imports: [], exposed: ['a'], bindings: {}, occurrences: [],
    };
    const atLimit = T.executeOperation(op, { rng: LERng([0]), operationDepth: GLIMITS.MAX_NESTED_OPERATION_DEPTH });
    const below = T.executeOperation(op, { rng: LERng([0]), operationDepth: GLIMITS.MAX_NESTED_OPERATION_DEPTH - 1 });
    return atLimit.ok === false && atLimit.errors[0].kind === 'nesting-limit' && below.ok === true;
  })());

// ---- trace
check('p3 d9: the trace has one entry per executed statement, in order',
  (function () {
    const r = LEval('IMPORT %v%\nSET a = v\nIF a > 0 THEN:\n    SET b = a\nEXPOSE b\n' +
      'SWITCH a:\n    CASE 1:\n        SET c = 1',
    { values: { v: 1 } });
    return r.ok && r.trace.map(function (e) { return e.kind; }).join(',') ===
      'import,set,if,set,expose,switch,set';
  })());
check('p3 d9: steps are 1-based and strictly increasing',
  (function () {
    const r = LEval('SET a = 1\nSET b = 2\nSET c = 3');
    return r.trace.length === 3 && r.trace[0].step === 1 && r.trace[1].step === 2 && r.trace[2].step === 3;
  })());
check('p3 d9: trace lines are the 1-based source lines (comments do not shift them)',
  (function () {
    const r = LEval('# a comment\nSET a = 1 # trailing\n\nSET b = 2');
    return r.ok && r.trace[0].line === 2 && r.trace[1].line === 4;
  })());
check('p3 d9: a set entry records name/type/value/source',
  (function () {
    const e = LEval('SET a = "x"').trace[0];
    return e.kind === 'set' && e.name === 'a' && e.type === 'string' && e.value === 'x' && e.source === 'string';
  })());
check('p3 d9: an if entry records the evaluated clauses and the selected branch',
  (function () {
    const r = LEval('SET a = 2\nIF a == 1 THEN:\n    SET k = 1\nELSE IF a == 2 THEN:\n    SET k = 2');
    const e = r.trace.filter(function (x) { return x.kind === 'if'; })[0];
    return e.branch === 'else-if 0' && e.evaluations.length === 2 &&
      e.evaluations[0].result === false && e.evaluations[1].result === true &&
      e.evaluations[1].checks[0].op === '==' && e.evaluations[1].checks[0].left.type === 'number';
  })());
check('p3 d9: a switch entry records the subject, the comparisons and the branch',
  (function () {
    const r = LEval('SET w = 2\nSWITCH w:\n    CASE 1:\n        SET k = 1\n    CASE 2:\n        SET k = 2');
    const e = r.trace.filter(function (x) { return x.kind === 'switch'; })[0];
    return e.subject.type === 'number' && e.subject.value === 2 &&
      e.comparisons.length === 2 && e.comparisons[0].equal === false &&
      e.comparisons[1].equal === true && e.branch === 'case 1';
  })());
check('p3 d9: an unselected branch contributes no trace entries',
  (function () {
    const r = LEval('IF 1 == 2 THEN:\n    SET a = 1\n    SET b = 2');
    return r.ok && r.trace.length === 1 && r.trace[0].kind === 'if';
  })());

// ---- comments
check('p3: whole-line and trailing comments never execute',
  (function () {
    const r = LEval('# header\nSET a = 1 # trailing\n# footer');
    return r.ok && Object.keys(r.variables).length === 1 && r.variables.a.value === 1;
  })());
check('p3: a # inside a string or a container name is data, not a comment',
  (function () {
    const r1 = LEval('SET s = "a # b"');
    const containers = [{ id: 'c1', name: 'Loot #3', file: '', entries: [{ label: 'Gem', weight: 1 }] }];
    const r2 = LEval('SET g = ROLL [Loot #3]', { containers: containers, rng: LERng([0]) });
    return r1.ok && r1.variables.s.value === 'a # b' && r2.ok && r2.variables.g.value === 'Gem';
  })());
check('p3: a comment-only script is a valid, empty program',
  (function () {
    const r = LEval('# just a note\n# and another');
    return r.ok && r.trace.length === 0 && r.exposed.length === 0;
  })());

// ---- engine integration (executeOperation keeps its contract)
const P3_SCRIPT_OP = {
  id: 'op_p3', name: 'Logic1',
  script: 'SET base = ROLL ((40-50))\nIF base > 45 THEN:\n    SET label = "High"\nELSE:\n    SET label = "Low"\nEXPOSE label',
  outputTemplate: '', imports: [], exposed: ['label'], bindings: {}, occurrences: [],
};
check('p3: a script operation runs through executeOperation',
  (function () {
    const r = T.executeOperation(P3_SCRIPT_OP, { rng: LERng([0.9]) });
    return r.ok === true && Array.isArray(r.trace) && r.trace.length > 0 && r.errors.length === 0;
  })());
check('p3: executeOperation keeps its five-field contract for a script operation',
  (function () {
    const r = T.executeOperation(P3_SCRIPT_OP, { rng: LERng([0]) });
    const keys = Object.keys(r).sort().join(',');
    return keys === 'errors,ok,output,segments,trace' && r.output === '' && r.segments.length === 0;
  })());
check('p3: the evaluator variables/exposed reach the caller non-enumerably (input)',
  (function () {
    const r = T.executeOperation(P3_SCRIPT_OP, { rng: LERng([0.9]) });
    return r.exposed && r.exposed.length === 1 && r.exposed[0].name === 'label' &&
      r.exposed[0].value === 'High' && r.variables && r.variables.base.type === 'number';
  })());
check('p3: a failing script reports engine-shaped errors with its own line',
  (function () {
    const op = Object.assign({}, P3_SCRIPT_OP, { script: 'SET a = 1\nSET b = missing' });
    const r = T.executeOperation(op, { rng: LERng([0]) });
    const e = r.errors[0];
    return r.ok === false && e.kind === 'missing-variable' && e.token === '{Logic1}' &&
      e.position === 0 && e.operationName === 'Logic1' && e.line === 2 &&
      typeof e.message === 'string' && r.segments[0].type === 'error';
  })());
check('p3: an explicit type:"script" operation runs config.script too',
  (function () {
    const r = T.executeOperation({ id: 'op_s', name: 'S', type: 'script', config: { script: 'SET a = 2' } });
    return r.ok === true && Array.isArray(r.trace) && r.trace[0].kind === 'set';
  })());
check('p3: IMPORT values reach a script operation through ctx.values',
  (function () {
    const op = Object.assign({}, P3_SCRIPT_OP, { script: 'IMPORT %damage%\nEXPOSE damage' });
    const r = T.executeOperation(op, { values: { damage: 46 } });
    return r.ok === true && r.exposed[0].value === 46;
  })());
check('p3: a script operation keeps the documented output shape (value and pick)',
  (function () {
    const f = T.executeOperation({ name: 'F', script: 'SET a = 2', outputTemplate: '%a%' },
      { rng: LERng([0]) });
    const c = T.executeOperation({ name: 'C', script: 'SET c = ROLL ((A))', outputTemplate: '%c%' },
      { rng: LERng([0]) });
    return f.ok === true && f.output === '2' && f.trace[0].kind === 'set' &&
      c.ok === true && c.output === 'A' && c.trace[0].kind === 'set';
  })());
check('p3: unknown and non-script types are still unsupported-operation',
  (function () {
    const a = T.executeOperation({ name: 'N', type: 'conditional', config: {} });
    const b = T.executeOperation({ name: 'N', type: 'nested', config: {} });
    const c = T.executeOperation(null);
    return a.ok === false && a.errors[0].kind === 'unsupported-operation' &&
      b.errors[0].kind === 'unsupported-operation' && c.errors[0].kind === 'unsupported-operation';
  })());
check('p3: a {script operation} reference validates as supported',
  (function () {
    const r = T.validateGenerator({ template: '{Logic1}' }, [], [P3_SCRIPT_OP]);
    const bad = T.validateGenerator({ template: '{Nope}' }, [], [P3_SCRIPT_OP]);
    return r.ok === true && r.errors.length === 0 &&
      bad.ok === false && bad.errors[0].kind === 'missing-operation';
  })());
check('p3: a script ROLL inside a container label reuses the shared budget object',
  (function () {
    const budget = { resolutions: 0, chars: 0 };
    const containers = [{ id: 'c1', name: 'chest', file: '', entries: [{ label: 'Sword', weight: 1 }] }];
    const r = LEval('SET w = ROLL [chest]', { containers: containers, rng: LERng([0]), budget: budget });
    return r.ok === true && budget.resolutions > 0;
  })());
check('p3: evaluation never throws on malformed or non-string input',
  (function () {
    const a = LEval(null);
    const b = LEval('IF');
    const c = LEval(42);
    return a.ok === false && b.ok === false && c.ok === false && a.errors.length === 1;
  })());

// ---- Output Templates (substitution and validation) ----
const P4_EXAMPLE_A = {
  id: 'op_p4a', name: 'Loot',
  script: 'SET weapon = ROLL [chest]\nSET base_damage = ROLL ((30-50))\n\nIF weapon == "Shotgun" AND base_damage > 45 THEN:\n    SET rarity = "Legendary"\nELSE:\n    SET rarity = "Common"',
  outputTemplate: '%rarity% %weapon% (%base_damage% Base damage)',
  imports: [], exposed: [], bindings: {}, occurrences: [],
};
const P4_CHEST = [{ id: 'c1', name: 'chest', file: '', entries: [{ label: 'Shotgun', weight: 1 }] }];
function P4Op(over) {
  return Object.assign({
    id: 'op_p4', name: 'T1',
    script: 'SET a = 1', outputTemplate: '',
    imports: [], exposed: [], bindings: {}, occurrences: [],
  }, over);
}
check('p4: Example A renders the exact documented output',
  (function () {
    const r = T.executeOperation(P4_EXAMPLE_A, { containers: P4_CHEST, rng: LERng([0, 0.77]) });
    return r.ok === true && r.output === 'Legendary Shotgun (46 Base damage)';
  })());
check('p4: Example A keeps damage at 46 throughout the evaluation',
  (function () {
    const r = T.executeOperation(P4_EXAMPLE_A, { containers: P4_CHEST, rng: LERng([0, 0.77]) });
    return r.ok === true &&
      r.variables.base_damage.type === 'number' && r.variables.base_damage.value === 46 &&
      r.variables.weapon.type === 'string' && r.variables.weapon.value === 'Shotgun' &&
      r.variables.rarity.type === 'string' && r.variables.rarity.value === 'Legendary';
  })());
check('p4: Example A ELSE branch renders the Common output (damage 30)',
  (function () {
    const r = T.executeOperation(P4_EXAMPLE_A, { containers: P4_CHEST, rng: LERng([0, 0]) });
    return r.ok === true && r.output === 'Common Shotgun (30 Base damage)';
  })());
check('p4: a rendered script operation returns one "text" segment',
  (function () {
    const r = T.executeOperation(P4_EXAMPLE_A, { containers: P4_CHEST, rng: LERng([0, 0.77]) });
    return r.segments.length === 1 && r.segments[0].type === 'text' &&
      r.segments[0].text === 'Legendary Shotgun (46 Base damage)';
  })());
check('p4: Example E — only %variable% is interpreted; all other syntax is literal',
  (function () {
    const r = T.substituteOutputTemplate('%a% and ((x)) and [y] and {z} and %%', { a: 'X' });
    return r.ok === true && r.text === 'X and ((x)) and [y] and {z} and %%';
  })());
check('p4: %a-b% and %% are literal spans; % ok % trims to its name',
  (function () {
    const r = T.substituteOutputTemplate('%a-b% and %% and % ok %', { a: 1, ok: 2 });
    return r.ok === true && r.text === '%a-b% and %% and 2';
  })());
check('p4: Example F — comments, blank lines, and a conditional block execute correctly',
  (function () {
    const script = '# pick a weapon\n\n' +
      'SET weapon = ROLL [chest]\n' +
      'SET base_damage = ROLL ((30-50))\n' +
      '\n' +
      'IF weapon == "Shotgun" AND base_damage > 45 THEN: # the good branch\n' +
      '    SET rarity = "Legendary"\n' +
      'ELSE:\n' +
      '    SET rarity = "Common"\n';
    const op = P4Op({ name: 'TF', script: script, outputTemplate: '%rarity% %weapon% (%base_damage% Base damage)' });
    const hi = T.executeOperation(op, { containers: P4_CHEST, rng: LERng([0, 0.77]) });
    const lo = T.executeOperation(op, { containers: P4_CHEST, rng: LERng([0, 0]) });
    return hi.ok === true && hi.output === 'Legendary Shotgun (46 Base damage)' &&
      lo.ok === true && lo.output === 'Common Shotgun (30 Base damage)';
  })());
check('p4: Example F — comments and formatting survive the export/import codec byte-identically',
  (function () {
    // In the current data model, comments and formatting live inside the
    // operation's raw `script` string; derived fields are rebuilt from it,
    // never rewritten.
    const script = '# pick a weapon\n\n' +
      'SET x = 1 # why\n' +
      'IF x == 1 THEN:\n' +
      '    SET y = 2 # inside\n' +
      'ELSE:\n' +
      '    SET y = 0\n';
    const op = P4Op({ name: 'TF2', script: script, outputTemplate: '%y%' });
    const parsed = T.parseLogicOpsBundle(
      JSON.stringify(T.buildLogicOpsBundle([T.exportLogicOperation(op)])));
    return parsed.ok === true &&
      parsed.operations.length === 1 &&
      parsed.operations[0].script === script &&
      deepEq(parsed.operations[0].imports, []) &&
      deepEq(parsed.operations[0].exposed, []);
  })());
check('p4: a missing template variable is a clear missing-variable error (direct)',
  (function () {
    const r = T.substituteOutputTemplate('%a%', {});
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'missing-variable' && r.errors[0].varName === 'a';
  })());
check('p4: every distinct missing variable is reported, first-appearance order (direct)',
  (function () {
    const r = T.substituteOutputTemplate('%b% %a% %b% %c%', { a: 1 });
    return r.ok === false && r.errors.length === 2 &&
      r.errors[0].varName === 'b' && r.errors[1].varName === 'c';
  })());
check('p4: a missing template variable fails the operation with an engine-shaped error',
  (function () {
    const r = T.executeOperation(P4Op({ name: 'T1', script: 'SET a = 1', outputTemplate: '%a% %b%' }),
      { rng: LERng([0]) });
    const e = r.errors[0];
    return r.ok === false && e.kind === 'missing-variable' && e.varName === 'b' &&
      e.token === '{T1}' && e.position === 0 && e.operationName === 'T1' && e.line === 0 &&
      e.origin === 'output-template' &&
      typeof e.message === 'string' && r.segments[0].type === 'error';
  })());
check('p4: a present-but-not-typed template value counts as missing (direct)',
  (function () {
    const a = T.substituteOutputTemplate('%v%', { v: { deep: true } });
    const b = T.substituteOutputTemplate('%v%', { v: null });
    const c = T.substituteOutputTemplate('%v%', { v: NaN });
    return a.ok === false && a.errors[0].varName === 'v' &&
      b.ok === false && b.errors[0].varName === 'v' &&
      c.ok === false && c.errors[0].varName === 'v';
  })());
check('p4: a not-typed supplied import fails the operation (no silent substitution)',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T2', script: 'IMPORT %v%', imports: ['v'], outputTemplate: 'v=%v%' }),
      { values: { v: { deep: true } } });
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'invalid-import' && r.segments[0].type === 'error';
  })());
check('p4: a template with no references renders its literal text',
  (function () {
    const r = T.executeOperation(P4Op({ name: 'T3', outputTemplate: 'plain text only' }));
    return r.ok === true && r.output === 'plain text only' &&
      r.segments.length === 1 && r.segments[0].type === 'text' &&
      r.segments[0].text === 'plain text only';
  })());
check('p4: an empty or absent outputTemplate keeps the shape',
  (function () {
    const empty = Object.assign({}, P4_EXAMPLE_A, { outputTemplate: '' });
    const absent = Object.assign({}, P4_EXAMPLE_A);
    delete absent.outputTemplate;
    const a = T.executeOperation(empty, { containers: P4_CHEST, rng: LERng([0]) });
    const b = T.executeOperation(absent, { containers: P4_CHEST, rng: LERng([0]) });
    return a.ok === true && a.output === '' && a.segments.length === 0 &&
      b.ok === true && b.output === '' && b.segments.length === 0;
  })());
check('p4: the rendered template text is charged to the shared character budget',
  (function () {
    const budget = { resolutions: 0, chars: 0 };
    const r = T.executeOperation(P4Op({ name: 'T4', script: 'SET a = 123', outputTemplate: 'X%a%Y' }),
      { budget: budget });
    return r.ok === true && r.output === 'X123Y' && budget.chars === 5;
  })());
check('p4: a rendered operation keeps its five-field contract (variables/exposed non-enumerable)',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T5', script: 'SET label = "Hi"\nEXPOSE label', exposed: ['label'],
        outputTemplate: 'Out: %label%' }));
    const keys = Object.keys(r).sort().join(',');
    return r.ok === true && r.output === 'Out: Hi' &&
      keys === 'errors,ok,output,segments,trace' &&
      r.exposed.length === 1 && r.exposed[0].name === 'label' &&
      r.variables.label.value === 'Hi';
  })());
check('p4: an imported value renders through the template end-to-end',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T6', script: 'IMPORT %damage%', imports: ['damage'],
        outputTemplate: 'Dealt %damage% damage' }),
      { values: { damage: 46 } });
    return r.ok === true && r.output === 'Dealt 46 damage';
  })());
check('p4: config.outputTemplate is used when the op field is absent',
  (function () {
    const r = T.executeOperation({ id: 'op_p4h', name: 'T7', type: 'script',
      config: { script: 'SET a = 2', outputTemplate: 'n=%a%' } });
    return r.ok === true && r.output === 'n=2';
  })());
check('p4: — a plain SET guarantees its template variable',
  (function () {
    const r = T.validateOutputTemplateDataflow('SET a = 1', '%a%', []);
    return r.referenced.length === 1 && r.referenced[0] === 'a' &&
      r.guaranteed.length === 1 && r.guaranteed[0] === 'a' &&
      r.warnings.length === 0 && r.parseErrors.length === 0;
  })());
check('p4: — an IF without ELSE does not guarantee the branch variable',
  (function () {
    const r = T.validateOutputTemplateDataflow('SET c = 1\nIF c == 1 THEN SET a = 2', '%a%', []);
    return r.guaranteed.length === 0 && r.warnings.length === 1 && r.warnings[0] === 'a';
  })());
check('p4: — IF/ELSE covering both paths guarantees the variable',
  (function () {
    const r = T.validateOutputTemplateDataflow(
      'SET c = 1\nIF c == 1 THEN:\n    SET a = 2\nELSE:\n    SET a = 3', '%a%', []);
    return r.guaranteed.length === 1 && r.guaranteed[0] === 'a' && r.warnings.length === 0;
  })());
check('p4: — an ELSE IF chain without ELSE still leaves a fall-through path',
  (function () {
    const r = T.validateOutputTemplateDataflow(
      'SET c = 1\nIF c == 1 THEN:\n    SET a = 2\nELSE IF c == 2 THEN:\n    SET a = 3', '%a%', []);
    return r.guaranteed.length === 0 && r.warnings.length === 1 && r.warnings[0] === 'a';
  })());
check('p4: — SWITCH with a DEFAULT guarantees the variable',
  (function () {
    const r = T.validateOutputTemplateDataflow(
      'SWITCH k:\n    CASE 1:\n        SET a = 2\n    DEFAULT:\n        SET a = 3', '%a%', []);
    return r.guaranteed.length === 1 && r.guaranteed[0] === 'a' && r.warnings.length === 0;
  })());
check('p4: — SWITCH without a DEFAULT does not guarantee the variable',
  (function () {
    const r = T.validateOutputTemplateDataflow(
      'SWITCH k:\n    CASE 1:\n        SET a = 2', '%a%', []);
    return r.guaranteed.length === 0 && r.warnings.length === 1 && r.warnings[0] === 'a';
  })());
check('p4: — a declared input is guaranteed from the start',
  (function () {
    const r = T.validateOutputTemplateDataflow('IMPORT %x%', '%x%', ['x']);
    return r.referenced.length === 1 && r.guaranteed.length === 1 &&
      r.guaranteed[0] === 'x' && r.warnings.length === 0;
  })());
check('p4: — an import of an undeclared name grants no guarantee',
  (function () {
    const r = T.validateOutputTemplateDataflow('IMPORT %x%', '%x%', []);
    return r.guaranteed.length === 0 && r.warnings.length === 1 && r.warnings[0] === 'x';
  })());
check('p4: — a parse failure defers every non-input reference to a warning',
  (function () {
    const r = T.validateOutputTemplateDataflow('IF', '%a% %b%', ['b']);
    return r.referenced.length === 2 && r.parseErrors.length > 0 &&
      r.guaranteed.length === 1 && r.guaranteed[0] === 'b' &&
      r.warnings.length === 1 && r.warnings[0] === 'a';
  })());
check('p4: — literal spans are never references',
  (function () {
    const r = T.validateOutputTemplateDataflow('SET a = 1', '%% and %a-b% and % a %', ['a']);
    return r.referenced.length === 1 && r.referenced[0] === 'a' &&
      r.guaranteed.length === 1 && r.warnings.length === 0 && r.parseErrors.length === 0;
  })());
check('p4: — nested IFs are guaranteed only when every inner path assigns',
  (function () {
    const bad = T.validateOutputTemplateDataflow(
      'IF 1 == 1 THEN:\n    IF 1 == 1 THEN:\n        SET a = 2\nELSE:\n    SET a = 3', '%a%', []);
    const good = T.validateOutputTemplateDataflow(
      'IF 1 == 1 THEN:\n    IF 1 == 1 THEN:\n        SET a = 2\n    ELSE:\n        SET a = 3\nELSE:\n    SET a = 4', '%a%', []);
    return bad.guaranteed.length === 0 && bad.warnings.length === 1 && bad.warnings[0] === 'a' &&
      good.guaranteed.length === 1 && good.warnings.length === 0;
  })());
check('p4: — referenced names are distinct, first-appearance order',
  (function () {
    const r = T.validateOutputTemplateDataflow('SET b = 1\nSET a = 2', '%b% %a% %b%', []);
    return r.referenced.length === 2 && r.referenced[0] === 'b' && r.referenced[1] === 'a' &&
      r.warnings.length === 0;
  })());
check('p4: a missing substituteOutputTemplate global is a load-order failure',
  (function () {
    // The top-level function declaration is a non-configurable property of
    // the context global (delete silently no-ops), so "missing" is simulated
    // by overwriting it with undefined — the guard checks typeof === "function".
    const saved = vm.runInNewContext('typeof window.substituteOutputTemplate === "function" && window.substituteOutputTemplate', sandbox) || null;
    if (saved) sandbox.__p4SavedSub = saved;
    vm.runInNewContext('window.substituteOutputTemplate = undefined', sandbox);
    try {
      const r = T.executeOperation(P4Op({ name: 'T8', outputTemplate: 'a=%a%' }));
      return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'unsupported-operation';
    } finally {
      if (saved) {
        vm.runInNewContext('window.substituteOutputTemplate = window.__p4SavedSub', sandbox);
        delete sandbox.__p4SavedSub;
      }
    }
  })());
check('p4: — an unavailable parser reports parse-unavailable and defers every reference',
  (function () {
    const saved = vm.runInNewContext('typeof window.LogicLanguage === "object" && window.LogicLanguage', sandbox) || null;
    if (saved) sandbox.__p4SavedLL = saved;
    vm.runInNewContext('delete window.LogicLanguage', sandbox);
    try {
      const r = T.validateOutputTemplateDataflow('SET a = 1', '%a%', []);
      return r.referenced.length === 1 && r.referenced[0] === 'a' &&
        r.guaranteed.length === 0 && r.warnings.length === 1 && r.warnings[0] === 'a' &&
        r.parseErrors.length === 1 && r.parseErrors[0].kind === 'parse-unavailable';
    } finally {
      if (saved) {
        vm.runInNewContext('window.LogicLanguage = window.__p4SavedLL', sandbox);
        delete sandbox.__p4SavedLL;
      }
    }
  })());


/* =====================================================================
 * Logic tab UI
 * View-model checks: highlight categories, editor/validation report,
 * autocomplete, per-imported-variable test inputs, the trace rows, and
 * the bundle codec. The DOM renderers are thin adapters over these.
 * ====================================================================*/

function P5Op(fields) {
  const f = Object.assign({ name: 'P5', script: '', outputTemplate: '' }, fields || {});
  return T.createLogicOperation(f).op;
}

// ---- highlight categories (; /) ----
checkEq('p5: HIGHLIGHT maps keywords to the pink token and class',
  (function () { return T.LogicLanguage.HIGHLIGHT.keyword.token + '|' + T.LogicLanguage.HIGHLIGHT.keyword.cls; })(),
  '--keyword|script-keyword');
checkEq('p5: HIGHLIGHT maps variables to the token and class',
  (function () { return T.LogicLanguage.HIGHLIGHT.variable.token + '|' + T.LogicLanguage.HIGHLIGHT.variable.cls; })(),
  '--script-var|script-var');
check('p5: keywords highlight as script-keyword spans',
  (function () {
    const spans = T.logicHighlightSpans('IF x == 1 THEN:');
    const kw = spans.filter((s) => s.category === 'keyword');
    return kw.length === 2 && kw[0].text === 'IF' && kw[0].cls === 'script-keyword' &&
      kw[0].token === '--keyword' && kw[1].text === 'THEN';
  })());
check('p5: true/false highlight as pink keywords',
  (function () {
    const spans = T.logicHighlightSpans('SET flag = true');
    const kw = spans.filter((s) => s.category === 'keyword' && s.text === 'true');
    return kw.length === 1 && kw[0].cls === 'script-keyword';
  })());
check('p5: variable names highlight with script-var',
  (function () {
    const spans = T.logicHighlightSpans('SET dmg = base');
    const vars = spans.filter((s) => s.category === 'variable');
    return vars.length === 2 && vars[0].text === 'dmg' && vars[0].cls === 'script-var' &&
      vars[1].text === 'base' && vars[1].token === '--script-var';
  })());
check('p5: every token category maps to its documented class',
  (function () {
    const spans = T.logicHighlightSpans('SET d = ROLL [chest] # note');
    const byCat = {};
    for (const s of spans) byCat[s.category] = s;
    const other = T.logicHighlightSpans('SET a = |Sword|\nSET b = {Bow}\nSET c = ROLL ((1-2))\nSET e = "s"');
    const byCat2 = {};
    for (const s of other) byCat2[s.category] = s;
    return byCat.container.cls === 'embed-ref' && byCat.comment.cls === '' &&
      byCat2.dice.cls === 'embed-expr' && byCat2.op.cls === 'embed-op' &&
      byCat2.inline.cls === 'embed-pick' && byCat2.string.cls === 'embed-pick';
  })());
check('p5: highlight spans reproduce the source byte-for-byte',
  (function () {
    const src = 'IMPORT %base%\nSET dmg = base * 2  # double\nIF dmg >= 10 THEN:\n    SET label = "heavy"';
    return T.logicHighlightSpans(src).map((s) => s.text).join('') === src;
  })());
check('p5: scriptEditorModel exposes 1-based line numbers',
  (function () {
    const m = T.scriptEditorModel('SET a = 1\nSET b = 2\n');
    return m.lineCount === 3 && m.gutter.join(',') === '1,2,3' && m.spans.length > 0;
  })());
check('p5: the Output Template colors only %name% spans',
  (function () {
    const spans = T.templateHighlightSpans('%a% %% %a-b% [x] |1d6|');
    const vars = spans.filter((s) => s.category === 'variable');
    return vars.length === 1 && vars[0].text === '%a%' && vars[0].cls === 'script-var' &&
      spans.map((s) => s.text).join('') === '%a% %% %a-b% [x] |1d6|';
  })());
check('p5: CSS carries --keyword/--script-var in all four themes with distinct values',
  (function () {
    const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
    const blocks = [
      { name: 'midnight', re: /:root \{([\s\S]*?)\n\}/ },
      { name: 'paper', re: /\[data-theme="paper"\] \{([\s\S]*?)\n\}/ },
      { name: 'ember', re: /\[data-theme="ember"\] \{([\s\S]*?)\n\}/ },
      { name: 'mono', re: /\[data-theme="mono"\] \{([\s\S]*?)\n\}/ },
    ];
    let count = 0;
    for (const b of blocks) {
      const m = b.re.exec(css);
      if (!m) return false;
      const body = m[1];
      const val = (name) => {
        const r = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})').exec(body);
        return r ? r[1].toLowerCase() : null;
      };
      const keyword = val('keyword');
      const scriptVar = val('script-var');
      const others = ['ref', 'op', 'embed', 'pick', 'danger'].map(val).filter(Boolean);
      if (!keyword || !scriptVar) return false;
      if (others.indexOf(keyword) !== -1 || others.indexOf(scriptVar) !== -1) return false;
      if (keyword === scriptVar) return false;
      count++;
    }
    return count === 4 &&
      /\.script-keyword\s*\{[^}]*var\(--keyword\)/.test(css) &&
      /\.script-var\s*\{[^}]*var\(--script-var\)/.test(css);
  })());

// ---- editor validation report ----
check('p5: a clean script/template has no problems',
  (function () {
    const r = T.logicValidationReport('IMPORT %base%\nSET dmg = base', '%dmg%', ['base']);
    return r.ok === true && r.errors.length === 0 && r.warnings.length === 0;
  })());
check('p5: a parse error carries its line',
  (function () {
    const r = T.logicValidationReport('SET a = 1\nOUTPUT a', '%a%', []);
    return r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'unknown-keyword' &&
      r.errors[0].line === 2;
  })());
check('p5: an unknown template variable is an error',
  (function () {
    const r = T.logicValidationReport('SET a = 1', '%a% %b%', []);
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'unknown-template-variable' && /%b%/.test(r.errors[0].message);
  })());
check('p5: a branch-only template variable is a warning',
  (function () {
    const r = T.logicValidationReport('IF 1 == 1 THEN:\n    SET x = 2', '%x%', []);
    return r.ok === true && r.warnings.length === 1 &&
      r.warnings[0].kind === 'maybe-unset-template-variable';
  })());
check('p5: an ELSE that assigns makes the template variable safe',
  (function () {
    const r = T.logicValidationReport(
      'IF 1 == 1 THEN:\n    SET x = 2\nELSE:\n    SET x = 3', '%x%', []);
    return r.ok === true && r.warnings.length === 0;
  })());
check('p5: SWITCH + DEFAULT assigns on every path',
  (function () {
    const script = 'SET kind = 1\nSWITCH kind:\n    CASE 1:\n        SET x = 1\n    DEFAULT:\n        SET x = 2';
    const r = T.logicValidationReport(script, '%x%', []);
    return r.ok === true && r.warnings.length === 0;
  })());
check('p5: SWITCH without DEFAULT keeps the warning',
  (function () {
    const script = 'SET kind = 1\nSWITCH kind:\n    CASE 1:\n        SET x = 1\n    CASE 2:\n        SET x = 2';
    const r = T.logicValidationReport(script, '%x%', []);
    return r.ok === true && r.warnings.length === 1 && r.warnings[0].kind === 'maybe-unset-template-variable';
  })());
check('p5: a declared import is guaranteed in the template',
  (function () {
    const r = T.logicValidationReport('IMPORT %base%', '%base%', ['base']);
    return r.ok === true && r.warnings.length === 0;
  })());
check('p5: literal % spans are never template references',
  (function () {
    const r = T.logicValidationReport('SET a = 1', '100%% and %a-b%', []);
    return r.ok === true && r.errors.length === 0 && r.warnings.length === 0;
  })());
check('p5: a parse failure defers template checking instead of guessing',
  (function () {
    const r = T.logicValidationReport('IF', '%x%', []);
    return r.ok === false && r.errors.length > 0 && r.warnings.length === 1 &&
      r.warnings[0].kind === 'dataflow-deferred';
  })());
check('p5: collectScriptNames walks nested bodies',
  (function () {
    const n = T.collectScriptNames(
      'IMPORT %base%\nIF base >= 1 THEN:\n    SET heavy = 1\nELSE:\n    SET light = 1\nSWITCH heavy:\n    CASE 1:\n        SET tag = "x"\nEXPOSE tag');
    return n.ok === true && n.imported.join(',') === 'base' &&
      n.assigned.sort().join(',') === 'heavy,light,tag' && n.exposed.join(',') === 'tag';
  })());

// ---- autocomplete ----
check('p5: a bare keyword prefix completes to the keyword',
  (function () {
    const r = T.autocompleteSuggestions('ROL', 3, { keywords: ['ROLL'] });
    return r && r.items.length === 1 && r.items[0].insert === 'ROLL' && r.start === 0;
  })());
check('p5: a bare variable prefix completes to the variable',
  (function () {
    const r = T.autocompleteSuggestions('SET dmg = bas', 13, { variables: ['base'] });
    return r && r.items.length === 1 && r.items[0].insert === 'base' && r.start === 10;
  })());
check('p5: an open % completes the whole %name% span',
  (function () {
    const text = 'SET d = %ba';
    const r = T.autocompleteSuggestions(text, text.length, { variables: ['base'] });
    return r && r.start === 8 && r.end === text.length && r.items[0].insert === '%base%';
  })());
check('p5: an open [ suggests containers',
  (function () {
    const text = 'SET d = ROLL [lo';
    const r = T.autocompleteSuggestions(text, text.length, { containers: ['Loot'] });
    return r && r.items[0].insert === '[Loot]' && r.start === text.indexOf('[');
  })());
check('p5: an open { suggests operations',
  (function () {
    const text = 'SET d = {Bo';
    const r = T.autocompleteSuggestions(text, text.length, { operations: ['Bow'] });
    return r && r.items[0].insert === '{Bow}';
  })());
check('p5: an open | suggests macros and dice',
  (function () {
    const text = 'SET d = |Sw';
    const r = T.autocompleteSuggestions(text, text.length, { macros: ['Sword'], dice: ['2d6'] });
    return r && r.items.length === 1 && r.items[0].insert === '|Sword|';
  })());
check('p5: no suggestions inside a string literal',
  T.autocompleteSuggestions('SET x = "bas', 12, { variables: ['base'] }) === null);
check('p5: template autocomplete offers variables but no bare words',
  (function () {
    const inSpan = T.autocompleteSuggestions('%ba', 3, { variables: ['base'] }, { templateOnly: true });
    const bare = T.autocompleteSuggestions('ba', 2, { variables: ['base'] }, { templateOnly: true });
    return inSpan && inSpan.items[0].insert === '%base%' && bare === null;
  })());
check('p5: applyAutocomplete replaces the range and moves the caret',
  (function () {
    const r = T.applyAutocomplete('SET d = %ba + 1', 8, 11, '%base%');
    return r.text === 'SET d = %base% + 1' && r.caret === 14;
  })());
check('p5: the editor context carries keywords and boolean literals',
  (function () {
    const ctx = T.logicAutocompleteContext();
    return ctx.keywords.indexOf('ROLL') !== -1 && ctx.keywords.indexOf('true') !== -1 &&
      Array.isArray(ctx.dice) && Array.isArray(ctx.operations);
  })());

// ---- per-imported-variable test inputs ----
check('p5: test input types are number / string / boolean / missing',
  T.logicTestInputType('46') === 'number' && T.logicTestInputType('46.5') === 'number' &&
  T.logicTestInputType('true') === 'boolean' && T.logicTestInputType('hello') === 'string' &&
  T.logicTestInputType('   ') === null);
check('p5: buildTestValues converts typed values',
  (function () {
    const r = T.buildTestValues(['dmg', 'flag', 'name'], { dmg: '46', flag: 'false', name: 'Axe' });
    return r.missing.length === 0 && r.values.dmg === 46 && r.values.flag === false &&
      r.values.name === 'Axe' && r.types.dmg === 'number';
  })());
check('p5: a blank import is missing, never defaulted',
  (function () {
    const r = T.buildTestValues(['a', 'b'], { a: '1', b: '  ' });
    return r.missing.length === 1 && r.missing[0] === 'b' &&
      !Object.prototype.hasOwnProperty.call(r.values, 'b');
  })());
check('p5: a standalone run renders the Output Template',
  (function () {
    const op = P5Op({
      name: 'Shot', script: 'IMPORT %base%\nSET damage = base', outputTemplate: '%damage%',
    });
    const res = T.runLogicOpTest(op, { base: 46 });
    return res.ok === true && res.output === '46' &&
      res.segments.length === 1 && res.segments[0].text === '46';
  })());
check('p5: the trace covers import/set/roll/if/expose',
  (function () {
    const op = P5Op({
      name: 'Trace', script: 'IMPORT %base%\nSET dmg = base\nSET roll = ROLL |1d6|\nIF dmg >= 1 THEN:\n    SET label = "heavy"\nELSE:\n    SET label = "light"\nEXPOSE label',
      outputTemplate: '%label%',
    });
    const res = T.runLogicOpTest(op, { base: 5 });
    const rows = T.traceRows(res.trace);
    const kinds = rows.map((r) => r.kind).join(',');
    const ifRow = rows.filter((r) => r.kind === 'if')[0];
    const rollRow = rows.filter((r) => r.kind === 'set' && /rolled/.test(r.details.join(' ')))[0];
    return res.ok === true && kinds === 'import,set,set,if,set,expose' &&
      rows[0].title === 'IMPORT %base%' && rows[0].details[1] === 'source: test input' &&
      !!rollRow && !!ifRow && ifRow.details[0] === 'branch: then' &&
      rows[rows.length - 1].title === 'EXPOSE label';
  })());
check('p5: a missing import is reported, not defaulted',
  (function () {
    const op = P5Op({ name: 'Need', script: 'IMPORT %a%\nIMPORT %b%', outputTemplate: '' });
    const res = T.runLogicOpTest(op, { a: 1 });
    return res.ok === false && res.errors.length === 1 && res.errors[0].kind === 'missing-import' &&
      /"b"/.test(res.errors[0].message) &&
      /Missing value/.test(T.logicRunErrorMessage(res.errors[0]));
  })());
check('p5: a test run stores no inputs and does not mutate the operation',
  (function () {
    const op = P5Op({ name: 'Pure', script: 'IMPORT %a%', outputTemplate: '%a%' });
    const before = JSON.stringify(op);
    T.runLogicOpTest(op, { a: 7 });
    return JSON.stringify(op) === before && !Object.prototype.hasOwnProperty.call(op, 'testInputs');
  })());

// ---- bundle import/export ----
check('p5: the export bundle is kind/operations with script ops only',
  (function () {
    const op = P5Op({ name: 'Shotgun', script: 'IMPORT %dmg%', outputTemplate: '%dmg%' });
    op.trace = [{ step: 1 }];
    op.testInputs = { dmg: '4' };
    const bundle = T.buildLogicOpsBundle([op, { name: 'Off', purpose: '', type: 'nope' }]);
    const exported = bundle.operations[0];
    return bundle.kind === 'ttrpg-logic-ops' &&
      !Object.prototype.hasOwnProperty.call(bundle, 'version') &&
      bundle.operations.length === 1 &&
      !Object.prototype.hasOwnProperty.call(exported, 'trace') &&
      !Object.prototype.hasOwnProperty.call(exported, 'testInputs') &&
      exported.imports.length === 1 && exported.imports[0] === 'dmg' &&
      exported.exposed.length === 0 &&
      !Object.prototype.hasOwnProperty.call(exported, 'version');
  })());
check('p5: a bundle round-trips through parse and strict validation',
  (function () {
    const op = P5Op({ name: 'Round', script: 'IMPORT %a%', outputTemplate: '%a%' });
    const text = JSON.stringify(T.buildLogicOpsBundle([op]));
    const parsed = T.parseLogicOpsBundle(text);
    return parsed.ok === true && parsed.operations.length === 1 &&
      T.validateLogicOperation(parsed.operations[0]).length === 0 &&
      parsed.operations[0].occurrences.length === 1 &&
      typeof parsed.operations[0].occurrences[0].instanceId === 'string';
  })());
check('p5: invalid JSON is rejected with a clear message',
  (function () {
    const r = T.parseLogicOpsBundle('{nope');
    return r.ok === false && r.operations.length === 0 && r.errors[0].kind === 'invalid-json';
  })());
check('p5: a file without the bundle kind is rejected with one generic message',
  (function () {
    const a = T.parseLogicOpsBundle(JSON.stringify({ items: [{ name: 'A', type: 'nope' }] }));
    const b = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-generators', operations: [] }));
    return a.ok === false && a.errors.length === 1 && a.errors[0].kind === 'invalid-bundle' &&
      /not a valid logic-ops bundle/.test(a.errors[0].message) &&
      b.ok === false && b.errors.length === 1 && b.errors[0].kind === 'invalid-bundle';
  })());
check('p5: a bundle with an extra header field (e.g. version) is rejected',
  (function () {
    const r = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', version: 1, operations: [] }));
    return r.ok === false && r.errors.length === 1 &&
      r.errors[0].kind === 'unknown-field' && /"version"/.test(r.errors[0].message);
  })());
check('p5: an operation missing `script` is rejected by name',
  (function () {
    const bad = {
      kind: 'ttrpg-logic-ops',
      operations: [{
        id: 'op_x', name: 'A', purpose: '', outputTemplate: '',
        imports: [], exposed: [], bindings: {}, occurrences: [],
      }],
    };
    const r = T.parseLogicOpsBundle(JSON.stringify(bad));
    return r.ok === false && r.errors.some((e) => /operations\[0\]: code is required/.test(e.message));
  })());
check('p5: an unknown operation field is rejected',
  (function () {
    const op = T.exportLogicOperation(P5Op({ name: 'Extra', script: 'SET a = 1' }));
    op.extra = 1;
    const r = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: [op] }));
    return r.ok === false && r.errors.some((e) => e.kind === 'unknown-field');
  })());
check('p5: import renames a name clash deterministically',
  (function () {
    const plan = T.planLogicOpsImport(
      [T.exportLogicOperation(P5Op({ name: 'Attack', script: 'SET a = 1' })),
        T.exportLogicOperation(P5Op({ name: 'Other', script: 'SET b = 1' }))],
      [{ name: 'Attack', id: 'op_existing' }]);
    return plan.renamed.length === 1 && plan.renamed[0].from === 'Attack' &&
      plan.renamed[0].to === 'Attack (imported)' &&
      plan.operations[0].name === 'Attack (imported)' && plan.operations[1].name === 'Other';
  })());
check('p5: import regenerates a colliding operation id',
  (function () {
    const op = T.exportLogicOperation(P5Op({ name: 'Twin', script: 'SET a = 1' }));
    op.id = 'op_same';
    const plan = T.planLogicOpsImport([op], [{ name: 'Other', id: 'op_same' }]);
    return plan.idChanges === 1 && plan.operations[0].id !== 'op_same' &&
      /^op_[0-9a-f]{8}$/.test(plan.operations[0].id);
  })());
check('p5: occurrence ids stay stable across an edit and are fresh for new tokens',
  (function () {
    const rows = T.reconcileOpOccurrences(
      [{ instanceId: 'occ_keep', token: 'dmg', refId: null, offset: 1 }],
      'IMPORT %dmg%\nIMPORT %fresh%');
    return rows.length === 2 && rows[0].instanceId === 'occ_keep' &&
      rows[1].token === 'fresh' && rows[1].instanceId !== 'occ_keep' &&
      /^occ_|^[a-z]+_/.test(rows[1].instanceId);
  })());
check('p5: a fresh draft has the operation shape and validates once named',
  (function () {
    const draft = T.newLogicOpDraft();
    const before = T.validateLogicOperation(draft).map((e) => e.kind).join(',');
    draft.name = 'Draft';
    const after = T.validateLogicOperation(draft);
    return before === 'invalid-type' && after.length === 0 && !('version' in draft) &&
      draft.script === '' && typeof draft.occurrences.length === 'number';
  })());
check('p5: derive() lists script operations without an item warning',
  (function () {
    const saved = new Map(T.state.files);
    try {
      T.state.files.clear();
      const items = [
        T.exportLogicOperation(P5Op({ name: 'Scripted', script: 'SET a = 1' })),
        T.exportLogicOperation(P5Op({ name: 'Second', script: 'SET b = 2' })),
      ];
      const text = JSON.stringify({ items: items });
      T.state.files.set('logic-ops/p5-derive.json', { text: text, parsed: JSON.parse(text), error: null });
      T.derive();
      const rows = T.state.logicOps;
      const warns = T.state.warnings.filter((w) => w.kind === 'item' && w.path === 'logic-ops/p5-derive.json');
      return rows.length === 2 && !('type' in rows[0]) && !('type' in rows[1]) &&
        warns.length === 0;
    } finally {
      T.state.files.clear();
      for (const [k, v] of saved) T.state.files.set(k, v);
      T.derive();
    }
  })());
check('p5: derive() flags an operation row that has no script',
  (function () {
    const saved = new Map(T.state.files);
    try {
      T.state.files.clear();
      const text = JSON.stringify({ items: [{ id: 'op_old', name: 'Off', purpose: '' }] });
      T.state.files.set('logic-ops/p5-derive2.json', { text: text, parsed: JSON.parse(text), error: null });
      T.derive();
      const rows = T.state.logicOps.filter((r) => r.file === 'logic-ops/p5-derive2.json');
      const warns = T.state.warnings.filter((w) => w.kind === 'item' && w.path === 'logic-ops/p5-derive2.json');
      return rows.length === 0 && warns.length === 1 && /has no code/.test(warns[0].message);
    } finally {
      T.state.files.clear();
      for (const [k, v] of saved) T.state.files.set(k, v);
      T.derive();
    }
  })());


// ==================== CRUD, search, import/export =========================
// Pure cores of the Logic tab operations: list search (filterLogicOps),
// duplicate naming (nextCopyName), script-op detection (isScriptLogicOp), in-place
// normalization (normalizeLogicOpInPlace), the operation factory's error kinds
// (createLogicOperation), strict bundle-codec edges (parseLogicOpsBundle),
// file serialization (serializeLogicOpsFile), export shaping (exportLogicOperation),
// import planning (planLogicOpsImport), runtime error sentences
// (logicRunErrorMessage), trace rows (traceRowOf), and template references
// (templateReferencedNames).

// ---- list search (filterLogicOps) ----
check('p5b: an empty search query returns the list unchanged',
  (function () {
    const items = [P5Op({ name: 'Alpha', script: 'SET a = 1' }), P5Op({ name: 'Beta', script: 'SET b = 1' })];
    return T.filterLogicOps(items, '') === items &&
      T.filterLogicOps(items, undefined) === items &&
      T.filterLogicOps(items, null) === items;
  })());
check('p5b: search matches name or purpose, case-insensitive and trimmed',
  (function () {
    const items = [
      P5Op({ name: 'Shotgun', purpose: 'Weapon damage', script: 'SET a = 1' }),
      P5Op({ name: 'Dart', purpose: 'Light weapon', script: 'SET a = 1' }),
      null, 42,
    ];
    const byName = T.filterLogicOps(items, '  SHOTGUN ');
    const byPurpose = T.filterLogicOps(items, 'light');
    return byName.length === 1 && byName[0].name === 'Shotgun' &&
      byPurpose.length === 1 && byPurpose[0].name === 'Dart' &&
      T.filterLogicOps(items, 'zzz').length === 0;
  })());

// ---- duplicate naming (nextCopyName) ----
check('p5b: a duplicate gets " (copy)" and the next free numbered suffix',
  (function () {
    return T.nextCopyName('Attack', []) === 'Attack (copy)' &&
      T.nextCopyName('Attack', ['Attack (copy)']) === 'Attack (copy 2)' &&
      T.nextCopyName('Attack', ['Attack (copy)', 'attack (copy 2)']) === 'Attack (copy 3)';
  })());
check('p5b: an unnamed duplicate becomes "Untitled (copy)"',
  (function () {
    return T.nextCopyName('', []) === 'Untitled (copy)' &&
      T.nextCopyName('  spaced  ', []) === 'spaced (copy)';
  })());

// ---- script-op detection (isScriptLogicOp) ----
check('p5b: script rows are recognized by shape (no type, script is a string)',
  (function () {
    return T.isScriptLogicOp({ name: 'A', script: 'SET a = 1' }) === true &&
      T.isScriptLogicOp({ name: 'B', type: '', script: '' }) === true &&
      T.isScriptLogicOp({ name: 'C', type: 'formula', config: {} }) === false &&
      T.isScriptLogicOp({ name: 'D', version: 1 }) === false &&
      T.isScriptLogicOp(null) === false &&
      T.isScriptLogicOp([1]) === false &&
      T.isScriptLogicOp('x') === false;
  })());

// ---- in-place normalization (normalizeLogicOpInPlace) ----
check('p5b: normalize rebuilds imports/exposed from the script',
  (function () {
    const op = P5Op({ name: 'N', script: 'IMPORT %a%\nEXPOSE %b%' });
    op.imports = ['stale'];
    op.exposed = ['stale2'];
    op.outputTemplate = 42;
    op.bindings = 'junk';
    T.normalizeLogicOpInPlace(op);
    return !('version' in op) &&
      T.validateLogicOperation(op).length === 0 &&
      JSON.stringify(op.imports) === '["a"]' &&
      JSON.stringify(op.exposed) === '["b"]' &&
      op.outputTemplate === '' &&
      JSON.stringify(op.bindings) === '{}';
  })());
check('p5b: normalize drops stale occurrences and their bindings',
  (function () {
    const op = P5Op({ name: 'N2', script: 'IMPORT %dmg%' });
    const live = op.occurrences[0].instanceId;
    op.occurrences = op.occurrences.concat([{ instanceId: 'occ_stale', token: 'ghost', refId: null, offset: 0 }]);
    op.bindings = {};
    op.bindings[live] = 'in';
    op.bindings.occ_stale = 'out';
    T.normalizeLogicOpInPlace(op);
    return op.occurrences.length === 1 && op.occurrences[0].instanceId === live &&
      Object.keys(op.bindings).length === 1 && op.bindings[live] === 'in';
  })());
check('p5b: normalize is a pass-through guard for non-objects',
  T.normalizeLogicOpInPlace(null) === null && T.normalizeLogicOpInPlace(undefined) === undefined);

// ---- operation factory error kinds (createLogicOperation) ----
check('p5b: createLogicOperation reports missing-name for blank or absent names',
  (function () {
    const r1 = T.createLogicOperation({ name: '   ' });
    const r2 = T.createLogicOperation(null);
    return r1.ok === false && r1.errors.some((e) => e.kind === 'missing-name') &&
      r2.ok === false && r2.errors.some((e) => e.kind === 'missing-name');
  })());
check('p5b: createLogicOperation reports invalid-type for every wrong field type',
  (function () {
    const r = T.createLogicOperation({ name: 'X', purpose: 7, script: 8, outputTemplate: 9, exposed: 'a' });
    const kinds = r.errors.map((e) => e.kind);
    return r.ok === false && kinds.filter((k) => k === 'invalid-type').length === 4 &&
      r.errors.some((e) => e.message === 'purpose must be a string.') &&
      r.errors.some((e) => e.message === 'exposed must be an array of names.') &&
      JSON.stringify(r.op.exposed) === '[]';
  })());
check('p5b: a clean createLogicOperation keeps the given id and derives the rest',
  (function () {
    const r = T.createLogicOperation({ id: 'op_keep0001', name: 'Keep', script: 'IMPORT %a%', outputTemplate: '%a%', exposed: ['z'] });
    return r.ok === true && r.op.id === 'op_keep0001' && !('version' in r.op) &&
      JSON.stringify(r.op.imports) === '["a"]' &&
      JSON.stringify(r.op.exposed) === '["z"]' &&
      JSON.stringify(r.op.bindings) === '{}' &&
      r.op.occurrences.length === 1;
  })());

// ---- strict bundle codec edges (parseLogicOpsBundle) ----
check('p5b: an unknown bundle field is rejected',
  (function () {
    const r = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: [], note: 'x' }));
    return r.ok === false && r.errors.some((e) => e.kind === 'unknown-field' && /note/.test(e.message));
  })());
check('p5b: a non-array operations list is rejected',
  (function () {
    const r = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', operations: {} }));
    return r.ok === false && r.errors.some((e) => e.kind === 'invalid-type' && /operations must be an array/.test(e.message));
  })());
check('p5b: a bundle header carrying a version field is rejected',
  (function () {
    const a = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', version: 3, operations: [] }));
    const b = T.parseLogicOpsBundle(JSON.stringify({ kind: 'ttrpg-logic-ops', version: '2', operations: [] }));
    return a.ok === false && a.errors.length === 1 &&
      a.errors[0].kind === 'unknown-field' && /"version"/.test(a.errors[0].message) &&
      b.ok === false && b.errors.length === 1 && b.errors[0].kind === 'unknown-field';
  })());
check('p5b: a top-level array or non-text payload is rejected',
  (function () {
    const a = T.parseLogicOpsBundle('[]');
    const b = T.parseLogicOpsBundle(123);
    return a.ok === false && a.errors[0].kind === 'invalid-bundle' &&
      /not a valid logic-ops bundle/.test(a.errors[0].message) &&
      b.ok === false && b.errors[0].kind === 'invalid-json';
  })());

// ---- file serialization (serializeLogicOpsFile) ----
check('p5b: serializeLogicOpsFile writes the {items:[...]} file shape',
  (function () {
    const op = T.exportLogicOperation(P5Op({ name: 'Ser', script: 'SET a = 1' }));
    const text = T.serializeLogicOpsFile([op]);
    return text === JSON.stringify({ items: [op] }, null, 2) + '\n' &&
      JSON.parse(text).items.length === 1 &&
      T.serializeLogicOpsFile('junk') === JSON.stringify({ items: [] }, null, 2) + '\n';
  })());

// ---- dirty-state content key (logicOpContentKey / logicOpIsDirty) ----
// The editor's saved/unsaved label is DERIVED from comparing the current
// content against the last-saved content: these are its unit-testable core.
check('p5b: logicOpContentKey is stable for unchanged content',
  (function () {
    const op = P5Op({ name: 'Key', purpose: 'p', script: 'SET a = 1\nEXPOSE a', outputTemplate: '%a%' });
    T.normalizeLogicOpInPlace(op);
    const k1 = T.logicOpContentKey(op);
    return k1 !== '' && k1 === T.logicOpContentKey(op);
  })());
check('p5b: logicOpContentKey ignores derived fields (recomputed, no edit signal)',
  (function () {
    const op = P5Op({ name: 'Der', script: 'IMPORT y\nSET a = y\nEXPOSE a' });
    T.normalizeLogicOpInPlace(op);
    const k = T.logicOpContentKey(op);
    op.imports = ['not-the-real-imports'];
    op.exposed = ['junk'];
    op.occurrences = [{ instanceId: 'bogus', token: 'y', offset: 0 }];
    op.bindings = { bogus: 42 };
    return T.logicOpContentKey(op) === k;
  })());
check('p5b: logicOpContentKey changes when exactly one editable field changes',
  (function () {
    const base = { name: 'X', purpose: '', script: 'SET a = 1', outputTemplate: '' };
    const k = T.logicOpContentKey(base);
    return T.logicOpContentKey(Object.assign({}, base, { script: 'SET a = 2' })) !== k &&
      T.logicOpContentKey(Object.assign({}, base, { purpose: 'n' })) !== k &&
      T.logicOpContentKey(Object.assign({}, base, { name: 'Y' })) !== k &&
      T.logicOpContentKey(Object.assign({}, base, { outputTemplate: '%a%' })) !== k &&
      T.logicOpContentKey(Object.assign({}, base)) === k;
  })());
check('p5b: logicOpContentKey tolerates non-objects (empty key)',
  (function () {
    return T.logicOpContentKey(null) === '' &&
      T.logicOpContentKey(undefined) === '' &&
      T.logicOpContentKey('junk') === '' &&
      T.logicOpContentKey([1]) === '';
  })());
check('p5b: logicOpIsDirty flips on edit and back to false on revert-to-original',
  (function () {
    const op = P5Op({ name: 'Re', script: 'SET a = 1' });
    const savedKey = T.logicOpContentKey(op);
    if (T.logicOpIsDirty(op, savedKey)) return false;
    op.script = 'SET a = 99';
    if (!T.logicOpIsDirty(op, savedKey)) return false;
    op.script = 'SET a = 1'; // typed back to exactly what was loaded
    if (T.logicOpIsDirty(op, savedKey)) return false;
    op.script = 'SET a = 99';
    const newSavedKey = T.logicOpContentKey(op); // what afterSaved() captures
    return !T.logicOpIsDirty(op, newSavedKey);
  })());
check('p5b: logicOpIsDirty treats a missing saved key as dirty for a real op',
  (function () {
    const op = { name: 'X', script: 'SET a = 1' };
    return T.logicOpIsDirty(op, null) === true &&
      T.logicOpIsDirty(op, undefined) === true &&
      T.logicOpIsDirty(null, null) === false;
  })());

// ---- export shaping (exportLogicOperation) ----
check('p5b: export rebuilds stale imports/exposed and keeps string bindings only',
  (function () {
    const op = P5Op({ name: 'Exp', script: 'IMPORT %a%\nEXPOSE %b%' });
    op.imports = ['stale'];
    op.exposed = ['stale2'];
    const live = op.occurrences[0].instanceId;
    op.bindings = {};
    op.bindings[live] = 'in';
    op.bindings.occ_stale = 42;
    const out = T.exportLogicOperation(op);
    return JSON.stringify(out.imports) === '["a"]' &&
      JSON.stringify(out.exposed) === '["b"]' &&
      !('version' in out) &&
      Object.keys(out.bindings).length === 1 && out.bindings[live] === 'in';
  })());
check('p5b: export carries occurrence rows with refId defaulting to null',
  (function () {
    const op = P5Op({ name: 'Occ', script: 'IMPORT %a%' });
    const live = op.occurrences[0].instanceId;
    op.occurrences = [
      { instanceId: live, token: 'a', offset: 8 },
      'junk',
      { instanceId: 'occ_x', token: 'b', refId: 'r1', offset: 2 },
    ];
    const out = T.exportLogicOperation(op);
    return out.occurrences.length === 2 &&
      out.occurrences[0].refId === null && out.occurrences[0].offset === 8 &&
      out.occurrences[1].refId === 'r1' && out.occurrences[1].instanceId === 'occ_x';
  })());
check('p5b: bindings and occurrences round-trip through the bundle codec',
  (function () {
    const op = P5Op({ name: 'Trip', script: 'IMPORT %a%' });
    const live = op.occurrences[0].instanceId;
    op.bindings = {};
    op.bindings[live] = 'in';
    const exported = T.exportLogicOperation(op);
    const parsed = T.parseLogicOpsBundle(JSON.stringify(T.buildLogicOpsBundle([exported])));
    return parsed.ok === true &&
      parsed.operations[0].id === op.id &&
      deepEq(parsed.operations[0].bindings, op.bindings) &&
      deepEq(parsed.operations[0].occurrences, op.occurrences);
  })());

// ---- import planning (planLogicOpsImport) ----
check('p5b: a clash-free import keeps every id and name',
  (function () {
    const a = T.exportLogicOperation(P5Op({ name: 'One', script: 'SET a = 1' }));
    const b = T.exportLogicOperation(P5Op({ name: 'Two', script: 'SET b = 1' }));
    const plan = T.planLogicOpsImport([a, b], [{ name: 'Existing', id: 'op_other01' }]);
    return plan.renamed.length === 0 && plan.idChanges === 0 &&
      plan.operations[0].id === a.id && plan.operations[1].id === b.id &&
      plan.operations[0].name === 'One' && plan.operations[1].name === 'Two';
  })());
check('p5b: within-bundle name clashes chain (imported), (imported 2), (imported 3)',
  (function () {
    const mk = (n) => T.exportLogicOperation(P5Op({ name: n, script: 'SET a = 1' }));
    const plan = T.planLogicOpsImport([mk('Alpha'), mk('Alpha'), mk('Alpha')], [{ name: 'Alpha', id: 'op_alpha' }]);
    return plan.renamed.length === 3 &&
      plan.operations[0].name === 'Alpha (imported)' &&
      plan.operations[1].name === 'Alpha (imported 2)' &&
      plan.operations[2].name === 'Alpha (imported 3)';
  })());
check('p5b: a within-bundle id collision keeps the first row, refreshes the rest',
  (function () {
    const a = T.exportLogicOperation(P5Op({ name: 'Twin', script: 'SET a = 1' }));
    const b = T.exportLogicOperation(P5Op({ name: 'Twin2', script: 'SET a = 1' }));
    b.id = a.id;
    const plan = T.planLogicOpsImport([a, b], []);
    return plan.idChanges === 1 && plan.operations[0].id === a.id &&
      plan.operations[1].id !== a.id && /^op_[0-9a-f]{8}$/.test(plan.operations[1].id);
  })());
check('p5b: planned ops are deep copies, never aliased to the payload',
  (function () {
    const a = T.exportLogicOperation(P5Op({ name: 'Copy', script: 'SET a = 1' }));
    const plan = T.planLogicOpsImport([a], []);
    plan.operations[0].script = 'MUTATED';
    plan.operations[0].bindings = { fake: 1 };
    return a.script === 'SET a = 1' && JSON.stringify(a.bindings) === '{}';
  })());

// ---- runtime error sentences (logicRunErrorMessage) ----
check('p5b: missing-variable and invalid-import sentences',
  (function () {
    return T.logicRunErrorMessage({ kind: 'missing-variable', varName: 'x' }) ===
      'The Output Template variable %x% has no value when the template renders' &&
      T.logicRunErrorMessage({ kind: 'invalid-import', varName: 'y' }) ===
      'The test value for %y% is not a number, string or boolean.';
  })());
check('p5b: type-mismatch names the rule',
  T.logicRunErrorMessage({ kind: 'type-mismatch', message: 'boolean vs number' }) ===
    'Type mismatch: boolean vs number \u2014 booleans only compare with booleans');
check('p5b: bad-script carries the line, unsupported-operation is fixed',
  (function () {
    return T.logicRunErrorMessage({ kind: 'bad-script', line: 4, message: 'unexpected token' }) ===
      'line 4: unexpected token' &&
      T.logicRunErrorMessage({ kind: 'unsupported-operation' }) === 'This operation is not executable.';
  })());
check('p5b: unknown kinds fall back to line + message or Run failed',
  (function () {
    return T.logicRunErrorMessage({ kind: 'weird', line: 2, message: 'm' }) === 'line 2: m' &&
      T.logicRunErrorMessage({ kind: 'weird' }) === 'Run failed: weird';
  })());

// ---- EXPOSE of valueless variables (: the error names the EXPOSE, not the template) ----
check('p5b: EXPOSE of an undefined variable fails with a missing-variable naming the EXPOSE',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T1', script: 'IMPORT %attack%\nEXPOSE %test1%', outputTemplate: '%attack%' }),
      { values: { attack: 5 }, rng: LERng([0]) });
    const e = r.errors.length === 1 ? r.errors[0] : null;
    const sentence = e ? T.logicRunErrorMessage(e) : '';
    return r.ok === false && e && e.kind === 'missing-variable' && e.varName === 'test1' &&
      e.line === 2 && e.origin === 'expose' &&
      sentence === 'EXPOSE: variable %test1% has no value (never assigned, or not on the executed path)' &&
      sentence.indexOf('Output Template') === -1;
  })());
check('p5b: EXPOSE of a defined variable succeeds and renders the template',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T1', script: 'IMPORT %attack%\nEXPOSE %attack%', outputTemplate: '%attack%' }),
      { values: { attack: 5 }, rng: LERng([0]) });
    return r.ok === true && r.output === '5' && r.exposed.length === 1 &&
      r.exposed[0].name === 'attack' && r.exposed[0].value === 5;
  })());
check('p5b: EXPOSE of a branch-assigned variable succeeds when the branch runs',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T1', script: 'SET a = 2\nIF a == 2 THEN:\n    SET q = 5\nEXPOSE q', outputTemplate: '%q%' }),
      { rng: LERng([0]) });
    return r.ok === true && r.output === '5' && r.exposed.length === 1 &&
      r.exposed[0].name === 'q' && r.exposed[0].value === 5;
  })());
check('p5b: EXPOSE of a branch-assigned variable fails when the branch did not run',
  (function () {
    const r = T.executeOperation(
      P4Op({ name: 'T1', script: 'SET a = 1\nIF a == 2 THEN:\n    SET q = 5\nEXPOSE q', outputTemplate: '%q%' }),
      { rng: LERng([0]) });
    const e = r.errors.length === 1 ? r.errors[0] : null;
    const sentence = e ? T.logicRunErrorMessage(e) : '';
    return r.ok === false && e && e.kind === 'missing-variable' && e.varName === 'q' &&
      e.line === 4 && e.origin === 'expose' &&
      sentence === 'EXPOSE: variable %q% has no value (never assigned, or not on the executed path)';
  })());

// ---- p5c: static EXPOSE validation + variable highlight ----
check('p5c: the exact repro — validation flags %test1% and the run names it',
  (function () {
    const script = 'IMPORT %attack%\nEXPOSE %test1%';
    const v = T.logicValidationReport(script, '%attack%', ['attack']);
    const vErr = (v.errors || []).find((x) => x.kind === 'expose-undefined-variable');
    const r = T.executeOperation(
      P4Op({ name: 'T1', script: script, outputTemplate: '%attack%' }),
      { values: { attack: 5 }, rng: LERng([0]) });
    const e = r.errors.length === 1 ? r.errors[0] : null;
    return vErr && vErr.varName === 'test1' && vErr.line === 2 &&
      r.ok === false && e && e.kind === 'missing-variable' && e.origin === 'expose' &&
      e.varName === 'test1' && T.logicRunErrorMessage(e).indexOf('%test1%') !== -1;
  })());
check('p5c: EXPOSE of a never-defined variable is an error naming the variable',
  (function () {
    const r = T.logicValidationReport('IMPORT %attack%\nEXPOSE %test1%', '%attack%', ['attack']);
    const e = (r.errors || []).find((x) => x.kind === 'expose-undefined-variable');
    return r.ok === false && r.errors.length === 1 && r.warnings.length === 0 &&
      e && e.severity === 'error' && e.varName === 'test1' && e.line === 2 &&
      e.message.indexOf('%test1%') !== -1;
  })());
check('p5c: EXPOSE of an IF-branch-only variable is a warning (branch rule)',
  (function () {
    const r = T.logicValidationReport('IMPORT %roll%\nIF roll > 10 THEN:\n    SET hit = true\nEXPOSE %hit%', '', ['roll']);
    const w = (r.warnings || []).find((x) => x.kind === 'expose-branch-only-variable');
    return r.ok === true && r.errors.length === 0 && r.warnings.length === 1 &&
      w && w.severity === 'warning' && w.varName === 'hit' && w.line === 4 &&
      w.message.indexOf('%hit%') !== -1;
  })());
check('p5c: EXPOSE of a SWITCH variable with no DEFAULT is a warning',
  (function () {
    const r = T.logicValidationReport('IMPORT %k%\nSWITCH k:\n    CASE 1:\n        SET x = 1\nEXPOSE %x%', '', ['k']);
    const w = (r.warnings || []).find((x) => x.kind === 'expose-branch-only-variable');
    return r.ok === true && r.errors.length === 0 && r.warnings.length === 1 &&
      w && w.varName === 'x' && w.line === 5;
  })());
check('p5c: EXPOSE of a defined or imported variable is clean',
  (function () {
    const a = T.logicValidationReport('IMPORT %attack%\nSET test1 = attack\nEXPOSE %test1%', '%test1%', ['attack']);
    const b = T.logicValidationReport('IMPORT %attack%\nEXPOSE %attack%', '', ['attack']);
    return a.ok === true && a.errors.length === 0 && a.warnings.length === 0 &&
      b.ok === true && b.errors.length === 0 && b.warnings.length === 0;
  })());
check('p5c: EXPOSE checks defer while the script has parse errors',
  (function () {
    const r = T.logicValidationReport('SET a = 1\nBOGUS b\nEXPOSE %a%', '', []);
    const exposeErr = (r.errors || []).find((x) => x.kind === 'expose-undefined-variable');
    return r.ok === false && exposeErr === undefined &&
      (r.errors || []).some((x) => x.kind === 'unknown-keyword');
  })());
check('p5c: scriptGuaranteedNames intersects branches and keeps inputs',
  (function () {
    const g = T.scriptGuaranteedNames('IMPORT %a%\nSET b = 1\nIF a > 2 THEN:\n    SET c = 3', ['a']);
    return g.ok === true && g.guaranteed.has('a') === true && g.guaranteed.has('b') === true &&
      g.guaranteed.has('c') === false && g.parseErrors.length === 0;
  })());
check('p5c: scriptGuaranteedNames reports a parse failure without throwing',
  (function () {
    const g = T.scriptGuaranteedNames('BOGUS b', ['a']);
    return g.ok === false && g.guaranteed.has('a') === true && g.parseErrors.length === 1;
  })());
check('p5c: messageSegments flags every %varName% token',
  (function () {
    const s = T.messageSegments('EXPOSE: variable %test1% has no value', 'test1');
    return s.length === 3 && s[0].highlight === false && s[0].text === 'EXPOSE: variable ' &&
      s[1].highlight === true && s[1].text === '%test1%' &&
      s[2].highlight === false && s[2].text === ' has no value';
  })());
check('p5c: EXPOSE nested in an IF body of an undefined variable is an error',
  (function () {
    const r = T.logicValidationReport('IMPORT %a%\nIF a > 1 THEN:\n    EXPOSE %z%', '', ['a']);
    const e = (r.errors || []).find((x) => x.kind === 'expose-undefined-variable');
    return r.ok === false && e && e.varName === 'z' && e.line === 3;
  })());
check('p5c: EXPOSE nested in a SWITCH CASE of an undefined variable is an error',
  (function () {
    const r = T.logicValidationReport('IMPORT %k%\nSWITCH k:\n    CASE 1:\n        EXPOSE %z%', '', ['k']);
    const e = (r.errors || []).find((x) => x.kind === 'expose-undefined-variable');
    return r.ok === false && e && e.varName === 'z' && e.line === 4;
  })());
check('p5c: EXPOSE nested in a branch of a previously SET variable is clean',
  (function () {
    const r = T.logicValidationReport('SET z = 1\nIMPORT %a%\nIF a > 1 THEN:\n    EXPOSE %z%', '', ['a']);
    return r.ok === true && r.errors.length === 0 && r.warnings.length === 0;
  })());
check('p5c: EXPOSE before the SET is a warning (not guaranteed at that point)',
  (function () {
    const r = T.logicValidationReport('EXPOSE %x%\nSET x = 1', '', []);
    const w = (r.warnings || []).find((x) => x.kind === 'expose-branch-only-variable');
    return r.ok === true && r.errors.length === 0 && r.warnings.length === 1 &&
      w && w.varName === 'x' && w.line === 1;
  })());
check('p5c: EXPOSE in the ELSE branch of a then-branch variable is a warning',
  (function () {
    const r = T.logicValidationReport('IMPORT %a%\nIF a > 1 THEN:\n    SET z = 1\nELSE:\n    EXPOSE %z%', '', ['a']);
    const w = (r.warnings || []).find((x) => x.kind === 'expose-branch-only-variable');
    return r.ok === true && r.errors.length === 0 && w && w.varName === 'z' && w.line === 5;
  })());
check('p5c: messageSegments is a single plain segment without a match',
  (function () {
    const a = T.messageSegments('The code could not be parsed.', '');
    const b = T.messageSegments('no var here', 'test1');
    const c = T.messageSegments('a %x% b %x% c', 'x');
    return JSON.stringify(a) === '[{"text":"The code could not be parsed.","highlight":false}]' &&
      JSON.stringify(b) === '[{"text":"no var here","highlight":false}]' &&
      c.length === 5 && c[0].highlight === false && c[1].highlight === true &&
      c[2].highlight === false && c[3].highlight === true && c[4].highlight === false;
  })());

// ---- trace rows (traceRowOf) ----
check('p5b: traceRowOf renders SWITCH rows with per-CASE match details',
  (function () {
    const row = T.traceRowOf({
      step: 7, kind: 'switch', line: 3,
      subject: { type: 'string', value: 'red' },
      comparisons: [
        { clause: 'CASE "red"', value: { type: 'string', value: 'red' }, equal: true },
        { clause: 'CASE "blue"', value: { type: 'string', value: 'blue' }, equal: false },
      ],
      branch: 'red',
    });
    return row.title === 'SWITCH (line 3)' &&
      row.details[0] === 'subject = "red"' &&
      row.details[1] === 'CASE "red": "red" = "red" \u2192 match' &&
      row.details[2] === 'CASE "blue": "blue" \u2260 "red" \u2192 no match' &&
      row.details[3] === 'branch: red';
  })());
check('p5b: traceRowOf renders IMPORT/SET rows with values and roll detail',
  (function () {
    const imp = T.traceRowOf({ step: 1, kind: 'import', name: 'a', type: 'number', value: 5, source: 'test-input' });
    const set = T.traceRowOf({ step: 2, kind: 'set', name: 'd', type: 'number', value: 4, source: 'ROLL', roll: { token: '1d6', output: '4' } });
    return imp.title === 'IMPORT %a%' && imp.details[0] === 'a = 5  (number)' &&
      imp.details[1] === 'source: test input' &&
      set.title === 'SET d' && set.details[0] === 'd = 4  (number)' &&
      set.details.indexOf('rolled 1d6 \u2192 4') !== -1;
  })());
check('p5b: traceRowOf falls back to JSON for unknown kinds',
  (function () {
    const row = T.traceRowOf({ step: 1, kind: 'mystery' });
    return row.title === 'MYSTERY' && row.details.length === 1 && row.details[0].indexOf('mystery') !== -1;
  })());

// ---- template references (templateReferencedNames) ----
check('p5b: templateReferencedNames lists distinct names in first-appearance order',
  (function () {
    return JSON.stringify(T.templateReferencedNames('Total %a% then %b% then %a%')) === '["a","b"]' &&
      JSON.stringify(T.templateReferencedNames('% x % and %b%')) === '["x","b"]' &&
      JSON.stringify(T.templateReferencedNames('no refs here')) === '[]' &&
      JSON.stringify(T.templateReferencedNames(42)) === '[]';
  })());
check('p5b: literal spans never count as references',
  (function () {
    const names = T.templateReferencedNames('%% and %a-b% and %true% and %false%');
    return JSON.stringify(names) === '[]';
  })());
check('p5b: digit names are legal %...% references',
  (function () {
    return JSON.stringify(T.templateReferencedNames('%10% and % 10%')) === '["10"]';
  })());


// ------------------- per-generator mode ----------
// per-generator `mode: 'basic' | 'advanced'`, default 'basic'; switching
// modes preserves template/references/bindings; both modes share the same
// runGenerator. Example G: existing basic generators keep working without
// variable assignments, Logic operations, or scripting knowledge.
{
  const RG = T.runGenerator;

  const c1Weapons = {
    id: 'tbl_c1', name: 'Weapons',
    entries: [{ label: 'Sword', weight: 2 }, { label: 'Axe', weight: 1 }],
    file: 'tables/w.json',
  };
 // Legacy-shape item: no `mode` field at all (pre- stored generators).
  const c1Legacy = {
    id: 'g_c1', name: 'Legacy',
    template: 'You found [weapons] and |2d3| knives.', references: [],
  };
  const c1Roll = () => (container) => {
    const entries = Array.isArray(container && container.entries) ? container.entries : [];
    return entries.length ? entries[0] : null;
  };
  const c1Ctx = (draws) => {
    const seq = seqRng(draws);
    return {
      macros: [],
      evalExpr: (expr) => T.evaluate(expr, seq).value,
      rng: seq,
      containers: [],
      tableFile: 'gens/g.json',
    };
  };

  // Example G — a modeless legacy generator runs with no variables or ops.
  const noMode = RG(c1Legacy, [c1Weapons], c1Roll(), c1Ctx([0.5, 0.5]));
  check('c1 Example G: modeless legacy item runs (basic behavior)',
    noMode.ok === true && noMode.output === 'You found Sword and 4 knives.');

 // both modes share one runGenerator: an advanced-mode item with the
  // same template and draws yields a byte-identical result.
  const adv = Object.assign({}, c1Legacy, { mode: 'advanced' });
  const advRun = RG(adv, [c1Weapons], c1Roll(), c1Ctx([0.5, 0.5]));
  check('c1: advanced item runs identically through the shared engine',
    advRun.ok === true && advRun.output === noMode.output
      && JSON.stringify(advRun.rolls) === JSON.stringify(noMode.rolls));
  const basic = Object.assign({}, c1Legacy, { mode: 'basic' });
  checkEq('c1: explicit basic item runs identically',
    RG(basic, [c1Weapons], c1Roll(), c1Ctx([0.5, 0.5])).output, noMode.output);

  // Old generators default to basic on normalization (in place), and an
  // explicit advanced mode survives normalization with the ensured model
  // fields — a mode switch never touches template/references/bindings.
  const bare = { id: 'g_c1b', name: 'Bare', template: 'You found [weapons].', references: [] };
  const normR = T.normalizeGeneratorItem(bare, { macros: [] });
  check('c1: modeless item normalizes in place to basic',
    normR === bare && bare.mode === 'basic'
      && Array.isArray(bare.occurrences) && typeof bare.bindings === 'object');
  const advItem = {
    id: 'g_c1a', name: 'Adv', template: 'You found [weapons].', references: [],
    mode: 'advanced',
  };
  const normA = T.normalizeGeneratorItem(advItem, { macros: [] });
  check('c1: advanced mode kept on normalization with ensured fields',
    normA === advItem && advItem.mode === 'advanced'
      && Array.isArray(advItem.occurrences) && advItem.occurrences.length === 1
      && typeof advItem.bindings === 'object' && advItem.bindings !== null
      && Array.isArray(advItem.unresolvedBindings));

 // Literal preservation: an item with a stored binding flips to advanced
  // (the only field the editor toggle writes) and keeps its occurrences and
  // binding untouched.
  const swItem = {
    id: 'g_c1s', name: 'Sw', template: 'You found [weapons].', references: [],
    mode: 'basic',
  };
  T.normalizeGeneratorItem(swItem, { macros: [] });
  const swId = swItem.occurrences[0].instanceId;
  swItem.bindings[swId] = 'weaponVar';
  swItem.mode = 'advanced';
  const normS = T.normalizeGeneratorItem(swItem, { macros: [] });
  check('c1: mode flip to advanced preserves occurrences and bindings',
    normS === swItem && swItem.mode === 'advanced'
      && swItem.occurrences.length === 1
      && swItem.occurrences[0].instanceId === swId
      && swItem.bindings[swId] === 'weaponVar'
      && Object.keys(swItem.bindings).length === 1
      && swItem.unresolvedBindings.length === 0);
}


// ------------------- instance-ID bindings --------
// runGenerator produces per-occurrence results keyed by the item's
// stable instanceIds and applies item.bindings (instanceId -> variable
// name; absent = unexposed). Example C: editing or reordering the template
// must not silently redirect a binding to the other reference; ambiguous
// refs land in unresolvedBindings, never a silent redirect. Rows zip 1:1
// onto the consuming segments (ref/op/embed); a stale item (rows not
// lining up) applies no binding at all. State is seeded like the
// occurrence block and restored after the block.
const c2File = 'tables/c2-d2-test.json';
const c2Saved = {
  tables: T.state.tables,
  macros: T.state.macros,
  logicOps: T.state.logicOps,
  hadFile: T.state.files.has(c2File),
  file: T.state.files.get(c2File),
};
{
  const RG = T.runGenerator;
  const c2Weapons = {
    id: 'tbl_c2w', name: 'Weapons', file: c2File,
    entries: [{ label: 'Sword', weight: 2 }, { label: 'Axe', weight: 1 }],
  };
  const c2Food = {
    id: 'tbl_c2f', name: 'Food', file: c2File,
    entries: [{ label: 'Bread', weight: 2 }, { label: 'Cheese', weight: 1 }],
  };
  T.state.files.set(c2File, {
    text: '',
    parsed: { items: [ Object.assign({}, c2Weapons), Object.assign({}, c2Food) ] },
    error: null,
  });
  T.state.tables = [
    { file: c2File, index: 0, name: 'Weapons', entries: c2Weapons.entries },
    { file: c2File, index: 1, name: 'Food', entries: c2Food.entries },
  ];
  T.state.macros = [];
  T.state.logicOps = [
    { file: 'logic-ops/c2.json', index: 0, id: 'op_c2f1', name: 'Finder', purpose: '',
      script: 'SET x = ROLL ((1-6))', outputTemplate: '%x%', config: {} },
  ];
  const c2Containers = [ Object.assign({}, c2Weapons), Object.assign({}, c2Food) ];
  const c2Roll = (container) => {
    const entries = (container && Array.isArray(container.entries)) ? container.entries : [];
    return entries.length ? entries[0] : null;
  };
  const c2Ctx = (seq) => ({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seq).value,
    rng: seq,
    containers: c2Containers,
    operations: T.state.logicOps,
    tableFile: 'c2/c2.json',
  });

  // T1 — a bound run exposes the per-instance values.
  const c2Item1 = { id: 'gen_c2a', name: 'C2A', template: 'You found [Weapons] and [Food].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item1, { macros: [] });
  const c2IdW1 = c2Item1.occurrences[0].instanceId;
  const c2IdF1 = c2Item1.occurrences[1].instanceId;
  c2Item1.bindings[c2IdW1] = 'weapon';
  c2Item1.bindings[c2IdF1] = 'food';
  const c2Run1 = RG(c2Item1, c2Containers, c2Roll, c2Ctx(seqRng([0.5, 0.5])));
  check('c2 T1: bound run ok with template output',
    c2Run1.ok === true && c2Run1.output === 'You found Sword and Bread.');
  check('c2 T1: occurrenceResults carries one row per instanceId',
    Object.keys(c2Run1.occurrenceResults).length === 2
      && c2Run1.occurrenceResults[c2IdW1].kind === 'ref'
      && c2Run1.occurrenceResults[c2IdW1].token === 'Weapons'
      && c2Run1.occurrenceResults[c2IdW1].refId === 'tbl_c2w'
      && c2Run1.occurrenceResults[c2IdW1].value === 'Sword'
      && c2Run1.occurrenceResults[c2IdF1].token === 'Food'
      && c2Run1.occurrenceResults[c2IdF1].refId === 'tbl_c2f'
      && c2Run1.occurrenceResults[c2IdF1].value === 'Bread');
  check('c2 T1: exposed applies the bindings and nothing else',
    c2Run1.exposed.weapon === 'Sword' && c2Run1.exposed.food === 'Bread'
      && Object.keys(c2Run1.exposed).length === 2);

  // T2 — the same template unbound exposes nothing.
  const c2Item2 = { id: 'gen_c2b', name: 'C2B', template: 'You found [Weapons] and [Food].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item2, { macros: [] });
  const c2Run2 = RG(c2Item2, c2Containers, c2Roll, c2Ctx(seqRng([0.5, 0.5])));
  check('c2 T2: unbound run still resolves both refs',
    c2Run2.ok === true && c2Run2.output === 'You found Sword and Bread.'
      && Object.keys(c2Run2.occurrenceResults).length === 2);
  check('c2 T2: no bindings means exposed stays empty',
    Object.keys(c2Run2.exposed).length === 0);

  // T3 — Example C: reordering the template keeps every binding on the same
  // reference (the instanceIds travel with their rows).
  c2Item1.template = 'You found [Food] and [Weapons].';
  T.normalizeGeneratorItem(c2Item1, { macros: [] });
  check('c2 Example C: reorder keeps both instanceIds and their bindings',
    c2Item1.occurrences.length === 2
      && c2Item1.occurrences[0].token === 'Food'
      && c2Item1.occurrences[0].instanceId === c2IdF1
      && c2Item1.occurrences[1].token === 'Weapons'
      && c2Item1.occurrences[1].instanceId === c2IdW1
      && c2Item1.bindings[c2IdW1] === 'weapon'
      && c2Item1.bindings[c2IdF1] === 'food'
      && c2Item1.unresolvedBindings.length === 0);
  const c2Run3 = RG(c2Item1, c2Containers, c2Roll, c2Ctx(seqRng([0.5, 0.5])));
  check('c2 Example C: reordered run keeps values on the right references',
    c2Run3.ok === true && c2Run3.output === 'You found Bread and Sword.'
      && c2Run3.exposed.weapon === 'Sword' && c2Run3.exposed.food === 'Bread');
  check('c2 Example C: occurrenceResults follow the instanceIds after reorder',
    c2Run3.occurrenceResults[c2IdW1].value === 'Sword'
      && c2Run3.occurrenceResults[c2IdF1].value === 'Bread');

  // T4 — two same-key rows that no longer line up by offset are ambiguous:
  // fresh ids, the old bindings land in unresolvedBindings, no silent
  // redirect.
  const c2Item4 = { id: 'gen_c2c', name: 'C2C', template: 'A [Weapons] [Weapons]', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item4, { macros: [] });
  const c2Id4a = c2Item4.occurrences[0].instanceId;
  const c2Id4b = c2Item4.occurrences[1].instanceId;
  c2Item4.bindings[c2Id4a] = 'first';
  c2Item4.bindings[c2Id4b] = 'second';
  c2Item4.template = 'ABC [Weapons][Weapons]';
  T.normalizeGeneratorItem(c2Item4, { macros: [] });
  check('c2 T4: ambiguous same-key rows get fresh ids',
    c2Item4.occurrences.length === 2
      && c2Item4.occurrences[0].instanceId !== c2Id4a
      && c2Item4.occurrences[1].instanceId !== c2Id4b
      && c2Item4.occurrences[0].instanceId !== c2Item4.occurrences[1].instanceId);
  check('c2 T4: both old bindings are unresolved-ambiguous, in order',
    c2Item4.unresolvedBindings.length === 2
      && c2Item4.unresolvedBindings[0].varName === 'first'
      && c2Item4.unresolvedBindings[0].reason === 'occurrence-ambiguous'
      && c2Item4.unresolvedBindings[1].varName === 'second'
      && c2Item4.unresolvedBindings[1].reason === 'occurrence-ambiguous'
      && Object.keys(c2Item4.bindings).length === 0);
  const c2Run4 = RG(c2Item4, c2Containers, c2Roll, c2Ctx(seqRng([0.5, 0.5, 0.5])));
  check('c2 T4: ambiguous run still resolves, exposes nothing',
    c2Run4.ok === true && c2Run4.output === 'ABC SwordSword'
      && Object.keys(c2Run4.exposed).length === 0
      && Object.keys(c2Run4.occurrenceResults).length === 2);

  // T4b — same-key rows that DO keep their offsets stay resolvable by the
  // offset tiebreak: ids and bindings survive.
  const c2Item4b = { id: 'gen_c2c2', name: 'C2C2', template: 'A [Weapons] [Weapons]', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item4b, { macros: [] });
  const c2Id4ba = c2Item4b.occurrences[0].instanceId;
  const c2Id4bb = c2Item4b.occurrences[1].instanceId;
  c2Item4b.bindings[c2Id4ba] = 'first';
  c2Item4b.bindings[c2Id4bb] = 'second';
  c2Item4b.template = 'A [Weapons] [Weapons]!';
  T.normalizeGeneratorItem(c2Item4b, { macros: [] });
  check('c2 T4b: same-key rows that keep their offsets keep ids (offset tiebreak)',
    c2Item4b.occurrences.length === 2
      && c2Item4b.occurrences[0].instanceId === c2Id4ba
      && c2Item4b.occurrences[1].instanceId === c2Id4bb
      && c2Item4b.bindings[c2Id4ba] === 'first'
      && c2Item4b.bindings[c2Id4bb] === 'second'
      && c2Item4b.unresolvedBindings.length === 0);

 // T4c — Example C: two identical [weapon] refs in one template.
  // First ref -> `weapon`, second ref -> `companion_weapon`. Each ref
  // resolves independently, Logic can explicitly import either variable,
  // and editing/reordering must not silently redirect a binding to the
  // other reference.
  const c2IdxC = T.state.files.get(c2File).parsed.items.length;
  const c2WeaponC = {
    id: 'tbl_c2wc', name: 'Weapon', file: c2File,
    entries: [{ label: 'Sword', weight: 2 }, { label: 'Axe', weight: 1 }],
  };
  T.state.files.get(c2File).parsed.items.push(Object.assign({}, c2WeaponC));
  T.state.tables.push({ file: c2File, index: c2IdxC, name: 'Weapon', entries: c2WeaponC.entries });
  const c2ItemC = { id: 'gen_c2x', name: 'C2X', template: 'You found a [weapon], and your companion found a [weapon].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2ItemC, { macros: [] });
  const c2IdC1 = c2ItemC.occurrences[0].instanceId;
  const c2IdC2 = c2ItemC.occurrences[1].instanceId;
  c2ItemC.bindings[c2IdC1] = 'weapon';
  c2ItemC.bindings[c2IdC2] = 'companion_weapon';
  check('c2 Example C: two same-token refs are same-key rows on one container, each bound',
    c2ItemC.occurrences.length === 2
      && c2ItemC.occurrences[0].kind === 'ref' && c2ItemC.occurrences[1].kind === 'ref'
      && c2ItemC.occurrences[0].token === 'weapon' && c2ItemC.occurrences[1].token === 'weapon'
      && c2ItemC.occurrences[0].refId === 'tbl_c2wc' && c2ItemC.occurrences[1].refId === 'tbl_c2wc'
      && c2ItemC.occurrences[0].instanceId !== c2ItemC.occurrences[1].instanceId
      && c2ItemC.bindings[c2IdC1] === 'weapon'
      && c2ItemC.bindings[c2IdC2] === 'companion_weapon');
  let c2DrawC = 0;
  const c2RollC = (container) => {
    const entries = (container && Array.isArray(container.entries)) ? container.entries : [];
    c2DrawC += 1;
    return entries.length ? entries[(c2DrawC - 1) % entries.length] : null;
  };
  const c2RunC1 = RG(c2ItemC, [c2WeaponC], c2RollC,
    Object.assign(c2Ctx(seqRng([0.5, 0.5])), { containers: [c2WeaponC] }));
  check('c2 Example C: both refs roll independently, first -> Sword, second -> Axe',
    c2RunC1.ok === true
      && c2RunC1.output === 'You found a Sword, and your companion found a Axe.'
      && c2RunC1.rolls.length === 2
      && c2RunC1.rolls[0].entry.label === 'Sword'
      && c2RunC1.rolls[1].entry.label === 'Axe');
  check('c2 Example C: exposed carries weapon and companion_weapon separately',
    c2RunC1.exposed.weapon === 'Sword'
      && c2RunC1.exposed.companion_weapon === 'Axe'
      && Object.keys(c2RunC1.exposed).length === 2);
  const c2ItemC2 = { id: 'gen_c2y', name: 'C2Y', template: 'You found a [weapon], and your companion found a [weapon]. {Mine} {Theirs}', references: [], operations: [] };
  T.normalizeGeneratorItem(c2ItemC2, { macros: [] });
  const c2RefsC2 = c2ItemC2.occurrences.filter((o) => o.kind === 'ref');
  c2ItemC2.bindings[c2RefsC2[0].instanceId] = 'weapon';
  c2ItemC2.bindings[c2RefsC2[1].instanceId] = 'companion_weapon';
  const c2OpMine = { id: 'op_c2mine', name: 'Mine', purpose: '',
    script: 'IMPORT %weapon%\nIF weapon == "Sword" THEN:\n    SET tag = "Sword-bearer"\nELSE:\n    SET tag = "Axe-bearer"',
    outputTemplate: '%tag%' };
  const c2OpTheirs = { id: 'op_c2theirs', name: 'Theirs', purpose: '',
    script: 'IMPORT %companion_weapon%\nIF companion_weapon == "Axe" THEN:\n    SET tag = "Axe-bearer"\nELSE:\n    SET tag = "Sword-bearer"',
    outputTemplate: '%tag%' };
  const c2RunC2 = RG(c2ItemC2, [c2WeaponC], c2RollC,
    Object.assign(c2Ctx(seqRng([0.5, 0.5])), { containers: [c2WeaponC], operations: [c2OpMine, c2OpTheirs] }));
  check('c2 Example C: Logic can explicitly import either variable',
    c2RunC2.ok === true
      && c2RunC2.output === 'You found a Sword, and your companion found a Axe. Sword-bearer Axe-bearer'
      && c2RunC2.exposed.weapon === 'Sword'
      && c2RunC2.exposed.companion_weapon === 'Axe'
      && Object.keys(c2RunC2.exposed).length === 2);
  // Reorder: swap the two clauses. The second ref keeps its offset (49) and
  // keeps its binding; the first ref has no shared offset left, so its
  // binding is reported ambiguous — never silently redirected to the other
  // reference.
  c2ItemC.template = 'Your companion found a [weapon], and you found a [weapon].';
  T.normalizeGeneratorItem(c2ItemC, { macros: [] });
  check('c2 Example C: a reorder never silently redirects a binding to the other ref',
    c2ItemC.occurrences.length === 2
      && c2ItemC.occurrences[0].instanceId !== c2IdC1
      && c2ItemC.occurrences[1].instanceId === c2IdC2
      && c2ItemC.bindings[c2IdC2] === 'companion_weapon'
      && Object.keys(c2ItemC.bindings).length === 1
      && c2ItemC.unresolvedBindings.length === 1
      && c2ItemC.unresolvedBindings[0].varName === 'weapon'
      && c2ItemC.unresolvedBindings[0].reason === 'occurrence-ambiguous');
  const c2RunC3 = RG(c2ItemC, [c2WeaponC], c2RollC,
    Object.assign(c2Ctx(seqRng([0.5, 0.5])), { containers: [c2WeaponC] }));
  check('c2 Example C: the reordered run keeps the surviving binding on its own ref',
    c2RunC3.ok === true
      && c2RunC3.output === 'Your companion found a Sword, and you found a Axe.'
      && c2RunC3.exposed.companion_weapon === 'Axe'
      && Object.keys(c2RunC3.exposed).length === 1
      && c2RunC3.occurrenceResults[c2IdC2].value === 'Axe');

  // T5 — container rename: the row keeps its id through the rename and the
  // binding still exposes the same entry.
  const c2Item5 = { id: 'gen_c2d', name: 'C2D', template: 'You found [Weapons].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item5, { macros: [] });
  const c2Id5 = c2Item5.occurrences[0].instanceId;
  c2Item5.bindings[c2Id5] = 'weapon';
  // The rename cascade without persistence/toast: state rows, the stored
  // ref token, the template, and the occurrence rows via the pure helper.
  T.state.tables[0].name = 'Swords';
  T.state.files.get(c2File).parsed.items[0].name = 'Swords';
  const c2Ref5 = c2Item5.references.find((r) => r && r.containerId === 'tbl_c2w');
  if (c2Ref5) c2Ref5.token = 'Swords';
  c2Item5.template = 'You found [Swords].';
  T.applyContainerRenameToOccurrences(c2Item5.occurrences, 'tbl_c2w', 'Weapons', 'Swords', true);
  T.normalizeGeneratorItem(c2Item5, { macros: [] });
  check('c2 T5: container rename keeps the occurrence id and refId',
    c2Item5.occurrences.length === 1
      && c2Item5.occurrences[0].instanceId === c2Id5
      && c2Item5.occurrences[0].token === 'Swords'
      && c2Item5.occurrences[0].refId === 'tbl_c2w'
      && c2Item5.bindings[c2Id5] === 'weapon');
  const c2Swords = Object.assign({}, c2Weapons, { name: 'Swords' });
  const c2Run5 = RG(c2Item5, [c2Swords, c2Food], c2Roll, c2Ctx(seqRng([0.5])));
  check('c2 T5: renamed container still exposes the bound value',
    c2Run5.ok === true && c2Run5.output === 'You found Sword.'
      && c2Run5.exposed.weapon === 'Sword');

  // T6 — operation rename: the row keeps its id and the stored op ref.
  const c2Item6 = { id: 'gen_c2e', name: 'C2E', template: '{Finder}', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item6, { macros: [] });
  const c2Id6 = c2Item6.occurrences[0].instanceId;
  c2Item6.bindings[c2Id6] = 'finder';
  T.state.logicOps[0].name = 'Seeker';
  const c2OpRef6 = c2Item6.operations.find((r) => r && r.operationId === 'op_c2f1');
  if (c2OpRef6) c2OpRef6.token = 'Seeker';
  c2Item6.template = '{Seeker}';
  const c2Resolved6 = c2Item6.operations.find((r) => r && r.operationId === 'op_c2f1') || null;
  T.applyOpRenameToOccurrences(c2Item6.occurrences, 'op_c2f1', ['finder'], 'Seeker', c2Resolved6);
  T.normalizeGeneratorItem(c2Item6, { macros: [] });
  check('c2 T6: op rename keeps the occurrence id and operationId',
    c2Item6.occurrences.length === 1
      && c2Item6.occurrences[0].instanceId === c2Id6
      && c2Item6.occurrences[0].kind === 'op'
      && c2Item6.occurrences[0].token === 'Seeker'
      && c2Item6.occurrences[0].refId === 'op_c2f1'
      && c2Item6.bindings[c2Id6] === 'finder');

  // T7 — the renamed op span executes and its bound variable carries its
  // own output.
  const c2Run7 = RG(c2Item6, c2Containers, c2Roll, c2Ctx(seqRng([0.5, 0.5])));
  check('c2 T7: bound op span exposes its own output',
    c2Run7.ok === true
      && c2Run7.exposed.finder === c2Run7.output
      && c2Run7.occurrenceResults[c2Id6].value === c2Run7.output
      && Object.keys(c2Run7.exposed).length === 1);

  // T8 — legacy items (no occurrences) run exactly as before, in both call
  // shapes; a dangling instanceId in bindings is ignored.
  const c2Legacy = { id: 'gen_c2f', name: 'C2F', template: 'You found [weapons].', references: [] };
  const c2Run8a = RG(c2Legacy, c2Containers, c2Roll, c2Ctx(seqRng([0.5])));
  check('c2 T8: modeless item without occurrences runs unchanged (4-arg)',
    c2Run8a.ok === true && c2Run8a.output === 'You found Sword.'
      && Object.keys(c2Run8a.exposed).length === 0
      && Object.keys(c2Run8a.occurrenceResults).length === 0);
  const c2Run8b = RG(c2Legacy, c2Containers, c2Roll);
  check('c2 T8: 3-argument run unchanged',
    c2Run8b.ok === true && c2Run8b.output === 'You found Sword.'
      && Object.keys(c2Run8b.exposed).length === 0);
  const c2Dangling = { id: 'gen_c2g', name: 'C2G', template: 'You found [weapons].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Dangling, { macros: [] });
  c2Dangling.bindings['occ_deadbeef'] = 'ghost';
  const c2Run8c = RG(c2Dangling, c2Containers, c2Roll, c2Ctx(seqRng([0.5])));
  check('c2 T8: dangling instanceId in bindings is ignored',
    c2Run8c.ok === true && c2Run8c.output === 'You found Sword.'
      && Object.keys(c2Run8c.exposed).length === 0);

  // T9 — a duplicated variable name is last-write-wins in template order.
  let c2Draw = 0;
  const c2Roll2 = (container) => {
    const entries = (container && Array.isArray(container.entries)) ? container.entries : [];
    c2Draw += 1;
    return entries.length ? entries[(c2Draw - 1) % entries.length] : null;
  };
  const c2Item9 = { id: 'gen_c2h', name: 'C2H', template: 'First [Food] then [Food].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item9, { macros: [] });
  c2Item9.bindings[c2Item9.occurrences[0].instanceId] = 'loot';
  c2Item9.bindings[c2Item9.occurrences[1].instanceId] = 'loot';
  const c2Run9 = RG(c2Item9, c2Containers, c2Roll2, c2Ctx(seqRng([0.5, 0.5])));
  check('c2 T9: both rows resolve, second span rolls the other entry',
    c2Run9.ok === true && c2Run9.output === 'First Bread then Cheese.');
  check('c2 T9: duplicated variable name is last-write-wins',
    c2Run9.exposed.loot === 'Cheese' && Object.keys(c2Run9.exposed).length === 1);

  // T10 — a stale item (rows not lining up 1:1 with the consuming segments)
  // applies no binding at all, rather than pointing at the wrong span.
  const c2Item10 = { id: 'gen_c2i', name: 'C2I', template: 'You found [Weapons].', references: [], operations: [] };
  T.normalizeGeneratorItem(c2Item10, { macros: [] });
  const c2Id10 = c2Item10.occurrences[0].instanceId;
  c2Item10.bindings[c2Id10] = 'weapon';
  c2Item10.occurrences.push({ instanceId: 'occ_c2stale', kind: 'op', token: 'Ghost', refId: null, offset: 99 });
  const c2Run10a = RG(c2Item10, c2Containers, c2Roll, c2Ctx(seqRng([0.5])));
  check('c2 T10: count-mismatched rows are stale — run ok, no binding',
    c2Run10a.ok === true && c2Run10a.output === 'You found Sword.'
      && Object.keys(c2Run10a.exposed).length === 0
      && Object.keys(c2Run10a.occurrenceResults).length === 0);
  c2Item10.occurrences = [{ instanceId: c2Id10, kind: 'op', token: 'Weapons', refId: 'tbl_c2w', offset: 10 }];
  const c2Run10b = RG(c2Item10, c2Containers, c2Roll, c2Ctx(seqRng([0.5])));
  check('c2 T10: kind-mismatched row is stale — run ok, no binding',
    c2Run10b.ok === true && c2Run10b.output === 'You found Sword.'
      && Object.keys(c2Run10b.exposed).length === 0);

  // Pure helper behavior (the rename paths themselves need DOM/storage).
  const c2RowsH = [
    { instanceId: 'occ_h1', kind: 'ref', token: 'Weapons', refId: 'tbl_c2w', offset: 2 },
    { instanceId: 'occ_h2', kind: 'ref', token: 'weapons', refId: null, offset: 9 },
    { instanceId: 'occ_h3', kind: 'ref', token: 'Food', refId: 'tbl_c2f', offset: 15 },
    { instanceId: 'occ_h4', kind: 'op', token: 'Weapons', refId: null, offset: 21 },
  ];
  T.applyContainerRenameToOccurrences(c2RowsH, 'tbl_c2w', 'Weapons', 'Swords', true);
  check('c2 helper: container rename follows ids, resolves old-token rows when unique',
    T.applyContainerRenameToOccurrences(c2RowsH, 'tbl_c2w', 'Weapons', 'Swords', true) === c2RowsH
      && c2RowsH[0].token === 'Swords' && c2RowsH[0].refId === 'tbl_c2w'
      && c2RowsH[1].token === 'Swords' && c2RowsH[1].refId === 'tbl_c2w'
      && c2RowsH[2].token === 'Food' && c2RowsH[2].refId === 'tbl_c2f'
      && c2RowsH[3].token === 'Weapons' && c2RowsH[3].refId === null);
  const c2RowsH2 = [{ instanceId: 'occ_h5', kind: 'ref', token: 'Weapons', refId: null, offset: 2 }];
  T.applyContainerRenameToOccurrences(c2RowsH2, 'tbl_c2w', 'Weapons', 'Swords', false);
  check('c2 helper: ambiguous new name leaves old-token rows unresolved',
    c2RowsH2[0].token === 'Swords' && c2RowsH2[0].refId === null);
  const c2RowsO = [
    { instanceId: 'occ_o1', kind: 'op', token: 'Finder', refId: 'op_c2f1', offset: 0 },
    { instanceId: 'occ_o2', kind: 'op', token: 'finder', refId: null, offset: 9 },
    { instanceId: 'occ_o3', kind: 'op', token: 'Ghost', refId: null, offset: 15 },
    { instanceId: 'occ_o4', kind: 'ref', token: 'Finder', refId: null, offset: 21 },
  ];
  T.applyOpRenameToOccurrences(c2RowsO, 'op_c2f1', ['finder'], 'Seeker', { token: 'Seeker', operationId: 'op_c2f1' });
  check('c2 helper: op rename follows ids, gains id for old-token rows when resolved',
    c2RowsO[0].token === 'Seeker' && c2RowsO[0].refId === 'op_c2f1'
      && c2RowsO[1].token === 'Seeker' && c2RowsO[1].refId === 'op_c2f1'
      && c2RowsO[2].token === 'Ghost' && c2RowsO[2].refId === null
      && c2RowsO[3].token === 'Finder' && c2RowsO[3].refId === null);
  const c2RowsO2 = [{ instanceId: 'occ_o5', kind: 'op', token: 'Finder', refId: null, offset: 0 }];
  T.applyOpRenameToOccurrences(c2RowsO2, 'op_c2f1', ['finder'], 'Seeker', null);
  check('c2 helper: unresolvable op rename leaves old-token rows without an id',
    c2RowsO2[0].token === 'Seeker' && c2RowsO2[0].refId === null);
}

// Restore the state seeded above.
T.state.tables = c2Saved.tables;
T.state.macros = c2Saved.macros;
T.state.logicOps = c2Saved.logicOps;
if (c2Saved.hadFile) { T.state.files.set(c2File, c2Saved.file); } else { T.state.files.delete(c2File); }


// ------------------- inline ((...)) binding ----
// inline ((X|Y|Z)) choices (string) and ((15-20)) ranges (number) are
// binding-eligible occurrences, each with its own stable instance ID; nested
// occurrences keep separate IDs; formatting-only / no-result spans (plain
// text, unrolled dice text, empty, reversed ranges) carry no identity.
// Rows zip 1:1 onto the consuming segments alongside ref/op/embed, and a
// stale item still applies no binding to the wrong span. State is seeded
// like the earlier bindings block and restored after the block.
const c3File = 'tables/c3-d20-test.json';
const c3Saved = {
  tables: T.state.tables,
  macros: T.state.macros,
  logicOps: T.state.logicOps,
  hadFile: T.state.files.has(c3File),
  file: T.state.files.get(c3File),
};
{
  const RG = T.runGenerator;
  // A container whose entry label carries a nested inline span: the
  // existing container-branch recursion resolves it as part of the
 // container result (: eligible "provided the existing execution
  // architecture can resolve them safely").
  const c3Weapons = {
    id: 'tbl_c3w', name: 'Weapons', file: c3File,
    entries: [{ label: 'Sword ((7-9))', weight: 1 }],
  };
  T.state.files.set(c3File, {
    text: '',
    parsed: { items: [ Object.assign({}, c3Weapons) ] },
    error: null,
  });
  T.state.tables = [
    { file: c3File, index: 0, name: 'Weapons', entries: c3Weapons.entries },
  ];
  T.state.macros = [];
  T.state.logicOps = [];
  const c3Containers = [ Object.assign({}, c3Weapons) ];
  const c3Roll = (container) => {
    const entries = (container && Array.isArray(container.entries)) ? container.entries : [];
    return entries.length ? entries[0] : null;
  };
  const c3Ctx = (seq) => ({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seq).value,
    rng: seq,
    containers: c3Containers,
    operations: T.state.logicOps,
    tableFile: 'c3/c3.json',
  });

 // classifyInline — the static eligibility classifier.
  check('c3 classify: choice / range / text / empty / reversed / divergent',
    T.classifyInline('Gold | Silver') === 'choice'
      && T.classifyInline('Gold | Silver:2') === 'choice'
      && T.classifyInline('15-20') === 'range'
      && T.classifyInline(' 15 - 20 ') === 'range'
      && T.classifyInline('-5-+9') === 'range'
      && T.classifyInline('20-15') === 'text'
      && T.classifyInline('just text') === 'text'
      && T.classifyInline('1d6') === 'text'
      && T.classifyInline('15-') === 'text'
      && T.classifyInline('Only:3') === 'text'
      && T.classifyInline('') === ''
      && T.classifyInline(' ') === ''
      && T.classifyInline(null) === '');

  // T1 — a bound choice span exposes the picked label (a string).
  const c3Item1 = { id: 'gen_c3a', name: 'C3A', template: 'You find ((Gold | Silver | Bronze)).', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item1, { macros: [] });
  check('c3 T1: one inline row for the choice span',
    c3Item1.occurrences.length === 1
      && c3Item1.occurrences[0].kind === 'inline'
      && c3Item1.occurrences[0].token === 'Gold | Silver | Bronze'
      && c3Item1.occurrences[0].refId === null);
  const c3Id1 = c3Item1.occurrences[0].instanceId;
  c3Item1.bindings[c3Id1] = 'metal';
  const c3Run1 = RG(c3Item1, c3Containers, c3Roll, c3Ctx(seqRng([0.5])));
  check('c3 T1: bound run ok with the picked label',
    c3Run1.ok === true && c3Run1.output === 'You find Silver.');
  check('c3 T1: occurrenceResults carries the inline row with a string value',
    c3Run1.occurrenceResults[c3Id1].kind === 'inline'
      && c3Run1.occurrenceResults[c3Id1].token === 'Gold | Silver | Bronze'
      && c3Run1.occurrenceResults[c3Id1].refId === null
      && c3Run1.occurrenceResults[c3Id1].value === 'Silver'
      && typeof c3Run1.occurrenceResults[c3Id1].value === 'string');
  check('c3 T1: exposed carries the bound choice label',
    c3Run1.exposed.metal === 'Silver' && Object.keys(c3Run1.exposed).length === 1);

  // T2 — a bound range span exposes the drawn number.
  const c3Item2 = { id: 'gen_c3b', name: 'C3B', template: 'Roll ((15-20)).', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item2, { macros: [] });
  check('c3 T2: one inline row for the range span',
    c3Item2.occurrences.length === 1
      && c3Item2.occurrences[0].kind === 'inline'
      && c3Item2.occurrences[0].token === '15-20'
      && c3Item2.occurrences[0].refId === null);
  const c3Id2 = c3Item2.occurrences[0].instanceId;
  c3Item2.bindings[c3Id2] = 'roll';
  const c3Run2 = RG(c3Item2, c3Containers, c3Roll, c3Ctx(seqRng([0.5])));
  check('c3 T2: bound run ok with the drawn number',
    c3Run2.ok === true && c3Run2.output === 'Roll 18.');
  check('c3 T2: the range value is a number, not a string',
    typeof c3Run2.occurrenceResults[c3Id2].value === 'number'
      && c3Run2.occurrenceResults[c3Id2].value === 18);
  check('c3 T2: exposed carries the bound range number',
    typeof c3Run2.exposed.roll === 'number' && c3Run2.exposed.roll === 18
      && Object.keys(c3Run2.exposed).length === 1);

  // T3 — a weighted choice still exposes the label only, never the weight.
  const c3Item3 = { id: 'gen_c3c', name: 'C3C', template: 'Tier ((Gold | Silver:2 | Bronze:3)).', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item3, { macros: [] });
  const c3Id3 = c3Item3.occurrences[0].instanceId;
  c3Item3.bindings[c3Id3] = 'tier';
  const c3Run3 = RG(c3Item3, c3Containers, c3Roll, c3Ctx(seqRng([0.5])));
  check('c3 T3: weighted choice exposes the label only',
    c3Run3.ok === true && c3Run3.output === 'Tier Bronze.'
      && c3Run3.exposed.tier === 'Bronze');

  // T4 — the ref and both inline spans each keep their own stable ID; the
  // nested inline in the container entry label resolves inside the
  // container result without stealing any template identity.
  const c3Item4 = { id: 'gen_c3d', name: 'C3D', template: 'You found [Weapons] with ((Gold | Silver)) and ((15-20)).', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item4, { macros: [] });
  check('c3 T4: ref and both inline spans each carry their own row and ID',
    c3Item4.occurrences.length === 3
      && c3Item4.occurrences[0].kind === 'ref'
      && c3Item4.occurrences[1].kind === 'inline'
      && c3Item4.occurrences[2].kind === 'inline'
      && c3Item4.occurrences[0].instanceId !== c3Item4.occurrences[1].instanceId
      && c3Item4.occurrences[1].instanceId !== c3Item4.occurrences[2].instanceId
      && c3Item4.occurrences[0].instanceId !== c3Item4.occurrences[2].instanceId);
  const c3Id4R = c3Item4.occurrences[0].instanceId;
  const c3Id4C = c3Item4.occurrences[1].instanceId;
  const c3Id4G = c3Item4.occurrences[2].instanceId;
  c3Item4.bindings[c3Id4C] = 'color';
  c3Item4.bindings[c3Id4G] = 'gloss';
  const c3Run4 = RG(c3Item4, c3Containers, c3Roll, c3Ctx(seqRng([0.5, 0.5, 0.5])));
  check('c3 T4: nested entry-label inline resolves inside the container result',
    c3Run4.ok === true && c3Run4.output === 'You found Sword 8 with Silver and 18.'
      && c3Run4.occurrenceResults[c3Id4R].value === 'Sword 8');
  check('c3 T4: the nested inline adds no extra template occurrence',
    Object.keys(c3Run4.occurrenceResults).length === 3);
  check('c3 T4: both bound inline spans expose their own values',
    c3Run4.exposed.color === 'Silver'
      && typeof c3Run4.exposed.gloss === 'number' && c3Run4.exposed.gloss === 18
      && Object.keys(c3Run4.exposed).length === 2);

  // T5 — template edits keep the inline IDs (and their bindings) stable.
  const c3Item5 = { id: 'gen_c3e', name: 'C3E', template: 'A ((15-20)) B ((Gold | Silver)) C', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item5, { macros: [] });
  const c3Id5R = c3Item5.occurrences[0].instanceId;
  const c3Id5C = c3Item5.occurrences[1].instanceId;
  c3Item5.bindings[c3Id5R] = 'roll';
  c3Item5.bindings[c3Id5C] = 'color';
  check('c3 T5: initial rows in template order',
    c3Item5.occurrences[0].token === '15-20'
      && c3Item5.occurrences[1].token === 'Gold | Silver');
  c3Item5.template = 'A ((Gold | Silver)) B ((15-20)) C';
  T.normalizeGeneratorItem(c3Item5, { macros: [] });
  check('c3 T5: reorder keeps both inline IDs and their bindings',
    c3Item5.occurrences.length === 2
      && c3Item5.occurrences[0].instanceId === c3Id5C
      && c3Item5.occurrences[1].instanceId === c3Id5R
      && c3Item5.bindings[c3Id5C] === 'color'
      && c3Item5.bindings[c3Id5R] === 'roll'
      && c3Item5.unresolvedBindings.length === 0);
  const c3Run5 = RG(c3Item5, c3Containers, c3Roll, c3Ctx(seqRng([0.5, 0.5])));
  check('c3 T5: reordered run exposes each ID its own value',
    c3Run5.ok === true && c3Run5.output === 'A Silver B 18 C'
      && c3Run5.exposed.color === 'Silver'
      && c3Run5.occurrenceResults[c3Id5R].value === 18
      && c3Run5.occurrenceResults[c3Id5C].value === 'Silver');

  // T6 — formatting-only and no-result inline spans are not eligible.
  const c3Item6 = { id: 'gen_c3f', name: 'C3F', template: 'Plain ((just text)) and dice ((1d6)).', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item6, { macros: [] });
  check('c3 T6: no identity for formatting-only inline spans',
    c3Item6.occurrences.length === 0);
  const c3Run6 = RG(c3Item6, c3Containers, c3Roll, c3Ctx(seqRng([0.5])));
  check('c3 T6: formatting spans still emit verbatim text and expose nothing',
    c3Run6.ok === true && c3Run6.output === 'Plain just text and dice 1d6.'
      && Object.keys(c3Run6.exposed).length === 0);

  const c3Item6b = { id: 'gen_c3g', name: 'C3G', template: 'Bad (( )) and ((A:two | B)).', references: [], operations: [] };
  T.normalizeGeneratorItem(c3Item6b, { macros: [] });
  check('c3 T6b: empty and malformed-choice spans resolve to no result',
    c3Item6b.occurrences.length === 1
      && c3Item6b.occurrences[0].token === 'A:two | B');
  c3Item6b.bindings[c3Item6b.occurrences[0].instanceId] = 'x';
  const c3Run6b = RG(c3Item6b, c3Containers, c3Roll, c3Ctx(seqRng([0.5])));
  check('c3 T6b: no-result spans fail the run and expose nothing even when bound',
    c3Run6b.ok === false
      && c3Run6b.errors.length === 2
      && c3Run6b.errors.every((e) => e.kind === 'malformed')
      && Object.keys(c3Run6b.occurrenceResults).length === 0
      && Object.keys(c3Run6b.exposed).length === 0);

  // T7 — a stale item (pre-inline rows, no inline row) still runs ok but never
  // applies a binding to the wrong span.
  const c3Item7 = {
    id: 'gen_c3h', name: 'C3H',
    template: 'A ((Gold | Silver)) B',
    occurrences: [{ instanceId: 'occ_c3stale', kind: 'ref', token: 'Weapons', refId: 'tbl_c3w', offset: 2 }],
    bindings: { occ_c3stale: 'weapon' },
    references: [], operations: [],
  };
  const c3Run7 = RG(c3Item7, c3Containers, c3Roll, c3Ctx(seqRng([0.5])));
  check('c3 T7: stale rows apply no binding, the run stays ok',
    c3Run7.ok === true && c3Run7.output === 'A Silver B'
      && Object.keys(c3Run7.occurrenceResults).length === 0
      && Object.keys(c3Run7.exposed).length === 0);
}

// Restore the state seeded above.
T.state.tables = c3Saved.tables;
T.state.macros = c3Saved.macros;
T.state.logicOps = c3Saved.logicOps;
if (c3Saved.hadFile) { T.state.files.set(c3File, c3Saved.file); } else { T.state.files.delete(c3File); }

// ------------------------------------------------------------------
// the entry's stored {token, operationId} rows make
// {operation} spans resolve ID-first; a stale or absent stored id falls back
// to the unique-name match; an ambiguous or missing name stays
// missing-operation — never a silent substitution.
// ------------------------------------------------------------------
const c4File = 'tables/c4-d7-test.json';
const c4Saved = {
  tables: T.state.tables,
  macros: T.state.macros,
  logicOps: T.state.logicOps,
  hadFile: T.state.files.has(c4File),
  file: T.state.files.get(c4File),
};
{
  const RG = T.runGenerator;
  const c4Ops = [
    { id: 'op_c4a', name: 'Alpha', purpose: '', script: 'SET a = 42', outputTemplate: '%a%' },
    { id: 'op_c4b', name: 'Beta', purpose: '', script: 'SET b = 43', outputTemplate: '%b%' },
    { id: 'op_c4c', name: 'Twin', purpose: '', script: 'SET c = 44', outputTemplate: '%c%' },
    { id: 'op_c4d', name: 'Twin', purpose: '', script: 'SET d = 45', outputTemplate: '%d%' },
  ];
  const c4Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5, 0.5, 0.5, 0.5, 0.5]),
    containers: [],
    operations: c4Ops,
    tableFile: '',
  }, extra);

  // 1. Legacy: no stored rows -> the unique name resolves.
  let r = T.resolveEmbed('Legacy {alpha} end', c4Ctx());
  check('c4 engine: a legacy entry resolves through the unique name',
    r.ok === true && r.output === 'Legacy 42 end');
  checkDeep('c4 engine: the legacy op segment carries the resolved id', r.segments[1],
    { type: 'op', text: '42', operationId: 'op_c4a', operationName: 'Alpha', token: '{alpha}' });

  // 2. A stored id beats a same-named newcomer.
  const c4OpsRenamed = [
    { id: 'op_c4a', name: 'Renamed', purpose: '', script: 'SET a = 42', outputTemplate: '%a%' },
    { id: 'op_c4b', name: 'Beta', purpose: '', script: 'SET b = 43', outputTemplate: '%b%' },
    { id: 'op_c4x', name: 'Alpha', purpose: '', script: 'SET x = 99', outputTemplate: '%x%' },
  ];
  r = T.resolveEmbed('X {alpha} Y', c4Ctx({
    operations: c4OpsRenamed,
    entryOperations: [{ token: 'alpha', operationId: 'op_c4a', operationName: 'Alpha' }],
  }));
  check('c4 engine: a stored id beats a same-named newcomer', r.ok === true && r.output === 'X 42 Y');
  checkDeep('c4 engine: the id segment carries the renamed operation', r.segments[1],
    { type: 'op', text: '42', operationId: 'op_c4a', operationName: 'Renamed', token: '{alpha}' });
  r = T.resolveEmbed('X {alpha} Y', c4Ctx({ operations: c4OpsRenamed }));
  check('c4 engine: without stored rows the unique name wins (the newcomer)',
    r.ok === true && r.output === 'X 99 Y');

  // 3. The stored id wins even when no operation matches the token text.
  r = T.resolveEmbed('Nope {nope} end', c4Ctx({
    entryOperations: [{ token: 'nope', operationId: 'op_c4a', operationName: 'Alpha' }],
  }));
  check('c4 engine: the stored id resolves a token no current name matches',
    r.ok === true && r.output === 'Nope 42 end');

  // 4. Ambiguous / missing stay missing-operation, with or without stale ids.
  r = T.resolveEmbed('Ambig {twin} end', c4Ctx());
  check('c4 engine: an ambiguous name without rows is missing-operation',
    r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'missing-operation');
  r = T.resolveEmbed('Ambig {twin} end', c4Ctx({
    entryOperations: [{ token: 'twin', operationId: 'op_gone444', operationName: 'Twin' }],
  }));
  check('c4 engine: a stale stored id falls back and stays ambiguous',
    r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'missing-operation');
  r = T.resolveEmbed('Nope {nope} end', c4Ctx());
  check('c4 engine: a missing name without rows is missing-operation',
    r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'missing-operation');

  // 5. A stored id picks one twin over the other.
  r = T.resolveEmbed('Ambig {twin} end', c4Ctx({
    entryOperations: [{ token: 'twin', operationId: 'op_c4c', operationName: 'Twin' }],
  }));
  check('c4 engine: a stored id resolves an otherwise ambiguous name',
    r.ok === true && r.output === 'Ambig 44 end');
  checkDeep('c4 engine: the twin segment names the picked operation', r.segments[1],
    { type: 'op', text: '44', operationId: 'op_c4c', operationName: 'Twin', token: '{twin}' });

  // 6. Nested containers: the picked entry's own rows resolve its label.
  const c4Cont = {
    id: 'tbl_c4c', name: 'C4Cont', file: c4File,
    entries: [{ label: '{beta}', weight: 1,
      operations: [{ token: 'beta', operationId: 'op_c4b', operationName: 'Beta' }] }],
  };
  const c4ContStale = {
    id: 'tbl_c4d', name: 'C4ContStale', file: c4File,
    entries: [{ label: '{beta}', weight: 1,
      operations: [{ token: 'beta', operationId: 'op_gone444', operationName: 'Beta' }] }],
  };
  const c4Roll = (container) =>
    (container && Array.isArray(container.entries)) ? container.entries[0] : null;
  T.state.files.set(c4File, {
    text: '',
    parsed: { items: [ Object.assign({}, c4Cont) ] },
    error: null,
  });
  T.state.tables = [
    { file: c4File, index: 0, name: 'C4Cont', entries: c4Cont.entries },
  ];
  T.state.macros = [];
  T.state.logicOps = [];
  const c4Gen = { id: 'g_c4', name: 'C4', template: '[c4cont]', references: [], operations: [] };
  T.normalizeGeneratorItem(c4Gen, { macros: [] });
  let run = RG(c4Gen, [c4Cont], c4Roll, c4Ctx({ containers: [c4Cont] }));
  check('c4 engine: a nested entry resolves through its own stored rows',
    run.ok === true && run.output === '43');
  const c4GenStale = { id: 'g_c4s', name: 'C4S', template: '[c4contstale]', references: [], operations: [] };
  T.normalizeGeneratorItem(c4GenStale, { macros: [] });
  run = RG(c4GenStale, [c4ContStale], c4Roll, c4Ctx({ containers: [c4ContStale] }));
  check('c4 engine: a nested stale id falls back to the unique name',
    run.ok === true && run.output === '43');
}

// Restore the state seeded above.
T.state.tables = c4Saved.tables;
T.state.macros = c4Saved.macros;
T.state.logicOps = c4Saved.logicOps;
if (c4Saved.hadFile) { T.state.files.set(c4File, c4Saved.file); } else { T.state.files.delete(c4File); }

// ------------------------------------------------------------------
// bound generator results and operations' exposed variables are
// importable from within the run (IMPORT from the Generator context). The
// values are already-resolved results of the SAME run, so importing never
// rolls again; stale items expose nothing to the channel (the stale-row
// check, in the bound-results context).
// ------------------------------------------------------------------
{
  const RG = T.runGenerator;
  const c5WeaponTable = {
    id: 'tbl_c5w', name: 'weapon',
    entries: [
      { label: 'Longsword', weight: 1 },
      { label: 'Shotgun', weight: 1 },
    ],
  };
  const c5Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);

  // T1 — Example B: the op imports the bound container result and never
  // rolls the container again.
  const c5OpsB = [
    { id: 'op_c5rarity', name: 'Determine Rarity', purpose: '',
      script: 'IMPORT %weapon%\nIF weapon == "Shotgun" THEN:\n    SET rarity = "Heavy Weapon"\nELSE:\n    SET rarity = "Other Weapon"',
      outputTemplate: '%rarity%' },
  ];
  const c5GenB = {
    id: 'g_c5b', name: 'C5B',
    template: 'You found a [weapon] with {Determine Rarity}.',
    references: [], operations: [],
  };
  T.normalizeGeneratorItem(c5GenB, { macros: [] });
  const c5RefOccB = c5GenB.occurrences.find((o) => o.kind === 'ref');
  c5GenB.bindings[c5RefOccB.instanceId] = 'weapon';
  let run = RG(c5GenB, [c5WeaponTable], (c) => c.entries[1], c5Ctx({
    containers: [c5WeaponTable], operations: c5OpsB,
  }));
  check('c5 T1: Example B resolves with the bound weapon and no reroll',
    run.ok === true && run.output === 'You found a Shotgun with Heavy Weapon.'
      && run.rolls.length === 1 && run.rolls[0].entry.label === 'Shotgun');
  check('c5 T1: the run still exposes the binding (return shape unchanged)',
    run.exposed.weapon === 'Shotgun');
  const c5OpNode = run.trace[1];
  check('c5 T1: the op trace records the import from the generator channel',
    c5OpNode && c5OpNode.operationName === 'Determine Rarity'
      && Array.isArray(c5OpNode.children) && c5OpNode.children.length === 3
      && c5OpNode.children[0].kind === 'import'
      && c5OpNode.children[0].name === 'weapon'
      && c5OpNode.children[0].type === 'string'
      && c5OpNode.children[0].value === 'Shotgun'
      && c5OpNode.children[0].source === 'generator');

  // T2 — an earlier op's EXPOSED variable is importable by a later op.
  const c5Ops2 = [
    { id: 'op_c5one', name: 'One', purpose: '', script: 'SET one = 7\nEXPOSE one', outputTemplate: '%one%' },
    { id: 'op_c5two', name: 'Two', purpose: '', script: 'IMPORT %one%\nSET two = one\nEXPOSE two', outputTemplate: '%two%' },
  ];
  const c5Gen2 = { id: 'g_c5two', name: 'C5Two', template: '{One} {Two}', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen2, { macros: [] });
  run = RG(c5Gen2, [], () => null, c5Ctx({ operations: c5Ops2 }));
  check('c5 T2: an op exposed variable is importable by a second op',
    run.ok === true && run.output === '7 7'
      && run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'one'
      && run.trace[1].children[0].type === 'number'
      && run.trace[1].children[0].value === 7
      && run.trace[1].children[0].source === 'generator');

  // T2b — a boolean EXPOSE keeps its type through the run channel (no
  // degradation to the string "true").
  const c5Ops2b = [
    { id: 'op_c5bool', name: 'Bool', purpose: '', script: 'SET b = true\nEXPOSE b', outputTemplate: '' },
    { id: 'op_c5readb', name: 'ReadBool', purpose: '', script: 'IMPORT %b%\nIF b == true THEN:\n    SET r = "yes"\nELSE:\n    SET r = "no"', outputTemplate: '%r%' },
  ];
  const c5Gen2b = { id: 'g_c5twoB', name: 'C5TwoB', template: '{Bool} {ReadBool}', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen2b, { macros: [] });
  run = RG(c5Gen2b, [], () => null, c5Ctx({ operations: c5Ops2b }));
  check('c5 T2b: an exposed boolean stays boolean when a second op imports it',
    run.ok === true && run.output === ' yes'
      && run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'b'
      && run.trace[1].children[0].type === 'boolean'
      && run.trace[1].children[0].value === true
      && run.trace[1].children[0].source === 'generator');

  // T3a — an unbound span: the import is reported, never defaulted.
  const c5Ops3 = [
    { id: 'op_c5need', name: 'Need', purpose: '', script: 'IMPORT %weapon%', outputTemplate: '' },
  ];
  const c5Gen3 = { id: 'g_c5three', name: 'C5Three', template: '[weapon] {Need}', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen3, { macros: [] });
  run = RG(c5Gen3, [c5WeaponTable], (c) => c.entries[1], c5Ctx({
    containers: [c5WeaponTable], operations: c5Ops3,
  }));
  check('c5 T3a: a missing generator import is reported, not defaulted',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].token === '{Need}'
      && run.errors[0].operationName === 'Need');

  // T3b — template order: an op cannot import a span that comes after it.
  const c5Gen3b = { id: 'g_c5threeb', name: 'C5ThreeB', template: '{Need} [weapon]', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen3b, { macros: [] });
  const c5RefOcc3b = c5Gen3b.occurrences.find((o) => o.kind === 'ref');
  c5Gen3b.bindings[c5RefOcc3b.instanceId] = 'weapon';
  run = RG(c5Gen3b, [c5WeaponTable], (c) => c.entries[1], c5Ctx({
    containers: [c5WeaponTable], operations: c5Ops3,
  }));
  check('c5 T3b: a forward dependency is missing-import (template order)',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].operationName === 'Need');

  // T4 — stale rows expose nothing to the channel (the stale-row check,
  // in the bound-results context): no binding, so the import is missing.
  const c5Gen4 = {
    id: 'g_c5stale', name: 'C5Stale',
    template: '[weapon] {Need}',
    occurrences: [{ instanceId: 'occ_c5stale', kind: 'ref', token: 'weapon', refId: 'tbl_c5w', offset: 0 }],
    bindings: { occ_c5stale: 'weapon' },
    references: [], operations: [],
  };
  run = RG(c5Gen4, [c5WeaponTable], (c) => c.entries[1], c5Ctx({
    containers: [c5WeaponTable], operations: c5Ops3,
  }));
  check('c5 T4: stale rows expose no binding, so the import is missing',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && Object.keys(run.occurrenceResults).length === 0
      && Object.keys(run.exposed).length === 0);

  // T5 — a bound inline range exposes its NUMBER to the channel.
  const c5Ops5 = [
    { id: 'op_c5check', name: 'Check', purpose: '', script: 'IMPORT %roll%\nEXPOSE roll', outputTemplate: '%roll%' },
  ];
  const c5Gen5 = { id: 'g_c5five', name: 'C5Five', template: '((1-10)) {Check}', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen5, { macros: [] });
  const c5InlineOcc5 = c5Gen5.occurrences.find((o) => o.kind === 'inline');
  c5Gen5.bindings[c5InlineOcc5.instanceId] = 'roll';
  run = RG(c5Gen5, [], () => null, c5Ctx({ rng: seqRng([0.5]), operations: c5Ops5 }));
  check('c5 T5: a bound inline range number is importable',
    run.ok === true && run.output === '6 6'
      && run.exposed.roll === 6
      && run.trace[0].children[0].kind === 'import'
      && run.trace[0].children[0].name === 'roll'
      && run.trace[0].children[0].type === 'number'
      && run.trace[0].children[0].value === 6
      && run.trace[0].children[0].source === 'generator');

  // T6 — an {op} inside a picked entry label imports from the run channel.
  const c5InnerTable = {
    id: 'tbl_c5inner', name: 'inner',
    entries: [{ label: '{Need2}', weight: 1 }],
  };
  const c5Ops6 = [
    { id: 'op_c5need2', name: 'Need2', purpose: '', script: 'IMPORT %weapon%', outputTemplate: '%weapon%' },
  ];
  const c5Gen6 = { id: 'g_c5six', name: 'C5Six', template: '[weapon] [inner]', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen6, { macros: [] });
  const c5RefOcc6 = c5Gen6.occurrences.find((o) => o.kind === 'ref' && o.token === 'weapon');
  c5Gen6.bindings[c5RefOcc6.instanceId] = 'weapon';
  run = RG(c5Gen6, [c5WeaponTable, c5InnerTable], (c) => c.entries[0], c5Ctx({
    containers: [c5WeaponTable, c5InnerTable], operations: c5Ops6,
  }));
  check('c5 T6: an entry-label op imports the earlier bound span',
    run.ok === true && run.output === 'Longsword Longsword');
  const c5LabelOpNode = (run.trace[1] && run.trace[1].children && run.trace[1].children[0]) || null;
  check('c5 T6: the label op trace records the generator-channel import',
    c5LabelOpNode && c5LabelOpNode.operationName === 'Need2'
      && c5LabelOpNode.children[0].kind === 'import'
      && c5LabelOpNode.children[0].name === 'weapon'
      && c5LabelOpNode.children[0].value === 'Longsword'
      && c5LabelOpNode.children[0].source === 'generator');

  // T7 — evaluator origin tags: a record's own source wins, importSource
  // tags raw values, and the missing-import message follows the context.
  check('c5 T7: a supplied typed record keeps its own source',
    (function () {
      const r = T.LogicEvaluator.evaluate('IMPORT %w%', { values: { w: { type: 'string', value: 'x', source: 'generator' } } });
      return r.ok && r.trace[0].kind === 'import' && r.trace[0].source === 'generator';
    })());
  check('c5 T7: importSource tags raw supplied values',
    (function () {
      const r = T.LogicEvaluator.evaluate('IMPORT %w%', { values: { w: 3 }, importSource: 'generator' });
      return r.ok && r.trace[0].source === 'generator';
    })());
  check('c5 T7: without importSource the test-panel default holds',
    (function () {
      const r = T.LogicEvaluator.evaluate('IMPORT %w%', { values: { w: 3 } });
      return r.ok && r.trace[0].source === 'test-input';
    })());
  check('c5 T7: the missing-import message names the generator context',
    (function () {
      const r = T.LogicEvaluator.evaluate('IMPORT %w%', { importSource: 'generator' });
      return r.ok === false && r.errors.length === 1
        && r.errors[0].kind === 'missing-import'
        && r.errors[0].message === 'IMPORT "w" has no value in this generator run \u2014 no earlier part of the run supplied it';
    })());
  check('c5 T7: outside a generator run the plain message holds',
    (function () {
      const r = T.LogicEvaluator.evaluate('IMPORT %w%');
      return r.ok === false && r.errors.length === 1
        && r.errors[0].message === 'IMPORT "w" has no value \u2014 supply it for this run';
    })());

  // T8 — name clash inside one op segment: the binding is applied first,
  // then the exposed variable (exposed wins).
  const c5Ops8 = [
    { id: 'op_c5clash', name: 'Clash', purpose: '', script: 'SET v = 1\nEXPOSE v', outputTemplate: '%v%' },
    { id: 'op_c5read', name: 'Read', purpose: '', script: 'IMPORT %v%\nSET r = v\nEXPOSE r', outputTemplate: '%r%' },
  ];
  const c5Gen8 = { id: 'g_c5clash', name: 'C5Clash', template: '{Clash} {Read}', references: [], operations: [] };
  T.normalizeGeneratorItem(c5Gen8, { macros: [] });
  const c5OpOcc8 = c5Gen8.occurrences.find((o) => o.kind === 'op');
  c5Gen8.bindings[c5OpOcc8.instanceId] = 'v';
  run = RG(c5Gen8, [], () => null, c5Ctx({ operations: c5Ops8 }));
  check('c5 T8: on a name clash the exposed variable beats the binding',
    run.ok === true && run.output === '1 1'
      && run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'v'
      && run.trace[1].children[0].type === 'number'
      && run.trace[1].children[0].value === 1
      && run.trace[1].children[0].source === 'generator');

  // T9 — legacy 3-argument runs keep the old behavior (no value channel).
  const c5Gen9 = { id: 'g_c5nine', name: 'C5Nine', template: '[weapon] {Need}', references: [], operations: [] };
  run = RG(c5Gen9, [c5WeaponTable], (c) => c.entries[1]);
  check('c5 T9: a legacy 3-argument run reports missing-operation, not missing-import',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-operation');
  const c5Gen9b = { id: 'g_c5nineb', name: 'C5NineB', template: '[weapon]', references: [], operations: [] };
  run = RG(c5Gen9b, [c5WeaponTable], (c) => c.entries[1]);
  check('c5 T9: a legacy ref-only run still resolves verbatim',
    run.ok === true && run.output === 'Shotgun');
  checkDeep('c5 T9: a legacy run exposes nothing new', run.exposed, {});
}

// ------------------------------------------------------------------
// op occurrences bind per EXPOSED variable. An op row's binding
// is an OBJECT (exposed variable name -> bound name): a named variable is
// exposed (final `exposed`) and joins the run channel under its bound name;
// an explicit '' is an unexpose (out of both); a key the op does not expose
// falls back to the variable's own name in the channel (legacy binding) but never
// lands in `exposed`; a STRING binding on an op row keeps its legacy meaning
// (the op's own output under that name); non-op rows keep the string.
// ------------------------------------------------------------------
{
  const RG = T.runGenerator;
  const c8Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);

  // The op the block binds against: two exposed variables of different types.
  const c8Op = {
    id: 'op_c8stat', name: 'Stat', purpose: '',
    script: 'SET power = 4\nSET tag = "fierce"\nEXPOSE power\nEXPOSE tag',
    outputTemplate: '%power%',
  };
  const c8Ops = [c8Op];
  const c8Gen = { id: 'g_c8a', name: 'C8A', template: '{Stat}', references: [], operations: [] };
  T.normalizeGeneratorItem(c8Gen, { macros: [] });
  const c8Occ = c8Gen.occurrences[0];
  check('c8 T0: the test op exposes its script variables in first-appearance order',
    T.deriveScriptExposed(c8Op.script).join(',') === 'power,tag'
      && c8Occ.kind === 'op' && c8Occ.token === 'Stat');

  // T1 — object binding: each named variable is exposed under its bound name;
  // the op's own output is NOT exposed (that is the legacy string shape).
  c8Gen.bindings[c8Occ.instanceId] = { power: 'pow', tag: 'name' };
  let run = RG(c8Gen, [], () => null, c8Ctx({ operations: c8Ops }));
  check('c8 T1: object binding exposes each exposed variable under its bound name',
    run.ok === true && run.output === '4'
      && run.exposed.pow === 4 && run.exposed.name === 'fierce'
      && Object.keys(run.exposed).length === 2);
  check('c8 T1: the op output itself is not exposed under an object binding',
    !('4' in run.exposed) && Object.keys(run.occurrenceResults).length === 1
      && run.occurrenceResults[c8Occ.instanceId].value === '4');

  // T2 — bound variables join the run channel under their bound names, so a
  // later op imports them (no reroll: the Stat op runs once per span).
  const c8Ops2 = [c8Op, {
    id: 'op_c8read', name: 'Read', purpose: '',
    script: 'IMPORT %pow%\nIMPORT %name%\nEXPOSE pow',
    outputTemplate: '',
  }];
  const c8Gen2 = { id: 'g_c8b', name: 'C8B', template: '{Stat} {Read}', references: [], operations: [] };
  T.normalizeGeneratorItem(c8Gen2, { macros: [] });
  const c8Occ2 = c8Gen2.occurrences.find((o) => o.token === 'Stat');
  c8Gen2.bindings[c8Occ2.instanceId] = { power: 'pow', tag: 'name' };
  run = RG(c8Gen2, [], () => null, c8Ctx({ operations: c8Ops2 }));
  check('c8 T2: bound exposed variables are importable under their bound names',
    run.ok === true && run.output === '4 '
      && run.exposed.pow === 4 && run.exposed.name === 'fierce'
      && run.trace[1].children.length === 3 // import, import, expose
      && run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'pow'
      && run.trace[1].children[0].type === 'number'
      && run.trace[1].children[0].value === 4
      && run.trace[1].children[0].source === 'generator'
      && run.trace[1].children[1].name === 'name'
      && run.trace[1].children[1].type === 'string'
      && run.trace[1].children[1].value === 'fierce'
      && run.trace[1].children[1].source === 'generator');

  // T3 — an explicit '' is an unexpose: out of `exposed` AND out of the
  // channel (a later import of the variable name is missing-import).
  c8Gen.bindings[c8Occ.instanceId] = { power: '', tag: 'name' };
  run = RG(c8Gen, [], () => null, c8Ctx({ operations: c8Ops }));
  check('c8 T3: an explicit "" stays out of the final exposed',
    run.ok === true && run.exposed.name === 'fierce'
      && Object.keys(run.exposed).length === 1 && !('power' in run.exposed));
  const c8Ops3 = [c8Op, {
    id: 'op_c8need', name: 'Need', purpose: '', script: 'IMPORT %power%', outputTemplate: '',
  }];
  const c8Gen3 = { id: 'g_c8c', name: 'C8C', template: '{Stat} {Need}', references: [], operations: [] };
  T.normalizeGeneratorItem(c8Gen3, { macros: [] });
  const c8Occ3 = c8Gen3.occurrences.find((o) => o.token === 'Stat');
  c8Gen3.bindings[c8Occ3.instanceId] = { power: '', tag: 'name' };
  run = RG(c8Gen3, [], () => null, c8Ctx({ operations: c8Ops3 }));
  check('c8 T3: an explicitly unexposed variable is missing-import for a later op',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].operationName === 'Need');

  // T4 — a key missing from the object falls back to the variable's own name
  // in the channel (legacy binding), but never lands in the final `exposed`.
  c8Gen3.bindings[c8Occ3.instanceId] = { tag: 'name' };
  run = RG(c8Gen3, [], () => null, c8Ctx({ operations: c8Ops3 }));
  check('c8 T4: a missing key falls back to the variable name in the channel',
    run.ok === true
      && run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'power'
      && run.trace[1].children[0].value === 4);
  check('c8 T4: ... but never lands in the final exposed',
    run.exposed.name === 'fierce' && Object.keys(run.exposed).length === 1
      && !('power' in run.exposed));

  // T5 — rename: editing the bound name moves the exposure (old name gone).
  c8Gen.bindings[c8Occ.instanceId] = { power: 'pow2', tag: 't2' };
  run = RG(c8Gen, [], () => null, c8Ctx({ operations: c8Ops }));
  check('c8 T5: renaming a bound name moves the exposure',
    run.ok === true && run.exposed.pow2 === 4 && run.exposed.t2 === 'fierce'
      && Object.keys(run.exposed).length === 2
      && !('pow' in run.exposed) && !('name' in run.exposed));

  // T6 — an op with no EXPOSE statements: an object binding is inert.
  const c8OpNo = { id: 'op_c8plain', name: 'Plain', purpose: '', script: 'SET q = 2', outputTemplate: '%q%' };
  const c8Gen6 = { id: 'g_c8f', name: 'C8F', template: '{Plain}', references: [], operations: [] };
  T.normalizeGeneratorItem(c8Gen6, { macros: [] });
  const c8Occ6 = c8Gen6.occurrences[0];
  c8Gen6.bindings[c8Occ6.instanceId] = { anything: 'x' };
  run = RG(c8Gen6, [], () => null, c8Ctx({ operations: [c8OpNo] }));
  check('c8 T6: an op without EXPOSE statements exposes nothing under an object binding',
    run.ok === true && run.output === '2' && Object.keys(run.exposed).length === 0);

  // T7 — a legacy STRING binding on an op row keeps its old meaning (the op's
  // own output under that name); its EXPOSED variables still join the
  // channel under their own names, but they are not in `exposed`.
  c8Gen.bindings[c8Occ.instanceId] = 'statout';
  run = RG(c8Gen, [], () => null, c8Ctx({ operations: c8Ops }));
  check('c8 T7: a string binding on an op row keeps the legacy output-under-name shape',
    run.ok === true && run.exposed.statout === '4'
      && Object.keys(run.exposed).length === 1 && !('power' in run.exposed));

  // T8 — stale rows (kind mismatch) apply no object binding: no exposure, no
  // channel names from it.
  const c8Gen8 = {
    id: 'g_c8stale', name: 'C8Stale', template: '{Stat}',
    occurrences: [{ instanceId: 'occ_c8stale', kind: 'ref', token: 'Stat', refId: null, offset: 0 }],
    bindings: { occ_c8stale: { power: 'pow', tag: 'name' } },
    references: [], operations: [],
  };
  run = RG(c8Gen8, [], () => null, c8Ctx({ operations: c8Ops }));
  check('c8 T8: stale rows apply no object binding (no exposure, no channel)',
    run.ok === true && Object.keys(run.exposed).length === 0
      && Object.keys(run.occurrenceResults).length === 0);

 // T9 — an object binding on a NON-op row is inert (the shape is strings).
  const c8Gen9 = { id: 'g_c8nine', name: 'C8Nine', template: '((1-10))', references: [], operations: [] };
  T.normalizeGeneratorItem(c8Gen9, { macros: [] });
  c8Gen9.bindings[c8Gen9.occurrences[0].instanceId] = { power: 'x' };
  run = RG(c8Gen9, [], () => null, c8Ctx({ rng: seqRng([0.5]) }));
  check('c8 T9: an object binding on a non-op row is inert',
    run.ok === true && Object.keys(run.exposed).length === 0
      && Object.keys(run.occurrenceResults).length === 1);

  // T10 — duplicate bound names across two op rows: last-write-wins in
  // template order.
  const c8Gen10 = { id: 'g_c8ten', name: 'C8Ten', template: '{Stat} {Stat}', references: [], operations: [] };
  T.normalizeGeneratorItem(c8Gen10, { macros: [] });
  c8Gen10.bindings[c8Gen10.occurrences[0].instanceId] = { power: 'shared' };
  c8Gen10.bindings[c8Gen10.occurrences[1].instanceId] = { power: 'shared' };
  run = RG(c8Gen10, [], () => null, c8Ctx({ operations: c8Ops }));
  check('c8 T10: duplicate bound names are last-write-wins in template order',
    run.ok === true && run.exposed.shared === 4 && Object.keys(run.exposed).length === 1);

  // T11 — reconcile: a kept op row carries its OBJECT binding over (string
  // values only, '' kept as the explicit unexpose); a deleted or ambiguous
  // op row demotes one unresolved entry per non-empty bound name.
  let rec = T.reconcileGeneratorOccurrences(
    [{ instanceId: 'occ_c8k', kind: 'op', token: 'Stat', refId: 'op_c8stat', offset: 0 }],
    [{ kind: 'op', token: 'Stat', refId: 'op_c8stat', offset: 0 }],
    { occ_c8k: { power: 'pow', tag: '' } });
  check('c8 T11: reconcile keeps an op row object binding verbatim (incl. the "" unexpose)',
    rec.occurrences.length === 1
      && rec.unresolvedBindings.length === 0
      && deepEq(rec.bindings[rec.occurrences[0].instanceId], { power: 'pow', tag: '' }));
  rec = T.reconcileGeneratorOccurrences(
    [{ instanceId: 'occ_c8d', kind: 'op', token: 'Stat', refId: 'op_c8stat', offset: 0 }],
    [],
    { occ_c8d: { power: 'pow', tag: '' } });
  check('c8 T11: a deleted op row demotes one unresolved entry per non-empty bound name',
    rec.occurrences.length === 0
      && deepEq(rec.unresolvedBindings, [{ varName: 'pow', reason: 'occurrence-deleted' }]));
  rec = T.reconcileGeneratorOccurrences(
    [{ instanceId: 'occ_c8amb', kind: 'op', token: 'Stat', refId: null, offset: 99 }],
    [
      { kind: 'op', token: 'Stat', refId: null, offset: 0 },
      { kind: 'op', token: 'Stat', refId: null, offset: 5 },
    ],
    { occ_c8amb: { power: 'pow', tag: 'name' } });
  check('c8 T11: an ambiguous op row demotes both non-empty bound names',
    Object.keys(rec.bindings).length === 0
      && deepEq(rec.unresolvedBindings, [
        { varName: 'pow', reason: 'occurrence-ambiguous' },
        { varName: 'name', reason: 'occurrence-ambiguous' },
      ]));
}

// ------------------------------------------------------------------
// C1: runGenerator's three-stage pipeline — Stages 1 + 2 as one
// template-order walk (each span resolves at its own template position:
// non-Logic refs/embeds in Stage 1, Logic operations in Stage 2, left to
// right, with no silent reorder; a forward dependency is a missing-import,
// reported rather than satisfied by reordering), and Stage 3 assembles the
// final output from the stored per-segment results without rerolling
// anything. The three-stage reading: two template-order stages followed by
// final output assembly.
// ------------------------------------------------------------------
{
  const RG = T.runGenerator;
  const c1WeaponTable = {
    id: 'tbl_c1w', name: 'weapon',
    entries: [
      { label: 'Longsword', weight: 1 },
      { label: 'Shotgun', weight: 1 },
    ],
  };
  const c1Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);

 // Example D (success): Logic1 resolves before Logic2, so Logic2
  // imports the exposed rarity; left-to-right template order, no reroll.
  const c1Ops1 = [
    { id: 'op_c1logic1', name: 'Logic1', purpose: '',
      script: 'SET rarity = "Legendary"\nEXPOSE rarity', outputTemplate: '%rarity%' },
    { id: 'op_c1logic2', name: 'Logic2', purpose: '',
      script: 'IMPORT %rarity%\nEXPOSE rarity', outputTemplate: '%rarity%' },
  ];
  const c1Gen1 = {
    id: 'g_c1d1', name: 'C1D1',
    template: 'Example generator {Logic1} template {Logic2}',
    references: [], operations: [],
  };
  T.normalizeGeneratorItem(c1Gen1, { macros: [] });
  let run = RG(c1Gen1, [], () => null, c1Ctx({ operations: c1Ops1 }));
  check('c1: Example D — Logic1 resolves before Logic2 (left-to-right)',
    run.ok === true && run.output === 'Example generator Legendary template Legendary');
  check('c1: both ops trace in template order',
    run.trace.length === 2
      && run.trace[0].operationName === 'Logic1'
      && run.trace[1].operationName === 'Logic2');
  check('c1: Logic2 imports the run channel value (no roll involved)',
    run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'rarity'
      && run.trace[1].children[0].type === 'string'
      && run.trace[1].children[0].value === 'Legendary'
      && run.trace[1].children[0].source === 'generator'
      && run.rolls.length === 0);

 // Example D (forward dependency): Logic1 imports a value that only
  // the later Logic2 produces. Reported as missing-import, never satisfied
  // by reordering execution.
  const c1Ops2 = [
    { id: 'op_c1fwd', name: 'Logic1', purpose: '', script: 'IMPORT %rarity%', outputTemplate: '' },
    { id: 'op_c1set', name: 'Logic2', purpose: '',
      script: 'SET rarity = "Legendary"\nEXPOSE rarity', outputTemplate: '%rarity%' },
  ];
  const c1Gen2 = {
    id: 'g_c1d2', name: 'C1D2',
    template: 'Example generator {Logic1} template {Logic2}',
    references: [], operations: [],
  };
  T.normalizeGeneratorItem(c1Gen2, { macros: [] });
  run = RG(c1Gen2, [], () => null, c1Ctx({ operations: c1Ops2 }));
  check('c1: a forward dependency is missing-import, not a reorder',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].token === '{Logic1}'
      && run.errors[0].operationName === 'Logic1');
  check('c1: no reorder — the later op still ran and the diagnostic kept its template position',
    run.output === 'Example generator {Logic1} template Legendary'
      && run.trace.length === 1
      && run.trace[0].operationName === 'Logic2');

 // no-reroll: the op reads the bound weapon result from the run
  // channel; the container rolls exactly once, and the IMPORT never rolls
  // it again (values are already-resolved results of this run).
  const c1Ops3 = [
    { id: 'op_c1read', name: 'Read', purpose: '',
      script: 'IMPORT %weapon%\nSET rarity = "Common"\nEXPOSE rarity',
      outputTemplate: '%rarity% (%weapon%)' },
  ];
  const c1Gen3 = {
    id: 'g_c1d3', name: 'C1D3',
    template: 'You found a [weapon] with {Read}.',
    references: [], operations: [],
  };
  T.normalizeGeneratorItem(c1Gen3, { macros: [] });
  const c1RefOcc3 = c1Gen3.occurrences.find((o) => o.kind === 'ref');
  c1Gen3.bindings[c1RefOcc3.instanceId] = 'weapon';
  run = RG(c1Gen3, [c1WeaponTable], (c) => c.entries[1], c1Ctx({
    containers: [c1WeaponTable], operations: c1Ops3,
  }));
  check('c1: the bound result is reused without a reroll',
    run.ok === true && run.output === 'You found a Shotgun with Common (Shotgun).'
      && run.rolls.length === 1 && run.rolls[0].entry.label === 'Shotgun');
  check('c1: the op trace records the generator-channel import',
    run.trace[1].children[0].kind === 'import'
      && run.trace[1].children[0].name === 'weapon'
      && run.trace[1].children[0].source === 'generator');
  check('c1: the binding still lands in exposed (return shape unchanged)',
    run.exposed.weapon === 'Shotgun');

 // Stage 1 forward dependency: an entry-label op cannot import a
  // bound span that comes later in the template. Every container still
  // rolls at its own template position (no reorder, no skip), and the
  // dependency is reported.
  const c1InnerTable = {
    id: 'tbl_c1inner', name: 'inner',
    entries: [{ label: '{Need}', weight: 1 }],
  };
  const c1Ops4 = [
    { id: 'op_c1need', name: 'Need', purpose: '', script: 'IMPORT %weapon%', outputTemplate: '%weapon%' },
  ];
  const c1Gen4 = {
    id: 'g_c1d4', name: 'C1D4',
    template: '[inner] [weapon]',
    references: [], operations: [],
  };
  T.normalizeGeneratorItem(c1Gen4, { macros: [] });
  const c1RefOcc4 = c1Gen4.occurrences.find((o) => o.kind === 'ref' && o.token === 'weapon');
  c1Gen4.bindings[c1RefOcc4.instanceId] = 'weapon';
  run = RG(c1Gen4, [c1InnerTable, c1WeaponTable], (c) => c.entries[0], c1Ctx({
    containers: [c1InnerTable, c1WeaponTable], operations: c1Ops4,
  }));
  check('c1: a label op importing a later bound span is missing-import',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].token === '{Need}'
      && run.errors[0].operationName === 'Need');
  check('c1: every container rolled at its template position (no reorder, no skip)',
    run.rolls.length === 2
      && run.rolls[0].token === 'inner'
      && run.rolls[1].token === 'weapon');
  check('c1: the diagnostic kept its template position (no skip, no reorder)',
    run.output === '[inner] Longsword');

 // a failed op exposes nothing: EXPOSED variables join the channel
 // only after the producing op resolves successfully . Even though
  // Bad's script ran its EXPOSE before failing, x must not reach ReadX.
  const c1Ops5 = [
    { id: 'op_c1bad', name: 'Bad', purpose: '',
      script: 'SET x = 1\nEXPOSE x\nIMPORT %ghost%', outputTemplate: '' },
    { id: 'op_c1readx', name: 'ReadX', purpose: '', script: 'IMPORT %x%', outputTemplate: '%x%' },
  ];
  const c1Gen5 = { id: 'g_c1d5', name: 'C1D5', template: '{Bad} {ReadX}', references: [], operations: [] };
  T.normalizeGeneratorItem(c1Gen5, { macros: [] });
  run = RG(c1Gen5, [], () => null, c1Ctx({ operations: c1Ops5 }));
  check('c1: a failed op exposes nothing to the channel',
    run.ok === false && run.errors.length === 2
      && run.errors[0].kind === 'missing-import' && run.errors[0].operationName === 'Bad'
      && run.errors[1].kind === 'missing-import' && run.errors[1].operationName === 'ReadX');
}

// ------------------------------------------------------------------
// operation cycles. An op that re-enters while still
// executing — itself or an ancestor, through `{op}` spans, ROLL-nested
// labels, or entry-label nesting — is a cycle: kind `op-cycle`, distinct
// from the container `cycle` kind. The in-flight op set is runtime-only
// state shared by reference as ctx.inFlightOps alongside operationDepth,
// so an op that finished and is reused later is legal, not a cycle. The
// diagnostic carries `chain` = the cycle path itself (the re-entered op
// twice, legal ancestors excluded), which survives every hop back to the
// template; the top-level error names the top op that failed.
// ------------------------------------------------------------------
{
  const RG = T.runGenerator;
  const pc2Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);
  const pc2Tbl = (id, name, label) => ({ id: id, name: name, entries: [{ label: label, weight: 1 }] });
  const pc2Op = (id, name, script, outputTemplate) => ({
    id: id, name: name, purpose: '', script: script, outputTemplate: outputTemplate || '',
  });
  const pc2Gen = (id, name, template) => {
    const g = { id: id, name: name, template: template, references: [], operations: [] };
    T.normalizeGeneratorItem(g, { macros: [] });
    return g;
  };
  const pc2RollFirst = (c) => c.entries[0];

  // T1 — direct A->B->A through ROLL-nested labels: B's label re-enters
  // A, which is still executing. The top error names the top failed op
  // and the whole cycle path.
  const pc2Ops1 = [
    pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%'),
    pc2Op('op_pc2b', 'B', 'SET z = ROLL [pc2tb]', '%z%'),
  ];
  const pc2Tbl1a = pc2Tbl('pc2ta', 'pc2ta', '{B}');
  const pc2Tbl1b = pc2Tbl('pc2tb', 'pc2tb', '{A}');
  const pc2Gen1 = pc2Gen('g_pc2t1', 'PC2T1', '{A}');
  let run = RG(pc2Gen1, [pc2Tbl1a, pc2Tbl1b], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl1a, pc2Tbl1b], operations: pc2Ops1,
  }));
  check('pc2 T1: A->B->A is op-cycle (never the container cycle kind)',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle');
  check('pc2 T1: the top error names the top failed op and the full cycle path',
    run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}'
      && run.errors[0].position === 0
      && deepEq(run.errors[0].chain, ['A', 'B', 'A']));
  check('pc2 T1: the failed span keeps its raw token; op rolls are not template rolls',
    run.output === '{A}' && run.rolls.length === 0);

  // T2 — self-cycle: A's own label re-enters A.
  const pc2Ops2 = [pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%')];
  const pc2Tbl2a = pc2Tbl('pc2ta', 'pc2ta', '{A}');
  const pc2Gen2 = pc2Gen('g_pc2t2', 'PC2T2', '{A}');
  run = RG(pc2Gen2, [pc2Tbl2a], pc2RollFirst, pc2Ctx({ containers: [pc2Tbl2a], operations: pc2Ops2 }));
  check('pc2 T2: an op re-entering itself is a self-cycle',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && run.errors[0].operationName === 'A'
      && deepEq(run.errors[0].chain, ['A', 'A']));

  // T3 — 3-op cycle A->B->C->A.
  const pc2Ops3 = [
    pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%'),
    pc2Op('op_pc2b', 'B', 'SET z = ROLL [pc2tb]', '%z%'),
    pc2Op('op_pc2c', 'C', 'SET z = ROLL [pc2tc]', '%z%'),
  ];
  const pc2Tbl3a = pc2Tbl('pc2ta', 'pc2ta', '{B}');
  const pc2Tbl3b = pc2Tbl('pc2tb', 'pc2tb', '{C}');
  const pc2Tbl3c = pc2Tbl('pc2tc', 'pc2tc', '{A}');
  const pc2Gen3 = pc2Gen('g_pc2t3', 'PC2T3', '{A}');
  run = RG(pc2Gen3, [pc2Tbl3a, pc2Tbl3b, pc2Tbl3c], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl3a, pc2Tbl3b, pc2Tbl3c], operations: pc2Ops3,
  }));
  check('pc2 T3: a 3-op cycle reports the whole path',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && run.errors[0].operationName === 'A'
      && deepEq(run.errors[0].chain, ['A', 'B', 'C', 'A']));

  // T4 — descent cycle: A ROLLs [pc2td1], whose entry label is [pc2td2],
  // whose entry label is {A}. The nested entry label must keep the
  // in-flight set, so the re-entry is op-cycle.
  const pc2Ops4 = [pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2td1]', '%z%')];
  const pc2Tbl4a = pc2Tbl('pc2td1', 'pc2td1', '[pc2td2]');
  const pc2Tbl4b = pc2Tbl('pc2td2', 'pc2td2', '{A}');
  const pc2Gen4 = pc2Gen('g_pc2t4', 'PC2T4', '{A}');
  run = RG(pc2Gen4, [pc2Tbl4a, pc2Tbl4b], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl4a, pc2Tbl4b], operations: pc2Ops4,
  }));
  check('pc2 T4: a cycle through nested entry labels is op-cycle',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && run.errors[0].operationName === 'A'
      && deepEq(run.errors[0].chain, ['A', 'A']));

  // T5 — lower cycle A->B->C->B: the chain names only the cycle itself,
  // not the legal ancestors above it; the top error still names the top
  // failed op.
  const pc2Ops5 = [
    pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%'),
    pc2Op('op_pc2b', 'B', 'SET z = ROLL [pc2tb]', '%z%'),
    pc2Op('op_pc2c', 'C', 'SET z = ROLL [pc2tc]', '%z%'),
  ];
  const pc2Tbl5a = pc2Tbl('pc2ta', 'pc2ta', '{B}');
  const pc2Tbl5b = pc2Tbl('pc2tb', 'pc2tb', '{C}');
  const pc2Tbl5c = pc2Tbl('pc2tc', 'pc2tc', '{B}');
  const pc2Gen5 = pc2Gen('g_pc2t5', 'PC2T5', '{A}');
  run = RG(pc2Gen5, [pc2Tbl5a, pc2Tbl5b, pc2Tbl5c], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl5a, pc2Tbl5b, pc2Tbl5c], operations: pc2Ops5,
  }));
  check('pc2 T5: a lower cycle names its own path, not the legal ancestors',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && deepEq(run.errors[0].chain, ['B', 'C', 'B'])
      && run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}');

  // T6 — no false positive: D finishes under B, then runs again (legally)
  // under C. A finished op is reusable, not a cycle.
  const pc2Ops6 = [
    pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%'),
    pc2Op('op_pc2b', 'B', 'SET z = ROLL [pc2tb]', '%z%'),
    pc2Op('op_pc2c', 'C', 'SET z = ROLL [pc2tc]', '%z%'),
    pc2Op('op_pc2d', 'D', 'SET d = 7', '%d%'),
  ];
  const pc2Tbl6a = pc2Tbl('pc2ta', 'pc2ta', '{B}{C}');
  const pc2Tbl6b = pc2Tbl('pc2tb', 'pc2tb', '{D}');
  const pc2Tbl6c = pc2Tbl('pc2tc', 'pc2tc', '{D}');
  const pc2Gen6 = pc2Gen('g_pc2t6', 'PC2T6', '{A}');
  run = RG(pc2Gen6, [pc2Tbl6a, pc2Tbl6b, pc2Tbl6c], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl6a, pc2Tbl6b, pc2Tbl6c], operations: pc2Ops6,
  }));
  check('pc2 T6: legitimate diamond reuse of a finished op is not a cycle',
    run.ok === true && run.errors.length === 0 && run.output === '77');
  const pc2CountOps = (node) => {
    if (!node || typeof node !== 'object') return 0;
    let n = (node.operationName === 'D') ? 1 : 0;
    const parts = [];
    if (Array.isArray(node.children)) for (const p of node.children) parts.push(p);
    if (node.roll && Array.isArray(node.roll.children)) for (const p of node.roll.children) parts.push(p);
    for (const p of parts) n += pc2CountOps(p);
    return n;
  };
  check('pc2 T6: D executed twice (once under B, once under C)',
    run.trace.length === 1 && pc2CountOps(run.trace[0]) === 2);

  // T7 — the same op twice in one template: sequential, never nested, so
  // each run starts with a fresh in-flight set.
  const pc2Ops7 = [pc2Op('op_pc2d', 'D', 'SET d = 7', '%d%')];
  const pc2Gen7 = pc2Gen('g_pc2t7', 'PC2T7', '{D} {D}');
  run = RG(pc2Gen7, [], () => null, pc2Ctx({ operations: pc2Ops7 }));
  check('pc2 T7: the same op twice in one template is legal',
    run.ok === true && run.errors.length === 0 && run.output === '7 7');

  // T8 — MAX_NESTED_OPERATION_DEPTH through ROLL-descent, at the boundary
  // and one past: a 4-deep chain A->B->C->D resolves (the 4th nested op is
  // the boundary), and a linear 5-op chain A->B->C->D->E trips the nesting
  // cap at the 5th op (operationDepth is threaded into the descent ctx,
  // closing the earlier gap).
  const pc2Ops8 = [
    pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%'),
    pc2Op('op_pc2b', 'B', 'SET z = ROLL [pc2tb]', '%z%'),
    pc2Op('op_pc2c', 'C', 'SET z = ROLL [pc2tc]', '%z%'),
    pc2Op('op_pc2d', 'D', 'SET d = 9', '%d%'),
  ];
  const pc2Tbl8a = pc2Tbl('pc2ta', 'pc2ta', '{B}');
  const pc2Tbl8b = pc2Tbl('pc2tb', 'pc2tb', '{C}');
  const pc2Tbl8c = pc2Tbl('pc2tc', 'pc2tc', '{D}');
  const pc2Gen8a = pc2Gen('g_pc2t8a', 'PC2T8A', '{A}');
  run = RG(pc2Gen8a, [pc2Tbl8a, pc2Tbl8b, pc2Tbl8c], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl8a, pc2Tbl8b, pc2Tbl8c], operations: pc2Ops8,
  }));
  check('pc2 T8: a legal 4-deep chain stays within the cap',
    run.ok === true && run.errors.length === 0 && run.output === '9');
  const pc2Ops8b = [
    pc2Op('op_pc2a', 'A', 'SET z = ROLL [pc2ta]', '%z%'),
    pc2Op('op_pc2b', 'B', 'SET z = ROLL [pc2tb]', '%z%'),
    pc2Op('op_pc2c', 'C', 'SET z = ROLL [pc2tc]', '%z%'),
    pc2Op('op_pc2d', 'D', 'SET z = ROLL [pc2td]', '%z%'),
    pc2Op('op_pc2e', 'E', 'SET e = 5', '%e%'),
  ];
  const pc2Tbl8d = pc2Tbl('pc2td', 'pc2td', '{E}');
  const pc2Gen8b = pc2Gen('g_pc2t8b', 'PC2T8B', '{A}');
  run = RG(pc2Gen8b, [pc2Tbl8a, pc2Tbl8b, pc2Tbl8c, pc2Tbl8d], pc2RollFirst, pc2Ctx({
    containers: [pc2Tbl8a, pc2Tbl8b, pc2Tbl8c, pc2Tbl8d], operations: pc2Ops8b,
  }));
  check('pc2 T8: a 5-deep ROLL-descent chain trips nesting-limit at the 5th op',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'nesting-limit'
      && run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}'
      && run.errors[0].position === 0
      && run.output === '{A}'
      && run.rolls.length === 0);
}

// ------------------------------------------------------------------
// consistent limit enforcement across every descent path.
// operationDepth now accumulates through ROLL-descent entry labels, so
// MAX_NESTED_OPERATION_DEPTH holds on every nested-op path, not just the
// output-template {op} spans. Each limit is pinned at its boundary and
// one past it (the one-past pins for depth-8, resolutions, and chars
// already live in the p3 section).
// ------------------------------------------------------------------
{
  const RG = T.runGenerator;
  const pc3Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);
  const pc3Tbl = (id, name, label) => ({ id: id, name: name, entries: [{ label: label, weight: 1 }] });
  const pc3Op = (id, name, script, outputTemplate) => ({
    id: id, name: name, purpose: '', script: script, outputTemplate: outputTemplate || '',
  });
  const pc3Gen = (id, name, template) => {
    const g = { id: id, name: name, template: template, references: [], operations: [] };
    T.normalizeGeneratorItem(g, { macros: [] });
    return g;
  };
  const pc3RollFirst = (c) => c.entries[0];

  // T9 — a 4-op cycle A->B->C->D->A re-enters A exactly at the cap
  // (operationDepth 4): the in-flight cycle check outranks the nesting
  // cap, so the failure is op-cycle, not nesting-limit.
  const pc3Ops9 = [
    pc3Op('op_pc3a', 'A', 'SET z = ROLL [pc3ta]', '%z%'),
    pc3Op('op_pc3b', 'B', 'SET z = ROLL [pc3tb]', '%z%'),
    pc3Op('op_pc3c', 'C', 'SET z = ROLL [pc3tc]', '%z%'),
    pc3Op('op_pc3d', 'D', 'SET z = ROLL [pc3td]', '%z%'),
  ];
  const pc3Tbl9a = pc3Tbl('pc3ta', 'pc3ta', '{B}');
  const pc3Tbl9b = pc3Tbl('pc3tb', 'pc3tb', '{C}');
  const pc3Tbl9c = pc3Tbl('pc3tc', 'pc3tc', '{D}');
  const pc3Tbl9d = pc3Tbl('pc3td', 'pc3td', '{A}');
  const pc3Gen9 = pc3Gen('g_pc3t9', 'PC3T9', '{A}');
  let run = RG(pc3Gen9, [pc3Tbl9a, pc3Tbl9b, pc3Tbl9c, pc3Tbl9d], pc3RollFirst, pc3Ctx({
    containers: [pc3Tbl9a, pc3Tbl9b, pc3Tbl9c, pc3Tbl9d], operations: pc3Ops9,
  }));
  check('pc3 T9: a 4-op cycle reaching the cap fails with op-cycle, not nesting-limit',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}'
      && run.errors[0].position === 0
      && deepEq(run.errors[0].chain, ['A', 'B', 'C', 'D', 'A']));
  check('pc3 T9: the failed span keeps its raw token; op rolls are not template rolls',
    run.output === '{A}' && run.rolls.length === 0);

  // T10 — MAX_RESOLUTIONS (1,000) at its boundary: exactly 1,000 resolutions
  // resolve; one past is already pinned by 'p3 d21: a resolution budget at
  // the cap trips nesting-limit on the next ROLL'.
  check('pc3 T10: exactly MAX_RESOLUTIONS resolutions resolve (boundary)',
    (function () {
      const r = LEval('SET x = ROLL ((1-6))', {
        rng: LERng([0]), budget: { resolutions: GLIMITS.MAX_RESOLUTIONS - 1, chars: 0 },
      });
      return r.ok === true && r.variables.x.type === 'number';
    })());

  // T11 — MAX_OUTPUT_CHARS (100,000) at its boundary: exactly 100,000
  // characters resolve; one past is already pinned by 'p3 budget: plain
  // text over cap is refused' (100,001 chars).
  check('pc3 T11: exactly MAX_OUTPUT_CHARS resolves (boundary)',
    (function () {
      const r = T.resolveEmbed('y'.repeat(GLIMITS.MAX_OUTPUT_CHARS), {
        macros: [], evalExpr: () => 0, rng: () => 0, containers: [], tableFile: '',
      });
      return r.ok === true && r.output.length === GLIMITS.MAX_OUTPUT_CHARS;
    })());
}

// ------------------------------------------------------------------
// error surfacing through the existing UI paths. The new
// kinds carry self-describing diagnostics that survive every hop back
// to the template, so the mappers (genErrorMessage / embedErrorMessage /
// logicRunErrorMessage) render a clear, correctly-attributed sentence:
// op-cycle names its own cycle path (never a legal ancestor), each
// nesting-limit origin names the specific limit that fired, and
// missing-import keeps the variable name and the message through
// the re-anchor.
// ------------------------------------------------------------------
{
  const RG = T.runGenerator;
  const pc4Ctx = (extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng([0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);
  const pc4Tbl = (id, name, label) => ({ id: id, name: name, entries: [{ label: label, weight: 1 }] });
  const pc4Op = (id, name, script, outputTemplate) => ({
    id: id, name: name, purpose: '', script: script, outputTemplate: outputTemplate || '',
  });
  const pc4Gen = (id, name, template) => {
    const g = { id: id, name: name, template: template, references: [], operations: [] };
    T.normalizeGeneratorItem(g, { macros: [] });
    return g;
  };
  const pc4RollFirst = (c) => c.entries[0];

  // S1 — the op-cycle diagnostic carries a message naming the cycle path,
  // and it survives the hop back to the template.
  const pc4Ops1 = [
    pc4Op('op_pc4a', 'A', 'SET z = ROLL [pc4ta]', '%z%'),
    pc4Op('op_pc4b', 'B', 'SET z = ROLL [pc4tb]', '%z%'),
  ];
  const pc4Tbl1a = pc4Tbl('pc4ta', 'pc4ta', '{B}');
  const pc4Tbl1b = pc4Tbl('pc4tb', 'pc4tb', '{A}');
  const pc4Gen1 = pc4Gen('g_pc4t1', 'PC4T1', '{A}');
  let run = RG(pc4Gen1, [pc4Tbl1a, pc4Tbl1b], pc4RollFirst, pc4Ctx({
    containers: [pc4Tbl1a, pc4Tbl1b], operations: pc4Ops1,
  }));
  check('pc4 S1: op-cycle carries a message naming the cycle path',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && run.errors[0].message === 'circular operation reference "A" -> "B" -> "A" - remove one call to break the loop'
      && deepEq(run.errors[0].chain, ['A', 'B', 'A'])
      && run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}');

  // S2 — a lower cycle (A above B->C->B) names the cycle itself, not the
 // legal ancestor above it (no misattribution,).
  const pc4Ops2 = [
    pc4Op('op_pc4a', 'A', 'SET z = ROLL [pc4ta]', '%z%'),
    pc4Op('op_pc4b', 'B', 'SET z = ROLL [pc4tb]', '%z%'),
    pc4Op('op_pc4c', 'C', 'SET z = ROLL [pc4tc]', '%z%'),
  ];
  const pc4Tbl2a = pc4Tbl('pc4ta', 'pc4ta', '{B}');
  const pc4Tbl2b = pc4Tbl('pc4tb', 'pc4tb', '{C}');
  const pc4Tbl2c = pc4Tbl('pc4tc', 'pc4tc', '{B}');
  const pc4Gen2 = pc4Gen('g_pc4t2', 'PC4T2', '{A}');
  run = RG(pc4Gen2, [pc4Tbl2a, pc4Tbl2b, pc4Tbl2c], pc4RollFirst, pc4Ctx({
    containers: [pc4Tbl2a, pc4Tbl2b, pc4Tbl2c], operations: pc4Ops2,
  }));
  check('pc4 S2: a lower cycle names its own path, not the legal ancestor',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'op-cycle'
      && run.errors[0].message === 'circular operation reference "B" -> "C" -> "B" - remove one call to break the loop'
      && deepEq(run.errors[0].chain, ['B', 'C', 'B'])
      && run.errors[0].operationName === 'A');

  // S3 — the 5-deep ROLL-descent nesting-limit names the 4-level op cap
  // (the specific limit), surviving the hops back to the top span.
  const pc4Ops3 = [
    pc4Op('op_pc4a', 'A', 'SET z = ROLL [pc4ta]', '%z%'),
    pc4Op('op_pc4b', 'B', 'SET z = ROLL [pc4tb]', '%z%'),
    pc4Op('op_pc4c', 'C', 'SET z = ROLL [pc4tc]', '%z%'),
    pc4Op('op_pc4d', 'D', 'SET z = ROLL [pc4td]', '%z%'),
    pc4Op('op_pc4e', 'E', 'SET e = 5', '%e%'),
  ];
  const pc4Tbl3a = pc4Tbl('pc4ta', 'pc4ta', '{B}');
  const pc4Tbl3b = pc4Tbl('pc4tb', 'pc4tb', '{C}');
  const pc4Tbl3c = pc4Tbl('pc4tc', 'pc4tc', '{D}');
  const pc4Tbl3d = pc4Tbl('pc4td', 'pc4td', '{E}');
  const pc4Gen3 = pc4Gen('g_pc4t3', 'PC4T3', '{A}');
  run = RG(pc4Gen3, [pc4Tbl3a, pc4Tbl3b, pc4Tbl3c, pc4Tbl3d], pc4RollFirst, pc4Ctx({
    containers: [pc4Tbl3a, pc4Tbl3b, pc4Tbl3c, pc4Tbl3d], operations: pc4Ops3,
  }));
  check('pc4 S3: the 5-deep nesting-limit names the 4-level op cap',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'nesting-limit'
      && run.errors[0].message === 'nested operation depth exceeded 4 levels'
      && run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}');

  // S4 — an op whose output template overflows the char cap names the
  // limit, not a generic failure.
  run = RG(pc4Gen('g_pc4t4', 'PC4T4', '{A}'), [], () => null, pc4Ctx({
    operations: [pc4Op('op_pc4a', 'A',
      'SET s = "' + 'x'.repeat(GLIMITS.MAX_OUTPUT_CHARS + 1) + '"', '%s%')],
  }));
  check('pc4 S4: op output over the char cap is nesting-limit naming the cap',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'nesting-limit'
      && run.errors[0].message === 'operation output exceeded ' + GLIMITS.MAX_OUTPUT_CHARS + ' characters'
      && run.errors[0].operationName === 'A');

  // S5 — a forward dependency (IMPORT with no earlier binder) keeps the
 // variable name and the generator message through the re-anchor.
  run = RG(pc4Gen('g_pc4t5', 'PC4T5', '{A}'), [], () => null, pc4Ctx({
    operations: [pc4Op('op_pc4a', 'A', 'IMPORT %x%', '%x%')],
  }));
  check('pc4 S5: a forward-dep missing-import keeps the variable and message',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].varName === 'x'
      && run.errors[0].message === 'IMPORT "x" has no value in this generator run \u2014 no earlier part of the run supplied it'
      && run.errors[0].operationName === 'A'
      && run.errors[0].token === '{A}');

  // S6 — an op span past the shared resolution cap names the cap (not the
  // generic container wording). 1,000 spans resolve; the 1,001st is
  // refused before it executes.
  run = RG(pc4Gen('g_pc4t6', 'PC4T6', '{D} '.repeat(GLIMITS.MAX_RESOLUTIONS + 1).trim()), [], () => null,
    pc4Ctx({ operations: [pc4Op('op_pc4d', 'D', 'SET d = 7', '%d%')] }));
  check('pc4 S6: an op span past the resolution cap names the cap',
    run.ok === false && run.errors.length === 1
      && run.errors[0].kind === 'nesting-limit'
      && run.errors[0].message === 'execution exceeded ' + GLIMITS.MAX_RESOLUTIONS + ' resolutions'
      && run.errors[0].token === '{D}');
}

{
 // A3 — (1) a null roll no longer drops earlier spans' errors
  // (2) a script-typed op without its script string is rejected by
  // validation, not discovered at run time.
  const RG = T.runGenerator;
  const VG = T.validateGenerator;
  const a3Ctx = (draws, extra) => Object.assign({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: seqRng(draws && draws.length ? draws : [0.5]),
    containers: [],
    operations: [],
    tableFile: '',
  }, extra);
  const a3Gen = (id, name, template) => ({
    id, name, template, references: [], operations: [],
  });

  // (1) An all-zero-weight container rolls to nothing. The failed op
  // BEFORE it in the template must survive the short-circuit, and both
  // errors report in source order.
  const a3Ops1 = [
    { id: 'op_a3bad', name: 'Bad', purpose: '',
      script: 'IMPORT %ghost%', outputTemplate: '%x%',
      imports: [], exposed: [], bindings: {}, occurrences: [] },
  ];
  const a3Zero = {
    id: 'tbl_a3zero', name: 'zero',
    entries: [
      { label: 'first', weight: 0 },
      { label: 'second', weight: 0 },
    ],
  };
  const a3ZeroRoll = (c) => {
    const total = (c && Array.isArray(c.entries) ? c.entries : [])
      .reduce((s, e) => s + (e && e.weight > 0 ? e.weight : 0), 0);
    return total > 0 ? c.entries[0] : null;
  };
  const a3Gen1 = a3Gen('g_a3_1', 'A3One', '{Bad} [zero]');
  T.normalizeGeneratorItem(a3Gen1, { macros: [] });
  let run = RG(a3Gen1, [a3Zero], a3ZeroRoll, a3Ctx([0.5], {
    containers: [a3Zero], operations: a3Ops1,
  }));
  check('a3 R1: a null roll keeps the earlier span errors',
    run.ok === false && run.errors.length === 2);
  check('a3 R1: both errors report in source order',
    run.errors.length === 2
      && run.errors[0].kind === 'missing-import'
      && run.errors[0].operationName === 'Bad'
      && run.errors[1].kind === 'empty'
      && run.errors[1].token === 'zero'
      && run.errors[1].occurrences.length === 1);

  // (2) A script-typed op lacking its script string is rejected by
  // validation in the operations[i] vocabulary; execution never starts,
  // so no partial state exists.
  const a3Ops2 = [
    { id: 'op_a3n', name: 'NoScript', type: 'script', purpose: '',
      outputTemplate: '' },
  ];
  const a3Gen2 = a3Gen('g_a3_2', 'A3Two', '{NoScript}');
  T.normalizeGeneratorItem(a3Gen2, { macros: [] });
  const a3Val2 = VG(a3Gen2, [], a3Ops2);
  check('a3 V2: a script op without a script fails validation',
    a3Val2.ok === false && a3Val2.errors.length === 1);
  check('a3 V2: the per-op error keeps the operations[i] vocabulary',
    a3Val2.errors.length === 1
      && a3Val2.errors[0].kind === 'unsupported-operation'
      && a3Val2.errors[0].token === 'NoScript'
      && a3Val2.errors[0].message === 'operations[0]: code is required.');
  checkDeep('a3 V2: the op error keeps the span occurrences',
    a3Val2.errors[0].occurrences, [{ index: 0, position: 0 }]);
  run = RG(a3Gen2, [], () => null, a3Ctx([0.5], { operations: a3Ops2 }));
  check('a3 V2: the rejection happens before execution (no partial state)',
    run.ok === false && run.errors.length === 1
      && run.errors[0].message === 'operations[0]: code is required.');
  checkDeep('a3 V2: the short-circuit returns only ok and errors',
    Object.keys(run).sort(), ['errors', 'ok']);

  // An empty script string is the same validation failure.
  const a3Ops3 = [
    { id: 'op_a3e', name: 'EmptyScript', type: 'script', script: '', purpose: '',
      outputTemplate: '' },
  ];
  const a3Gen3 = a3Gen('g_a3_3', 'A3Three', '{EmptyScript}');
  T.normalizeGeneratorItem(a3Gen3, { macros: [] });
  const a3Val3 = VG(a3Gen3, [], a3Ops3);
  check('a3 V2: an empty script string also fails validation',
    a3Val3.ok === false && a3Val3.errors.length === 1
      && a3Val3.errors[0].kind === 'unsupported-operation'
      && a3Val3.errors[0].message === 'operations[0]: code is required.');

  // A non-string script takes the bundle validator's other wording.
  const a3Ops4 = [
    { id: 'op_a3ns', name: 'NumScript', type: 'script', script: 42, purpose: '',
      outputTemplate: '' },
  ];
  const a3Gen4 = a3Gen('g_a3_4', 'A3Four', '{NumScript}');
  T.normalizeGeneratorItem(a3Gen4, { macros: [] });
  const a3Val4 = VG(a3Gen4, [], a3Ops4);
  check('a3 V2: a non-string script uses the other bundle wording',
    a3Val4.ok === false && a3Val4.errors.length === 1
      && a3Val4.errors[0].kind === 'unsupported-operation'
      && a3Val4.errors[0].message === 'operations[0]: code must be a string.');
}

// ------------------- Multi-draw SET: engine + evaluator ----------------
// weightedPickDistinct (tables), broadcast/EACH/UNIQUE evaluation (evaluator),
// the run-local exclusion pool and UNIQUE pre-validation (engine). Parse-level
// forms are covered by the earlier parse-level block; everything here executes them.
{
  const RG = T.runGenerator;
  const VG = T.validateGenerator;

  // Uniform containers, all named 'Swords' so the [Swords] ref resolves to
  // the one container of that name passed in.
  const swordsEntries = (n) => Array.from({ length: n },
    (_, k) => ({ label: String.fromCharCode(65 + k), weight: 1 }));
  const MD2 = { id: 'tbl_md2', name: 'Swords', file: '', entries: swordsEntries(2) };
  const MD3 = { id: 'tbl_md3', name: 'Swords', file: '', entries: swordsEntries(3) };
  const MD4 = { id: 'tbl_md4', name: 'Swords', file: '', entries: swordsEntries(4) };
  const MD6 = { id: 'tbl_md6', name: 'Swords', file: '', entries: swordsEntries(6) };
  const chest = {
    id: 'tbl_mdchest', name: 'chest', file: '',
    entries: [
      { label: 'Sword', weight: 1 },
      { label: 'Axe', weight: 1 },
      { label: 'Pick', weight: 1 },
    ],
  };
  const op = (name, script, outputTemplate) => ({
    id: 'op_md_' + name, name, purpose: '', script, outputTemplate,
  });
  const gen = (id, name, template) => {
    const g = { id, name, template, references: [], operations: [] };
    T.normalizeGeneratorItem(g, { macros: [] });
    return g;
  };
  const ctx = (rng, containers, operations, tableFile) => ({
    macros: [],
    evalExpr: (expr) => T.evaluate(expr, seqRng([0.5])).value,
    rng: rng,
    containers: containers || [],
    operations: operations || [],
    tableFile: tableFile || '',
  });
  const rollFirst = (container) =>
    (container && Array.isArray(container.entries) && container.entries.length)
      ? container.entries[0] : null;

  // ---- weightedPickDistinct: the without-replacement draw itself ----
  const rows3 = swordsEntries(3);
  checkDeep('md wpd: n=3 uniform rows, rng 0 -> full draw order',
    T.weightedPickDistinct(rows3, 3, LERng([0])), rows3);
  checkEq('md wpd: the input rows are not removed', rows3.length, 3);
  checkDeep('md wpd: n=2 -> the first two rows',
    T.weightedPickDistinct(rows3, 2, LERng([0])), [rows3[0], rows3[1]]);
  check('md wpd: n=4 > 3 drawable -> null (caller reports the shortage)',
    T.weightedPickDistinct(rows3, 4, LERng([0])) === null);
  checkDeep('md wpd: n=0 -> the empty array',
    T.weightedPickDistinct(rows3, 0, LERng([0])), []);
  const zwRows = [
    { label: 'A', weight: 1 }, { label: 'B', weight: 0 }, { label: 'C', weight: 1 },
  ];
  checkDeep('md wpd: a zero-weight row is never drawable',
    T.weightedPickDistinct(zwRows, 2, LERng([0])), [zwRows[0], zwRows[2]]);
  const w2Rows = [{ label: 'A', weight: 1 }, { label: 'B', weight: 3 }];
  checkDeep('md wpd: weighted order (0.9 lands on B first, then A)',
    T.weightedPickDistinct(w2Rows, 2, LERng([0.9])), [w2Rows[1], w2Rows[0]]);

  // ---- error-kind pin: the engine vocabulary for a short UNIQUE group ----
  checkEq('md: the engine error kind pin', LL.ERR.BAD_UNIQUE, 'bad-unique');

  // ---- evaluator: broadcast (one evaluation feeds every name) ----
  let rng = LERng([0]);
  let r = LEval('SET a, b, c = ROLL [chest]', { containers: [chest], rng });
  check('md eval: a broadcast ROLL draws once and shares the label',
    r.ok === true && r.variables.a.value === 'Sword'
    && r.variables.b.value === 'Sword' && r.variables.c.value === 'Sword'
    && rng.draws === 1);
  r = LEval('SET a, b = 5');
  check('md eval: a broadcast plain value keeps its type for every name',
    r.ok === true && r.variables.a.type === 'number' && r.variables.a.value === 5
    && r.variables.b.type === 'number' && r.variables.b.value === 5);

  // ---- evaluator: zip (N sources paired by position) ----
  r = LEval('SET a, b = 5, "x"');
  check('md eval: zip pairs values by position',
    r.ok === true && r.variables.a.type === 'number' && r.variables.a.value === 5
    && r.variables.b.type === 'string' && r.variables.b.value === 'x');
  rng = LERng([0]);
  r = LEval('SET a, b = ROLL [chest], 3', { containers: [chest], rng });
  check('md eval: zip evaluates each source once',
    r.ok === true && r.variables.a.value === 'Sword'
    && r.variables.b.type === 'number' && r.variables.b.value === 3 && rng.draws === 1);

  // ---- evaluator: EACH (the sole ROLL source rolls once per name) ----
  rng = LERng([0, 0, 0]);
  r = LEval('SET a, b, c = EACH ROLL [chest]', { containers: [chest], rng });
  check('md eval: EACH ROLL re-rolls per name (dupes allowed)',
    r.ok === true && r.variables.a.value === 'Sword'
    && r.variables.b.value === 'Sword' && r.variables.c.value === 'Sword'
    && rng.draws === 3);
  rng = LERng([0, 0.5, 1]);
  r = LEval('SET a, b, c = EACH ROLL [chest]', { containers: [chest], rng });
  check('md eval: EACH ROLL with a spread rng hits distinct rows',
    r.ok === true && r.variables.a.value === 'Sword'
    && r.variables.b.value === 'Axe' && r.variables.c.value === 'Pick');

  // ---- evaluator: UNIQUE (N distinct draws without replacement) ----
  rng = LERng([0, 0, 0]);
  r = LEval('SET a, b, c = UNIQUE [Swords]', { containers: [MD6], rng });
  check('md eval: UNIQUE draws distinct rows in name order',
    r.ok === true && r.variables.a.value === 'A'
    && r.variables.b.value === 'B' && r.variables.c.value === 'C');
  checkDeep('md eval: a UNIQUE trace entry marks source unique with the row label',
    r.trace[0], {
      kind: 'set', line: 1, name: 'a', type: 'string', value: 'A', source: 'unique',
      roll: { kind: 'container', token: '[Swords]', output: 'A', entryLabel: 'A' },
      step: 1,
    });
  rng = LERng([0]);
  r = LEval('SET x = UNIQUE [Swords]', { containers: [MD4], rng });
  check('md eval: a single-name UNIQUE is one distinct draw',
    r.ok === true && r.variables.x.value === 'A');
  rng = LERng([0, 0, 0]);
  r = LEval('SET a, b, c = UNIQUE [Swords]', { containers: [MD2], rng });
  check('md eval: exhausting a container is a bad-unique error',
    r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'bad-unique'
    && r.errors[0].message === 'UNIQUE group needs 3 rows, "Swords" has 2 drawable');
  checkEq('md eval: the exhaustion kind IS the engine kind', r.errors[0].kind, LL.ERR.BAD_UNIQUE);
  const zwCont = {
    id: 'tbl_mdzw', name: 'Swords', file: '',
    entries: [
      { label: 'A', weight: 1 }, { label: 'B', weight: 0 }, { label: 'C', weight: 1 },
    ],
  };
  rng = LERng([0, 0, 0]);
  r = LEval('SET a, b, c = UNIQUE [Swords]', { containers: [zwCont], rng });
  check('md eval: zero-weight rows are not drawable (3 vars, 2 drawable)',
    r.ok === false && r.errors[0].kind === 'bad-unique'
    && r.errors[0].message === 'UNIQUE group needs 3 rows, "Swords" has 2 drawable');
  rng = LERng([0, 0]);
  r = LEval('SET a, b = UNIQUE [Swords]', { containers: [zwCont], rng });
  check('md eval: a zero-weight row is skipped, the rest stay distinct',
    r.ok === true && r.variables.a.value === 'A' && r.variables.b.value === 'C');
  r = LEval('SET a, b = UNIQUE [Nope]', { containers: [MD4], rng: LERng([0, 0]) });
  check('md eval: UNIQUE on a missing container',
    r.ok === false && r.errors[0].kind === 'missing-container');
  const amb = [
    { id: 't_md1', name: 'Swords', file: '', entries: swordsEntries(2) },
    { id: 't_md2x', name: 'Swords', file: '', entries: swordsEntries(3) },
  ];
  r = LEval('SET a, b = UNIQUE [Swords]', { containers: amb, rng: LERng([0, 0]) });
  check('md eval: UNIQUE on an ambiguous container',
    r.ok === false && r.errors[0].kind === 'ambiguous-container');

  // ---- evaluator: the exclusion pool spans statements, not calls ----
  rng = LERng([0, 0, 0, 0]);
  r = LEval('SET a, b = UNIQUE [Swords]\nSET c, d = UNIQUE [Swords]',
    { containers: [MD4], rng });
  check('md eval: the pool spans statements in one run (no redraw)',
    r.ok === true && r.variables.a.value === 'A' && r.variables.b.value === 'B'
    && r.variables.c.value === 'C' && r.variables.d.value === 'D');
  rng = LERng([0, 0, 0, 0]);
  r = LEval('SET a, b = UNIQUE [Swords]\nSET c, d = UNIQUE [Swords]',
    { containers: [MD3], rng });
  check('md eval: the pool exhausts a 3-row container mid-run',
    r.ok === false && r.errors.length === 1 && r.errors[0].kind === 'bad-unique'
    && r.errors[0].message === 'UNIQUE group needs 2 rows, "Swords" has 1 drawable');
  const r1 = LEval('SET a, b = UNIQUE [Swords]',
    { containers: [MD4], rng: LERng([0, 0]) });
  const r2 = LEval('SET a, b = UNIQUE [Swords]',
    { containers: [MD4], rng: LERng([0, 0]) });
  check('md eval: separate runs get fresh pools (no leak across calls)',
    r1.ok === true && r2.ok === true && r1.variables.a.value === 'A'
    && r2.variables.a.value === 'A' && r1.variables.b.value === 'B'
    && r2.variables.b.value === 'B');
  // The pool follows the container, not the token's spelling: a
  // case-variant ref resolves to the same container and shares its pool.
  rng = LERng([0, 0, 0, 0]);
  r = LEval('SET a, b = UNIQUE [Swords]\nSET c, d = UNIQUE [swords]',
    { containers: [MD4], rng });
  check('md eval: case-variant spellings of one container share the pool',
    r.ok === true && r.variables.a.value === 'A' && r.variables.b.value === 'B'
    && r.variables.c.value === 'C' && r.variables.d.value === 'D');

  // ---- evaluator: distribution sanity (distinctness and support, no exact values)
  const labels6 = MD6.entries.map((e) => e.label);
  const firsts = new Set();
  let distOk = true;
  for (let i = 0; i < 40; i += 1) {
    const rr = LEval('SET a, b, c = UNIQUE [Swords]',
      { containers: [MD6], rng: LERng([i / 41]) });
    if (!rr.ok) { distOk = false; break; }
    const vals = [rr.variables.a.value, rr.variables.b.value, rr.variables.c.value];
    firsts.add(vals[0]);
    if (new Set(vals).size !== 3
      || vals.some((v) => labels6.indexOf(v) === -1)) { distOk = false; break; }
  }
  check('md distribution: 40 rounds stay pairwise distinct inside the 6-row support',
    distOk === true && firsts.size >= 2);

  // ---- engine: the run pool is shared across the run's script ops ----
  const U1 = op('U1', 'SET x, y = UNIQUE [Swords]', '%x% %y%');
  const U2 = op('U2', 'SET x, y = UNIQUE [Swords]', '%x% %y%');
  let run = RG(gen('g_md4', 'MD4', '{U1} | {U2}'), [MD4], rollFirst,
    ctx(seqRng([0, 0, 0, 0]), [MD4], [U1, U2]));
  check('md engine: two UNIQUE ops share the run pool (A B | C D)',
    run.ok === true && run.output === 'A B | C D');
  checkEq('md engine: a script-op run records no container rolls', run.rolls.length, 0);
  run = RG(gen('g_md4b', 'MD4B', '{U1} | {U2}'), [MD4], rollFirst,
    ctx(seqRng([0, 0, 0, 0]), [MD4], [U1, U2]));
  check('md engine: a fresh run redraws the full pool',
    run.ok === true && run.output === 'A B | C D');
  run = RG(gen('g_md2', 'MD2', '{U1} | {U2}'), [MD2], rollFirst,
    ctx(seqRng([0, 0, 0, 0]), [MD2], [U1, U2]));
  check('md engine: a 2-row container exhausts on the second op',
    run.ok === false && run.errors.length >= 1
    && run.errors.some((e) => e.kind === 'bad-unique'));
  const UC = op('UC', 'SET x, y = UNIQUE [swords]', '%x% %y%');
  run = RG(gen('g_mdc', 'MDC', '{U1} | {UC}'), [MD4], rollFirst,
    ctx(seqRng([0, 0, 0, 0]), [MD4], [U1, UC]));
  check('md engine: case-variant ops share the run pool (A B | C D)',
    run.ok === true && run.output === 'A B | C D');

  // ---- engine: UNIQUE pre-validation (validateGenerator before any run) ----
  const BadU = op('BadU', 'SET a, b, c = UNIQUE [Swords]', '%a%');
  let v = VG(gen('g_mdbad', 'MDBad', '{BadU}'), [MD2], [BadU]);
  check('md validate: a 3-var UNIQUE over a 2-row container is rejected pre-run',
    v.ok === false && v.errors.length === 1 && v.errors[0].kind === 'bad-unique'
    && v.errors[0].message === 'UNIQUE group needs 3 rows, "Swords" has 2 drawable');
  checkEq('md validate: the pre-run kind IS the engine kind', v.errors[0].kind, LL.ERR.BAD_UNIQUE);
  run = RG(gen('g_mdbad', 'MDBad', '{BadU}'), [MD2], rollFirst,
    ctx(seqRng([0]), [MD2], [BadU]));
  checkDeep('md validate: a pre-rejected run returns no output key',
    Object.keys(run).sort(), ['errors', 'ok']);
  v = VG(gen('g_mdok', 'MDOk', '{BadU}'), [MD3], [BadU]);
  check('md validate: a 3-var UNIQUE over a 3-row container passes', v.ok === true);
  const IFU = op('IFU',
    'IF 1 == 1 THEN:\n    SET a, b, c = UNIQUE [Swords]\nELSE:\n    SET z = 1', '%a%');
  v = VG(gen('g_mdif', 'MDIf', '{IFU}'), [MD2], [IFU]);
  check('md validate: a UNIQUE inside an IF branch is pre-validated too',
    v.ok === false && v.errors.some((e) => e.kind === 'bad-unique'));
  const IFU2 = op('IFU2',
    'IF 1 == 1 THEN:\n    SET a, b = UNIQUE [Swords]\nELSE:\n    SET z = 1', '%a%');
  v = VG(gen('g_mdif2', 'MDIf2', '{IFU2}'), [MD2], [IFU2]);
  check('md validate: a 2-var UNIQUE inside an IF branch passes', v.ok === true);
  // Same-named containers in two files: without a scope the name is
  // ambiguous (0 drawable); with the run's tableFile, validation agrees
  // with the file-preferring runtime.
  const f1 = { id: 'tbl_mdf1', name: 'Swords', file: 'tables/f1.json',
    entries: swordsEntries(1) };
  const f2 = { id: 'tbl_mdf2', name: 'Swords', file: 'tables/f2.json',
    entries: swordsEntries(4) };
  const U3 = op('U3', 'SET x, y = UNIQUE [Swords]', '%x% %y%');
  v = VG(gen('g_mdfx', 'MDFx', '{U3}'), [f1, f2], [U3]);
  check('md validate: cross-file same-name UNIQUE is ambiguous without a scope',
    v.ok === false && v.errors.some((e) => e.kind === 'bad-unique'));
  v = VG(gen('g_mdfx2', 'MDFx2', '{U3}'), [f1, f2], [U3], 'tables/f2.json');
  check('md validate: a run tableFile scopes UNIQUE validation like the runtime',
    v.ok === true);
  run = RG(gen('g_mdfx3', 'MDFx3', '{U3}'), [f1, f2], rollFirst,
    ctx(seqRng([0, 0]), [f1, f2], [U3], 'tables/f2.json'));
  check('md engine: a file-scoped run resolves its own-file container',
    run.ok === true && run.output === 'A B');

  // ---- persistence: the new forms survive a bundle round-trip byte-identically
  const mdScript = '# multi-draw forms\nSET a, b, c = EACH ROLL [chest]\n'
    + 'SET d, e = UNIQUE [Swords]\nSET f, g = 5, "x"\n';
  const mdParsed = T.parseLogicOpsBundle(
    JSON.stringify(T.buildLogicOpsBundle(
      [T.exportLogicOperation(P4Op({ name: 'MDP', script: mdScript, outputTemplate: '%a%' }))])));
  check('md persist: the new forms round-trip byte-identically',
    mdParsed.ok === true && mdParsed.operations[0].script === mdScript);

  // ---- executeOperation end-to-end: a standalone script op runs UNIQUE
  r = T.executeOperation(P4Op({
    name: 'MDX',
    script: 'SET a, b = UNIQUE [Swords]\nEXPOSE a\nEXPOSE b',
    outputTemplate: '%a%|%b%',
  }), { containers: [MD4], rng: LERng([0, 0]) });
  check('md op: a standalone script op runs UNIQUE end-to-end',
    r.ok === true && r.output === 'A|B');
}

// ------------------------------------------------------------------ audit
// Distributable message audit: no user-facing message may carry an
// internal reference (the hasInternalRef predicate below defines what
// counts: bare numeric tokens, section symbols, or the doc-name
// strings). Walks the ERR / EVAL_ERR vocabulary objects and every
// audited message site, produced live through the public APIs; the
// three DOM-rendered hints (this sandbox has no DOM) are pinned by their exact expected wording in the source.
(function auditNoInternalRefs() {
  const hasInternalRef = (m) => /D\d+/.test(m) || /\u00a7\d+/.test(m) || /Logic-System|Feature-Plans/i.test(m);
  const sites = [];
  const site = (id, msg) => sites.push([id, String(msg == null ? '' : msg)]);

  // (a) vocabulary objects (error kind ids must stay doc-ref free too)
  for (const k of Object.keys(LL.ERR)) site('ll.ERR.' + k, LL.ERR[k]);
  for (const k of Object.keys(T.LogicEvaluator.EVAL_ERR)) site('le.EVAL_ERR.' + k, T.LogicEvaluator.EVAL_ERR[k]);

  // (b) the 16 audited message sites, produced live
  site('import generator run', (function () {
    const r = T.LogicEvaluator.evaluate('IMPORT %w%', { importSource: 'generator' });
    return r.errors && r.errors[0] && r.errors[0].message;
  })());
  site('import plain', (function () {
    const r = T.LogicEvaluator.evaluate('IMPORT %w%');
    return r.errors && r.errors[0] && r.errors[0].message;
  })());
  site('reserved boolean literal', (function () {
    try { T.LogicLanguage.normalizeName('true'); } catch (e) { return e.message; }
    return null;
  })());
  site('semicolon separator', (function () {
    const p = T.LogicLanguage.parseScript('SET x = 1; SET y = 2');
    return p.errors && p.errors[0] && p.errors[0].message;
  })());
  site('OUTPUT not a keyword', (function () {
    const p = T.LogicLanguage.parseScript('OUTPUT rarity');
    return p.errors && p.errors[0] && p.errors[0].message;
  })());
  site('expose branch-only warning', (function () {
    const v = T.logicValidationReport('SET a = 2\nIF a == 2 THEN:\n    SET hit = 5\nEXPOSE hit', '', []);
    const w = (v.warnings || []).find((x) => x.kind === 'expose-branch-only-variable');
    return w && w.message;
  })());
  site('expose never-defined error', (function () {
    const v = T.logicValidationReport('IMPORT %attack%\nEXPOSE %test1%', '%attack%', ['attack']);
    const e = (v.errors || []).find((x) => x.kind === 'expose-undefined-variable');
    return e && e.message;
  })());
  site('template maybe-unset warning', (function () {
    const v = T.logicValidationReport('SET a = 1\nIF a == 1 THEN:\n    SET m = 2', '%m%', []);
    const w = (v.warnings || []).find((x) => x.kind === 'maybe-unset-template-variable');
    return w && w.message;
  })());
  site('run EXPOSE no value', (function () {
    const r = T.executeOperation(
      P4Op({ name: 'A1', script: 'IMPORT %attack%\nEXPOSE %test1%', outputTemplate: '%attack%' }),
      { values: { attack: 5 }, rng: LERng([0]) });
    const e = r.errors && r.errors[0];
    return e ? T.logicRunErrorMessage(e) : null;
  })());
  site('run template no value', (function () {
    const r = T.executeOperation(
      P4Op({ name: 'A2', script: 'SET a = 1\nIF a == 2 THEN:\n    SET m = 2', outputTemplate: '%m%' }),
      { rng: LERng([0]) });
    const e = r.errors && r.errors[0];
    return e ? T.logicRunErrorMessage(e) : null;
  })());
  site('run type-mismatch', T.logicRunErrorMessage({ kind: 'type-mismatch', message: 'boolean vs number' }));
  site('compare type-mismatch', (function () {
    const r = T.executeOperation(
      P4Op({ name: 'A3', script: 'SET a = 1\nSET b = true\nIF a == b THEN:\n    SET c = 1\nEXPOSE c', outputTemplate: '%c%' }),
      { rng: LERng([0]) });
    const e = r.errors && r.errors[0];
    return e && e.message;
  })());
  site('validate bad name', (function () {
    const op = pbCleanOp();
    op.imports = ['a b!'];
    const v = T.validateLogicOperation(op);
    const e = (v || []).find((x) => x.kind === 'bad-name');
    return e && e.message;
  })());

  // (c) DOM-rendered hints: the exact user-facing wording must survive in the source
  const srcHint = (frag) => {
    const m = appSource.match(new RegExp("'(" + frag + "[^']*)'"));
    return m ? m[1] : null;
  };
  site('test-panel hint (source)', srcHint('Test values are entered'));
  site('trace header (source)', srcHint('Execution trace'));
  site('presentation-only hint (source)', srcHint('Presentation only:'));

  const flagged = sites.filter((s) => hasInternalRef(s[1]));
  check('audit: no user-facing message carries an internal doc ref', flagged.length === 0,
    flagged.length ? flagged.map((s) => s[0] + ' -> ' + s[1]).join(' | ') : 'clean: ' + sites.length + ' messages scanned');
  check('audit: every audited site produced a non-empty message',
    sites.every((s) => s[1] !== ''), sites.filter((s) => s[1] === '').map((s) => s[0]).join(', ') || 'none');

  const byId = {};
  for (const s of sites) byId[s[0]] = s[1];
  checkEq('audit: import-generator message matches the expected', byId['import generator run'],
    'IMPORT "w" has no value in this generator run \u2014 no earlier part of the run supplied it');
  checkEq('audit: import-plain message matches the expected', byId['import plain'],
    'IMPORT "w" has no value \u2014 supply it for this run');
  checkEq('audit: reserved-boolean-literal message matches the expected', byId['reserved boolean literal'],
    '"true" is a reserved boolean literal and cannot be a variable name');
  checkEq('audit: semicolon message matches the expected', byId['semicolon separator'],
    "';' is not a statement separator: one statement per line");
  checkEq('audit: OUTPUT message matches the expected', byId['OUTPUT not a keyword'],
    'OUTPUT is not a keyword \u2014 use the Output Template field for formatting');
  checkEq('audit: expose branch-only warning matches the expected', byId['expose branch-only warning'],
    'EXPOSE %hit% can run with no value: %hit% is only SET on some code paths');
  checkEq('audit: expose never-defined error matches the expected', byId['expose never-defined error'],
    'EXPOSE %test1% has no value: %test1% is never SET or IMPORTed, so it can never be exposed');
  checkEq('audit: template maybe-unset warning matches the expected', byId['template maybe-unset warning'],
    '%m% is only set on some code paths, so the template can fail at runtime');
  checkEq('audit: run EXPOSE error matches the expected', byId['run EXPOSE no value'],
    'EXPOSE: variable %test1% has no value (never assigned, or not on the executed path)');
  checkEq('audit: run template error matches the expected', byId['run template no value'],
    'The Output Template variable %m% has no value when the template renders');
  checkEq('audit: run type-mismatch matches the expected', byId['run type-mismatch'],
    'Type mismatch: boolean vs number \u2014 booleans only compare with booleans');
  check('audit: compare type-mismatch matches the expected shape',
    /^cannot compare .* with .* using "==" \u2014 the two values have different types and comparisons need matching types$/.test(byId['compare type-mismatch']));
  checkEq('audit: validate bad-name message matches the expected', byId['validate bad name'],
    'imports contains a name that is not a valid variable name: "a b!"');
})();

// ------------------------------------------------------------------ summary
console.log(checks + ' checks / ' + passed + ' passed');
process.exit(passed === checks ? 0 : 1);

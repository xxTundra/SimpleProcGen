(function () {
  'use strict';

  const KEYWORDS = Object.freeze([
    'AND', 'CASE', 'DEFAULT', 'ELSE', 'EXPOSE', 'IMPORT',
    'IF', 'OR', 'ROLL', 'SET', 'SWITCH', 'THEN',
  ]);
  const PINK_KEYWORDS = KEYWORDS;
  const BOOLEAN_LITERALS = Object.freeze(['true', 'false']);

  class LogicError extends Error {
    constructor(kind, message, line) {
      super(message);
      this.name = 'LogicError';
      this.kind = kind;
      this.line = line;
    }
    toErr(fallbackLine) {
      return {
        kind: this.kind,
        line: (this.line != null ? this.line : fallbackLine),
        message: this.message,
      };
    }
  }

  const ERR = Object.freeze({
    UNKNOWN_KEYWORD: 'unknown-keyword',
    BARE_ASSIGNMENT: 'bare-assignment',
    INCOMPLETE: 'incomplete',
    MISSING_VALUE: 'missing-value',
    MISSING_THEN: 'missing-then',
    EMPTY_CONDITION: 'empty-condition',
    EMPTY_THEN: 'empty-then',
    INVALID_THEN_STATEMENT: 'invalid-then-statement',
    EMPTY_BLOCK: 'empty-block',
    UNEXPECTED_INDENT: 'unexpected-indent',
    NOT_A_CONDITION: 'not-a-condition',
    INCOMPLETE_CONDITION: 'incomplete-condition',
    UNBALANCED_PARENS: 'unbalanced-parens',
    UNTERMINATED_STRING: 'unterminated-string',
    BAD_NUMBER: 'bad-number',
    BAD_NAME: 'bad-name',
    NAME_COLLISION: 'name-collision',
    BAD_ROLL: 'bad-roll',
    MISPLACED_ROLL: 'misplaced-roll',
    BAD_ARITY: 'bad-arity',
    BAD_UNIQUE: 'bad-unique',
    BAD_CHOICE: 'bad-choice',
    INVALID_RANGE: 'invalid-range',
    REVERSED_RANGE: 'reversed-range',
    NESTING_TOO_DEEP: 'nesting-too-deep',
    CONDITION_TOO_LONG: 'condition-too-long',
    DUPLICATE_CASE: 'duplicate-case',
    DUPLICATE_DEFAULT: 'duplicate-default',
    EMPTY_SWITCH: 'empty-switch',
    UNEXPECTED_ELSE: 'unexpected-else',
    UNEXPECTED_CASE: 'unexpected-case',
    UNEXPECTED_DEFAULT: 'unexpected-default',
    TRAILING_TEXT: 'trailing-text',
    TYPE_MISMATCH: 'type-mismatch',
    CYCLE: 'cycle',
  });

  const HIGHLIGHT = Object.freeze({
    keyword:   { token: '--keyword',    cls: 'script-keyword' },
    variable:  { token: '--script-var', cls: 'script-var' },
    container: { token: '--ref',        cls: 'embed-ref' },
    op:        { token: '--op',         cls: 'embed-op' },
    dice:      { token: '--embed',      cls: 'embed-expr' },
    inline:    { token: '--pick',       cls: 'embed-pick' },
    string:    { token: '--pick',       cls: 'embed-pick' },
    number:    { token: '--embed',      cls: 'embed-expr' },
    operator:  { token: '--op',         cls: 'embed-op' },
    comment:   { token: '--muted',      cls: null },
    error:     { token: '--danger',     cls: 'embed-err' },
    text:      { token: '--text',       cls: null },
  });

  const BARE_NAME = /^[\p{L}\p{M}_][\p{L}\p{M}\p{N}_]*$/u;
  const BARE_NAME_ONE = /^[\p{L}\p{M}_][\p{L}\p{M}\p{N}_]*/u;
  const NAME_CHAR = /^[\p{L}\p{M}\p{N}_ ]$/u;
  const NAME_EDGE = /^[\p{L}\p{M}\p{N}_]/u;
  const NAME_START = /^[\p{L}\p{M}_]/u;
  const WS_CHAR = /[^\S\r\n]/u;

  function rejectKeywordName(name, lineNo) {
    if (KEYWORDS.indexOf(name) !== -1) {
      throw new LogicError(ERR.BAD_NAME,
        '"' + name + '" is a reserved keyword; write %' + name + '% for a variable with that name', lineNo);
    }
    if (BOOLEAN_LITERALS.indexOf(name) !== -1) {
      throw new LogicError(ERR.BAD_NAME,
        '"' + name + '" is a reserved boolean literal and cannot be a variable name', lineNo);
    }
    return name;
  }

  function normalizeName(raw, lineNo) {
    const s = String(raw == null ? '' : raw).trim();
    if (s === '') throw new LogicError(ERR.BAD_NAME, 'empty name', lineNo);
    if (s.indexOf('%') !== -1) throw new LogicError(ERR.BAD_NAME, "name must not contain '%'", lineNo);
    for (const ch of s) {
      if (!NAME_CHAR.test(ch)) {
        throw new LogicError(ERR.BAD_NAME, 'invalid character "' + ch + '" in name', lineNo);
      }
    }
    const nf = s.normalize('NFC');
    if (BOOLEAN_LITERALS.indexOf(nf) !== -1) {
      throw new LogicError(ERR.BAD_NAME,
        '"' + nf + '" is a reserved boolean literal and cannot be a variable name', lineNo);
    }
    return nf;
  }

  function isNameSpan(s) {
    if (s === '') return false;
    let solid = 0;
    for (const ch of s) {
      if (!NAME_CHAR.test(ch)) return false;
      if (ch !== ' ') solid++;
    }
    return solid > 0;
  }

  function isNameText(s) {
    return NAME_START.test(s) && isNameSpan(s);
  }

  function readName(text, i, lineNo, what) {
    if (text[i] === '%') {
      const end = text.indexOf('%', i + 1);
      if (end === -1) throw new LogicError(ERR.BAD_NAME, 'unterminated %name%', lineNo);
      const inner = text.slice(i + 1, end);
      return { name: normalizeName(inner, lineNo), nameRaw: inner.trim(), end: end + 1 };
    }
    const m = BARE_NAME_ONE.exec(text.slice(i));
    if (!m) throw new LogicError(ERR.BAD_NAME, what || 'expected a name', lineNo);
    rejectKeywordName(m[0], lineNo);
    return { name: normalizeName(m[0], lineNo), nameRaw: m[0], end: i + m[0].length };
  }

  function skipWs(text, i) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
    return i;
  }

  function leadingWs(line) {
    let n = 0;
    while (n < line.length && WS_CHAR.test(line[n])) n++;
    return n;
  }

  function startsWithKeyword(text, word) {
    if (!text.startsWith(word)) return false;
    const after = text[word.length];
    return after === undefined || after === ':' || after === ' ' || after === '\t';
  }

  function spanEnd(line, i) {
    const c = line[i];
    if (c === '"') { const e = findStringEnd(line, i); return e === -1 ? -1 : e + 1; }
    if (c === '(' && line[i + 1] === '(') { const e = findInlineEnd(line, i); return e === -1 ? -1 : e; }
    if (c === '[') { const e = line.indexOf(']', i + 1); return e === -1 ? -1 : e + 1; }
    if (c === '|') { const e = line.indexOf('|', i + 1); return e === -1 ? -1 : e + 1; }
    if (c === '{') { const e = line.indexOf('}', i + 1); return e === -1 ? -1 : e + 1; }
    return -1;
  }

  function commentIndex(line) {
    let nextHash = line.indexOf('#');
    if (nextHash === -1) return -1;
    let i = 0;
    while (i < line.length) {
      if (nextHash !== -1 && nextHash < i) nextHash = line.indexOf('#', i);
      if (nextHash === -1) return -1;
      if (i === nextHash) return i;
      const c = line[i];
      if (c === '%') {
        const end = line.indexOf('%', i + 1);
        if (end === -1) { i++; continue; }
        if (!isNameSpan(line.slice(i + 1, end))) { i++; continue; }
        i = end + 1;
        continue;
      }
      if (!isSpanOpener(line, i)) { i++; continue; }
      const e = spanEnd(line, i);
      if (e === -1) return -1;
      i = e;
    }
    return -1;
  }

  function isSpanOpener(line, i) {
    const c = line[i];
    return c === '"' || c === '[' || c === '|' || c === '{' ||
      (c === '(' && line[i + 1] === '(');
  }

  function stripComment(line) {
    const c = commentIndex(line);
    return c === -1 ? line : line.slice(0, c);
  }

  const SEMICOLON_MESSAGE = "';' is not a statement separator: one statement per line";
  function rejectTrailing(tail, lineNo, fallback) {
    const t = String(tail == null ? '' : tail).trim();
    if (t === '') return;
    if (t[0] === ';') throw new LogicError(ERR.TRAILING_TEXT, SEMICOLON_MESSAGE, lineNo);
    throw new LogicError(ERR.TRAILING_TEXT, fallback, lineNo);
  }

  function findSingleEq(text) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '=') continue;
      if (text[i + 1] === '=') { i++; continue; }
      if (text[i - 1] === '=') continue;
      if (text[i - 1] === '>' || text[i - 1] === '<' || text[i - 1] === '!') continue;
      return i;
    }
    return -1;
  }

  function findStringEnd(text, start) {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '"') return i;
    }
    return -1;
  }

  function findInlineEnd(text, start) {
    let depth = 2;
    for (let i = start + 2; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  function findKeywordOutside(text, word) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        const e = findStringEnd(text, i);
        if (e === -1) return -1;
        i = e;
        continue;
      }
      if (c === '%') {
        const e = text.indexOf('%', i + 1);
        if (e === -1) continue;
        i = e;
        continue;
      }
      if (c === '(' && text[i + 1] === '(') {
        const e = findInlineEnd(text, i);
        if (e === -1) return -1;
        i = e - 1;
        continue;
      }
      if (text.startsWith(word, i)) {
        const before = i === 0 ? '' : text[i - 1];
        const after = text[i + word.length];
        const okBefore = before === '' || !NAME_EDGE.test(before);
        const okAfter = after === undefined || !NAME_EDGE.test(after);
        if (okBefore && okAfter) return i;
      }
    }
    return -1;
  }

  function findColonOutside(text, from) {
    for (let i = (from || 0); i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        const e = findStringEnd(text, i);
        if (e === -1) return -1;
        i = e;
        continue;
      }
      if (c === '%') {
        const e = text.indexOf('%', i + 1);
        if (e === -1) continue;
        i = e;
        continue;
      }
      if (c === '(' && text[i + 1] === '(') {
        const e = findInlineEnd(text, i);
        if (e === -1) return -1;
        i = e - 1;
        continue;
      }
      if (c === '[') {
        const e = text.indexOf(']', i + 1);
        if (e === -1) return -1;
        i = e;
        continue;
      }
      if (c === '|' || c === '{') {
        const e = text.indexOf(c === '|' ? '|' : '}', i + 1);
        if (e === -1) return -1;
        i = e;
        continue;
      }
      if (c === ':') return i;
    }
    return -1;
  }

  function parseInlineChoice(inner, lineNo) {
    const s = String(inner == null ? '' : inner).trim();
    if (s === '') throw new LogicError(ERR.BAD_CHOICE, 'empty ((...)) value', lineNo);
    if (s.indexOf('|') !== -1) {
      const parts = s.split('|');
      const options = [];
      for (let k = 0; k < parts.length; k++) {
        const opt = parts[k].trim();
        if (opt === '') throw new LogicError(ERR.BAD_CHOICE, 'empty option in ((...))', lineNo);
        options.push(parseChoiceOption(opt, lineNo));
      }
      return { type: 'choice', options };
    }
    if (/^[+-]?\d/.test(s) && s.indexOf('-') !== -1) {
      const m = /^([+-]?\d+)\s*-\s*([+-]?\d+)$/.exec(s);
      if (!m) throw new LogicError(ERR.INVALID_RANGE, 'invalid range "' + s + '" in ((...))', lineNo);
      const min = parseInt(m[1], 10);
      const max = parseInt(m[2], 10);
      if (min > max) {
        throw new LogicError(ERR.REVERSED_RANGE, 'reversed range "' + s + '" (minimum is greater than maximum)', lineNo);
      }
      return { type: 'range', min, max };
    }
    return { type: 'choice', options: [parseChoiceOption(s, lineNo)] };
  }

  function parseChoiceOption(opt, lineNo) {
    const ci = opt.indexOf(':');
    if (ci === -1) {
      if (opt === '') throw new LogicError(ERR.BAD_CHOICE, 'empty option label in ((...))', lineNo);
      return { label: opt, weight: 1 };
    }
    const label = opt.slice(0, ci).trim();
    const w = opt.slice(ci + 1).trim();
    if (label === '') throw new LogicError(ERR.BAD_CHOICE, 'empty option label in ((...))', lineNo);
    if (!/^[0-9]+$/.test(w)) {
      throw new LogicError(ERR.BAD_CHOICE, 'weight must be a non-negative integer in ((...)) option "' + opt + '"', lineNo);
    }
    return { label, weight: parseInt(w, 10) };
  }

  const NUM_FULL = /^[+-]?\d+(?:\.\d+)?(?![\s\S])/;
  const NUM_HEAD = /^[+-]?\d/;
  const NUM_ONE = /^[+-]?\d+(?:\.\d+)?/;

  function isNumericText(value) {
    return NUM_FULL.test(String(value == null ? '' : value));
  }

  function parseSimpleValue(text, lineNo) {
    let i = skipWs(text, 0);
    if (i >= text.length) throw new LogicError(ERR.MISSING_VALUE, 'expected a value', lineNo);
    const first = text[i];
    if (first === '"') {
      const e = findStringEnd(text, i);
      if (e === -1) throw new LogicError(ERR.UNTERMINATED_STRING, 'unterminated string', lineNo);
      return { node: { type: 'string', value: text.slice(i + 1, e), line: lineNo }, end: e + 1 };
    }
    if (first === '(' && text[i + 1] === '(') {
      const e = findInlineEnd(text, i);
      if (e === -1) throw new LogicError(ERR.UNBALANCED_PARENS, 'unterminated ((...))', lineNo);
      const inner = text.slice(i + 2, e - 2);
      const parsed = parseInlineChoice(inner, lineNo);
      return { node: { type: 'inline', inner, parsed, line: lineNo }, end: e };
    }
    if (first === '%') {
      const nm = readName(text, i, lineNo);
      return { node: { type: 'name', name: nm.name, nameRaw: nm.nameRaw, line: lineNo }, end: nm.end };
    }
    let j = i;
    while (j < text.length && text[j] !== ' ' && text[j] !== '\t' && text[j] !== ',') j++;
    const tok = text.slice(i, j);
    if (/^ROLL[\[(|]/.test(tok)) {
      throw new LogicError(ERR.BAD_ROLL,
        'put a space between ROLL and its reference (ROLL [container], ROLL ((...)) or ROLL |dice|)', lineNo);
    }
    const semi = tok.indexOf(';');
    if (semi === 0) throw new LogicError(ERR.MISSING_VALUE, 'expected a value', lineNo);
    if (semi > 0) {
      const head = tok.slice(0, semi);
      if (NUM_FULL.test(head) || BARE_NAME.test(head)) {
        throw new LogicError(ERR.TRAILING_TEXT, SEMICOLON_MESSAGE, lineNo);
      }
    }
    if (tok === 'true' || tok === 'false') {
      return { node: { type: 'boolean', value: (tok === 'true'), line: lineNo }, end: j };
    }
    if (NUM_HEAD.test(tok)) {
      if (!NUM_FULL.test(tok)) throw new LogicError(ERR.BAD_NUMBER, 'invalid number "' + tok + '"', lineNo);
      return { node: { type: 'number', value: Number(tok), line: lineNo }, end: j };
    }
    if (BARE_NAME.test(tok)) {
      rejectKeywordName(tok, lineNo);
      return { node: { type: 'name', name: normalizeName(tok, lineNo), nameRaw: tok, line: lineNo }, end: j };
    }
    if (/\d/.test(tok)) throw new LogicError(ERR.BAD_NUMBER, 'invalid value "' + tok + '"', lineNo);
    throw new LogicError(ERR.BAD_NAME, 'invalid value "' + tok + '"', lineNo);
  }

  function parseRollRef(text, lineNo, base) {
    let lead = 0;
    while (lead < text.length && (text[lead] === ' ' || text[lead] === '\t')) lead++;
    const t = text.slice(lead);
    base += lead;
    if (t === '') throw new LogicError(ERR.BAD_ROLL, 'ROLL requires an argument', lineNo);
    if (t[0] === '[') {
      const c = t.indexOf(']');
      if (c === -1) throw new LogicError(ERR.BAD_ROLL, 'unterminated [container]', lineNo);
      const ref = t.slice(1, c).trim();
      if (ref === '') throw new LogicError(ERR.BAD_ROLL, 'empty container name', lineNo);
      return { node: { type: 'roll', kind: 'container', ref, line: lineNo }, end: base + c + 1 };
    }
    if (t[0] === '(' && t[1] === '(') {
      const e = findInlineEnd(t, 0);
      if (e === -1) throw new LogicError(ERR.UNBALANCED_PARENS, 'unterminated ((...)) in ROLL', lineNo);
      const inner = t.slice(2, e - 2);
      const parsed = parseInlineChoice(inner, lineNo);
      return { node: { type: 'roll', kind: 'inline', inner, parsed, line: lineNo }, end: base + e };
    }
    if (t[0] === '|') {
      const c = t.indexOf('|', 1);
      if (c === -1) throw new LogicError(ERR.BAD_ROLL, 'unterminated |...| in ROLL', lineNo);
      const inner = t.slice(1, c).trim();
      if (inner === '') throw new LogicError(ERR.BAD_ROLL, 'empty dice/macro in ROLL', lineNo);
      return { node: { type: 'roll', kind: 'pipe', inner, line: lineNo }, end: base + c + 1 };
    }
    throw new LogicError(ERR.BAD_ROLL, 'ROLL expects [container], ((...)) or |...|', lineNo);
  }

  function parseValue(text, lineNo) {
    const i = skipWs(text, 0);
    if (i < text.length &&
        text.indexOf('ROLL', i) === i &&
        (i + 4 >= text.length || /\s/.test(text[i + 4]))) {
      return parseRollRef(text.slice(i + 4), lineNo, i + 4);
    }
    return parseSimpleValue(text, lineNo);
  }

  const MAX_CONDITION_TOKENS = 500;

  function tokenizeCondition(text, lineNo) {
    const toks = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '#') break;
      if (c === ';') throw new LogicError(ERR.TRAILING_TEXT, SEMICOLON_MESSAGE, lineNo);
      if (c === '=' && text[i + 1] === '=') { toks.push({ t: 'op', v: '==' }); i += 2; continue; }
      if (c === '!' && text[i + 1] === '=') { toks.push({ t: 'op', v: '!=' }); i += 2; continue; }
      if (c === '>' && text[i + 1] === '=') { toks.push({ t: 'op', v: '>=' }); i += 2; continue; }
      if (c === '<' && text[i + 1] === '=') { toks.push({ t: 'op', v: '<=' }); i += 2; continue; }
      if (c === '>' || c === '<') { toks.push({ t: 'op', v: c }); i++; continue; }
      if (c === '(' && text[i + 1] === '(') {
        const e = findInlineEnd(text, i);
        if (e === -1) throw new LogicError(ERR.UNBALANCED_PARENS, 'unterminated ((...)) in condition', lineNo);
        toks.push({ t: 'inline', v: text.slice(i + 2, e - 2) });
        i = e;
        continue;
      }
      if (c === '(') { toks.push({ t: 'lp' }); i++; continue; }
      if (c === ')') { toks.push({ t: 'rp' }); i++; continue; }
      if (c === '"') {
        const e = findStringEnd(text, i);
        if (e === -1) throw new LogicError(ERR.UNTERMINATED_STRING, 'unterminated string in condition', lineNo);
        toks.push({ t: 'str', v: text.slice(i + 1, e) });
        i = e + 1;
        continue;
      }
      if (c === '%') {
        const e = text.indexOf('%', i + 1);
        if (e === -1) throw new LogicError(ERR.BAD_NAME, 'unterminated %name% in condition', lineNo);
        const inner = text.slice(i + 1, e);
        toks.push({ t: 'name', v: normalizeName(inner, lineNo), raw: inner.trim() });
        i = e + 1;
        continue;
      }
      const rest = text.slice(i, n);
      const nm = NUM_ONE.exec(rest);
      if (nm) {
        let k = nm[0].length;
        while (k < rest.length && !/[\s()"'%<>!=;]/.test(rest[k])) k++;
        const tok = rest.slice(0, k);
        if (!NUM_FULL.test(tok)) throw new LogicError(ERR.BAD_NUMBER, 'invalid number "' + tok + '"', lineNo);
        toks.push({ t: 'num', v: Number(tok) });
        i += k;
        continue;
      }
      const wm = BARE_NAME_ONE.exec(rest);
      if (wm) {
        const w = wm[0];
        if (w === 'true' || w === 'false') {
          toks.push({ t: 'bool', v: (w === 'true') });
        } else if (w === 'AND' || w === 'OR') {
          toks.push({ t: w });
        } else {
          rejectKeywordName(w, lineNo);
          toks.push({ t: 'name', v: normalizeName(w, lineNo), raw: w });
        }
        i += w.length;
        continue;
      }
      throw new LogicError(ERR.INCOMPLETE_CONDITION, 'cannot parse "' + c + '" in condition', lineNo);
    }
    if (toks.length > MAX_CONDITION_TOKENS) {
      throw new LogicError(ERR.CONDITION_TOO_LONG,
        'a condition may use at most ' + MAX_CONDITION_TOKENS + ' tokens; split it with intermediate variables', lineNo);
    }
    return toks;
  }

  function parseCondition(text, lineNo) {
    const toks = tokenizeCondition(text, lineNo);
    if (toks.length === 0) throw new LogicError(ERR.EMPTY_CONDITION, 'empty condition', lineNo);
    let pos = 0;
    let groupDepth = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function parseOr() {
      let left = parseAnd();
      while (peek() && peek().t === 'OR') {
        next();
        left = { type: 'or', left, right: parseAnd(), line: lineNo };
      }
      return left;
    }
    function parseAnd() {
      let left = parseAtom();
      while (peek() && peek().t === 'AND') {
        next();
        left = { type: 'and', left, right: parseAtom(), line: lineNo };
      }
      return left;
    }
    function parseAtom() {
      const tk = peek();
      if (!tk) throw new LogicError(ERR.INCOMPLETE_CONDITION, 'condition ends unexpectedly', lineNo);
      if (tk.t === 'lp') {
        next();
        groupDepth++;
        if (groupDepth > MAX_NESTING) {
          throw new LogicError(ERR.NESTING_TOO_DEEP,
            'condition groups are nested deeper than ' + MAX_NESTING + ' levels', lineNo);
        }
        const inner = parseOr();
        groupDepth--;
        const close = peek();
        if (!close || close.t !== 'rp') throw new LogicError(ERR.UNBALANCED_PARENS, 'missing ) in condition', lineNo);
        next();
        return { type: 'group', inner, line: lineNo };
      }
      return parseCmp();
    }
    function parseOperand() {
      const tk = next();
      if (!tk) throw new LogicError(ERR.INCOMPLETE_CONDITION, 'condition ends unexpectedly', lineNo);
      if (tk.t === 'name') return { type: 'name', name: tk.v, nameRaw: tk.raw, line: lineNo };
      if (tk.t === 'num') return { type: 'number', value: tk.v, line: lineNo };
      if (tk.t === 'bool') return { type: 'boolean', value: tk.v, line: lineNo };
      if (tk.t === 'str') return { type: 'string', value: tk.v, line: lineNo };
      if (tk.t === 'inline') {
        return { type: 'inline', inner: tk.v, parsed: parseInlineChoice(tk.v, lineNo), line: lineNo };
      }
      if (tk.t === 'rp') throw new LogicError(ERR.UNBALANCED_PARENS, 'unexpected ) in condition', lineNo);
      throw new LogicError(ERR.NOT_A_CONDITION, 'expected a value in condition', lineNo);
    }
    function parseCmp() {
      const left = parseOperand();
      const op = peek();
      if (!op || op.t !== 'op') {
        throw new LogicError(ERR.NOT_A_CONDITION, 'condition must be a comparison', lineNo);
      }
      next();
      const rightValue = parseOperand();
      return { type: 'cmp', op: op.v, left, right: rightValue, line: lineNo };
    }
    const cond = parseOr();
    if (pos < toks.length) {
      const leftTok = toks[pos];
      if (leftTok.t === 'lp' || leftTok.t === 'rp') {
        throw new LogicError(ERR.UNBALANCED_PARENS, 'unbalanced parenthesis in condition', lineNo);
      }
      throw new LogicError(ERR.TRAILING_TEXT, 'unexpected token in condition', lineNo);
    }
    return cond;
  }

  function parseSet(t, lineNo) {
    let i = skipWs(t, 3);
    const names = [];
    const seen = {};
    for (;;) {
      const nm = readName(t, i, lineNo, 'SET requires a name, then " = value"');
      if (nm.name === 'EACH' || nm.name === 'UNIQUE') {
        throw new LogicError(ERR.BAD_NAME,
          '"' + nm.name + '" is reserved for multi-draw SET and cannot be a variable name', lineNo);
      }
      if (seen[nm.name]) {
        throw new LogicError(ERR.NAME_COLLISION,
          'name "' + nm.name + '" appears twice in one SET', lineNo);
      }
      seen[nm.name] = true;
      names.push(nm);
      i = skipWs(t, nm.end);
      if (i >= t.length) throw new LogicError(ERR.INCOMPLETE, 'SET requires "name = value"', lineNo);
      if (t[i] === ',') { i = skipWs(t, i + 1); continue; }
      if (t[i] !== '=') throw new LogicError(ERR.INCOMPLETE, 'SET requires "name = value"', lineNo);
      break;
    }
    if (t[i + 1] === '=' || t[i + 1] === '>' || t[i + 1] === '<' || t[i + 1] === '!') {
      throw new LogicError(ERR.INCOMPLETE, 'SET requires "name = value"', lineNo);
    }
    const values = parseSetValueList(t.slice(i + 1), lineNo);
    const n = names.length;
    const m = values.length;
    if (m !== 1 && m !== n) {
      throw new LogicError(ERR.BAD_ARITY,
        n + (n === 1 ? ' variable given ' : ' variables given ') +
        m + (m === 1 ? ' value' : ' values'), lineNo);
    }
    if (n === 1) {
      return { type: 'set', name: names[0].name, nameRaw: names[0].nameRaw, value: values[0].node, line: lineNo };
    }
    const sole = values[0].node;
    let mode;
    if (m === 1) {
      if (sole.type === 'unique') mode = 'unique';
      else if (sole.type === 'roll' && sole.each) mode = 'each';
      else mode = 'broadcast';
    } else {
      for (let v = 0; v < m; v++) {
        const val = values[v].node;
        if (val.type === 'unique' || (val.type === 'roll' && val.each)) {
          throw new LogicError(ERR.MISPLACED_ROLL,
            val.type === 'unique' ? 'UNIQUE must be the only value in a SET'
              : 'EACH ROLL must be the only value in a SET', lineNo);
        }
      }
      mode = 'zip';
    }
    return {
      type: 'multi-set',
      names: names.map(function (x) { return { name: x.name, nameRaw: x.nameRaw }; }),
      values: values.map(function (x) { return x.node; }),
      mode: mode,
      line: lineNo,
    };
  }

  function parseSetValueList(t, lineNo) {
    const values = [];
    let i = 0;
    for (;;) {
      i = skipWs(t, i);
      if (i >= t.length) {
        throw new LogicError(ERR.MISSING_VALUE,
          values.length ? 'a value is missing after the comma' : 'expected a value', lineNo);
      }
      if (t[i] === ',') {
        throw new LogicError(ERR.MISSING_VALUE, 'a value is missing after the comma', lineNo);
      }
      const v = parseValueForm(t.slice(i), lineNo);
      values.push(v);
      i += v.end;
      i = skipWs(t, i);
      if (i >= t.length) return values;
      if (t[i] !== ',') rejectTrailing(t.slice(i), lineNo, 'unexpected text after value');
      i++;
    }
  }

  function parseValueForm(text, lineNo) {
    const i = skipWs(text, 0);
    if (i < text.length && text.indexOf('EACH', i) === i &&
        (i + 4 >= text.length || /\s/.test(text[i + 4]))) {
      return parseEachRoll(text, lineNo, i);
    }
    if (i < text.length && text.indexOf('UNIQUE', i) === i &&
        (i + 6 >= text.length || /\s/.test(text[i + 6]))) {
      return parseUnique(text, lineNo, i);
    }
    return parseValue(text, lineNo);
  }

  function parseEachRoll(text, lineNo, base) {
    const j = skipWs(text, base + 4);
    if (j >= text.length || text.indexOf('ROLL', j) !== j ||
        !(j + 4 >= text.length || /\s/.test(text[j + 4]))) {
      throw new LogicError(ERR.BAD_ROLL,
        'EACH must be followed by ROLL [container], ((...)) or |dice|', lineNo);
    }
    const r = parseRollRef(text.slice(j + 4), lineNo, j + 4);
    r.node.each = true;
    return r;
  }

  function parseUnique(text, lineNo, base) {
    const i = skipWs(text, base + 6);
    if (i >= text.length || text[i] !== '[') {
      throw new LogicError(ERR.BAD_ROLL, 'UNIQUE expects [container]', lineNo);
    }
    const c = text.indexOf(']', i + 1);
    if (c === -1) throw new LogicError(ERR.BAD_ROLL, 'unterminated [container]', lineNo);
    const ref = text.slice(i + 1, c).trim();
    if (ref === '') throw new LogicError(ERR.BAD_ROLL, 'empty container name', lineNo);
    return { node: { type: 'unique', ref: ref, line: lineNo }, end: c + 1 };
  }

  function parseImport(t, lineNo) {
    const i = skipWs(t, 6);
    if (i >= t.length || t[i] !== '%') throw new LogicError(ERR.BAD_NAME, 'IMPORT expects %name%', lineNo);
    const close = t.indexOf('%', i + 1);
    if (close === -1) throw new LogicError(ERR.BAD_NAME, 'unterminated %name%', lineNo);
    const inner = t.slice(i + 1, close);
    const name = normalizeName(inner, lineNo);
    rejectTrailing(t.slice(close + 1), lineNo, 'unexpected text after %name%');
    return { type: 'import', name, nameRaw: inner.trim(), line: lineNo };
  }

  function parseExpose(t, lineNo) {
    const i = skipWs(t, 6);
    const nm = readName(t, i, lineNo, 'EXPOSE requires a name');
    rejectTrailing(t.slice(nm.end), lineNo, 'unexpected text after name');
    return { type: 'expose', name: nm.name, nameRaw: nm.nameRaw, line: lineNo };
  }

  function parseInlineStatement(text, lineNo) {
    const t = text.trim();
    if (startsWithKeyword(t, 'SET')) return parseSet(t, lineNo);
    if (startsWithKeyword(t, 'IMPORT')) return parseImport(t, lineNo);
    if (startsWithKeyword(t, 'EXPOSE')) return parseExpose(t, lineNo);
    throw new LogicError(ERR.INVALID_THEN_STATEMENT,
      'single-line bodies allow exactly one statement (SET, IMPORT or EXPOSE); use an indented block', lineNo);
  }

  function parseHeaderBody(afterText, headerLineNo, blockFrom, h) {
    if (afterText === '') {
      throw new LogicError(ERR.EMPTY_THEN, 'expected ":" + indented block or one statement', headerLineNo);
    }
    if (afterText[0] === ':') {
      rejectTrailing(afterText.slice(1), headerLineNo, 'unexpected text after ":"');
      const b = parseBlockBody(blockFrom.lines, blockFrom.start, h, headerLineNo);
      return { body: b.body, next: b.next };
    }
    return { body: [parseInlineStatement(afterText, headerLineNo)], next: blockFrom.start };
  }

  const MAX_NESTING = 32;
  let parseDepth = 0;

  function firstWord(line) {
    const m = /^([^\s:]+)/.exec(line.trimStart());
    return m ? m[1] : '';
  }

  function parseStatementAt(line, lineNo, out, lines, i) {
    if (parseDepth >= MAX_NESTING) {
      throw new LogicError(ERR.NESTING_TOO_DEEP,
        'blocks are nested deeper than ' + MAX_NESTING + ' levels', lineNo);
    }
    parseDepth++;
    try {
      return parseStatementHere(line, lineNo, out, lines, i);
    } finally {
      parseDepth--;
    }
  }

  function parseStatementHere(line, lineNo, out, lines, i) {
    const t = line.trim();
    const word = firstWord(line);
    switch (word) {
      case 'SET': out.push(parseSet(t, lineNo)); return i + 1;
      case 'IMPORT': out.push(parseImport(t, lineNo)); return i + 1;
      case 'EXPOSE': out.push(parseExpose(t, lineNo)); return i + 1;
      case 'IF': return parseIfAt(line, lineNo, out, lines, i);
      case 'SWITCH': return parseSwitchAt(line, lineNo, out, lines, i);
      case 'ROLL':
        throw new LogicError(ERR.MISPLACED_ROLL, 'ROLL is only allowed as a SET value (SET x = ROLL ...)', lineNo);
      case 'ELSE':
        throw new LogicError(ERR.UNEXPECTED_ELSE, 'ELSE has no matching IF', lineNo);
      case 'CASE':
        throw new LogicError(ERR.UNEXPECTED_CASE, 'CASE is only allowed inside SWITCH', lineNo);
      case 'DEFAULT':
        throw new LogicError(ERR.UNEXPECTED_DEFAULT, 'DEFAULT is only allowed inside SWITCH', lineNo);
      case 'AND':
      case 'OR':
        throw new LogicError(ERR.NOT_A_CONDITION, word + ' requires a condition context', lineNo);
      case 'THEN':
        throw new LogicError(ERR.INCOMPLETE, 'THEN only appears in IF headers', lineNo);
      case 'OUTPUT':
        throw new LogicError(ERR.UNKNOWN_KEYWORD, 'OUTPUT is not a keyword — use the Output Template field for formatting', lineNo);
    }
    const eq = findSingleEq(t);
    if (eq > 0) {
      const lhs = t.slice(0, eq).trim();
      if (/^%[^%]+%$/.test(lhs) || isNameText(lhs)) {
        throw new LogicError(ERR.BARE_ASSIGNMENT, 'use SET for assignment', lineNo);
      }
    }
    if (word === '') {
      throw new LogicError(ERR.UNKNOWN_KEYWORD, 'empty statement', lineNo);
    }
    for (let k = 0; k < KEYWORDS.length; k++) {
      const kw = KEYWORDS[k];
      if (word.length > kw.length && word.indexOf(kw) === 0 && word[kw.length] === '(') {
        throw new LogicError(ERR.UNKNOWN_KEYWORD,
          '"' + word.slice(0, kw.length) + '" needs a space before its expression (' + kw + ' ...)', lineNo);
      }
    }
    throw new LogicError(ERR.UNKNOWN_KEYWORD, '"' + word + '" is not a statement keyword', lineNo);
  }

  function parseBlockBody(lines, start, h, headerLineNo) {
    const body = [];
    let j = start;
    let bodyIndent = null;
    let sawStatement = false;
    while (j < lines.length) {
      const raw = lines[j];
      if (raw.trim() === '') { j++; continue; }
      const ind = leadingWs(raw);
      if (ind <= h) break;
      if (bodyIndent === null) bodyIndent = ind;
      else if (ind > bodyIndent) {
        throw new LogicError(ERR.UNEXPECTED_INDENT, 'line is indented deeper than the block', j + 1);
      } else if (ind < bodyIndent) break;
      j = parseStatementAt(raw, j + 1, body, lines, j);
      sawStatement = true;
    }
    if (!sawStatement) {
      throw new LogicError(ERR.EMPTY_BLOCK, 'block is empty', headerLineNo);
    }
    return { next: j, body };
  }

  function diagnoseOpenSpan(text, lineNo, what) {
    const q = text.indexOf('"');
    if (q !== -1 && findStringEnd(text, q) === -1) {
      throw new LogicError(ERR.UNTERMINATED_STRING, 'unterminated string in ' + what, lineNo);
    }
    const p = text.indexOf('((');
    if (p !== -1 && findInlineEnd(text, p) === -1) {
      throw new LogicError(ERR.UNBALANCED_PARENS, 'unterminated ((...)) in ' + what, lineNo);
    }
  }

  function parseIfAt(line, lineNo, out, lines, i) {
    const t = line.trim();
    const h = leadingWs(line);
    const rest = t.slice(2);
    const thenIdx = findKeywordOutside(rest, 'THEN');
    if (thenIdx === -1) {
      diagnoseOpenSpan(rest, lineNo, 'condition');
      throw new LogicError(ERR.MISSING_THEN, 'IF requires THEN', lineNo);
    }
    const after = rest.slice(thenIdx + 4);
    if (after !== '' && !/^[\s:]/.test(after)) {
      throw new LogicError(ERR.MISSING_THEN, 'THEN must be followed by ":" or a statement', lineNo);
    }
    const condText = rest.slice(0, thenIdx).trim();
    if (condText === '') throw new LogicError(ERR.EMPTY_CONDITION, 'IF requires a condition', lineNo);
    const condition = parseCondition(condText, lineNo);
    const thenPart = parseHeaderBody(after.trim(), lineNo, { lines, start: i + 1 }, h);

    const elseIfs = [];
    let elseBody = null;
    let sawElse = false;
    let j = thenPart.next;
    for (;;) {
      let k = j;
      while (k < lines.length && lines[k].trim() === '') k++;
      if (k >= lines.length) break;
      const raw = lines[k];
      if (leadingWs(raw) !== h) break;
      const trimmed = raw.trim();
      if (startsWithKeyword(trimmed, 'ELSE IF')) {
        if (sawElse) throw new LogicError(ERR.UNEXPECTED_ELSE, 'ELSE IF after ELSE', k + 1);
        const eRest = trimmed.slice(7);
        const eThen = findKeywordOutside(eRest, 'THEN');
        if (eThen === -1) throw new LogicError(ERR.MISSING_THEN, 'ELSE IF requires THEN', k + 1);
        const eAfter = eRest.slice(eThen + 4);
        if (eAfter !== '' && !/^[\s:]/.test(eAfter)) {
          throw new LogicError(ERR.MISSING_THEN, 'THEN must be followed by ":" or a statement', k + 1);
        }
        const eCondText = eRest.slice(0, eThen).trim();
        if (eCondText === '') throw new LogicError(ERR.EMPTY_CONDITION, 'ELSE IF requires a condition', k + 1);
        const eCond = parseCondition(eCondText, k + 1);
        const ePart = parseHeaderBody(eAfter.trim(), k + 1, { lines, start: k + 1 }, h);
        elseIfs.push({ condition: eCond, body: ePart.body, line: k + 1 });
        j = ePart.next;
        continue;
      }
      if (startsWithKeyword(trimmed, 'ELSE')) {
        if (sawElse) throw new LogicError(ERR.UNEXPECTED_ELSE, 'multiple ELSE branches', k + 1);
        const eRest = trimmed.slice(4);
        const eText = eRest.trim();
        if (eText === '') throw new LogicError(ERR.EMPTY_THEN, 'ELSE requires ":" + indented block or one statement', k + 1);
        const ePart = parseHeaderBody(eText, k + 1, { lines, start: k + 1 }, h);
        elseBody = ePart.body;
        sawElse = true;
        j = ePart.next;
        continue;
      }
      break;
    }
    out.push({ type: 'if', condition, thenBody: thenPart.body, elseIfs, elseBody, line: lineNo });
    return j;
  }

  function parseSwitchAt(line, lineNo, out, lines, i) {
    const t = line.trim();
    const h = leadingWs(line);
    const rest = t.slice(6).trim();
    const ci = findColonOutside(rest, 0);
    if (ci === -1) {
      diagnoseOpenSpan(rest, lineNo, 'SWITCH header');
      throw new LogicError(ERR.INCOMPLETE, 'SWITCH requires ":" after the subject', lineNo);
    }
    const subjText = rest.slice(0, ci).trim();
    if (subjText === '') throw new LogicError(ERR.INCOMPLETE, 'SWITCH requires a subject', lineNo);
    const sv = parseValue(subjText, lineNo);
    rejectTrailing(subjText.slice(sv.end), lineNo, 'unexpected text after SWITCH subject');
    rejectTrailing(rest.slice(ci + 1), lineNo, 'unexpected text after SWITCH subject');
    let j = i + 1;
    let bodyIndent = null;
    const cases = [];
    while (j < lines.length) {
      const raw = lines[j];
      if (raw.trim() === '') { j++; continue; }
      const ind = leadingWs(raw);
      if (ind <= h) break;
      if (bodyIndent === null) bodyIndent = ind;
      else if (ind > bodyIndent) {
        throw new LogicError(ERR.UNEXPECTED_INDENT, 'line is indented deeper than the CASE headers', j + 1);
      } else if (ind < bodyIndent) break;
      const trimmed = raw.trim();
      if (startsWithKeyword(trimmed, 'CASE')) {
        const cRest = trimmed.slice(4).trim();
        const cColon = findColonOutside(cRest, 0);
        if (cColon === -1) throw new LogicError(ERR.INCOMPLETE, 'CASE requires ":" after the value', j + 1);
        const cValText = cRest.slice(0, cColon).trim();
        if (cValText === '') throw new LogicError(ERR.INCOMPLETE, 'CASE requires a value', j + 1);
        rejectTrailing(cRest.slice(cColon + 1), j + 1, 'unexpected text after CASE ":"');
        if (/^ROLL(\s|$)/.test(cValText)) {
          throw new LogicError(ERR.MISPLACED_ROLL,
            'CASE labels cannot roll; ROLL belongs in a SET value or the SWITCH subject', j + 1);
        }
        const cv = parseSimpleValue(cValText, j + 1);
        rejectTrailing(cValText.slice(cv.end), j + 1, 'unexpected text after CASE value');
        const cBody = parseBlockBody(lines, j + 1, ind, j + 1);
        cases.push({ value: cv.node, body: cBody.body, line: j + 1 });
        j = cBody.next;
        continue;
      }
      if (startsWithKeyword(trimmed, 'DEFAULT')) {
        const dRest = trimmed.slice(7).trim();
        if (dRest[0] !== ':') throw new LogicError(ERR.INCOMPLETE, 'DEFAULT requires ":"', j + 1);
        rejectTrailing(dRest.slice(1), j + 1, 'unexpected text after DEFAULT:');
        const dBody = parseBlockBody(lines, j + 1, ind, j + 1);
        cases.push({ value: null, isDefault: true, body: dBody.body, line: j + 1 });
        j = dBody.next;
        continue;
      }
      throw new LogicError(ERR.UNEXPECTED_CASE, 'expected a CASE or DEFAULT header inside SWITCH', j + 1);
    }
    out.push({ type: 'switch', subject: sv.node, cases, line: lineNo });
    return j;
  }

  function parseScript(source) {
    const lines = String(source == null ? '' : source).replace(/^\uFEFF/, '').split(/\r?\n/).map(stripComment);
    const errors = [];
    const statements = [];
    let baseIndent = null;
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].trim() === '') continue;
      const ind = leadingWs(lines[li]);
      if (baseIndent === null || ind < baseIndent) baseIndent = ind;
    }
    if (baseIndent === null) return { ok: true, statements: [], errors: [] };
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      if (raw.trim() === '') { i++; continue; }
      const lineNo = i + 1;
      const indent = leadingWs(raw);
      try {
        if (indent > baseIndent) {
          throw new LogicError(ERR.UNEXPECTED_INDENT, 'unexpected indentation at top level', lineNo);
        }
        i = parseStatementAt(raw, lineNo, statements, lines, i);
      } catch (e) {
        if (!(e instanceof LogicError)) throw e;
        errors.push(e.toErr(lineNo));
        const reached = (e.line != null && e.line > lineNo) ? e.line : lineNo;
        i = reached;
        while (i < lines.length && (lines[i].trim() === '' || leadingWs(lines[i]) > indent)) i++;
        if (firstWord(raw) === 'IF' || firstWord(raw) === 'SWITCH') {
          for (;;) {
            let k = i;
            while (k < lines.length && lines[k].trim() === '') k++;
            if (k >= lines.length || leadingWs(lines[k]) !== indent) break;
            if (!startsWithKeyword(lines[k].trim(), 'ELSE')) break;
            i = k + 1;
            while (i < lines.length && (lines[i].trim() === '' || leadingWs(lines[i]) > indent)) i++;
          }
        }
      }
    }
    const v = validateProgram(statements);
    for (let k = 0; k < v.errors.length; k++) errors.push(v.errors[k]);
    errors.sort(function (a, b) { return a.line - b.line; });
    return { ok: errors.length === 0, statements, errors };
  }

  function caseValueKey(v) {
    if (!v) return 'x:null';
    if (v.type === 'string') return 's:' + v.value;
    if (v.type === 'number') return 'n:' + v.value;
    if (v.type === 'boolean') return 'b:' + v.value;
    if (v.type === 'name') return 'v:' + v.name;
    if (v.type === 'inline') return 'i:' + JSON.stringify(v.parsed);
    return 'x:' + JSON.stringify(v);
  }

  function validateProgram(statements) {
    const errors = [];
    const roots = Array.isArray(statements) ? statements : [];
    const spellings = new Map();
    function noteName(name, nameRaw, line) {
      const spelled = String(nameRaw == null ? name : nameRaw).trim();
      let seen = spellings.get(name);
      if (!seen) { seen = new Map(); spellings.set(name, seen); }
      if (seen.has(spelled)) return;
      seen.set(spelled, line);
      if (seen.size > 1) {
        const first = seen.keys().next().value;
        errors.push(new LogicError(ERR.NAME_COLLISION,
          'name "' + name + '" has two spellings ("' + first + '" and "' + spelled +
          '"); normalize to a single form', line).toErr(line));
      }
    }
    function noteValue(v, line) {
      if (v && v.type === 'name') noteName(v.name, v.nameRaw, v.line != null ? v.line : line);
    }
    function walkCond(c) {
      const stack = [c];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur) continue;
        if (cur.type === 'cmp') { noteValue(cur.left, cur.line); noteValue(cur.right, cur.line); }
        else if (cur.type === 'and' || cur.type === 'or') stack.push(cur.right, cur.left);
        else if (cur.type === 'group') stack.push(cur.inner);
      }
    }
    function walkList(stmts) {
      for (let s = 0; s < stmts.length; s++) {
        const st = stmts[s];
        if (st.type === 'set' || st.type === 'import' || st.type === 'expose') {
          noteName(st.name, st.nameRaw, st.line);
        }
        if (st.type === 'set') noteValue(st.value, st.line);
        if (st.type === 'multi-set') {
          const mnames = st.names || [];
          for (let a = 0; a < mnames.length; a++) {
            noteName(mnames[a].name, mnames[a].nameRaw, st.line);
          }
          const mvalues = st.values || [];
          for (let a = 0; a < mvalues.length; a++) {
            noteValue(mvalues[a], st.line);
          }
        }
        if (st.type === 'if') {
          walkCond(st.condition);
          walkList(st.thenBody || []);
          const eifs = st.elseIfs || [];
          for (let e = 0; e < eifs.length; e++) {
            walkCond(eifs[e].condition);
            walkList(eifs[e].body || []);
          }
          if (st.elseBody) walkList(st.elseBody);
        }
        if (st.type === 'switch') {
          noteValue(st.subject, st.line);
          const keys = [];
          let defaults = 0;
          for (let c = 0; c < st.cases.length; c++) {
            const cs = st.cases[c];
            if (cs.isDefault) {
              defaults++;
              if (defaults > 1) {
                errors.push(new LogicError(ERR.DUPLICATE_DEFAULT,
                  'SWITCH has more than one DEFAULT', cs.line).toErr(cs.line));
              }
            } else {
              const key = caseValueKey(cs.value);
              if (keys.indexOf(key) !== -1) {
                errors.push(new LogicError(ERR.DUPLICATE_CASE,
                  'duplicate CASE value', cs.line).toErr(cs.line));
              } else {
                keys.push(key);
              }
              noteValue(cs.value, cs.line);
            }
            walkList(cs.body);
          }
          if (st.cases.length === 0) {
            errors.push(new LogicError(ERR.EMPTY_SWITCH,
              'SWITCH has no CASE or DEFAULT', st.line).toErr(st.line));
          }
        }
      }
    }
    walkList(roots);
    return { ok: errors.length === 0, errors };
  }

  function highlightTokens(source) {
    const out = [];
    const lines = String(source == null ? '' : source).split('\n');
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) out.push({ text: '\n', category: 'text' });
      const line = lines[li];
      const commentStart = commentIndex(line);
      const codeEnd = commentStart === -1 ? line.length : commentStart;
      let i = 0;
      let wsStart = -1;
      const pushWs = function (end) {
        if (wsStart !== -1) { out.push({ text: line.slice(wsStart, end), category: 'text' }); wsStart = -1; }
      };
      while (i < codeEnd) {
        const c = line[i];
        if (c === ' ' || c === '\t' || c === '\r') { if (wsStart === -1) wsStart = i; i++; continue; }
        pushWs(i);
        if (c === '(' && line[i + 1] === '(') {
          const e = findInlineEnd(line, i);
          const end = (e === -1 || e > codeEnd) ? codeEnd : e;
          out.push({ text: line.slice(i, end), category: 'inline' });
          i = end;
          continue;
        }
        if (c === '[') {
          const e = line.indexOf(']', i + 1);
          const end = (e === -1 || e >= codeEnd) ? codeEnd : e + 1;
          out.push({ text: line.slice(i, end), category: 'container' });
          i = end;
          continue;
        }
        if (c === '|') {
          const e = line.indexOf('|', i + 1);
          const end = e === -1 ? i + 1 : ((e >= codeEnd) ? codeEnd : e + 1);
          out.push({ text: line.slice(i, end), category: 'dice' });
          i = end;
          continue;
        }
        if (c === '{') {
          const e = line.indexOf('}', i + 1);
          const end = (e === -1 || e >= codeEnd) ? codeEnd : e + 1;
          out.push({ text: line.slice(i, end), category: 'op' });
          i = end;
          continue;
        }
        if (c === '"') {
          const e = findStringEnd(line, i);
          const end = (e === -1 || e >= codeEnd) ? codeEnd : e + 1;
          out.push({ text: line.slice(i, end), category: 'string' });
          i = end;
          continue;
        }
        if (c === '%') {
          const e = line.indexOf('%', i + 1);
          if (e !== -1 && e < codeEnd && isNameSpan(line.slice(i + 1, e))) {
            out.push({ text: line.slice(i, e + 1), category: 'variable' });
            i = e + 1;
            continue;
          }
          out.push({ text: c, category: 'text' });
          i++;
          continue;
        }
        if ((c === '=' || c === '>' || c === '<' || c === '!') && line[i + 1] === '=') {
          out.push({ text: line.slice(i, i + 2), category: 'operator' });
          i += 2;
          continue;
        }
        if (c === '=' || c === '>' || c === '<') {
          out.push({ text: c, category: 'operator' });
          i++;
          continue;
        }
        if (c === '!' || c === '(' || c === ')' || c === ':') {
          out.push({ text: c, category: 'text' });
          i++;
          continue;
        }
        const rest = line.slice(i, codeEnd);
        const nm = NUM_ONE.exec(rest);
        if (nm) { out.push({ text: nm[0], category: 'number' }); i += nm[0].length; continue; }
        const wm = BARE_NAME_ONE.exec(rest);
        if (wm) {
          out.push({ text: wm[0], category: (KEYWORDS.indexOf(wm[0]) !== -1 || BOOLEAN_LITERALS.indexOf(wm[0]) !== -1) ? 'keyword' : 'variable' });
          i += wm[0].length;
          continue;
        }
        out.push({ text: c, category: 'text' });
        i++;
      }
      pushWs(codeEnd);
      if (commentStart !== -1) out.push({ text: line.slice(commentStart), category: 'comment' });
    }
    return out;
  }

  const api = {
    parseScript,
    validateProgram,
    highlightTokens,
    normalizeName,
    parseInlineChoice,
    isNumericText,
    KEYWORDS,
    PINK_KEYWORDS,
    BOOLEAN_LITERALS,
    ERR,
    HIGHLIGHT,
    LogicError,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LogicLanguage = api;
  globalThis.LogicLanguage = api;
})();

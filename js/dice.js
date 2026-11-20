
function evaluate(expression, rng) {
  if (typeof rng !== 'function') rng = Math.random;
  const clean = String(expression == null ? '' : expression).trim();
  if (clean === '') throw new Error('Type a dice expression, e.g. 2d6 or 1d20+5');
  const src = clean.replace(/\s+/g, '');
  let pos = 0;
  const fail = (msg) => { throw new Error('Can\'t parse "' + clean + '" — ' + msg); };
  const isDigit = (c) => c >= '0' && c <= '9';

  function readNumber() {
    const start = pos;
    let dot = false;
    while (pos < src.length && (isDigit(src[pos]) || src[pos] === '.')) {
      if (src[pos] === '.') {
        if (dot) break;
        dot = true;
      }
      pos++;
    }
    const text = src.slice(start, pos);
    const value = Number(text);
    if (text === '' || text === '.' || !isFinite(value)) fail('expected a number');
    return { text, value };
  }

  function parseExpr() {
    let node = parseTerm();
    while (pos < src.length && (src[pos] === '+' || src[pos] === '-')) {
      const op = src[pos++];
      node = { type: 'binary', op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm() {
    let node = parseFactor();
    while (pos < src.length && (src[pos] === '*' || src[pos] === '/')) {
      const op = src[pos++];
      node = { type: 'binary', op, left: node, right: parseFactor() };
    }
    return node;
  }

  function parseMods(count, sides) {
    const mods = { r: false, x: false, keep: null };
    let any = false;
    const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    const readDigits = () => {
      const start = pos;
      while (pos < src.length && isDigit(src[pos])) pos++;
      return src.slice(start, pos);
    };
    const unknown = () => {
      let end = pos;
      while (end < src.length && isLetter(src[end])) end++;
      fail('unknown modifier "' + src.slice(pos, end) + '" — supported modifiers: kh, kl, x, r, cs');
    };
    {
      let scan = pos;
      let seenKeep = null;
      while (scan < src.length && (isLetter(src[scan]) || isDigit(src[scan]))) {
        const c = src[scan];
        if (c === 'k' || c === 'K') {
          const c2 = src[scan + 1];
          if (c2 === 'h' || c2 === 'H' || c2 === 'l' || c2 === 'L') {
            const type = (c2 === 'h' || c2 === 'H') ? 'kh' : 'kl';
            if (seenKeep === null) seenKeep = type;
            else fail('"' + seenKeep + '" and "' + type + '" can\'t be combined on the same dice term');
            scan += 2;
          } else scan++;
        } else if (c === 'c' || c === 'C') {
          const c2 = src[scan + 1];
          if (c2 === 's' || c2 === 'S') {
            if (seenKeep === null) seenKeep = 'cs';
            else fail('"' + seenKeep + '" and "cs" can\'t be combined on the same dice term');
            scan += 2;
          } else scan++;
        } else scan++;
      }
    }
    while (pos < src.length && isLetter(src[pos])) {
      const c = src[pos];
      if (c === 'r' || c === 'R') {
        if (mods.r) fail('only one "r" is allowed per dice term (it rerolls once)');
        mods.r = true;
        any = true;
        pos++;
      } else if (c === 'x' || c === 'X') {
        if (mods.x) fail('only one "x" is allowed per dice term (one explosion chain)');
        mods.x = true;
        any = true;
        pos++;
      } else if (c === 'k' || c === 'K') {
        const k2 = src[pos + 1];
        if (k2 !== 'h' && k2 !== 'H' && k2 !== 'l' && k2 !== 'L') unknown();
        const type = (k2 === 'h' || k2 === 'H') ? 'kh' : 'kl';
        pos += 2;
        const t = readDigits();
        if (t === '') fail('"' + type + '" needs a number of dice to keep, e.g. 2d6' + type + '1');
        const n = Number(t);
        if (!Number.isInteger(n) || n < 1) fail('keep number must be a whole number of at least 1');
        if (mods.keep) fail('"' + mods.keep.type + '" and "' + type + '" can\'t be combined on the same dice term');
        if (n > count) fail('"' + type + '" wants to keep ' + n + ' but there are only ' + count + ' dice');
        mods.keep = { type, n };
        any = true;
      } else if (c === 'c' || c === 'C') {
        const c2 = src[pos + 1];
        if (c2 !== 's' && c2 !== 'S') unknown();
        pos += 2;
        const t = readDigits();
        if (t === '') fail('"cs" needs a target number, e.g. 2d6cs5');
        const n = Number(t);
        if (!Number.isInteger(n)) fail('cs target must be a whole number');
        if (n > sides) fail('"cs" target ' + n + ' is above the max face (' + sides + ')');
        if (mods.keep) fail('"' + mods.keep.type + '" and "cs" can\'t be combined on the same dice term');
        mods.keep = { type: 'cs', n };
        any = true;
      } else {
        unknown();
      }
    }
    return any ? mods : null;
  }

  function parseDice(count) {
    const sidesStart = pos;
    while (pos < src.length && isDigit(src[pos])) pos++;
    const sidesText = src.slice(sidesStart, pos);
    if (sidesText === '') fail('expected a dice roll like 2d6 — sides are missing after "d"');
    const sides = Number(sidesText);
    if (!Number.isInteger(sides) || sides < 1) fail('sides must be a whole number of at least 1');
    if (!Number.isInteger(count) || count < 1) fail('dice count must be a whole number of at least 1 (e.g. 2d6)');
    if (count > 1000000) fail('dice count is too large');
    const mods = parseMods(count, sides);
    if (mods) return { type: 'dice', count, sides, mods };
    return { type: 'dice', count, sides };
  }

  function parseFactor() {
    const c = src[pos];
    if (c === undefined) fail('unexpected end of expression');
    if (c === '+') fail('expressions cannot start with "+"');
    if (c === '-') fail('expressions cannot start with "-"');
    if (c === '(') {
      pos++;
      const inner = parseExpr();
      if (src[pos] !== ')') fail('missing closing ")"');
      pos++;
      return { type: 'paren', child: inner };
    }
    if (c === 'd' || c === 'D') {
      pos++;
      return parseDice(1);
    }
    const num = readNumber();
    if (pos < src.length && (src[pos] === 'd' || src[pos] === 'D')) {
      pos++;
      return parseDice(num.value);
    }
    return { type: 'number', value: num.value };
  }

  const ast = parseExpr();
  if (pos < src.length) fail('unexpected "' + src.slice(pos) + '"');

  let hasDice = false;
  (function walk(n) {
    if (n.type === 'dice') hasDice = true;
    else if (n.type === 'paren') walk(n.child);
    else if (n.type === 'binary') { walk(n.left); walk(n.right); }
  })(ast);
  if (!hasDice) fail('no dice — add a roll like 2d6');

  try {
    return evalNode(ast, rng);
  } catch (e) {
    fail(e.message);
  }
}


function evalNode(node, rng) {
  if (node.type === 'number') {
    return { value: node.value, steps: [], dice: [] };
  }
  if (node.type === 'paren') {
    const inner = evalNode(node.child, rng);
    return { value: inner.value, steps: inner.steps, dice: inner.dice };
  }
  if (node.type === 'dice') {
    if (node.mods) return evalModifiedDice(node, rng);
    const rolled = [];
    for (let i = 0; i < node.count; i++) rolled.push(1 + Math.floor(rng() * node.sides));
    const sum = rolled.reduce((a, b) => a + b, 0);
    const text = node.count + 'd' + node.sides;
    const step = rolled.length === 1
      ? text + ' = ' + rolled[0]
      : text + ' = ' + rolled.join(' + ') + ' = ' + sum;
    return { value: sum, steps: [step], dice: [{ text, rolled, sum }] };
  }
  const left = evalNode(node.left, rng);
  const right = evalNode(node.right, rng);
  let result;
  switch (node.op) {
    case '+': result = left.value + right.value; break;
    case '-': result = left.value - right.value; break;
    case '*': result = left.value * right.value; break;
    default:
      if (right.value === 0) throw new Error('division by zero');
      result = left.value / right.value;
      break;
  }
  return {
    value: result,
    steps: [
      ...left.steps,
      ...right.steps,
      fmt(left.value) + ' ' + OP_SYMBOL[node.op] + ' ' + fmt(right.value) + ' = ' + fmt(result),
    ],
    dice: [...left.dice, ...right.dice],
  };
}


function diceTermText(node) {
  let t = node.count + 'd' + node.sides;
  if (!node.mods) return t;
  if (node.mods.r) t += 'r';
  if (node.mods.x) t += 'x';
  if (node.mods.keep) t += node.mods.keep.type + node.mods.keep.n;
  return t;
}

function evalModifiedDice(node, rng) {
  const { count, sides, mods } = node;
  const baseText = count + 'd' + sides;
  const fullText = diceTermText(node);
  const dice = [];
  let extraRolls = 0;

  for (let i = 0; i < count; i++) {
    let base = 1 + Math.floor(rng() * sides);
    let orig = null;
    let rerolled = false;
    if (mods.r && base === 1) {
      orig = base;
      rerolled = true;
      base = 1 + Math.floor(rng() * sides);
    }
    const extras = [];
    if (mods.x) {
      let face = base;
      while (face === sides) {
        extraRolls++;
        if (extraRolls > EXPLOSION_CAP) {
          throw new Error('explosions exceeded the cap of ' + EXPLOSION_CAP + ' extra rolls');
        }
        face = 1 + Math.floor(rng() * sides);
        extras.push(face);
      }
    }
    const total = base + extras.reduce((a, b) => a + b, 0);
    const tags = [];
    if (rerolled) tags.push('reroll');
    if (extras.length > 0) tags.push('explosion');
    dice.push({ base, total, orig: rerolled ? orig : undefined, rerolled, extras, tags });
  }

  const contribution = (d) => {
    let t = d.rerolled ? d.orig + '→' + d.base + ' (reroll)' : String(d.base);
    for (let i = 0; i < d.extras.length; i++) {
      const face = i === 0 ? d.base : d.extras[i - 1];
      t += ' → ' + face + ' exploded → + ' + d.extras[i];
    }
    return t;
  };
  const list = dice.map(contribution).join(' + ');

  const keep = mods.keep;
  let value;
  let step;
  if (keep && keep.type === 'cs') {
    const successes = dice.filter((d) => d.total >= keep.n);
    for (const d of successes) d.tags.push('success');
    value = successes.length;
    const vals = successes.map((d) => d.total).join(', ');
    step = fullText + ': ' + value + ' of ' + count + ' dice rolled ' + keep.n + '+' +
      (vals !== '' ? ' (' + vals + ')' : '') + ' → ' + value;
  } else if (keep) {
    const k = keep.n;
    const idx = dice.map((_, i) => i);
    idx.sort((a, b) => keep.type === 'kh'
      ? (dice[b].total - dice[a].total) || (a - b)
      : (dice[a].total - dice[b].total) || (a - b));
    const keepIdx = new Set(idx.slice(0, k));
    for (let i = 0; i < dice.length; i++) {
      if (!keepIdx.has(i)) dice[i].tags.push('discarded');
    }
    const keptValues = idx.slice(0, k)
      .map((i) => dice[i].total)
      .sort((a, b) => (keep.type === 'kh' ? b - a : a - b));
    const discardedValues = dice.filter((d) => d.tags.includes('discarded')).map((d) => d.total);
    value = keptValues.reduce((a, b) => a + b, 0);
    step = baseText + ' = ' + list +
      ' → ' + (keep.type === 'kh' ? 'keep highest' : 'keep lowest') + ' ' + k +
      ' (' + keptValues.join(', ') + ')' +
      (discardedValues.length > 0 ? ', discarded: ' + discardedValues.join(', ') : '') +
      ' = ' + value;
  } else {
    value = dice.reduce((a, d) => a + d.total, 0);
    step = baseText + ' = ' + list + ' = ' + value;
  }

  return { value, steps: [step], dice: [{ text: fullText, sum: value, dice }] };
}

function expressionHasKeep(expr) {
  const clean = String(expr == null ? '' : expr).replace(/\s+/g, '').toLowerCase();
  const re = /d\d+[a-z0-9]*/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const mods = m[0].replace(/^d\d+/, '');
    if (mods.indexOf('kh') !== -1 || mods.indexOf('kl') !== -1) return true;
  }
  return false;
}

function rollExpression(expression, mode) {
  if (mode !== 'advantage' && mode !== 'disadvantage') mode = 'normal';
  if (mode !== 'normal' && expressionHasKeep(expression)) mode = 'normal';
  const rolls = [evaluate(expression)];
  if (mode !== 'normal') rolls.push(evaluate(expression));
  const value = mode === 'advantage'
    ? Math.max(rolls[0].value, rolls[1].value)
    : mode === 'disadvantage'
      ? Math.min(rolls[0].value, rolls[1].value)
      : rolls[0].value;
  return { value, rolls, mode };
}

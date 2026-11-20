
function showRollError(msg) {
  const e = document.getElementById('roll-error');
  e.textContent = msg;
  e.hidden = false;
}

function hideRollError() {
  const e = document.getElementById('roll-error');
  e.hidden = true;
  e.textContent = '';
}

function renderResult(result, display) {
  const panel = document.getElementById('result-panel');
  const keptEl = document.getElementById('result-kept');
  const body = document.getElementById('result-body');
  panel.hidden = false;
  document.getElementById('result-value').textContent = fmt(result.value);
  document.getElementById('result-expr').textContent = display;
  body.replaceChildren();

  if (result.mode !== 'normal') {
    keptEl.hidden = false;
    keptEl.textContent =
      'Roll 1: ' + fmt(result.rolls[0].value) +
      ', Roll 2: ' + fmt(result.rolls[1].value) +
      ' → kept ' + fmt(result.value);
  } else {
    keptEl.hidden = true;
  }

  result.rolls.forEach((roll, i) => {
    const block = el('div', { class: 'roll-block' });
    if (result.rolls.length > 1) {
      block.append(el('div', { class: 'roll-block-label' },
        'Roll ' + (i + 1) + (result.value === roll.value ? ' (kept)' : '')));
    }
    const steps = el('div', { class: 'roll-steps' });
    if (roll.steps.length === 0) steps.append(el('div', { class: 'step hint' }, 'no steps'));
    for (const s of roll.steps) steps.append(el('div', { class: 'step mono' }, s));
    block.append(steps);
    if (roll.dice.length > 0) {
      const chips = el('div', { class: 'dice-chips' });
      for (const d of roll.dice) {
        if (d.dice) {
          const chip = el('span', { class: 'chip mono' }, d.text + ' → ');
          let firstDie = true;
          const sep = () => {
            if (!firstDie) chip.append(document.createTextNode(', '));
            firstDie = false;
          };
          for (const die of d.dice) {
            sep();
            const cls = 'chip-die' + (die.tags.length > 0 ? ' ' + die.tags.join(' ') : '');
            let t = die.rerolled ? die.orig + '→' + die.base + ' (reroll)' : String(die.base);
            if (die.tags.includes('discarded')) t += ' (discarded)';
            chip.append(el('span', { class: cls }, t));
            for (const e of die.extras) {
              sep();
              const ecls = 'chip-die explosion' +
                (die.tags.includes('discarded') ? ' discarded' : '');
              chip.append(el('span', { class: ecls }, e + ' (explodes)'));
            }
          }
          chip.append(document.createTextNode(' = ' + d.sum));
          chips.append(chip);
        } else {
          chips.append(el('span', { class: 'chip mono' },
            d.text + ' → [' + d.rolled.join(', ') + '] = ' + d.sum));
        }
      }
      block.append(chips);
    }
    body.append(block);
  });
}

function doRoll() {
  const expr = String(document.getElementById('roll-input').value).trim();
  const match = matchMacro(expr);
  const expression = match ? match.expression : expr;
  const display = expr + (match ? ' → ' + match.expression : '');
  hideRollError();
  if (expr === '') {
    document.getElementById('result-panel').hidden = true;
    showRollError('Type a dice expression (e.g. 2d6+3) or a macro name.');
    return;
  }
  let result;
  try {
    result = rollExpression(expression, state.rollMode);
  } catch (e) {
    document.getElementById('result-panel').hidden = true;
    showRollError(e.message);
    return;
  }
  renderResult(result, display);
  addHistory({ time: timeStamp(), display, value: fmt(result.value) });
}

function setupRollBar() {
  const inputEl = document.getElementById('roll-input');
  document.getElementById('roll-btn').addEventListener('click', doRoll);
  inputEl.addEventListener('input', () => {
    updateSuggestions();
  });
  inputEl.addEventListener('keydown', (e) => {
    const open = !document.getElementById('macro-suggest').hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open || suggestState.items.length === 0) return;
      e.preventDefault();
      const n = suggestState.items.length;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      suggestState.hi = suggestState.hi < 0
        ? (e.key === 'ArrowDown' ? 0 : n - 1)
        : (suggestState.hi + delta + n) % n;
      renderSuggestions(suggestState.items, suggestState.hi);
      return;
    }
    if (e.key === 'Escape') {
      if (open) closeSuggestions();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && suggestState.hi >= 0) {
        e.preventDefault();
        selectSuggestion(suggestState.hi);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      closeSuggestions();
      doRoll();
    }
  });
  inputEl.addEventListener('blur', () => {
    clearTimeout(suggestState.timer);
    suggestState.timer = setTimeout(closeSuggestions, 150);
  });
  const segs = document.querySelectorAll('.segmented .seg');
  segs.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.rollMode = btn.dataset.mode;
      segs.forEach((b) => {
        const active = b === btn;
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
        b.classList.toggle('active', active);
      });
    });
  });
}


function setupExamplesPanel() {
  const btn = document.getElementById('examples-btn');
  btn.addEventListener('click', () => window.open('help/dice.html', '_blank'));
}

function suggestToken(text) {
  let start = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\s/.test(text[i]) || '+-*/('.includes(text[i])) { start = i + 1; break; }
  }
  return text.slice(start);
}

function updateSuggestions() {
  const text = String(document.getElementById('roll-input').value);
  const token = suggestToken(text);
  let items = [];
  if (token !== '') {
    const lower = token.toLowerCase();
    const seen = new Set();
    for (const m of state.macros) {
      const name = m.name.trim();
      if (name === '') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (key.startsWith(lower)) { seen.add(key); items.push(name); }
      if (items.length >= 8) break;
    }
  }
  renderSuggestions(items, -1);
}

function renderSuggestions(items, hi) {
  suggestState.items = items;
  suggestState.hi = hi;
  const box = document.getElementById('macro-suggest');
  box.replaceChildren();
  if (items.length === 0) { box.hidden = true; return; }
  box.hidden = false;
  items.forEach((name, i) => {
    const opt = el('div', { class: 'suggest-item' + (i === hi ? ' active' : '') }, name);
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); selectSuggestion(i); });
    box.append(opt);
  });
}

function closeSuggestions() {
  clearTimeout(suggestState.timer);
  suggestState.timer = null;
  suggestState.items = [];
  suggestState.hi = -1;
  const box = document.getElementById('macro-suggest');
  box.hidden = true;
  box.replaceChildren();
}

function selectSuggestion(idx) {
  const name = suggestState.items[idx];
  if (name == null) { closeSuggestions(); return; }
  const inputEl = document.getElementById('roll-input');
  const text = String(inputEl.value);
  const token = suggestToken(text);
  const leading = text.slice(0, text.length - token.length);
  inputEl.value = leading + name + ' ';
  const n = inputEl.value.length;
  inputEl.setSelectionRange(n, n);
  inputEl.focus();
  closeSuggestions();
}

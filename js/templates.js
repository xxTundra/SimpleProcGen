
function embedContainers() {
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

function entryEmbedContext(tableFile) {
  return {
    macros: state.macros.map((m) => ({ name: m.name, formula: m.formula })),
    evalExpr: (expression) => rollExpression(expression, state.rollMode).value,
    containers: embedContainers(),
    operations: state.logicOps.map((o) => ({
      id: o.id, name: o.name, type: o.type, config: o.config,
      script: o.script, outputTemplate: o.outputTemplate,
    })),
    tableFile: typeof tableFile === 'string' ? tableFile : '',
  };
}

function resolveEntryEmbeds(label, tableFile, entryOperations) {
  return GeneratorEngine.resolveEmbed(label, Object.assign(entryEmbedContext(tableFile), {
    entryOperations: Array.isArray(entryOperations) ? entryOperations : [],
  }));
}

function renderEmbedSegments(container, segments) {
  container.replaceChildren();
  for (const seg of segments) {
    if (seg.type === 'text') {
      container.appendChild(document.createTextNode(seg.text));
    } else if (seg.type === 'value') {
      container.appendChild(el('span', { class: 'embed-expr' }, seg.text));
    } else if (seg.type === 'pick') {
      container.appendChild(el('span', { class: 'embed-pick' }, seg.text));
    } else if (seg.type === 'op') {
      const opName = String(seg.operationName == null ? '' : seg.operationName);
      const body = String(seg.text == null ? '' : seg.text);
      const summary = '{' + opName + '} \u2192 ' + body;
      container.appendChild(el('span', {
        class: 'embed-op',
        title: summary.length > 140 ? summary.slice(0, 137) + '...' : summary,
      }, seg.text));
    } else if (seg.type === 'ref') {
      const token = String(seg.token == null ? '' : seg.token);
      const body = String(seg.text == null ? '' : seg.text);
      const summary = token + ' \u2192 ' + body;
      container.appendChild(el('span', {
        class: 'embed-ref',
        title: summary.length > 140 ? summary.slice(0, 137) + '...' : summary,
      }, seg.text));
    } else if (seg.type === 'error') {
      container.appendChild(el('span', { class: 'embed-err' }, seg.text));
    }
  }
}

function renderEmbedHighlight(container, text, tableFile) {
  container.replaceChildren();
  const file = typeof tableFile === 'string' ? tableFile : '';
  let containers = null;
  for (const seg of GeneratorEngine.parseEmbeds(text)) {
    if (seg.type === 'text') {
      container.appendChild(document.createTextNode(seg.text));
    } else if (seg.type === 'op') {
      container.appendChild(el('span', {
        class: 'embed-op',
        title: 'operation: ' + seg.inner.trim(),
      }, seg.raw));
    } else if (seg.type === 'inline') {
      container.appendChild(el('span', { class: 'embed-pick' }, seg.raw));
    } else if (seg.type === 'container') {
      if (containers === null) containers = embedContainers();
      const found = GeneratorEngine.findContainer(seg.inner, containers, file);
      container.appendChild(el('span', {
        class: found.ok ? 'embed-ref' : 'embed-ref-missing',
        title: found.ok ? 'container: ' + found.container.name : 'no container named "' + seg.inner.trim() + '"',
      }, seg.raw));
    } else {
      container.appendChild(el('span', { class: 'embed-expr' }, seg.raw));
    }
  }
}

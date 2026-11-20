(function () {
  'use strict';

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightSource(source) {
    const text = typeof source === 'string' ? source : '';
    const LL = (typeof LogicLanguage !== 'undefined') ? LogicLanguage : null;
    if (!LL || typeof LL.highlightTokens !== 'function') {
      return escapeHtml(text);
    }
    const map = (LL.HIGHLIGHT && typeof LL.HIGHLIGHT === 'object') ? LL.HIGHLIGHT : {};
    const tokens = LL.highlightTokens(text);
    const out = [];
    for (const t of tokens) {
      const cat = (t && typeof t.category === 'string') ? t.category : 'text';
      const h = (map[cat] && typeof map[cat] === 'object') ? map[cat] : null;
      const piece = escapeHtml(t && typeof t.text === 'string' ? t.text : '');
      if (h && typeof h.cls === 'string') {
        out.push('<span class="' + h.cls + '">' + piece + '</span>');
      } else {
        out.push(piece);
      }
    }
    return out.join('');
  }

  function highlightSamples() {
    const blocks = document.querySelectorAll('.code-sample[data-highlight="script"] code');
    for (const block of blocks) {
      block.innerHTML = highlightSource(block.textContent);
    }
  }

  highlightSamples();
})();

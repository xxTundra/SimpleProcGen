'use strict';
function setupDnd() {
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    handleDroppedFiles([...e.dataTransfer.files]);
  });
}


async function init() {
  setupRollBar();
  setupExamplesPanel();
  setupTabs();
  setupHistory();
  setupThemeSwitcher();
  setupDnd();
  {
    const toastEl = document.getElementById('toast');
    if (toastEl) toastEl.setAttribute('aria-live', 'polite');
  }
  document.getElementById('connect-folder').addEventListener('click', () => connectFolder(state.savedDirHandle || null));
  state.history = loadHistory();

  const base = await tryServer();
  if (base != null) {
    state.mode = 'server';
    state.storage = makeServerStorage(base);
    renderAll();
    await loadAllFiles().catch((e) => toast('Failed to load data: ' + e.message, 'error'));
    return;
  }

  if (typeof window.showDirectoryPicker === 'function') {
    state.folderEligible = true;
    try {
      const saved = await idbGet('meta', 'dataDirHandle');
      if (saved) {
        state.savedDirHandle = saved;
        const perm = await saved.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await connectFolder(saved);
          return;
        }
      }
    } catch (_) {  }
    state.mode = 'none';
    state.storage = makeLocalStorage();
    renderAll();
    await loadAllFiles().catch((e) => toast('Failed to load data: ' + e.message, 'error'));
    return;
  }

  state.mode = 'local';
  state.storage = makeLocalStorage();
  renderAll();
  await loadAllFiles().catch((e) => toast('Failed to load data: ' + e.message, 'error'));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

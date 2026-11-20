
function renderStatus() {
  const pill = document.getElementById('status-pill');
  const hint = document.getElementById('status-hint');
  const connectBtn = document.getElementById('connect-folder');
  let label;
  let cls;
  let hintText = '';
  if (state.mode === 'server') {
    label = 'Server connected';
    cls = 'ok';
  } else if (state.mode === 'folder') {
    label = 'Folder: ' + state.folderName;
    cls = 'ok';
  } else if (state.mode === 'local') {
    label = 'Local (drag & drop)';
    cls = 'local';
  } else {
    label = 'No data source';
    cls = 'none';
    hintText = 'Run start-server.bat, connect the data folder, or drop JSON files here.';
  }
  pill.textContent = label;
  pill.className = 'pill ' + cls;
  hint.textContent = hintText;
  hint.hidden = hintText === '';
  connectBtn.hidden = !(state.folderEligible && (state.mode === 'none' || state.mode === 'local'));
}



function renderAll() {
  renderStatus();
  updateSuggestions();
  renderHistory();
  if (state.activeTab === 'macros') renderMacrosTab();
  else if (state.activeTab === 'tables') renderTablesTab();
  else if (state.activeTab === 'generators') renderGeneratorsTab();
  else if (state.activeTab === 'logic') renderLogicOpsTab();
  else renderFilesTab();
}

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tabs .tab').forEach((b) => {
    const active = b.dataset.tab === name;
    b.setAttribute('aria-selected', active ? 'true' : 'false');
    b.classList.toggle('active', active);
  });
  for (const n of ['macros', 'tables', 'generators', 'logic', 'files']) {
    document.getElementById('tab-' + n).hidden = n !== name;
  }
  renderAll();
}

function setupTabs() {
  document.querySelectorAll('.tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}



function applyTheme(theme) {
  if (THEMES.indexOf(theme) === -1) theme = 'midnight';
  document.documentElement.dataset.theme = theme;
  const select = document.getElementById('theme-select');
  if (select) select.value = theme;
  return theme;
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {  }
}

function setupThemeSwitcher() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {  }
  applyTheme(THEMES.indexOf(saved) !== -1 ? saved : 'midnight');
  const select = document.getElementById('theme-select');
  if (select) {
    select.addEventListener('change', () => {
      const theme = applyTheme(select.value);
      saveTheme(theme);
    });
  }
}



function openIdb() {
  if (idbFailed) return Promise.reject(new Error('IndexedDB unavailable'));
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      idbFailed = true;
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      idbFailed = true;
      reject(req.error || new Error('IndexedDB open failed'));
    };
  });
  return idbPromise;
}

function idbRequest(store, mode, run) {
  return openIdb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const err = (e) => reject(e || new Error('IndexedDB request failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => err(tx.error);
    tx.onabort = () => err(tx.error);
    run(tx.objectStore(store));
  }));
}

async function idbGet(store, key) {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('IndexedDB read failed'));
    });
  } catch (_) {
    return memStore[store].get(key);
  }
}

async function idbSet(store, key, value) {
  try {
    await idbRequest(store, 'readwrite', (s) => { s.put(value, key); });
  } catch (_) {
    memStore[store].set(key, value);
  }
}

async function idbDel(store, key) {
  try {
    await idbRequest(store, 'readwrite', (s) => { s.delete(key); });
  } catch (_) {
    memStore[store].delete(key);
  }
}

async function idbAll(store) {
  try {
    const db = await openIdb();
    const read = (method) => new Promise((resolve, reject) => {
      const r = db.transaction(store, 'readonly').objectStore(store)[method]();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('IndexedDB read failed'));
    });
    const [keys, values] = await Promise.all([read('getAllKeys'), read('getAll')]);
    return keys.map((k, i) => [k, values[i]]);
  } catch (_) {
    return [...memStore[store].entries()];
  }
}



function isDataPath(path) {
  return typeof path === 'string'
    && path.toLowerCase().endsWith('.json')
    && (path.startsWith('tables/') || path.startsWith('dice-macros/') ||
        path.startsWith('generators/') || path.startsWith('logic-ops/'));
}


function makeServerStorage(base) {
  const rawUrl = (p) => base + '/api/raw?path=' + encodeURIComponent(p);

  async function httpError(res) {
    let msg = 'HTTP ' + res.status;
    try {
      const data = await res.json();
      if (data && typeof data.error === 'string' && data.error !== '') msg = data.error;
    } catch (_) {  }
    throw new Error(msg);
  }

  return {
    mode: 'server',
    async listFiles() {
      const res = await fetch(base + '/api/files', { cache: 'no-store' });
      if (!res.ok) await httpError(res);
      const data = await res.json();
      const files = (Array.isArray(data.files) ? data.files : [])
        .filter((f) => f && typeof f.path === 'string' && isDataPath(f.path));
      const results = await Promise.all(files.map(async (f) => {
        try {
          const r = await fetch(rawUrl(f.path), { cache: 'no-store' });
          if (!r.ok) return [f.path, { error: (await httpError(r)).message }];
          return [f.path, { text: await r.text() }];
        } catch (e) {
          return [f.path, { error: e.message }];
        }
      }));
      return new Map(results);
    },
    async readFile(path) {
      const res = await fetch(rawUrl(path), { cache: 'no-store' });
      if (!res.ok) await httpError(res);
      return res.text();
    },
    async writeFile(path, text) {
      const res = await fetch(rawUrl(path), {
        method: 'PUT',
        body: text,
        headers: { 'Content-Type': 'text/plain' },
      });
      if (!res.ok) await httpError(res);
    },
    async createFile(path, text) {
      const res = await fetch(rawUrl(path), {
        method: 'POST',
        body: text,
        headers: { 'Content-Type': 'text/plain' },
      });
      if (res.status === 409) throw new Error('File already exists');
      if (!res.ok) await httpError(res);
    },
    async deleteFile(path) {
      const res = await fetch(rawUrl(path), { method: 'DELETE' });
      if (!res.ok) await httpError(res);
    },
  };
}


function makeFolderStorage(root) {
  const subHandles = {};
  async function subDir(name) {
    if (!subHandles[name]) subHandles[name] = await root.getDirectoryHandle(name, { create: true });
    return subHandles[name];
  }
  async function readEntry(dir, name) {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file.text();
  }
  return {
    mode: 'folder',
    async listFiles() {
      const map = new Map();
      for (const sub of DATA_SUBFOLDERS) {
        let dir;
        try {
          dir = await root.getDirectoryHandle(sub, { create: false });
        } catch (_) {
          continue;
        }
        for await (const entry of dir.values()) {
          if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
          try {
            map.set(sub + '/' + entry.name, { text: await readEntry(dir, entry.name) });
          } catch (e) {
            map.set(sub + '/' + entry.name, { error: e.message });
          }
        }
      }
      return map;
    },
    async readFile(path) {
      const parts = path.split('/');
      return readEntry(await subDir(parts[0]), parts[1]);
    },
    async writeFile(path, text) {
      const parts = path.split('/');
      const dir = await subDir(parts[0]);
      const handle = await dir.getFileHandle(parts[1], { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    },
    async createFile(path, text) {
      const parts = path.split('/');
      const dir = await subDir(parts[0]);
      const handle = await dir.getFileHandle(parts[1], { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    },
    async deleteFile(path) {
      const parts = path.split('/');
      await (await subDir(parts[0])).removeEntry(parts[1]);
    },
  };
}


function makeLocalStorage() {
  return {
    mode: 'local',
    async listFiles() {
      const entries = await idbAll('files');
      const map = new Map();
      for (const [path, text] of entries) {
        if (typeof text !== 'string') continue;
        map.set(path, { text });
      }
      return map;
    },
    async readFile(path) {
      const text = await idbGet('files', path);
      if (text == null) throw new Error('File not found: ' + path);
      return text;
    },
    async writeFile(path, text) { await idbSet('files', path, text); },
    async createFile(path, text) { await idbSet('files', path, text); },
    async deleteFile(path) { await idbDel('files', path); },
  };
}


async function tryServer() {
  const alreadyHere = location.protocol === 'http:' && location.hostname === '127.0.0.1' && location.port === '8923';
  const base = alreadyHere ? '' : 'http://127.0.0.1:8923';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(base + '/api/health', { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok === true ? base : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function connectFolder(savedHandle) {
  try {
    let handle = savedHandle;
    if (!handle) {
      handle = await window.showDirectoryPicker();
    } else {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        toast('Folder permission was not granted.', 'error');
        return;
      }
    }
    try { await idbSet('meta', 'dataDirHandle', handle); } catch (_) {  }

    const found = [];
    for (const sub of DATA_SUBFOLDERS) {
      try {
        await handle.getDirectoryHandle(sub, { create: false });
        found.push(sub);
      } catch (_) {  }
    }

    state.mode = 'folder';
    state.folderName = handle.name;
    state.storage = makeFolderStorage(handle);
    renderAll();
    await loadAllFiles();
    if (found.length === 0) {
      toast('Note: this folder has no tables/, dice-macros/, generators/ or logic-ops/ subfolders yet — they will be created when you add files.', 'warn');
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Could not connect the folder: ' + (e && e.message ? e.message : String(e)), 'error');
  }
}



function setFile(path, text, error) {
  let parsed = null;
  let parseError = error == null ? null : error;
  if (parseError == null && text != null) {
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parseError = e.message;
    }
  }
  state.files.set(path, { text: text == null ? '' : text, parsed, error: parseError });
}

function itemsOf(path) {
  const entry = state.files.get(path);
  if (!entry || entry.parsed === null || !Array.isArray(entry.parsed.items)) return [];
  return entry.parsed.items;
}

function strOf(obj, key) {
  return obj && typeof obj === 'object' && typeof obj[key] === 'string' ? obj[key] : '';
}

function derive() {
  const macros = [];
  const tables = [];
  const generators = [];
  const logicOps = [];
  const warnings = [];
  const seenMacro = new Map();
  const seenTable = new Map();
  const seenOp = new Map();

  for (const path of [...state.files.keys()].sort()) {
    const entry = state.files.get(path);
    if (!entry) continue;
    if (entry.error) {
      warnings.push({ kind: 'parse', path, message: entry.error });
      continue;
    }
    if (!entry.parsed || !Array.isArray(entry.parsed.items)) {
      warnings.push({ kind: 'parse', path, message: 'Expected a top-level "items" array.' });
      continue;
    }
    const items = entry.parsed.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isObj = item && typeof item === 'object' && !Array.isArray(item);
      if (path.startsWith('dice-macros/')) {
        const name = isObj ? strOf(item, 'name') : '';
        const formula = isObj ? strOf(item, 'formula') : '';
        if (name.trim() !== '' && formula.trim() !== '') {
          const key = name.trim().toLowerCase();
          if (seenMacro.has(key)) {
            warnings.push({ kind: 'dup', what: 'macro', name, path, first: seenMacro.get(key) });
          } else {
            seenMacro.set(key, path);
          }
          macros.push({
            file: path,
            index: i,
            name,
            label: (isObj && typeof item.label === 'string' && item.label.trim() !== '') ? item.label : name,
            formula,
          });
        } else if (isObj && (name !== '' || formula !== '')) {
          warnings.push({ kind: 'item', path, message: 'Macro #' + (i + 1) + ' needs both a name and a formula; it is ignored.' });
        }
      } else if (path.startsWith('tables/')) {
        const name = isObj ? strOf(item, 'name') : '';
        const hasEntries = isObj && Array.isArray(item.entries);
        if (name.trim() !== '' && hasEntries) {
          const key = name.trim().toLowerCase();
          if (seenTable.has(key)) {
            warnings.push({ kind: 'dup', what: 'table', name, path, first: seenTable.get(key) });
          } else {
            seenTable.set(key, path);
          }
          tables.push({ file: path, index: i, name, entries: item.entries });
        } else if (isObj && (name !== '' || item.entries != null)) {
          warnings.push({ kind: 'item', path, message: 'Table #' + (i + 1) + ' needs a name and an "entries" array; it is ignored.' });
        }
      } else if (path.startsWith('generators/')) {
        if (!isObj) {
          warnings.push({ kind: 'item', path, message: 'Generator #' + (i + 1) + ' is not an object; it is ignored.' });
          continue;
        }
        const name = strOf(item, 'name');
        generators.push({
          file: path,
          index: i,
          id: typeof item.id === 'string' ? item.id : '',
          name,
          description: strOf(item, 'description'),
          template: strOf(item, 'template'),
          references: Array.isArray(item.references) ? item.references : [],
          operations: Array.isArray(item.operations) ? item.operations : [],
        });
        if (name === '') {
          warnings.push({ kind: 'item', path, message: 'Generator #' + (i + 1) + ' has no name; it is kept in memory until this file is next saved.' });
        }
      } else if (path.startsWith('logic-ops/')) {
        if (!isObj) {
          warnings.push({ kind: 'item', path, message: 'Operation #' + (i + 1) + ' is not an object; it is ignored.' });
          continue;
        }
        const name = strOf(item, 'name');
        const isScriptOp = typeof item.script === 'string';
        if (name.trim() !== '' && isScriptOp) {
          const key = name.trim().toLowerCase();
          if (seenOp.has(key)) {
            warnings.push({ kind: 'dup', what: 'operation', name, path, first: seenOp.get(key) });
          } else {
            seenOp.set(key, path);
          }
          logicOps.push({
            file: path,
            index: i,
            id: typeof item.id === 'string' ? item.id : '',
            name,
            purpose: strOf(item, 'purpose'),
            script: item.script,
            outputTemplate: typeof item.outputTemplate === 'string' ? item.outputTemplate : '',
            config: (item.config && typeof item.config === 'object' && !Array.isArray(item.config))
              ? item.config
              : {},
          });
        } else if (name !== '') {
          warnings.push({ kind: 'item', path, message: 'Operation #' + (i + 1) + ' has no code; it is ignored.' });
        }
      }
    }
  }
  state.macros = macros;
  state.tables = tables;
  state.generators = generators;
  state.logicOps = logicOps;
  state.warnings = warnings;
}

async function ensureOperationIds(path) {
  const entry = state.files.get(path);
  if (!entry || !entry.parsed || !Array.isArray(entry.parsed.items)) return;
  let changed = false;
  for (const item of entry.parsed.items) {
    if (item && typeof item === 'object' && !Array.isArray(item) &&
        (typeof item.id !== 'string' || item.id === '')) {
      item.id = 'op_' + randomIdHex();
      changed = true;
    }
  }
  if (!changed) return;
  const text = JSON.stringify({ items: entry.parsed.items }, null, 2) + '\n';
  try {
    await state.storage.writeFile(path, text);
    entry.text = text;
  } catch (e) {
    toast('Could not save operation ids in ' + path + ': ' + e.message, 'warn');
  }
}

async function loadAllFiles() {
  const map = await state.storage.listFiles();
  state.files.clear();
  for (const [path, payload] of map) {
    if (payload && payload.error != null) setFile(path, null, payload.error);
    else setFile(path, payload && typeof payload.text === 'string' ? payload.text : '');
  }
  derive();
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('tables/')).sort()) {
    await ensureContainerIds(p);
    await ensureEntryOpRefs(p);
  }
  for (const p of [...state.files.keys()].filter((q) => q.startsWith('logic-ops/')).sort()) {
    await ensureOperationIds(p);
  }
  derive();
  renderAll();
}

let toastTimer = null;
let genCommitInFlight = null;
const IDB_NAME = 'ttrpg-db';
let idbPromise = null;
let idbFailed = false;
const memStore = { files: new Map(), meta: new Map() };
const DATA_SUBFOLDERS = ['tables', 'dice-macros', 'generators', 'logic-ops'];
const state = {
  mode: 'none',
  storage: null,
  files: new Map(),
  macros: [],
  tables: [],
  generators: [],
  logicOps: [],
  warnings: [],
  rollMode: 'normal',
  history: [],
  activeTab: 'macros',
  selectedTable: null,
  lastTableRoll: null,
  tableSearch: '',
  tableFileFilter: '',
  genSearch: '',
  genEditor: null,
  genLastRun: null,
  genLastSuccess: null,
  logicFile: null,
  logicOp: null,
  logicSearch: '',
  folderEligible: false,
  savedDirHandle: null,
  folderName: '',
};
const OP_SYMBOL = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const EXPLOSION_CAP = 1000;
const HISTORY_KEY = 'ttrpg-history';
const HISTORY_MAX = 50;
const suggestState = { items: [], hi: -1, timer: null };
const THEME_KEY = 'ttrpg-theme';
const THEMES = ['midnight', 'paper', 'ember', 'mono'];
const genRollEntry = (container) => weightedPick(Array.isArray(container.entries) ? container.entries : []);

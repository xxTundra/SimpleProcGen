# TTRPG Tools

A local, browser-based toolkit for tabletop RPG randomness: roll dice, pick from weighted tables, and generate text — no packages to install, no accounts, and nothing leaves your machine. Its strength is composition: macros and tables are referenceable from anywhere, tables nest inside tables, and generators and logic scripts weave macros, tables, inline values, and each other together. One small, tightly connected set of tools covers 99% of what you'd ever want from randomness and predefined tables.

## Features

- **Dice rolls** — full dice notation (NdM, arithmetic, rerolls, explosions, keep-highest/lowest, count-successes), Advantage/Disadvantage, and a per-die breakdown of every result
- **Dice macros** — named dice expressions, callable by name from the roll bar or embedded in tables, generators, and logic scripts
- **Weighted tables** — weighted entries and weighted picks, plus no-repeat picks via the `UNIQUE` form in logic scripts
- **Text generators** — Perchance-style templates mixing macros, tables, logic operations, and inline values
- **Embedded spans** — `|dice|`, `((range or weighted choice))`, `[table]`, `{operation}` resolve in table entries and generator templates; in logic scripts the usable spans are `|...|`, `((...))`, and `[Name]`
- **Logic scripts** — a small line-by-line scripting language for conditional, logic-based generation
- **Composition** — macros and tables referenceable from anywhere; tables inside tables; generators and logic scripts referencing macros, tables, inline values, and each other; table rolls in a generator can be named so logic scripts can act on them
- **In-app editing** — everything is created and edited through tab UIs, with JSON auto-formatted behind the scenes
- **Import & export** — share content as JSON files, imported and exported in-app
- **Built-in help** — in-depth documentation from the Help button in the roll panel and the Tables, Generators, and Logic tabs

## Prerequisite

Node.js on your PATH. That is the only requirement.

## Running

The app is served by a small local server on `http://127.0.0.1:8923/`.

- **Windows**: double-click `start-server.bat`
- **macOS**: run `./start-server.sh`
- **Linux**: run `./start-server.sh`

Both launchers check whether a server is already healthy on port 8923 and, if not, start one, wait until it answers, then open the app in your browser.

## Feature reference

### Dice & macros

- **Dice notation** — `NdM` (up to 1,000,000 dice), bare `dN`, `+ - * /` with precedence, parentheses, and per-roll modifiers: `r` (reroll ones), `x` (explosions), `khN` / `klN` (keep highest/lowest), `csN` (count successes)
- **Advantage / Disadvantage** — the expression is rolled twice and the higher or lower result is kept (silently disabled when the expression uses `kh` / `kl`)
- **Result inspection** — per-die chips with reroll, explosion, and discarded tags, step lines, and macro-expansion arrows (e.g. `sword → (1d20+5)`)
- **Dice macros** — named dice expressions stored in macro files, callable by name from the roll bar and from `|...|` spans

### Tables

- **Weighted picks** — every entry carries a weight; the roll draws across the total weight
- **Embeddable entries** — entry labels resolve `|...|`, `((...))`, `[Name]`, and `{op}` spans with the same resolver generators use
- **Tables inside tables** — `[Name]` references pull an entry from another container and resolve it recursively, up to 8 levels with cycle detection
- **No-repeat picks** — the `UNIQUE` SET-value form draws N distinct rows without replacement; `EACH ROLL` draws with replacement

### Generators

- **Templates** — Perchance-style free text with embedded spans: `[container]` for a table roll, `|dice or macro|`, `((range or weighted choice))`, and `{operation}` for a logic operation
- **Advanced mode** — a Bindings panel names span results (including table rolls) so logic operations can `IMPORT` and act on them, and an Operation preview shows each operation span's last run output; a Validation panel, visible in both modes, flags problems
- **Management** — run, edit (with token autocomplete), rename, duplicate, delete, and export per generator

### Logic scripts

- **The language** — 12 case-sensitive keywords (`SET`, `ROLL`, `IF`, `THEN`, `ELSE`, `SWITCH`, `CASE`, `DEFAULT`, `IMPORT`, `EXPOSE`, `AND`, `OR`) plus `true` / `false`, one statement per line, `#` comments
- **Rolling** — `ROLL` a dice macro (`|...|`), a table container (`[Name]`), or an inline value
- **Variables** — `SET` local values, `IMPORT` named values from a run, and `EXPOSE` them in an Output Template
- **Nested operations** — operations reach other operations through `{op}` spans in table entries and templates, up to 4 levels deep, with cycle detection
- **Test panel** — run an operation standalone with per-IMPORT inputs, an execution trace, Exposed chips, and a variable table

### App-wide

- **Embedded spans** — `|...|` (dice/macro), `((...))` (inline range or weighted choice), `[Name]` (table), `{name}` (operation): usable in table entries and generator templates; in logic scripts the usable spans are `|...|`, `((...))`, and `[Name]`
- **In-app editing** — all content is created and edited through tab UIs; JSON is auto-formatted and IDs auto-assigned behind the scenes on every save
- **Roll history** — every roll and generator run is logged with time, expression, and value, with per-row copy; capped at 50 entries, persisted locally, clearable
- **Themes** — midnight (default), paper, ember, and mono, chosen from the header and remembered between sessions
- **Import & export** — export per generator, or "export all" per tab (generators can export with their containers), import with preview and ID-remap dialogs (conflicting items are imported separately, never merged), drag & drop `.json` files anywhere on the page, and a Files tab for downloading or deleting individual files
- **Starter content** — four shipped files demo a full composition: the Chest table nests an Oracle table roll, a dice macro, and an inline range; the Chest Hunt generator rolls it and runs the ChestAppraisal logic operation on the result
- **Help** — six in-app help pages (intro, dice, macros, tables, generators, logic) with a sidebar and prev/next pagers, reached from the Help button in the roll panel and on the Tables, Generators, and Logic tabs
- **Local storage backends** — the local Node server, a connected folder via the File-System-Access picker, or an IndexedDB fallback; the status pill shows which mode is active

## Layout

- `css/` — app stylesheet
- `data/` — your content: `dice-macros/`, `tables/`, `generators/`, `logic-ops/`
- `help/` — built-in help site
- `js/` — front-end app modules
- `server/` — local Node.js server
- `tests/` — test suites, headless UI harness, and `fixtures/` starter seeds

## Tests

If you just want to use the app, you can skip this section. Running it needs nothing beyond Node.js and the start scripts above; the tests are for contributors and developers who want to verify the app.

Three suites run with plain `node` and make deterministic assertions against the real app modules:

- `node tests/ttrpg-engine-test.js` — dice engine, 1483 checks
- `node tests/ttrpg-rollflow-test.js` — roll flow, 796 checks
- `node tests/ttrpg-server-contract-test.js` — server contract, 223 checks

A fourth, `node tests/headless-ui-harness.js`, drives the real app UI headlessly through 28 scenarios and restores the four starter files from `tests/fixtures/` into `data/` before each run.

The harness is the only part that needs an extra dependency: `jsdom`. It is a dev-only package, never needed to run the app. A developer provides it with `npm install --no-save jsdom` at the repo root, or by pointing the `JSDOM_PATH` environment variable at an installed copy.

## License

MIT — the license is configured on the GitHub repository page.

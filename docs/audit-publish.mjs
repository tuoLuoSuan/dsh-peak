/**
 * Publication pre-flight.
 *
 * Three things a release should never carry: a client half that cannot be
 * loaded, and the two that a public commit should never carry — the author's
 * Windows account name (fixture paths are rendered straight into screenshots)
 * and absolute paths that only resolve on one machine.
 *
 * Read-only, apart from a scratch copy of the load probe. Exits non-zero if
 * anything needs attention, so it can gate a release: it is wired to
 * `prepublishOnly`, which is how 0.1.4 should have been stopped — it went out
 * with a SyntaxError in client.js and nothing in the repository looked at
 * whether the file compiles.
 *
 * Exit codes follow the house convention:
 *   0  clean
 *   1  something is wrong — do not publish
 *   2  the check could not run (no browser for the load probe); says nothing
 *      about the package, but a release gate should not pass on a shrug
 */
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', '.git', 'preview', 'screenshots'])
// Scratch files are never published (`.tmp*` is in .gitignore), so they must not
// be able to fail a release gate.
const SKIP_FILES = /^\.tmp/
const TEXT = /\.(?:mjs|js|json|md|yml|yaml|css|svg|txt)$/

// ---------------------------------------------------------------- the bundle
// Reading the file is not enough. Everything else in this repository reads
// client.js as text — the verifier slices the policy out and compiles it on its
// own, and matches the stylesheet with regular expressions — so a file that
// cannot be compiled at all passes all of it. 0.1.4 proved that: a backtick
// inside the CSS template literal ended the literal early, the application
// reported "failed to import", and every local check was green. This is the
// check that looks at the file the way the browser does.

function loadProbe() {
  const probe = `<!doctype html>
<html><head><meta charset="utf-8"><title>audit: does the bundle load</title>
<script>
  window.__PROBE__ = { state: 'no loader call' };
  window.__ModuleLoader__ = { load: function (module) {
    window.__PROBE__.id = module && module.id;
    window.__PROBE__.factoryType = typeof (module && module.factory);
    try {
      var React = { createElement: function () { return null; },
                    useState: function (v) { return [v, function () {}]; },
                    useEffect: function () {}, useRef: function () { return { current: null }; },
                    useSyncExternalStore: function (s, g) { return g(); },
                    memo: function (c) { return c; },
                    useCallback: function (f) { return f; }, useMemo: function (f) { return f(); },
                    useReducer: function (r, i) { return [i, function () {}]; },
                    Fragment: 'fragment' };
      var exports = module.factory(function (name) { return name === 'react' ? React : {}; });
      window.__PROBE__.state = 'factory ran';
      window.__PROBE__.exportKeys = exports ? Object.keys(exports).sort().join(',') : 'none';
    } catch (error) {
      // A stub React is allowed to run out of functions: what is on trial is
      // whether the module parses and registers, and reaching the factory at all
      // means it did.
      window.__PROBE__.state = 'factory threw: ' + error.message;
    }
  } };
</script>
</head><body>
<script src="client.js"></script>
<pre id="out">pending</pre>
<script>document.getElementById('out').textContent = JSON.stringify(window.__PROBE__);</script>
</body></html>`
  const page = join(ROOT, '.tmp-audit-load.html')
  writeFileSync(page, probe, 'utf8')
  const edge = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].find((candidate) => existsSync(candidate))
  if (edge === undefined) return { verdict: 2, detail: 'no Edge binary found, so the bundle was not loaded anywhere' }
  const profile = join(ROOT, '.tmp-audit-load-profile')
  const url = 'file:///' + page.replace(/\\/g, '/')
  let dom = ''
  try {
    dom = execFileSync(edge, ['--headless=new', '--disable-gpu', '--no-sandbox',
      `--user-data-dir=${profile}`, '--dump-dom', url], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    return { verdict: 2, detail: `the browser did not run: ${error.message}` }
  } finally {
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* the browser may still hold it */ }
    try { rmSync(page, { force: true }) } catch { /* nothing to clean */ }
  }
  const match = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
  if (match === null) return { verdict: 2, detail: `the probe page produced no output (${dom.length} bytes of DOM)` }
  const result = JSON.parse(match[1])
  const reached = typeof result.state === 'string'
    && (result.state === 'factory ran' || result.state.startsWith('factory threw'))
  if (!reached) {
    return { verdict: 1, detail: `${result.state} — the browser could not load client.js` }
  }
  if (result.id !== 'dsh-peak') {
    return { verdict: 1, detail: `the bundle registered itself as ${result.id}` }
  }
  if (result.factoryType !== 'function') {
    return { verdict: 1, detail: 'the bundle registered without a factory' }
  }
  return { verdict: 0, detail: `client.js parses in Edge and registers ${result.id} (${result.state})` }
}

const load = loadProbe()
console.log(`bundle: ${load.verdict === 0 ? 'ok' : load.verdict === 1 ? 'FAIL' : 'NOT RUN'}  ${load.detail}`)

// ------------------------------------------------------------------ hygiene

// Fixture homes are fine as long as they are obviously nobody's real home.
const PLACEHOLDER_ACCOUNTS = new Set(['you', 'user', 'me', 'example', 'someone'])

// Paths that may legitimately be absolute:
//   - fixture homes, which are display-only strings nobody ever touches
//   - browser executables, which are inherently machine-specific and probed
const PLACEHOLDER_PREFIX = new RegExp(
  `^[A-Za-z]:[\\\\/]+Users[\\\\/]+(?:${[...PLACEHOLDER_ACCOUNTS].join('|')})[\\\\/]`,
  'i',
)
const ALLOWED_ABSOLUTE = [
  PLACEHOLDER_PREFIX,
  // `D:\path\to\thing` is the canonical "put your own path here" placeholder
  // and cannot name anybody's real directory.
  /^[A-Za-z]:[\\/]+path[\\/]+to[\\/]/i,
  /^\/path\/to\//i,
  // The scan stops at whitespace, so `C:\Program Files\...` arrives truncated.
  /^[A-Za-z]:[\\/]+Program/,
  /^[A-Za-z]:[\\/]+Program Files(?: \(x86\))?[\\/]/i,
  /^\/usr\/(?:bin|local)\//,
]

const NOTE = `This file names a real Windows account. Fixture paths must use one of:
  ${[...PLACEHOLDER_ACCOUNTS].join(', ')}`

async function walk(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.test(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await walk(path))
    else if (TEXT.test(entry.name)) found.push(path)
  }
  return found
}

const files = await walk(ROOT)
const accounts = []
const absolutes = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const label = relative(ROOT, file).split(sep).join('/')

  for (const match of text.matchAll(/Users[\\/]+([A-Za-z0-9._-]+)/g)) {
    if (!PLACEHOLDER_ACCOUNTS.has(match[1].toLowerCase())) {
      accounts.push(`${label}: Users${match[0][5]}${match[1]}   — ${NOTE}`)
    }
  }

  // `https://x` starts with `s:` which looks like a drive letter; require a
  // backslash or a forward slash that is not part of a scheme.
  for (const match of text.matchAll(/(?<![A-Za-z])([A-Za-z]:[\\/][^'"`\s)]{3,})/g)) {
    if (ALLOWED_ABSOLUTE.some((allowed) => allowed.test(match[1]))) continue
    absolutes.push(`${label}: ${match[1]}`)
  }
}

console.log(`scanned ${files.length} text files under ${ROOT}`)
console.log(`\nreal account names in fixture paths: ${accounts.length}`)
for (const line of new Set(accounts)) console.log('  ' + line)
console.log(`\nabsolute paths: ${absolutes.length}`)
for (const line of new Set(absolutes)) console.log('  ' + line)

if (accounts.length > 0 || absolutes.length > 0) {
  console.log('\nreview the lines above before publishing.')
  process.exitCode = 1
} else {
  console.log('\nnothing machine-specific found.')
}

// A release gate that shrugs is not a gate: if the load probe could not run,
// say so and refuse, rather than publishing on the strength of the checks that
// happened to be runnable.
if (load.verdict !== 0) {
  console.log('\nthe bundle check did not pass, so this is not publishable.')
  process.exitCode = load.verdict === 2 ? 2 : 1
}

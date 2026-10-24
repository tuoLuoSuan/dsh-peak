/**
 * Install this package into a throwaway dsh profile exactly the way a stranger
 * would, then answer the question the repository cannot answer about itself:
 * does the published tarball actually become a running plugin?
 *
 * Everything else in this repository tests the code. `verify-policy.mjs` reads
 * the decision out of the source and the demo renders the chip from a fixture,
 * and both of those pass on a package that installs into nothing. The wiring
 * that turns a tarball into a plugin lives in three files that no other check
 * opens: `package.json` (which names the package), `cordis.patch.yml` (which
 * names it a second time, to the host), and `dsh.client.inject` (which names
 * what the client half needs before it may run). A typo in `cordis.patch.yml`
 * produces a plugin that installs cleanly, registers cleanly, and never loads.
 *
 * Usage: node docs/probe-npm-install.mjs [<spec>]   (default: the published package)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

const PROFILE = '__npm_probe_peak__'
const HOME = process.env.USERPROFILE ?? process.env.HOME
const PACKAGE = 'dsh-peak'

/*
 * The default is the registry spec, not a local tarball. Installing the version
 * that is actually published is the thing a stranger does; reading the tarball
 * only proves the tarball is fine. Pass a path to test a local pack instead.
 *
 * The version is pinned, and that is the whole point of this probe. A bare name
 * does NOT resolve to `latest`: pnpm 11 ships a release cooldown (its built-in
 * `minimumReleaseAge`), so for 24 hours after a publish `pnpm add <name>` picks
 * the newest version older than the window and writes that range into the
 * profile. Asking for the bare name therefore tests the *previous* release --
 * measured on the sibling package in this workspace, a bare name resolved to a
 * version three releases old while the probe printed "a stranger can install
 * this". Naming the version makes the probe test the thing under test; the
 * assertion below then checks that what landed is what we meant to ship.
 *
 * `dsh plugin add github:tuoLuoSuan/dsh-peak` takes a different road and
 * is not subject to the cooldown, which is why the README keeps both.
 */
const local = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const spec = process.argv[2] ?? `${PACKAGE}@${local.version}`
const profileDir = join(HOME, '.dsh', 'profiles', PROFILE)

/*
 * Where the desktop build keeps its CLI. It is not on PATH, so guess the usual
 * install roots and let `PEAK_BADGE_DSH_CLI` settle it -- the same shape as the
 * sibling probe in `dsh-skill-center`, and for the same reason: a path that is
 * right on one machine is a wrong absolute path in the repository.
 */
const CLI_NAMES = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe'] : ['dsh']
const CLI_CANDIDATES = [
  process.env.PEAK_BADGE_DSH_CLI,
  ...(process.env.PATH ?? '').split(delimiter).flatMap((dir) => CLI_NAMES.map((name) => join(dir, name))),
  ...['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']
    .map((key) => process.env[key])
    .filter(Boolean)
    .flatMap((root) => CLI_NAMES.map((name) => join(root, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', name))),
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
  '/usr/local/bin/dsh',
  '/usr/bin/dsh',
].filter(Boolean)

const cli = CLI_CANDIDATES.find((candidate) => existsSync(candidate))

if (cli === undefined) {
  console.error('could not find the dsh CLI. Looked at:')
  for (const candidate of CLI_CANDIDATES) console.error(`  ${candidate}`)
  console.error('\nset PEAK_BADGE_DSH_CLI to the dsh.cmd / dsh you want to test with.')
  // Safe to exit hard here: everything above is synchronous filesystem work, so
  // there is no libuv handle mid-close for the Windows assertion to trip over.
  // (Once any async work has started, set process.exitCode instead.)
  process.exit(2)
}

/*
 * `dsh.cmd` is a two-line shim around an Electron binary running a JS entry:
 *
 *   ELECTRON_RUN_AS_NODE=1 "<root>/DeepSeek Harness.exe" --expose-internals
 *     "<root>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" %*
 *
 * Node refuses to spawn a `.cmd` without a shell (EINVAL), and going through a
 * shell means quoting a path with a space in it. Calling the binary directly is
 * both simpler and closer to what the shim does, so do that and keep the shim
 * only as a fallback.
 *
 * The entry lives inside `app.asar`, which plain Node cannot see -- `existsSync`
 * on it is false even when it is right there. Only the binary is checked; the
 * asar is Electron's problem, and Electron is what runs it.
 */
const binDir = dirname(cli)
const exe = resolve(binDir, '..', '..', '..', '..', 'DeepSeek Harness.exe')
const entry = resolve(binDir, '..', '..', '..', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')

function run(args) {
  const options = { stdio: 'pipe', encoding: 'utf8' }
  if (existsSync(exe)) {
    return execFileSync(exe, ['--expose-internals', entry, ...args], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  }
  return execFileSync('cmd.exe', ['/d', '/s', '/c', `"${cli}" ${args.map((a) => `"${a}"`).join(' ')}`], options)
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` -- ${detail}`}`)
}

/** Every directory a package's name maps to, so a nested copy cannot hide. */
function findInstalled(root, packageName) {
  const found = []
  const walk = (directory, depth) => {
    if (depth > 6) return
    const modules = join(directory, 'node_modules')
    if (!existsSync(modules)) return
    for (const entry of readdirSync(modules)) {
      if (entry.startsWith('.')) continue
      const full = join(modules, entry)
      if (entry === packageName) found.push(full)
      if (entry.startsWith('@')) {
        for (const scoped of readdirSync(full)) {
          if (`${entry}/${scoped}` === packageName) found.push(join(full, scoped))
        }
      }
      let isDirectory = false
      try { isDirectory = statSync(full).isDirectory() } catch { continue }
      if (isDirectory) walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return found
}

console.log(`spec:    ${spec}`)
console.log(`cli:     ${cli}`)
console.log(`profile: ${profileDir}`)
console.log('')

rmSync(profileDir, { recursive: true, force: true })

let installed = false
try {
  const output = run(['plugin', '--profile', PROFILE, 'add', spec])
  installed = true
  const added = output.split('\n').filter((line) => /^\s*[+~-]|Done in|initialized profile/.test(line))
  console.log(added.map((line) => `     ${line.trim()}`).join('\n'))
} catch (error) {
  const text = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`
  check('dsh plugin add succeeds', false, text.trim().split('\n').slice(-5).join(' | '))
}

if (installed) {
  check('dsh plugin add succeeds', true)

  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles ?? []
  check('the host registered the bundle', bundles.includes(PACKAGE), JSON.stringify(bundles))

  const entries = findInstalled(profileDir, PACKAGE)
  check('the plugin landed in the profile', entries.length > 0, entries.join(', '))

  // One field, two consequences: `peerDependencies` is a version gate the host
  // reads, and also a dependency pnpm may try to satisfy.
  const duplicates = findInstalled(profileDir, '@deepseek-ai/dsh')
  check('no second copy of the host was pulled in', duplicates.length === 0, duplicates.join(', '))

  check('the manifest still carries the version gate', typeof local.peerDependencies?.['@deepseek-ai/dsh'] === 'string', JSON.stringify(local.peerDependencies ?? {}))

  const entry = entries[0]
  if (entry !== undefined) {
    /*
     * What landed has to be what we meant to ship. Without this the probe passes
     * on any version at all -- the sibling package's probe printed "a stranger
     * can install this" over an install three releases behind. The cooldown
     * above is why the bare name went there; this assertion is why it will not
     * go there quietly again, and it is the reason the README tells people to
     * write the version number for the first day.
     */
    const landed = JSON.parse(readFileSync(join(entry, 'package.json'), 'utf8')).version
    check('the installed version is the one in package.json', landed === local.version, `installed ${landed}, package.json says ${local.version}`)

    for (const relative of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/zh.json']) {
      check(`tarball ships ${relative}`, existsSync(join(entry, relative)))
    }

    /*
     * The host learns this package's name twice: once from `package.json`, and
     * once from the patch it applies. Nothing compares the two, and nothing
     * would complain if they drifted -- the host would look for a package that
     * is not there and the plugin would simply never load, with a clean install
     * and a clean registration behind it. So compare them here.
     */
    const patch = readFileSync(join(entry, 'cordis.patch.yml'), 'utf8')
    check('the patch names this package', patch.includes(`'${local.name}'`), patch.trim().split('\n').slice(-1)[0].trim())

    // The client half says what it needs before it may run. An empty list, or a
    // list of things that are not strings, is a client half that never mounts.
    const inject = local.dsh?.client?.inject
    check('the client half declares what it injects', Array.isArray(inject) && inject.length > 0 && inject.every((name) => typeof name === 'string' && name !== ''), JSON.stringify(inject))

    const locale = JSON.parse(readFileSync(join(entry, 'locale', 'zh.json'), 'utf8'))
    check('the locale file decodes as Chinese', locale?.meta?.title === '峰谷徽章', JSON.stringify(locale?.meta?.title))
  }
}

console.log('')
rmSync(profileDir, { recursive: true, force: true })
console.log(existsSync(profileDir) ? `FAIL cleanup left ${profileDir}` : 'cleaned up')

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`)
  process.exitCode = 1
} else {
  console.log('\nAll checks passed. A stranger can install this.')
}

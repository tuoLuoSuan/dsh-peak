// Screenshot harness for the README images.
//
//   node demo/shoot.mjs
//
// `demo/index.html` is the demo page: the chip and its card, drawn with the real
// `#region styles` CSS sliced straight out of `client.js`. This script renders
// that page in headless Edge and writes the PNGs into `docs/`.
//
// Why it drives DevTools Protocol instead of `--screenshot`:
//   * `--screenshot` captures the whole viewport, so every frame needs manual
//     padding guesswork and still catches stray background;
//   * it fires before a scripted page is done, which produced images of an empty
//     page that *looked* like successful renders.
// `Page.captureScreenshot` with a clip taken from `getBoundingClientRect()` gives
// the component and nothing else, after the page says it is ready.
//
// A `file://` page may not `fetch` a sibling file (CORS), so the page cannot load
// the stylesheet by itself offline. The harness writes `demo/_shot.html` — the
// same page with the component CSS already inlined — and shoots that. Both
// `_shot.html` and `.tmp-*` are generated and git-ignored.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'docs');
const profile = join(root, '.tmp-shots-profile');
const generated = join(here, '_shot.html');
const generatedMontage = join(here, '_montage.html');
const PORT = 9333;

const BROWSERS = [
  process.env.PEAK_BADGE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const browser = BROWSERS.find((candidate) => existsSync(candidate));
if (browser === undefined) {
  console.error('no browser found; set PEAK_BADGE_BROWSER to an Edge or Chrome executable');
  process.exit(2);
}

/**
 * Pull the plugin's own stylesheet out of client.js, by region marker.
 *
 * Anchor on `const CSS = ` rather than on the region's first backtick: the
 * region opens with `const STYLE_TAG_ID = \`${PACKAGE_ID}/styles\`;`, so slicing
 * between the region's first two backticks drags half the plugin into the
 * `<style>` tag. Every rule is then dead and the page renders as bare markup —
 * which is exactly how the first attempt at these images failed.
 */
function componentCss() {
  const source = readFileSync(join(root, 'client.js'), 'utf8');
  const start = source.indexOf('// #region styles');
  const end = source.indexOf('// #endregion', start);
  if (start < 0 || end < 0) throw new Error('the styles region is missing from client.js');
  const region = source.slice(start, end);
  const anchor = 'const CSS = `';
  const at = region.indexOf(anchor);
  if (at < 0) throw new Error('`const CSS = ` is missing from the styles region');
  const open = at + anchor.length;
  const close = region.indexOf('`;', open);
  if (close < 0) throw new Error('the CSS template literal is not terminated');
  return region.slice(open, close);
}

// Each shot: a page, a query, and the element to clip to. `waitFor` is the
// selector that must exist before the clip is measured. `scale` is the device
// pixel ratio of the capture: the chip is only ~52 css px wide, so a 2x PNG of
// it goes soft the moment the README shows it at a legible size.
const SHOTS = [
  { page: '_montage.html', file: 'composer.png', query: '', clip: 'body', waitFor: 'iframe', scale: 3, fitFrames: true },
  { page: '_shot.html', file: 'chip.png', query: '?view=chip&theme=light', clip: '.peak-badge-root', scale: 6 },
  { page: '_shot.html', file: 'chip-dark.png', query: '?view=chip&theme=dark', clip: '.peak-badge-root', scale: 6 },
  { page: '_shot.html', file: 'chip-peak.png', query: '?view=chip&state=peak&theme=light', clip: '.peak-badge-root', scale: 6 },
  // The card opens upward out of the chip and is absolutely positioned against
  // it, so the chip's own box does not contain it: clip to the union.
  { page: '_shot.html', file: 'card-off.png', query: '?view=card&theme=light', clip: '.peak-badge-root', union: '.peak-badge-card', scale: 4 },
  { page: '_shot.html', file: 'card-peak.png', query: '?view=card&state=peak&theme=light', clip: '.peak-badge-root', union: '.peak-badge-card', scale: 4 },
  { page: '_shot.html', file: 'card-en.png', query: '?view=card&lang=en&theme=light', clip: '.peak-badge-root', union: '.peak-badge-card', scale: 4 },
  // The four states of the notification row, because the complaint that started
  // this was that one of them rendered as nothing at all. `?notify=` fakes the
  // permission state a `file://` page cannot reach.
  { page: '_shot.html', file: 'card-denied.png', query: '?view=card&theme=light&notify=denied', clip: '.peak-badge-root', union: '.peak-badge-card', scale: 4 },
  { page: '_shot.html', file: 'card-unsupported.png', query: '?view=card&theme=light&notify=unsupported', clip: '.peak-badge-root', union: '.peak-badge-card', scale: 4 },
  // The pre-switch notice. It is `position: fixed`, so it is measured in viewport
  // coordinates and the page must not be scrolled — which is why it gets its own
  // page rather than being photographed on top of a card shot.
  { page: '_shot.html', file: 'alert-off.png', query: '?view=toast&theme=light', clip: '.peak-badge-toast', scale: 3 },
  { page: '_shot.html', file: 'alert-peak.png', query: '?view=toast&state=peak&theme=light', clip: '.peak-badge-toast', scale: 3 },
  { page: '_shot.html', file: 'alert-peak-dark.png', query: '?view=toast&state=peak&theme=dark', clip: '.peak-badge-toast', scale: 3 },
];

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function endpoint() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await wait(250);
    }
  }
  throw new Error('the browser never opened its debugging port');
}

/** Minimal CDP client: one page target at a time, no dependencies. */
function connect(url) {
  return new Promise((done, fail) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let next = 1;
    let session = null;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: ok, reject: no } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) no(new Error(message.error.message));
        else ok(message.result);
      }
    });
    socket.addEventListener('error', () => fail(new Error('devtools socket failed')));
    socket.addEventListener('open', () => done({
      send(method, params, useSession = true) {
        return new Promise((ok, no) => {
          const id = next++;
          pending.set(id, { resolve: ok, reject: no });
          const message = { id, method, params };
          if (useSession && session !== null) message.sessionId = session;
          socket.send(JSON.stringify(message));
        });
      },
      setSession(id) { session = id; },
      close() { socket.close(); },
    }));
  });
}

async function shoot(client, shot) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' }, false);
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true }, false);
  client.setSession(sessionId);
  await client.send('Page.enable');
  const url = `file:///${join(here, shot.page).replaceAll('\\', '/')}${shot.query}`;
  await client.send('Page.navigate', { url });

  const selector = shot.waitFor ?? shot.clip;
  const measure = `(() => {
    const nodes = [${JSON.stringify(shot.clip)}, ${shot.union ? JSON.stringify(shot.union) : 'null'}]
      .filter((one) => one !== null)
      .map((one) => document.querySelector(one))
      .filter((node) => node !== null);
    if (nodes.length === 0) return null;
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    const box = { x, y, width: right - x, height: bottom - y };
    if (box.width < 4 || box.height < 4) return null;
    return box;
  })()`;

  let box = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await client.send('Runtime.evaluate', { expression: measure, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${shot.file}: ${result.exceptionDetails.text}`);
    box = result.result.value;
    if (box !== null) break;
    await wait(150);
  }
  if (box === null) throw new Error(`${shot.file}: ${selector} never rendered`);
  // The clip needs to include the padding around the element, and the page may
  // still be settling (fonts, iframes), so give it a beat after it appears.
  await wait(600);

  // A montage frame's height is not knowable from the parent: the composer
  // inside decides it. A hardcoded height is either too short (the panel is cut)
  // or too tall (the dark theme paints its background down to the frame's bottom
  // edge, which shows as a stray black slab). So measure the composer inside each
  // frame and set the frame to exactly that.
  if (shot.fitFrames) {
    const fit = `(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      return frames.map((frame) => {
        const inner = frame.contentDocument;
        if (inner === null) return 0;
        const composer = inner.querySelector('.composer');
        if (composer === null) return 0;
        const height = Math.ceil(composer.getBoundingClientRect().height);
        if (height > 0) frame.style.height = height + 'px';
        return height;
      });
    })()`;
    let fitted = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await client.send('Runtime.evaluate', { expression: fit, returnByValue: true });
      fitted = result.result.value ?? [];
      if (fitted.length > 0 && fitted.every((height) => height > 0)) break;
      await wait(150);
    }
    if (!fitted.every((height) => height > 0)) {
      throw new Error(`${shot.file}: a frame never reported its composer height (${JSON.stringify(fitted)})`);
    }
    console.log(`  frame heights: ${fitted.join('/')} css px`);
    await wait(200);
    const remeasure = await client.send('Runtime.evaluate', { expression: measure, returnByValue: true });
    box = remeasure.result.value ?? box;
  }

  const pad = shot.clip === 'body' ? 0 : 16;
  const scale = shot.scale ?? 2;

  // A row that had to wrap is a layout bug the PNG will not announce: the card
  // just gets taller and nothing looks broken. With `white-space: nowrap` the
  // symptom moves to overflow, so measure both and refuse to write either.
  const overflow = `(() => {
    const card = document.querySelector('.peak-badge-card');
    if (card === null) return null;
    const rows = Array.from(card.querySelectorAll('.peak-badge-row'));
    return {
      overflow: rows.some((row) => row.scrollWidth > row.clientWidth + 1),
      room: card.clientWidth - rows.reduce((worst, row) => {
        const key = row.querySelector('.peak-badge-key');
        const value = row.querySelector('.peak-badge-value');
        if (key === null || value === null) return worst;
        return Math.max(worst, key.offsetWidth + value.scrollWidth);
      }, 0),
      lines: rows.map((row) => {
        const value = row.querySelector('.peak-badge-value');
        if (value === null) return 0;
        const style = getComputedStyle(value);
        return Math.round(value.getBoundingClientRect().height / parseFloat(style.lineHeight || '18'));
      }),
    };
  })()`;
  const measured = await client.send('Runtime.evaluate', { expression: overflow, returnByValue: true });
  const layout = measured.result.value;
  if (layout !== null) {
    const wrapped = layout.lines.filter((count) => count > 1).length;
    if (layout.overflow || wrapped > 0) {
      throw new Error(`${shot.file}: the card overflows its rows (${JSON.stringify(layout)})`);
    }
    console.log(`  card rows: slack ${layout.room}px, lines ${layout.lines.join('/')}`);
  }

  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.round(box.width + pad * 2),
      height: Math.round(box.height + pad * 2),
      scale,
    },
  });
  writeFileSync(join(outDir, shot.file), Buffer.from(data, 'base64'));
  await client.send('Target.closeTarget', { targetId }, false);
  client.setSession(null);
  return box;
}

const css = componentCss();
// Inline the stylesheet immediately AFTER `<meta charset="utf-8">`.
//
// Two placements were tried and both were wrong in instructive ways:
//   * just before `</head>` — the stylesheet then lands behind the page's own
//     rules, which is survivable, but it is the last thing in the head and the
//     first thing a stray backtick corrupts;
//   * immediately after `<head>`, i.e. BEFORE the charset meta — the parser
//     prescans the first bytes for an encoding declaration, so the plugin's CJK
//     comment text arrives before the document has declared UTF-8. The CSS is
//     then decoded as something else, `display` never validates, and the
//     component measures 0×0 while looking like it rendered.
// After the charset meta the encoding is settled and this rule can never be
// shadowed by anything above it.
const page = readFileSync(join(here, 'index.html'), 'utf8');
const anchor = '<meta charset="utf-8">';
if (!page.includes(anchor)) throw new Error('demo/index.html has no <meta charset="utf-8">');
writeFileSync(
  generated,
  page.replace(anchor, `${anchor}\n  <style data-demo-from="client.js">\n${css}  </style>`),
);
// The montage frames `_shot.html`, so it needs no stylesheet of its own; it is
// written next to it because the file URLs in it are relative.
writeFileSync(generatedMontage, readFileSync(join(here, 'montage.html'), 'utf8'));

mkdirSync(outDir, { recursive: true });
rmSync(profile, { recursive: true, force: true });

const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--hide-scrollbars',
  // `file://` documents are opaque origins, so an iframe's `contentDocument` is
  // null without this: the montage cannot measure the composer it frames, and the
  // frames keep whatever height the page guessed.
  '--allow-file-access-from-files',
  '--force-device-scale-factor=1',
  '--window-size=1400,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', detached: false });

try {
  const client = await connect(await endpoint());
  for (const shot of SHOTS) {
    const box = await shoot(client, shot);
    const size = readFileSync(join(outDir, shot.file)).length;
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    console.log(`${shot.file.padEnd(15)} ${String(size).padStart(7)} bytes  ${w}x${h} css px`);
  }
  client.close();
} finally {
  // Killing the launcher is not enough on Windows: the browser's own children
  // keep the profile directory open, and a failed cleanup would otherwise turn
  // a successful run into a non-zero exit.
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    child.kill();
  }
  await wait(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    console.error(`note: ${profile} is still locked; delete it by hand`);
  }
  rmSync(generated, { force: true });
  rmSync(generatedMontage, { force: true });
}

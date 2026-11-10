// Plan morning-digest § 3: save one page of this lane as a single HTML file, the reviewer's
// copy. The page is fetched from the app in-process, so the copy is the page the lane
// serves: same layout, same inline stylesheet, no client JS (ADR 0001).
//
//   pnpm save-preview                    -> var/preview.html
//   pnpm save-preview var/digest.html    -> that path
//   pnpm save-preview -- --no-marker     -> the cleanup copy, no lane marker (ADR 0003)
//
// The copy carries this lane's banner and marker: it is the reviewer's copy of this lane's
// page. The cleanup copy is the same command with --no-marker, saved over the same link
// once the review is in. Previews never go in the repo: var/ is gitignored.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const noMarker = args.includes('--no-marker');
const positional = args.filter((arg) => arg !== '--no-marker');
const outPath = resolve(repoRoot, positional[0] ?? 'var/preview.html');
const night = positional[1] ?? '2026-10-28';

// The marker: .env carries it, unless the environment already says otherwise. A LANE_MARKER
// in the environment beats the file (an empty one means "no marker set"), so the cleanup copy
// needs no other switch on shells that can hold an empty value.
const envPath = join(repoRoot, '.env');
if (process.env.LANE_MARKER === undefined && existsSync(envPath)) process.loadEnvFile(envPath);
if (noMarker) delete process.env.LANE_MARKER;

const config = loadConfig(join(repoRoot, 'rig.json'));
const app = createApp({ ...config, runsDir: resolve(repoRoot, config.runsDir) });

const res = await app.request(`/digest/${night}`);
if (res.status !== 200) {
  console.error(`digest for ${night} answered ${res.status}; nothing saved`);
  process.exit(1);
}

const html = await res.text();

// A copy that points at other files does not open from disk. Say so instead of saving a
// broken preview.
const external = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)]
  .map((match) => match[1] ?? '')
  .filter((url) => url !== '' && !url.startsWith('#') && !url.startsWith('data:'));
if (external.length > 0) {
  console.error(`the page is not self-contained: ${external.join(', ')}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

console.log(outPath);
console.log(`${night} · ${(html.length / 1024).toFixed(1)} kB · self-contained`);

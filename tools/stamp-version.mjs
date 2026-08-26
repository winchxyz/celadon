// ============================================================
//  Write the build number where the running game can fetch it.
//
//  A player asked, reasonably, whether anything had been fixed at all —
//  and the honest answer was that their iPad was almost certainly still
//  running a build from before the fixes. Safari keeps a tab alive for
//  days and GitHub Pages caches index.html; between them, a page that
//  was opened once can go on being the old page indefinitely, and there
//  is nothing on screen to say so.
//
//  So the build number goes into a tiny file next to the game, the game
//  checks it, and if the server has moved on it says so and offers to
//  reload. Run from the build script; the number itself lives in
//  src/dev/diag.js so there is one place to change it.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('src/dev/diag.js', 'utf8');
const m = src.match(/export const BUILD = '([^']+)'/);
if (!m) { console.error('stamp-version: no BUILD in src/dev/diag.js'); process.exit(1); }

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync(path.join('public', 'version.txt'), m[1] + '\n', 'utf8');
console.log(`stamped build ${m[1]}`);

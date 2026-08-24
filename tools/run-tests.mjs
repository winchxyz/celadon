// ============================================================
//  Every bench, in one go.
//
//  These run headlessly: the simulation, the scoring, the economy and
//  the room's geometry all work without a GPU, and the few that need
//  the Game itself build it with only WebGL stubbed. Run:  npm test
// ============================================================
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const devDir = join(here, '..', 'src', 'dev');

// harness.mjs and realgame.mjs are libraries, not benches
const SHARED = new Set(['harness.mjs', 'realgame.mjs']);
const benches = readdirSync(devDir)
  .filter((f) => f.endsWith('.mjs') && !SHARED.has(f))
  .sort();

let failed = 0;
const t0 = Date.now();
for (const b of benches) {
  const name = b.replace(/\.mjs$/, '');
  process.stdout.write(`  ${name.padEnd(12)}`);
  const r = spawnSync(process.execPath, [join(devDir, b)], { encoding: 'utf8' });
  if (r.status === 0) {
    console.log('pass');
  } else {
    failed++;
    console.log('FAIL');
    const out = ((r.stdout ?? '') + (r.stderr ?? '')).trimEnd().split('\n');
    for (const line of out.slice(-14)) console.log(`      ${line}`);
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(failed
  ? `\n  ${failed} of ${benches.length} failed  (${secs}s)\n`
  : `\n  all ${benches.length} passed  (${secs}s)\n`);
process.exit(failed ? 1 : 0);

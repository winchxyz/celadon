// ============================================================
//  Is the text still the text?
//
//  Reading these files through PowerShell and writing them back
//  double-encoded three of them: every em dash became a three-character
//  smear, every dingbat turned to mush, and the page title with it. The
//  repair after that was lossy in its own way and left U+FFFD where the
//  tick and the diameter sign had been.
//
//  None of it showed up in a code review, because a terminal that reads
//  UTF-8 as ANSI displays the damaged file and the healthy one exactly
//  the same way. So this looks at bytes, and it runs with the tests.
//
//  Note that nothing below is written as a literal broken character --
//  every pattern is an escape. A detector that spells out the damage it
//  looks for finds itself, which is how the first draft of this file
//  passed while missing the real thing.
//
//  Run:  node src/dev/encoding.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.vite']);
const EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.yml', '.txt']);

/* The font licences ship from the foundry with a BOM. That is their
   file, not ours -- we are not going to edit someone's licence text. */
const BOM_OK = (rel) => rel.startsWith('public/fonts/');

const NL = String.fromCharCode(10);
let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (EXT.has(path.extname(e.name))) out.push(f);
  }
  return out;
};

/* ---- what double-encoding actually looks like ---------------------
   A character above ASCII is stored as two to four bytes: one lead
   byte in C2..F4 and the rest in 80..BF. Read those bytes back as
   Latin-1 and each becomes a character of its own, so one em dash
   (E2 80 94) comes out as three.

   The tell is therefore not any single letter but the PAIR -- a
   lead-range character with a continuation-range character directly
   after it. Matching the pair is what keeps ordinary words innocent:
   the accented letters in cafe, Ostersund or manana are all in the
   lead range, and are only suspicious when the next character is one
   that could only have come from a byte in 80..BF. That means the
   range itself, plus the punctuation CP1252 maps into it (the curly
   quotes, the dashes, the ellipsis, the euro sign and friends). */
const LEAD = '\\u00C2-\\u00F4';
const CONT = '\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021'
           + '\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C'
           + '\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153'
           + '\\u017E\\u0178';
const MOJIBAKE = new RegExp('[' + LEAD + '][' + CONT + ']', 'g');
const LOST = new RegExp('\\uFFFD', 'g');
const GLYPHS = /[◈◎◍Ø↵✓✕≈—°]/g;

console.log(NL + '  IS THE TEXT STILL THE TEXT?' + NL);

const strict = new TextDecoder('utf-8', { fatal: true });
const files = walk(ROOT);
const broken = { bom: [], invalid: [], mojibake: [], lost: [] };
let glyphs = 0;

for (const f of files) {
  const b = fs.readFileSync(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf && !BOM_OK(rel)) broken.bom.push(rel);

  let s = null;
  try { s = strict.decode(b); } catch { broken.invalid.push(rel); continue; }

  const m = s.match(MOJIBAKE);
  if (m) broken.mojibake.push(`${rel} x${m.length}`);
  if (LOST.test(s)) broken.lost.push(rel);

  glyphs += (s.match(GLYPHS) || []).length;
}

console.log(`         ${files.length} text files, ${glyphs} special glyphs${NL}`);

const list = (a) => (a.length ? ': ' + a.join(', ') : '');
ok(!broken.invalid.length, `every file decodes as UTF-8${list(broken.invalid)}`);
ok(!broken.mojibake.length, `no file was written back double-encoded${list(broken.mojibake)}`);
ok(!broken.lost.length, `no character was replaced by U+FFFD${list(broken.lost)}`);
ok(!broken.bom.length, `no stray BOM in front of our own source${list(broken.bom)}`);

/* The specific characters the game draws with. A file can be perfectly
   clean UTF-8 and still have quietly lost its dingbats, so name them. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const has = (re, what) => ok(re.test(html), what);
has(/CELADON — The Long Ash/, 'the page title still has its em dash');
has(/<span class="glyph">◈<\/span>/, 'the commission card still has its diamond');
has(/<span class="glyph">◎<\/span>/, 'the gauges still have their ring');
has(/Ø <b id="v-d">/, 'the vitals line still has its diameter sign');
has(/<kbd>↵<\/kbd>/, 'the Continue button still has its return arrow');

/* And prove the detector still bites. If this ever stops failing, the
   pattern above has rotted and every check in this file is decorative. */
{
  // an em dash (E2 80 94) as it comes out when read back as Latin-1,
  // spelled in escapes so this file stays clean of the thing it hunts
  const canary = String.fromCharCode(0x00E2, 0x20AC, 0x2014);
  ok(MOJIBAKE.test(canary), 'a known-double-encoded em dash is still recognised');
  MOJIBAKE.lastIndex = 0;
}

console.log(bad ? NL + `  ${bad} FAILED` + NL : NL + '  nothing has been eaten' + NL);
process.exit(bad ? 1 : 0);

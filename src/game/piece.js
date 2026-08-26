// ============================================================
//  Looking at what you made, and showing it to somebody.
//
//  Every finished piece already carried everything needed to rebuild
//  it — the clay snapshot, the glaze field, the body, the glazes and
//  the firing schedule all went into the save the moment it came out of
//  the kiln. The shelf drew a flat grey silhouette of it, which is a
//  contact sheet, not a shelf. You could not turn the piece round, you
//  could not see the glaze you had spent the whole phase choosing, and
//  there was nothing to show anybody.
//
//  This puts the piece back on the wheel and lets you look at it, and
//  makes a card out of it that you can sign and send.
// ============================================================

import { Clay } from '../sim/clay.js';
import { GLAZE_BY_ID, SLOTS, fire as fireGlaze } from '../sim/glaze.js';
import { BODIES } from './lore.js';
import { applyFireResult } from '../render/potMaterial.js';

/** Put a saved piece back on the pot mesh, exactly as it came out. */
export function dressPot(game, p) {
  const c = Clay.fromSnapshot(p.clay);
  game.pb.build(c);

  game.field.restore(p.field);
  game.field.upload?.();

  const body = BODIES.find((b) => b.id === p.body) ?? BODIES[0];
  const glazes = [0, 1, 2].map((i) => GLAZE_BY_ID[p.glazes?.[i]] ?? null);

  /* Re-fire it to get the surface back.
     The look is a function of the schedule and of how much glaze was
     actually on the pot, and the second half of that is not in the save
     as a number — but it is in the field, which IS saved, so it is
     measured back off the restored field rather than guessed at. */
  const gs = game.field.stats();
  const layers = [];
  for (let i = 0; i < SLOTS; i++) {
    if (!glazes[i]) continue;
    layers.push({
      glaze: glazes[i],
      coverage: gs.coverage?.[i] ?? gs.totalCoverage ?? 0.8,
      meanThick: gs.meanThick?.[i] ?? 0.12,
    });
  }
  const res = layers.length
    ? fireGlaze(layers, { ...(p.fire ?? {}) }, { meanWall: c.metrics().meanWall, body })
    : null;
  applyFireResult(game.mat, res, glazes);

  const u = game.mat.userData.u;
  u.uFired.value = 1; u.uWet.value = 0;
  u.uBisque.value = 1; u.uVitrified.value = 1;
  u.uCursor.value.set(-9, -9, 0, 0);
  u.uBodyCol.value.set(body.color);
  u.uBodyCol2.value.set(body.color2);

  return { clay: c, body, glazes: glazes.filter(Boolean), fireResult: res };
}

/* ------------------------------------------------------------------ */
/*  The card                                                           */
/* ------------------------------------------------------------------ */

const CARD_W = 1080;
const CARD_H = 1350;                     // 4:5, which is what everything crops to
const CREAM = '#FBF0DF';
const INK = '#4A3524';
const INK_DIM = '#755C41';
const GREEN = '#1F6B57';
const FACE = 'Baloo2, ui-rounded, Candara, "Trebuchet MS", sans-serif';

/**
 * Square-crop the live canvas around the pot.
 *
 * The framebuffer is the shape of the window and a card is not, so
 * something has to be thrown away. Taking the middle is wrong on a wide
 * screen — the pot sits where the camera put it, not in the centre of a
 * 16:9 frame — so the crop is taken around the pot's own screen
 * position, clamped to stay inside the picture.
 */
export function cropPot(canvas, centreX) {
  const s = Math.min(canvas.width, canvas.height);
  const half = s / 2;
  const cx = Math.max(half, Math.min(canvas.width - half, centreX ?? canvas.width / 2));
  const out = document.createElement('canvas');
  out.width = s;
  out.height = s;
  out.getContext('2d').drawImage(canvas, cx - half, 0, s, s, 0, 0, s, s);
  return out;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Wrap text to a width, returning the lines. */
function wrap(g, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw the card.
 *
 * Everything on it is something the player actually did: the piece as it
 * came out, what the Guild called it, what it was graded, the day, the
 * body and glazes that went on. The only free text is the line they
 * write themselves and the name they sign it with.
 */
export function drawCard(shot, p, caption, signature) {
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const g = cv.getContext('2d');

  g.fillStyle = CREAM;
  g.fillRect(0, 0, CARD_W, CARD_H);

  const pad = 64;
  const imgW = CARD_W - pad * 2;

  /* The picture takes what is left, not what it likes.
     A square picture is 952px of a 1350px card, and once the title has
     had its two lines there is nothing under it — the first version of
     this printed the caption straight through the glaze credits, and
     the fix for THAT silently dropped the caption altogether, because
     the room it was asked to fit into was zero. Neither is a layout.
     So the blocks that have a known size are measured first and the
     picture is given the remainder. */
  const TITLE_BLOCK = 52 + 70 * 2;        // kicker, then up to two title lines
  const CAPTION_BLOCK = 14 + 42 * 3;      // up to three lines of their own
  const FOOTER_BLOCK = 34 + 26;           // glaze credits, then the wordmark
  const GAP = 62;
  const imgH = CARD_H - pad - GAP - TITLE_BLOCK - CAPTION_BLOCK - GAP - FOOTER_BLOCK - pad;

  g.save();
  roundRect(g, pad, pad, imgW, imgH, 28);
  g.clip();
  g.fillStyle = '#2b3a3a';
  g.fillRect(pad, pad, imgW, imgH);
  if (shot) {
    /* Cover, not stretch. The shot is square and the box is not, so a
       band of it is taken — biased above centre, because that is where
       the pot is and the bottom of a square shot is mostly wheel. */
    const bandH = Math.min(shot.height, shot.width * (imgH / imgW));
    const sy = Math.max(0, (shot.height - bandH) * 0.34);
    g.drawImage(shot, 0, sy, shot.width, bandH, pad, pad, imgW, imgH);
  }
  g.restore();

  let y = pad + imgH + GAP;

  g.textAlign = 'left';
  g.fillStyle = GREEN;
  g.font = '600 22px ' + FACE;
  const kicker = [
    p.grade ? 'GRADE ' + p.grade : null,
    p.total != null ? String(p.total) : null,
    p.day != null ? 'DAY ' + p.day : null,
  ].filter(Boolean).join('   ·   ');
  g.fillText(kicker, pad, y);
  y += 52;

  g.fillStyle = INK;
  g.font = '400 62px ' + FACE;
  const titleLines = wrap(g, p.title || p.name || 'A pot', imgW).slice(0, 2);
  for (const line of titleLines) {
    g.fillText(line, pad, y);
    y += 70;
  }
  /* No padding out to two lines. Reserving the second line kept the
     caption at a fixed height, which sounds tidy and photographs as a
     hole in the middle of the card between the title and the sentence.
     The caption follows the title immediately and the slack collects
     above the footer instead, where empty space reads as margin. */

  if (caption && caption.trim()) {
    y += 14;
    g.fillStyle = INK_DIM;
    g.font = '400 30px ' + FACE;
    for (const line of wrap(g, caption.trim(), imgW).slice(0, 3)) {
      g.fillText(line, pad, y);
      y += 42;
    }
  }

  const foot = CARD_H - pad - 10;
  g.fillStyle = INK_DIM;
  g.font = '600 20px ' + FACE;
  const names = (p.glazes ?? []).map((id) => GLAZE_BY_ID[id]?.name).filter(Boolean);
  const bodyName = BODIES.find((b) => b.id === p.body)?.name;
  const credits = [bodyName, ...names].filter(Boolean).join('  ·  ');
  if (credits) g.fillText(credits.toUpperCase(), pad, foot - 34);

  g.fillStyle = INK;
  g.font = '700 26px ' + FACE;
  g.fillText('CELADON', pad, foot);
  if (signature && signature.trim()) {
    g.textAlign = 'right';
    g.fillStyle = INK_DIM;
    g.font = '400 26px ' + FACE;
    g.fillText(signature.trim(), CARD_W - pad, foot);
  }

  return cv;
}

/* ------------------------------------------------------------------ */
/*  Getting it off the device                                          */
/* ------------------------------------------------------------------ */

/**
 * Hand the picture over, by whatever route this device actually has.
 *
 * On an iPad the useful one is the share sheet, because a download goes
 * into Files and is then somebody else's problem; navigator.share with
 * a File puts it straight into Messages or Photos. It is not everywhere
 * though, and it rejects if the sheet is dismissed, so a plain download
 * stands behind it and a dismissal is not reported as a failure.
 */
export async function handOver(canvas, name, text) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], name + '.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // anything else: fall through and just save it
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

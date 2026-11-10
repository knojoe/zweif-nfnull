/* Prozedurale Materialtexturen (keine Bilddateien nötig). Alle Maße in Metern. */
import { THREE } from "./vendor.js";

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
function cv(n) { const c = document.createElement("canvas"); c.width = c.height = n; return c; }
const hexRGB = h => { const n = parseInt(h.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgb = (c, f = 1, a = 1) => `rgba(${Math.max(0, Math.min(255, c[0] * f)) | 0},${Math.max(0, Math.min(255, c[1] * f)) | 0},${Math.max(0, Math.min(255, c[2] * f)) | 0},${a})`;

/* Normalmap aus Höhenbild */
function normalFromHeight(hc, strength) {
  const n = hc.width, src = hc.getContext("2d").getImageData(0, 0, n, n).data, out = cv(n), ctx = out.getContext("2d"), img = ctx.createImageData(n, n), d = img.data;
  const H = (x, y) => src[((((y % n) + n) % n) * n + (((x % n) + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    d[i] = (-dx / l * .5 + .5) * 255; d[i + 1] = (dy / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return out;
}
function grain(ctx, x0, y0, w, h, along, col, r, n) {
  /* feine Holzmaserung als Linien in Brettlängsrichtung */
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  for (let k = 0; k < n; k++) {
    const t = r(), a = .04 + r() * .09, f = r() < .5 ? .82 : 1.12;
    ctx.strokeStyle = rgb(col, f, a); ctx.lineWidth = .6 + r() * 1.4; ctx.beginPath();
    const ph = r() * 6.28, amp = 1 + r() * 3, fr = .004 + r() * .01;
    if (along === "v") { const x = x0 + t * w; for (let y = y0; y <= y0 + h; y += 8) { const xx = x + Math.sin(y * fr + ph) * amp; y === y0 ? ctx.moveTo(xx, y) : ctx.lineTo(xx, y); } }
    else { const y = y0 + t * h; for (let x = x0; x <= x0 + w; x += 8) { const yy = y + Math.sin(x * fr + ph) * amp; x === x0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } }
    ctx.stroke();
  }
  ctx.restore();
}

/* Senkrechte Boden-Deckel-Schalung (Fassade) */
function facade(n, base) {
  const tile = 2.0, px = n / tile, c = cv(n), h = cv(n), C = c.getContext("2d"), Hh = h.getContext("2d"), r = rng(11);
  C.fillStyle = rgb(base); C.fillRect(0, 0, n, n); Hh.fillStyle = "#666"; Hh.fillRect(0, 0, n, n);
  const wide = .2 * px, cover = .08 * px, step = tile / 8 * px; // 8 Achsen je 2 m (25 cm Raster)
  for (let i = 0; i < 8; i++) {
    const x = i * step, f = .92 + r() * .16;
    C.fillStyle = rgb(base, f); C.fillRect(x, 0, step, n); grain(C, x, 0, step, n, "v", base, r, 26);
    const cx = x + step - cover / 2, fc = .96 + r() * .12; // Deckleiste
    C.fillStyle = rgb(base, fc); C.fillRect(cx - cover / 2, 0, cover, n); grain(C, cx - cover / 2, 0, cover, n, "v", base, r, 10);
    C.fillStyle = "rgba(0,0,0,.28)"; C.fillRect(cx + cover / 2, 0, 3, n); C.fillStyle = "rgba(255,255,255,.10)"; C.fillRect(cx - cover / 2, 0, 2, n);
    Hh.fillStyle = "#fff"; Hh.fillRect(cx - cover / 2, 0, cover, n); Hh.fillStyle = "#333"; Hh.fillRect(x, 0, 2, n);
  }
  return { map: c, nrm: normalFromHeight(h, 2.2), tile, rough: .82 };
}
/* Dielen / Parkett, Längsrichtung u */
function planks(n, base, plankM, tile, seed, gapA) {
  const px = n / tile, c = cv(n), h = cv(n), C = c.getContext("2d"), Hh = h.getContext("2d"), r = rng(seed);
  C.fillStyle = rgb(base, .6); C.fillRect(0, 0, n, n); Hh.fillStyle = "#222"; Hh.fillRect(0, 0, n, n);
  const ph = plankM * px, rows = Math.round(n / ph), gap = Math.max(1.5, .006 * px);
  for (let j = 0; j < rows; j++) {
    const y = j * ph; let x = -r() * n;
    while (x < n) {
      const len = (1.0 + r() * 1.4) * px, f = .86 + r() * .26;
      for (const ox of [0, -n, n]) {
        C.fillStyle = rgb(base, f); C.fillRect(x + ox + gap / 2, y + gap / 2, len - gap, ph - gap); grain(C, x + ox, y + gap / 2, len, ph - gap, "h", base, r, 7);
        Hh.fillStyle = "#bbb"; Hh.fillRect(x + ox + gap / 2, y + gap / 2, len - gap, ph - gap);
      }
      x += len;
    }
    C.fillStyle = `rgba(0,0,0,${gapA})`; C.fillRect(0, y, n, gap * .6);
  }
  return { map: c, nrm: normalFromHeight(h, 1.6), tile, rough: .7 };
}
/* Stehfalz-Blechdach, Falze in v-Richtung alle 47,5 cm */
function seam(n, base) {
  const tile = 1.9, px = n / tile, c = cv(n), h = cv(n), C = c.getContext("2d"), Hh = h.getContext("2d"), r = rng(5);
  C.fillStyle = rgb(base); C.fillRect(0, 0, n, n); Hh.fillStyle = "#555"; Hh.fillRect(0, 0, n, n);
  const s = .475 * px;
  for (let i = 0; i < 4; i++) {
    const x = i * s; const g = C.createLinearGradient(x, 0, x + s, 0);
    g.addColorStop(0, rgb(base, 1.08)); g.addColorStop(.5, rgb(base, .97)); g.addColorStop(1, rgb(base, 1.03)); C.fillStyle = g; C.fillRect(x, 0, s, n);
    C.fillStyle = rgb(base, 1.45); C.fillRect(x - 2, 0, 3, n); C.fillStyle = rgb(base, .55); C.fillRect(x + 1, 0, 3, n);
    Hh.fillStyle = "#fff"; Hh.fillRect(x - 3, 0, 6, n);
  }
  for (let k = 0; k < 900; k++) { C.fillStyle = rgb(base, .9 + r() * .2, .05); C.fillRect(r() * n, r() * n, 2, 30 + r() * 80); }
  return { map: c, nrm: normalFromHeight(h, 3), tile, rough: .42, metal: .55 };
}
/* Rasen */
function lawn(n) {
  const tile = 3, c = cv(n), h = cv(n), C = c.getContext("2d"), Hh = h.getContext("2d"), r = rng(3);
  C.fillStyle = "#6f8f45"; C.fillRect(0, 0, n, n); Hh.fillStyle = "#808080"; Hh.fillRect(0, 0, n, n);
  for (let k = 0; k < 70; k++) { const x = r() * n, y = r() * n, rad = 40 + r() * 140, g = C.createRadialGradient(x, y, 0, x, y, rad);
    const tone = r() < .5 ? "rgba(95,125,55," : "rgba(140,160,80,"; g.addColorStop(0, tone + ".45)"); g.addColorStop(1, tone + "0)"); C.fillStyle = g;
    for (const ox of [0, -n, n]) for (const oy of [0, -n, n]) { C.save(); C.translate(ox, oy); C.fillRect(x - rad, y - rad, rad * 2, rad * 2); C.restore(); } }
  const cols = [[88, 120, 50], [112, 145, 62], [128, 156, 72], [76, 104, 44], [150, 165, 90]];
  for (let k = 0; k < 26000; k++) { const x = r() * n, y = r() * n, col = cols[(r() * cols.length) | 0], l = 3 + r() * 6;
    C.strokeStyle = rgb(col, 1, .55); C.lineWidth = 1; C.beginPath(); C.moveTo(x, y); C.lineTo(x + (r() - .5) * 3, y - l); C.stroke();
    Hh.fillStyle = `rgba(255,255,255,${.15 + r() * .3})`; Hh.fillRect(x, y - l, 1, l); }
  return { map: c, nrm: normalFromHeight(h, 1.2), tile, rough: .95 };
}
/* PV-Zellen */
function pv(n) {
  const tile = 1.13, px = n / tile, c = cv(n), C = c.getContext("2d"), r = rng(9);
  C.fillStyle = "#121a2b"; C.fillRect(0, 0, n, n); const cell = .1765 * px;
  for (let y = 0; y < n; y += cell) for (let x = 0; x < n; x += cell) { C.fillStyle = `rgb(${20 + r() * 6},${30 + r() * 6},${54 + r() * 10})`; C.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
    C.strokeStyle = "rgba(160,170,190,.18)"; C.lineWidth = 1; for (let k = 1; k < 9; k++) { C.beginPath(); C.moveTo(x, y + k * cell / 9); C.lineTo(x + cell, y + k * cell / 9); C.stroke(); } }
  return { map: c, nrm: null, tile, rough: .18, metal: .25 };
}

const cache = {};
export function makeTex(kind, hex, size, aniso) {
  const key = kind + hex + size; if (cache[key]) return cache[key];
  const b = hexRGB(hex || "#888888");
  const d = kind === "facade" ? facade(size, b) : kind === "deck" ? planks(size, b, .145, 2.32, 21, .55) : kind === "parquet" ? planks(size, [Math.min(255, b[0] * 1.7), Math.min(255, b[1] * 1.6), Math.min(255, b[2] * 1.5)], .19, 2.28, 31, .35)
    : kind === "fence" ? facade(size, b) : kind === "seam" ? seam(size, b) : kind === "lawn" ? lawn(size) : pv(size);
  const mk = (canvas, srgb) => { if (!canvas) return null; const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / d.tile, 1 / d.tile); t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return cache[key] = { map: mk(d.map, true), normalMap: mk(d.nrm, false), rough: d.rough, metal: d.metal || 0 };
}

// Nhập CHỮ bằng viết tay (nhãn biểu tượng, tên…): chữ cái + chữ số + dấu tiếng Việt, chạy offline
// Bộ nhận dạng: CNN 36 lớp (0-9, a-z) dạy từ dữ liệu EMNIST (NIST); dấu thanh / dấu mũ nhận theo hình dạng nét.
import { rasterize } from './handwrite.js';

const CH = '0123456789abcdefghijklmnopqrstuvwxyz';
let net = null;
async function loadNet() {
  if (net) return net;
  const { LMODEL } = await import('./letters-model.js');
  const dec = (k) => { const m = LMODEL[k]; const b = atob(m.d); const a = new Float32Array(b.length); for (let i = 0; i < b.length; i++) a[i] = ((b.charCodeAt(i) << 24) >> 24) * m.s; return a; };
  net = {}; for (const k of Object.keys(LMODEL)) net[k] = dec(k);
  return net;
}
// CNN: conv5x5(24) → pool → conv3x3(48) → pool → fc160 → fc36 (đúng thứ tự trọng số của tools/train_letters.py)
function cnn(img) {
  const { k1, b1, k2, b2, w3, b3, w4, b4 } = net, C1 = 24, C2 = 48, F = 160;
  const a1 = new Float32Array(28 * 28 * C1);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const o = (y * 28 + x) * C1;
    for (let c = 0; c < C1; c++) a1[o + c] = b1[c];
    for (let i = 0; i < 5; i++) { const yy = y + i - 2; if (yy < 0 || yy > 27) continue; for (let j = 0; j < 5; j++) { const xx = x + j - 2; if (xx < 0 || xx > 27) continue; const v = img[yy * 28 + xx]; if (!v) continue; const ko = (i * 5 + j) * C1; for (let c = 0; c < C1; c++) a1[o + c] += v * k1[ko + c]; } }
    for (let c = 0; c < C1; c++) if (a1[o + c] < 0) a1[o + c] = 0;
  }
  const p1 = new Float32Array(14 * 14 * C1);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) for (let c = 0; c < C1; c++) {
    let m = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const v = a1[((y * 2 + a) * 28 + x * 2 + b) * C1 + c]; if (v > m) m = v; }
    p1[(y * 14 + x) * C1 + c] = m;
  }
  const a2 = new Float32Array(14 * 14 * C2);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const o = (y * 14 + x) * C2;
    for (let c = 0; c < C2; c++) a2[o + c] = b2[c];
    for (let i = 0; i < 3; i++) { const yy = y + i - 1; if (yy < 0 || yy > 13) continue; for (let j = 0; j < 3; j++) { const xx = x + j - 1; if (xx < 0 || xx > 13) continue; const po = (yy * 14 + xx) * C1, ko0 = (i * 3 + j) * C1;
      for (let ci = 0; ci < C1; ci++) { const v = p1[po + ci]; if (!v) continue; const ko = (ko0 + ci) * C2; for (let c = 0; c < C2; c++) a2[o + c] += v * k2[ko + c]; } } }
    for (let c = 0; c < C2; c++) if (a2[o + c] < 0) a2[o + c] = 0;
  }
  const f = new Float32Array(7 * 7 * C2);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) for (let c = 0; c < C2; c++) {
    let m = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const v = a2[((y * 2 + a) * 14 + x * 2 + b) * C2 + c]; if (v > m) m = v; }
    f[(y * 7 + x) * C2 + c] = m;
  }
  const h = new Float32Array(F); for (let j = 0; j < F; j++) h[j] = b3[j];
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (!v) continue; const o = i * F; for (let j = 0; j < F; j++) h[j] += v * w3[o + j]; }
  const z = new Float32Array(36); for (let j = 0; j < 36; j++) z[j] = b4[j];
  for (let i = 0; i < F; i++) { const v = h[i]; if (v <= 0) continue; const o = i * 36; for (let j = 0; j < 36; j++) z[j] += v * w4[o + j]; }
  const mx = Math.max(...z); let s = 0; const e = Array.from(z, (v) => { const q = Math.exp(v - mx); s += q; return q; });
  return e.map((v, k) => ({ c: CH[k], p: v / s })).sort((a, b) => b.p - a.p);
}
const bb = (pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
const classify = (strokes) => cnn(rasterize(strokes, 3.2));

// ---- nét dấu: sắc ´, huyền `, hỏi ̉, ngã ~, nặng ., mũ ^, trăng ˘ ----
function resamp(s, n = 24) {
  if (s.length < 2) return s.slice();
  const L = [0]; for (let i = 1; i < s.length; i++) L.push(L[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
  const T = L[L.length - 1] || 1, out = []; let j = 0;
  for (let k = 0; k < n; k++) { const t = (k / (n - 1)) * T; while (j < L.length - 2 && L[j + 1] < t) j++; const u = (t - L[j]) / Math.max(1e-9, L[j + 1] - L[j]); out.push([s[j][0] + (s[j + 1][0] - s[j][0]) * u, s[j][1] + (s[j + 1][1] - s[j][1]) * u]); }
  return out;
}
function reversals(vals, hyst) { let dir = 0, n = 0, ext = vals[0]; for (const v of vals) { if (dir >= 0 && v < ext - hyst) { if (dir > 0) n++; dir = -1; ext = v; } else if (dir <= 0 && v > ext + hyst) { if (dir < 0) n++; dir = 1; ext = v; } else if ((dir > 0 && v > ext) || (dir < 0 && v < ext)) ext = v; } return n; }
export function markShape(s, H) {
  const b = bb(s);
  if (Math.max(b.w, b.h) < H * 0.13) return 'dot';
  const p = resamp(s), n = p.length, ys = p.map((q) => q[1]), xs = p.map((q) => q[0]);
  const ry = reversals(ys, Math.max(1.5, b.h * 0.18)), rx = reversals(xs, Math.max(1.5, b.w * 0.18));
  const iMin = ys.indexOf(Math.min(...ys)), iMax = ys.indexOf(Math.max(...ys));
  const a = p[0], z = p[n - 1];
  if (ry >= 2 && b.w > b.h * 0.9) return 'tilde';
  if (ry === 1 && b.w > b.h * 0.9 && rx === 0) {
    if (iMin > n * 0.15 && iMin < n * 0.85 && a[1] > ys[iMin] + b.h * 0.4 && z[1] > ys[iMin] + b.h * 0.4) return 'circ';
    if (iMax > n * 0.15 && iMax < n * 0.85 && a[1] < ys[iMax] - b.h * 0.4 && z[1] < ys[iMax] - b.h * 0.4) return 'breve';
    if (b.w > b.h * 1.4) return 'tilde';
  }
  if (rx >= 1 && z[1] > a[1] + b.h * 0.25) return 'hook';
  // nét thẳng: sắc (đi lên về bên phải) / huyền (đi xuống về bên phải)
  const dx = z[0] - a[0], dy = z[1] - a[1];
  if (Math.abs(dx) < b.h * 0.25 && b.h > b.w * 2) return 'acute';
  return dx * dy < 0 ? 'acute' : 'grave';
}
const MOD = { circ: { a: 'â', e: 'ê', o: 'ô' }, breve: { a: 'ă' }, horn: { o: 'ơ', u: 'ư' }, bar: { d: 'đ' } };
const TONE = { acute: '́', grave: '̀', hook: '̉', tilde: '̃', dot: '̣' };
export function compose(base, mod, tone) {
  let c = base;
  if (mod && MOD[mod] && MOD[mod][c]) c = MOD[mod][c];
  if (tone && TONE[tone] && /[aăâeêioôơuưy]/.test(c)) c = (c + TONE[tone]).normalize('NFC');
  return c;
}

// hai nhóm nét chạm nhau (nét thẳng đứng + nét cong của B, D, P, R…)
function touches(A, B, tol) {
  const pa = A.flatMap((q) => resamp(q, 20)), pb = B.flatMap((q) => resamp(q, 20));
  for (const a of pa) for (const b of pb) if (Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol) return true;
  return false;
}
// chữ thường có nét xuống dưới dòng (g p q y j) mà không thấp hơn đường chân chữ → chọn chữ khác (a, o, u…)
const DESC = 'gpqyj';
function baselineFix(out, groups, Hm) {
  const bots = groups.filter((g) => g.b.h >= Hm * 0.5).map((g) => g.b.y1).sort((a, b) => a - b);
  if (bots.length < 2) return;
  const base = bots[Math.floor(bots.length / 2)];
  out.forEach((q, i) => {
    const g = q.g; if (!g || q.punct || !DESC.includes(q.base)) return;
    if (g.b.y1 > base + Hm * 0.2) return;
    const A = { q: 'a', g: 'a', p: 'o', y: 'u', j: 'i' };
    const alt = q.probs.find((x) => !DESC.includes(x.c) && x.p > 0.02) || { c: A[q.base] };
    if (alt && alt.c) { q.base = alt.c; q.alt = [alt.c, ...q.alt.filter((c) => c !== alt.c)].slice(0, 4); q.ch = compose(q.base, q.mod, q.tone); }
  });
}

// ---- tách ký tự, nhận dạng cả dòng ----
export async function recognizeText(strokes) {
  if (!strokes.length) return [];
  await loadNet();
  const items = strokes.map((s) => ({ s: [s], b: bb(s) }));
  const Hline = Math.max(...items.map((it) => it.b.h), 10);
  items.sort((a, b) => a.b.x0 - b.b.x0);
  let groups = [];
  for (const it of items) { // nhóm theo chồng lấn chiều ngang
    const g = groups[groups.length - 1];
    if (g) {
      const ov = Math.min(g.b.x1, it.b.x1) - Math.max(g.b.x0, it.b.x0), minW = Math.max(3, Math.min(g.b.w, it.b.w));
      const inside = it.b.x0 >= g.b.x0 - 3 && it.b.x1 <= g.b.x1 + 3;
      if (inside || (ov > -2 && (ov >= 0.3 * minW || touches(g.s, it.s, Hline * 0.07)))) { g.s.push(...it.s); g.b = bb(g.s.flat()); continue; }
    }
    groups.push({ s: [...it.s], b: it.b });
  }
  // dấu nhỏ đứng riêng (lệch sang phải / trái) gộp vào chữ gần nhất
  const big = (g) => Math.max(g.b.w, g.b.h) >= Hline * 0.42;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]; if (big(g) || groups.length < 2) continue;
    let best = -1, bd = 1e9;
    for (let j = 0; j < groups.length; j++) { if (j === i || !big(groups[j])) continue; const o = groups[j]; const d = Math.max(0, o.b.x0 - g.b.x1, g.b.x0 - o.b.x1); if (d < bd) { bd = d; best = j; } }
    const o = best >= 0 && groups[best];
    if (o && bd < Hline * 0.5 && (g.b.y1 < o.b.y0 + o.b.h * 0.35 || g.b.y0 > o.b.y1 - o.b.h * 0.2)) { o.s.push(...g.s); o.b = bb(o.s.flat()); groups.splice(i, 1); i = -1; }
  }
  groups.sort((a, b) => a.b.x0 - b.b.x0);
  const hs = groups.filter(big).map((g) => g.b.h).sort((a, b) => a - b); const Hm = hs[Math.floor(hs.length / 2)] || Hline;
  const out = [];
  groups.forEach((g, gi) => {
    if (gi > 0) { const gap = g.b.x0 - groups[gi - 1].b.x1; if (gap > Hm * 0.55) out.push({ ch: ' ', space: true }); }
    const q = readGroup(g, Hm); Object.defineProperty(q, 'g', { value: g, enumerable: false }); out.push(q);
  });
  baselineFix(out, groups, Hm);
  wordContext(out);
  return out;
}
function readGroup(g, Hm) {
  if (Math.max(g.b.w, g.b.h) < Hm * 0.25) return { ch: '.', base: '.', alt: ['.', ','], punct: true };
  const sts = g.s.map((s) => ({ s, b: bb(s) }));
  const L = sts.reduce((m, q) => (Math.max(q.b.w, q.b.h) > Math.max(m.b.w, m.b.h) ? q : m), sts[0]);
  let body = sts.filter((q) => Math.max(q.b.w, q.b.h) >= Hm * 0.3 || q === L);
  let bx = bb(body.flatMap((q) => q.s));
  const above = [], below = [], inner = [];
  for (const q of sts) {
    if (body.includes(q)) continue;
    if (q.b.y1 < bx.y0 + bx.h * 0.18) above.push(q); else if (q.b.y0 > bx.y1 - bx.h * 0.15) below.push(q); else inner.push(q);
  }
  // dấu viết to (trên 30% chiều cao) nhưng nằm hẳn trên thân chữ
  for (const q of body.slice()) if (q !== L && q.b.y1 < bb(L.s).y0 + 2) { body = body.filter((x) => x !== q); above.push(q); }
  bx = bb(body.flatMap((q) => q.s));
  let r = classify(body.concat(inner).map((q) => q.s));
  let mod = null, tone = null;
  // đ: nét ngang ngắn cắt thân
  const bar = inner.concat(body.filter((q) => q !== L)).find((q) => q.b.w > q.b.h * 2 && q.b.y0 > bx.y0 - 2 && q.b.y1 < bx.y0 + bx.h * 0.6);
  if (bar) { const r2 = classify(body.concat(inner).filter((q) => q !== bar).map((q) => q.s)); const dI = r2.findIndex((x) => x.c === 'd'); if (dI >= 0 && dI < 2 && r2[dI].p > 0.25) { r = r2; mod = 'bar'; r.unshift(...r.splice(dI, 1)); } }
  // móc (ơ, ư): nét nhỏ ở góc trên bên phải
  if (!mod) {
    const hn = inner.concat(above).find((q) => q.b.x0 > bx.x0 + bx.w * 0.55 && q.b.y0 < bx.y0 + bx.h * 0.45 && Math.max(q.b.w, q.b.h) < Hm * 0.45);
    if (hn) {
      const r2 = classify(body.concat(inner).filter((q) => q !== hn).map((q) => q.s)); const k = r2.findIndex((x) => 'ou0v'.includes(x.c));
      if (k >= 0 && k < 2) { r = r2; mod = 'horn'; const o = { ...r.splice(k, 1)[0] }; if (o.c === '0') o.c = 'o'; if (o.c === 'v') o.c = 'u'; r.unshift(o); const ai = above.indexOf(hn); if (ai >= 0) above.splice(ai, 1); }
    }
  }
  // dấu trên
  const marks = above.map((q) => ({ q, t: markShape(q.s, Hm) }));
  const base0 = r[0].c;
  if (marks.length === 1 && marks[0].t === 'dot' && 'il1j'.includes(base0)) { r = [{ c: base0 === 'j' ? 'j' : 'i', p: r[0].p }, ...r.filter((x) => x.c !== 'i' && x.c !== 'j')]; marks.length = 0; }
  // hai nét thẳng chụm thành mũ ^
  const st = marks.filter((m) => m.t === 'acute' || m.t === 'grave');
  for (const A0 of st) for (const B0 of st) {
    if (A0 === B0 || A0.t !== 'acute' || B0.t !== 'grave' || A0.used || B0.used) continue;
    const A = A0.q.b, B = B0.q.b;
    if (A.x0 < B.x0 && B.x0 - A.x1 < Hm * 0.15 && Math.abs(A.h - B.h) < Math.max(A.h, B.h) * 0.6) { A0.used = B0.used = true; mod = mod || 'circ'; }
  }
  for (const m of marks) {
    if (m.used) continue;
    if (m.t === 'circ' || m.t === 'breve') { if (!mod) mod = m.t; continue; }
    if (!tone) tone = m.t;
  }
  if (below.length && !tone) tone = 'dot';
  // một nét tròn khép kín (điểm đầu ≈ điểm cuối) → o, không phải a / q
  if (body.length === 1 && 'aqd'.includes(r[0].c)) {
    const S0 = body[0].s, a0 = S0[0], z0 = S0[S0.length - 1];
    if (Math.hypot(a0[0] - z0[0], a0[1] - z0[1]) < 0.25 * Math.max(bx.w, bx.h)) { const k = r.findIndex((x) => x.c === 'o' || x.c === '0'); if (k > 0 && k < 5) r = [{ c: 'o', p: r[k].p }, ...r.filter((x, i) => i !== k)]; }
  }
  // có dấu mũ / trăng / thanh → chắc chắn là nguyên âm hợp với dấu đó (0 → o …)
  const LOOK = { '0': 'o', '4': 'a', '6': 'a', '9': 'a', 'q': 'a', 'g': 'a', 'c': 'e' };
  const okFor = (c) => mod === 'circ' ? 'aeo'.includes(c) : mod === 'breve' ? c === 'a' : mod === 'horn' ? 'ou'.includes(c) : mod === 'bar' ? c === 'd' : tone ? 'aeiouy'.includes(c) : true;
  if ((mod || tone) && !okFor(r[0].c)) {
    let best = null, bp = -1;
    for (const x of r) { const c = okFor(x.c) ? x.c : LOOK[x.c] && okFor(LOOK[x.c]) ? LOOK[x.c] : null; if (c && x.p * (c === x.c ? 1 : x.c === '0' ? 0.9 : 0.5) > bp) { bp = x.p * (c === x.c ? 1 : x.c === '0' ? 0.9 : 0.5); best = c; } }
    if (best) r = [{ c: best, p: bp }, ...r.filter((x) => x.c !== best)];
  }
  const alt = r.slice(0, 4).map((x) => x.c);
  // một nét thẳng đứng: chữ l thường hay chữ I hoa (bộ dữ liệu gộp hoa/thường)
  const vbar = r[0].c === 'l' && g.s.length === 1 && g.b.w < g.b.h * 0.25;
  return { base: r[0].c, alt, p: r[0].p, mod, tone, ch: compose(r[0].c, mod, tone), probs: r, vbar };
}
// trong một từ: phần lớn là chữ cái thì đổi số dễ nhầm sang chữ (0→o, 1→l, 5→s…) và ngược lại
function wordContext(out) {
  let w = [];
  const isD = (c) => c >= '0' && c <= '9';
  const flush = () => {
    if (!w.length) return;
    const nD = w.filter((q) => isD(q.base)).length, letters = nD * 2 < w.length;
    const want = letters ? (c) => !isD(c) : isD;
    for (const q of w) {
      if (want(q.base)) continue;
      const alt = q.probs.find((x) => want(x.c) && x.p > 0.03);
      if (alt) { q.base = alt.c; q.alt = [alt.c, ...q.alt.filter((c) => c !== alt.c)].slice(0, 4); q.ch = compose(q.base, q.mod, q.tone); }
    }
    w = [];
  };
  for (const q of out) { if (q.space || q.punct) flush(); else w.push(q); }
  flush();
}
export function applyCase(chars, mode) { // mode: 'sentence' | 'upper' | 'lower'
  let first = true;
  return chars.map((q) => {
    if (q.space || q.punct) { if (q.punct && q.ch === '.') first = true; return q.ch; }
    const up = q.upper ?? (mode === 'upper' || (mode === 'sentence' && first)); first = false;
    if (q.vbar && q.ch === 'l') return up ? 'I' : 'l';
    return up ? q.ch.toUpperCase() : q.ch.toLowerCase();
  }).join('');
}

// ---------------- Giao diện vùng viết chữ ----------------
let pad = null;
export function openTextPad(input, { onDone, keyboard } = {}) {
  closeTextPad();
  const r = input.getBoundingClientRect();
  const el = document.createElement('div'); el.className = 'hwpad hwtext';
  el.innerHTML = `<div class="hw-top"><b class="hw-title">✍ Viết chữ bằng tay</b><div class="hw-case"><button data-c="sentence">Abc</button><button data-c="upper">ABC</button><button data-c="lower">abc</button></div></div>
    <div class="hw-out"></div><div class="hw-edit"></div>
    <canvas class="hw-c"></canvas>
    <div class="hw-hint">Viết chữ in, tách rời từng chữ; dấu viết trên hoặc dưới chữ · chạm một chữ ở trên để sửa · bấm ␣ Cách để viết tiếp từ sau</div>
    <div class="hw-row"><button data-k="undo" title="Bỏ nét cuối">↶</button><button data-k="clear">Xoá</button><button data-k="space">␣ Cách</button><button data-k="kb" title="Dùng bàn phím">⌨</button><button data-k="cancel">Huỷ</button><button data-k="ok" class="ok">✓ Nhập</button></div>`;
  document.body.append(el);
  const W = Math.min(620, window.innerWidth - 24), Hc = 170;
  el.style.width = W + 'px';
  el.style.left = Math.max(12, Math.min(window.innerWidth - W - 12, r.left + r.width / 2 - W / 2)) + 'px';
  const place = () => { // luôn nằm trọn trong màn hình (khung cao lên khi mở hàng sửa chữ)
    const hh = el.offsetHeight, ih = window.innerHeight;
    const top = r.bottom + 8 + hh < ih ? r.bottom + 8 : r.top - 8 - hh > 0 ? r.top - 8 - hh : Math.max(8, ih - hh - 8);
    el.style.top = top + 'px';
  };
  const c = el.querySelector('canvas'); const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.style.width = W - 20 + 'px'; c.style.height = Hc + 'px'; c.width = (W - 20) * dpr; c.height = Hc * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const lines = []; // các đoạn đã viết xong (bấm ␣ Cách)
  let strokes = [], cur = null, timer = 0, result = [], sel = -1, mode = 'sentence';
  const outEl = el.querySelector('.hw-out'), edEl = el.querySelector('.hw-edit');
  const draw = () => {
    ctx.clearRect(0, 0, W, Hc);
    ctx.strokeStyle = '#d6dde5'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(10, Hc * 0.74); ctx.lineTo(W - 30, Hc * 0.74); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#16325c'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes.concat(cur ? [cur] : [])) { ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]); ctx.stroke(); }
    if (!strokes.length && !cur) { ctx.fillStyle = '#9aa7b4'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(lines.length ? 'Viết tiếp từ sau vào đây' : 'Viết chữ vào đây, ví dụ: Bãi đỗ xe', W / 2 - 10, Hc / 2); }
  };
  const all = () => { const A = []; for (const ln of lines) { if (A.length) A.push({ ch: ' ', space: true }); A.push(...ln); } if (A.length && result.length) A.push({ ch: ' ', space: true }); return A.concat(result); };
  const text = () => applyCase(all(), mode);
  const show = () => { show0(); place(); };
  const show0 = () => {
    el.querySelectorAll('.hw-case button').forEach((b) => b.classList.toggle('on', b.dataset.c === mode));
    outEl.innerHTML = ''; const A = all(), t = text();
    if (!A.length) outEl.innerHTML = '<span class="muted">Chữ nhận được hiện ở đây</span>';
    A.forEach((q, i) => {
      const b = document.createElement('button'); b.className = 'hw-ch' + (i === sel ? ' on' : '') + (q.space ? ' sp' : '');
      b.textContent = q.space ? '␣' : t[i]; b.onclick = () => { sel = sel === i ? -1 : i; show(); }; outEl.append(b);
    });
    edEl.innerHTML = '';
    const q = A[sel];
    if (q && !q.space) {
      const row = (items) => { const d = document.createElement('div'); d.className = 'hw-erow'; for (const [lab, fn, on] of items) { const b = document.createElement('button'); b.textContent = lab; if (on) b.className = 'on'; b.onclick = () => { fn(); if (!q.punct) q.ch = compose(q.base, q.mod, q.tone); show(); }; d.append(b); } edEl.append(d); };
      if (q.alt && q.alt.length > 1) row(q.alt.map((a) => [a, () => { q.base = a; if (q.punct) q.ch = a; }, a === q.base]));
      if (!q.punct) {
        row([['không dấu', () => (q.tone = null), !q.tone], ['sắc ´', () => (q.tone = 'acute'), q.tone === 'acute'], ['huyền `', () => (q.tone = 'grave'), q.tone === 'grave'], ['hỏi ̉', () => (q.tone = 'hook'), q.tone === 'hook'], ['ngã ~', () => (q.tone = 'tilde'), q.tone === 'tilde'], ['nặng .', () => (q.tone = 'dot'), q.tone === 'dot']]);
        row([['â ê ô', () => (q.mod = q.mod === 'circ' ? null : 'circ'), q.mod === 'circ'], ['ă', () => (q.mod = q.mod === 'breve' ? null : 'breve'), q.mod === 'breve'], ['ơ ư', () => (q.mod = q.mod === 'horn' ? null : 'horn'), q.mod === 'horn'], ['đ', () => { q.mod = q.mod === 'bar' ? null : 'bar'; if (q.mod === 'bar') q.base = 'd'; }, q.mod === 'bar'],
          ['Hoa / thường', () => { const now = text()[sel]; q.upper = now !== now.toUpperCase(); }, false],
          ['✕ Xoá chữ', () => { const k = result.indexOf(q); if (k >= 0) result.splice(k, 1); else for (const ln of lines) { const j = ln.indexOf(q); if (j >= 0) ln.splice(j, 1); } sel = -1; }, false]]);
      }
    }
  };
  const run = async () => { result = await recognizeText(strokes); sel = -1; show(); };
  const pos = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.addEventListener('pointerdown', (e) => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch {} cur = [pos(e)]; clearTimeout(timer); draw(); });
  c.addEventListener('pointermove', (e) => { if (!cur) return; e.preventDefault(); const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e]; for (const ce of evs.length ? evs : [e]) cur.push(pos(ce)); draw(); });
  const up = () => { if (!cur) return; strokes.push(cur); cur = null; draw(); clearTimeout(timer); timer = setTimeout(run, 350); };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.style.touchAction = 'none';
  el.querySelector('.hw-case').onclick = (e) => { const m = e.target.closest('button')?.dataset.c; if (m) { mode = m; for (const q of all()) delete q.upper; show(); } };
  const done = (ok) => {
    const v = text().replace(/\s+/g, ' ').trim();
    closeTextPad();
    if (ok && v) { input.value = v; input.dispatchEvent(new Event('change', { bubbles: true })); onDone && onDone(v); }
  };
  el.querySelector('.hw-row').onclick = async (e) => {
    const k = e.target.closest('button')?.dataset.k; if (!k) return;
    if (k === 'undo') { if (strokes.length) { strokes.pop(); draw(); await run(); } else if (lines.length) { result = lines.pop(); show(); } }
    else if (k === 'clear') { strokes = []; result = []; lines.length = 0; sel = -1; draw(); show(); }
    else if (k === 'space') { clearTimeout(timer); if (strokes.length) await run(); if (result.length) { lines.push(result); result = []; } strokes = []; draw(); show(); }
    else if (k === 'kb') { closeTextPad(); keyboard && keyboard(); }
    else if (k === 'cancel') closeTextPad();
    else if (k === 'ok') { clearTimeout(timer); if (strokes.length) await run(); done(true); }
  };
  const outside = (e) => { if (!el.contains(e.target) && e.target !== input) closeTextPad(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  pad = { el, outside };
  draw(); show();
  loadNet().catch(() => { outEl.textContent = 'Không tải được bộ nhận dạng chữ'; });
  return el;
}
export function closeTextPad() { if (!pad) return; document.removeEventListener('pointerdown', pad.outside, true); pad.el.remove(); pad = null; }
export const textPadOpen = () => !!pad;

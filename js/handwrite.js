// Nhập số bằng chữ viết tay: vùng viết hiện ra khi chạm ô số, tự nhận dạng chữ số (chạy offline)
let net = null;
async function loadNet() {
  if (net) return net;
  const { MODEL } = await import('./digits-model.js');
  const dec = (k) => { const m = MODEL[k]; const b = atob(m.d); const a = new Float32Array(b.length); for (let i = 0; i < b.length; i++) a[i] = ((b.charCodeAt(i) << 24) >> 24) * m.s; return { a, shape: m.shape }; };
  net = [0, 1, 2, 3, 4, 5].map((i) => dec('w' + i));
  return net;
}
function dense(x, W, b, relu) {
  const [n, m] = W.shape, out = new Float32Array(m);
  for (let j = 0; j < m; j++) out[j] = b.a[j];
  for (let i = 0; i < n; i++) { const xi = x[i]; if (!xi) continue; const off = i * m; for (let j = 0; j < m; j++) out[j] += xi * W.a[off + j]; }
  if (relu) for (let j = 0; j < m; j++) if (out[j] < 0) out[j] = 0;
  return out;
}
function classify(img) {
  const h1 = dense(img, net[0], net[1], true), h2 = dense(h1, net[2], net[3], true), z = dense(h2, net[4], net[5], false);
  const mx = Math.max(...z); const e = Array.from(z, (v) => Math.exp(v - mx)); const s = e.reduce((a, b) => a + b, 0);
  return e.map((v, d) => ({ d: String(d), p: v / s })).sort((a, b) => b.p - a.p);
}
const bboxOf = (pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
// Ảnh 28×28 kiểu MNIST: chữ nằm trong khung 20×20, tâm khối lượng ở giữa
export function rasterize(strokes, lw = 2.6) {
  const all = strokes.flat(); const b = bboxOf(all);
  const w = Math.max(1, b.x1 - b.x0), hgt = Math.max(1, b.y1 - b.y0);
  const S = 4, k = (20 * S) / Math.max(w, hgt);
  const c = document.createElement('canvas'); c.width = c.height = 28 * S;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = lw * S;
  const ox = (28 * S - w * k) / 2, oy = (28 * S - hgt * k) / 2;
  for (const s of strokes) {
    x.beginPath();
    s.forEach(([px, py], i) => { const X = ox + (px - b.x0) * k, Y = oy + (py - b.y0) * k; i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
    if (s.length === 1) x.lineTo(ox + (s[0][0] - b.x0) * k + 0.1, oy + (s[0][1] - b.y0) * k);
    x.stroke();
  }
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const img = new Float32Array(784);
  for (let yy = 0; yy < 28; yy++) for (let xx = 0; xx < 28; xx++) {
    let s = 0; for (let a = 0; a < S; a++) for (let bb = 0; bb < S; bb++) s += d[((yy * S + a) * c.width + xx * S + bb) * 4];
    img[yy * 28 + xx] = s / (S * S * 255);
  }
  // dời tâm khối lượng về (14, 14)
  let m = 0, cx = 0, cy = 0;
  for (let i = 0; i < 784; i++) { m += img[i]; cx += (i % 28) * img[i]; cy += Math.floor(i / 28) * img[i]; }
  if (!m) return img;
  const dx = Math.round(14 - cx / m - 0.5), dy = Math.round(14 - cy / m - 0.5);
  const out = new Float32Array(784);
  for (let yy = 0; yy < 28; yy++) for (let xx = 0; xx < 28; xx++) { const sx = xx - dx, sy = yy - dy; if (sx >= 0 && sx < 28 && sy >= 0 && sy < 28) out[yy * 28 + xx] = img[sy * 28 + sx]; }
  return out;
}
// Tách các nét thành từng ký tự theo chiều ngang
export function segment(strokes) {
  const items = strokes.map((s) => ({ s: [s], b: bboxOf(s) })).sort((a, b) => a.b.x0 - b.b.x0);
  const groups = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g) {
      const ov = Math.min(g.b.x1, it.b.x1) - Math.max(g.b.x0, it.b.x0);
      const minW = Math.max(4, Math.min(g.b.x1 - g.b.x0, it.b.x1 - it.b.x0));
      const inside = it.b.x0 >= g.b.x0 - 3 && it.b.x1 <= g.b.x1 + 3; // nét nằm gọn trong ký tự trước (ví dụ nét dọc của số 4)
      if (inside || (ov > -2 && ov >= 0.35 * minW)) { g.s.push(...it.s); g.b = bboxOf(g.s.flat()); continue; }
    }
    groups.push({ s: [...it.s], b: it.b });
  }
  return groups;
}
export async function recognize(strokes) {
  if (!strokes.length) return [];
  await loadNet();
  const groups = segment(strokes);
  const hs = groups.map((g) => g.b.y1 - g.b.y0).sort((a, b) => b - a);
  const H = hs[0] || 1;
  return groups.map((g) => {
    const w = g.b.x1 - g.b.x0, hh = g.b.y1 - g.b.y0;
    if (Math.max(w, hh) < H * 0.22 && groups.length > 1) return { ch: '.', alt: ['.', ','] };
    if (hh < H * 0.3 && w > hh * 2.5 && groups.length > 1) return { ch: '-', alt: ['-'] };
    const r = classify(rasterize(g.s));
    return { ch: r[0].d, alt: r.slice(0, 3).map((q) => q.d), p: r[0].p };
  });
}

// ---------------- Giao diện vùng viết tay ----------------
let pad = null;
export function openPad(input, { onDone, keyboard } = {}) {
  closePad();
  const r = input.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'hwpad';
  el.innerHTML = `<div class="hw-top"><b class="hw-title">✍ Viết số bằng tay</b><span class="hw-res" aria-live="polite"></span></div>
    <canvas class="hw-c"></canvas>
    <div class="hw-row"><button data-k="undo" title="Bỏ nét cuối">↶</button><button data-k="clear">Xoá</button><button data-k=".">,</button><button data-k="kb" title="Dùng bàn phím">⌨</button><button data-k="cancel">Huỷ</button><button data-k="ok" class="ok">✓ Nhập</button></div>`;
  document.body.append(el);
  const W = Math.min(420, window.innerWidth - 24), Hc = 150;
  el.style.width = W + 'px';
  const top = r.bottom + 8 + 260 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - 268);
  el.style.left = Math.max(12, Math.min(window.innerWidth - W - 12, r.left + r.width / 2 - W / 2)) + 'px';
  el.style.top = top + 'px';
  const c = el.querySelector('canvas'); const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.style.width = W - 20 + 'px'; c.style.height = Hc + 'px'; c.width = (W - 20) * dpr; c.height = Hc * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const strokes = []; let cur = null, timer = 0, result = [], extra = '';
  const resEl = el.querySelector('.hw-res');
  const draw = () => {
    ctx.clearRect(0, 0, W, Hc);
    ctx.strokeStyle = '#d6dde5'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(10, Hc * 0.78); ctx.lineTo(W - 30, Hc * 0.78); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#16325c'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes.concat(cur ? [cur] : [])) { ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]); ctx.stroke(); }
    if (!strokes.length && !cur) { ctx.fillStyle = '#9aa7b4'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Viết số vào đây (ví dụ 12 hoặc 2,5)', W / 2 - 10, Hc / 2); }
  };
  const text = () => result.map((q) => q.ch).join('') + extra;
  const show = () => {
    resEl.innerHTML = '';
    result.forEach((q, i) => {
      const b = document.createElement('button'); b.className = 'hw-ch'; b.textContent = q.ch === '.' ? ',' : q.ch;
      if (q.alt.length > 1) { b.title = 'Chạm để đổi: ' + q.alt.join(' / '); b.onclick = () => { const k = q.alt.indexOf(q.ch); q.ch = q.alt[(k + 1) % q.alt.length]; show(); }; }
      resEl.append(b);
    });
    if (extra) resEl.append(extra.replace('.', ','));
    if (!result.length && !extra) resEl.textContent = '—';
  };
  const run = async () => { result = await recognize(strokes); show(); };
  const pos = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.addEventListener('pointerdown', (e) => { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch {} cur = [pos(e)]; clearTimeout(timer); draw(); });
  c.addEventListener('pointermove', (e) => { if (!cur) return; e.preventDefault(); const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e]; for (const ce of evs.length ? evs : [e]) cur.push(pos(ce)); draw(); });
  const up = () => { if (!cur) return; strokes.push(cur); cur = null; draw(); clearTimeout(timer); timer = setTimeout(run, 120); };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.style.touchAction = 'none';
  const done = (ok) => {
    const v = text();
    closePad();
    if (ok && v && v !== '.' && v !== '-') { input.value = v; input.dispatchEvent(new Event('change', { bubbles: true })); onDone && onDone(v); }
  };
  el.querySelector('.hw-row').onclick = async (e) => {
    const k = e.target.closest('button')?.dataset.k; if (!k) return;
    if (k === 'undo') { strokes.pop(); draw(); await run(); }
    else if (k === 'clear') { strokes.length = 0; result = []; extra = ''; draw(); show(); }
    else if (k === '.') { // chèn dấu phẩy thập phân sau nét cuối (một chấm nhỏ ở chân dòng)
      if (!strokes.length) return;
      const b = bboxOf(strokes.flat()); const x = b.x1 + Math.max(6, (b.y1 - b.y0) * 0.25), y = b.y1;
      strokes.push([[x, y], [x + 1, y + 1]]); draw(); await run();
    }
    else if (k === 'kb') { closePad(); keyboard && keyboard(); }
    else if (k === 'cancel') closePad();
    else if (k === 'ok') { clearTimeout(timer); if (strokes.length) await run(); done(true); }
  };
  const outside = (e) => { if (!el.contains(e.target) && e.target !== input) closePad(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  pad = { el, outside };
  draw(); show();
  loadNet().catch(() => { resEl.textContent = 'Không tải được bộ nhận dạng'; });
  return el;
}
export function closePad() {
  if (!pad) return;
  document.removeEventListener('pointerdown', pad.outside, true);
  pad.el.remove(); pad = null;
}
export const padOpen = () => !!pad;

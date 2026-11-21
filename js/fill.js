// Tô ô đất: tìm vùng trống khép kín bởi đường, sông, ô đất khác và nét CAD quanh điểm chạm.
import * as G from './geom.js';
import { roadTotalWidth, LAND_CLOSED } from './model.js';
import { View } from './render2d.js';

const K = 2; // độ phân giải lưới = 1/2 điểm ảnh màn hình
let lastWhy = ''; // lý do lượt dò cuối không ra vùng: 'leak' (tràn mép khung) | 'wall' (chạm đúng nét) | 'small'

// Tô vùng tại một điểm thế giới: dò thô trên lưới phủ cả bản vẽ, rồi dò mịn quanh vùng tìm được
// và bám điểm biên vào đúng mép đường / sông / ô đất (kể cả đoạn cong).
// extra: các nét chắn tạm (ví dụ nét cọ SDĐ hở nối với đường để khép vùng)
const T = (k, t0) => { const f = globalThis.__ft; if (f) f[k] = (f[k] || 0) + performance.now() - t0; }; // đo thời gian khi kiểm thử
const FILL_KINDS = new Set(['road', 'water', 'zone', 'cad', 'sketch', 'building', 'park', 'land', 'cloud']);
// khung bao từng đối tượng (nới theo nửa bề rộng đường / sông) — tính một lần mỗi lần chạm
function itemBoxes(doc) {
  const out = [];
  for (const it of doc.items) {
    if (!FILL_KINDS.has(it.kind)) continue;
    const P = it.pts; if (!P || !P.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < P.length; k++) { const q = P[k], x = q[0], y = q[1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const pad = it.kind === 'road' ? roadTotalWidth(it) / 2 : it.kind === 'water' && it.props.mode === 'river' ? (it.props.width || 0) / 2 : 0;
    out.push({ it, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });
  }
  return out;
}
export function fillRegionAt(doc, w, extra = [], opts = {}) {
  let t0 = performance.now();
  const boxes = itemBoxes(doc);
  let b = { x0: w[0], y0: w[1], x1: w[0], y1: w[1] };
  for (const q of boxes) if (q.it.kind === 'road' || q.it.kind === 'water' || q.it.kind === 'zone' || q.it.kind === 'cad' || (opts.land && q.it.kind === 'building')) { if (q.x0 < b.x0) b.x0 = q.x0; if (q.y0 < b.y0) b.y0 = q.y0; if (q.x1 > b.x1) b.x1 = q.x1; if (q.y1 > b.y1) b.y1 = q.y1; }
  for (const e of extra) for (const q of e) { if (q[0] < b.x0) b.x0 = q[0]; if (q[0] > b.x1) b.x1 = q[0]; if (q[1] < b.y0) b.y0 = q[1]; if (q[1] > b.y1) b.y1 = q[1]; }
  if (b.x0 === b.x1 && b.y0 === b.y1) return null;
  T('boxes', t0);
  // khung dò đặt giữa điểm chạm, bắt đầu nhỏ (độ phân giải cao, vùng hẹp không bị nét «nuốt»),
  // vùng tràn ra mép khung thì nới khung, tới khi khung trùm hết bản vẽ mà vẫn tràn = vùng hở.
  // Mỗi lượt chỉ vẽ / xét các đối tượng chạm khung (bản vẽ hàng chục nghìn nét vẫn nhanh).
  const reach = 2 * Math.max(Math.abs(b.x0 - w[0]), Math.abs(b.x1 - w[0]), Math.abs(b.y0 - w[1]), Math.abs(b.y1 - w[1])) + 40;
  let win = Math.min(240, reach);
  for (;;) {
    t0 = performance.now();
    const fs = Math.max(0.04, win / GRID);
    const h = win / 2 + 2, wx0 = w[0] - h, wx1 = w[0] + h, wy0 = w[1] - h, wy1 = w[1] + h;
    const items = []; for (const q of boxes) if (q.x1 >= wx0 && q.x0 <= wx1 && q.y1 >= wy0 && q.y0 <= wy1) items.push(q.it);
    const sub = { id: doc.id, items, layers: doc.layers };
    const ex = opts.gap > 0 ? extra.concat(gapBridges0(sub, opts.gap, opts)) : extra; // tự khép chỗ hở nhỏ (chỉ trong khung)
    T('items+bridges', t0);
    const fv = new View(); fv.w = fv.h = Math.ceil(win / fs) * K; fv.scale = K / fs; fv.cx = w[0]; fv.cy = w[1];
    const fine = fillRegion(sub, fv, fv.toScreen(w), ex, true, opts);
    if (fine) { t0 = performance.now(); const o = finishFill(sub, ex, opts, fine, fs); T('finish', t0); return o; }
    if (lastWhy !== 'leak' || win >= reach) return null;
    win = Math.min(reach, win * 2.5);
  }
}
const GRID = 1600; // số ô lưới mỗi chiều của một lượt dò
function finishFill(doc, extra, opts, fine, fs) {
  const srcs = edgeSources(doc, extra, G.bbox(fine), opts);
  const snapped = snapToEdges(fine, srcs, fs * 2.6);
  let out = G.rdp(snapped.concat([snapped[0]]), Math.min(0.05, fs * 0.25)).slice(0, -1);
  if (!(out.length >= 3 && Math.abs(G.area(out)) >= 20)) {
    out = G.rdp(fine.concat([fine[0]]), fs * 0.75).slice(0, -1);
    if (!(out.length >= 3 && Math.abs(G.area(out)) >= 20)) return null;
  }
  // vùng khép kín bên trong (đa giác nằm trong vùng tô) -> lỗ thủng, không phủ
  out.holes = [];
  for (const hw of fine.holes || []) {
    const sh = snapToEdges(hw, srcs, fs * 2.6);
    const hp = G.rdp(sh.concat([sh[0]]), Math.min(0.05, fs * 0.25)).slice(0, -1);
    const A = Math.abs(G.area(hp)), L = G.length(hp, true);
    if (hp.length >= 3 && A >= 4 && A / L > fs * 3) out.holes.push(hp); // bỏ nét hở / chữ nhỏ (vùng mảnh)
  }
  return out;
}

// Các «mép» thật của vùng: tim đường + nửa bề rộng, mép sông, cạnh hồ / ô đất / nét CAD
export function edgeSources(doc, extra = [], near = null, opts = {}) {
  const out = [];
  const ok = (pts, pad) => { if (!near) return true; const b = G.bbox(pts); return b.x1 + pad >= near.x0 && b.x0 - pad <= near.x1 && b.y1 + pad >= near.y0 && b.y0 - pad <= near.y1; };
  for (const it of doc.items) {
    if (it.kind === 'road') { const hw = roadTotalWidth(it) / 2; if (ok(it.pts, hw)) out.push({ pts: it.pts, closed: false, off: hw }); }
    else if (it.kind === 'water') {
      if (it.props.mode === 'river') { if (ok(it.pts, it.props.width / 2)) out.push({ pts: it.pts, closed: false, off: it.props.width / 2 }); }
      else if (ok(it.pts, 1)) out.push({ pts: it.pts, closed: true, off: 0 });
    } else if (it.kind === 'zone' || it.kind === 'cad') { if (ok(it.pts, 1)) out.push({ pts: it.pts, closed: it.kind === 'zone' || !!it.closed, off: 0 }); }
    else if (opts.land && (it.kind === 'building' || it.kind === 'park' || (it.kind === 'land' && LAND_CLOSED[it.props.style]))) { if (ok(it.pts, 1)) out.push({ pts: it.pts, closed: true, off: 0 }); }
  }
  for (const e of extra) out.push({ pts: e, closed: false, off: 0 });
  return out;
}
function project(p, src) {
  const r = G.distToPolyline(p, src.pts, src.closed);
  if (!r.q) return null;
  if (!src.off) return { q: r.q, res: r.d };
  if (r.d < 1e-9) return null;
  const k = src.off / r.d;
  return { q: [r.q[0] + (p[0] - r.q[0]) * k, r.q[1] + (p[1] - r.q[1]) * k], res: Math.abs(r.d - src.off) };
}
// Dời từng điểm biên (dò từ ảnh điểm) về mép thật gần nhất; nơi hai mép gặp nhau thì chèn đúng giao điểm
export function snapToEdges(poly, srcs, tol) {
  const bbs = srcs.map((s) => { const b = G.bbox(s.pts); return { x0: b.x0 - s.off - tol, y0: b.y0 - s.off - tol, x1: b.x1 + s.off + tol, y1: b.y1 + s.off + tol }; });
  const snapOne = (p) => {
    let best = null, bi = -1;
    for (let i = 0; i < srcs.length; i++) {
      const b = bbs[i]; if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) continue;
      const r = project(p, srcs[i]); if (r && r.res <= tol && (!best || r.res < best.res)) { best = r; bi = i; }
    }
    return best ? { p: best.q, s: bi } : { p, s: -1 };
  };
  const sn = poly.map(snapOne);
  const out = [];
  for (let i = 0; i < sn.length; i++) {
    const a = sn[i], b = sn[(i + 1) % sn.length];
    out.push(a.p);
    if (a.s >= 0 && b.s >= 0 && a.s !== b.s) {
      // giao điểm hai mép: chiếu xen kẽ lên hai mép cho tới khi hội tụ
      let c = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2], good = true;
      for (let k = 0; k < 24; k++) {
        const r1 = project(c, srcs[a.s]); if (!r1) { good = false; break; }
        const r2 = project(r1.q, srcs[b.s]); if (!r2) { good = false; break; }
        c = r2.q;
      }
      if (good && G.dist(c, a.p) < tol * 3 && G.dist(c, b.p) < tol * 3) out.push(c);
    }
  }
  return out;
}

export function fillRegion(doc, view, screenPt, extra = [], fine = false, opts = {}) {
  let t0 = performance.now();
  const W = Math.ceil(view.w / K), H = Math.ceil(view.h / K);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.strokeStyle = x.fillStyle = '#000'; x.lineCap = 'round'; x.lineJoin = 'round';
  const S = (p) => { const s = view.toScreen(p); return [s[0] / K, s[1] / K]; };
  const path = (pts, closed) => { x.beginPath(); pts.forEach((p, i) => { const s = S(p); i ? x.lineTo(s[0], s[1]) : x.moveTo(s[0], s[1]); }); if (closed) x.closePath(); };
  for (const it of doc.items) {
    if (it.kind === 'road') { path(it.pts, false); x.lineWidth = Math.max(2, (roadTotalWidth(it) * view.scale) / K); x.stroke(); }
    else if (it.kind === 'water') {
      if (it.props.mode === 'river') { path(it.pts, false); x.lineWidth = Math.max(2, (it.props.width * view.scale) / K); x.stroke(); }
      else { path(it.pts, true); x.fill(); }
    } else if (it.kind === 'zone') { path(it.pts, true); for (const hh of it.holes || []) { hh.forEach((p, i) => { const s = S(p); i ? x.lineTo(s[0], s[1]) : x.moveTo(s[0], s[1]); }); x.closePath(); } if (!opts.land) x.fill('evenodd'); x.lineWidth = 2; x.stroke(); }
    else if (opts.land && (it.kind === 'building' || it.kind === 'park' || (it.kind === 'land' && LAND_CLOSED[it.props.style]))) { path(it.pts, true); x.fill(); x.lineWidth = 2; x.stroke(); }
    else if (it.kind === 'cad') { path(it.pts, it.closed); x.lineWidth = 2; x.stroke(); }
  }
  for (const e of extra) { path(e, false); x.lineWidth = 2; x.stroke(); }
  T('draw', t0); t0 = performance.now();
  const img = x.getImageData(0, 0, W, H).data;
  T('getimg', t0); t0 = performance.now();
  const N = W * H, free = new Uint8Array(N);
  for (let i = 0; i < N; i++) free[i] = img[i * 4] > 128 ? 1 : 0;
  let sx = Math.floor(screenPt[0] / K), sy = Math.floor(screenPt[1] / K);
  // khép chỗ hở bằng ảnh điểm: coi mọi nét dày thêm rr ô mỗi bên (mọi chỗ hở ≤ dung sai bị bịt, kể cả nét trùng,
  // nét kín không chạm nhau, chỗ hở giữa hai cạnh), tô xong thì nở vùng lại về sát nét thật.
  // Ô «trống sau khi làm dày» = không có ô nét nào trong ô vuông bán kính rr: tra bằng bảng cộng dồn (nhanh, chỉ tính ô được xét)
  let rr = 0, okAt = (i) => free[i] === 1;
  if (opts.gap > 0) {
    rr = Math.min(80, Math.round((opts.gap * view.scale) / K / 2 - 1)); // nét vẽ đã dày 1 ô mỗi bên
    if (rr >= 1) {
      const W1 = W + 1, SA = new Int32Array(W1 * (H + 1));
      for (let y = 0; y < H; y++) { let row = 0; const o = y * W, a = (y + 1) * W1, b0 = y * W1; for (let x = 0; x < W; x++) { row += 1 - free[o + x]; SA[a + x + 1] = SA[b0 + x + 1] + row; } }
      okAt = (i) => {
        if (!free[i]) return false;
        const x = i % W, y = (i / W) | 0, xa = x - rr < 0 ? 0 : x - rr, ya = y - rr < 0 ? 0 : y - rr, xb = x + rr + 1 > W ? W : x + rr + 1, yb = y + rr + 1 > H ? H : y + rr + 1;
        return SA[yb * W1 + xb] - SA[ya * W1 + xb] - SA[yb * W1 + xa] + SA[ya * W1 + xa] === 0;
      };
      if (sx >= 0 && sy >= 0 && sx < W && sy < H && !okAt(sy * W + sx)) { // chạm sát nét: tìm ô trống gần nhất
        let best = null;
        for (let d = 1; d <= rr + 2 && !best; d++) for (let dy = -d; dy <= d && !best; dy++) for (let dx = -d; dx <= d; dx++) { const x2 = sx + dx, y2 = sy + dy; if (x2 >= 0 && y2 >= 0 && x2 < W && y2 < H && okAt(y2 * W + x2)) { best = [x2, y2]; break; } }
        if (best) [sx, sy] = best;
      }
    } else rr = 0;
  }
  T('free', t0); t0 = performance.now();
  lastWhy = sx < 0 || sy < 0 || sx >= W || sy >= H || okAt(sy * W + sx) ? 'leak' : 'wall';
  if (lastWhy === 'wall') return null;
  // loang (4 hướng), nhớ khung bao; chạm mép lưới = tràn
  const mask = new Uint8Array(N), st = new Int32Array(N); let top = 0;
  let bx0 = sx, by0 = sy, bx1 = sx, by1 = sy;
  mask[sy * W + sx] = 1; st[top++] = sy * W + sx;
  while (top) {
    const i = st[--top], px = i % W, py = (i / W) | 0;
    if (px === 0 || py === 0 || px === W - 1 || py === H - 1) { T('flood', t0); return null; }
    if (px < bx0) bx0 = px; else if (px > bx1) bx1 = px; if (py < by0) by0 = py; else if (py > by1) by1 = py;
    let j = i - 1; if (!mask[j] && okAt(j)) { mask[j] = 1; st[top++] = j; }
    j = i + 1; if (!mask[j] && okAt(j)) { mask[j] = 1; st[top++] = j; }
    j = i - W; if (!mask[j] && okAt(j)) { mask[j] = 1; st[top++] = j; }
    j = i + W; if (!mask[j] && okAt(j)) { mask[j] = 1; st[top++] = j; }
  }
  lastWhy = 'small';
  T('flood', t0); t0 = performance.now();
  // phần việc còn lại chỉ trên khung con quanh vùng tô
  const m = rr + 3, cx0 = Math.max(0, bx0 - m), cy0 = Math.max(0, by0 - m), cx1 = Math.min(W - 1, bx1 + m), cy1 = Math.min(H - 1, by1 + m);
  const sw = cx1 - cx0 + 1, sh = cy1 - cy0 + 1, sm = new Uint8Array(sw * sh), sf = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) { const o = (y + cy0) * W + cx0, d = y * sw; for (let x = 0; x < sw; x++) { sm[d + x] = mask[o + x]; sf[d + x] = free[o + x]; } }
  if (rr) growMask(sm, sf, sw, sh, rr + 2);
  const contour = traceContour(sm, sw, sh);
  if (!contour || contour.length < 4) return null;
  const toW = (p) => view.toWorld((p[0] + cx0) * K + K / 2, (p[1] + cy0) * K + K / 2);
  const world = contour.map(toW);
  if (fine) { world.holes = maskHoles(sm, sw, sh).map((hc) => hc.map(toW)); T('trace', t0); return world; }
  let poly = G.rdp(world.concat([world[0]]), (1.5 * K) / view.scale);
  poly = poly.slice(0, -1);
  if (poly.length < 3 || G.area(poly) < 20) return null;
  return poly;
}

// Ô bị nét chặn (free=0) nở thêm r ô (lân cận 8) -> mảng free mới
export function thickenWalls(free, W, H, r) {
  const N = W * H, dist = new Uint8Array(N).fill(255), q = new Int32Array(N); let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (!free[i]) { dist[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], dd = dist[i] + 1; if (dd > r) continue;
    const px = i % W, py = (i / W) | 0;
    for (let oy = -1; oy <= 1; oy++) { const y = py + oy; if (y < 0 || y >= H) continue; for (let ox = -1; ox <= 1; ox++) { const x = px + ox; if (x < 0 || x >= W) continue; const j = y * W + x; if (dist[j] > dd) { dist[j] = dd; q[t++] = j; } } }
  }
  const out = new Uint8Array(N); for (let i = 0; i < N; i++) out[i] = dist[i] === 255 ? 1 : 0;
  return out;
}
// Nở vùng tô thêm r ô nhưng chỉ qua ô trống thật (không vượt nét)
export function growMask(mask, free, W, H, r) {
  const N = W * H, dist = new Uint8Array(N).fill(255), q = new Int32Array(N); let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (mask[i]) { dist[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], dd = dist[i] + 1; if (dd > r) continue;
    const px = i % W, py = (i / W) | 0;
    for (let oy = -1; oy <= 1; oy++) { const y = py + oy; if (y < 0 || y >= H) continue; for (let ox = -1; ox <= 1; ox++) { const x = px + ox; if (x < 0 || x >= W) continue; const j = y * W + x; if (free[j] && dist[j] > dd) { dist[j] = dd; mask[j] = 1; q[t++] = j; } } }
  }
  return mask;
}

// Các lỗ trong mặt nạ: thành phần không thuộc vùng tô, không thông ra ngoài -> danh sách biên (toạ độ lưới)
export function maskHoles(mask, W, H, maxHoles = 40) {
  const lab = new Int32Array(W * H); // 0 chưa xét, -1 bên ngoài, k>0 lỗ thứ k
  const st = [];
  const flood = (i0, k) => { st.length = 0; st.push(i0); lab[i0] = k; let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, edge = false;
    while (st.length) { const i = st.pop(); n++; const px = i % W, py = (i / W) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (px === 0 || py === 0 || px === W - 1 || py === H - 1) edge = true;
      if (px > 0 && !mask[i - 1] && !lab[i - 1]) { lab[i - 1] = k; st.push(i - 1); } if (px < W - 1 && !mask[i + 1] && !lab[i + 1]) { lab[i + 1] = k; st.push(i + 1); }
      if (py > 0 && !mask[i - W] && !lab[i - W]) { lab[i - W] = k; st.push(i - W); } if (py < H - 1 && !mask[i + W] && !lab[i + W]) { lab[i + W] = k; st.push(i + W); } }
    return { k, n, x0, y0, x1, y1, edge }; };
  // bên ngoài: mọi ô trống thông ra mép lưới
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!mask[i] && !lab[i]) flood(i, -1); }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (!mask[i] && !lab[i]) flood(i, -1); }
  const comps = [];
  for (let i = 0; i < W * H; i++) if (!mask[i] && !lab[i]) { const c = flood(i, comps.length + 1); if (!c.edge && c.n >= 6) comps.push(c); else comps.push(null); }
  const out = [];
  for (const c of comps.filter(Boolean).sort((a, b) => b.n - a.n).slice(0, maxHoles)) {
    const w = c.x1 - c.x0 + 3, h = c.y1 - c.y0 + 3, sub = new Uint8Array(w * h);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.k) sub[(y - c.y0 + 1) * w + (x - c.x0 + 1)] = 1;
    const ct = traceContour(sub, w, h); if (ct && ct.length >= 4) out.push(ct.map((p) => [p[0] + c.x0 - 1, p[1] + c.y0 - 1]));
  }
  return out;
}

// Trả về mặt nạ vùng tô, hoặc null nếu vùng chạm mép màn hình (chưa khép kín)
export function floodFill(free, W, H, sx, sy) {
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || !free[sy * W + sx]) return null;
  const mask = new Uint8Array(W * H);
  const stack = [sy * W + sx];
  mask[sy * W + sx] = 1;
  while (stack.length) {
    const i = stack.pop();
    const px = i % W, py = (i / W) | 0;
    if (px === 0 || py === 0 || px === W - 1 || py === H - 1) return null;
    for (const j of [i - 1, i + 1, i - W, i + W]) if (free[j] && !mask[j]) { mask[j] = 1; stack.push(j); }
  }
  return mask;
}

// Dò biên ngoài bằng thuật toán Moore-neighbor (theo chiều kim đồng hồ trên màn hình)
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export function traceContour(mask, W, H) {
  let start = -1;
  for (let i = 0; i < W * H; i++) if (mask[i]) { start = i; break; }
  if (start < 0) return null;
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  const sx = start % W, sy = (start / W) | 0;
  const out = [[sx, sy]];
  let cx = sx, cy = sy, dir = 0; // ô bên trái điểm bắt đầu chắc chắn trống
  // tìm hướng đầu tiên
  let guard = W * H * 4;
  let backtrack = 4; // đến từ phía Tây
  while (guard-- > 0) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (backtrack + k) % 8;
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (at(nx, ny)) {
        // hướng quay lui mới: từ ô mới nhìn về ô trống trước đó
        const px = cx + DIRS[(d + 7) % 8][0], py = cy + DIRS[(d + 7) % 8][1];
        cx = nx; cy = ny; dir = d;
        backtrack = dirIndex(px - cx, py - cy);
        found = true; break;
      }
    }
    if (!found) return out; // điểm đơn lẻ
    if (cx === sx && cy === sy) break;
    out.push([cx, cy]);
  }
  void dir;
  return out;
}
function dirIndex(dx, dy) {
  for (let i = 0; i < 8; i++) if (DIRS[i][0] === dx && DIRS[i][1] === dy) return i;
  return 4;
}

// Chỗ hở nhỏ: đầu mút của nét hở (nét CAD, nét nháp, nét khép kín nhưng chưa nối đầu cuối…) nằm cách
// một nét / mép khác (kể cả mép đường, mép sông, chính nó) không quá `tol` mét thì thêm một đoạn nối tạm.
let _gapC = null;
export function gapBridges(doc, tol, opts = {}) {
  const ck = [doc.id, doc.items.length, doc.updatedAt, tol, !!opts.land].join('|'); // nhớ đệm đến lần sửa bản vẽ sau
  if (_gapC && _gapC.k === ck) return _gapC.v;
  const v = gapBridges0(doc, tol, opts); _gapC = { k: ck, v }; return v;
}
function gapBridges0(doc, tol, opts) {
  const segs = [], ends = [];
  const add = (it, P, closed, off = 0) => { const n = P.length; for (let i = 0; i < (closed ? n : n - 1); i++) segs.push({ it, i, n, a: P[i], b: P[(i + 1) % n], off }); };
  for (const it of doc.items) {
    const P = it.pts; if (!P || P.length < 2) continue;
    if (it.kind === 'cad' || it.kind === 'sketch') {
      const closed = it.kind === 'cad' && !!it.closed; add(it, P, closed);
      if (!closed) { ends.push({ it, q: P[0], k: 0 }); ends.push({ it, q: P[P.length - 1], k: P.length - 1 }); }
    } else if (it.kind === 'road') add(it, P, false, roadTotalWidth(it) / 2);
    else if (it.kind === 'water') { if (it.props.mode === 'river') add(it, P, false, (it.props.width || 0) / 2); else add(it, P, true); }
    else if (it.kind === 'zone' || it.kind === 'cloud') add(it, P, true);
    else if (opts.land && (it.kind === 'building' || it.kind === 'park' || (it.kind === 'land' && LAND_CLOSED[it.props.style]))) add(it, P, true);
  }
  if (!ends.length) return [];
  // lưới băm theo ô để tìm nhanh
  const cs = Math.max(16, tol * 4), grid = new Map(), key = (x, y) => (x + 1048576) * 2097152 + (y + 1048576);
  segs.forEach((sg, k) => {
    const pad = tol + sg.off;
    const x0 = Math.floor((Math.min(sg.a[0], sg.b[0]) - pad) / cs), x1 = Math.floor((Math.max(sg.a[0], sg.b[0]) + pad) / cs);
    const y0 = Math.floor((Math.min(sg.a[1], sg.b[1]) - pad) / cs), y1 = Math.floor((Math.max(sg.a[1], sg.b[1]) + pad) / cs);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 20000) return; // đoạn quá dài so với ô: bỏ (hiếm)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const kk = key(x, y); const L = grid.get(kk); if (L) L.push(k); else grid.set(kk, [k]); }
  });
  const out = [];
  for (const e of ends) {
    const L = grid.get(key(Math.floor(e.q[0] / cs), Math.floor(e.q[1] / cs))); if (!L) continue;
    let best = null, bd = Infinity, touch = false;
    for (const k of L) {
      const sg = segs[k];
      if (sg.it === e.it && (sg.i === e.k || sg.i + 1 === e.k || (sg.i === e.k - 1))) continue; // đoạn liền kề của chính đầu mút
      const r = G.distToSegment(e.q, sg.a, sg.b); let d = r.d, q = r.q;
      if (sg.off) { if (r.d < 1e-9) continue; d = Math.abs(r.d - sg.off); const t = sg.off / r.d; q = [r.q[0] + (e.q[0] - r.q[0]) * t, r.q[1] + (e.q[1] - r.q[1]) * t]; if (r.d < sg.off) { touch = true; continue; } }
      if (d < 1e-3) {
        // nét trùng / chồng lên nét của chính đầu mút (DXF hay vẽ trùng): không coi là đã chạm
        const own = e.it.pts[e.k === 0 ? 1 : e.k - 1], ux = e.q[0] - own[0], uy = e.q[1] - own[1], vx = sg.b[0] - sg.a[0], vy = sg.b[1] - sg.a[1];
        const cr = Math.abs(ux * vy - uy * vx) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
        if (cr < 0.02) continue;
        touch = true; break;
      }
      if (d <= tol && d < bd) { bd = d; best = q; }
    }
    if (!touch && best) out.push([[e.q[0], e.q[1]], [best[0], best[1]]]);
  }
  return out;
}

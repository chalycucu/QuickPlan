// Cọ SDĐ: chia ô đất bằng nét cắt, mở rộng / nhập ô đất, hình dạng nét (tự do, gấp khúc, góc vuông)
import * as G from './geom.js';
import { floodFill, traceContour, snapToEdges } from './fill.js';

// ---------- Hình dạng nét ----------
// Nét hở bẻ góc vuông: hướng đoạn dài nhất làm trục, mọi đoạn theo trục hoặc vuông góc
export function orthoPath(pts) {
  if (pts.length < 2) return pts;
  let best = 0, ang = 0;
  for (let i = 1; i < pts.length; i++) { const d = G.dist(pts[i - 1], pts[i]); if (d > best) { best = d; ang = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]); } }
  const c = pts[0];
  const r = G.rotatePts(pts, -ang, c);
  const segs = [];
  for (let i = 1; i < r.length; i++) {
    const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1];
    const t = Math.abs(dx) >= Math.abs(dy) ? 'H' : 'V';
    const prev = segs[segs.length - 1];
    if (prev && prev.t === t) { prev.d += t === 'H' ? dx : dy; prev.end = r[i]; } else segs.push({ t, d: t === 'H' ? dx : dy, end: r[i] });
  }
  const out = [r[0].slice()];
  let cur = r[0].slice();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], last = i === segs.length - 1;
    // đoạn cuối kết thúc đúng toạ độ cuối theo trục của nó
    if (s.t === 'H') cur = [last ? s.end[0] : cur[0] + s.d, cur[1]]; else cur = [cur[0], last ? s.end[1] : cur[1] + s.d];
    out.push(cur.slice());
  }
  return G.rotatePts(out, ang, c);
}
// Áp hình dạng cho nét (closed: nét khép kín)
export function shapeStroke(pts, form, sc, closed) {
  const ring = (p) => (G.dist(p[0], p[p.length - 1]) < 1e-6 ? p.slice(0, -1) : p);
  if (form === 'poly') { const p = G.rdp(pts, 7 / sc); return closed ? ring(p) : p; }
  if (form === 'ortho') {
    if (closed) { const p = ring(G.rdp(pts, 5 / sc)); return p.length >= 3 ? G.orthogonalize(p) : p; }
    return orthoPath(G.rdp(pts, 6 / sc));
  }
  const p = G.rdp(pts, 1.5 / sc);
  return closed ? G.chaikin(ring(p), 1, true) : G.chaikin(p, 1, false);
}

// ---------- Chia ô đất bằng nét cắt ----------
function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: [a[0] + r[0] * t, a[1] + r[1] * t] };
}
const pathAt = (path, s) => { const k = Math.min(path.length - 2, Math.floor(s)), t = s - k; return [path[k][0] + (path[k + 1][0] - path[k][0]) * t, path[k][1] + (path[k + 1][1] - path[k][1]) * t]; };
// kéo dài hai đầu nét một chút để nét chạm mép vẫn cắt được
export function extendPath(path, d) {
  if (path.length < 2) return path;
  const ext = (a, b) => { const L = G.dist(a, b) || 1; return [a[0] + ((a[0] - b[0]) / L) * d, a[1] + ((a[1] - b[1]) / L) * d]; };
  return [ext(path[0], path[1]), ...path, ext(path[path.length - 1], path[path.length - 2])];
}
// Các đoạn cắt (chord) của nét đi qua đa giác: từ điểm vào tới điểm ra, phần giữa nằm trong đa giác
function chords(poly, path) {
  const hits = [];
  for (let k = 0; k < path.length - 1; k++) for (let e = 0; e < poly.length; e++) {
    const r = segInter(path[k], path[k + 1], poly[e], poly[(e + 1) % poly.length]);
    if (r) hits.push({ s: k + r.t, p: r.p });
  }
  hits.sort((a, b) => a.s - b.s);
  const H = hits.filter((h, i) => !i || h.s - hits[i - 1].s > 1e-9);
  const out = [];
  for (let i = 0; i < H.length - 1; i++) {
    const a = H[i], b = H[i + 1];
    if (G.dist(a.p, b.p) < 0.05) continue;
    if (!G.pointInPolygon(pathAt(path, (a.s + b.s) / 2), poly)) continue;
    const inner = [];
    for (let k = Math.floor(a.s) + 1; k <= Math.floor(b.s) && k < path.length; k++) if (k > a.s && k < b.s) inner.push(path[k]);
    out.push({ A: a.p, B: b.p, inner, mid: pathAt(path, (a.s + b.s) / 2) });
  }
  return out;
}
function insertOnRing(ring, p) {
  let best = -1, bd = Infinity, bt = 0;
  for (let i = 0; i < ring.length; i++) { const r = G.distToSegment(p, ring[i], ring[(i + 1) % ring.length]); if (r.d < bd) { bd = r.d; best = i; bt = r.t; } }
  if (bd > 0.01) return -1;
  if (bt < 1e-6 && G.dist(ring[best], p) < 1e-6) return best;
  const nx = (best + 1) % ring.length;
  if (G.dist(ring[nx], p) < 1e-6) return nx;
  ring.splice(best + 1, 0, p.slice());
  return best + 1;
}
function splitByChord(poly, c) {
  const R = poly.map((q) => q.slice());
  if (insertOnRing(R, c.A) < 0 || insertOnRing(R, c.B) < 0) return null;
  const iA = R.findIndex((q) => G.dist(q, c.A) < 1e-6), iB = R.findIndex((q) => G.dist(q, c.B) < 1e-6);
  if (iA < 0 || iB < 0 || iA === iB) return null;
  const walk = (from, to) => { const o = []; for (let i = from; ; i = (i + 1) % R.length) { o.push(R[i]); if (i === to) break; } return o; };
  const p1 = walk(iA, iB).concat(c.inner.slice().reverse());
  const p2 = walk(iB, iA).concat(c.inner);
  if (p1.length < 3 || p2.length < 3) return null;
  return [p1, p2];
}
// Trả về danh sách đa giác sau khi chia (1 phần tử nếu nét không cắt qua)
export function splitPolygon(poly, path) {
  let pieces = [poly.map((q) => q.slice())];
  for (const c of chords(poly, path)) {
    const i = pieces.findIndex((pc) => G.pointInPolygon(c.mid, pc));
    if (i < 0) continue;
    const r = splitByChord(pieces[i], c);
    if (r && Math.min(Math.abs(G.area(r[0])), Math.abs(G.area(r[1]))) > 1) pieces.splice(i, 1, ...r);
  }
  return pieces;
}

// ---------- Hợp / trừ đa giác (lưới điểm ảnh mịn rồi bám lại đúng cạnh gốc) ----------
// ops: [{ pts, add: true|false }] áp lần lượt; trả về các đa giác kết quả (lớn trước)
export function booleanPolys(ops, extraEdges = []) {
  const all = ops.flatMap((o) => o.pts);
  const b = G.bbox(all); const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const res = Math.max(0.04, span / 2000);
  const W = Math.ceil((b.x1 - b.x0) / res) + 8, H = Math.ceil((b.y1 - b.y0) / res) + 8;
  const ox = b.x0 - 4 * res, oy = b.y0 - 4 * res;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const path = (pts) => { x.beginPath(); pts.forEach((p, i) => { const X = (p[0] - ox) / res, Y = (p[1] - oy) / res; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.closePath(); };
  for (const o of ops) {
    path(o.pts); x.fillStyle = x.strokeStyle = o.add ? '#fff' : '#000'; x.lineWidth = o.add ? 1.2 : 0.6; x.fill(); x.stroke();
  }
  const img = x.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = img[i * 4] > 140 ? 1 : 0;
  const srcs = ops.map((o) => ({ pts: o.pts, closed: true, off: 0 })).concat(extraEdges);
  const out = [];
  for (let guard = 0; guard < 50; guard++) {
    let start = -1; for (let i = 0; i < W * H; i++) if (m[i]) { start = i; break; }
    if (start < 0) break;
    const comp = floodFill(m, W, H, start % W, (start / W) | 0) || floodAll(m, W, H, start);
    for (let i = 0; i < W * H; i++) if (comp[i]) m[i] = 0;
    const ct = traceContour(comp, W, H);
    if (!ct || ct.length < 4) continue;
    const world = ct.map((p) => [ox + (p[0] + 0.5) * res, oy + (p[1] + 0.5) * res]);
    const toPoly = (ct2) => { const wd = ct2.map((p) => [ox + (p[0] + 0.5) * res, oy + (p[1] + 0.5) * res]); const sn = snapToEdges(wd, srcs, res * 2.6); return G.rdp(sn.concat([sn[0]]), Math.min(0.05, res * 0.25)).slice(0, -1); };
    const poly = toPoly(ct);
    if (poly.length < 3 || Math.abs(G.area(poly)) <= 4) continue;
    // lỗ thủng bên trong (vùng trống không thông ra ngoài)
    const holes = [];
    const outside = floodAll(Uint8Array.from(comp, (v) => (v ? 0 : 1)), W, H, 0);
    const holeMask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (!comp[i] && !outside[i]) holeMask[i] = 1;
    for (let g2 = 0; g2 < 30; g2++) {
      let hs = -1; for (let i = 0; i < W * H; i++) if (holeMask[i]) { hs = i; break; }
      if (hs < 0) break;
      const hm = floodAll(holeMask, W, H, hs);
      for (let i = 0; i < W * H; i++) if (hm[i]) holeMask[i] = 0;
      const hc = traceContour(hm, W, H);
      if (hc && hc.length >= 4) { const hp = toPoly(hc); if (hp.length >= 3 && Math.abs(G.area(hp)) > 4) holes.push(hp); }
    }
    poly.holes = holes;
    poly.net = Math.abs(G.area(poly)) - holes.reduce((s2, q) => s2 + Math.abs(G.area(q)), 0);
    out.push(poly);
  }
  return out.sort((a, b2) => b2.net - a.net);
}
function floodAll(free, W, H, s) {
  const mask = new Uint8Array(W * H); const st = [s]; mask[s] = 1;
  while (st.length) { const i = st.pop(); const px = i % W; for (const j of [px > 0 ? i - 1 : -1, px < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && free[j] && !mask[j]) { mask[j] = 1; st.push(j); } }
  return mask;
}

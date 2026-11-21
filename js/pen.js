// Cọ vẽ (QP-18): nét / hình chuẩn từ nét bút, và các lệnh sửa: bo tròn, vát góc, cắt theo giới hạn.
import * as G from './geom.js';
import * as SH from './shapes.js';

// [mã, tên, biểu tượng svg 24×24]
export const PEN_SHAPES = [
  ['free', 'Đường tự do', '<path d="M3 15c2-6 4 2 6-3s3-6 5-2 3 5 7-1"/>'],
  ['organic', 'Đường cong hữu cơ', '<path d="M5 17c-3-5 1-12 7-11s9 5 6 9-6 1-8 4-3 1-5-2z"/>'],
  ['smooth', 'Đường tự do làm mượt', '<path d="M3 16c3-8 6-8 9-4s6 4 9-4"/>'],
  ['arc', 'Thẳng + cung tròn', '<path d="M3 19h7a8 8 0 0 0 8-8V4"/>'],
  ['line', 'Đường line', '<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/>'],
  ['pline', 'Polyline', '<path d="M3 18l5-9 5 6 4-10 4 4"/><circle cx="8" cy="9" r="1.3" fill="currentColor"/><circle cx="13" cy="15" r="1.3" fill="currentColor"/><circle cx="17" cy="5" r="1.3" fill="currentColor"/>'],
  ['curve', 'Đường cong', '<path d="M3 18C6 4 12 4 13 12s7 8 8-6"/>'],
  ['circle', 'Hình tròn', '<circle cx="12" cy="12" r="8"/>'],
  ['tri', 'Hình tam giác', '<path d="M12 4l8.5 15h-17z"/>'],
  ['rect', 'Hình chữ nhật', '<rect x="3.5" y="6" width="17" height="12" rx=".5"/>'],
  ['ellipse', 'Hình elip', '<ellipse cx="12" cy="12" rx="9" ry="5.5"/>'],
  ['penta', 'Ngũ giác', '<path d="M12 3.5l8.5 6.2-3.2 10H6.7l-3.2-10z"/>'],
];
export const PEN_OPS = [
  ['erase', 'Xoá', '<path d="M8.5 19.5h11M5 14.5l8-8 5 5-8 8H8z"/><path d="M9 10.5l5 5"/>'],
  ['trim', 'Cắt', '<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.5L20 16M8.2 15.5L20 8"/>'],
  ['fillet', 'Bo tròn theo bán kính', '<path d="M4 20V13a9 9 0 0 1 9-9h7"/><path d="M4 4v4M4 4h4" stroke-dasharray="1.5 2"/>'],
  ['chamfer', 'Tạo góc vát', '<path d="M4 20V10l6-6h10"/><path d="M4 4v4M4 4h4" stroke-dasharray="1.5 2"/>'],
  ['join', 'Bán kính cong nối 2 đối tượng', '<path d="M3 20h6a8 8 0 0 0 8-8V3" stroke-dasharray="0"/><path d="M3 20h3M17 3v3" stroke-width="3"/>'],
  ['offset', 'Offset (song song)', '<path d="M4 18L14 6"/><path d="M9 20l10-12" stroke-dasharray="2.5 2"/><path d="M16 15l2.5 1.5M16 15l1.5-2.5"/>'],
  ['extrude', 'Extrude khối', '<path d="M4 16l8 4 8-4-8-4z" fill="currentColor" fill-opacity=".14"/><path d="M12 12V3M9 6l3-3 3 3M4 16V11M20 16V11"/>'],
];
export const penName = (k) => ([...PEN_SHAPES, ...PEN_OPS].find((x) => x[0] === k) || [k, k])[1];
const CLOSED_ONLY = new Set(['circle', 'tri', 'rect', 'ellipse', 'penta']);
export const isClosedShape = (k) => CLOSED_ONLY.has(k);

const closeRing = (p) => (p.length > 1 && G.dist(p[0], p[p.length - 1]) < 1e-6 ? p.slice(0, -1) : p);
const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const polyPts = (c, r, n, a0) => Array.from({ length: n }, (_, i) => { const t = a0 + (i * 2 * Math.PI) / n; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]; });
function ellipsePts(c, rx, ry, ang, n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2, v = rot([rx * Math.cos(t), ry * Math.sin(t)], ang); out.push([c[0] + v[0], c[1] + v[1]]); }
  return out;
}
// hình chữ nhật bao nhỏ nhất (theo các cạnh của bao lồi) – hoặc theo hướng cho trước
function boxAt(pts, ang) {
  const r = pts.map((p) => rot(p, -ang));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { ang, x0, y0, x1, y1, area: (x1 - x0) * (y1 - y0), pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => rot(p, ang)) };
}
function minBox(pts, ang) {
  if (ang != null) return boxAt(pts, ang);
  const hull = G.convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; const bx = boxAt(hull, Math.atan2(b[1] - a[1], b[0] - a[0])); if (!best || bx.area < best.area) best = bx; }
  return best || boxAt(pts, 0);
}
// Hình học từ nét bút theo kiểu nét / hình đang chọn.
// Trả về { type: 'line', a, b } | { type: 'circle', c, r } | { type: 'poly', pts } (khép kín) | { type: 'open', pts, ctrl? } hoặc null.
// opt: { ang: hướng trục vẽ (rad) hoặc null, snap: (p) => p đã bắt điểm }
export function penGeom(shape, raw, sc, opt = {}) {
  const pts = raw.map((p) => [p[0], p[1]]);
  if (pts.length < 2) return null;
  if (opt.snap) { pts[0] = opt.snap(pts[0]); pts[pts.length - 1] = opt.snap(pts[pts.length - 1]); }
  const L = G.length(pts);
  if (L < 3 / sc && shape !== 'line') return null;
  const a = pts[0], b = pts[pts.length - 1];
  const closed = G.isClosedStroke(pts, 40, sc) && L > 40 / sc;
  const ang = opt.ang ?? null;
  switch (shape) {
    case 'free': {
      const q = G.rdp(pts, 0.8 / sc);
      if (closed) { const r = closeRing(q); return r.length >= 3 ? { type: 'poly', pts: r } : null; }
      return q.length >= 2 ? { type: 'open', pts: q } : null;
    }
    case 'organic': {
      const q = G.rdp(G.resample(pts, 3 / sc), 2 / sc);
      if (closed) { const r = closeRing(q); return r.length >= 3 ? { type: 'poly', pts: G.chaikin(r, 3, true) } : null; }
      return q.length >= 2 ? { type: 'open', pts: G.chaikin(q, 3, false) } : null;
    }
    case 'smooth': { // giữ dáng nét tay, làm trơn qua các điểm điều khiển
      const sm = G.chaikin(G.rdp(G.resample(pts, 3 / sc), 1.5 / sc), 2, false);
      const ctrl = G.rdp(sm, 7 / sc);
      if (ctrl.length < 2) return null;
      if (closed && ctrl.length >= 4) { const r = closeRing(ctrl); return { type: 'poly', pts: G.catmullRom(r, 8, true), ctrl: r }; }
      return { type: 'open', pts: ctrl.length > 2 ? G.catmullRom(ctrl, 8, false) : ctrl, ctrl };
    }
    case 'arc': { // đoạn thẳng + cung tròn bán kính chẵn
      const f = SH.fitRoad(pts, sc, opt.minR || 10);
      if (!f) return null;
      return { type: 'open', pts: SH.roadGeometry(f.pis, f.radii), pis: f.pis, radii: f.radii };
    }
    case 'line': return G.dist(a, b) * sc < 4 ? null : { type: 'line', a, b };
    case 'pline': {
      let q = G.rdp(pts, 9 / sc);
      if (closed) { q = closeRing(q); if (G.dist(q[0], q[q.length - 1]) < 30 / sc) q = q.slice(0, -1); return q.length >= 3 ? { type: 'poly', pts: q } : null; }
      return q.length >= 2 ? { type: 'open', pts: q } : null;
    }
    case 'curve': {
      const ctrl = G.rdp(G.resample(pts, 3 / sc), 10 / sc);
      if (ctrl.length < 2) return null;
      if (closed && ctrl.length >= 4) { const r = closeRing(ctrl); return { type: 'poly', pts: G.catmullRom(r, 10, true), ctrl: r }; }
      return { type: 'open', pts: ctrl.length > 2 ? G.catmullRom(ctrl, 10, false) : ctrl, ctrl };
    }
    case 'circle': {
      if (closed) { const f = SH.fitCircle(pts); return f.r * sc > 3 ? { type: 'circle', c: f.c, r: nice(f.r) } : null; }
      const r = G.dist(a, b); return r * sc > 3 ? { type: 'circle', c: a, r: nice(r) } : null; // kéo từ tâm ra
    }
    case 'rect': {
      if (closed) { const bx = minBox(G.rdp(pts, 1 / sc), ang); return bx.area > 0.5 ? { type: 'poly', pts: bx.pts } : null; }
      const bx = boxAt([a, b], ang || 0); return bx.area > 0.5 ? { type: 'poly', pts: bx.pts } : null; // kéo theo đường chéo
    }
    case 'ellipse': {
      let c, rx, ry, an;
      if (closed) { // trục chính theo hướng trải dài nhất của nét
        const bx = minBox(G.rdp(pts, 1 / sc), ang);
        c = rot([(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2], bx.ang); rx = (bx.x1 - bx.x0) / 2; ry = (bx.y1 - bx.y0) / 2; an = bx.ang;
      } else { const bx = boxAt([a, b], ang || 0); c = rot([(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2], bx.ang); rx = (bx.x1 - bx.x0) / 2; ry = (bx.y1 - bx.y0) / 2; an = bx.ang; }
      return rx * ry > 0.2 ? { type: 'poly', pts: ellipsePts(c, rx, ry, an), ellipse: { c, rx, ry, ang: an } } : null;
    }
    case 'tri': {
      if (closed) { // tam giác diện tích lớn nhất trên bao lồi của nét
        const hull = G.convexHull(G.rdp(pts, 1 / sc)); let best = null;
        for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) for (let k = j + 1; k < hull.length; k++) { const t = [hull[i], hull[j], hull[k]], ar = G.area(t); if (!best || ar > best.ar) best = { t, ar }; }
        return best && best.ar > 0.5 ? { type: 'poly', pts: best.t } : null;
      }
      const bx = boxAt([a, b], ang || 0); const P = bx.pts; // tam giác cân trong khung kéo
      const top = [(P[2][0] + P[3][0]) / 2, (P[2][1] + P[3][1]) / 2];
      return bx.area > 0.5 ? { type: 'poly', pts: [P[0], P[1], top] } : null;
    }
    case 'penta': {
      let c, r, a0;
      if (closed) { const f = SH.fitCircle(pts); c = f.c; r = f.r; a0 = ang != null ? ang - Math.PI / 2 : Math.atan2(a[1] - c[1], a[0] - c[0]); }
      else { c = a; r = G.dist(a, b); a0 = Math.atan2(b[1] - a[1], b[0] - a[0]); } // kéo từ tâm tới một đỉnh
      return r * sc > 3 ? { type: 'poly', pts: polyPts(c, r, 5, a0) } : null;
    }
  }
  return null;
}
const nice = (r) => (r > 20 ? Math.round(r) : Math.round(r * 2) / 2);
// điểm của hình học (khép kín: không lặp điểm đầu)
export function geomPts(g) {
  if (!g) return [];
  if (g.type === 'line') return [g.a, g.b];
  if (g.type === 'circle') return SH.circlePts(g.c, g.r);
  return g.pts;
}
export const geomClosed = (g) => !!g && (g.type === 'circle' || g.type === 'poly');

// ---------- Bo tròn / vát góc tại một đỉnh ----------
// P: dãy đỉnh, i: chỉ số đỉnh, closed: đa giác khép kín. Trả về dãy đỉnh mới hoặc null nếu không làm được.
function cornerFrame(P, i, closed) {
  const n = P.length;
  if (!closed && (i <= 0 || i >= n - 1)) return null;
  const A = P[(i - 1 + n) % n], B = P[i], C = P[(i + 1) % n];
  const la = G.dist(A, B), lc = G.dist(B, C); if (la < 1e-6 || lc < 1e-6) return null;
  const u = [(A[0] - B[0]) / la, (A[1] - B[1]) / la], v = [(C[0] - B[0]) / lc, (C[1] - B[1]) / lc];
  const th = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))); // góc trong tại đỉnh
  if (th < 0.02 || th > Math.PI - 0.02) return null; // thẳng hàng
  return { A, B, C, la, lc, u, v, th };
}
export function filletAt(P, i, closed, R) {
  const f = cornerFrame(P, i, closed); if (!f) return null;
  let t = R / Math.tan(f.th / 2); // khoảng từ đỉnh tới tiếp điểm
  const tmax = Math.min(f.la, f.lc) * (closed ? 0.5 : 0.98);
  if (t > tmax) { t = tmax; R = t * Math.tan(f.th / 2); }
  if (R < 1e-3) return null;
  const T1 = [f.B[0] + f.u[0] * t, f.B[1] + f.u[1] * t], T2 = [f.B[0] + f.v[0] * t, f.B[1] + f.v[1] * t];
  const bis = [f.u[0] + f.v[0], f.u[1] + f.v[1]], bl = Math.hypot(bis[0], bis[1]);
  const dO = R / Math.sin(f.th / 2), O = [f.B[0] + (bis[0] / bl) * dO, f.B[1] + (bis[1] / bl) * dO];
  let a0 = Math.atan2(T1[1] - O[1], T1[0] - O[0]), a1 = Math.atan2(T2[1] - O[1], T2[0] - O[0]);
  let sw = a1 - a0; while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
  const m = Math.max(4, Math.ceil(Math.abs(sw) / 0.1)), arc = [];
  for (let k = 0; k <= m; k++) { const a = a0 + (sw * k) / m; arc.push([O[0] + R * Math.cos(a), O[1] + R * Math.sin(a)]); }
  return { pts: [...P.slice(0, i), ...arc, ...P.slice(i + 1)], R, n: arc.length };
}
export function chamferAt(P, i, closed, d) {
  const f = cornerFrame(P, i, closed); if (!f) return null;
  const dmax = Math.min(f.la, f.lc) * (closed ? 0.5 : 0.98); d = Math.min(d, dmax);
  if (d < 1e-3) return null;
  const T1 = [f.B[0] + f.u[0] * d, f.B[1] + f.u[1] * d], T2 = [f.B[0] + f.v[0] * d, f.B[1] + f.v[1] * d];
  return { pts: [...P.slice(0, i), T1, T2, ...P.slice(i + 1)], d, tri: [T1, f.B, T2] };
}

// ---------- Cắt đa giác theo đường thẳng giới hạn (bỏ nửa chứa điểm chạm) ----------
export function halfPlanePoly(a, b, w, R) {
  const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]); if (L < 1e-9) return null;
  const u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
  const s = Math.sign(n[0] * (w[0] - a[0]) + n[1] * (w[1] - a[1])) || 1;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p0 = [m[0] - u[0] * R, m[1] - u[1] * R], p1 = [m[0] + u[0] * R, m[1] + u[1] * R];
  return [p0, p1, [p1[0] + n[0] * s * R, p1[1] + n[1] * s * R], [p0[0] + n[0] * s * R, p0[1] + n[1] * s * R]];
}
// Cắt đa giác lồi / lõm bởi đường thẳng: trả về các phần phía không chứa w (Sutherland–Hodgman một nửa mặt phẳng; đa giác lõm có thể nối)
export function clipPolyKeep(P, a, b, w) {
  const d = [b[0] - a[0], b[1] - a[1]];
  const side = (p) => d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0]);
  const sw = side(w); if (Math.abs(sw) < 1e-12) return null;
  const keep = (p) => side(p) * sw < 0;
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], kp = keep(p), kq = keep(q);
    if (kp) out.push(p);
    if (kp !== kq) { const sp = side(p), sq = side(q), t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out.length >= 3 ? out : [];
}

// ---------- Đơn vị thước đo ----------
export const UNITS = { mm: ['mm', 1000], cm: ['cm', 100], m: ['m', 1], km: ['km', 0.001] };
export function fmtLen(m, unit = 'm') {
  const [u, k] = UNITS[unit] || UNITS.m, v = m * k;
  const d = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3;
  return v.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 }) + ' ' + u;
}

// ---------- QP-19: cắt theo đối tượng giới hạn, offset, bán kính cong nối 2 đối tượng ----------
function segX(p, q, a, b) { // giao 2 đoạn: t trên pq, u trên ab
  const r = [q[0] - p[0], q[1] - p[1]], d = [b[0] - a[0], b[1] - a[1]], den = r[0] * d[1] - r[1] * d[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den, u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { t, p: [p[0] + r[0] * t, p[1] + r[1] * t] } : null;
}
// nét giới hạn: nét mở được kéo dài hai đầu (ext m), nét khép kín giữ nguyên
export function limitPath(L, closed, ext = 5000) {
  const P = L.map((q) => [q[0], q[1]]);
  if (closed) return G.dist(P[0], P[P.length - 1]) < 1e-6 ? P : P.concat([P[0]]);
  if (P.length < 2) return P;
  const e = (a, b) => { const l = G.dist(a, b) || 1; return [a[0] + ((a[0] - b[0]) / l) * ext, a[1] + ((a[1] - b[1]) / l) * ext]; };
  return [e(P[0], P[1]), ...P, e(P[P.length - 1], P[P.length - 2])];
}
// Chia nét mở P tại các giao điểm với nét giới hạn; bỏ khúc gần điểm chạm w. null: không giao.
export function cutPathBy(P, lim, w) {
  const pieces = [[P[0].slice(0, 2)]];
  for (let k = 0; k < P.length - 1; k++) {
    const p = P[k], q = P[k + 1], xs = [];
    for (let j = 0; j < lim.length - 1; j++) { const r = segX(p, q, lim[j], lim[j + 1]); if (r) xs.push(r); }
    xs.sort((a, b) => a.t - b.t);
    for (const x of xs) { pieces[pieces.length - 1].push(x.p); pieces.push([x.p]); }
    pieces[pieces.length - 1].push(q.slice(0, 2));
  }
  if (pieces.length < 2) return null;
  let bi = 0, bd = Infinity;
  pieces.forEach((pc, i) => { const r = G.distToPolyline(w, pc, false).d; if (r < bd) { bd = r; bi = i; } });
  return pieces.filter((pc, i) => i !== bi && pc.length >= 2 && G.length(pc) > 0.05);
}
// Offset nét mở về phía điểm chạm
export function offsetOpen(P, d, w) {
  const s = G.offsetSides(P.map((q) => [q[0], q[1]]), d);
  return G.distToPolyline(w, s.L, false).d <= G.distToPolyline(w, s.R, false).d ? s.L : s.R;
}
// Offset đa giác: ra ngoài nếu chạm ngoài, vào trong nếu chạm trong
export function offsetClosed(P, d, w) {
  const Q = P.map((q) => [q[0], q[1]]);
  const a = G.offsetPolygon(Q, d), b = G.offsetPolygon(Q, -d);
  const big = Math.abs(G.area(a)) >= Math.abs(G.area(b)) ? a : b, small = big === a ? b : a;
  return G.pointInPolygon(w, Q) ? small : big;
}
// Bán kính cong R nối đoạn (a1,b1) và (a2,b2), về phía hai điểm chạm w1, w2 (như lệnh FILLET).
// Trả về { X, T1, T2, arc } (T1, T2: tiếp điểm, arc: các điểm cung từ T1 tới T2) hoặc null.
export function joinArc(a1, b1, w1, a2, b2, w2, R) {
  const d1 = [b1[0] - a1[0], b1[1] - a1[1]], d2 = [b2[0] - a2[0], b2[1] - a2[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den, X = [a1[0] + d1[0] * t, a1[1] + d1[1] * t];
  const pr = (a, b, w) => { const l = G.dist(a, b), u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; const s = (w[0] - X[0]) * u[0] + (w[1] - X[1]) * u[1]; return s >= 0 ? u : [-u[0], -u[1]]; };
  const u1 = pr(a1, b1, w1), u2 = pr(a2, b2, w2);
  const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])), th = Math.acos(cos);
  if (th < 0.02 || th > Math.PI - 0.02) return null;
  const k = R / Math.tan(th / 2), T1 = [X[0] + u1[0] * k, X[1] + u1[1] * k], T2 = [X[0] + u2[0] * k, X[1] + u2[1] * k];
  const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = Math.hypot(bis[0], bis[1]), hc = R / Math.sin(th / 2);
  const C = [X[0] + (bis[0] / bl) * hc, X[1] + (bis[1] / bl) * hc];
  let A0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), A1 = Math.atan2(T2[1] - C[1], T2[0] - C[0]), dA = A1 - A0;
  while (dA > Math.PI) dA -= 2 * Math.PI; while (dA < -Math.PI) dA += 2 * Math.PI;
  const n = Math.max(6, Math.ceil(Math.abs(dA) / 0.12)), arc = [];
  for (let i = 0; i <= n; i++) { const a = A0 + (dA * i) / n; arc.push([C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]); }
  arc[0] = T1; arc[n] = T2;
  return { X, T1, T2, C, arc, k };
}
// Cắt / kéo dài nét mở P (đoạn gần chạm thứ i) tới tiếp điểm T, giữ phía có điểm chạm w. Trả về { pts, atEnd } (atEnd: T ở cuối nét)
export function trimToPoint(P, i, T, X, w) {
  const a = P[i], b = P[i + 1], u = [b[0] - a[0], b[1] - a[1]], l2 = u[0] * u[0] + u[1] * u[1] || 1;
  const sT = ((X[0] - a[0]) * u[0] + (X[1] - a[1]) * u[1]) / l2, sW = ((w[0] - a[0]) * u[0] + (w[1] - a[1]) * u[1]) / l2;
  if (sW <= sT) return { pts: P.slice(0, i + 1).map((q) => [q[0], q[1]]).concat([T.slice()]), atEnd: true }; // giữ phần đầu nét, T thành điểm cuối
  return { pts: [T.slice()].concat(P.slice(i + 1).map((q) => [q[0], q[1]])), atEnd: false };
}

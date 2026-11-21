// Trục vẽ (lưới trục 90° / 45°, xoay được) và bắt điểm (đầu / cuối, trung điểm, tâm tròn, vuông góc)
import * as G from './geom.js';

const D2R = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// hướng gần nhất trong các hướng cho phép: base + k * step
export function snapDir(dir, base, step) { return base + Math.round((dir - base) / step) * step; }

function lineX(p1, d1, p2, d2) {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-6) return null;
  const w = [p2[0] - p1[0], p2[1] - p1[1]];
  const t = (w[0] * d2[1] - w[1] * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}
const proj = (p, c, d) => { const t = (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1]; return [c[0] + d[0] * t, c[1] + d[1] * t]; };

// Nắn đường gấp khúc / đa giác theo trục: mỗi cạnh xoay về hướng trục gần nhất (qua trung điểm cạnh),
// cạnh liền nhau cùng hướng gộp làm một, đỉnh mới là giao của các cạnh liền kề.
// baseRad: góc trục (rad), stepDeg: 90 hoặc 45. Trả về mảng điểm mới (không lặp điểm đầu ở cuối).
export function axisSnapPts(pts, closed, baseRad, stepDeg = 90) {
  const step = stepDeg * D2R;
  const P = pts.map((p) => [p[0], p[1]]);
  if (closed && P.length > 2 && G.dist(P[0], P[P.length - 1]) < 1e-6) P.pop();
  const n = P.length; if (n < 2) return pts.map((p) => [p[0], p[1]]);
  let E = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = P[i], b = P[(i + 1) % n], L = G.dist(a, b); if (L < 1e-6) continue;
    E.push({ a, b, L, ang: snapDir(Math.atan2(b[1] - a[1], b[0] - a[0]), baseRad, step) });
  }
  const same = (x, y) => Math.abs(wrap(x - y)) < 1e-6, opp = (x, y) => Math.abs(Math.abs(wrap(x - y)) - Math.PI) < 1e-6;
  const merge = () => {
    const M = [];
    for (const e of E) { const l = M[M.length - 1]; if (l && same(l.ang, e.ang)) { l.b = e.b; l.L += e.L; } else M.push({ ...e }); }
    if (closed && M.length > 1 && same(M[0].ang, M[M.length - 1].ang)) { const l = M.pop(); M[0].a = l.a; M[0].L += l.L; }
    return M;
  };
  E = merge();
  // bỏ «gai» (hai cạnh liền nhau ngược chiều): bỏ cạnh ngắn hơn
  for (let guard = 0; guard < 50; guard++) {
    const m = E.length; let k = -1;
    for (let i = 0; i < (closed ? m : m - 1); i++) if (opp(E[i].ang, E[(i + 1) % m].ang)) { k = E[i].L < E[(i + 1) % m].L ? i : (i + 1) % m; break; }
    if (k < 0) break;
    E.splice(k, 1); E = merge();
    if (E.length < (closed ? 3 : 1)) return P;
  }
  const lines = E.map((e) => ({ c: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], d: [Math.cos(e.ang), Math.sin(e.ang)], e }));
  const m = lines.length, out = [];
  if (closed) {
    if (m < 3) return P;
    for (let i = 0; i < m; i++) { const A = lines[(i - 1 + m) % m], B = lines[i]; out.push(lineX(A.c, A.d, B.c, B.d) || proj(B.e.a, B.c, B.d)); }
    if (G.area(out) < 1e-6) return P;
  } else {
    out.push(proj(lines[0].e.a, lines[0].c, lines[0].d));
    for (let i = 1; i < m; i++) { const A = lines[i - 1], B = lines[i]; out.push(lineX(A.c, A.d, B.c, B.d) || proj(B.e.a, B.c, B.d)); }
    out.push(proj(lines[m - 1].e.b, lines[m - 1].c, lines[m - 1].d));
  }
  return out;
}

// Góc của cạnh gần điểm w nhất (để «căn trục theo đối tượng»), trả về rad hoặc null
export function edgeAngleAt(items, w, tol) {
  let best = null, bd = tol;
  for (const it of items) {
    const P = it.kind === 'road' && it.props && it.props.pis ? it.props.pis : it.pts;
    if (!P || P.length < 2) continue;
    const b = G.bbox(P); if (w[0] < b.x0 - tol || w[0] > b.x1 + tol || w[1] < b.y0 - tol || w[1] > b.y1 + tol) continue;
    const closed = ['building', 'zone', 'park', 'cloud', 'cover', 'land', 'water'].includes(it.kind);
    for (let i = 0; i < P.length - (closed ? 0 : 1); i++) {
      const a = P[i], c = P[(i + 1) % P.length]; const r = G.distToSegment(w, a, c);
      if (r.d < bd && G.dist(a, c) > 1e-6) { bd = r.d; best = Math.atan2(c[1] - a[1], c[0] - a[0]); }
    }
  }
  return best;
}
// đưa góc về [0, step)
export function normAxis(rad, stepDeg = 90) { const s = stepDeg * D2R; let a = rad % s; if (a < 0) a += s; if (s - a < 1e-6) a = 0; return a; }

// ---------- Bắt điểm ----------
const POLY_KINDS = new Set(['building', 'zone', 'park', 'cloud', 'cover', 'land', 'water', 'facet']);
// Các điểm bắt quanh w: { q, type: 'end' | 'mid' | 'center' | 'perp' }
// prev: điểm trước đó (để bắt vuông góc); skip: id đối tượng bỏ qua
export function osnap(items, w, tol, prev = null, skip = null) {
  let best = null, bd = tol;
  const consider = (q, type, bias = 1) => { const d = G.dist(q, w) * bias; if (d < bd) { bd = d; best = { q: [q[0], q[1]], type }; } };
  for (const it of items) {
    if (it.id === skip || it.kind === 'facet' || it.kind === 'icon') continue;
    if (it.kind === 'circle') { const c = it.pts[0], r = (it.props && it.props.radius) || 0; if (Math.abs(G.dist(c, w) - r) < tol * 3 || G.dist(c, w) < tol) consider(c, 'center', 0.9); continue; }
    const ring = it.props && it.props.ring;
    if (ring && ring.c) consider(ring.c, 'center', 0.9);
    const P = it.kind === 'road' && it.props && it.props.pis ? it.props.pis : it.pts;
    if (!P || !P.length) continue;
    const b = G.bbox(P); if (w[0] < b.x0 - tol || w[0] > b.x1 + tol || w[1] < b.y0 - tol || w[1] > b.y1 + tol) continue;
    const closed = POLY_KINDS.has(it.kind) && !(it.kind === 'water' && it.props.mode === 'river') && !(it.kind === 'land' && it.props.style === 'row');
    const n = P.length, m = closed ? n : n - 1;
    if (it.kind === 'sketch' && n > 40) { consider(P[0], 'end', 0.8); consider(P[n - 1], 'end', 0.8); continue; } // nét tay nhiều điểm: chỉ hai đầu
    for (let i = 0; i < n; i++) consider(P[i], 'end', 0.8);
    for (let i = 0; i < m; i++) {
      const a = P[i], c = P[(i + 1) % n];
      consider([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], 'mid', 0.9);
      if (prev) { // chân đường vuông góc hạ từ điểm trước xuống cạnh
        const L2 = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2; if (L2 < 1e-9) continue;
        const t = ((prev[0] - a[0]) * (c[0] - a[0]) + (prev[1] - a[1]) * (c[1] - a[1])) / L2;
        if (t > 0.001 && t < 0.999) consider([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t], 'perp', 1);
      }
    }
  }
  return best;
}
export const OSNAP_NAMES = { end: 'Điểm đầu / cuối', mid: 'Trung điểm', center: 'Tâm', perp: 'Vuông góc' };
// Vẽ dấu bắt điểm trên canvas (toạ độ màn hình)
export function drawOsnapMark(ctx, s, type) {
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#db2777'; ctx.fillStyle = 'rgba(219,39,119,0.15)';
  const r = 7; ctx.beginPath();
  if (type === 'end') ctx.rect(s[0] - r, s[1] - r, 2 * r, 2 * r);
  else if (type === 'mid') { ctx.moveTo(s[0], s[1] - r - 1); ctx.lineTo(s[0] + r + 1, s[1] + r); ctx.lineTo(s[0] - r - 1, s[1] + r); ctx.closePath(); }
  else if (type === 'center') { ctx.arc(s[0], s[1], r, 0, 7); ctx.moveTo(s[0] - 3, s[1]); ctx.lineTo(s[0] + 3, s[1]); ctx.moveTo(s[0], s[1] - 3); ctx.lineTo(s[0], s[1] + 3); }
  else { ctx.moveTo(s[0] - r, s[1] + r); ctx.lineTo(s[0] + r, s[1] + r); ctx.moveTo(s[0] - r, s[1] + r); ctx.lineTo(s[0] - r, s[1] - r); ctx.moveTo(s[0] - r, s[1]); ctx.lineTo(s[0], s[1]); ctx.lineTo(s[0], s[1] + r); }
  ctx.fill(); ctx.stroke();
  ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = '#9d174d'; ctx.fillText(OSNAP_NAMES[type] || '', s[0] + r + 5, s[1] - r - 2);
  ctx.restore();
}
// Lưới trục trên màn hình 2D: các đường mảnh theo hướng trục
export function drawAxisGrid(ctx, view, baseRad, stepDeg) {
  const W = view.w, H = view.h, cx = W / 2, cy = H / 2, R = Math.hypot(W, H);
  const rot = view.rot || 0; // toạ độ màn hình = thế giới xoay thêm rot
  const sp = 90;
  ctx.save(); ctx.lineWidth = 1;
  const dirs = stepDeg === 45 ? [0, 45, 90, 135] : [0, 90];
  for (const dd of dirs) {
    const a = baseRad + dd * D2R + rot, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const diag = dd % 90 !== 0;
    ctx.strokeStyle = diag ? 'rgba(124,58,237,0.10)' : 'rgba(37,99,235,0.13)';
    for (let k = -Math.ceil(R / sp); k <= Math.ceil(R / sp); k++) {
      if (diag && k !== 0) continue;
      const ox = cx + nx * k * sp, oy = cy + ny * k * sp;
      ctx.beginPath(); ctx.moveTo(ox - ux * R, oy - uy * R); ctx.lineTo(ox + ux * R, oy + uy * R); ctx.stroke();
    }
    ctx.strokeStyle = diag ? 'rgba(124,58,237,0.35)' : 'rgba(37,99,235,0.35)'; ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(cx - ux * R, cy - uy * R); ctx.lineTo(cx + ux * R, cy + uy * R); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

// Chỉ giới xây dựng, giữ công trình trong khoảng lùi, bắt điểm khi di chuyển, xoay song song đường.
import * as G from './geom.js';
import { roadTotalWidth, applyPreset } from './model.js';

// Đường chỉ giới xây dựng của ô đất (đa giác thu vào theo khoảng lùi)
export function buildLine(zone) {
  const sb = zone.props.setback || 0;
  if (sb <= 0 || zone.pts.length < 3) return null;
  const inner = G.offsetPolygon(zone.pts, -sb);
  if (G.area(inner) < 1 || Math.sign(G.signedArea(inner)) !== Math.sign(G.signedArea(zone.pts))) return null;
  return inner;
}
export function zoneOf(doc, it) {
  const c = G.centroid(it.pts);
  return doc.items.filter((z) => z.kind === 'zone').reverse().find((z) => G.pointInPolygon(c, z.pts)) || null;
}
const allIn = (pts, poly) => pts.every((p) => G.pointInPolygon(p, poly) || G.distToPolyline(p, poly, true).d < 0.02);
export function insideBuildLine(doc, it) {
  const z = zoneOf(doc, it); if (!z) return true;
  const bl = buildLine(z); if (!bl) return true;
  return allIn(it.pts, bl);
}

export function translateItem(it, dx, dy) {
  it.pts = G.translatePts(it.pts, dx, dy);
  if (it.holes) it.holes = it.holes.map((h) => G.translatePts(h, dx, dy));
  if (it.props.preset) { it.props.preset.cx += dx; it.props.preset.cy += dy; }
}
export function rotateItem(it, ang, c = G.centroid(it.pts)) {
  if (it.props.preset) {
    const pr = it.props.preset;
    const nc = G.rotatePts([[pr.cx, pr.cy]], ang, c)[0];
    pr.cx = nc[0]; pr.cy = nc[1]; pr.rot = (pr.rot || 0) + ang; applyPreset(it);
  } else {
    it.pts = G.rotatePts(it.pts, ang, c);
    if (it.holes) it.holes = it.holes.map((h) => G.rotatePts(h, ang, c));
  }
}

// Đẩy công trình vào trong chỉ giới (tịnh tiến). Trả về false nếu không vừa.
export function pushInside(doc, it, zone) {
  const z = zone || zoneOf(doc, it); if (!z) return true;
  const bl = buildLine(z); if (!bl) return true;
  for (let k = 0; k < 12; k++) {
    let worst = null;
    for (const p of it.pts) {
      if (G.pointInPolygon(p, bl)) continue;
      const q = G.distToPolyline(p, bl, true);
      if (!worst || q.d > worst.d) worst = { d: q.d, v: [q.q[0] - p[0], q.q[1] - p[1]] };
    }
    if (!worst) return true;
    const L = Math.hypot(worst.v[0], worst.v[1]) || 1;
    translateItem(it, worst.v[0] + (worst.v[0] / L) * 0.05, worst.v[1] + (worst.v[1] / L) * 0.05);
  }
  return allIn(it.pts, bl);
}
// Kéo các đỉnh nằm ngoài chỉ giới về sát chỉ giới (dùng cho công trình vẽ tay)
export function clipInside(doc, it) {
  const z = zoneOf(doc, it); if (!z) return false;
  const bl = buildLine(z); if (!bl) return false;
  let changed = false;
  it.pts = it.pts.map((p) => { if (G.pointInPolygon(p, bl)) return p; changed = true; return G.distToPolyline(p, bl, true).q; });
  return changed;
}

// Bắt điểm: đỉnh công trình hút vào đỉnh/cạnh đối tượng gần (công trình khác, chỉ giới, mép đường)
export function snapVector(doc, it, tol) {
  const vtx = [], segs = [];
  for (const o of doc.items) {
    if (o.id === it.id) continue;
    if (o.kind === 'building') { vtx.push(...o.pts); segs.push(o.pts.concat([o.pts[0]])); }
    else if (o.kind === 'zone') { const bl = buildLine(o); const ring = bl || o.pts; vtx.push(...ring); segs.push(ring.concat([ring[0]])); }
    else if (o.kind === 'road') { const s = G.offsetSides(o.pts, roadTotalWidth(o) / 2); segs.push(s.L, s.R); }
  }
  let best = null;
  for (const p of it.pts) {
    for (const v of vtx) { const d = G.dist(p, v); if (d < tol && (!best || d < best.d - 1e-9 || (best.kind === 'e' && d < tol * 0.7))) best = { d, v: [v[0] - p[0], v[1] - p[1]], kind: 'v' }; }
  }
  if (!best) for (const p of it.pts) for (const s of segs) {
    const q = G.distToPolyline(p, s);
    if (q.d < tol && (!best || q.d < best.d)) best = { d: q.d, v: [q.q[0] - p[0], q.q[1] - p[1]], kind: 'e' };
  }
  return best ? best.v : null;
}

// Góc cần xoay thêm để cạnh dài nhất song song với đường gần nhất (null nếu không có đường)
export function parallelDelta(doc, it, maxDeg = 8, force = false) {
  const c = G.centroid(it.pts);
  let best = null;
  for (const r of doc.items.filter((i) => i.kind === 'road')) {
    const q = G.distToPolyline(c, r.pts);
    if (!best || q.d < best.d) best = { d: q.d, a: r.pts[q.i], b: r.pts[q.i + 1] };
  }
  if (!best || !best.b) return null;
  const ra = Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]);
  let L = 0, ba = 0;
  for (let i = 0; i < it.pts.length; i++) {
    const a = it.pts[i], b = it.pts[(i + 1) % it.pts.length];
    const d = G.dist(a, b); if (d > L) { L = d; ba = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  let diff = ra - ba;
  diff = ((diff % (Math.PI / 2)) + Math.PI * 2.5) % (Math.PI / 2);
  if (diff > Math.PI / 4) diff -= Math.PI / 2;
  if (!force && Math.abs(diff) > (maxDeg * Math.PI) / 180) return null;
  return diff;
}

// Cọ đường (QP-17): phân loại đường, tạo đường theo nét line / polyline, cắt đường, góc vát vỉa hè và bán kính bó vỉa tại giao lộ.
import * as G from './geom.js';
import { roadTotalWidth, cadInert } from './model.js';

// Cấp đường / loại đường (QCVN 01:2021) và mặt cắt mặc định: lòng đường, vỉa hè mỗi bên (m)
export const ROAD_LEVELS = { dt: 'Cấp đô thị', kv: 'Cấp khu vực', nb: 'Cấp nội bộ' };
export const ROAD_CLASSES = [
  { id: 1, lvl: 'dt', name: 'Đường cao tốc đô thị', width: 22.5, sidewalk: 8 },
  { id: 2, lvl: 'dt', name: 'Đường trục chính đô thị', width: 21, sidewalk: 10 },
  { id: 3, lvl: 'dt', name: 'Đường chính đô thị', width: 15, sidewalk: 8 },
  { id: 4, lvl: 'dt', name: 'Đường liên khu vực', width: 15, sidewalk: 7 },
  { id: 5, lvl: 'kv', name: 'Đường chính khu vực', width: 11.25, sidewalk: 6 },
  { id: 6, lvl: 'kv', name: 'Đường khu vực', width: 10.5, sidewalk: 5 },
  { id: 7, lvl: 'nb', name: 'Đường phân khu vực', width: 7.5, sidewalk: 4 },
  { id: 8, lvl: 'nb', name: 'Đường nhóm nhà ở, vào nhà', width: 5.5, sidewalk: 3 },
  { id: 9, lvl: 'nb', name: 'Đường xe đạp', width: 3, sidewalk: 1 },
  { id: 10, lvl: 'nb', name: 'Đường đi bộ', width: 3, sidewalk: 0, ped: true },
];
export const roadClass = (id) => ROAD_CLASSES.find((c) => c.id === id) || null;

// ---------- giao lộ ----------
const segInt = (a, b, c, d) => { // giao hai đoạn thẳng (kể cả chạm đầu mút)
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
};
const lineInt = (p, d, q, e) => { const den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-9) return null; const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den; return [p[0] + d[0] * t, p[1] + d[1] * t]; };
const carRoads = (doc) => doc.items.filter((i) => i.kind === 'road' && !i.props.ped && i.pts && i.pts.length >= 2);

// Các điểm giao giữa tim các tuyến đường (đường cắt nhau, đầu đường chạm tim đường khác)
export function junctionPoints(doc, near = null) {
  const R = carRoads(doc), out = [];
  const inNear = (p) => !near || (p[0] >= near.x0 && p[0] <= near.x1 && p[1] >= near.y0 && p[1] <= near.y1);
  const bbs = R.map((r) => G.bbox(r.pts));
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const A = bbs[i], B = bbs[j];
    if (A.x1 < B.x0 - 1 || B.x1 < A.x0 - 1 || A.y1 < B.y0 - 1 || B.y1 < A.y0 - 1) continue;
    const P = R[i].pts, Q = R[j].pts;
    for (let a = 0; a < P.length - 1; a++) for (let b = 0; b < Q.length - 1; b++) { const x = segInt(P[a], P[a + 1], Q[b], Q[b + 1]); if (x && inNear(x)) out.push(x); }
    for (const [X, Y] of [[P, Q], [Q, P]]) for (const e of [X[0], X[X.length - 1]]) if (inNear(e) && G.distToPolyline(e, Y, false).d < 0.6) out.push(e.slice(0, 2));
  }
  const uniq = [];
  for (const p of out) if (!uniq.some((q) => G.dist(p, q) < 1.5)) uniq.push(p);
  return uniq;
}

// Các nhánh đường toả ra từ giao lộ c: hướng, nửa lòng đường, nửa bề rộng (cả vỉa hè)
export function junctionArms(doc, c) {
  const arms = [];
  for (const r of carRoads(doc)) {
    const P = r.pts;
    let best = null;
    for (let k = 0; k < P.length - 1; k++) { const q = G.distToSegment(c, P[k], P[k + 1]); if (!best || q.d < best.d) best = { d: q.d, k, q: q.q }; }
    if (!best || best.d > Math.max(0.6, r.props.width * 0.25)) continue;
    const hw = r.props.width / 2, ht = roadTotalWidth(r) / 2, D = Math.max(4, ht);
    // đi dọc tim theo hai phía một đoạn D để lấy hướng nhánh
    const walk = (dir) => {
      let pos = best.q, k = best.k, left = D, last = null;
      for (let guard = 0; guard < 10000; guard++) {
        const nxt = dir > 0 ? P[k + 1] : P[k];
        if (!nxt) break;
        const L = G.dist(pos, nxt);
        if (L >= left) { const t = left / L; last = [pos[0] + (nxt[0] - pos[0]) * t, pos[1] + (nxt[1] - pos[1]) * t]; break; }
        left -= L; pos = nxt; last = nxt; k += dir; if (k < 0 || k >= P.length - 1) break;
      }
      return last && G.dist(last, best.q) > 1 ? last : null;
    };
    for (const dir of [1, -1]) {
      const e = walk(dir); if (!e) continue;
      const L = G.dist(e, c); if (L < 1e-6) continue;
      const d = [(e[0] - c[0]) / L, (e[1] - c[1]) / L];
      arms.push({ d, ang: Math.atan2(d[1], d[0]), hw, ht, road: r.id });
    }
  }
  arms.sort((a, b) => a.ang - b.ang);
  return arms.filter((a, i) => !arms.slice(0, i).some((b) => Math.abs(Math.atan2(Math.sin(a.ang - b.ang), Math.cos(a.ang - b.ang))) < 0.09));
}

// Giá trị góc vát V / bán kính R của một góc: góc riêng (khớp theo hướng phân giác) hoặc giá trị chung của giao lộ
export function cornerVal(j, bis) {
  const cs = (j.props.cs || []).find((x) => Math.abs(Math.atan2(Math.sin(x.ang - bis), Math.cos(x.ang - bis))) < 0.35);
  return { V: cs && cs.V != null ? cs.V : j.props.V || 0, R: cs && cs.R != null ? cs.R : j.props.R || 0 };
}

// Hình học các góc giao lộ: mảng vát vỉa hè (tam giác) và mảng bo lòng đường (bán kính R)
export function junctionCorners(doc, j) {
  const c = j.pts[0], arms = junctionArms(doc, c), out = [];
  const n = arms.length; if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const a = arms[i], b = arms[(i + 1) % n];
    let dA = b.ang - a.ang; if (dA <= 0) dA += Math.PI * 2;
    if (dA > Math.PI * 0.97 || dA < 0.15) continue; // gần thẳng hàng: không có góc
    const na = [-a.d[1], a.d[0]], nb = [b.d[1], -b.d[0]]; // pháp tuyến hướng vào góc
    const off = (arm, nn, w) => [c[0] + nn[0] * w, c[1] + nn[1] * w];
    const bisAng = a.ang + dA / 2, bis = [Math.cos(bisAng), Math.sin(bisAng)];
    const { V, R } = cornerVal(j, bisAng);
    const P = lineInt(off(a, na, a.hw), a.d, off(b, nb, b.hw), b.d); // góc bó vỉa
    const Q = lineInt(off(a, na, a.ht), a.d, off(b, nb, b.ht), b.d); // góc mép ngoài vỉa hè
    if (!P || !Q) continue;
    const cor = { bisAng, bis, P, Q, V, R, label: [Q[0] + bis[0] * Math.max(6, a.ht * 0.6), Q[1] + bis[1] * Math.max(6, a.ht * 0.6)] };
    if (V > 0.01) cor.chamfer = [Q, [Q[0] + a.d[0] * V, Q[1] + a.d[1] * V], [Q[0] + b.d[0] * V, Q[1] + b.d[1] * V]];
    if (R > 0.01) {
      const O = lineInt(off(a, na, a.hw + R), a.d, off(b, nb, b.hw + R), b.d);
      if (O) {
        const Ta = [O[0] - na[0] * R, O[1] - na[1] * R], Tb = [O[0] - nb[0] * R, O[1] - nb[1] * R];
        let a0 = Math.atan2(Ta[1] - O[1], Ta[0] - O[0]), a1 = Math.atan2(Tb[1] - O[1], Tb[0] - O[0]);
        let sw = a1 - a0; while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
        const m = Math.max(6, Math.ceil(Math.abs(sw) / 0.08)), arc = [];
        for (let k = 0; k <= m; k++) { const t = a0 + (sw * k) / m; arc.push([O[0] + R * Math.cos(t), O[1] + R * Math.sin(t)]); }
        cor.fillet = [P, ...arc];
        cor.curb = arc;
      }
    }
    out.push(cor);
  }
  return out;
}

// ---------- cắt đường, nét gần nhất ----------
// Đoạn thẳng (cạnh) gần điểm chạm nhất của mọi đối tượng (kể cả mép đường, tim đường)
export function nearestEdge(doc, w, tol, kinds = null) {
  let best = null;
  const test = (it, P, closed) => {
    const n = P.length; if (n < 2) return;
    for (let k = 0; k < (closed ? n : n - 1); k++) { const a = P[k], b = P[(k + 1) % n], q = G.distToSegment(w, a, b); if (q.d <= tol && (!best || q.d < best.d)) best = { it, a: [a[0], a[1]], b: [b[0], b[1]], d: q.d, P, closed }; }
  };
  for (const it of doc.items) {
    if (!it.pts || it.pts.length < 2 || (kinds && !kinds.includes(it.kind)) || cadInert(doc, it)) continue;
    if (it.kind === 'road') {
      test(it, it.pts, false);
      if (!kinds || kinds.includes('road-edge')) { const s = G.offsetSides(it.pts, roadTotalWidth(it) / 2); test(it, s.L, false); test(it, s.R, false); }
    } else if (it.kind === 'water' && it.props.mode === 'river') { const s = G.offsetSides(it.pts, it.props.width / 2); test(it, s.L, false); test(it, s.R, false); }
    else test(it, it.pts, ['zone', 'building', 'park', 'cover', 'cloud', 'facet'].includes(it.kind) || (it.kind === 'water') || !!it.closed);
  }
  return best;
}
// Cắt tim đường theo đường thẳng giới hạn (qua a, b): bỏ phần đường chứa điểm chạm, tính tới đường giới hạn.
// Trả về danh sách các đoạn tim còn lại (0, 1 hoặc 2 đoạn), hoặc null nếu đường không cắt đường giới hạn.
export function cutRoadPts(P, a, b, w) {
  const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]); if (L < 1e-9) return null;
  const side = (p) => (d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0])) / L;
  // chia tim thành các khúc tại các điểm cắt đường giới hạn
  const pieces = [[P[0].slice(0, 2)]];
  for (let k = 0; k < P.length - 1; k++) {
    const p = P[k], q = P[k + 1], sp = side(p), sq = side(q);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) { const t = sp / (sp - sq), x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; pieces[pieces.length - 1].push(x); pieces.push([x]); }
    pieces[pieces.length - 1].push(q.slice(0, 2));
  }
  if (pieces.length < 2) return null;
  let bi = 0, bd = Infinity;
  pieces.forEach((pc, i) => { const r = G.distToPolyline(w, pc, false).d; if (r < bd) { bd = r; bi = i; } });
  return pieces.filter((pc, i) => i !== bi && pc.length >= 2 && G.length(pc) > 0.5);
}

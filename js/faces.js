// Mặt khối: hệ toạ độ chung cho mọi mặt (mái, mặt đứng của công trình; mặt đầu, mặt bên của mảng đã kéo, lồng nhiều cấp),
// nét vẽ trên mặt (đoạn thẳng, chữ nhật, tròn, đa giác) và tự chia mặt thành các mảng (đa giác) khi nét khép kín.
import * as G from './geom.js';
import { bldElev, bldHeight } from './model.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// pháp tuyến ngoài (2D) của cạnh i của đa giác
export function edgeNormal(P, i) {
  const a = P[i], b = P[(i + 1) % P.length];
  const L = G.dist(a, b) || 1; let n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
  const m = [(a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01];
  if (G.pointInPolygon(m, P)) n = [-n[0], -n[1]];
  return n;
}
function mkFrame(o, U, V, N, base, holes, extra) {
  return {
    o, U, V, N, base, holes: holes || [], ...extra,
    pt(q, off = 0) { return add(add(add(o, mul(U, q[0])), mul(V, q[1])), mul(N, off)); },
    loc(P) { const r = sub(P, o); return [dot(r, U), dot(r, V)]; },
  };
}
// Hệ toạ độ của mặt `face` thuộc đối tượng `pid` (công trình hoặc mảng). Toạ độ điểm 3D: [x, cao, y bản vẽ]
// wa = true: mặt nằm ngang gắn với toạ độ bản vẽ (mái công trình và mặt đầu các mảng trên mái)
export function frameOf(byId, pid, face, depthGuard = 0) {
  const p = byId.get(pid); if (!p || depthGuard > 12) return null;
  if (p.kind === 'building') {
    if (!p.pts || p.pts.length < 3) return null;
    const y0 = bldElev(p, byId), H = bldHeight(p);
    if (face === 'top') return mkFrame([0, y0 + H, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], p.pts, p.holes || [], { wa: true, item: p, face, H, depth: H });
    const P = p.pts; if (!(face >= 0 && face < P.length)) return null;
    const a = P[face], c = P[(face + 1) % P.length], L = G.dist(a, c) || 1, n = edgeNormal(P, face);
    return mkFrame([a[0], y0, a[1]], [(c[0] - a[0]) / L, 0, (c[1] - a[1]) / L], [0, 1, 0], [n[0], 0, n[1]], [[0, 0], [L, 0], [L, H], [0, H]], [], { wa: false, item: p, face, L, H });
  }
  if (p.kind !== 'facet') return null;
  const F0 = frameOf(byId, p.props.parent, p.props.face, depthGuard + 1); if (!F0) return null;
  const d = p.props.depth || 0, poly = p.props.poly;
  if (!poly || poly.length < 3) return null;
  if (face === 'top') return mkFrame(add(F0.o, mul(F0.N, d)), F0.U, F0.V, F0.N, poly, p.props.holes || [], { wa: F0.wa, item: p, face, depth: d });
  if (Math.abs(d) < 0.05 || !(face >= 0 && face < poly.length)) return null;
  const a = poly[face], c = poly[(face + 1) % poly.length];
  const A = F0.pt(a), C = F0.pt(c), L = Math.hypot(...sub(C, A)) || 1;
  const n2 = edgeNormal(poly, face); let N = unit(add(mul(F0.U, n2[0]), mul(F0.V, n2[1])));
  if (d < 0) N = mul(N, -1);
  return mkFrame(A, unit(sub(C, A)), mul(F0.N, Math.sign(d)), N, [[0, 0], [L, 0], [L, Math.abs(d)], [0, Math.abs(d)]], [], { wa: false, item: p, face, L, H: Math.abs(d) });
}
// góc trục ngang của mặt (để vẽ góc vuông, đo khoảng cách): mặt nằm ngang theo cạnh dài nhất, mặt đứng theo cạnh đáy
export function axisAngle(F) {
  if (!F) return 0;
  if (Math.abs(F.N[1]) < 0.9) return 0;
  const P = F.base; let best = 0, bl = -1;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], l = G.dist(a, b); if (l > bl) { bl = l; best = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
  return best;
}
export const rot = (q, a) => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];

// ---------- Nét vẽ trên mặt ----------
// sk = { lines: [{ id, a, b, ext }], shapes: [{ id, type: 'rect'|'circle'|'poly', ... }] }
export function shapePoly(s) {
  if (s.type === 'rect') {
    const a = s.ang || 0, hw = s.w / 2, hh = s.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map((q) => { const r = rot(q, a); return [r[0] + s.cx, r[1] + s.cy]; });
  }
  if (s.type === 'circle') { const n = Math.max(24, Math.min(64, Math.round(s.r * 8))); return Array.from({ length: n }, (_, i) => [s.cx + s.r * Math.cos((i / n) * Math.PI * 2), s.cy + s.r * Math.sin((i / n) * Math.PI * 2)]); }
  return s.pts || [];
}
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
// đoạn thẳng "kéo dài tới cạnh": giới hạn bởi cạnh gần nhất ở hai phía điểm giữa
function chord(a, b, segs) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = G.dist(a, b); if (L < 1e-6) return [a, b];
  const r = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let lo = -Infinity, hi = Infinity;
  for (const s of segs) {
    const p = s.a, sv = [s.b[0] - p[0], s.b[1] - p[1]], den = cross(r, sv);
    if (Math.abs(den) < 1e-9) continue;
    const w = [p[0] - m[0], p[1] - m[1]];
    const t = cross(w, sv) / den, u = cross(w, r) / den;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    if (t > 1e-4 && t < hi) hi = t; if (t < -1e-4 && t > lo) lo = t;
  }
  return [isFinite(lo) ? [m[0] + r[0] * lo, m[1] + r[1] * lo] : a, isFinite(hi) ? [m[0] + r[0] * hi, m[1] + r[1] * hi] : b];
}
// danh sách đoạn: cạnh bao (src b), cạnh hình, đoạn thẳng (đã kéo dài tới cạnh nếu ext)
export function resolveSegs(F, sk) {
  const segs = [];
  const ring = (P, src) => { for (let i = 0; i < P.length; i++) segs.push({ a: P[i], b: P[(i + 1) % P.length], src }); };
  ring(F.base, 'b'); for (const h of F.holes || []) ring(h, 'b');
  for (const s of (sk && sk.shapes) || []) { const P = shapePoly(s); if (s.type === 'path') { for (let i = 0; i + 1 < P.length; i++) segs.push({ a: P[i], b: P[i + 1], src: 's:' + s.id }); } else if (P.length >= 3) ring(P, 's:' + s.id); }
  for (const l of (sk && sk.lines) || []) {
    const [a, b] = l.ext ? chord(l.a, l.b, segs) : [l.a, l.b];
    l.r = [a, b];
    if (G.dist(a, b) > 1e-4) segs.push({ a, b, src: 'l:' + l.id });
  }
  return segs;
}
// Đồ thị phẳng: tách đoạn tại giao điểm, gộp đỉnh gần nhau, bỏ đoạn treo, dò các vùng kín
export function arrangement(F, segs, tol = 0.02) {
  const n = segs.length, params = segs.map(() => [0, 1]);
  for (let i = 0; i < n; i++) {
    const p = segs[i].a, r = [segs[i].b[0] - p[0], segs[i].b[1] - p[1]], Li = Math.hypot(r[0], r[1]) || 1;
    for (let j = i + 1; j < n; j++) {
      const q = segs[j].a, s = [segs[j].b[0] - q[0], segs[j].b[1] - q[1]], Lj = Math.hypot(s[0], s[1]) || 1;
      const den = cross(r, s), w = [q[0] - p[0], q[1] - p[1]];
      if (Math.abs(den) > 1e-9 * Li * Lj) {
        const t = cross(w, s) / den, u = cross(w, r) / den, di = tol / Li, dj = tol / Lj;
        if (t >= -di && t <= 1 + di && u >= -dj && u <= 1 + dj) { params[i].push(Math.min(1, Math.max(0, t))); params[j].push(Math.min(1, Math.max(0, u))); }
      } else if (Math.abs(cross(w, r)) / Li < tol) { // thẳng hàng: chiếu đầu mút lên nhau
        for (const e of [segs[j].a, segs[j].b]) { const t = ((e[0] - p[0]) * r[0] + (e[1] - p[1]) * r[1]) / (Li * Li); if (t > 0 && t < 1) params[i].push(t); }
        for (const e of [segs[i].a, segs[i].b]) { const u = ((e[0] - q[0]) * s[0] + (e[1] - q[1]) * s[1]) / (Lj * Lj); if (u > 0 && u < 1) params[j].push(u); }
      }
    }
  }
  const nodes = [], grid = new Map();
  const nodeOf = (x, y) => {
    const gx = Math.round(x / tol), gy = Math.round(y / tol);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of grid.get((gx + dx) + ',' + (gy + dy)) || []) if (Math.hypot(nodes[k][0] - x, nodes[k][1] - y) < tol) return k;
    const k = nodes.length; nodes.push([x, y]); const key = gx + ',' + gy; (grid.get(key) || grid.set(key, []).get(key)).push(k); return k;
  };
  const emap = new Map(), edges = [];
  for (let i = 0; i < n; i++) {
    const s = segs[i], ps = [...new Set(params[i].map((t) => Math.round(t * 1e7) / 1e7))].sort((x, y) => x - y);
    let prev = null;
    for (const t of ps) {
      const k = nodeOf(s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t);
      if (prev != null && prev !== k) {
        const key = Math.min(prev, k) + '-' + Math.max(prev, k);
        let e = emap.get(key); if (!e) { e = { u: prev, v: k, srcs: [] }; emap.set(key, e); edges.push(e); }
        if (!e.srcs.includes(s.src)) e.srcs.push(s.src);
      }
      prev = k;
    }
  }
  // bỏ đoạn treo (một đầu không nối gì)
  const deg = new Array(nodes.length).fill(0); for (const e of edges) { deg[e.u]++; deg[e.v]++; }
  let changed = true;
  while (changed) { changed = false; for (const e of edges) if (!e.dang && (deg[e.u] === 1 || deg[e.v] === 1)) { e.dang = true; deg[e.u]--; deg[e.v]--; changed = true; } }
  const live = edges.filter((e) => !e.dang);
  const adj = nodes.map(() => []);
  for (const e of live) { adj[e.u].push(e.v); adj[e.v].push(e.u); }
  const ang = (a, b) => Math.atan2(nodes[b][1] - nodes[a][1], nodes[b][0] - nodes[a][0]);
  adj.forEach((l, i) => l.sort((x, y) => ang(i, x) - ang(i, y)));
  // thành phần liên thông
  const comp = new Array(nodes.length).fill(-1); let nc = 0;
  for (let i = 0; i < nodes.length; i++) if (comp[i] < 0 && adj[i].length) { const st = [i]; comp[i] = nc; while (st.length) { const x = st.pop(); for (const y of adj[x]) if (comp[y] < 0) { comp[y] = nc; st.push(y); } } nc++; }
  const seen = new Set(), cycles = [];
  for (const e of live) for (const [u0, v0] of [[e.u, e.v], [e.v, e.u]]) {
    if (seen.has(u0 + '>' + v0)) continue;
    const cyc = []; let u = u0, v = v0, guard = 0;
    while (guard++ < 100000) {
      seen.add(u + '>' + v); cyc.push(u);
      const l = adj[v], i = l.indexOf(u), w = l[(i - 1 + l.length) % l.length];
      u = v; v = w;
      if (u === u0 && v === v0) break;
    }
    const pts = cyc.map((k) => nodes[k]);
    cycles.push({ pts, area: G.signedArea(pts), comp: comp[u0] });
  }
  const bnode = F.base.length ? nodeOf(F.base[0][0], F.base[0][1]) : -1;
  const outerComp = bnode >= 0 ? comp[bnode] : -1;
  const faces = cycles.filter((c) => c.area > 1e-6).map((c) => ({ poly: c.pts, holes: [], comp: c.comp, A: c.area }));
  for (const c of cycles) {
    if (c.area >= -1e-6 || c.comp === outerComp) continue;
    let best = null;
    for (const f of faces) if (f.comp !== c.comp && f.A > -c.area && G.pointInPolygon(c.pts[0], f.poly) && (!best || f.A < best.A)) best = f;
    if (best) best.holes.push(c.pts);
  }
  // giữ các vùng nằm trên mặt (bỏ vùng khép kín ngoài mép mặt)
  const inBase = (q) => G.pointInPolygon(q, F.base) && !(F.holes || []).some((h) => G.pointInPolygon(q, h));
  const regions = [];
  for (const f of faces) {
    // bỏ lỗ là chính các vùng con nằm trong (đã có vùng riêng) – vẫn giữ làm lỗ để mảng ngoài không phủ lên
    const ip = interiorPoint(f.poly, f.holes); if (!ip || !inBase(ip)) continue;
    regions.push({ poly: f.poly, holes: f.holes, ip, area: f.A - f.holes.reduce((s, h) => s + Math.abs(G.signedArea(h)), 0) });
  }
  const shown = edges.filter((e) => !(e.srcs.length && e.srcs.every((s) => s === 'b'))).filter((e) => inBase([(nodes[e.u][0] + nodes[e.v][0]) / 2, (nodes[e.u][1] + nodes[e.v][1]) / 2]))
    .map((e) => ({ a: nodes[e.u], b: nodes[e.v], dang: !!e.dang, srcs: e.srcs.filter((s) => s !== 'b'), u: e.u, v: e.v }));
  return { regions, edges: shown, nodes, all: edges };
}
// một điểm chắc chắn nằm trong đa giác (có lỗ)
export function interiorPoint(poly, holes = []) {
  const c = G.centroid(poly);
  const inside = (q) => G.pointInPolygon(q, poly) && !holes.some((h) => G.pointInPolygon(q, h));
  if (inside(c)) return c;
  const bb = G.bbox(poly), rings = [poly, ...holes];
  let best = null, bw = 0;
  for (let k = 1; k < 16; k++) {
    const y = bb.y0 + ((bb.y1 - bb.y0) * k) / 16, xs = [];
    for (const R of rings) for (let i = 0; i < R.length; i++) { const a = R[i], b = R[(i + 1) % R.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])); }
    xs.sort((x, y2) => x - y2);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { const q = [(xs[i] + xs[i + 1]) / 2, y]; if (inside(q)) { bw = xs[i + 1] - xs[i]; best = q; } }
  }
  return best;
}
const sigOf = (F, sk) => JSON.stringify([F.base, F.holes, sk.lines.map((l) => [l.a, l.b, l.ext]), sk.shapes.map((s) => [s.type, s.cx, s.cy, s.w, s.h, s.r, s.ang, s.pts])]);
export const getSk = (it, face, create) => {
  const s = it.props.sk && it.props.sk[face];
  if (s || !create) return s || null;
  it.props.sk = it.props.sk || {}; return (it.props.sk[face] = { lines: [], shapes: [] });
};
export const faceFacets = (doc, pid, face) => doc.items.filter((f) => f.kind === 'facet' && f.props.parent === pid && f.props.face === face);

// footprint 2D của một mảng (để chọn, xoá, vẽ 2D)
export function footprint(F, f) {
  const poly = f.props.poly;
  if (F.wa) return poly.map((q) => { const w = F.pt(q); return [w[0], w[2]]; });
  const dd = f.props.depth || 0, d = Math.abs(dd) < 0.4 ? (dd < 0 ? -0.4 : 0.4) : dd;
  const P = [];
  for (const q of poly) for (const k of [0, d]) { const w = F.pt(q, k); P.push([w[0], w[2]]); }
  const hull = G.convexHull(P);
  return hull.length >= 3 ? hull : P.slice(0, 3);
}
// biến đổi (xoay + tịnh tiến) các dữ liệu gắn toạ độ bản vẽ của một công trình khi công trình bị dời / xoay
function transformWA(doc, b, T) {
  const tp = (q) => T(q);
  const tsk = (sk) => {
    if (!sk) return;
    for (const l of sk.lines) { l.a = tp(l.a); l.b = tp(l.b); }
    for (const s of sk.shapes) {
      if (s.type === 'poly' || s.type === 'path') s.pts = s.pts.map(tp);
      else { const c = tp([s.cx, s.cy]); s.cx = c[0]; s.cy = c[1]; if (s.type === 'rect') s.ang = (s.ang || 0) + T.da; }
    }
  };
  tsk(getSk(b, 'top'));
  const ids = new Set([b.id]); let grow = true;
  while (grow) { grow = false; for (const f of doc.items) if (f.kind === 'facet' && ids.has(f.props.parent) && f.props.face === 'top' && !ids.has(f.id)) { ids.add(f.id); grow = true; f.props.poly = f.props.poly.map(tp); if (f.props.holes) f.props.holes = f.props.holes.map((h) => h.map(tp)); tsk(getSk(f, 'top')); } }
}
// Đồng bộ toàn bộ mặt khối: dọn mảng mồ côi, theo dõi công trình bị dời, dựng lại các mảng từ nét vẽ
export function syncFaces(doc, newFacet) {
  const hasAny = doc.items.some((i) => i.kind === 'facet' || (i.props && i.props.sk));
  if (!hasAny) return;
  let byId = new Map(doc.items.map((i) => [i.id, i]));
  // 1) công trình bị dời / xoay: kéo theo nét và mảng trên mái
  for (const b of doc.items) {
    if (b.kind !== 'building' || !b.pts || b.pts.length < 3) continue;
    const has = getSk(b, 'top') || doc.items.some((f) => f.kind === 'facet' && f.props.parent === b.id && f.props.face === 'top');
    if (!has) { delete b.props.skRef; continue; }
    const P = b.pts, a = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]);
    const lens = P.map((p, i) => G.dist(p, P[(i + 1) % P.length])).map((x) => Math.round(x * 100) / 100).join(',');
    const R = b.props.skRef;
    if (R && R.lens === lens && (G.dist(R.p, P[0]) > 1e-6 || Math.abs(R.a - a) > 1e-7)) {
      const da = a - R.a;
      const T = (q) => { const r = rot([q[0] - R.p[0], q[1] - R.p[1]], da); return [r[0] + P[0][0], r[1] + P[0][1]]; }; T.da = da;
      transformWA(doc, b, T);
    }
    b.props.skRef = { p: P[0].slice(), a, lens };
  }
  // 2) dọn mảng mồ côi (lặp vì mảng lồng nhiều cấp)
  for (let pass = 0; pass < 12; pass++) {
    byId = new Map(doc.items.map((i) => [i.id, i]));
    const n0 = doc.items.length;
    doc.items = doc.items.filter((f) => {
      if (f.kind !== 'facet') return true;
      const par = byId.get(f.props.parent);
      if (!par || (par.kind !== 'building' && par.kind !== 'facet')) return false;
      if (!f.props.poly && f.pts) f.props.poly = f.pts.map((q) => q.slice()); // bản cũ: mảng mái lưu ở pts
      return !!frameOf(byId, f.props.parent, f.props.face) && f.props.poly && f.props.poly.length >= 3;
    });
    if (doc.items.length === n0) break;
  }
  // 3) các mặt cần dựng lại: mặt có nét vẽ, mặt có mảng (bản cũ chưa có nét: tạo nét từ mảng)
  const faceSet = new Map();
  for (const it of doc.items) {
    if (it.props && it.props.sk) for (const k of Object.keys(it.props.sk)) faceSet.set(it.id + '|' + k, [it, k === 'top' ? 'top' : +k]);
    if (it.kind === 'facet') { const p = byId.get(it.props.parent); if (p) faceSet.set(p.id + '|' + it.props.face, [p, it.props.face]); }
  }
  for (const [, [p, face]] of faceSet) {
    byId = new Map(doc.items.map((i) => [i.id, i]));
    const F = frameOf(byId, p.id, face); if (!F) continue;
    let sk = getSk(p, face);
    const old = faceFacets(doc, p.id, face);
    if (!sk) { // bản cũ: mỗi mảng thành một đa giác nét vẽ
      sk = getSk(p, face, true);
      let k = 0; for (const f of old) sk.shapes.push({ id: 'm' + k++, type: 'poly', pts: f.props.poly.map((q) => q.slice()) });
    }
    const sig = sigOf(F, sk);
    if (sk._sig === sig && sk._edges) { for (const f of old) f.pts = footprint(F, f); continue; }
    const { regions, edges } = arrangement(F, resolveSegs(F, sk));
    sk._sig = sig;
    sk._edges = edges.map((e) => ({ a: e.a, b: e.b, dang: e.dang, srcs: e.srcs }));
    const need = regions.length >= 2 || old.some((f) => Math.abs(f.props.depth || 0) > 0.05 || f.props.color);
    const keep = new Set(), out = [];
    if (need) {
      regions.sort((x, y) => y.area - x.area);
      for (const r of regions) {
        let m = null;
        for (const f of old) if (G.pointInPolygon(r.ip, f.props.poly) && !(f.props.holes || []).some((h) => G.pointInPolygon(r.ip, h)) && (!m || Math.abs(G.area(f.props.poly)) < Math.abs(G.area(m.props.poly)))) m = f;
        let it;
        if (m && !keep.has(m.id)) { it = m; keep.add(m.id); }
        else { it = newFacet({ parent: p.id, face, depth: m ? m.props.depth || 0 : 0 }); if (m && m.props.color) it.props.color = m.props.color; it.layer = p.layer; }
        it.props.poly = r.poly.map((q) => q.slice()); it.props.holes = r.holes.map((h) => h.map((q) => q.slice()));
        if (!it.props.holes.length) delete it.props.holes;
        it.pts = footprint(F, it);
        out.push(it);
      }
    }
    const outIds = new Set(out.map((f) => f.id));
    doc.items = doc.items.filter((f) => !(f.kind === 'facet' && f.props.parent === p.id && f.props.face === face && !outIds.has(f.id)));
    for (const f of out) if (!doc.items.includes(f)) doc.items.push(f);
  }
  // 4) mảng con mất cha sau khi dựng lại
  for (let pass = 0; pass < 12; pass++) {
    byId = new Map(doc.items.map((i) => [i.id, i]));
    const n0 = doc.items.length;
    doc.items = doc.items.filter((f) => f.kind !== 'facet' || (byId.has(f.props.parent) && frameOf(byId, f.props.parent, f.props.face)));
    if (doc.items.length === n0) break;
  }
}

// ---------- Xoá / cắt nét ----------
// nét (thuộc nguồn) gần điểm q nhất trên mặt: trả về { src, edge }
export function nearestEdge(sk, q, tol) {
  let best = null, bd = tol;
  for (const e of (sk && sk._edges) || []) { const d = G.distToSegment(q, e.a, e.b).d; if (d < bd && e.srcs.length) { bd = d; best = e; } }
  return best;
}
// đổi một hình / đoạn kéo dài thành các đoạn thẳng thường (để cắt từng đoạn)
function explode(sk, src) {
  const [t, id] = [src.slice(0, 1), src.slice(2)];
  if (t === 'l') { const l = sk.lines.find((x) => x.id === id); if (l && l.ext && l.r) { l.a = l.r[0]; l.b = l.r[1]; l.ext = false; } return; }
  const i = sk.shapes.findIndex((s) => s.id === id); if (i < 0) return;
  const isPath = sk.shapes[i].type === 'path', P = shapePoly(sk.shapes[i]); sk.shapes.splice(i, 1);
  for (let k = 0; k < P.length - (isPath ? 1 : 0); k++) sk.lines.push({ id: id + '_' + k, a: P[k], b: P[(k + 1) % P.length], ext: false });
}
// Cắt (Trim): bỏ đoạn nét giữa hai giao điểm gần điểm q
export function trimAt(F, sk, q, tol) {
  const e0 = nearestEdge(sk, q, tol); if (!e0) return false;
  for (const s of e0.srcs) explode(sk, s);
  resolveSegs(F, sk);
  const { all, nodes } = arrangement(F, resolveSegs(F, sk));
  const deg = new Array(nodes.length).fill(0); for (const e of all) { deg[e.u]++; deg[e.v]++; }
  const near = (e) => G.distToSegment(q, nodes[e.u], nodes[e.v]).d;
  let start = null, bd = tol;
  for (const e of all) if (!e.srcs.every((s) => s === 'b')) { const d = near(e); if (d < bd) { bd = d; start = e; } }
  if (!start) return false;
  // nối dài qua các đỉnh bậc 2 (không phải giao điểm)
  const chain = new Set([start]);
  for (const end of [start.u, start.v]) {
    let cur = start, node = end, guard = 0;
    while (deg[node] === 2 && guard++ < 1000) {
      const nx = all.find((e) => e !== cur && !chain.has(e) && (e.u === node || e.v === node)); if (!nx || nx.srcs.every((s) => s === 'b')) break;
      chain.add(nx); cur = nx; node = nx.u === node ? nx.v : nx.u;
    }
  }
  const cut = [...chain].map((e) => [nodes[e.u], nodes[e.v]]);
  const onCut = (m) => cut.some(([a, b]) => G.distToSegment(m, a, b).d < 0.02);
  // các đoạn thẳng nguồn: bỏ phần nằm trên chuỗi bị cắt
  const lines = [];
  for (const l of sk.lines) {
    if (l.ext) { lines.push(l); continue; }
    const ts = [0, 1];
    for (const n of nodes) { const d = G.distToSegment(n, l.a, l.b); if (d.d < 0.02) { const L2 = (l.b[0] - l.a[0]) ** 2 + (l.b[1] - l.a[1]) ** 2; if (L2 > 0) { const t = ((n[0] - l.a[0]) * (l.b[0] - l.a[0]) + (n[1] - l.a[1]) * (l.b[1] - l.a[1])) / L2; if (t > 0 && t < 1) ts.push(t); } } }
    ts.sort((a, b) => a - b);
    const at = (t) => [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t];
    let run = null, k = 0;
    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i + 1] - ts[i] < 1e-6) continue;
      const keep = !onCut(at((ts[i] + ts[i + 1]) / 2));
      if (keep) { if (!run) run = [ts[i], ts[i + 1]]; else run[1] = ts[i + 1]; }
      else if (run) { lines.push({ id: l.id + 't' + k++, a: at(run[0]), b: at(run[1]), ext: false }); run = null; }
    }
    if (run) lines.push(run[0] === 0 && run[1] === 1 ? l : { id: l.id + 't' + k++, a: at(run[0]), b: at(run[1]), ext: false });
  }
  sk.lines = lines;
  return true;
}
// Đoạn thẳng cắt nhau: tách thành các đoạn chung giao điểm (2 đoạn cắt nhau -> 4 đoạn).
// Đoạn kéo dài tới cạnh (ext) có giao với đoạn khác thì cố định lại theo l.r rồi tách.
// Trả về { [id cũ]: id mới của một mảnh } cho các đoạn bị tách.
export function splitLines(sk) {
  const map = {}; if (!sk || !sk.lines || sk.lines.length < 2) return map;
  const segOf = (l) => (l.ext && l.r ? l.r : [l.a, l.b]);
  const hit = (p1, p2, p3, p4) => {
    const r = [p2[0] - p1[0], p2[1] - p1[1]], sv = [p4[0] - p3[0], p4[1] - p3[1]], den = cross(r, sv);
    if (Math.abs(den) < 1e-9) return null;
    const w = [p3[0] - p1[0], p3[1] - p1[1]], t = cross(w, sv) / den, u = cross(w, r) / den;
    const L1 = Math.hypot(r[0], r[1]), L2 = Math.hypot(sv[0], sv[1]), e1 = 0.01 / L1, e2 = 0.01 / L2;
    if (t < -e1 || t > 1 + e1 || u < -e2 || u > 1 + e2) return null;
    return { t, u };
  };
  const cuts = sk.lines.map(() => []);
  for (let i = 0; i < sk.lines.length; i++) for (let j = i + 1; j < sk.lines.length; j++) {
    const [a, b] = segOf(sk.lines[i]), [c, d] = segOf(sk.lines[j]);
    const h = hit(a, b, c, d); if (!h) continue;
    const L1 = G.dist(a, b), L2 = G.dist(c, d);
    if (h.t * L1 > 0.02 && (1 - h.t) * L1 > 0.02) cuts[i].push(h.t);
    if (h.u * L2 > 0.02 && (1 - h.u) * L2 > 0.02) cuts[j].push(h.u);
  }
  const out = []; let seq = Date.now() % 100000;
  sk.lines.forEach((l, i) => {
    if (!cuts[i].length) { out.push(l); return; }
    const [a, b] = segOf(l), ts = [0, ...cuts[i].sort((x, y) => x - y), 1];
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      const id = l.id + 'x' + (seq++).toString(36);
      out.push({ id, a: at(ts[k]), b: at(ts[k + 1]), ext: false });
      if (!map[l.id]) map[l.id] = id;
    }
  });
  sk.lines = out;
  return map;
}
// Xoá cả nét (đoạn thẳng hoặc hình) gần điểm q
export function eraseAt(sk, q, tol) {
  const e = nearestEdge(sk, q, tol); if (!e) return null;
  const src = e.srcs[0], id = src.slice(2);
  if (src[0] === 'l') sk.lines = sk.lines.filter((l) => l.id !== id); else sk.shapes = sk.shapes.filter((s) => s.id !== id);
  return src;
}
export function findSrc(sk, src) {
  if (!sk || !src) return null;
  const id = src.slice(2);
  return src[0] === 'l' ? sk.lines.find((l) => l.id === id) : sk.shapes.find((s) => s.id === id);
}

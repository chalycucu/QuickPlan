// QP-23: «Tạo đa giác kín»: từ mạng nét (đường thẳng, polyline, hình) trong vùng chọn tạo các đa giác kín
// - khép chỗ hở nhỏ (≤ tol) giữa đầu nét và nét khác
// - cắt các nét tại giao điểm, bỏ nét cụt, lần theo các mặt khép kín (đồ thị phẳng)
// - đa giác trùng nhau chỉ giữ một

const EPS = 1e-3; // gộp đỉnh trong 1 mm
const key = (p) => Math.round(p[0] / EPS) + ',' + Math.round(p[1] / EPS);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function signedArea(r) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function projSeg(p, a, b) { const d = sub(b, a), L = d[0] * d[0] + d[1] * d[1]; if (L < 1e-12) return { q: a, t: 0, d: dist(p, a) }; let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L; t = Math.max(0, Math.min(1, t)); const q = [a[0] + d[0] * t, a[1] + d[1] * t]; return { q, t, d: dist(p, q) }; }
function segX(a, b, c, d) { // giao điểm hai đoạn (t trên ab, u trên cd)
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))];
}
// lưới tra nhanh các đoạn
function grid(segs, cell) {
  const g = new Map(), k = (i, j) => i + ':' + j;
  segs.forEach((s, n) => {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / cell), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / cell), y0 = Math.floor(Math.min(s.a[1], s.b[1]) / cell), y1 = Math.floor(Math.max(s.a[1], s.b[1]) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) { (g.get('big') || g.set('big', []).get('big')).push(n); return; }
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const kk = k(i, j); (g.get(kk) || g.set(kk, []).get(kk)).push(n); }
  });
  const near = (p, r) => { const out = new Set(g.get('big') || []); for (let i = Math.floor((p[0] - r) / cell); i <= Math.floor((p[0] + r) / cell); i++) for (let j = Math.floor((p[1] - r) / cell); j <= Math.floor((p[1] + r) / cell); j++) for (const n of g.get(k(i, j)) || []) out.add(n); return out; };
  const pairs = () => { const seen = new Set(), out = []; for (const [kk, list] of g) { if (kk === 'big') continue; for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) { const a = Math.min(list[x], list[y]), b = Math.max(list[x], list[y]), h = a * 1e7 + b; if (!seen.has(h)) { seen.add(h); out.push([a, b]); } } } const big = g.get('big') || []; for (const a of big) for (let b = 0; b < segs.length; b++) if (a !== b) { const lo = Math.min(a, b), hi = Math.max(a, b), h = lo * 1e7 + hi; if (!seen.has(h)) { seen.add(h); out.push([lo, hi]); } } return out; };
  return { near, pairs };
}

// lines: [{ pts: [[x,y],...], closed }] -> { rings: [[[x,y],...]], gaps: số chỗ hở đã khép }
export function polygonize(lines, tol = 0.5) {
  const segs = [], ends = [];
  lines.forEach((ln, li) => {
    const P = ln.pts.map((q) => [q[0], q[1]]);
    let closed = !!ln.closed;
    if (P.length > 2 && dist(P[0], P[P.length - 1]) < EPS) { P.pop(); closed = true; }
    for (let i = 0; i + 1 < P.length; i++) segs.push({ a: P[i], b: P[i + 1], li });
    if (closed && P.length > 2) segs.push({ a: P[P.length - 1], b: P[0], li });
    ends[li] = closed || P.length < 2 ? [] : [P[0], P[P.length - 1]];
  });
  if (!segs.length) return { rings: [], gaps: 0 };
  let len = 0; for (const s of segs) len += dist(s.a, s.b);
  const cell = Math.max(tol * 4, (len / segs.length) * 2, 1);
  // ---- khép chỗ hở: đầu nét hở nối tới điểm gần nhất của nét khác (hoặc đầu kia của chính nó) trong khoảng tol ----
  let gaps = 0;
  if (tol > 0) {
    const G0 = grid(segs, cell), endKeys = new Map();
    ends.forEach((es) => es.forEach((e) => endKeys.set(key(e), (endKeys.get(key(e)) || 0) + 1)));
    const add = [], done = new Set();
    lines.forEach((ln, li) => {
      for (const e of ends[li]) {
        if (endKeys.get(key(e)) > 1) continue; // đã nối với đầu nét khác
        let best = null;
        for (const n of G0.near(e, tol)) {
          const s = segs[n];
          if (s.li === li && (dist(s.a, e) < EPS || dist(s.b, e) < EPS)) continue; // đoạn của chính đầu nét này
          const pr = projSeg(e, s.a, s.b);
          if (pr.d > EPS && pr.d <= tol && (!best || pr.d < best.d)) best = pr;
        }
        if (best) { const k1 = key(e) + '|' + key(best.q), k2 = key(best.q) + '|' + key(e); if (done.has(k2)) continue; done.add(k1); add.push({ a: e, b: best.q, li: -1 }); gaps++; }
      }
    });
    segs.push(...add);
  }
  // ---- cắt nhau: chia đoạn tại giao điểm ----
  const G1 = grid(segs, cell), cuts = segs.map(() => [0, 1]);
  for (const [i, j] of G1.pairs()) {
    const s = segs[i], t = segs[j];
    const r = segX(s.a, s.b, t.a, t.b);
    if (r) { cuts[i].push(r[0]); cuts[j].push(r[1]); continue; }
    // trùng phương, chồng lên nhau: chia tại đầu mút của đoạn kia
    for (const [u, v, ci] of [[s, t, j], [t, s, i]]) for (const e of [u.a, u.b]) { const pr = projSeg(e, v.a, v.b); if (pr.d < EPS && pr.t > 1e-9 && pr.t < 1 - 1e-9) cuts[ci].push(pr.t); }
  }
  // ---- đồ thị ----
  const V = new Map(), adj = new Map();
  const vid = (p) => { const k = key(p); if (!V.has(k)) { V.set(k, [Math.round(p[0] / EPS) * EPS, Math.round(p[1] / EPS) * EPS]); adj.set(k, new Set()); } return k; };
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = [s.a[0] + (s.b[0] - s.a[0]) * ts[k], s.a[1] + (s.b[1] - s.a[1]) * ts[k]], q = [s.a[0] + (s.b[0] - s.a[0]) * ts[k + 1], s.a[1] + (s.b[1] - s.a[1]) * ts[k + 1]];
      const u = vid(p), v = vid(q); if (u === v) continue;
      adj.get(u).add(v); adj.get(v).add(u);
    }
  });
  // bỏ nét cụt (đỉnh bậc 1) lặp lại
  const stack = [...adj.keys()].filter((k) => adj.get(k).size < 2);
  while (stack.length) { const k = stack.pop(), nb = adj.get(k); if (!nb || nb.size >= 2) continue; for (const o of nb) { const s2 = adj.get(o); s2.delete(k); if (s2.size < 2) stack.push(o); } adj.delete(k); }
  // ---- lần theo mặt: tại mỗi đỉnh, đi tiếp theo cạnh liền kề theo chiều kim đồng hồ ----
  const order = new Map();
  for (const [k, nb] of adj) { const p = V.get(k); order.set(k, [...nb].sort((x, y) => Math.atan2(V.get(x)[1] - p[1], V.get(x)[0] - p[0]) - Math.atan2(V.get(y)[1] - p[1], V.get(y)[0] - p[0]))); }
  const used = new Set(), rings = [], seen = new Set();
  for (const [u, nb] of adj) for (const v of nb) {
    if (used.has(u + '>' + v)) continue;
    const cyc = []; let a = u, b = v, guard = 0;
    while (!used.has(a + '>' + b) && guard++ < 200000) {
      used.add(a + '>' + b); cyc.push(V.get(a));
      const ob = order.get(b), i = ob.indexOf(a);
      const c = ob[(i - 1 + ob.length) % ob.length];
      a = b; b = c;
    }
    if (cyc.length < 3) continue;
    const A = signedArea(cyc);
    if (A <= 1e-4) continue; // mặt ngoài (ngược chiều) hoặc suy biến
    // bỏ đỉnh thẳng hàng
    const r = cyc.filter((p, i) => { const pr = cyc[(i - 1 + cyc.length) % cyc.length], nx = cyc[(i + 1) % cyc.length], L = dist(p, pr) * dist(nx, p); return L < 1e-12 || Math.abs(cross(sub(p, pr), sub(nx, p))) / L > 1e-6; });
    if (r.length < 3) continue;
    let cx = 0, cy = 0; for (const p of r) { cx += p[0]; cy += p[1]; }
    const sig = Math.round(A * 100) + ':' + Math.round(cx / r.length * 100) + ':' + Math.round(cy / r.length * 100);
    if (seen.has(sig)) continue; seen.add(sig);
    rings.push(r);
  }
  return { rings, gaps };
}

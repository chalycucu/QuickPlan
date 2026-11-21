// Hình chuẩn từ nét tay: đường thẳng / đường tròn khi giữ bút, và tuyến đường gồm đoạn thẳng + cung tròn bán kính chẵn.
import * as G from './geom.js';

// ---------- Giữ bút để nắn hình ----------
export function fitCircle(pts) {
  const c = G.centroid(pts);
  const ds = pts.map((p) => G.dist(p, c));
  const r = ds.reduce((a, b) => a + b, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((a, d) => a + (d - r) ** 2, 0) / ds.length);
  return { c, r, err: r ? sd / r : 1 };
}
export function circlePts(c, r, n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  return out;
}

// Xác định hình chuẩn khi người dùng giữ bút: 'line' | 'circle' | 'poly'
export function snapShape(raw, sc) {
  const pts = raw.map((p) => [p[0], p[1]]);
  if (pts.length < 2) return null;
  const closed = G.isClosedStroke(pts, 40, sc) && G.length(pts) > 60 / sc;
  if (closed) {
    const f = fitCircle(pts);
    if (f.err < 0.22) return { type: 'circle', c: f.c, r: niceLen(f.r), start: pts[0] };
    let poly = G.rdp(pts, 14 / sc);
    if (G.dist(poly[0], poly[poly.length - 1]) < 30 / sc) poly = poly.slice(0, -1);
    if (poly.length >= 3) return { type: 'poly', pts: poly };
  }
  return { type: 'line', a: pts[0], b: pts[pts.length - 1] };
}
// Khi đang giữ, kéo tiếp để chỉnh hình
export function updateSnap(s, w) {
  if (s.type === 'line') s.b = w;
  else if (s.type === 'circle') s.r = niceLen(G.dist(w, s.c));
}
export function snapPts(s) {
  if (s.type === 'line') return [s.a, s.b];
  if (s.type === 'circle') return circlePts(s.c, s.r);
  return s.pts;
}
const niceLen = (r) => (r > 20 ? Math.round(r) : Math.round(r * 2) / 2);

// ---------- Tuyến đường: đoạn thẳng + cung tròn bán kính chẵn ----------
export function niceRadius(R) {
  const step = R < 30 ? 5 : R < 200 ? 10 : R < 1000 ? 50 : 100;
  return Math.max(step, Math.round(R / step) * step);
}
const turn = (a, b, c) => {
  const u = norm([b[0] - a[0], b[1] - a[1]]), v = norm([c[0] - b[0], c[1] - b[1]]);
  return { u, v, ang: Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))), cross: u[0] * v[1] - u[1] * v[0] };
};
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

// Bán kính lớn nhất có thể tại đỉnh i (tiếp tuyến không vượt nửa đoạn kề, đoạn đầu/cuối được dùng hết)
function maxRadius(pis, i) {
  const t = turn(pis[i - 1], pis[i], pis[i + 1]);
  if (t.ang < 1e-3) return Infinity;
  const L1 = G.dist(pis[i - 1], pis[i]) * (i - 1 === 0 ? 0.95 : 0.5);
  const L2 = G.dist(pis[i], pis[i + 1]) * (i + 1 === pis.length - 1 ? 0.95 : 0.5);
  return Math.min(L1, L2) / Math.tan(t.ang / 2);
}

// Từ nét tay -> các đỉnh (PI) và bán kính chẵn bám theo độ cong của nét tay
function rdpIdx(pts, eps) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let m = 0, id = -1;
    for (let i = a + 1; i < b; i++) { const d = G.distToSegment(pts[i], pts[a], pts[b]).d; if (d > m) { m = d; id = i; } }
    if (m > eps && id > 0) { keep[id] = 1; st.push([a, id], [id, b]); }
  }
  const out = []; keep.forEach((k, i) => k && out.push(i)); return out;
}
function fitLine(pts) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  let xx = 0, xy = 0, yy = 0;
  for (const p of pts) { const dx = p[0] - c[0], dy = p[1] - c[1]; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { c, d: [Math.cos(th), Math.sin(th)] };
}
function intersect(l1, l2) {
  const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
  if (Math.abs(den) < 0.05) return null;
  const t = ((l2.c[0] - l1.c[0]) * l2.d[1] - (l2.c[1] - l1.c[1]) * l2.d[0]) / den;
  return [l1.c[0] + l1.d[0] * t, l1.c[1] + l1.d[1] * t];
}
// khớp đường tròn bình phương tối thiểu (Kåsa), trả về bán kính
function kasa(pts) {
  const n = pts.length; let mx = 0, my = 0;
  for (const p of pts) { mx += p[0] / n; my += p[1] / n; }
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return 0;
  const A = 0.5 * (suuu + suvv), B = 0.5 * (svvv + svuu);
  const uc = (A * svv - B * suv) / det, vc = (B * suu - A * suv) / det;
  return Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
}
const project = (p, l) => { const t = (p[0] - l.c[0]) * l.d[0] + (p[1] - l.c[1]) * l.d[1]; return [l.c[0] + l.d[0] * t, l.c[1] + l.d[1] * t]; };

export function fitRoad(raw, sc, minR = 10) {
  const step = 2 / sc;
  const rs = G.resample(raw.map((p) => [p[0], p[1]]), step);
  const n = rs.length;
  if (n < 3) return n >= 2 ? { pis: [rs[0], rs[n - 1]], radii: [] } : null;
  // làm mượt nhẹ để khử rung tay (trung bình trượt ±3 điểm, giữ nguyên hai đầu)
  const pts = rs.map((p, i) => {
    if (i === 0 || i === n - 1) return p;
    const h = Math.min(3, i, n - 1 - i);
    let x = 0, y = 0; for (let j = -h; j <= h; j++) { x += rs[i + j][0]; y += rs[i + j][1]; }
    return [x / (2 * h + 1), y / (2 * h + 1)];
  });
  // hướng tiếp tuyến làm mượt và độ cong
  const k = 10; // ~20 px
  const th = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - k)], b = pts[Math.min(n - 1, i + k)];
    th.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
  }
  for (let i = 1; i < n; i++) { while (th[i] - th[i - 1] > Math.PI) th[i] -= 2 * Math.PI; while (th[i] - th[i - 1] < -Math.PI) th[i] += 2 * Math.PI; }
  const W = 18; // cửa sổ ~36 px mỗi phía
  const straight = th.map((_, i) => Math.abs(th[Math.min(n - 1, i + W)] - th[Math.max(0, i - W)]) < (5 * Math.PI) / 180);
  // các đoạn thẳng dài ≥ 30 px
  let runs = [];
  for (let i = 0; i < n;) {
    if (!straight[i]) { i++; continue; }
    let j = i; while (j + 1 < n && straight[j + 1]) j++;
    if ((j - i) * step * sc >= 30) runs.push([i, j]);
    i = j + 1;
  }
  const minRun = Math.max(3, Math.round(n * 0.08));
  if (!runs.length || runs[0][0] > 0) runs.unshift([0, Math.min(n - 1, minRun)]);
  if (runs[runs.length - 1][1] < n - 1) runs.push([Math.max(0, n - 1 - minRun), n - 1]);
  // điểm uốn (đổi chiều cong) = nơi hướng tuyến đạt cực trị trong vùng cong -> thêm tiếp tuyến tại đó
  for (let r = 0; r < runs.length - 1; r++) {
    const a = runs[r][1], b = runs[r + 1][0];
    if (b - a < 6) continue;
    for (const sgn of [1, -1]) {
      let m = a, best = -Infinity;
      for (let i = a; i <= b; i++) { const v = sgn * (th[i] - th[a]); if (v > best) { best = v; m = i; } }
      const lim = (12 * Math.PI) / 180;
      if (best > lim && sgn * (th[m] - th[b]) > lim && m > a + 2 && m < b - 2) {
        const h = Math.max(1, Math.round(k / 2)); runs.splice(r + 1, 0, [m - h, m + h]); break;
      }
    }
  }
  // tách vùng cong lớn (> 110°) bằng tiếp tuyến ở giữa
  for (let r = 0; r < runs.length - 1; r++) {
    const a = runs[r][1], b = runs[r + 1][0];
    if (b - a < 4) continue;
    const d = Math.abs(th[b] - th[a]);
    if (d > (110 * Math.PI) / 180) {
      const m = Math.round((a + b) / 2), h = Math.max(1, Math.round(k / 2));
      runs.splice(r + 1, 0, [m - h, m + h]); r--;
    }
  }
  const lines = runs.map(([a, b]) => {
    if (b - a >= 3) return fitLine(pts.slice(a, b + 1));
    const m = Math.round((a + b) / 2);
    return { c: pts[m], d: [Math.cos(th[m]), Math.sin(th[m])] };
  });
  let pis = [project(pts[0], lines[0])];
  const arcs = [];
  for (let j = 1; j < lines.length; j++) {
    const X = intersect(lines[j - 1], lines[j]);
    const mid = pts[Math.round((runs[j - 1][1] + runs[j][0]) / 2)];
    pis.push(X && G.dist(X, mid) < 5 * G.dist(pts[runs[j - 1][1]], pts[runs[j][0]]) + 20 / sc ? X : mid);
    // độ dài cung tay giữa hai đoạn thẳng
    // bán kính đo trực tiếp: khớp đường tròn vào phần giữa đoạn cong của nét tay
    const a0 = runs[j - 1][1], b0 = runs[j][0], span = b0 - a0;
    const seg = pts.slice(a0 + Math.floor(span * 0.2), b0 - Math.floor(span * 0.2) + 1);
    arcs.push(seg.length >= 5 ? kasa(seg) : 0);
  }
  pis.push(project(pts[n - 1], lines[lines.length - 1]));
  // bỏ đỉnh gần thẳng hàng
  for (let q = pis.length - 2; q >= 1; q--) if (turn(pis[q - 1], pis[q], pis[q + 1]).ang < (4 * Math.PI) / 180) { pis.splice(q, 1); arcs.splice(q - 1, 1); }
  // bỏ đỉnh do rung tay: góc rẽ nhỏ mà nét tay gần như đi qua đỉnh, hoặc đỉnh quay ngược
  const distTo = (q) => { let E = Infinity; for (const p of pts) E = Math.min(E, G.dist(p, q)); return E; };
  for (let changed = true, g = 0; changed && g < 40; g++) {
    changed = false;
    for (let q = 1; q < pis.length - 1; q++) {
      const t = turn(pis[q - 1], pis[q], pis[q + 1]);
      const short = Math.min(G.dist(pis[q - 1], pis[q]), G.dist(pis[q], pis[q + 1])) < 12 / sc;
      if (t.ang > (150 * Math.PI) / 180 || (t.ang < (12 * Math.PI) / 180 && distTo(pis[q]) < 4 / sc) || (short && t.ang < (30 * Math.PI) / 180)) { pis.splice(q, 1); changed = true; break; }
    }
  }
  // bỏ đỉnh quá sát hai đầu (do rung tay khi nhấc bút)
  while (pis.length > 2 && G.dist(pis[pis.length - 1], pis[pis.length - 2]) < 20 / sc) pis.splice(pis.length - 2, 1);
  while (pis.length > 2 && G.dist(pis[0], pis[1]) < 20 / sc) pis.splice(1, 1);
  const radii = [];
  for (let i = 1; i < pis.length - 1; i++) {
    const t = turn(pis[i - 1], pis[i], pis[i + 1]);
    // phân cự E (khoảng cách đỉnh tới nét tay) = R (sec(Δ/2) − 1)
    let E = Infinity; for (const p of pts) E = Math.min(E, G.dist(p, pis[i]));
    const sec = 1 / Math.cos(t.ang / 2) - 1;
    let R = sec > 1e-4 ? E / sec : 0;
    const Rc = arcs[i - 1];
    if (Rc > 0 && isFinite(Rc) && t.ang > (15 * Math.PI) / 180 && R > 0 && Math.max(Rc / R, R / Rc) < 1.8) R = Math.sqrt(R * Rc);
    const Rmax = maxRadius(pis, i);
    R = Math.min(R, Rmax);
    if (R >= minR * 0.6) { R = niceRadius(R); if (R > Rmax) R = Math.max(0, Math.floor(Rmax / 5) * 5); }
    else R = Math.min(minR, Math.floor(Rmax));
    radii.push(Math.max(0, R));
  }
  return { pis, radii, _runs: runs.length };
}

// Sinh toạ độ tuyến từ đỉnh + bán kính (bán kính bị giới hạn nếu không đủ chỗ)
export function roadGeometry(pis, radii) {
  if (pis.length < 3) return pis.map((p) => p.slice());
  const out = [pis[0].slice()];
  for (let i = 1; i < pis.length - 1; i++) {
    const t = turn(pis[i - 1], pis[i], pis[i + 1]);
    const R = Math.min(radii[i - 1] || 0, maxRadius(pis, i));
    if (R <= 0.5 || t.ang < 1e-3) { out.push(pis[i].slice()); continue; }
    const T = R * Math.tan(t.ang / 2);
    const P = pis[i];
    const a = [P[0] - t.u[0] * T, P[1] - t.u[1] * T];
    const s = Math.sign(t.cross) || 1;
    const nrm = [-t.u[1] * s, t.u[0] * s];
    const c = [a[0] + nrm[0] * R, a[1] + nrm[1] * R];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const n = Math.max(2, Math.ceil(t.ang / ((4 * Math.PI) / 180)), Math.ceil((R * t.ang) / 3));
    for (let k = 0; k <= n; k++) {
      const ang = a0 + s * t.ang * (k / n);
      out.push([c[0] + Math.cos(ang) * R, c[1] + Math.sin(ang) * R]);
    }
  }
  out.push(pis[pis.length - 1].slice());
  return out;
}
export function effectiveRadii(pis, radii) {
  return radii.map((r, k) => Math.min(r, Math.round(maxRadius(pis, k + 1) * 10) / 10));
}

// ---------- Công trình: đa giác số cạnh bất kỳ, bám sát nét tay ----------
// Trả về { pts, rightAngles } — rightAngles = mọi góc gần 90° (để chế độ Tự động bẻ vuông)
export function fitPolygon(raw, sc) {
  let pts = G.resample(raw.map((p) => [p[0], p[1]]), 2 / sc);
  if (pts.length < 6) return null;
  if (G.dist(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  const per = G.length(pts.concat([pts[0]]));
  // đỉnh thô: RDP trên vòng kín, bắt đầu từ điểm xa tâm nhất để không mất góc
  const c = G.centroid(pts);
  let k0 = 0; pts.forEach((p, i) => { if (G.dist(p, c) > G.dist(pts[k0], c)) k0 = i; });
  const ring = pts.slice(k0).concat(pts.slice(0, k0));
  const eps = Math.max(4 / sc, per * 0.012);
  let idx = rdpIdx(ring.concat([ring[0]]), eps).filter((i) => i < ring.length);
  // bỏ đỉnh gần như thẳng hàng hoặc cạnh quá ngắn
  const minEdge = Math.max(10 / sc, per * 0.03);
  for (let changed = true; changed && idx.length > 3;) {
    changed = false;
    let worst = -1, wv = Infinity;
    for (let j = 0; j < idx.length; j++) {
      const a = ring[idx[(j - 1 + idx.length) % idx.length]], b = ring[idx[j]], d = ring[idx[(j + 1) % idx.length]];
      const t = turn(a, b, d).ang;
      const short = Math.min(G.dist(a, b), G.dist(b, d));
      const score = t < (14 * Math.PI) / 180 ? t : short < minEdge ? t + 1 : Infinity;
      if (score < wv) { wv = score; worst = j; }
    }
    if (worst >= 0 && wv !== Infinity) { idx.splice(worst, 1); changed = true; }
  }
  if (idx.length < 3) return null;
  // khớp đường thẳng cho từng cạnh theo điểm nét tay ở khoảng giữa cạnh, rồi giao các đường
  const n = idx.length, lines = [];
  for (let j = 0; j < n; j++) {
    const i0 = idx[j], i1 = idx[(j + 1) % n];
    const seg = i1 > i0 ? ring.slice(i0, i1 + 1) : ring.slice(i0).concat(ring.slice(0, i1 + 1));
    const m = seg.length, cut = Math.floor(m * 0.15);
    const mid = m > 8 ? seg.slice(cut, m - cut) : seg;
    lines.push(fitLine(mid));
  }
  const out = [];
  for (let j = 0; j < n; j++) {
    const v = ring[idx[j]];
    const q = intersect(lines[(j - 1 + n) % n], lines[j]);
    out.push(q && G.dist(q, v) < Math.max(12 / sc, per * 0.05) ? q : v);
  }
  if (G.area(out) < 1) return null;
  // kiểm tra góc vuông
  let right = true;
  for (let j = 0; j < n; j++) {
    const a = out[(j - 1 + n) % n], b = out[j], d = out[(j + 1) % n];
    const t = turn(a, b, d).ang * 180 / Math.PI;
    if (Math.abs(t - 90) > 12) { right = false; break; }
  }
  return { pts: out, rightAngles: right };
}

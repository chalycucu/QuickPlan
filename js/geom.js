// Hình học 2D cơ bản. Toạ độ thế giới tính bằng mét, trục y hướng xuống (phía Nam).

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function length(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

export function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const area = (pts) => Math.abs(signedArea(pts));

export function centroid(pts) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const f = a[0] * b[1] - b[0] * a[1];
    A += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f;
  }
  if (Math.abs(A) < 1e-9) {
    const m = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    return [m[0] / pts.length, m[1] / pts.length];
  }
  return [cx / (3 * A), cy / (3 * A)];
}

export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { d: dist(p, q), q, t };
}

export function distToPolyline(p, pts, closed = false) {
  let best = { d: Infinity, q: null, i: -1 };
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const r = distToSegment(p, pts[i], pts[(i + 1) % n]);
    if (r.d < best.d) best = { ...r, i };
  }
  return best;
}

// Ramer–Douglas–Peucker
export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]).d;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = dist(a, b);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(q); a = q; d = dist(a, b); acc = 0;
    }
    acc += d;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

export function chaikin(pts, iters = 2, closed = false) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

// Catmull-Rom (centripetal xấp xỉ bằng uniform) – nội suy mượt đi qua các điểm điều khiển
export function catmullRom(ctrl, segs = 8, closed = false) {
  const n = ctrl.length;
  if (n < 3) return ctrl.slice();
  const get = (i) => (closed ? ctrl[(i + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < segs; s++) {
      const t = s / segs, t2 = t * t, t3 = t2 * t;
      const f = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  if (!closed) out.push(ctrl[n - 1]);
  return out;
}

export function rotatePts(pts, ang, c = [0, 0]) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return pts.map((p) => {
    const x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
  });
}
export const translatePts = (pts, dx, dy) => pts.map((p) => [p[0] + dx, p[1] + dy]);

// Bẻ góc vuông: căn các cạnh theo hướng của cạnh dài nhất
export function orthogonalize(poly) {
  if (poly.length < 3) return poly;
  let best = 0, ang = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const d = dist(a, b);
    if (d > best) { best = d; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  const c = centroid(poly);
  const r = rotatePts(poly, -ang, c);
  // phân loại cạnh: H (ngang) hoặc V (dọc), gộp các cạnh liền nhau cùng loại
  let edges = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const type = Math.abs(dx) >= Math.abs(dy) ? 'H' : 'V';
    const len = Math.hypot(dx, dy);
    const mid = type === 'H' ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2;
    const prev = edges[edges.length - 1];
    if (prev && prev.type === type) {
      prev.val = (prev.val * prev.len + mid * len) / (prev.len + len); prev.len += len;
    } else edges.push({ type, val: mid, len });
  }
  if (edges.length > 1 && edges[0].type === edges[edges.length - 1].type) {
    const l = edges.pop(), f = edges[0];
    f.val = (f.val * f.len + l.val * l.len) / (f.len + l.len); f.len += l.len;
  }
  if (edges.length < 4) {
    // quá ít cạnh -> lấy hình chữ nhật bao
    const b = bbox(r);
    return rotatePts([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], ang, c);
  }
  const out = [];
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i], e2 = edges[(i + 1) % edges.length];
    out.push(e1.type === 'H' ? [e2.val, e1.val] : [e1.val, e2.val]);
  }
  return rotatePts(out, ang, c);
}

// Dải đệm quanh một đường (lòng đường, sông). Trả về mép trái/phải.
export function offsetSides(pts, half) {
  const n = pts.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let nx = -ty, ny = tx;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      // hệ số miter theo góc giữa hai đoạn
      const p = pts[i - 1], q = pts[i], r = pts[i + 1];
      let ux = q[0] - p[0], uy = q[1] - p[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const cos = -uy * nx + ux * ny; // tích vô hướng giữa pháp tuyến đoạn trước và pháp tuyến trung bình
      scale = Math.min(3, 1 / Math.max(0.33, Math.abs(cos)));
      void r;
    }
    L.push([pts[i][0] + nx * half * scale, pts[i][1] + ny * half * scale]);
    R.push([pts[i][0] - nx * half * scale, pts[i][1] - ny * half * scale]);
  }
  return { L, R };
}
export function bandPolygon(pts, half) {
  const { L, R } = offsetSides(pts, half);
  return L.concat(R.reverse());
}

// Mở rộng/thu nhỏ đa giác lồi/gần lồi theo pháp tuyến (dùng cho khoảng lùi hiển thị)
export function offsetPolygon(poly, d) {
  const n = poly.length;
  const s = Math.sign(signedArea(poly)) || 1;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const n1 = norm([p[1] - a[1], -(p[0] - a[0])]), n2 = norm([b[1] - p[1], -(b[0] - p[0])]);
    let m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = m[0] * n1[0] + m[1] * n1[1];
    const k = Math.min(3, 1 / Math.max(0.33, cos));
    return [p[0] + s * m[0] * d * k, p[1] + s * m[1] * d * k];
  });
}
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

export function isClosedStroke(pts, tolPx, scale) {
  if (pts.length < 4) return false;
  const L = length(pts);
  const gap = dist(pts[0], pts[pts.length - 1]);
  return gap < Math.max(tolPx / scale, L * 0.12);
}

// Mây bao: đường viền dạng vỏ sò
export function cloudPath(poly, bump) {
  const r = resample(poly.concat([poly[0]]), bump);
  return r;
}

export const fmtArea = (m2) => (m2 >= 10000 ? (m2 / 10000).toFixed(2) + ' ha' : Math.round(m2).toLocaleString('vi-VN') + ' m²');
export const fmtNum = (v, d = 1) => (isFinite(v) ? v.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');

// Số điểm cắt nhau thực sự giữa hai đường gấp khúc
export function countCrossings(a, b) {
  let n = 0;
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (segX(a[i], a[i + 1], b[j], b[j + 1])) n++;
  return n;
}
function segX(p, p2, q, q2) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(q, q2, p), d2 = d(q, q2, p2), d3 = d(p, p2, q), d4 = d(p, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Bao lồi (monotone chain), giữ chiều vòng như đa giác gốc
export function convexHull(pts) {
  const P = pts.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-9) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  return signedArea(h) * signedArea(pts) < 0 ? h.reverse() : h;
}

// Khung bao các nhóm điểm, bỏ qua nhóm nằm lạc rất xa phần chính (nét rác, nét vẽ nhầm sát chân trời…)
// để Toàn cảnh 2D / 3D không bị lùi ra hàng trăm km làm hình bé tí
export function robustBBox(groups) {
  const bs = groups.filter((g) => g && g.length).map((g) => bbox(g));
  if (!bs.length) return null;
  const union = (arr) => arr.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  if (bs.length < 5) return union(bs);
  const med = (arr) => { const a = arr.slice().sort((u, v) => u - v); return a[Math.floor(a.length / 2)]; };
  const cs = bs.map((b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]), mx = med(cs.map((c) => c[0])), my = med(cs.map((c) => c[1]));
  const ds = cs.map((c) => Math.max(Math.abs(c[0] - mx), Math.abs(c[1] - my))).sort((u, v) => u - v);
  const R = Math.max(2000, 4 * ds[Math.floor(ds.length * 0.8)]);
  const keep = bs.filter((b) => b.x0 > mx - R && b.x1 < mx + R && b.y0 > my - R && b.y1 < my + R);
  return union(keep.length ? keep : bs);
}

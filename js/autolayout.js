// Tự xếp khối công trình vào ô đất theo loại hình (nhà liên kế, biệt thự, chung cư, hỗn hợp, công nghiệp, công cộng).
// Làm theo quy tắc quy hoạch: khung toạ độ theo cạnh dài của ô, xếp lô / dải nhà / sân trong, rồi cắt theo ranh ô đất.
import * as G from './geom.js';

export const TYPES = {
  lk: { name: 'Nhà liên kế', defaults: { w: 5, d: 20, floors: 5, brk: 60, back: 4, lane: 10, ends: true } },
  bt: { name: 'Biệt thự', defaults: { w: 12, d: 20, floors: 3, cov: 55, front: 3, side: 2, lane: 10, ends: true } },
  cc: { name: 'Chung cư', defaults: { grid: 275, roadW: 25, floors: 15, t: 20, tBig: 30, grp: 100, gap: 25, sb: 6, park: 10, dens: 40, form: 'san', fit: false } },
  hh: { name: 'Hỗn hợp', defaults: { grid: 275, roadW: 25, floors: 20, t: 20, tBig: 30, grp: 100, gap: 25, sb: 6, park: 10, dens: 40, fit: false } },
  cn: { name: 'Công nghiệp', defaults: { grid: 275, roadW: 25, park: true, fw: 60, fd: 40, gap: 16, sbMain: 6, sb: 3, floors: 5, auxF: 2, aux: true } },
  cong: { name: 'Công cộng', defaults: { floors: 5, t: 15, sb: 6 } },
};
export const FORMS = { san: 'Sân trong', dai: 'Dải song song', thap: 'Tháp điểm' };

// Loại hình mặc định theo mã đất
export function defaultType(code, lu) {
  const m = { ODT: 'lk', ONT: 'lk', OXH: 'cc', HH: 'hh', TMDV: 'hh', SKC: 'cn', HTKT: 'cn', CC: 'cong', GD: 'cong', YT: 'cong', VH: 'cong', CQ: 'cong', TDTT: 'cong',
    TMD: 'hh', PNK: 'hh', CSK: 'cn', SCC: 'cn', SKK: 'cn', SKN: 'cn', SKS: 'cn', DCT: 'cn', DNL: 'cn', DRA: 'cn', CCC: 'cong', DCH: 'cong', DXH: 'cong', DGD: 'cong', DKH: 'cong', DYT: 'cong', DVH: 'cong', TSC: 'cong', DTT: 'cong' };
  if (m[code]) return m[code];
  if (lu && !(lu.mdxd > 0)) return null; // đất nông nghiệp, rừng, mặt nước, chưa sử dụng: không xây
  if (['CX', 'CXCL', 'MN', 'DGT', 'BDX'].includes(code)) return null;
  const cat = lu && lu.cat;
  return cat === 'o' ? 'lk' : cat === 'cc' ? 'cong' : cat === 'k' ? 'hh' : null;
}
// Khoảng cách tối thiểu giữa các dãy nhà cao tầng (xấp xỉ theo chiều cao, QCVN 01:2021)
export function spacing(floors, fh = 3.3) {
  const h = floors * fh;
  return h > 46 ? 25 : h > 28 ? 20 : h > 16 ? 15 : 10;
}

// ---------- hình học ----------
function frameOf(poly) {
  const hull = G.convexHull(poly);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if (G.dist(a, b) < 1e-6) continue;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const f = mkFrame(ang, hull);
    const ar = (f.u1 - f.u0) * (f.v1 - f.v0);
    if (!best || ar < best.ar - 1e-6) best = { ...f, ar };
  }
  if (!best) best = mkFrame(0, hull);
  if (best.u1 - best.u0 < best.v1 - best.v0) best = mkFrame(best.ang + Math.PI / 2, hull);
  return best;
}
function mkFrame(ang, pts) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const toL = (p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
  const toW = (u, v) => [u * c - v * s, u * s + v * c];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of pts) { const q = toL(p); u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
  return { ang, toL, toW, u0, u1, v0, v1 };
}
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
// Cắt đa giác bất kỳ bằng một đa giác lồi (Sutherland–Hodgman)
function clipConvex(subject, clip) {
  const sg = Math.sign(G.signedArea(clip)) || 1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const inside = (p) => sg * cross(A, B, p) >= -1e-9;
    const inter = (p, q) => { const a1 = cross(A, B, p), a2 = cross(A, B, q), t = a1 / (a1 - a2); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const cur = inp[j], prev = inp[(j + inp.length - 1) % inp.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(inter(prev, cur)); out.push(cur); } else if (pi) out.push(inter(prev, cur));
    }
  }
  const res = [];
  for (const p of out) if (!res.length || G.dist(p, res[res.length - 1]) > 0.02) res.push(p);
  if (res.length > 2 && G.dist(res[0], res[res.length - 1]) < 0.02) res.pop();
  return res;
}

// ---------- bố trí ----------
// zone: ô đất; o: tham số; ctx: { roads: [{pts, half}], limits: {mdxd, far, floors} }
export function layout(zone, type, o, ctx) {
  // vượt mật độ xây dựng: thu mỏng nhà / khối đế rồi xếp lại (tối đa vài lượt)
  let oo = { ...o }, res = layoutOnce(zone, type, oo, ctx);
  const lim = ctx.limits || {};
  if ((type === 'cc' || type === 'hh') && o.dens > 0 && (o.form || 'san') === 'san') {
    for (let k = 0; k < 8 && res.mdxd > o.dens + 0.3 && res.pieces.length; k++) {
      if (oo.t <= 12) break;
      oo = { ...oo, t: Math.max(12, oo.t * 0.9), tBig: Math.max(12, (oo.tBig || 30) * 0.9) };
      const r2 = layoutOnce(zone, type, oo, ctx); if (!r2.pieces.length) break; res = r2;
    }
    if (oo.t < o.t) res.notes.push(`Nhà thu còn rộng ${Math.round(oo.t)} m để mật độ khoảng ${o.dens}%`);
    if (res.mdxd > o.dens + 0.3) res.notes.push(`Mật độ ${res.mdxd.toFixed(1)}% cao hơn mục tiêu ${o.dens}%`);
  }
  const fit = !(type === 'cc' || type === 'hh') || o.fit;
  for (let k = 0; fit && k < 6 && lim.mdxd > 0 && res.mdxd > lim.mdxd + 0.05 && res.pieces.length; k++) {
    if (type === 'cc' || type === 'cong') { if (oo.t <= 12) break; oo = { ...oo, t: Math.max(12, oo.t * 0.85), pod: Math.max(12, (oo.pod || oo.t) * 0.85) }; }
    else if (type === 'hh') { if (oo.pod <= 15) break; oo = { ...oo, pod: Math.max(15, oo.pod * 0.85) }; }
    else if (type === 'cn') { if (oo.fw <= 20) break; oo = { ...oo, fw: oo.fw * 0.85, fd: oo.fd * 0.9 }; }
    else break;
    const r2 = layoutOnce(zone, type, oo, ctx);
    if (!r2.pieces.length) break;
    res = r2; res.notes = res.notes.filter((x) => !/^MĐXD/.test(x));
    if (res.mdxd <= lim.mdxd + 0.05) res.notes.push(`Thu mỏng khối để MĐXD không vượt ${lim.mdxd}%`);
  }
  if (lim.mdxd > 0 && res.mdxd > lim.mdxd + 0.05 && !res.notes.some((x) => /^MĐXD/.test(x))) res.notes.push(`MĐXD ${res.mdxd.toFixed(1)}% vượt ${lim.mdxd}% cho phép`);
  return res;
}
function layoutOnce(zone, type, o, ctx) {
  const zarea = G.area(zone.pts) - (zone.holes || []).reduce((s, h) => s + G.area(h), 0);
  const lim = ctx.limits || {};
  const sb = type === 'lk' ? zone.props.setback || 0 : type === 'bt' ? 0 : type === 'cn' ? o.sb ?? 3 : Math.max(o.sb || 0, zone.props.setback || 0);
  let B = sb > 0 ? G.offsetPolygon(zone.pts, -sb) : zone.pts.map((p) => p.slice());
  if (G.area(B) < 20 || Math.sign(G.signedArea(B)) !== Math.sign(G.signedArea(zone.pts))) B = null;
  const notes = [];
  if (!B) return { pieces: [], notes: ['Ô đất quá nhỏ so với khoảng lùi'], zarea };
  const F = frameOf(B); F.zarea = zarea;
  const holes = zone.holes || [];
  const inB = (p) => (G.pointInPolygon(p, B) || G.distToPolyline(p, B, true).d < 0.05) && !holes.some((h) => G.pointInPolygon(p, h));
  const rectW = (u0, v0, u1, v1) => [F.toW(u0, v0), F.toW(u1, v0), F.toW(u1, v1), F.toW(u0, v1)];
  const fullIn = (r) => r.every(inB) && r.every((p, i) => inB([(p[0] + r[(i + 1) % 4][0]) / 2, (p[1] + r[(i + 1) % 4][1]) / 2])) && inB(G.centroid(r));
  // khối chữ nhật trong khung: nằm trọn thì giữ, chạm ranh thì cắt theo ranh (bỏ nếu còn quá ít)
  const pieces = [];
  const add = (u0, v0, u1, v1, floors, role, extra = {}) => {
    if (u1 - u0 < 0.5 || v1 - v0 < 0.5) return null;
    const r = rectW(u0, v0, u1, v1);
    let pts = r;
    const W = extra.within;
    const inW = (q) => G.pointInPolygon(q, W) || G.distToPolyline(q, W, true).d < 0.05;
    if (W ? !r.every(inW) : !fullIn(r)) {
      if (extra.whole) return null;
      pts = clipConvex(W || B, r);
      if (pts.length < 3 || G.area(pts) < Math.max(30, 0.45 * (u1 - u0) * (v1 - v0))) return null;
      if (holes.some((h) => G.pointInPolygon(G.centroid(pts), h))) return null;
    }
    if (extra.probe) return true;
    const pc = { pts, floors: Math.max(1, Math.round(floors)), role, ...extra };
    delete pc.whole; delete pc.within;
    pieces.push(pc);
    return pc;
  };
  // mức ưu tiên của từng cạnh khung: bề rộng đường lớn nhất chạy dọc cạnh đó
  const score = sideScores(F, ctx.roads || []);

  if (type === 'lk' || type === 'bt') rowLots(F, o, type, score, add, notes);
  else if (type === 'cc') apartments(F, o, lim, score, add, notes);
  else if (type === 'hh') groups(F, o, o.fit ? Math.min(o.floors, lim.floors > 0 ? lim.floors : Infinity) : o.floors, score, add, notes);
  else if (type === 'cn') {
    let B6 = G.offsetPolygon(zone.pts, -Math.max(o.sbMain ?? 6, sb));
    if (G.area(B6) < 20 || Math.sign(G.signedArea(B6)) !== Math.sign(G.signedArea(zone.pts))) B6 = null;
    industry(F, o, add, notes, B6);
  }
  else civic(F, o, lim, score, add, notes, zarea);

  // giữ tổng sàn không vượt hệ số SDĐ cho các loại cao tầng (giảm tầng phần tháp)
  const gfa = () => pieces.reduce((s, p) => s + (p.role === 'park' ? 0 : G.area(p.pts) * p.floors), 0);
  if (lim.far > 0 && (type === 'cong' || ((type === 'cc' || type === 'hh') && o.fit))) {
    const maxG = lim.far * zarea;
    if (gfa() > maxG * 1.001) {
      const adj = pieces.filter((p) => p.role === 'tower' || p.role === 'block');
      const fixed = pieces.filter((p) => !adj.includes(p)).reduce((s, p) => s + G.area(p.pts) * p.floors, 0);
      const var0 = adj.reduce((s, p) => s + G.area(p.pts) * p.floors, 0);
      const k = Math.max(0, (maxG - fixed) / (var0 || 1));
      const minF = type === 'hh' ? (o.podF || 4) + 1 : 1;
      for (const p of adj) p.floors = Math.max(minF, Math.floor(p.floors * k));
      if (gfa() > maxG * 1.001) { // vẫn vượt: hạ cả tầng khối đế
        const all = gfa(), k2 = maxG / all;
        for (const p of pieces) p.floors = Math.max(1, Math.floor(p.floors * k2));
      }
      notes.push(`Giảm tầng để tổng sàn không vượt hệ số SDĐ ${lim.far}`);
    }
  }
  const parks = [];
  for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].role === 'park') parks.unshift(pieces.splice(i, 1)[0]);
  const foot = pieces.reduce((s, p) => s + G.area(p.pts), 0);
  const res = { pieces, parks, notes, zarea, foot, gfa: gfa(), mdxd: (foot / zarea) * 100, far: gfa() / zarea, maxFloors: Math.max(0, ...pieces.map((p) => p.floors)) };
  if (lim.far > 0 && res.far > lim.far + 0.005) notes.push(`HSSDĐ ${res.far.toFixed(2)} vượt ${lim.far}`);
  if (!pieces.length && !parks.length) notes.push('Ô đất không đủ chỗ cho loại hình này');
  return res;
}

function sideScores(F, roads) {
  const sides = { v0: [[F.u0, F.v0], [F.u1, F.v0]], v1: [[F.u0, F.v1], [F.u1, F.v1]], u0: [[F.u0, F.v0], [F.u0, F.v1]], u1: [[F.u1, F.v0], [F.u1, F.v1]] };
  const out = {};
  for (const [k, [a, b]] of Object.entries(sides)) {
    let best = 0;
    for (const t of [0.2, 0.5, 0.8]) {
      const p = F.toW(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      for (const r of roads) { const d = G.distToPolyline(p, r.pts).d - r.half; if (d < 30) best = Math.max(best, r.half * 2); }
    }
    out[k] = best;
  }
  return out;
}

// Nhà liên kế / biệt thự: 2 dãy quay lưng vào nhau dọc cạnh dài, nhà đầu hồi quay ra đường hai đầu, khoảng ngắt mỗi 60 m
function rowLots(F, o, type, score, add, notes) {
  const Lu = F.u1 - F.u0, Lv = F.v1 - F.v0;
  const W = Math.max(3, o.w), D = Math.max(6, o.d);
  const back = type === 'lk' ? o.back ?? 4 : 0;
  const floors = o.floors;
  const brk = type === 'lk' ? o.brk || 0 : 0;
  const brkW = floors >= 5 ? 6 : floors <= 3 ? 4 : 5;
  const unit = 2 * D + back, lane = Math.max(4, o.lane ?? 10);
  // các cụm 2 dãy quay lưng; ô sâu thì xếp nhiều cụm, chừa đường nội bộ giữa các cụm
  const bands = [];
  if (Lv >= 2 * unit + lane) {
    const m = Math.floor((Lv + lane) / (unit + lane)), uw = unit + (Lv - m * unit - (m - 1) * lane) / m; // phần dư làm sân sau rộng thêm
    for (let j = 0; j < m; j++) { const vs = F.v0 + j * (uw + lane); bands.push([{ a: vs, b: vs + D, front: 'v0' }, { a: vs + uw - D, b: vs + uw, front: 'v1' }]); }
    notes.push(`Chừa ${m - 1} đường nội bộ rộng ${lane} m giữa các cụm nhà`);
  } else if (Lv >= unit) {
    bands.push([{ a: F.v0, b: F.v0 + D, front: 'v0' }, { a: F.v1 - D, b: F.v1, front: 'v1' }]);
    if (Lv - unit > 8) notes.push(`Sân sau giữa hai dãy rộng ${Math.round(Lv - 2 * D)} m`);
  } else if (Lv >= D * 0.6) {
    const dd = Math.min(D, Lv), front = score.v1 > score.v0 ? 'v1' : 'v0';
    bands.push([front === 'v0' ? { a: F.v0, b: F.v0 + dd, front } : { a: F.v1 - dd, b: F.v1, front }]);
  } else { notes.push(`Ô đất hẹp hơn chiều sâu lô ${D} m`); return; }
  const lots = [];
  for (const rows of bands) {
    let ua = F.u0, ub = F.u1;
    const span = rows.length === 2 ? rows[1].b - rows[0].a : rows[0].b - rows[0].a, sv0 = rows[0].a;
    if (o.ends !== false && Lu >= 2 * D + 3 * W && span >= 2 * W) {
      const n = Math.floor((span + 1e-6) / W), Wn = span / n;
      for (const [e0, e1, front] of [[F.u0, F.u0 + D, 'u0'], [F.u1 - D, F.u1, 'u1']])
        for (let k = 0; k < n; k++) lots.push({ u0: e0, u1: e1, v0: sv0 + k * Wn, v1: sv0 + (k + 1) * Wn, front });
      ua += D; ub -= D;
    }
    const A = ub - ua;
    const per = brk > 0 ? Math.max(1, Math.floor((brk + 1e-6) / W)) : Infinity;
    const len = (n) => n * W + (n > 0 && per !== Infinity ? Math.floor((n - 1) / per) * brkW : 0);
    let n = Math.floor(A / W); while (n > 0 && len(n) > A + 1e-6) n--;
    if (n > 0) {
      const left = A - len(n);
      // phần dư nhỏ: nới đều bề rộng lô; dư nhiều: để đều hai đầu
      const Wn = left / n <= 0.12 * W ? W + left / n : W;
      const used = n * Wn + (per !== Infinity ? Math.floor((n - 1) / per) * brkW : 0);
      const st = ua + (A - used) / 2;
      for (const r of rows) for (let k = 0; k < n; k++) {
        const u = st + k * Wn + (per !== Infinity ? Math.floor(k / per) * brkW : 0);
        lots.push({ u0: u, u1: u + Wn, v0: r.a, v1: r.b, front: r.front });
      }
    }
  }
  for (const L of lots) {
    if (type === 'lk') { add(L.u0, L.v0, L.u1, L.v1, floors, 'house', { whole: true }); continue; }
    // biệt thự: lùi trước ≥ 3 m (phía đường), các phía còn lại ≥ 2 m, diện tích xây dựng theo tỷ lệ
    const fr = o.front ?? 3, sd = o.side ?? 2, cov = (o.cov || 55) / 100;
    let { u0, u1, v0, v1 } = L;
    if (L.front === 'v0') { v0 += fr; v1 -= sd; u0 += sd; u1 -= sd; }
    else if (L.front === 'v1') { v1 -= fr; v0 += sd; u0 += sd; u1 -= sd; }
    else if (L.front === 'u0') { u0 += fr; u1 -= sd; v0 += sd; v1 -= sd; }
    else { u1 -= fr; u0 += sd; v0 += sd; v1 -= sd; }
    const lotA = (L.u1 - L.u0) * (L.v1 - L.v0), maxA = cov * lotA;
    if ((u1 - u0) * (v1 - v0) > maxA) { // thu chiều sâu (phía sau nhà)
      if (L.front === 'v0') v1 = v0 + maxA / (u1 - u0); else if (L.front === 'v1') v0 = v1 - maxA / (u1 - u0);
      else if (L.front === 'u0') u1 = u0 + maxA / (v1 - v0); else u0 = u1 - maxA / (v1 - v0);
    }
    // lô phải nằm trong ô đất thì mới đặt nhà
    if (!add(L.u0, L.v0, L.u1, L.v1, 0, 'lot', { whole: true, probe: true })) continue;
    add(u0, v0, u1, v1, floors, 'house', { whole: true });
  }
}

// Chia khung theo chiều dài thành các khối (cách nhau g), mỗi khối dài tối đa maxL
function splitU(F, g, maxL) {
  const Lu = F.u1 - F.u0;
  const n = Math.max(1, Math.round((Lu + g) / (maxL + g)));
  const Lb = (Lu - (n - 1) * g) / n;
  return Array.from({ length: n }, (_, i) => ({ ua: F.u0 + i * (Lb + g), ub: F.u0 + i * (Lb + g) + Lb, first: i === 0, last: i === n - 1 }));
}
// cạnh có đường lớn nhất (để đặt khối đế / nhà dày hơn)
const mainSide = (score) => { const k = Object.keys(score).sort((a, b) => score[b] - score[a])[0]; return score[k] > 0 ? k : 'v0'; };
// chia một dải thành đoạn ≤ maxL, chừa khe gap ở giữa
function segs(a, b, maxL, gap) {
  const L = b - a; if (L <= maxL) return [[a, b]];
  const n = Math.ceil((L + gap) / (maxL + gap)), s = (L - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => [a + i * (s + gap), a + i * (s + gap) + s]);
}

function apartments(F, o, lim, score, add, notes) {
  const floors = o.fit ? Math.min(o.floors, lim.floors > 0 ? lim.floors : Infinity) : o.floors;
  if (floors < o.floors) notes.push(`Tầng cao theo khống chế của ô: ${floors} tầng`);
  const t = Math.max(10, o.t), g = spacing(floors), court = Math.max(g, 20), pod = Math.max(t, o.pod || t), podF = o.podF || 4;
  const Lv = F.v1 - F.v0;
  const main = mainSide(score);
  const form = o.form || 'san';
  if (form === 'san') { groups(F, o, o.fit ? floors : o.floors, score, add, notes); return; }
  if (false) {
    for (const blk of splitU(F, g, 130)) {
      if (blk.ub - blk.ua < 2 * t + court) continue;
      const th = { v0: t, v1: t, u0: t, u1: t };
      // khối đế dày hơn ở phía đường lớn
      if (main === 'v0' || main === 'v1' || (main === 'u0' && blk.first) || (main === 'u1' && blk.last)) th[main] = pod;
      const strip = (u0, v0, u1, v1, side) => {
        const thick = th[side];
        const along = side === 'v0' || side === 'v1';
        for (const [a, b] of segs(along ? u0 : v0, along ? u1 : v1, 75, 12)) {
          const [x0, x1, y0, y1] = along ? [a, b, v0, v1] : [u0, u1, a, b];
          if (thick > t) { // đế ở phía đường, tháp lùi phía trong
            const inner = { v0: [x0, y0 + thick - t, x1, y1], v1: [x0, y0, x1, y1 - thick + t], u0: [x0 + thick - t, y0, x1, y1], u1: [x0, y0, x1 - thick + t, y1] }[side];
            const outer = { v0: [x0, y0, x1, y0 + thick - t], v1: [x0, y1 - thick + t, x1, y1], u0: [x0, y0, x0 + thick - t, y1], u1: [x1 - thick + t, y0, x1, y1] }[side];
            add(...outer, podF, 'podium'); add(...inner, floors, 'tower');
          } else add(x0, y0, x1, y1, floors, 'tower');
        }
      };
      strip(blk.ua, F.v0, blk.ub, F.v0 + th.v0, 'v0');
      strip(blk.ua, F.v1 - th.v1, blk.ub, F.v1, 'v1');
      strip(blk.ua, F.v0 + th.v0, blk.ua + th.u0, F.v1 - th.v1, 'u0');
      strip(blk.ub - th.u1, F.v0 + th.v0, blk.ub, F.v1 - th.v1, 'u1');
    }
    return;
  }
  if (form === 'thap') {
    const a = t, b = Math.round(t * 1.6);
    const nu = Math.max(1, Math.floor((F.u1 - F.u0 + g) / (b + g))), nv = Math.max(1, Math.floor((Lv + g) / (a + g)));
    const ou = (F.u1 - F.u0 - (nu * b + (nu - 1) * g)) / 2, ov = (Lv - (nv * a + (nv - 1) * g)) / 2;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = F.u0 + ou + i * (b + g), v = F.v0 + ov + j * (a + g);
      add(u, v, u + b, v + a, floors, 'tower');
    }
    return;
  }
  if (form === 'san') notes.push('Ô đất chưa đủ rộng để làm sân trong: chuyển sang dải nhà song song');
  // dải nhà song song cạnh dài, cách nhau theo khoảng cách nhà cao tầng
  const tt = Math.min(t, Lv);
  const m = Math.max(1, Math.floor((Lv + g) / (tt + g)));
  const ov = (Lv - (m * tt + (m - 1) * g)) / 2;
  for (let j = 0; j < m; j++) {
    const v = F.v0 + ov + j * (tt + g);
    for (const [a, b] of segs(F.u0, F.u1, 75, 12)) add(a, v, b, v + tt, floors, 'tower');
  }
}

// Nhóm công trình quy mô khoảng 1 ha bao quanh sân trong, các nhóm cách nhau khoảng 25 m.
// Nhà rộng 20 m; cạnh giáp đường lớn rộng 30 m.
function groups(F, o, floors, score, add, notes) {
  const t = Math.max(10, o.t || 20), tB = Math.max(t, o.tBig || 30), gap = Math.max(6, o.gap ?? 25), grp = Math.max(40, o.grp || 100);
  const pos = Object.values(score).filter((x) => x > 0), mx = Math.max(0, ...pos), mn = pos.length ? Math.min(...pos) : 0;
  const big = (k) => score[k] > 0 && (score[k] >= 30 || (score[k] >= mx - 0.01 && mx > mn + 0.01));
  const cuts = (a, b) => { const L = b - a, n = Math.max(1, Math.round((L + gap) / (grp + gap))), sz = (L - (n - 1) * gap) / n; return Array.from({ length: n }, (_, i) => [a + i * (sz + gap), a + i * (sz + gap) + sz, i === 0, i === n - 1]); };
  let rings = 0;
  const cells = [];
  for (const cu of cuts(F.u0, F.u1)) for (const cv of cuts(F.v0, F.v1)) cells.push([...cu, ...cv]);
  const nPark = o.park > 0 && cells.length >= 4 ? Math.min(cells.length, Math.max(1, Math.ceil((cells.length * o.park) / 100 - 0.15))) : 0;
  const mu = (F.u0 + F.u1) / 2, mv = (F.v0 + F.v1) / 2;
  const parkSet = new Set(cells.map((c, i) => [i, Math.hypot((c[0] + c[1]) / 2 - mu, (c[4] + c[5]) / 2 - mv)]).sort((a, b) => a[1] - b[1]).slice(0, nPark).map((x) => x[0]));
  if (nPark) notes.push(`${nPark} nhóm ở giữa làm công viên (khoảng ${Math.round((nPark / cells.length) * 100)}% đất)`);
  for (const [ci, [ua, ub, fu, lu, va, vb, fv, lv]] of cells.entries()) {
    if (parkSet.has(ci)) { add(ua, va, ub, vb, 1, 'park'); continue; }
    const th = { v0: fv && big('v0') ? tB : t, v1: lv && big('v1') ? tB : t, u0: fu && big('u0') ? tB : t, u1: lu && big('u1') ? tB : t };
    const W = ub - ua, H = vb - va;
    if (W >= th.u0 + th.u1 + 15 && H >= th.v0 + th.v1 + 15) { // khối bao quanh sân trong, có khe mở ở cạnh dài
      rings++;
      const strip = (x0, y0, x1, y1, along) => { for (const [a, b] of segs(along ? x0 : y0, along ? x1 : y1, 80, 12)) along ? add(a, y0, b, y1, floors, 'tower') : add(x0, a, x1, b, floors, 'tower'); };
      strip(ua, va, ub, va + th.v0, true);
      strip(ua, vb - th.v1, ub, vb, true);
      strip(ua, va + th.v0, ua + th.u0, vb - th.v1, false);
      strip(ub - th.u1, va + th.v0, ub, vb - th.v1, false);
    } else if (H >= W) { // nhóm hẹp: dải nhà theo chiều dài
      const d = Math.min(W, Math.max(th.u0, th.u1)), x = th.u0 >= th.u1 ? ua : ub - d;
      for (const [a, b] of segs(va, vb, 80, 12)) add(x, a, x + d, b, floors, 'tower');
    } else {
      const d = Math.min(H, Math.max(th.v0, th.v1)), y = th.v0 >= th.v1 ? va : vb - d;
      for (const [a, b] of segs(ua, ub, 80, 12)) add(a, y, b, y + d, floors, 'tower');
    }
  }
  if (!rings && cells.length > nPark) notes.push('Ô đất hẹp: xếp dải nhà thay cho nhóm sân trong');
}

// Lưới đường nội bộ cho ô công nghiệp (khoảng 250–300 m, đường 25 m) chia ô thành các thửa mới; thửa giữa nhất làm công viên
export function industrialGrid(zone, o, roads, centerPark = true) {
  const F = mkFrameFor(zone.pts);
  const step = Math.max(80, o.grid || 275), rw = Math.max(6, o.roadW || 25);
  const Lu = F.u1 - F.u0, Lv = F.v1 - F.v0;
  const nu = Math.max(1, Math.round(Lu / step)), nv = Math.max(1, Math.round(Lv / step));
  if (nu * nv < 2) return null;
  // đầu mút các đường có sẵn chạm tới ranh ô (đường của ô bên cạnh): đặt đường mới thẳng hàng với chúng
  const cand = { 0: [], 1: [] };
  const ax = [F.toW(1, 0), F.toW(0, 1)].map((q) => { const o0 = F.toW(0, 0); return [q[0] - o0[0], q[1] - o0[1]]; });
  for (const r of roads) {
    const P = r.pts; if (!P || P.length < 2) continue;
    for (const [e, q] of [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]]) {
      const d = [e[0] - q[0], e[1] - q[1]], L = Math.hypot(d[0], d[1]) || 1;
      const near = G.distToPolyline(e, zone.pts, true).d;
      if (near > r.half + 40) continue;
      if (G.pointInPolygon(e, zone.pts) && near > 5) continue;
      const le = F.toL(e);
      for (const k of [0, 1]) { // đường chạy dọc trục v (k = 0) thì cắt tại u = hằng số
        const along = ax[1 - k], c = Math.abs((d[0] * along[0] + d[1] * along[1]) / L);
        if (c > Math.cos((20 * Math.PI) / 180)) cand[k].push(le[k]);
      }
    }
  }
  const place = (a, Ltot, n, list) => {
    const st = Ltot / n, cs = Array.from({ length: n + 1 }, (_, i) => a + i * st);
    const used = new Set();
    for (let i = 1; i < n; i++) {
      let best = null;
      for (const c of list) { const d = Math.abs(c - cs[i]); if (d < st * 0.4 && !used.has(c) && (!best || d < best.d)) best = { c, d }; }
      if (best && best.c - cs[i - 1] > st * 0.4 && a + Ltot - best.c > st * 0.4) { cs[i] = best.c; used.add(best.c); }
    }
    return cs;
  };
  const cu = place(F.u0, Lu, nu, cand[0]), cv = place(F.v0, Lv, nv, cand[1]);
  const L = zone.pts.map(F.toL);
  // đoạn giao của đường thẳng u = c (hoặc v = c) với ranh ô
  const span = (c, axis) => {
    const hits = [];
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length], A = a[axis], B = b[axis];
      if ((A - c) * (B - c) > 0 || A === B) continue;
      const t = (c - A) / (B - A); hits.push(a[1 - axis] + t * (b[1 - axis] - a[1 - axis]));
    }
    return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
  };
  const ext = (p, dir) => { // nối dài đến tim đường bao quanh nếu có
    let best = 0;
    for (const r of roads) { const d = G.distToPolyline(p, r.pts).d; if (d < r.half + 3) best = Math.max(best, Math.min(r.half, 30)); }
    return [p[0] + dir[0] * best, p[1] + dir[1] * best];
  };
  const out = { roads: [], plots: [], park: null };
  const mk = (a, b) => { const d = G.dist(a, b) || 1, dir = [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; out.roads.push([ext(a, [-dir[0], -dir[1]]), ext(b, dir)]); };
  for (let i = 1; i < nu; i++) { const sp = span(cu[i], 0); if (sp) mk(F.toW(cu[i], sp[0]), F.toW(cu[i], sp[1])); }
  for (let j = 1; j < nv; j++) { const sp = span(cv[j], 1); if (sp) mk(F.toW(sp[0], cv[j]), F.toW(sp[1], cv[j])); }
  const h = rw / 2, cz = G.centroid(zone.pts);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = cu[i] + (i ? h : -1), u1 = cu[i + 1] - (i < nu - 1 ? h : -1), v0 = cv[j] + (j ? h : -1), v1 = cv[j + 1] - (j < nv - 1 ? h : -1);
    const r = [F.toW(u0, v0), F.toW(u1, v0), F.toW(u1, v1), F.toW(u0, v1)];
    const pts = clipConvex(zone.pts, r);
    if (pts.length >= 3 && G.area(pts) > 200) out.plots.push(pts);
  }
  if (centerPark && o.park !== false && out.plots.length >= 3) {
    let bi = 0, bd = Infinity;
    out.plots.forEach((q, i) => { const d = G.dist(G.centroid(q), cz); if (d < bd) { bd = d; bi = i; } });
    out.park = out.plots.splice(bi, 1)[0];
  }
  return out;
}
function mkFrameFor(poly) { return frameOf(poly); }

function mixed(F, o, lim, score, add, notes) {
  const maxF = Math.min(o.floors, lim.floors > 0 ? lim.floors : Infinity);
  const pod = Math.max(15, o.pod || 30), podF = o.podF || 4, g = spacing(maxF);
  const Lv = F.v1 - F.v0, main = mainSide(score);
  const podium = [], cands = [];
  const P = (u0, v0, u1, v1, prio) => ({ r: [u0, v0, u1, v1], prio });
  for (const blk of splitU(F, Math.max(g, 20), 140)) {
    const Lb = blk.ub - blk.ua;
    const prio = (cu, cv) => (main === 'v0' && cv === 0) || (main === 'v1' && cv === 1) || (main === 'u0' && cu === 0 && blk.first) || (main === 'u1' && cu === 1 && blk.last) ? 1 : 0;
    if (Lb >= 2 * pod + 15 && Lv >= 2 * pod + 15) { // khối đế bao quanh sân trong, tháp ở các góc
      const u0 = blk.ua, u1 = blk.ub, v0 = F.v0, v1 = F.v1;
      for (const [cu, cv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const a = cu ? u1 - pod : u0, b = cv ? v1 - pod : v0;
        cands.push(P(a, b, a + pod, b + pod, prio(cu, cv)));
      }
      podium.push(P(u0 + pod, v0, u1 - pod, v0 + pod), P(u0 + pod, v1 - pod, u1 - pod, v1), P(u0, v0 + pod, u0 + pod, v1 - pod), P(u1 - pod, v0 + pod, u1, v1 - pod));
    } else { // ô nhỏ: một khối đế, tháp giữa cạnh đường chính
      const d = Math.min(pod, Lv), u0 = blk.ua, u1 = blk.ub;
      const along = main === 'u0' || main === 'u1' ? false : true;
      const v0 = main === 'v1' ? F.v1 - d : F.v0;
      if (along || Lb < pod) {
        const tw = Math.min(pod, Lb), tu = (u0 + u1) / 2 - tw / 2;
        cands.push(P(tu, v0, tu + tw, v0 + d, 1));
        podium.push(P(u0, v0, tu, v0 + d), P(tu + tw, v0, u1, v0 + d));
        if (Lv - d > 2 * 15) podium.push(P(u0, v0 === F.v0 ? F.v0 + d : F.v0, u1, v0 === F.v0 ? F.v1 : F.v1 - d));
      } else {
        const a = main === 'u0' ? u0 : u1 - pod;
        cands.push(P(a, F.v0 + (Lv - Math.min(pod, Lv)) / 2, a + pod, F.v0 + (Lv + Math.min(pod, Lv)) / 2, 1));
        podium.push(P(u0, F.v0, u1, F.v1));
      }
    }
  }
  cands.sort((a, b) => b.prio - a.prio);
  // số tháp và tầng cao để đạt gần hệ số SDĐ cho phép
  const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
  const podA = podium.reduce((s, p) => s + area(p.r), 0) + cands.reduce((s, p) => s + area(p.r), 0);
  const target = (lim.far > 0 ? lim.far * F.zarea : Infinity);
  let nT = 0, tf = maxF;
  if (cands.length) {
    const rest = target - podA * podF; // sàn còn lại cho phần tháp (trên đế)
    if (rest === Infinity) { nT = Math.min(2, cands.length); }
    else if (rest > 0) {
      for (nT = 1; nT <= cands.length; nT++) {
        const ta = cands.slice(0, nT).reduce((s, p) => s + area(p.r), 0);
        tf = Math.floor(podF + rest / ta);
        if (tf <= maxF) break;
      }
      nT = Math.min(nT, cands.length); tf = Math.min(maxF, Math.max(podF + 1, tf));
    }
  }
  cands.forEach((c, i) => {
    if (i < nT) add(...c.r, tf, 'tower');
    else add(...c.r, podF, 'podium');
  });
  for (const p of podium) add(...p.r, podF, 'podium');
  if (!nT) notes.push('Hệ số SDĐ chỉ đủ cho khối đế, chưa đặt tháp');
}

function industry(F, o, add, notes, B6) {
  const fw = Math.max(10, o.fw), fd = Math.max(10, o.fd), gap = Math.max(6, o.gap), auxD = o.aux === false ? 0 : 12, auxW = 20, yard = auxD ? 6 : 0;
  const Lu = F.u1 - F.u0, Lv = F.v1 - F.v0;
  const M = auxD + yard + fd;
  let cu = Math.floor((Lu + gap) / (fw + gap)), cv = Math.floor((Lv + gap) / (M + gap));
  let W = fw, Dd = fd;
  if (!cu || !cv) { // ô nhỏ: một nhà xưởng vừa ô
    cu = cv = 1; W = Math.min(fw, Lu * 0.85); Dd = Math.min(fd, Math.max(8, Lv * 0.85 - auxD - yard));
    notes.push('Ô đất nhỏ: một nhà xưởng thu gọn');
  }
  else { // nới xưởng cho kín ô (không quá 1,5 lần kích thước đặt)
    W = Math.min(fw * 1.5, (Lu - (cu - 1) * gap) / cu);
    Dd = Math.min(fd * 1.5, (Lv - (cv - 1) * gap) / cv - auxD - yard);
  }
  const MM = auxD + yard + Dd;
  const ou = (Lu - (cu * W + (cu - 1) * gap)) / 2, ov = (Lv - (cv * MM + (cv - 1) * gap)) / 2;
  for (let i = 0; i < cu; i++) for (let j = 0; j < cv; j++) {
    const u = F.u0 + ou + i * (W + gap), v = F.v0 + ov + j * (MM + gap);
    const f = add(u, v + auxD + yard, u + W, v + MM, o.floors || 5, 'factory', { floorH: 4.5, ...(B6 ? { within: B6 } : {}) });
    if (f && auxD) add(u, v, u + Math.min(auxW, W), v + auxD, o.auxF || 2, 'aux', { floorH: 3.6 });
  }
}

function civic(F, o, lim, score, add, notes, zarea) {
  const floors = Math.min(o.floors, lim.floors > 0 ? lim.floors : Infinity);
  const t = Math.max(8, o.t), Lu = F.u1 - F.u0, Lv = F.v1 - F.v0, main = mainSide(score);
  if (Lu >= 2 * t + 20 && Lv >= 2 * t + 20) { // khối chữ U mở ra phía sau, mặt chính ra đường lớn
    const open = { v0: 'v1', v1: 'v0', u0: 'u1', u1: 'u0' }[main];
    const sides = { v0: [F.u0, F.v0, F.u1, F.v0 + t], v1: [F.u0, F.v1 - t, F.u1, F.v1], u0: [F.u0, F.v0 + t, F.u0 + t, F.v1 - t], u1: [F.u1 - t, F.v0 + t, F.u1, F.v1 - t] };
    for (const [k, r] of Object.entries(sides)) if (k !== open) add(...r, floors, 'block');
    return;
  }
  // khối đơn ở giữa, diện tích theo mật độ cho phép
  const maxA = (lim.mdxd > 0 ? lim.mdxd / 100 : 0.4) * zarea * 0.9;
  let w = Lu * 0.8, d = Lv * 0.8;
  if (w * d > maxA) { const k = Math.sqrt(maxA / (w * d)); w *= k; d *= k; }
  const cu = (F.u0 + F.u1) / 2, cv = (F.v0 + F.v1) / 2;
  add(cu - w / 2, cv - d / 2, cu + w / 2, cv + d / 2, floors, 'block');
}

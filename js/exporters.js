// Xuất file: GeoJSON, DXF, SVG, PNG, OBJ, GLB, USDZ. Nhập: GeoJSON, DXF, ảnh nền.
import * as G from './geom.js';
import { ICONS } from './icons.js';
import { vnToLL, llToVN } from './vn2000.js';
import { junctionCorners } from './roadops.js';
import { LANDUSE, KIND_LAYER, KIND_NAMES, roadTotalWidth, itemArea, uid, lotNumbering, landTrees, LAND_CLOSED, LAND_COLORS } from './model.js';

const R_EARTH = 6378137;
// Toạ độ địa lý <-> mét cục bộ quanh gốc (lat0, lon0). y thế giới hướng Nam.
// vn: settings.vn2000 = { lon0 (kinh tuyến trục), e0, n0 } -> toạ độ bản vẽ là VN-2000 dời gốc: x = Y - e0, y = -(X - n0)
export function toLonLat(p, lat0, lon0, vn) {
  if (vn && vn.e0 != null) { const ll = vnToLL(vn.n0 - p[1], vn.e0 + p[0], vn.lon0); return [+ll[1].toFixed(8), +ll[0].toFixed(8)]; }
  const lat = lat0 + (-p[1] / R_EARTH) * (180 / Math.PI);
  const lon = lon0 + (p[0] / (R_EARTH * Math.cos((lat0 * Math.PI) / 180))) * (180 / Math.PI);
  return [+lon.toFixed(8), +lat.toFixed(8)];
}
export function fromLonLat(ll, lat0, lon0, vn) {
  if (vn && vn.e0 != null) { const r = llToVN(ll[1], ll[0], vn.lon0); return [r[1] - vn.e0, -(r[0] - vn.n0)]; }
  const x = ((ll[0] - lon0) * Math.PI / 180) * R_EARTH * Math.cos((lat0 * Math.PI) / 180);
  const y = -((ll[1] - lat0) * Math.PI / 180) * R_EARTH;
  return [x, y];
}

function itemPolygon(it) {
  if (it.kind === 'road') return G.bandPolygon(it.pts, roadTotalWidth(it) / 2);
  if (it.kind === 'water' && it.props.mode === 'river') return G.bandPolygon(it.pts, it.props.width / 2);
  return it.pts;
}

export function toGeoJSON(doc, metrics) {
  const s = doc.settings;
  const geo = s.georef;
  const conv = (p) => (geo ? toLonLat(p, s.lat, s.lon, s.vn2000) : [+p[0].toFixed(3), +(-p[1]).toFixed(3)]);
  const ring = (pts) => { const r = pts.map(conv); r.push(r[0]); return r; };
  const features = [];
  const lotNames = lotNumbering(doc.items.filter((i) => i.kind === 'zone'));
  for (const it of doc.items) {
    const props = { loai: KIND_NAMES[it.kind] || it.kind, kind: it.kind, lop: KIND_LAYER[it.kind], ...flatProps(it) };
    if (it.kind === 'zone') props.so_hieu_lo = it.props.name || lotNames[it.id];
    let geometry;
    if (it.kind === 'icon') {
      props.bieu_tuong = (ICONS[it.props.sym] || ICONS.pin).name;
      geometry = { type: 'Point', coordinates: conv(it.pts[0]) };
    } else if (it.kind === 'circle') {
      const c = it.pts[0], n = 64, pts = [];
      for (let i = 0; i < n; i++) pts.push([c[0] + Math.cos((i / n) * 6.283) * it.props.radius, c[1] + Math.sin((i / n) * 6.283) * it.props.radius]);
      geometry = { type: 'Polygon', coordinates: [ring(pts)] };
    } else if (it.kind === 'land' && it.props.style === 'tree') {
      geometry = { type: 'Point', coordinates: conv(it.pts[0]) };
    } else if (['arrow', 'flow', 'sketch'].includes(it.kind) || (it.kind === 'cad' && !it.closed) || (it.kind === 'land' && !LAND_CLOSED[it.props.style])) {
      geometry = { type: 'LineString', coordinates: it.pts.map(conv) };
    } else if (it.kind === 'road' || (it.kind === 'water' && it.props.mode === 'river')) {
      features.push({ type: 'Feature', properties: { ...props, phan: 'tim' }, geometry: { type: 'LineString', coordinates: it.pts.map(conv) } });
      geometry = { type: 'Polygon', coordinates: [ring(itemPolygon(it))] };
    } else {
      geometry = { type: 'Polygon', coordinates: [ring(it.pts), ...(it.holes || []).map(ring)] };
    }
    features.push({ type: 'Feature', properties: props, geometry });
  }
  const out = { type: 'FeatureCollection', name: doc.name, features };
  if (!geo) out.crs_ghichu = 'Toạ độ cục bộ (mét), trục Y hướng Bắc. Bật "Định vị bản vẽ" trong Cài đặt để xuất kinh độ/vĩ độ WGS84.';
  if (metrics) out.chitieu = { tongDienTich_m2: Math.round(metrics.total), matDoXayDung_pct: +metrics.mdxd.toFixed(2), heSoSDD: +metrics.far.toFixed(2) };
  return JSON.stringify(out, null, 1);
}

function flatProps(it) {
  const p = { ...it.props }; delete p.preset;
  if (it.kind === 'zone') { p.ten_chuc_nang = (LANDUSE[p.code] || {}).name; }
  if (it.kind === 'building') { p.chieu_cao_m = +((p.floors || 1) * (p.floorH || 3.3)).toFixed(2); p.san_xd_m2 = +(itemArea(it) * (p.floors || 1)).toFixed(1); }
  p.dien_tich_m2 = +itemArea(it).toFixed(1);
  return p;
}

// DXF R12 (mở được bằng AutoCAD, Civil 3D, QGIS…), trục Y hướng Bắc
const DXF_LAYERS = { cad: 'QP_0_NEN', water: 'QP_1_SONG_HO', road: 'QP_2_GIAO_THONG', zone: 'QP_3_SDD', park: 'QP_7_CANH_QUAN', land: 'QP_7_CANH_QUAN', building: 'QP_6_CONG_TRINH', arrow: 'QP_4_SO_DO', flow: 'QP_4_SO_DO', circle: 'QP_4_SO_DO', cloud: 'QP_4_SO_DO', icon: 'QP_4_BIEU_TUONG', sketch: 'QP_5_NHAP' };
const DXF_COLORS = { QP_0_NEN: 8, QP_1_SONG_HO: 5, QP_2_GIAO_THONG: 9, QP_3_SDD: 2, QP_7_CANH_QUAN: 3, QP_6_CONG_TRINH: 7, QP_4_SO_DO: 1, QP_4_BIEU_TUONG: 6, QP_5_NHAP: 250, QP_TIM_DUONG: 1, QP_CHU: 7 };
export function toDXF(doc) {
  const L = [];
  const lotNames = lotNumbering(doc.items.filter((i) => i.kind === 'zone'));
  const w = (...a) => L.push(...a.map(String));
  w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, Object.keys(DXF_COLORS).length);
  for (const [n, c] of Object.entries(DXF_COLORS)) w(0, 'LAYER', 2, n, 70, 0, 62, c, 6, 'CONTINUOUS');
  w(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  // bản vẽ đặt theo VN-2000: xuất đúng toạ độ VN-2000 (X Bắc, Y Đông) để chồng khớp bản đồ địa chính
  const vn = doc.settings && doc.settings.vn2000, OX = vn ? vn.e0 : 0, OY = vn ? vn.n0 : 0;
  const poly = (layer, pts, closed, elev = 0) => {
    w(0, 'POLYLINE', 8, layer, 66, 1, 10, 0, 20, 0, 30, elev, 70, closed ? 1 : 0);
    for (const p of pts) w(0, 'VERTEX', 8, layer, 10, (p[0] + OX).toFixed(3), 20, (OY - p[1]).toFixed(3), 30, elev);
    w(0, 'SEQEND', 8, layer);
  };
  const text = (layer, p, h, s) => w(0, 'TEXT', 8, layer, 10, (p[0] + OX).toFixed(3), 20, (OY - p[1]).toFixed(3), 30, 0, 40, h, 1, s, 72, 1, 11, (p[0] + OX).toFixed(3), 21, (OY - p[1]).toFixed(3), 31, 0);
  for (const it of doc.items) {
    const layer = DXF_LAYERS[it.kind] || 'QP_0_NEN';
    if (it.kind === 'circle') { w(0, 'CIRCLE', 8, layer, 10, (it.pts[0][0] + OX).toFixed(3), 20, (OY - it.pts[0][1]).toFixed(3), 30, 0, 40, it.props.radius); continue; }
    if (it.kind === 'icon') { const sz = it.props.size || 20; w(0, 'CIRCLE', 8, layer, 10, (it.pts[0][0] + OX).toFixed(3), 20, (OY - it.pts[0][1]).toFixed(3), 30, 0, 40, sz / 2); text(layer, it.pts[0], sz / 4, it.props.label || (ICONS[it.props.sym] || ICONS.pin).name); continue; }
    if (it.kind === 'road' || (it.kind === 'water' && it.props.mode === 'river')) {
      poly('QP_TIM_DUONG', it.pts, false);
      const half = (it.kind === 'road' ? roadTotalWidth(it) : it.props.width) / 2;
      const { L: a, R: b } = G.offsetSides(it.pts, half);
      poly(layer, a, false); poly(layer, b, false);
      if (it.kind === 'road') { const s = G.offsetSides(it.pts, it.props.width / 2); poly(layer, s.L, false); poly(layer, s.R, false); }
      continue;
    }
    if (it.kind === 'junction') { for (const c of junctionCorners(doc, it)) { if (c.chamfer) poly('QP_2_GIAO_THONG', c.chamfer.slice(1), false); if (c.curb) poly('QP_2_GIAO_THONG', c.curb, false); } continue; }
    if (it.kind === 'land') { if (LAND_CLOSED[it.props.style]) poly(layer, it.pts, true); else if (it.pts.length > 1) poly(layer, it.pts, false); for (const q of landTrees(it)) w(0, 'CIRCLE', 8, layer, 10, q[0].toFixed(3), 20, (-q[1]).toFixed(3), 30, 0, 40, (it.props.size || 6) / 2); continue; }
    const closed = !['arrow', 'flow', 'sketch'].includes(it.kind) && !(it.kind === 'cad' && !it.closed);
    poly(layer, it.pts, closed);
    for (const h of it.holes || []) poly(layer, h, true);
    if (it.kind === 'zone') text('QP_CHU', G.centroid(it.pts), 3, it.props.name || lotNames[it.id] || it.props.code);
    if (it.kind === 'building') text('QP_CHU', G.centroid(it.pts), 2, (it.props.floors || 1) + 'T');
  }
  w(0, 'ENDSEC', 0, 'EOF');
  return L.join('\r\n');
}

// SVG mặt bằng (dùng chung bộ vẽ 2D qua canvas -> PNG; SVG vẽ riêng dạng vector)
export function toSVG(doc) {
  const all = doc.items.flatMap((i) => (i.kind === 'circle' ? [[i.pts[0][0] - i.props.radius, i.pts[0][1] - i.props.radius], [i.pts[0][0] + i.props.radius, i.pts[0][1] + i.props.radius]] : i.pts));
  const bb = all.length ? G.bbox(all) : { x0: 0, y0: 0, x1: 100, y1: 100 };
  const pad = 20, W = bb.x1 - bb.x0 + pad * 2, H = bb.y1 - bb.y0 + pad * 2;
  const P = (pts) => pts.map((p) => `${(p[0] - bb.x0 + pad).toFixed(2)},${(p[1] - bb.y0 + pad).toFixed(2)}`).join(' ');
  const d = (pts, closed) => 'M' + P(pts).replace(/ /g, ' L') + (closed ? ' Z' : '');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" width="${W.toFixed(0)}mm" height="${H.toFixed(0)}mm" font-family="Arial, sans-serif">`, `<rect width="100%" height="100%" fill="#fff"/>`];
  const lay = Object.fromEntries(doc.layers.map((l) => [l.id, l]));
  const vis = (k) => { const l = lay[KIND_LAYER[k]]; return !l || l.visible; };
  const items = (k) => doc.items.filter((i) => i.kind === k && vis(k));
  out.push('<g id="CAD" fill="none" stroke="#6b7c8f" stroke-width="0.3">', ...items('cad').map((i) => `<path d="${d(i.pts, i.closed)}"/>`), '</g>');
  out.push('<g id="SDD">', ...items('zone').map((z) => `<path d="${d(z.pts, true)}" fill="${(LANDUSE[z.props.code] || LANDUSE.ODT).color}" stroke="#7a6a3a" stroke-width="0.3"/>`), '</g>');
  out.push('<g id="VatLieuPhu">', ...items('cover').map((c) => `<path d="${d(c.pts, true)}${(c.holes || []).map((h) => ' ' + d(h, true)).join('')}" fill="${c.props.color || '#d9cdb4'}" fill-rule="evenodd" stroke="#8a7a5a" stroke-width="0.2"/>`), '</g>');
  out.push('<g id="CanhQuan">', ...items('park').map((z) => `<path d="${d(z.pts, true)}" fill="#8fd17a" stroke="#4f9a45" stroke-width="0.4"/>`),
    ...items('land').filter((z) => LAND_CLOSED[z.props.style]).map((z) => `<path d="${d(z.pts, true)}" fill="${LAND_COLORS[z.props.style]}" stroke="#5f9a4d" stroke-width="0.3"/>`),
    ...items('land').flatMap((z) => landTrees(z).map((q) => { const c = P([q]).split(','); return `<circle cx="${c[0]}" cy="${c[1]}" r="${(z.props.size || 6) / 2}" fill="#5aa64a" stroke="#2f6b2a" stroke-width="0.3"/>`; })), '</g>');
  out.push('<g id="SongHo">', ...items('water').map((wt) => wt.props.mode === 'river'
    ? `<polyline points="${P(wt.pts)}" fill="none" stroke="#8ec9ec" stroke-width="${wt.props.width}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${d(wt.pts, true)}" fill="#8ec9ec" stroke="#3d8fc4" stroke-width="0.4"/>`), '</g>');
  const roads = items('road');
  out.push('<g id="GiaoThong" fill="none" stroke-linecap="round" stroke-linejoin="round">',
    ...roads.map((r) => `<polyline points="${P(r.pts)}" stroke="#e9e4da" stroke-width="${roadTotalWidth(r)}"/>`),
    ...roads.map((r) => `<polyline points="${P(r.pts)}" stroke="${r.props.ped ? '#efe2c4' : '#59626d'}" stroke-width="${r.props.width}"/>`),
    ...roads.filter((r) => !r.props.ped).map((r) => `<polyline points="${P(r.pts)}" stroke="#f4f1e8" stroke-width="0.25" stroke-dasharray="3 3"/>`), '</g>');
  out.push('<g id="CongTrinh">', ...items('building').map((b) => `<path d="${d(b.pts, true)}${(b.holes || []).map((h) => ' ' + d(h, true)).join('')}" fill="#fff" fill-rule="evenodd" stroke="#1d2a3a" stroke-width="0.5"/>`), '</g>');
  out.push('<g id="SoDo" fill="none">');
  for (const it of doc.items.filter((i) => (KIND_LAYER[i.kind] === 4 || KIND_LAYER[i.kind] === 5) && vis(i.kind))) {
    const col = it.props.color || ({ arrow: '#d9381e', flow: '#1f7a3a', circle: '#7b3fe4', cloud: '#c2410c' })[it.kind];
    if (it.kind === 'circle') { const c = P([it.pts[0]]).split(','); const lw = (it.props.width || 2) / 2; out.push(`<circle cx="${c[0]}" cy="${c[1]}" r="${it.props.radius}" stroke="${col}" stroke-width="${lw}" ${it.props.dash !== false ? `stroke-dasharray="${lw * 4} ${lw * 3}"` : ''}/>`); }
    else if (it.kind === 'icon') {
      const ic = ICONS[it.props.sym] || ICONS.pin; const c = P([it.pts[0]]).split(',').map(Number); const sz = it.props.size || 20; const icol = it.props.color || ic.color;
      if (ic.text) out.push(`<g><rect x="${c[0] - sz / 2}" y="${c[1] - sz / 2}" width="${sz}" height="${sz}" rx="${sz * 0.18}" fill="${icol}" stroke="#fff" stroke-width="${sz * 0.05}"/><text x="${c[0]}" y="${c[1] + sz * 0.2}" font-size="${sz * (ic.text.length > 2 ? 0.36 : ic.text.length > 1 ? 0.46 : 0.62)}" font-weight="800" text-anchor="middle" fill="#fff">${ic.text}</text></g>`);
      else out.push(`<path transform="translate(${c[0] - sz / 2} ${c[1] - sz / 2}) scale(${sz / 24})" d="${ic.d}" fill="${icol}" fill-rule="evenodd" stroke="#fff" stroke-width="1"/>`);
    }
    else if (it.kind === 'cloud') out.push(`<path d="${d(it.pts, true)}" stroke="${col}" stroke-width="1"/>`);
    else if (it.kind === 'sketch') out.push(`<polyline points="${P(it.pts)}" stroke="${it.props.color || '#111827'}" stroke-width="${(it.props.width || 1).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    else out.push(`<polyline points="${P(it.pts)}" stroke="${col}" stroke-width="${((it.props.width || (it.kind === 'arrow' ? 8 : 3)) * (it.kind === 'arrow' ? 0.375 : 0.5)).toFixed(2)}" ${it.kind === 'flow' ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#mt)"/>`);
  }
  out.push('</g>');
  out.push(`<g id="Chu" font-size="4" text-anchor="middle" fill="#3b2f10">`, ...((ln) => items('zone').map((z) => { const c = P([G.centroid(z.pts)]).split(','); return `<text x="${c[0]}" y="${c[1]}">${esc(z.props.name || ln[z.id] || z.props.code)}</text>`; }))(lotNumbering(doc.items.filter((i) => i.kind === 'zone'))), '</g>');
  out.splice(1, 0, '<defs><marker id="mt" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>');
  out.push('</svg>');
  return out.join('\n');
}
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// ---------- Nhập ----------
export function parseDXF(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const out = [];
  let i = 0;
  // chỉ đọc phần ENTITIES
  while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES')) i++;
  let cur = null;
  const TYPES = new Set(['LWPOLYLINE', 'POLYLINE', 'LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE']);
  const D2R = Math.PI / 180;
  // số đoạn chia cung: sai số dây cung ≤ 2 cm, bước tối đa 5°
  const segN = (r, sweep) => { const e = Math.min(5 * D2R, r > 0.02 ? 2 * Math.acos(1 - 0.02 / r) : 5 * D2R); return Math.max(2, Math.min(512, Math.ceil(Math.abs(sweep) / Math.max(e, 0.2 * D2R)))); };
  // cung từ tâm, bán kính, góc đầu, góc quét (rad) — toạ độ OCS (y hướng lên)
  const arc = (P, cx, cy, r, a0, sw, skipFirst) => { const n = segN(r, sw); for (let k = skipFirst ? 1 : 0; k <= n; k++) { const t = a0 + (sw * k) / n; P.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } };
  // đoạn có độ phình (bulge) giữa hai đỉnh của polyline
  const bulgeSeg = (P, a, b, bu) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], c = Math.hypot(dx, dy);
    if (!bu || Math.abs(bu) < 1e-9 || c < 1e-9) { P.push([b[0], b[1]]); return; }
    const th = 4 * Math.atan(bu), h = (c / 2) * (1 - bu * bu) / (2 * bu);
    const cx = (a[0] + b[0]) / 2 - (dy / c) * h, cy = (a[1] + b[1]) / 2 + (dx / c) * h, r = Math.hypot(a[0] - cx, a[1] - cy);
    arc(P, cx, cy, r, Math.atan2(a[1] - cy, a[0] - cx), th, true);
    P[P.length - 1] = [b[0], b[1]];
  };
  // B-spline (có thể hữu tỉ) theo thuật toán de Boor
  const spline = (e) => {
    const p = e.deg || 3, C = e.ctrl, U = e.knots, W = e.w.length === C.length ? e.w : null;
    if (C.length < 2) { if (e.fit.length >= 2) return G.catmullRom(e.fit, 8, e.closed); return []; }
    if (U.length !== C.length + p + 1) return C.slice(); // nút sai: dùng đa giác điều khiển
    const lo = U[p], hi = U[C.length], n = Math.max(16, Math.min(600, C.length * 10)), P = [];
    for (let s = 0; s <= n; s++) {
      const t = s === n ? hi - 1e-9 * (hi - lo) : lo + ((hi - lo) * s) / n;
      let k = p; while (k < C.length - 1 && U[k + 1] <= t) k++;
      const d = []; for (let j = 0; j <= p; j++) { const q = C[k - p + j], w = W ? W[k - p + j] : 1; d.push([q[0] * w, q[1] * w, w]); }
      for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) { const i0 = k - p + j, den = U[i0 + p - r + 1] - U[i0], al = den > 1e-12 ? (t - U[i0]) / den : 0; for (let m = 0; m < 3; m++) d[j][m] = (1 - al) * d[j - 1][m] + al * d[j][m]; }
      const q = d[p]; P.push([q[0] / q[2], q[1] / q[2]]);
    }
    return P;
  };
  const flush = () => {
    const e = cur; cur = null; if (!e) return;
    let P = [];
    if (e.type === 'ARC' || e.type === 'CIRCLE') {
      if (!(e.r > 0)) return;
      if (e.type === 'CIRCLE') { arc(P, e.cx, e.cy, e.r, 0, 2 * Math.PI, false); P.pop(); e.closed = true; }
      else { let a1 = e.a1; if (a1 <= e.a0) a1 += 360; arc(P, e.cx, e.cy, e.r, e.a0 * D2R, (a1 - e.a0) * D2R, false); }
    } else if (e.type === 'ELLIPSE') {
      const M = [e.mx, e.my], L = Math.hypot(M[0], M[1]); if (!(L > 0)) return;
      const m = [-M[1] * e.ratio, M[0] * e.ratio]; let t0 = e.t0, t1 = e.t1; if (t1 <= t0) t1 += 2 * Math.PI;
      const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6, n = segN(L, t1 - t0);
      for (let k = 0; k < (full ? n : n + 1); k++) { const t = t0 + ((t1 - t0) * k) / n; P.push([e.cx + M[0] * Math.cos(t) + m[0] * Math.sin(t), e.cy + M[1] * Math.cos(t) + m[1] * Math.sin(t)]); }
      if (full) e.closed = true;
    } else if (e.type === 'SPLINE') {
      P = spline(e);
      if (e.closed && P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6) P.pop();
    } else if (e.type === 'LINE') {
      if (!e.a || !e.b) return; P = [e.a, e.b];
    } else { // LWPOLYLINE / POLYLINE: đỉnh + độ phình
      const V = e.verts; if (V.length < 2 && !(V.length === 1)) return;
      if (!V.length) return;
      P.push([V[0].x, V[0].y]);
      for (let k = 0; k + 1 < V.length; k++) bulgeSeg(P, [V[k].x, V[k].y], [V[k + 1].x, V[k + 1].y], V[k].b);
      if (e.closed && V.length > 2) { const a = V[V.length - 1]; if (a.b) { bulgeSeg(P, [a.x, a.y], [V[0].x, V[0].y], a.b); P.pop(); } }
      if (e.closed && P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-9) P.pop();
    }
    // hướng pháp tuyến (0,0,-1) (đối tượng bị lật trong CAD): trục X của hệ toạ độ đối tượng ngược với X thật
    const fx = e.flip && e.type !== 'LINE' ? -1 : 1;
    P = P.map((q) => [q[0] * fx, -q[1]]);
    if (P.length >= 2) out.push({ pts: P, closed: e.closed, curved: e.type !== 'LINE' && (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE' || e.verts.some((v) => v.b)) });
  };
  for (; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      if (v === 'VERTEX' && cur && cur.type === 'POLYLINE') { cur.v = { x: 0, y: 0, b: 0, skip: false }; cur.verts.push(cur.v); continue; }
      if (v === 'SEQEND') { if (cur) cur.verts = cur.verts.filter((q) => !q.skip); flush(); continue; }
      if (cur && cur.type !== 'POLYLINE') flush();
      if (TYPES.has(v)) cur = { type: v, verts: [], closed: false, v: null, cx: 0, cy: 0, r: 0, a0: 0, a1: 360, mx: 0, my: 0, ratio: 1, t0: 0, t1: 2 * Math.PI, deg: 3, ctrl: [], fit: [], knots: [], w: [] };
      else if (v === 'ENDSEC') { flush(); break; }
      continue;
    }
    if (!cur) continue;
    const f = parseFloat(v);
    if (c === 230 && !cur.v && f < 0) cur.flip = true;
    switch (cur.type) {
      case 'ARC': case 'CIRCLE':
        if (c === 10) cur.cx = f; else if (c === 20) cur.cy = f; else if (c === 40) cur.r = f; else if (c === 50) cur.a0 = f; else if (c === 51) cur.a1 = f;
        break;
      case 'ELLIPSE':
        if (c === 10) cur.cx = f; else if (c === 20) cur.cy = f; else if (c === 11) cur.mx = f; else if (c === 21) cur.my = f; else if (c === 40) cur.ratio = f; else if (c === 41) cur.t0 = f; else if (c === 42) cur.t1 = f;
        break;
      case 'SPLINE':
        if (c === 70) cur.closed = (parseInt(v, 10) & 1) === 1; else if (c === 71) cur.deg = parseInt(v, 10);
        else if (c === 40) cur.knots.push(f); else if (c === 41) cur.w.push(f);
        else if (c === 10) cur.ctrl.push([f, 0]); else if (c === 20 && cur.ctrl.length) cur.ctrl[cur.ctrl.length - 1][1] = f;
        else if (c === 11) cur.fit.push([f, 0]); else if (c === 21 && cur.fit.length) cur.fit[cur.fit.length - 1][1] = f;
        break;
      case 'LWPOLYLINE':
        if (c === 70) cur.closed = (parseInt(v, 10) & 1) === 1;
        else if (c === 10) cur.verts.push({ x: f, y: 0, b: 0 }); else if (c === 20 && cur.verts.length) cur.verts[cur.verts.length - 1].y = f;
        else if (c === 42 && cur.verts.length) cur.verts[cur.verts.length - 1].b = f;
        break;
      case 'POLYLINE':
        if (!cur.v) { if (c === 70) cur.closed = (parseInt(v, 10) & 1) === 1; }
        else if (c === 10) cur.v.x = f; else if (c === 20) cur.v.y = f; else if (c === 42) cur.v.b = f; else if (c === 70) cur.v.skip = (parseInt(v, 10) & 16) === 16; // đỉnh điều khiển spline-fit: bỏ
        break;
      case 'LINE':
        if (c === 10) cur.a = [f, 0]; else if (c === 20 && cur.a) cur.a[1] = f; else if (c === 11) cur.b = [f, 0]; else if (c === 21 && cur.b) cur.b[1] = f;
        break;
    }
  }
  flush();
  return dropOutliers(out.filter((e) => e.pts.every((p) => p && isFinite(p[0]) && isFinite(p[1]))).map((e) => ({ pts: e.pts, closed: e.closed })));
}
// Bỏ các nét nằm lạc rất xa phần chính của bản vẽ (rác CAD, nét bị lật toạ độ…): chúng làm khung bản vẽ to ra hàng trăm km, hình chính bé tí
function dropOutliers(shapes) {
  if (shapes.length < 5) return shapes;
  const bb = G.robustBBox(shapes.map((s) => s.pts));
  const keep = shapes.filter((s) => s.pts.every((p) => p[0] >= bb.x0 && p[0] <= bb.x1 && p[1] >= bb.y0 && p[1] <= bb.y1));
  keep.dropped = shapes.length - keep.length;
  return keep;
}

export function parseGeoJSON(text, settings) {
  const gj = JSON.parse(text);
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj }];
  const lines = [];
  const coords = [];
  const walk = (g) => {
    if (!g) return;
    const t = g.type, c = g.coordinates;
    if (t === 'LineString') lines.push({ c, closed: false });
    else if (t === 'MultiLineString') c.forEach((l) => lines.push({ c: l, closed: false }));
    else if (t === 'Polygon') c.forEach((r) => lines.push({ c: r, closed: true }));
    else if (t === 'MultiPolygon') c.forEach((p) => p.forEach((r) => lines.push({ c: r, closed: true })));
    else if (t === 'GeometryCollection') g.geometries.forEach(walk);
  };
  feats.forEach((f) => walk(f.geometry));
  lines.forEach((l) => coords.push(...l.c));
  if (!coords.length) return { shapes: [] };
  const isLL = coords.every((p) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
  let lat0 = settings.lat, lon0 = settings.lon, setGeo = null;
  if (isLL && !settings.vn2000) {
    const bb = G.bbox(coords);
    lon0 = (bb.x0 + bb.x1) / 2; lat0 = (bb.y0 + bb.y1) / 2;
    setGeo = { lat: lat0, lon: lon0 };
  }
  const shapes = lines.map((l) => {
    let pts = l.c.map((p) => (isLL ? fromLonLat(p, lat0, lon0, settings.vn2000) : settings.vn2000 && Math.abs(p[0]) > 1e5 ? [p[0] - settings.vn2000.e0, -(p[1] - settings.vn2000.n0)] : [p[0], -p[1]]));
    if (l.closed && pts.length > 1 && G.dist(pts[0], pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
    return { pts, closed: l.closed };
  });
  return { shapes, setGeo };
}

// Đưa các nét CAD về gần gốc toạ độ (file CAD thường dùng VN-2000 với số rất lớn)
export function recenterShapes(shapes) {
  const all = shapes.flatMap((s) => s.pts);
  if (!all.length) return { shapes, offset: [0, 0] };
  const bb = G.bbox(all);
  const off = [Math.round((bb.x0 + bb.x1) / 2), Math.round((bb.y0 + bb.y1) / 2)];
  return { shapes: shapes.map((s) => ({ ...s, pts: G.translatePts(s.pts, -off[0], -off[1]) })), offset: off, bb };
}

export function shapesToItems(shapes) {
  return shapes.map((s) => ({ id: uid(), kind: 'cad', layer: 0, pts: s.pts, closed: s.closed, props: {} }));
}

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return blob;
}

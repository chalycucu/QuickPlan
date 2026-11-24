// Vẽ mặt bằng 2D lên canvas.
import * as G from './geom.js';
import { frameOf } from './faces.js';
import { ICONS, drawIconAt, drawInk, inkSize } from './icons.js';
import { matImage, findMat } from './materials.js';
import { drawAxisGrid } from './axis.js';
import { junctionCorners } from './roadops.js';
import { labelKeys, labelMap } from './bdata.js';
import { LANDUSE, roadTotalWidth, itemArea, lotName, layerOf, layerOrder, cadInert, landTrees, landTreeSize, LAND_CLOSED, LAND_COLORS, TREE_TYPES } from './model.js';

export class View {
  constructor() { this.cx = 0; this.cy = 0; this.scale = 2; this.w = 1; this.h = 1; this.rot = 0; }
  // rot: góc xoay màn hình 2D (radian, xoay bằng 2 ngón tay)
  toScreen(p) {
    const x = (p[0] - this.cx) * this.scale, y = (p[1] - this.cy) * this.scale;
    if (!this.rot) return [x + this.w / 2, y + this.h / 2];
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [x * c - y * s + this.w / 2, x * s + y * c + this.h / 2];
  }
  toWorld(x, y) {
    let dx = x - this.w / 2, dy = y - this.h / 2;
    if (this.rot) { const c = Math.cos(this.rot), s = Math.sin(this.rot); [dx, dy] = [dx * c + dy * s, -dx * s + dy * c]; }
    return [dx / this.scale + this.cx, dy / this.scale + this.cy];
  }
  // kéo màn hình theo số điểm ảnh (đúng cả khi đang xoay)
  panBy(dx, dy) {
    if (this.rot) { const c = Math.cos(this.rot), s = Math.sin(this.rot); [dx, dy] = [dx * c + dy * s, -dx * s + dy * c]; }
    this.cx -= dx / this.scale; this.cy -= dy / this.scale;
  }
  rotateAt(sx, sy, da) {
    const before = this.toWorld(sx, sy);
    this.rot = (((this.rot + da) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (this.rot > Math.PI) this.rot -= Math.PI * 2;
    const after = this.toWorld(sx, sy);
    this.cx += before[0] - after[0]; this.cy += before[1] - after[1];
  }
  // khung nhìn theo toạ độ thế giới [x0, y0, x1, y1]
  worldBox(m = 0) {
    const cs = [this.toWorld(0, 0), this.toWorld(this.w, 0), this.toWorld(0, this.h), this.toWorld(this.w, this.h)];
    const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
    return [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
  }
  zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(0.01, Math.min(200, this.scale * f));
    const after = this.toWorld(sx, sy);
    this.cx += before[0] - after[0]; this.cy += before[1] - after[1];
  }
  // Tỷ lệ bản vẽ xấp xỉ (1 px CSS ≈ 0,2646 mm)
  ratio() { return 1 / (this.scale * 0.0002646); }
  setRatio(r) { this.scale = 1 / (r * 0.0002646); }
}

// ---------- Hiệu năng: khung bao và chỉ giới được nhớ đệm, chỉ vẽ đối tượng trong khung nhìn ----------
const bbCache = new WeakMap();
const padOf = (it) => {
  switch (it.kind) {
    case 'road': return roadTotalWidth(it) / 2 + 2;
    case 'water': return (it.props.mode === 'river' ? it.props.width / 2 : 0) + (it.props.setback || 0) + 2;
    case 'circle': return it.props.radius + 40;
    case 'arrow': case 'flow': case 'icon': return 40;
    case 'land': return (it.props.size || 6) + 2;
    default: return 2;
  }
};
export function itemBBox(it) {
  const c = bbCache.get(it);
  const n = it.pts.length, key = n ? it.pts[0][0] + it.pts[n - 1][1] * 3.1 + n + (it.props.radius || 0) + (it.props.width || 0) : 0;
  if (c && c.pts === it.pts && c.key === key) return c.b;
  const b = n ? G.bbox(it.pts) : { x0: 0, y0: 0, x1: 0, y1: 0 };
  const pd = padOf(it);
  const r = { x0: b.x0 - pd, y0: b.y0 - pd, x1: b.x1 + pd, y1: b.y1 + pd };
  bbCache.set(it, { pts: it.pts, key, b: r });
  return r;
}
const blCache = new WeakMap();
export function cachedOffset(it, d) {
  const c = blCache.get(it);
  if (c && c.pts === it.pts && c.d === d && c.n === it.pts.length && c.p0 === it.pts[0]) return c.r;
  const r = G.offsetPolygon(it.pts, d);
  blCache.set(it, { pts: it.pts, d, n: it.pts.length, p0: it.pts[0], r });
  return r;
}

function pathPts(ctx, v, pts, closed) {
  ctx.beginPath(); addPts(ctx, v, pts, closed);
}
// thêm một nét vào path hiện tại; bỏ các đỉnh cách đỉnh trước dưới 0,6 điểm ảnh (bản vẽ lớn nhìn xa vẽ nhanh hơn nhiều)
function addPts(ctx, v, pts, closed) {
  const n = pts.length; if (!n) return;
  let s = v.toScreen(pts[0]), lx = s[0], ly = s[1]; ctx.moveTo(lx, ly);
  for (let i = 1; i < n; i++) {
    s = v.toScreen(pts[i]);
    if (i < n - 1 && (s[0] - lx) * (s[0] - lx) + (s[1] - ly) * (s[1] - ly) < 0.36) continue;
    ctx.lineTo(s[0], s[1]); lx = s[0]; ly = s[1];
  }
  if (closed) ctx.closePath();
}

// điểm đặt nhãn của ô có lỗ: điểm trong ô, xa biên (và xa lỗ) nhất trên lưới thô; nhớ đệm theo hình
const _lp = new WeakMap();
function labelPt(z) {
  const key = z.pts.length + ':' + z.holes.length + ':' + z.pts[0][0] + ':' + z.pts[0][1];
  const m = _lp.get(z); if (m && m.key === key) return m.q;
  const b = G.bbox(z.pts); let best = G.centroid(z.pts), bd = -1;
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
    const q = [b.x0 + ((b.x1 - b.x0) * i) / 24, b.y0 + ((b.y1 - b.y0) * j) / 24];
    if (!G.pointInPolygon(q, z.pts) || z.holes.some((h) => G.pointInPolygon(q, h))) continue;
    const d = Math.min(G.distToPolyline(q, z.pts, true).d, ...z.holes.map((h) => G.distToPolyline(q, h, true).d));
    if (d > bd) { bd = d; best = q; }
  }
  _lp.set(z, { key, q: best }); return best;
}
function polyWithHoles(ctx, v, it) {
  pathPts(ctx, v, it.pts, true);
  for (const h of it.holes || []) {
    h.forEach((p, i) => { const s = v.toScreen(p); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
    ctx.closePath();
  }
}

function niceStep(target) {
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

export function drawGrid(ctx, v, dark) {
  const step = niceStep(60 / v.scale);
  const [x0, y0, x1, y1] = v.worldBox();
  ctx.lineWidth = 1;
  for (const [mult, col] of [[1, dark ? '#20262d' : '#eef1f4'], [5, dark ? '#2b333c' : '#dde3e9']]) {
    const s = step * mult;
    ctx.strokeStyle = col; ctx.beginPath();
    if (!v.rot) {
      for (let x = Math.floor(x0 / s) * s; x <= x1; x += s) { const sx = Math.round(v.toScreen([x, 0])[0]) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, v.h); }
      for (let y = Math.floor(y0 / s) * s; y <= y1; y += s) { const sy = Math.round(v.toScreen([0, y])[1]) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(v.w, sy); }
    } else {
      const ln = (a, b) => { const p = v.toScreen(a), q = v.toScreen(b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
      for (let x = Math.floor(x0 / s) * s; x <= x1; x += s) ln([x, y0], [x, y1]);
      for (let y = Math.floor(y0 / s) * s; y <= y1; y += s) ln([x0, y], [x1, y]);
    }
    ctx.stroke();
  }
}

export function drawScaleBar(ctx, v, x, y, dark) {
  const m = niceStep(120 / v.scale);
  const px = m * v.scale;
  ctx.save();
  ctx.fillStyle = dark ? '#e6e9ee' : '#1d2a3a'; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 6); ctx.stroke();
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', x + px + 8, y + 1);
  ctx.fillText('≈ 1:' + Math.round(v.ratio()).toLocaleString('vi-VN'), x, y - 12);
  ctx.restore();
}

const ALERT_COL = { warn: '#f59e0b', over: '#dc2626' };

export function renderScene(ctx, doc, v, opts = {}) {
  const { selectedId, metrics, images = {}, dark = false, multiIds = [], check = false, isoFn = null } = opts;
  const DIM = 0.22; // «Khóa khối»: đối tượng ngoài khối vẽ mờ
  const viol = (check && metrics && metrics.viol) || null;
  const lay = Object.fromEntries(doc.layers.map((l) => [l.id, l]));
  const alerts = (metrics && metrics.alerts) || {};
  const items = doc.items;
  // khung nhìn theo toạ độ thế giới (+ lề)
  const m = 60 / v.scale;
  const [vx0, vy0, vx1, vy1] = v.worldBox(m);
  const inView = (it) => { if (it.id === selectedId) return true; const b = itemBBox(it); return b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1; };
  // gom đối tượng theo lớp (lớp mặc định theo loại, hoặc lớp người dùng tạo)
  const perLayer = new Map();
  for (const it of items) if (inView(it)) { const L = layerOf(it); (perLayer.get(L) || perLayer.set(L, []).get(L)).push(it); }
  const lotOf = new Map(((metrics && metrics.lots) || []).map((l) => [l.zone.id, l]));
  const shown = (id) => { const l = lay[id]; return l && l.visible && l.opacity > 0; };

  // Vẽ các lớp theo thứ tự (dưới lên trên): lớp trên che lớp dưới
  for (const id of layerOrder(doc)) {
    if (!shown(id)) continue;
    const l = lay[id];
    ctx.save(); ctx.globalAlpha = l.opacity;
    if (id === 8 && doc.base && (images.baseProc || images.base)) { // lớp ảnh nền riêng
      const b = doc.base; const s = v.toScreen([b.x, b.y]);
      ctx.globalAlpha *= (b.opacity ?? 1) * (isoFn ? DIM : 1);
      ctx.save(); ctx.translate(s[0], s[1]); if (v.rot) ctx.rotate(v.rot);
      ctx.drawImage(images.baseProc || images.base, 0, 0, b.w * v.scale, b.h * v.scale); ctx.restore();
      ctx.globalAlpha = l.opacity;
    }
    const list = perLayer.get(id) || [];
    if (isoFn) { // vẽ phần mờ trước, khối đang khóa sau (nổi lên trên)
      const inn = [], out = []; for (const it of list) (isoFn(it) ? inn : out).push(it);
      ctx.globalAlpha = l.opacity * DIM; drawItems(ctx, doc, v, out, { alerts, dark, opacity: l.opacity * DIM, viol });
      ctx.globalAlpha = l.opacity; drawItems(ctx, doc, v, inn, { alerts, dark, opacity: l.opacity, viol });
    } else drawItems(ctx, doc, v, list, { alerts, dark, opacity: l.opacity, viol });
    ctx.restore();
  }

  // nhãn ô đất (bật/tắt từng thuộc tính trong Quản lý lớp) luôn nằm trên cùng
  const zl = doc.settings.zoneLabel || {};
  const ind = zl.indic !== false, sMd = ind && zl.mdxd !== false, sFar = ind && zl.far !== false, sFl = ind && zl.floors !== false;
  const showCode = zl.code !== false, showArea = zl.area !== false, showInd = sMd || sFar || sFl;
  const zones = items.filter((z) => z.kind === 'zone' && shown(layerOf(z)) && inView(z));
  if (v.scale > 0.25 && (showCode || showArea || showInd)) for (const z of zones) {
    ctx.save(); ctx.globalAlpha = lay[layerOf(z)].opacity * (isoFn && !isoFn(z) ? DIM : 1);
    const c = v.toScreen(z.holes && z.holes.length ? labelPt(z) : G.centroid(z.pts));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lotM = lotOf.get(z.id);
    const hasB = !!(lotM && lotM.fp > 0);
    const lines = [];
    if (showCode) lines.push({ t: lotName(metrics, z), f: '700 13px system-ui, sans-serif', c: '#3b2f10' });
    if (showArea) lines.push({ t: G.fmtArea(itemArea(z)), f: '11px system-ui, sans-serif', c: '#3b2f10' });
    if (showInd && hasB) { const lal = alerts[z.id]; lines.push({ t: [sMd && `MĐXD ${G.fmtNum(lotM.mdxd, 0)}%`, sFar && `HSSDĐ ${G.fmtNum(lotM.far, 2)}`, sFl && `${lotM.maxFloors}T`].filter(Boolean).join(' · '), f: '11px system-ui, sans-serif', c: lal === 'over' ? '#c81e1e' : lal === 'warn' ? '#b45309' : '#3b2f10' }); }
    else if (showInd) {
      // ô đất chưa có công trình: hiện chỉ tiêu khống chế của ô
      const P = z.props, t = [sMd && P.maxMdxd && `MĐXD ${G.fmtNum(P.maxMdxd, 0)}%`, sFar && P.maxFar && `HSSDĐ ${G.fmtNum(P.maxFar, 2)}`, sFl && P.maxFloors && `${P.maxFloors}T`].filter(Boolean).join(' · ');
      if (t) lines.push({ t, f: '11px system-ui, sans-serif', c: '#3b2f10' });
    }
    if (lines.length) {
      const H = lines.length * 14 + 4;
      let ly = c[1] - H / 2;
      if (hasB) { const top = v.toScreen([0, G.bbox(z.pts).y0])[1]; ly = Math.min(ly, top + 6); }
      let tw = 40; for (const L of lines) { ctx.font = L.f; tw = Math.max(tw, ctx.measureText(L.t).width); }
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(c[0] - tw / 2 - 5, ly, tw + 10, H);
      lines.forEach((L, i) => { ctx.font = L.f; ctx.fillStyle = L.c; ctx.fillText(L.t, c[0], ly + 9 + i * 14); });
    }
    ctx.restore();
  }

  // Đối tượng đang chọn
  const sel = items.find((i) => i.id === selectedId);
  if (sel) drawSelection(ctx, v, sel);
  if (multiIds.length) { const ms = new Set(multiIds); for (const it of items) if (ms.has(it.id) && it.id !== selectedId) drawSelection(ctx, v, it); }
}

// Vẽ một nhóm đối tượng (của một lớp) theo thứ tự hợp lý giữa các loại
function drawItems(ctx, doc, v, list, { alerts, dark, opacity, viol }) {
  if (!list.length) return;
  const g = {};
  for (const it of list) (g[it.kind] || (g[it.kind] = [])).push(it);
  const by = (k) => g[k] || [];
  ctx.strokeStyle = dark ? '#9fb3c8' : '#6b7c8f'; ctx.lineWidth = 1;
  { // nét CAD: gom vào một path, bỏ nét nhỏ hơn 1 điểm ảnh
    const cads = by('cad');
    if (cads.length) {
      ctx.strokeStyle = dark ? '#9fb3c8' : '#6b7c8f'; ctx.lineWidth = 1; ctx.beginPath(); let k = 0;
      for (const it of cads) {
        const b = itemBBox(it); if ((b.x1 - b.x0) * v.scale < 0.8 && (b.y1 - b.y0) * v.scale < 0.8) continue;
        addPts(ctx, v, it.pts, it.closed);
        if (++k % 32 === 0) { ctx.stroke(); ctx.beginPath(); } // path quá dài làm chậm trình duyệt
      }
      ctx.stroke();
    }
  }
  for (const z of by('zone')) {
    const lu = LANDUSE[z.props.code] || LANDUSE.ODT;
    polyWithHoles(ctx, v, z);
    ctx.fillStyle = lu.color; ctx.globalAlpha = opacity * 0.85; ctx.fill('evenodd'); ctx.globalAlpha = opacity;
    const al = alerts[z.id];
    ctx.strokeStyle = al ? ALERT_COL[al] : '#7a6a3a'; ctx.lineWidth = al ? 3 : 1;
    ctx.setLineDash(al ? [] : [6, 4]); ctx.stroke(); ctx.setLineDash([]);
    if (doc.settings.showBuildLine !== false && z.props.setback > 0) {
      if (z.props.setback * v.scale < 1.5) continue; // quá nhỏ để thấy
      const inner = cachedOffset(z, -z.props.setback);
      pathPts(ctx, v, inner, true);
      ctx.strokeStyle = '#d0312d'; ctx.lineWidth = 1.5; ctx.setLineDash([10, 4, 2, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  for (const it of by('cover')) drawCover(ctx, v, it, doc);
  for (const it of by('land')) if (LAND_CLOSED[it.props.style]) drawLandArea(ctx, v, it);
  for (const p of by('park')) {
    pathPts(ctx, v, p.pts, true);
    ctx.fillStyle = '#8fd17a'; ctx.fill();
    ctx.strokeStyle = '#4f9a45'; ctx.lineWidth = 1.5; ctx.stroke();
    const c = G.centroid(p.pts); const s = v.toScreen(c);
    ctx.fillStyle = '#3f8a3a';
    const r = Math.max(2, 3 * v.scale);
    for (const o of [[0, 0], [-1.6, 0.8], [1.6, 0.8]]) { ctx.beginPath(); ctx.arc(s[0] + o[0] * r * 2, s[1] + o[1] * r * 2, r, 0, 7); ctx.fill(); }
  }
  for (const w of by('water')) {
    const sb = w.props.setback || 0;
    if (w.props.mode === 'river') {
      if (sb > 0) { strokeBand(ctx, v, w.pts, w.props.width + 2 * sb, 'rgba(56,140,200,0.12)'); }
      strokeBand(ctx, v, w.pts, w.props.width, '#8ec9ec');
      ctx.setLineDash([2, 6]); strokeBand(ctx, v, w.pts, 1 / v.scale, '#3d8fc4'); ctx.setLineDash([]);
    } else {
      if (sb > 0) {
        pathPts(ctx, v, w.pts, true);
        ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(56,140,200,0.14)'; ctx.lineWidth = sb * 2 * v.scale; ctx.stroke();
        ctx.setLineDash([8, 6]); ctx.strokeStyle = '#3d8fc4'; ctx.lineWidth = 1;
        pathPts(ctx, v, cachedOffset(w, sb), true); ctx.stroke(); ctx.setLineDash([]);
      }
      pathPts(ctx, v, w.pts, true); ctx.fillStyle = '#8ec9ec'; ctx.fill();
      ctx.strokeStyle = '#3d8fc4'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  // giao thông (vỉa hè -> lòng đường -> tim đường, để nút giao tự liền mạch)
  const peds = by('road').filter((r) => r.props.ped);
  for (const r of peds) strokeBand(ctx, v, r.pts, r.props.width + Math.max(0.4, 1.4 / v.scale), '#b39a6b');
  for (const r of peds) strokeBand(ctx, v, r.pts, r.props.width, '#efe2c4');
  const roads = by('road').filter((r) => !r.props.ped);
  for (const r of roads) strokeBand(ctx, v, r.pts, roadTotalWidth(r) + 1.2, '#9aa3ad');
  for (const r of roads) strokeBand(ctx, v, r.pts, roadTotalWidth(r), '#e9e4da');
  // giao lộ: góc vát vỉa hè (V) và bo lòng đường bán kính R
  const jcs = by('junction').map((j) => junctionCorners(doc, j)).flat();
  for (const c of jcs) if (c.chamfer) {
    const [, A, B] = c.chamfer, a = v.toScreen(A), b = v.toScreen(B);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = Math.max(1, 1.2 * v.scale); ctx.lineCap = 'round'; ctx.stroke();
    pathPts(ctx, v, c.chamfer, true); ctx.fillStyle = '#e9e4da'; ctx.fill();
  }
  for (const r of roads) strokeBand(ctx, v, r.pts, r.props.width, '#59626d');
  for (const c of jcs) if (c.fillet) { pathPts(ctx, v, c.fillet, true); ctx.fillStyle = '#59626d'; ctx.fill(); ctx.strokeStyle = '#59626d'; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.setLineDash([8, 8]);
  for (const r of roads) strokeBand(ctx, v, r.pts, Math.max(0.15, 1 / v.scale), '#f4f1e8');
  ctx.setLineDash([]);
  for (const it of by('land')) if (!LAND_CLOSED[it.props.style] || it.props.style === 'grove') drawLandTrees(ctx, v, it);
  const bdKeys = labelKeys(doc), bdLbl = bdKeys.length && v.scale > 0.6 ? labelMap(doc, bdKeys, alerts) : null, bdFl = bdKeys.includes('floors');
  for (const b of by('building')) {
    polyWithHoles(ctx, v, b);
    const al = viol ? (viol[b.id] ? 'over' : null) : alerts[b.id];
    ctx.fillStyle = viol ? (al ? '#ef4444' : (b.props.color || '#ffffff')) : al ? (al === 'over' ? '#f3a6a6' : '#fbd38d') : (b.props.color || '#ffffff'); ctx.fill('evenodd');
    ctx.strokeStyle = viol && al ? '#991b1b' : al ? ALERT_COL[al] : '#1d2a3a'; ctx.lineWidth = al ? 2.5 : 1.5;
    if (b.props.on) { ctx.setLineDash([6, 4]); ctx.lineWidth = 2; } // khối chồng trên mái khối khác
    ctx.stroke(); ctx.setLineDash([]);
    const bl = bdLbl && bdLbl[b.id];
    if (bl) { drawBLabel(ctx, v, b, bl.lines, bdFl || (doc.settings.zoneLabel || {}).floors === false ? null : (b.props.on ? '+' : '') + b.props.floors + 'T'); continue; }
    if (v.scale > 0.6 && (doc.settings.zoneLabel || {}).floors !== false) {
      const c = v.toScreen(G.centroid(b.pts));
      ctx.fillStyle = '#1d2a3a'; ctx.font = `600 ${Math.min(14, 6 + v.scale * 2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((b.props.on ? '+' : '') + b.props.floors + 'T', c[0], c[1]);
    }
  }
  // mảng mặt khối (chia mặt trong 3D): viền nét đứt
  for (const f of by('facet')) {
    if (f.pts.length < 3) continue;
    pathPts(ctx, v, f.pts, true);
    if ((f.props.depth || 0) > 0.05) { ctx.fillStyle = f.props.color || 'rgba(255,255,255,.9)'; ctx.fill(); }
    ctx.strokeStyle = '#2f4f7a'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  // nét vẽ trên mái (mặt nằm ngang của công trình / mảng): hiện cả trong 2D
  {
    let byId = null;
    for (const it of doc.items) {
      const sk = it.props && it.props.sk && it.props.sk.top;
      if (!sk || !sk._edges || !sk._edges.length || (it.kind !== 'building' && it.kind !== 'facet')) continue;
      if (it.kind === 'building' ? !by('building').includes(it) : !by('facet').includes(it)) continue;
      byId = byId || new Map(doc.items.map((i) => [i.id, i]));
      const F = frameOf(byId, it.id, 'top'); if (!F || !F.wa) continue;
      ctx.beginPath();
      for (const e of sk._edges) { const A = F.pt(e.a), B = F.pt(e.b), a = v.toScreen([A[0], A[2]]), b = v.toScreen([B[0], B[2]]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1.3; ctx.stroke();
    }
  }
  for (const it of [...by('cloud'), ...by('circle'), ...by('arrow'), ...by('flow'), ...by('icon')]) {
    if (it.kind === 'arrow' || it.kind === 'flow') drawArrow(ctx, v, it);
    else if (it.kind === 'circle') drawCircle(ctx, v, it);
    else if (it.kind === 'cloud') drawCloud(ctx, v, it);
    else if (it.kind === 'icon') drawIcon(ctx, v, it);
  }
  for (const it of by('sketch')) drawSketch(ctx, v, it);
  if (viol) for (const b of by('building')) if (viol[b.id]) drawViolLabel(ctx, v, b, viol[b.id]);
}
// Kiểm tra chỉ tiêu: nhãn đỏ ghi các vi phạm ngay trên công trình
// QP-24: nhãn dữ liệu công trình (các trường được tích), canh giữa khối, viền trắng cho dễ đọc
function drawBLabel(ctx, v, b, lines, head) {
  const c = v.toScreen(G.centroid(b.pts)), fs = Math.min(14, 6 + v.scale * 2), fs2 = Math.max(9, fs - 2);
  const L = (head ? [[head, `600 ${fs}px system-ui, sans-serif`, fs]] : []).concat(lines.map((t, i) => [t, `${i === 0 && !head ? 600 : 500} ${fs2}px system-ui, sans-serif`, fs2]));
  const H = L.reduce((a, l) => a + l[2] * 1.2, 0);
  let y = c[1] - H / 2;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const [t, f, sz] of L) {
    y += sz * 0.6; ctx.font = f;
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.strokeText(t, c[0], y);
    ctx.fillStyle = '#1d2a3a'; ctx.fillText(t, c[0], y); y += sz * 0.6;
  }
  ctx.restore();
}
export function drawViolLabel(ctx, v, b, lines) {
  const c = v.toScreen(G.centroid(b.pts));
  ctx.font = '600 12px system-ui, sans-serif';
  const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 16, lh = 16, hh = lines.length * lh + 8;
  const x = c[0] - w / 2, y = c[1] - hh - 10;
  ctx.fillStyle = 'rgba(185,28,28,.94)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hh, 6) : ctx.rect(x, y, w, hh); ctx.fill();
  ctx.beginPath(); ctx.moveTo(c[0] - 6, y + hh); ctx.lineTo(c[0] + 6, y + hh); ctx.lineTo(c[0], y + hh + 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((t, i) => ctx.fillText(t, c[0], y + 4 + lh * i + lh / 2));
}

function strokeBand(ctx, v, pts, widthM, color) {
  pathPts(ctx, v, pts, false);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, widthM * v.scale); ctx.stroke();
}

function drawArrow(ctx, v, it) {
  const col = it.props.color || (it.kind === 'arrow' ? '#d9381e' : '#1f7a3a');
  const w = (it.props.width || (it.kind === 'arrow' ? 8 : 3));
  const pts = it.pts; if (pts.length < 2) return;
  const sw = Math.max(2, w * v.scale * (it.kind === 'arrow' ? 1 : 0.6));
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // thân (bỏ đoạn cuối cho đầu mũi tên)
  const head = Math.max(12, sw * 2.6);
  const end = v.toScreen(pts[pts.length - 1]);
  let k = pts.length - 2, prev = v.toScreen(pts[k]);
  while (k > 0 && Math.hypot(end[0] - prev[0], end[1] - prev[1]) < head) prev = v.toScreen(pts[--k]);
  const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  const base = [end[0] - Math.cos(ang) * head * 0.8, end[1] - Math.sin(ang) * head * 0.8];
  ctx.beginPath();
  for (let i = 0; i <= k; i++) { const s = v.toScreen(pts[i]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }
  ctx.lineTo(base[0], base[1]);
  ctx.lineWidth = sw; if (it.kind === 'flow') ctx.setLineDash([sw * 2.5, sw * 1.8]);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(end[0], end[1]);
  ctx.lineTo(end[0] - Math.cos(ang - 0.45) * head, end[1] - Math.sin(ang - 0.45) * head);
  ctx.lineTo(end[0] - Math.cos(ang + 0.45) * head, end[1] - Math.sin(ang + 0.45) * head);
  ctx.closePath(); ctx.fill();
  if (it.props.label) label(ctx, v.toScreen(pts[Math.floor(pts.length / 2)]), it.props.label, col);
}

export function iconPx(it, v) { return Math.max(16, Math.min(160, (it.props.size || 20) * v.scale)); }
function drawIcon(ctx, v, it) {
  const c = v.toScreen(it.pts[0]); const px = iconPx(it, v);
  drawIconAt(ctx, it.props.sym, c[0], c[1], px, it.props.color);
  if (it.props.showLabel === false) return;
  const col = it.props.color || (ICONS[it.props.sym] || ICONS.pin).color;
  let y = c[1] + px / 2 + 12;
  if (it.props.label) { label(ctx, [c[0], y], it.props.label, col); y += 16; }
  if (it.props.ink && it.props.ink.s && it.props.ink.s.length) { // nhãn viết tay bằng bút
    const hh = Math.max(18, Math.min(60, px * 0.5)), sz = inkSize(it.props.ink, hh);
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(c[0] - sz[0] / 2 - 5, y - 6, sz[0] + 10, hh + 8, 6) : ctx.rect(c[0] - sz[0] / 2 - 5, y - 6, sz[0] + 10, hh + 8); ctx.fill(); ctx.restore();
    drawInk(ctx, it.props.ink, c[0], y - 2, hh, col);
  }
}

function drawSketch(ctx, v, it) {
  const pts = it.pts; if (pts.length < 2) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = it.props.color || '#111827';
  const w = (it.props.width || 1) * v.scale;
  for (let i = 1; i < pts.length; i++) {
    const a = v.toScreen(pts[i - 1]), b = v.toScreen(pts[i]);
    ctx.lineWidth = Math.max(1, w * (0.55 + 0.9 * (pts[i][2] ?? 0.5)));
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.restore();
}

function drawCircle(ctx, v, it) {
  const c = v.toScreen(it.pts[0]); const r = it.props.radius * v.scale;
  const col = it.props.color || '#7b3fe4';
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
  ctx.fillStyle = col + '0a'; ctx.fill();
  const lw = it.props.width || 2;
  if (it.props.dash !== false) ctx.setLineDash([Math.max(10, lw * 4), Math.max(6, lw * 2.5)]);
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(6, Math.min(18, r * 0.08)), 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  label(ctx, [c[0], c[1] - r - 12], (it.props.label ? it.props.label + ' · ' : '') + 'R = ' + Math.round(it.props.radius) + ' m', col);
}

function drawCloud(ctx, v, it) {
  const col = it.props.color || '#c2410c';
  const pts = it.pts.map((p) => v.toScreen(p));
  const bump = 16;
  const loop = G.resample(pts.concat([pts[0]]), bump);
  const ccw = G.signedArea(pts) < 0;
  ctx.beginPath();
  for (let i = 0; i < loop.length - 1; i++) {
    const a = loop[i], b = loop[i + 1];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    ctx.arc(m[0], m[1], r, ang + Math.PI, ang, ccw);
  }
  ctx.fillStyle = col + '12'; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  if (it.props.label) { const c = v.toScreen(G.centroid(it.pts)); label(ctx, c, it.props.label, col); }
}

function label(ctx, s, text, col) {
  ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(ctx, s[0] - w / 2, s[1] - 10, w, 20, 6); ctx.fill();
  ctx.fillStyle = col; ctx.fillText(text, s[0], s[1]);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Cảnh quan: mặt phủ (thảm cỏ, sân lát, bồn hoa, nền cụm cây)
function drawLandArea(ctx, v, it) {
  const st = it.props.style;
  pathPts(ctx, v, it.pts, true);
  ctx.fillStyle = LAND_COLORS[st] || '#cfe8bf'; ctx.fill();
  ctx.save(); ctx.clip();
  const sb = G.bbox(it.pts.map((q) => v.toScreen(q))); const a = [sb.x0, sb.y0], c = [sb.x1, sb.y1];
  if (st === 'plaza') { // lưới lát đá 3 m
    const step = 3 * v.scale;
    if (step > 4) { ctx.strokeStyle = 'rgba(150,130,100,.45)'; ctx.lineWidth = 1; ctx.beginPath(); for (let x = a[0]; x <= c[0]; x += step) { ctx.moveTo(x, a[1]); ctx.lineTo(x, c[1]); } for (let y = a[1]; y <= c[1]; y += step) { ctx.moveTo(a[0], y); ctx.lineTo(c[0], y); } ctx.stroke(); }
  } else if (st === 'lawn') { // chấm cỏ
    const step = Math.max(6, 2.5 * v.scale); ctx.fillStyle = 'rgba(70,140,60,.35)';
    for (let x = a[0]; x <= c[0]; x += step) for (let y = a[1] + ((x / step) % 2) * step / 2; y <= c[1]; y += step) ctx.fillRect(x, y, 1.5, 1.5);
  } else if (st === 'flower') {
    const step = Math.max(7, 2 * v.scale); const cols = ['#e11d48', '#f59e0b', '#db2777', '#fff'];
    let k = 0; for (let x = a[0]; x <= c[0]; x += step) for (let y = a[1] + ((x / step) % 2) * step / 2; y <= c[1]; y += step) { ctx.fillStyle = cols[k++ % 4]; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, 0.35 * v.scale), 0, 7); ctx.fill(); }
  }
  ctx.restore();
  pathPts(ctx, v, it.pts, true);
  ctx.strokeStyle = st === 'plaza' ? '#a8957a' : st === 'flower' ? '#be185d' : '#5f9a4d'; ctx.lineWidth = 1.2; ctx.stroke();
}
// Cây: ký hiệu theo mẫu cây (tán tròn, lá kim, cau dừa, tán trụ, bụi, mẫu nhập), cỡ theo từng cây
function drawLandTrees(ctx, v, it) {
  const pos = landTrees(it, 3000);
  const type = it.props.tree || 'round';
  if (it.props.style === 'row' && (it.props.size || 6) * v.scale > 6) { pathPts(ctx, v, it.pts, false); ctx.strokeStyle = 'rgba(80,120,60,.35)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
  for (const p of pos) {
    const r = Math.max(2, (landTreeSize(it, p) / 2) * v.scale);
    const c = v.toScreen(p);
    ctx.beginPath(); ctx.arc(c[0] + r * 0.18, c[1] + r * 0.18, r, 0, 7); ctx.fillStyle = 'rgba(30,60,30,.18)'; ctx.fill();
    if (type === 'palm') {
      ctx.strokeStyle = '#4f8a32'; ctx.lineWidth = Math.max(1, r * 0.16); ctx.lineCap = 'round';
      ctx.beginPath(); for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2 + 0.3; ctx.moveTo(c[0], c[1]); ctx.quadraticCurveTo(c[0] + Math.cos(a + 0.3) * r * 0.7, c[1] + Math.sin(a + 0.3) * r * 0.7, c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r); } ctx.stroke();
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, r * 0.15), 0, 7); ctx.fillStyle = '#7a5a3a'; ctx.fill();
      continue;
    }
    if (type === 'shrub') {
      ctx.fillStyle = '#7cbf5c'; ctx.strokeStyle = '#4f8a3a'; ctx.lineWidth = Math.max(0.8, r * 0.1);
      for (const [ox, oy] of [[-0.35, 0.1], [0.3, -0.15], [0.15, 0.35]]) { ctx.beginPath(); ctx.arc(c[0] + ox * r, c[1] + oy * r, r * 0.6, 0, 7); ctx.fill(); ctx.stroke(); }
      continue;
    }
    ctx.beginPath(); ctx.arc(c[0], c[1], type === 'column' ? r * 0.7 : r, 0, 7);
    ctx.fillStyle = type === 'cone' ? '#2f7a3d' : type === 'column' ? '#3f8a3a' : TREE_TYPES[type] ? '#5aa64a' : '#4a9a6a'; ctx.fill();
    ctx.strokeStyle = '#2f6b2a'; ctx.lineWidth = Math.max(0.8, r * 0.12); ctx.stroke();
    if (type === 'cone' && r > 4) { ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.moveTo(c[0], c[1]); ctx.lineTo(c[0] + Math.cos(a) * r * 0.9, c[1] + Math.sin(a) * r * 0.9); } ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    else if (type === 'column' && r > 4) { ctx.beginPath(); ctx.arc(c[0], c[1], r * 0.35, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.stroke(); }
    else if (!TREE_TYPES[type] && r > 4) { ctx.beginPath(); ctx.arc(c[0], c[1], r * 0.55, 0, 7); ctx.setLineDash([2, 2]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
    else if (r > 5) { ctx.beginPath(); ctx.arc(c[0] - r * 0.3, c[1] - r * 0.3, r * 0.35, 0, 7); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill(); }
  }
}

export function handlePoints(it) {
  if (it.kind === 'circle') return [it.pts[0], [it.pts[0][0] + it.props.radius, it.pts[0][1]]];
  if (it.kind === 'building' && it.props.preset) return [];
  if (it.kind === 'road') return it.props.pis || it.props.ctrl || (it.pts.length > 60 ? [] : it.pts);
  if (it.kind === 'sketch') return [];
  if (it.pts.length > 60) return [];
  return it.pts;
}

// Vật liệu phủ: màu đơn hoặc mẫu vật liệu lặp theo tỉ lệ (m mỗi ô mẫu), xoay theo góc mẫu
let _redraw = null; export function onMatReady(fn) { _redraw = fn; }
function drawCover(ctx, v, it, doc) {
  const P = it.props;
  ctx.save();
  polyWithHoles(ctx, v, it);
  const m = P.mat ? findMat(doc, P.mat) : null;
  const img = m ? matImage(doc, P.mat, () => _redraw && _redraw()) : null;
  const tilePx = Math.max(0.5, (P.scale || (m && m.scale) || 1) * v.scale);
  if (img && tilePx >= 3) {
    const pat = ctx.createPattern(img, 'repeat');
    const o = v.toScreen([0, 0]), k = tilePx / Math.max(img.width, img.height), a = (v.rot || 0) + ((P.ang || 0) * Math.PI) / 180;
    if (pat.setTransform) pat.setTransform(new DOMMatrix().translateSelf(o[0], o[1]).rotateSelf((a * 180) / Math.PI).scaleSelf(k, k));
    ctx.fillStyle = pat;
  } else ctx.fillStyle = (m && m.color) || P.color || '#d9cdb4';
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(60,60,60,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}
export { drawAxisGrid };

function drawSelection(ctx, v, it) {
  ctx.save();
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
  if (it.kind === 'circle') { const c = v.toScreen(it.pts[0]); ctx.beginPath(); ctx.arc(c[0], c[1], it.props.radius * v.scale + 4, 0, 7); ctx.stroke(); }
  else if (it.kind === 'land' && it.props.style === 'tree') { const c = v.toScreen(it.pts[0]); ctx.beginPath(); ctx.arc(c[0], c[1], ((it.props.size || 6) / 2) * v.scale + 4, 0, 7); ctx.stroke(); }
  else { pathPts(ctx, v, it.pts, ['building', 'zone', 'park', 'cloud', 'cover'].includes(it.kind) || (it.kind === 'land' && LAND_CLOSED[it.props.style]) || (it.kind === 'water' && it.props.mode !== 'river')); ctx.stroke(); }
  ctx.setLineDash([]);
  if (it.kind === 'road' && it.props.pis && it.props.pis.length > 2) {
    // tuyến tiếp tuyến và bán kính cong
    ctx.strokeStyle = 'rgba(37,99,235,.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    pathPts(ctx, v, it.props.pis, false); ctx.stroke(); ctx.setLineDash([]);
    it.props.pis.slice(1, -1).forEach((p, k) => {
      const r = (it.props.radiiEff || it.props.radii || [])[k];
      if (r > 0) label(ctx, [v.toScreen(p)[0], v.toScreen(p)[1] - 18], 'R = ' + r + ' m', '#2563eb');
    });
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
  }
  for (const p of handlePoints(it)) {
    const s = v.toScreen(p);
    ctx.beginPath(); ctx.arc(s[0], s[1], 7, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}

// Nét đang vẽ (phản hồi tức thì theo lực nhấn)
export function drawLiveStroke(ctx, v, pts, color) {
  if (pts.length < 2) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  for (let i = 1; i < pts.length; i++) {
    const a = v.toScreen(pts[i - 1]), b = v.toScreen(pts[i]);
    ctx.lineWidth = 1.5 + 4 * (pts[i][2] ?? 0.5);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.restore();
}

// Chọn đối tượng tại một điểm (ưu tiên lớp trên cùng)
export function hitTest(doc, p, scale, skipLocked = false) {
  const tol = 10 / scale;
  const vis = Object.fromEntries(doc.layers.map((l) => [l.id, l.visible]));
  const locked = Object.fromEntries(doc.layers.map((l) => [l.id, !!l.locked]));
  const order = ['icon', 'sketch', 'arrow', 'flow', 'circle', 'cloud', 'facet', 'building', 'land', 'road', 'park', 'cover', 'water', 'zone', 'cad'];
  // lớp trên cùng được ưu tiên; trong một lớp ưu tiên theo loại đối tượng
  const rank = new Map(layerOrder(doc).map((id, i) => [id, i]));
  const ko = new Map(order.map((k, i) => [k, i]));
  const cand = doc.items.map((it, i) => ({ it, i, L: layerOf(it) })).filter((c) => vis[c.L] && !(skipLocked && locked[c.L]) && !cadInert(doc, c.it));
  cand.sort((a, b) => (rank.get(b.L) ?? 0) - (rank.get(a.L) ?? 0) || (ko.get(a.it.kind) ?? 99) - (ko.get(b.it.kind) ?? 99) || b.i - a.i);
  for (const c of cand) if (hitItem(c.it, p, tol)) return c.it;
  return null;
}
// Mọi đối tượng tại một điểm, xếp từ trên xuống (để chọn trong danh sách khi trùng chỗ)
export function hitAll(doc, p, scale, skipLocked = false) {
  const tol = 10 / scale;
  const vis = Object.fromEntries(doc.layers.map((l) => [l.id, l.visible]));
  const locked = Object.fromEntries(doc.layers.map((l) => [l.id, !!l.locked]));
  const order = ['icon', 'sketch', 'arrow', 'flow', 'circle', 'cloud', 'facet', 'building', 'land', 'road', 'park', 'cover', 'water', 'zone', 'cad'];
  const rank = new Map(layerOrder(doc).map((id, i) => [id, i]));
  const ko = new Map(order.map((k, i) => [k, i]));
  const cand = doc.items.map((it, i) => ({ it, i, L: layerOf(it) })).filter((c) => vis[c.L] && !(skipLocked && locked[c.L]) && c.it.kind !== 'facet' && !cadInert(doc, c.it));
  cand.sort((a, b) => (rank.get(b.L) ?? 0) - (rank.get(a.L) ?? 0) || (ko.get(a.it.kind) ?? 99) - (ko.get(b.it.kind) ?? 99) || b.i - a.i);
  return cand.filter((c) => hitItem(c.it, p, tol)).map((c) => c.it);
}

function hitItem(it, p, tol) {
  switch (it.kind) {
    case 'road': return G.distToPolyline(p, it.pts).d <= roadTotalWidth(it) / 2 + tol;
    case 'junction': return G.dist(p, it.pts[0]) <= tol * 1.5;
    case 'water': return it.props.mode === 'river' ? G.distToPolyline(p, it.pts).d <= it.props.width / 2 + tol : G.pointInPolygon(p, it.pts);
    case 'arrow': case 'flow': case 'cad': case 'sketch': return G.distToPolyline(p, it.pts, it.closed).d <= tol * 1.5;
    case 'land': if (it.props.style === 'tree') return G.dist(p, it.pts[0]) <= (it.props.size || 6) / 2 + tol; if (!LAND_CLOSED[it.props.style]) return G.distToPolyline(p, it.pts).d <= (it.props.size || 6) / 2 + tol; return G.pointInPolygon(p, it.pts) || G.distToPolyline(p, it.pts, true).d <= tol;
    case 'icon': return G.dist(p, it.pts[0]) <= Math.max((it.props.size || 20) / 2, tol * 1.2) + tol * 0.5;
    case 'circle': { const d = G.dist(p, it.pts[0]); return d <= tol * 2 || Math.abs(d - it.props.radius) <= tol * 1.5; }
    default: return (G.pointInPolygon(p, it.pts) && !(it.holes || []).some((hh) => G.pointInPolygon(p, hh) && G.distToPolyline(p, hh, true).d > tol)) || G.distToPolyline(p, it.pts, true).d <= tol;
  }
}

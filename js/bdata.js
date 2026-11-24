// QP-23: Bảng «Dữ liệu công trình» (tên tự đặt theo đất, chức năng, tầng cao, vật liệu, tình trạng) + xuất / nhập Excel
import * as G from './geom.js';
import * as M from './model.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/three/jsm/libs/fflate.module.js';

export const BASE_FIELDS = [
  ['name', 'Ký hiệu'],
  ['title', 'Tên công trình'],
  ['func', 'Chức năng'],
  ['floors', 'Tầng cao'],
  ['material', 'Vật liệu'],
  ['status', 'Tình trạng'],
];
const zoneAt = (zones, c) => { for (let i = zones.length - 1; i >= 0; i--) if (G.pointInPolygon(c, zones[i].pts)) return zones[i]; return null; };

// danh sách công trình (lớp Công trình, không tính khối chồng trên mái), đánh số theo mã đất:
// từ trên xuống dưới, từ trái sang phải (các khối cùng một hàng thì xét trái -> phải)
export function buildingRows(doc) {
  const zones = doc.items.filter((z) => z.kind === 'zone');
  const bs = doc.items.filter((i) => i.kind === 'building' && !(i.props && i.props.on) && M.layerOf(i) === 6 && i.pts && i.pts.length >= 3);
  const rows = bs.map((b) => {
    const c = G.centroid(b.pts), bb = G.bbox(b.pts), z = zoneAt(zones, c);
    const code = z && z.props.code, lu = code ? M.LANDUSE[code] : null;
    const kids = doc.items.filter((k) => k.kind === 'building' && k.props && k.props.on === b.id);
    const floors = (b.props.floors || 0) + (kids.length ? Math.max(...kids.map((k) => k.props.floors || 0)) : 0);
    return { it: b, c, h: Math.max(1, bb.y1 - bb.y0), code: code || '', lbl: lu ? lu.lbl || code : '', func: lu ? lu.name : '', floors };
  });
  // hàng: các khối có tâm lệch nhau theo phương dọc ít hơn nửa chiều cao khối trung bình
  const hs = rows.map((r) => r.h).sort((a, b) => a - b), band = hs.length ? Math.max(2, hs[hs.length >> 1] * 0.5) : 5;
  rows.sort((a, b) => a.c[1] - b.c[1]);
  let rowY = null, rowNo = -1;
  for (const r of rows) { if (rowY == null || r.c[1] - rowY > band) { rowY = r.c[1]; rowNo++; } r.row = rowNo; }
  rows.sort((a, b) => a.row - b.row || a.c[0] - b.c[0]);
  const cnt = {};
  for (const r of rows) {
    const k = r.lbl || '';
    cnt[k] = (cnt[k] || 0) + 1;
    r.auto = (k ? 'CT.' + k : 'CT') + ' ' + String(cnt[k]).padStart(2, '0');
    const P = r.it.props, d = P.bdata || {};
    r.name = d.name || r.auto;
    r.title = d.title || '';
    r.funcAuto = r.func; if (d.func) r.func = d.func; // chức năng: sửa tay được, xoá trắng thì về theo loại đất
    r.material = d.material || '';
    r.status = d.status || '';
    r.extra = d.extra || {};
  }
  return rows;
}
// QP-24: nhãn dán lên công trình trên bản vẽ (các trường được tích trong bảng Dữ liệu công trình)
export const labelKeys = (doc) => (doc.settings && Array.isArray(doc.settings.bdLabels) ? doc.settings.bdLabels : []);
export function labelLines(r, keys) {
  return keys.map((k) => (k === 'name' ? r.name : k === 'title' ? r.title : k === 'func' ? r.func : k === 'floors' ? (r.floors ? r.floors + 'T' : '') : k === 'material' ? r.material : k === 'status' ? r.status : r.extra && r.extra[k]))
    .filter((t) => t != null && String(t).trim() !== '').map((t) => String(t).trim());
}
const lblCache = new WeakMap();
// id công trình -> các dòng nhãn; dùng lại kết quả khi chỉ số (metrics) chưa đổi
export function labelMap(doc, keys, key) {
  if (!keys.length) return null;
  const sig = keys.join('\u0001') + '|' + doc.items.length;
  const c = key && lblCache.get(key);
  if (c && c.doc === doc && c.sig === sig) return c.map;
  const map = {};
  for (const r of buildingRows(doc)) { const L = labelLines(r, keys); if (L.length) map[r.it.id] = { lines: L, floors: r.floors }; }
  if (key) lblCache.set(key, { doc, sig, map });
  return map;
}
export function extraCols(rows) { const s = new Set(); for (const r of rows) for (const k of Object.keys(r.extra || {})) s.add(k); return [...s]; }
export function setField(it, key, val) {
  const P = it.props; const d = P.bdata || (P.bdata = {});
  if (key === 'floors') { const n = Math.round(+val); if (n >= 1) P.floors = n; return; }
  if (key === 'name' || key === 'title' || key === 'func' || key === 'material' || key === 'status') { if (val === '' || val == null) delete d[key]; else d[key] = String(val); }
  else { const e = d.extra || (d.extra = {}); if (val === '' || val == null) delete e[key]; else e[key] = String(val); }
  if (!Object.keys(d).length || (Object.keys(d).length === 1 && d.extra && !Object.keys(d.extra).length)) delete P.bdata;
}

// ---------- Excel (.xlsx) tối giản: một trang tính, ô chữ / số ----------
const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export function toXLSX(header, data, sheet = 'DuLieuCongTrinh') {
  const rowXml = (vals, r) => `<row r="${r}">${vals.map((v, c) => {
    const ref = colName(c) + r;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 1 ? ' s="1"' : ''}><is><t xml:space="preserve">${xe(v ?? '')}</t></is></c>`;
  }).join('')}</row>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${header.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 18 : 22}" customWidth="1"/>`).join('')}</cols><sheetData>${[header, ...data].map((v, i) => rowXml(v, i + 1)).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': sheetXml,
  };
  const z = {}; for (const [k, v] of Object.entries(files)) z[k] = strToU8(v);
  return new Blob([zipSync(z)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const unx = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
// đọc trang tính đầu tiên của file .xlsx -> mảng các hàng (mảng giá trị chữ)
export function readXLSX(buf, all = false) {
  const z = unzipSync(new Uint8Array(buf));
  const txt = (p) => (z[p] ? strFromU8(z[p]) : '');
  const ss = [];
  const sst = txt('xl/sharedStrings.xml');
  for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) ss.push(unx((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
  // các trang tính theo thứ tự trong workbook (all = false: chỉ trang đầu)
  const wb = txt('xl/workbook.xml'), rels = txt('xl/_rels/workbook.xml.rels');
  const list = [];
  for (const sm of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const id = (/r:id="([^"]+)"/.exec(sm[0]) || [])[1], name = unx((/\bname="([^"]*)"/.exec(sm[0]) || [])[1] || '');
    let path = null;
    if (id) { const m = new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${id}"`).exec(rels); if (m) path = 'xl/' + m[1].replace(/^\/?xl\//, '').replace(/^\//, ''); }
    list.push({ name, path: path || `xl/worksheets/sheet${list.length + 1}.xml` });
  }
  if (!list.length) list.push({ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' });
  const out = [];
  for (const sh of all ? list : list.slice(0, 1)) {
    const sx = txt(sh.path);
    if (!sx) { if (!all) throw new Error('không thấy trang tính trong file Excel'); continue; }
  const rows = [];
  for (const rm of sx.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []) {
    const r = [];
    for (const cm of rm.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) || []) {
      const ref = (/\br="([A-Z]+\d+)"/.exec(cm) || [])[1]; const t = (/\bt="(\w+)"/.exec(cm) || [])[1];
      let v = '';
      if (t === 'inlineStr') v = unx((cm.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<t[^>]*>|<\/t>/g, '')).join(''));
      else { const vm = /<v>([\s\S]*?)<\/v>/.exec(cm); v = vm ? unx(vm[1]) : ''; if (t === 's') v = ss[+v] ?? ''; }
      r[ref ? colIdx(ref) : r.length] = v;
    }
    for (let i = 0; i < r.length; i++) if (r[i] == null) r[i] = '';
    rows.push(r);
  }
    out.push({ name: sh.name, rows: rows.filter((r) => r.some((v) => String(v).trim() !== '')) });
  }
  if (!out.length) throw new Error('không thấy trang tính trong file Excel');
  return all ? out : out[0].rows;
}
// CSV (Excel lưu dạng CSV): dấu phẩy hoặc chấm phẩy
export function readCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '', sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}
export const norm = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
// nối dữ liệu: cột khoá của file <-> trường khoá của bảng; các cột còn lại: trùng tên trường thì cập nhật trường đó, còn lại thêm thành cột riêng
export function joinRows(rows, table, keyCol, keyField) {
  const [header, ...data] = table;
  const fieldByName = new Map(BASE_FIELDS.map(([k, n]) => [norm(n), k]));
  for (const [k] of BASE_FIELDS) fieldByName.set(k, k);
  fieldByName.set('ký hiệu công trình', 'name');
  const idx = new Map(); for (const r of rows) { const v = keyField === 'name' ? r.name : keyField === 'title' ? r.title : keyField === 'auto' ? r.auto : keyField === 'id' ? r.it.id : (r.extra || {})[keyField]; if (v != null && v !== '') idx.set(norm(v), r); }
  let hit = 0, miss = 0, changed = 0;
  for (const d of data) {
    const r = idx.get(norm(d[keyCol])); if (!r) { if (String(d[keyCol] ?? '').trim()) miss++; continue; }
    hit++;
    header.forEach((h, c) => {
      if (c === keyCol || !String(h).trim()) return;
      const f = fieldByName.get(norm(h));
      const v = d[c] ?? '';
      if (f) { if (f === 'floors' && String(v).trim() === '') return; setField(r.it, f, (f === 'name' && norm(v) === norm(r.auto)) || (f === 'func' && norm(v) === norm(r.funcAuto)) ? '' : v); }
      else setField(r.it, String(h).trim(), v);
      changed++;
    });
  }
  return { hit, miss, changed };
}

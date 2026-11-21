// Xuất bảng chỉ tiêu quy hoạch ra Excel (.xlsx) và PDF
// data: { title, total, codes:[{code,name,color,v,pct}], general:[[label, value, unit]], lots:[{type,name,area,mdxd,maxMdxd,far,maxFar,floors,maxFloors,alert}] }
import { zipSync, strToU8 } from '../vendor/three/jsm/libs/fflate.module.js';

const xe = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = ((i - m) / 26) | 0; } return s; };
// ô: số -> number, chuỗi -> inline string; {v, s} để chọn style
function sheetXML(rows, widths) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    if (c == null || c === '') return '';
    const o = typeof c === 'object' ? c : { v: c };
    const ref = colName(ci) + (ri + 1), st = o.s ? ` s="${o.s}"` : '';
    if (typeof o.v === 'number' && isFinite(o.v)) return `<c r="${ref}"${st}><v>${o.v}</v></c>`;
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(o.v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
}
// style: 1 tiêu đề đậm, 2 số 2 lẻ, 3 phần trăm, 4 đậm nền xám (đầu bảng), 5 số nguyên có phân cách, 6 đỏ (vượt)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFC62828"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8ECEF"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="7"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="2" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf fontId="2" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf fontId="3" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function toXLSX(d) {
  const H = (s) => ({ v: s, s: 4 });
  const s1 = [[{ v: d.title + ' – Cơ cấu sử dụng đất', s: 1 }], [],
    [H('Ký hiệu'), H('Loại đất'), H('Diện tích (m²)'), H('Diện tích (ha)'), H('Tỷ lệ')],
    ...d.codes.map((r) => [r.code, r.name, { v: Math.round(r.v * 10) / 10, s: 5 }, { v: r.v / 10000, s: 2 }, { v: r.pct / 100, s: 3 }]),
    [{ v: 'Tổng', s: 4 }, '', { v: Math.round(d.total * 10) / 10, s: 5 }, { v: d.total / 10000, s: 2 }, { v: d.total ? 1 : 0, s: 3 }]];
  const s2 = [[{ v: d.title + ' – Chỉ tiêu từng lô', s: 1 }], [],
    [H('Loại đất'), H('Lô'), H('Diện tích (m²)'), H('MĐXD (%)'), H('MĐXD tối đa (%)'), H('HSSDĐ'), H('HSSDĐ tối đa'), H('Tầng cao'), H('Tầng tối đa'), H('Đánh giá')],
    ...d.lots.map((l) => [l.type, l.name, { v: Math.round(l.area * 10) / 10, s: 5 }, { v: l.mdxd, s: 2 }, l.maxMdxd || '', { v: l.far, s: 2 }, l.maxFar || '', l.floors || '', l.maxFloors || '',
      l.alert === 'over' ? { v: 'Vượt chỉ tiêu', s: 6 } : l.alert ? 'Sắp chạm' : 'Đạt'])];
  const s3 = [[{ v: d.title + ' – Chỉ tiêu chung', s: 1 }], [], [H('Chỉ tiêu'), H('Giá trị'), H('Đơn vị')],
    ...d.general.map(([a, v, u]) => [a, typeof v === 'number' ? { v, s: 2 } : v, u || ''])];
  const sheets = [['Co cau SDD', s1, [12, 34, 16, 14, 10]], ['Chi tieu tung lo', s2, [30, 12, 16, 11, 15, 10, 13, 10, 12, 14]], ['Chi tieu chung', s3, [30, 16, 12]]];
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
  };
  sheets.forEach(([, rows, w], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXML(rows, w); });
  const z = {}; for (const [k, v] of Object.entries(files)) z[k] = strToU8(v);
  return new Blob([zipSync(z, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- PDF: vẽ từng trang A4 lên canvas rồi nhúng JPEG ----------
const PW = 1240, PH = 1754, MG = 80; // A4 ở 150 dpi
const fmtA = (v) => (v >= 10000 ? (v / 10000).toLocaleString('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' ha' : Math.round(v).toLocaleString('vi-VN') + ' m²');
const fN = (v, k = 1) => (v == null || !isFinite(v) ? '—' : (+v).toLocaleString('vi-VN', { maximumFractionDigits: k }));
function pages(d) {
  const out = []; let c, x, y;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const newPage = () => {
    c = document.createElement('canvas'); c.width = PW; c.height = PH; x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'middle';
    x.fillStyle = '#7a8790'; x.font = `20px ${FONT}`; x.textAlign = 'left';
    x.fillText(d.title + ' – Chỉ tiêu quy hoạch', MG, PH - 50); x.textAlign = 'right'; x.fillText('Trang ' + (out.length + 1), PW - MG, PH - 50);
    x.textAlign = 'left'; out.push(c); y = MG;
  };
  const need = (h) => { if (y + h > PH - 100) newPage(); };
  const text = (s, px, py, o = {}) => { x.font = `${o.b ? '600 ' : ''}${o.size || 22}px ${FONT}`; x.fillStyle = o.color || '#1d2a33'; x.textAlign = o.align || 'left'; x.fillText(s, px, py); x.textAlign = 'left'; };
  const fit = (s, w, size, b) => { x.font = `${b ? '600 ' : ''}${size}px ${FONT}`; if (x.measureText(s).width <= w) return s; while (s.length > 1 && x.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; };
  // bảng: cols [{t, w, align}], rows [[...]], sw: ô màu ở cột 0
  const table = (cols, rows, o = {}) => {
    const RH = 40; need(RH * 2);
    const head = () => { x.fillStyle = '#e8ecef'; x.fillRect(MG, y, PW - 2 * MG, RH); let cx = MG; for (const k of cols) { const tx = k.align === 'right' ? cx + k.w - 10 : cx + 10; text(fit(k.t, k.w - 16, 19, true), tx, y + RH / 2, { b: true, size: 19, align: k.align }); cx += k.w; } y += RH; };
    head();
    rows.forEach((r, ri) => {
      if (y + RH > PH - 100) { newPage(); head(); }
      if (ri % 2) { x.fillStyle = '#f7f9fa'; x.fillRect(MG, y, PW - 2 * MG, RH); }
      if (r.foot) { x.fillStyle = '#eef1f3'; x.fillRect(MG, y, PW - 2 * MG, RH); }
      let cx = MG;
      r.cells.forEach((v, i) => {
        const k = cols[i]; let tx = k.align === 'right' ? cx + k.w - 10 : cx + 10;
        if (i === 0 && r.color) { x.fillStyle = r.color; x.fillRect(cx + 10, y + 11, 18, 18); x.strokeStyle = '#0003'; x.strokeRect(cx + 10, y + 11, 18, 18); tx += 26; }
        text(fit(String(v), k.w - 20 - (i === 0 && r.color ? 26 : 0), 20, r.foot || (o.boldCol === i)), tx, y + RH / 2, { size: 20, b: r.foot || o.boldCol === i, align: k.align, color: r.over && i >= (o.overFrom || 0) ? '#c62828' : undefined });
        cx += k.w;
      });
      x.strokeStyle = '#dde3e7'; x.lineWidth = 1; x.beginPath(); x.moveTo(MG, y + RH); x.lineTo(PW - MG, y + RH); x.stroke();
      y += RH;
    });
    y += 24;
  };
  newPage();
  text(d.title, MG, y + 20, { size: 40, b: true }); y += 60;
  text('Chỉ tiêu quy hoạch sử dụng đất · ' + new Date().toLocaleDateString('vi-VN'), MG, y + 10, { size: 22, color: '#5b6872' }); y += 50;
  // biểu đồ vành + chỉ tiêu chung
  const R = 190, cx0 = MG + R + 10, cy0 = y + R + 10; let a = -Math.PI / 2;
  const tot = d.codes.reduce((s, r) => s + r.v, 0);
  if (tot > 0) for (const r of d.codes) { const da = (r.v / tot) * Math.PI * 2; x.beginPath(); x.arc(cx0, cy0, R, a, a + da); x.arc(cx0, cy0, R * 0.6, a + da, a, true); x.closePath(); x.fillStyle = r.color; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); a += da; }
  else { x.beginPath(); x.arc(cx0, cy0, R, 0, 7); x.arc(cx0, cy0, R * 0.6, 7, 0, true); x.fillStyle = '#eef1f3'; x.fill(); }
  text('Tổng diện tích', cx0, cy0 - 18, { size: 20, color: '#5b6872', align: 'center' }); text(fmtA(d.total), cx0, cy0 + 16, { size: 28, b: true, align: 'center' });
  let gy = y + 20; const gx = MG + 2 * R + 70;
  text('Chỉ tiêu chung', gx, gy, { size: 26, b: true }); gy += 44;
  for (const [lab, v, u] of d.general) { text(lab, gx, gy, { size: 21, color: '#3b4852' }); text((typeof v === 'number' ? fN(v, 2) : v) + (u ? ' ' + u : ''), PW - MG, gy, { size: 21, b: true, align: 'right' }); x.strokeStyle = '#e6eaed'; x.beginPath(); x.moveTo(gx, gy + 20); x.lineTo(PW - MG, gy + 20); x.stroke(); gy += 42; }
  y = Math.max(cy0 + R + 40, gy + 20);
  text('Cơ cấu sử dụng đất', MG, y, { size: 26, b: true }); y += 34;
  const W = PW - 2 * MG;
  table([{ t: 'Ký hiệu', w: 150 }, { t: 'Loại đất', w: W - 150 - 220 - 150 }, { t: 'Diện tích', w: 220, align: 'right' }, { t: 'Tỷ lệ', w: 150, align: 'right' }],
    [...d.codes.map((r) => ({ color: r.color, cells: [r.code, r.name, fmtA(r.v), fN(r.pct, 1) + '%'] })), { foot: true, cells: ['Tổng', '', fmtA(d.total), d.total ? '100%' : '—'] }], { boldCol: 0 });
  need(120);
  text('Chỉ tiêu từng lô', MG, y, { size: 26, b: true }); y += 34;
  table([{ t: 'Loại đất', w: W - 120 - 180 - 170 - 150 - 140 }, { t: 'Lô', w: 120 }, { t: 'Diện tích', w: 180, align: 'right' }, { t: 'MĐXD (%)', w: 170, align: 'right' }, { t: 'HSSDĐ', w: 150, align: 'right' }, { t: 'Tầng', w: 140, align: 'right' }],
    d.lots.length ? d.lots.map((l) => ({ over: l.alert === 'over', color: l.color, cells: [l.type, l.name, fmtA(l.area), fN(l.mdxd) + (l.maxMdxd ? ' / ' + l.maxMdxd : ''), fN(l.far, 2) + (l.maxFar ? ' / ' + l.maxFar : ''), (l.floors || '—') + (l.maxFloors ? ' / ' + l.maxFloors : '')] })) : [{ cells: ['Chưa có ô đất', '', '', '', '', ''] }],
    { boldCol: 1, overFrom: 3 });
  if (d.lots.some((l) => l.alert === 'over')) { need(40); text('Chữ đỏ: lô vượt chỉ tiêu khống chế (giá trị thực tế / tối đa).', MG, y, { size: 19, color: '#c62828' }); }
  return out;
}
const enc = new TextEncoder();
export async function toPDF(d) {
  const cs = pages(d);
  const jpgs = [];
  for (const c of cs) { const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); jpgs.push(new Uint8Array(await b.arrayBuffer())); }
  // A4 595x842 pt
  const parts = []; const offs = []; let len = 0;
  const push = (u) => { if (typeof u === 'string') u = enc.encode(u); parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = cs.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`);
  for (let i = 0; i < n; i++) {
    const p = 3 + i * 3, im = p + 1, ct = p + 2;
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    obj(im, [`<< /Type /XObject /Subtype /Image /Width ${PW} /Height ${PH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgs[i].length} >>\nstream\n`, jpgs[i], '\nendstream']);
    const s = `q 595.28 0 0 841.89 0 0 cm /Im${i} Do Q`;
    obj(ct, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  }
  const total = 3 + n * 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

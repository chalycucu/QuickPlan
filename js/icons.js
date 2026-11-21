// Bộ biểu tượng thông dụng (khung 24×24, dạng đường dẫn SVG)
export const ICONS = {
  pin: { name: 'Vị trí', d: 'M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 4.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z', color: '#dc2626' },
  star: { name: 'Ngôi sao', d: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z', color: '#f59e0b' },
  flag: { name: 'Cờ', d: 'M5 2h2v20H5zM7 3h12l-3.5 4.5L19 12H7z', color: '#dc2626' },
  tree: { name: 'Cây xanh', d: 'M12 2l6 8h-3l4 6h-6v6h-2v-6H5l4-6H6z', color: '#15803d' },
  house: { name: 'Nhà ở', d: 'M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3z', color: '#b45309' },
  school: { name: 'Trường học', d: 'M12 3L1 9l11 6 9-4.9V17h2V9zM5 13.2v4L12 21l7-3.8v-4L12 17z', color: '#2563eb' },
  hospital: { name: 'Y tế', d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', color: '#dc2626' },
  people: { name: 'Cộng đồng', d: 'M8 4a3 3 0 110 6 3 3 0 010-6zm8 0a3 3 0 110 6 3 3 0 010-6zM2 20v-3c0-2.5 3-4 6-4s6 1.5 6 4v3zm12.6 0v-3c0-1.2-.5-2.3-1.4-3.1.9-.6 2.2-.9 3.4-.9 3 0 6.4 1.5 6.4 4v3z', color: '#7c3aed' },
  car: { name: 'Ô tô', d: 'M5 11l1.5-4.5C6.8 5.6 7.6 5 8.5 5h7c.9 0 1.7.6 2 1.5L19 11v8h-2.5v-2h-9v2H5zm2.6-1h8.8l-1-3H8.6zM7.5 12.2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm9 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z', color: '#334155' },
  drop: { name: 'Nước', d: 'M12 2s-7 8-7 13a7 7 0 0014 0c0-5-7-13-7-13z', color: '#0284c7' },
  bolt: { name: 'Điện', d: 'M13 2L4 14h7l-1 8 9-12h-7z', color: '#eab308' },
  eye: { name: 'Điểm nhìn', d: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 3a4 4 0 110 8 4 4 0 010-8z', color: '#0f766e' },
  heart: { name: 'Trái tim', d: 'M12 21l-1.5-1.3C5 15 2 12.1 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.6-3 6.5-8.5 11.2z', color: '#e11d48' },
  warn: { name: 'Cảnh báo', d: 'M12 2L1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z', color: '#ea580c' },
  check: { name: 'Đồng ý', d: 'M9 16.2l-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z', color: '#16a34a' },
  north: { name: 'Hướng Bắc', d: 'M12 1l7 21-7-4.5L5 22z', color: '#111827' },
  P: { name: 'Bãi đỗ xe', text: 'P', color: '#1d4ed8' },
  i: { name: 'Thông tin', text: 'i', color: '#0369a1' },
  WC: { name: 'Vệ sinh', text: 'WC', color: '#475569' },
  BUS: { name: 'Xe buýt', text: 'BUS', color: '#16a34a' },
};
export const ICON_KEYS = Object.keys(ICONS);
const cache = {};
export const iconPath = (k) => cache[k] || (cache[k] = ICONS[k] && ICONS[k].d ? new Path2D(ICONS[k].d) : null);

// vẽ biểu tượng tâm (x,y), kích thước px
export function drawIconAt(ctx, k, x, y, px, color) {
  const ic = ICONS[k] || ICONS.pin; const col = color || ic.color;
  ctx.save(); ctx.translate(x, y);
  if (ic.text) {
    const r = px / 2; ctx.beginPath();
    ctx.moveTo(-r + 4, -r); ctx.arcTo(r, -r, r, r, px * 0.18); ctx.arcTo(r, r, -r, r, px * 0.18); ctx.arcTo(-r, r, -r, -r, px * 0.18); ctx.arcTo(-r, -r, r, -r, px * 0.18); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, px * 0.06); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(px * (ic.text.length > 2 ? 0.36 : ic.text.length > 1 ? 0.46 : 0.7))}px system-ui, sans-serif`;
    ctx.fillText(ic.text, 0, px * 0.04);
  } else {
    const s = px / 24; ctx.scale(s, s); ctx.translate(-12, -12);
    const p = iconPath(k);
    ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3 / Math.max(0.6, s) + 1.2; ctx.stroke(p);
    ctx.fillStyle = col; ctx.fill(p, 'evenodd');
  }
  ctx.restore();
}

// Nhãn viết tay: ink = { w, h, s: [[x0,y0,x1,y1,...], ...] } (toạ độ điểm trên khung viết)
export function inkSize(ink, h) { const k = h / Math.max(1, ink.h); return [ink.w * k, h]; }
export function drawInk(ctx, ink, cx, top, h, color) {
  if (!ink || !ink.s) return;
  const k = h / Math.max(1, ink.h), x0 = cx - (ink.w * k) / 2;
  ctx.save(); ctx.strokeStyle = color || '#111827'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.2, (ink.lw || 5) * k);
  for (const st of ink.s) {
    if (st.length < 2) continue;
    ctx.beginPath(); ctx.moveTo(x0 + st[0] * k, top + st[1] * k);
    if (st.length === 2) ctx.lineTo(x0 + st[0] * k + 0.1, top + st[1] * k);
    for (let i = 2; i < st.length; i += 2) ctx.lineTo(x0 + st[i] * k, top + st[i + 1] * k);
    ctx.stroke();
  }
  ctx.restore();
}

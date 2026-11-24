// QP-23: thanh cuộn luôn hiện ở mép phải của hộp thoại / danh sách khi nội dung dài hơn khung (iPad ẩn thanh cuộn của hệ thống)
const SEL = '.pnl, .pop, .props, .toolopts, .lu-grid, .bd-wrap, .toolgrp, .hud, .ctxmenu, .chooser';
export const isIPad = () => /iPad|iPhone/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const rails = new Map(); // phần tử -> thanh cuộn
let timer = 0, raf = 0;

function scrollable(el) {
  if (el.scrollHeight <= el.clientHeight + 2 || !el.offsetParent) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll';
}
function clipRect(el) { // khung nhìn thấy được của phần tử (cắt theo khung cuộn chứa nó)
  const r = el.getBoundingClientRect();
  let top = r.top, bottom = r.bottom, right = r.right;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowY !== 'visible') { const q = p.getBoundingClientRect(); top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom); right = Math.min(right, q.right); }
  }
  return { top, bottom, right, r };
}
function makeRail(el) {
  const rail = document.createElement('div'); rail.className = 'srail';
  const th = document.createElement('b'); rail.append(th); document.body.append(rail);
  let drag = null;
  th.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    drag = { y: e.clientY, s: el.scrollTop }; rail.classList.add('on');
    try { th.setPointerCapture(e.pointerId); } catch {}
  });
  th.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const H = rail.clientHeight, t = th.offsetHeight, max = el.scrollHeight - el.clientHeight;
    if (H - t > 0) el.scrollTop = drag.s + ((e.clientY - drag.y) * max) / (H - t);
    place(el, rail);
  });
  const end = () => { drag = null; rail.classList.remove('on'); };
  th.addEventListener('pointerup', end); th.addEventListener('pointercancel', end);
  for (const t of ['touchstart', 'touchmove']) th.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  return rail;
}
function place(el, rail) {
  const c = clipRect(el), H = c.bottom - c.top - 8;
  if (H < 30 || c.right < c.r.left + 20) { rail.hidden = true; return; }
  rail.hidden = false;
  const max = el.scrollHeight - el.clientHeight, th = Math.max(28, (H * el.clientHeight) / el.scrollHeight);
  // phần tử bị cắt bởi khung chứa: thanh cuộn chỉ trên phần nhìn thấy
  Object.assign(rail.style, { left: c.right - 10 + 'px', top: c.top + 4 + 'px', height: H + 'px' });
  const b = rail.firstChild; b.style.height = th + 'px'; b.style.top = (max > 0 ? (el.scrollTop / max) * (H - th) : 0) + 'px';
}
function update() {
  const seen = new Set();
  for (const el of document.querySelectorAll(SEL)) {
    if (el.hidden || !scrollable(el)) continue;
    seen.add(el);
    let rail = rails.get(el); if (!rail) { rail = makeRail(el); rails.set(el, rail); }
    place(el, rail);
  }
  for (const [el, rail] of rails) if (!seen.has(el) || !el.isConnected) { rail.remove(); rails.delete(el); }
}
const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
export function initRails(force = false) {
  if (!(force || isIPad() || window.__qpRails)) return false;
  document.body.classList.add('has-rails');
  addEventListener('scroll', soon, true); addEventListener('resize', soon);
  clearInterval(timer); timer = setInterval(update, 250);
  soon();
  return true;
}
export const railCount = () => [...rails.values()].filter((r) => !r.hidden).length;

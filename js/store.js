import { api, ping, pc, HOSTED, apiBase } from './pc.js';
// Lưu bản vẽ trên iPad (IndexedDB) và đồng bộ về PC khi có kết nối.
const DB_NAME = 'quickplan';
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('drawings', { keyPath: 'id' });
      d.createObjectStore('dirty', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => (out = v));
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getDrawing(id) { return tx('drawings', 'readonly', (s) => req(s.get(id))); }
export async function listLocal() {
  const all = await tx('drawings', 'readonly', (s) => req(s.getAll()));
  return all.filter((d) => !d.deleted).map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, thumb: d.thumb }));
}
export async function putDrawing(doc, { markDirty = true } = {}) {
  await tx('drawings', 'readwrite', (s) => s.put(doc));
  if (markDirty) await tx('dirty', 'readwrite', (s) => s.put({ id: doc.id }));
}
export async function deleteDrawing(id) {
  const d = await getDrawing(id);
  if (!d) return;
  d.deleted = true; d.updatedAt = Date.now(); d.items = []; d.base = null;
  await putDrawing(d);
}

// ---------- Đồng bộ ----------
export const sync = {
  state: 'idle', // idle | syncing | ok | offline | error
  lastOk: 0,
  listeners: new Set(),
  set(s) { this.state = s; if (s === 'ok') this.lastOk = Date.now(); this.listeners.forEach((f) => f(s)); },
};

async function serverAlive() {
  const ok = await ping();
  pc.ok = ok;
  return ok;
}

let running = false;
export async function syncNow(onRemoteUpdate) {
  if (running) return; running = true;
  try {
    if (apiBase() === null) { sync.set('nopc'); return; }
    if (!(await serverAlive())) { sync.set('offline'); return; }
    sync.set('syncing');
    // 1) đẩy bản vẽ đã sửa lên PC
    const dirty = await tx('dirty', 'readonly', (s) => req(s.getAll()));
    for (const { id } of dirty) {
      const d = await getDrawing(id);
      if (!d) { await tx('dirty', 'readwrite', (s) => s.delete(id)); continue; }
      const r = await api('/api/drawings/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (r.ok) {
        const cur = await getDrawing(id);
        if (cur && cur.updatedAt === d.updatedAt) await tx('dirty', 'readwrite', (s) => s.delete(id));
      } else if (r.status === 409) {
        const remote = await r.json();
        await putDrawing(remote, { markDirty: false });
        await tx('dirty', 'readwrite', (s) => s.delete(id));
        onRemoteUpdate && onRemoteUpdate(remote);
      } else throw new Error('PUT ' + r.status);
    }
    // 2) kéo bản vẽ mới hơn từ PC về
    const r = await api('/api/drawings', { cache: 'no-store' });
    if (r.ok) {
      const list = await r.json();
      for (const m of list) {
        const local = await getDrawing(m.id);
        if (!local || local.updatedAt < m.updatedAt) {
          const rr = await api('/api/drawings/' + m.id, { cache: 'no-store' });
          if (rr.ok) { const remote = await rr.json(); await putDrawing(remote, { markDirty: false }); onRemoteUpdate && onRemoteUpdate(remote); }
        }
      }
    }
    sync.set('ok');
  } catch (e) {
    console.warn('Đồng bộ lỗi', e);
    sync.set(navigator.onLine ? 'error' : 'offline');
  } finally { running = false; }
}

// Gửi file xuất về thư mục XuatFile trên PC
export async function sendExportToPC(name, blob) {
  const r = await api('/api/export/' + encodeURIComponent(name), { method: 'PUT', body: blob });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

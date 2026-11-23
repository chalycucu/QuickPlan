// Bộ nhớ đệm để QuickPlan chạy khi mất mạng
const CACHE = 'quickplan-v0.30.0';
const FILES = [
  './', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/geom.js', 'js/model.js', 'js/render2d.js', 'js/store.js', 'js/exporters.js', 'js/fill.js', 'js/demo.js', 'js/shapes.js', 'js/constrain.js', 'js/basemap.js', 'js/view3d.js', 'js/export3d.js', 'js/icons.js', 'js/handwrite.js', 'js/zoneops.js', 'js/hudexport.js', 'js/vn2000.js', 'js/faces.js', 'js/axis.js', 'js/materials.js', 'js/digits-model.js', 'js/terrain.js', 'js/autolayout.js', 'js/roadops.js', 'js/pen.js', 'js/onedrive.js', 'js/landuse-tables.js', 'js/handwrite-text.js', 'js/letters-model.js', 'js/pc.js',
  'vendor/three/build/three.module.min.js', 'vendor/three/jsm/controls/OrbitControls.js',
  'vendor/three/jsm/exporters/GLTFExporter.js', 'vendor/three/jsm/exporters/OBJExporter.js', 'vendor/three/jsm/exporters/USDZExporter.js',
  'vendor/three/jsm/utils/TextureUtils.js', 'vendor/three/jsm/utils/BufferGeometryUtils.js', 'vendor/three/jsm/environments/RoomEnvironment.js', 'vendor/three/jsm/loaders/GLTFLoader.js', 'vendor/three/jsm/loaders/OBJLoader.js', 'vendor/three/jsm/libs/fflate.module.js',
  'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png', 'img/splash.jpg', 'img/logo.jpg',
];
// Safari không nhận phản hồi đã qua chuyển hướng từ service worker: tạo bản sạch
async function clean(r) {
  if (!r || !r.redirected) return r;
  const body = await r.blob();
  return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
}
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(FILES.map(async (f) => {
      const r = await fetch(new Request(f, { cache: 'reload' }));
      if (!r.ok) throw new Error('Không tải được ' + f);
      await c.put(f, await clean(r));
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET' || u.pathname.includes('/api/')) return;
  if (e.request.mode === 'navigate') {
    const root = new URL(self.registration.scope).pathname; // '/' trên máy tính, '/quickplan/' trên trang web
    if (u.pathname !== root && u.pathname !== root + 'index.html') return; // các trang khác (cài đặt, PC) đi thẳng mạng
    // trang chính: ưu tiên mạng (để nhận bản mới), mất mạng thì dùng bản đã lưu
    e.respondWith((async () => {
      try {
        const r = await clean(await fetch('./', { cache: 'no-cache' }));
        if (r.ok) { const c = await caches.open(CACHE); await c.put('./', r.clone()); }
        return r;
      } catch (err) {
        return clean(await caches.match('./'));
      }
    })());
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)).then(clean));
});

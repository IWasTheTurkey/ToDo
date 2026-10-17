const CACHE = "todo-v1";
const SHELL = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Network first so updates show straight away; fall back to the saved copy when offline.
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./"))));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: "Reminder", body: e.data && e.data.text() }; }
  const opts = { body: d.body || "", tag: d.id || "todo", renotify: true, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    data: { id: d.id }, actions: d.id ? [{ action: "snooze", title: "Snooze 10 min" }, { action: "done", title: "Done" }] : [] };
  e.waitUntil(self.registration.showNotification(d.title || "To Do List", opts));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const url = id ? "./?act=" + (e.action || "open") + "&task=" + encodeURIComponent(id) : "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    const c = cs[0];
    if (c) { c.postMessage({ url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

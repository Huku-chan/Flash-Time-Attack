const CACHE="cat-time-attack-v5";
const LOCAL=[
  "./","./index.html","./styles.css","./app.js","./config.js",
  "./cats.js","./manifest.webmanifest"
];
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(LOCAL)));
  self.skipWaiting();
});
self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    ))
  );
  self.clients.claim();
});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  if(new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached=>
      cached || fetch(e.request).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return response;
      })
    )
  );
});

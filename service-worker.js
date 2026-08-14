const CACHE_NAME="flash-mental-yellow-v11";
const ASSETS=[
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./assets/goblin.png",
  "./assets/goblin_angry.png",
  "./assets/goblin_dying.png",
  "./assets/goblin4.png",
  "./assets/boss.png",
  "./assets/lumine.png",
  "./assets/ready_countdown.mp3"
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.hostname.includes("supabase.co"))return;
  event.respondWith(
    caches.match(event.request).then(cached=>{
      const network=fetch(event.request).then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        return resp;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});

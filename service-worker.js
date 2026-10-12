const CACHE='outdoor-dashboard-v1.29.3-2026-10-12-vue';const SHELL=["./","./index.html","./manifest.json","./icon-192.png","./icon-512.png","./assets/index-D2xJkKV7.js","./assets/ActivityDetail-Bqkz4aj_.js","./assets/ActivityEditor-Bg9XXWJs.js","./assets/ActivityList-FzXxytf8.js","./assets/AiSettings-BcJYVH1l.js","./assets/AppDialog-wTtlWgS2.js","./assets/BodyEditor-e3ofxSe6.js","./assets/BodyLog-DwSXcv3L.js","./assets/activity-display-CnL_l3TC.js","./assets/activity-model-FM1AIusU.js","./assets/body-model-BQexOyhF.js","./assets/record-markdown-TNO7Rmpr.js","./assets/index-DvYvXqV_.css"];
   self.addEventListener('install',e=>{
     e.waitUntil(caches.open(CACHE).then(c=>
       c.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})))
     ));
   });
   self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
   self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('outdoor-dashboard-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
   self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const url=new URL(e.request.url);const allowed=new Set(SHELL.map(p=>new URL(p,self.registration.scope).href));if(url.origin!==self.location.origin||!allowed.has(url.origin+url.pathname))return;
   e.respondWith(caches.open(CACHE).then(async c=>{const cached=await c.match(e.request);if(cached)return cached;return fetch(e.request);}));});
   self.addEventListener('sync',e=>{if(e.tag==='flush-mutations')e.waitUntil(self.clients.matchAll({type:'window'}).then(cs=>cs.forEach(c=>c.postMessage({type:'FLUSH_QUEUE'}))));});
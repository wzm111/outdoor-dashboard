const CACHE='outdoor-dashboard-v1.31.0-2026-10-13-vue';const SHELL=["./","./index.html","./manifest.json","./icon-192.png","./icon-512.png","./assets/index-BjSiOqmu.js","./assets/ActivityDetail-DNVbZaSu.js","./assets/ActivityEditor-D6g1t4vp.js","./assets/ActivityList-DWNNryDQ.js","./assets/AiSettings-Cp_LienR.js","./assets/AppDialog-Dv4rrJWJ.js","./assets/BodyEditor-DjI4Y8E_.js","./assets/BodyLog-Dmn0RoWr.js","./assets/Outing-mr1l8rUK.js","./assets/TrailMap-ClwIrVmN.js","./assets/activity-display-CnL_l3TC.js","./assets/activity-model-FM1AIusU.js","./assets/body-model-BQexOyhF.js","./assets/record-markdown-TNO7Rmpr.js","./assets/runtime-core.esm-bundler-DC3Tigql.js","./assets/Outing-jQBE0wG3.css","./assets/TrailMap-DBE96hFo.css","./assets/index-Dv0T4aJC.css","./assets/maplibre-gl-worker-CV6NbyPW.js"];
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
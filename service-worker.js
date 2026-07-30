const CACHE_NAME='organiseus-remove-old-caches-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));await self.registration.unregister();const clientsList=await self.clients.matchAll({type:'window'});for(const client of clientsList)client.navigate(client.url);})()));
self.addEventListener('fetch',()=>{});

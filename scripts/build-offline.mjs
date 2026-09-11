import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HASH_META = /<meta name="frc-asset-build" content="[a-f0-9]+">\n?/g;
export function isApplicationAsset(path) {
  if (path === "index.html" || path === "THIRD_PARTY_NOTICES.txt") return true;
  if (
    path === "sw.js" ||
    /(^|\/)(sessions?|reports?|exports?|uploads?)(\/|$)/i.test(path)
  )
    return false;
  return (
    /\.(js|css|wasm|ttf|otf|woff2?|png|jpe?g|webp|svg|ico)$/i.test(path) ||
    /^fonts\/LICENSE[^/]*\.txt$/i.test(path)
  );
}
export function workerSource(manifest) {
  return `/* Generated application-only offline cache. No student/session/report data. */
const VERSION=${JSON.stringify(manifest.version)};
const FILES=${JSON.stringify([...manifest.assets, "offline-manifest.json"])};
const BASE=new URL(self.registration.scope);
const PREFIX='frc-driver-lab:'+BASE.pathname+':assets:';
const CACHE=PREFIX+VERSION;
const PIN='frc-build';
const assetUrl=path=>new URL(path,BASE).href;
const allowed=new Set(FILES.map(assetUrl));
const updates=new Map();
const cacheNames=async()=>(await caches.keys()).filter(name=>name.startsWith(PREFIX)&&/^[a-f0-9]{16}$/.test(name.slice(PREFIX.length)));
function pinned(url){const value=new URL(url).searchParams.get(PIN);return value&&/^[a-f0-9]{16}$/.test(value)?value:null;}
async function clientVersion(event){if(event.request.mode==='navigate')return pinned(event.request.url)||VERSION;const client=event.clientId?await self.clients.get(event.clientId):null;return client?pinned(client.url)||VERSION:VERSION;}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const existed=await caches.has(CACHE);const cache=await caches.open(CACHE);
 try{await cache.addAll(FILES.map(path=>new Request(assetUrl(path),{cache:'reload'})));}catch(error){if(!existed)await caches.delete(CACHE);throw error;}
 // Never skip waiting during install: an existing assessment keeps its worker.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const names=await cacheNames();const keep=new Set([CACHE,...names.filter(n=>n!==CACHE).slice(-1)]);
 for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){const version=pinned(client.url);if(version)keep.add(PREFIX+version);}
 for(const name of names)if(!keep.has(name))await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==BASE.origin)return;
 const isNavigation=request.mode==='navigate'&&(url.pathname===BASE.pathname||url.pathname===new URL('index.html',BASE).pathname);
 const key=isNavigation?assetUrl('index.html'):url.origin+url.pathname;
 // Only app paths are intercepted. Unknown data/report URLs are never cached.
 if(!isNavigation&&!allowed.has(key)&&!url.pathname.startsWith(new URL('assets/',BASE).pathname)&&!url.pathname.startsWith(new URL('fonts/',BASE).pathname))return;
 event.respondWith((async()=>{
  const version=await clientVersion(event),name=PREFIX+version;
  if(await caches.has(name)){const response=await (await caches.open(name)).match(key);if(response)return response;}
  // A pinned build must never silently mix an unavailable asset from a new build.
  return new Response('This application asset is no longer cached. Keep any open session available for export. Between sessions, clear the offline application cache and load the app online again.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  // No network fallback or runtime writes: a new deployment cannot mix into a pinned build.
 })());
});
async function notify(source,message){if(source&&typeof source.postMessage==='function')source.postMessage(message);}
self.addEventListener('message',event=>{
 const data=event.data||{};
 const reply=value=>{if(event.ports&&event.ports[0])event.ports[0].postMessage(value);};
 if(data.type==='LIST_BUILDS'){event.waitUntil((async()=>reply({current:VERSION,versions:(await cacheNames()).map(n=>n.slice(PREFIX.length)).reverse()}))());return;}
 if(data.type==='UPDATE_READINESS'){
  const pending=updates.get(data.token);if(pending&&event.source&&pending.expected.has(event.source.id)){pending.responses.set(event.source.id,data.ready===true);pending.check();}return;
 }
 if(data.type!=='ACTIVATE')return;
 event.waitUntil((async()=>{
  const clients=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c=>{const url=new URL(c.url);return url.origin===BASE.origin&&(url.pathname===BASE.pathname||url.pathname===new URL('index.html',BASE).pathname);});
  const token=String(Date.now())+'-'+Math.random();
  const ready=await new Promise(resolve=>{
   const pending={expected:new Set(clients.map(c=>c.id)),responses:new Map(),check:()=>{}};
   let timer;const finish=result=>{clearTimeout(timer);updates.delete(token);resolve(result);};
   pending.check=()=>{if([...pending.responses.values()].some(v=>!v))finish(false);else if(pending.responses.size===pending.expected.size)finish(true);};
   updates.set(token,pending);timer=setTimeout(()=>finish(false),3000);
   if(!clients.length){finish(false);return;}
   clients.forEach(c=>notify(c,{type:'PREPARE_UPDATE',token}));
  });
  if(!ready){reply({ok:false,reason:'End sessions in every open FRC Driver Lab tab before applying this update.'});return;}
  reply({ok:true,version:VERSION});await self.skipWaiting();
 })());
});
`;
}
export async function buildOffline(outDir = "dist") {
  const directory = resolve(outDir),
    paths = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Symlinks are not allowed in the offline build.");
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const path = relative(directory, full).split("\\").join("/");
        if (isApplicationAsset(path)) paths.push(path);
      }
    }
  }
  await visit(directory);
  paths.sort();
  if (!paths.includes("index.html"))
    throw new Error(
      "Build the Vite application before generating offline assets.",
    );
  const hash = createHash("sha256");
  let index = "";
  for (const path of paths) {
    let bytes = await readFile(resolve(directory, path));
    if (path === "index.html") {
      index = bytes.toString().replace(HASH_META, "");
      bytes = Buffer.from(index);
    }
    hash
      .update(path + "\0")
      .update(bytes)
      .update("\0");
  }
  if (!index.includes("</head>"))
    throw new Error(
      "The production index must contain a closing head element.",
    );
  const version = hash.digest("hex").slice(0, 16),
    manifest = { schemaVersion: 1, version, assets: paths };
  await writeFile(
    resolve(directory, "index.html"),
    index.replace(
      "</head>",
      `<meta name="frc-asset-build" content="${version}">\n</head>`,
    ),
  );
  await writeFile(
    resolve(directory, "offline-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(resolve(directory, "sw.js"), workerSource(manifest));
  return manifest;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = await buildOffline(process.argv[2] || "dist");
  console.log(
    `Offline build ${manifest.version}: ${manifest.assets.length} application assets (no session/report cache).`,
  );
}

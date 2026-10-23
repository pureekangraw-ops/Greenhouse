import {readFile,writeFile} from 'node:fs/promises';
const {build}=await import(process.env.ESBUILD_MODULE||'esbuild');
const root=new URL('../',import.meta.url);
const bundle=await build({entryPoints:[new URL('greenhouse/app.js',root).pathname],bundle:true,write:false,format:'iife',minify:false});
let html=await readFile(new URL('greenhouse/index.html',root),'utf8');
const css=await readFile(new URL('greenhouse/app.css',root),'utf8');
// Offline review artifact: no source, credentials, model or service worker calls.
const offline=`globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).endsWith('/local-ai')?{configured:false,models:[],state:'DISCONNECTED'}:String(url).endsWith('/status')?{ownerSession:false,inboxReader:false}:{code:'OFFLINE_PREVIEW_ONLY'}),{status:String(url).includes('/requests/')?503:200,headers:{'content-type':'application/json'}});`;
const js=bundle.outputFiles[0].text.replace(/if \("serviceWorker" in navigator[^\n]+/g,'if (false) {}');
html=html.replace(/  <link rel="manifest"[^>]+>\n/,'').replace('<link rel="stylesheet" href="/greenhouse/app.css">','<style>'+css+'</style>')
 .replace('href="/greenhouse/"','href="#"')
 .replace('<title>Greenhouse · Workspace</title>','<title>Greenhouse · Offline review preview</title>')
 .replace('กล่องรับงานเจ้าของ</small>','OFFLINE REVIEW · DEMO</small>')
 .replace('<script type="module" src="/greenhouse/app.js"></script>','<script>'+offline+js.replaceAll('</script','<\\/script')+'</script>');
await writeFile(new URL('docs/workspace-ui/preview.html',root),html);
console.log('Built docs/workspace-ui/preview.html — offline only, no deployment.');

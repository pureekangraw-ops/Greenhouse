import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const {build}=await import(process.env.ESBUILD_MODULE||'esbuild');
const root=new URL('../',import.meta.url);
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
let html=await readFile(new URL('greenhouse/index.html',root),'utf8');
const css=await readFile(new URL('greenhouse/app.css',root),'utf8');
const bundled=await build({entryPoints:[new URL('greenhouse/workspace.mjs',root).pathname],bundle:true,write:false,format:'iife',plugins:[{name:'demo-only',setup(b){b.onLoad({filter:/workspace\.mjs$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('render();aiStatus();','render();deviceMode();'),loader:'js'}));}}]});
// Only a device-side inference initiated by the existing consent-gated panel
// may leave this demo. No same-origin source/admin/provider APIs are contacted.
const guard=`const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options={})=>String(url)==='http://localhost:8000/v1/chat/completions'&&options.method==='POST'?originalFetch(url,options):Promise.resolve(new Response(JSON.stringify({code:'PREVIEW_ONLY',configured:false,models:[],state:'DISCONNECTED'}),{status:503,headers:{'content-type':'application/json'}}));`;
const js=guard+bundled.outputFiles[0].text;
html=html.replace(/  <link rel="manifest"[^>]+>\n/,'').replace('<link rel="stylesheet" href="/greenhouse/app.css">','<style>'+css+'</style>')
 .replace(/<details class="integration-details">[\s\S]*?<\/details>/,'')
 .replace(/<form id="request-read-form"/,'<form hidden id="request-read-form"')
 .replace('<option value="live">ผลอ่านกลับจริง</option>','')
 .replace('<option value="provider">Provider ที่ระบบอนุญาต</option>','')
 .replace('<span class="connection" id="connection"><i></i> กำลังตรวจการเชื่อมต่อ</span>','<span class="connection">DEMO PREVIEW · '+commit.slice(0,7)+'</span>')
 .replace('ข้อมูลจากหน้าจอเจ้าของ: HERMES-R5 RUNNING','ข้อมูลจากหน้าจอเจ้าของ: OlliteRT · โมเดล HERMES-R5 RUNNING')
 .replace('href="/greenhouse/"','href="/"')
 .replace('<title>Greenhouse · Workspace</title>','<title>Greenhouse · Android demo preview</title><meta name="greenhouse-preview-commit" content="'+commit+'">')
 .replace('<script type="module" src="/greenhouse/app.js"></script>','<script>'+js.replaceAll('</script','<\\/script')+'</script>');
const hash=text=>createHash('sha256').update(text).digest('base64');
const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'sha256-${hash(js)}'; style-src 'sha256-${hash(css)}'; connect-src http://localhost:8000; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'`};
const version={commit,demoOnly:true,privilegedAPI:false,runtimeApp:'OlliteRT',importedModel:'HERMES-R5',protocolVerified:false,modelIdVerified:false};
const worker=`const html=${JSON.stringify(html)};const headers=${JSON.stringify(headers)};const version=${JSON.stringify(version)};
export default {async fetch(request){const path=new URL(request.url).pathname;
 if(path.startsWith('/api/'))return Response.json({code:'PREVIEW_API_DISABLED'},{status:404,headers:{'cache-control':'no-store'}});
 if(!['GET','HEAD'].includes(request.method))return new Response('Read only',{status:405});
 if(path==='/preview-version.json')return Response.json(version,{headers:{'cache-control':'no-store'}});
 if(!['/','/greenhouse/','/greenhouse/index.html'].includes(path))return new Response('Not found',{status:404});
 return new Response(request.method==='HEAD'?null:html,{headers});}};
`;
const out=process.env.DEMO_PREVIEW_OUTPUT||'/tmp/greenhouse-demo-deployment';await mkdir(out,{recursive:true});
await writeFile(out+'/_worker.js',worker);await writeFile(out+'/version.json',JSON.stringify(version,null,2));
console.log(JSON.stringify({out,version,workerSha256:createHash('sha256').update(worker).digest('hex')}));

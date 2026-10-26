// Screenshot-only fixture server. Uses the compiled UI and in-memory dummy data.
// No real accounts, credentials or application settings are read or changed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createFixtures } = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist-renderer');
const version = require(path.join(root, 'package.json')).version;
const { statisticsReport } = require(path.join(root, 'dist-main/main/providers/statistics-report.js'));
const { PROVIDERS } = require(path.join(root, 'dist-main/shared/providers.js'));

const scenes = {
  dashboard: [['Codex', '/index.html?view=codex', 400, 720], ['Providers', '/index.html?view=providers', 400, 720]],
  statistics: [['Quota statistics', '/stats.html?view=statistics', 760, 650]],
  api: [['API balance history', '/stats.html?view=api', 760, 720]],
  settings: [['Settings', '/index.html?view=settings', 430, 1000]],
};

function showcase(scene) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CodexTracker ${version} — ${scene}</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#0f0f10}
  .stage{display:flex;align-items:flex-start;gap:16px;width:max-content;padding:16px}
  .pane{border:1px solid #2a2a2e;border-radius:9px;overflow:hidden;background:#0f0f10}
  iframe{display:block;border:0;background:#0f0f10}
  </style></head><body><main class="stage">${scenes[scene].map(([label,url,width,height])=>`<div class="pane"><iframe title="${label}" width="${width}" height="${height}" src="${url}"></iframe></div>`).join('')}</main></body></html>`;
}

async function startPreview() {
  const fixtures = createFixtures(PROVIDERS);
  const store = { list: async () => Object.keys(fixtures.history).map(id => ({ id, region: 'global' })), read: async config => fixtures.history[config.id] || [] };
  const entries = await Promise.all(['codex', ...PROVIDERS.map(p => p.id)].map(async id => [id, await statisticsReport({ id, region: 'global' }, fixtures.settings, fixtures.codex, fixtures.codexHistory, store, fixtures.now)]));
  const reports = Object.fromEntries(entries);
  const mock = `
  const data=${JSON.stringify({ settings: fixtures.settings, codex: fixtures.codex, snapshots: fixtures.snapshots, reports })};
  const view=new URLSearchParams(location.search).get('view');
  let settings=structuredClone(data.settings), auth=true;
  if(view==='settings'){settings.codex_enabled=false;settings.providers=[];}
  else if(view==='codex'){settings.providers=[];settings.codex_banked_reset_budget=true;}
  else if(view==='providers'){settings.codex_enabled=false;settings.providers=settings.providers.filter(p=>['antigravity','deepseek'].includes(p.id));}
  const events=new Set(), statsEvents=new Set();
  const snapshots=()=>data.snapshots.filter(s=>settings.providers.some(p=>p.id===s.id&&p.enabled));
  window.codexAPI={
   getSettings:async()=>structuredClone(settings),setSettings:async value=>{settings=structuredClone(value);events.forEach(cb=>cb(snapshots()));return{ok:true}},
   getAuthStatus:async()=>({authenticated:auth,email:'demo@example.test',plan:'Pro',source:'codex-cli',account_id:'demo',expires_in_seconds:3600}),
   fetchUsage:async()=>structuredClone(data.codex),getHistory:async()=>[],onSnapshotUpdate:()=>()=>{},
   getProviders:async()=>structuredClone(snapshots()),refreshProviders:async()=>structuredClone(snapshots()),
   getProviderConnections:async()=>settings.providers.map(p=>({id:p.id,region:p.region,configured:true})),
   onProvidersUpdate:cb=>{events.add(cb);return()=>events.delete(cb)},
   getStats:async selection=>structuredClone(data.reports[selection?.id||(view==='api'?'deepseek':view==='statistics'?'antigravity':'codex')]),
   onStatsUpdate:cb=>{statsEvents.add(cb);return()=>statsEvents.delete(cb)},
   saveProviderCredential:async()=>({ok:true,error:null}),importProviderCredential:async()=>({ok:true,error:null}),removeProviderCredential:async()=>({ok:true,error:null}),
   openProviderDashboard:async()=>({ok:true}),openStatsWindow:async()=>({ok:true}),importFromCodexCli:async()=>({ok:true,email:'demo@example.test'}),
   logout:async()=>{auth=false;return{ok:true}},quit:async()=>{},minimizeWindow:async()=>{}
  };`;
  const server = http.createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405);return res.end()}
    const url = new URL(req.url,'http://127.0.0.1:5181');
    if(url.pathname.startsWith('/showcase/')){
      const scene=url.pathname.split('/').pop();if(!scenes[scene]){res.writeHead(404);return res.end()}
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(showcase(scene));
    }
    if(url.pathname==='/screenshot-mock.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(mock)}
    const file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(dist+path.sep)){res.writeHead(403);return res.end()}
    try{
      let content=fs.readFileSync(file);
      if(file.endsWith('.html')){content=content.toString().replace('</head>','<script src="/screenshot-mock.js"></script></head>');res.setHeader('Content-Type','text/html; charset=utf-8')}
      else if(file.endsWith('.js'))res.setHeader('Content-Type','text/javascript; charset=utf-8');else if(file.endsWith('.css'))res.setHeader('Content-Type','text/css; charset=utf-8');
      res.end(content);
    }catch{res.writeHead(404);res.end()}
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5181, '127.0.0.1', resolve); });
  return server;
}

exports.startPreview = startPreview;
exports.scenes = scenes;
if (require.main === module) startPreview().then(() => console.log('Screenshot preview: http://127.0.0.1:5181/showcase/dashboard')).catch(error => { console.error(error); process.exitCode = 1; });

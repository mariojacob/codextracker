// Screenshot-only fixture server. Not included in the packaged application.
// Serves the actual compiled renderer with an in-memory IPC mock, never real accounts.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createFixtures } = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist-renderer');
const version = require(path.join(root, 'package.json')).version;
const { statisticsReport } = require(path.join(root, 'dist-main/main/providers/statistics-report.js'));
const { PROVIDERS } = require(path.join(root, 'dist-main/shared/providers.js'));

const fixtures = createFixtures(PROVIDERS);
const store = { list: async () => Object.keys(fixtures.history).map(id => ({ id, region: 'global' })), read: async config => fixtures.history[config.id] || [] };
const scenes = {
  dashboard: {
    eyebrow: 'YOUR AI USAGE, AT A GLANCE', title: 'Know your limits.<br>Keep your flow.',
    description: 'Subscription quotas, reset-aware daily budgets and API balances in one compact Windows app.',
    cards: [['Your pace, made visible', 'Seven budget days. One time marker. See what remains in your daily allowance.'], ['Use resets before they expire', 'Clear countdowns highlight banked resets within 72 and 24 hours.'], ['Keep accounts in their lane', 'Subscription limits and API balances stay in separate sections.']],
    panes: [['Codex · budgets & banked resets', '/index.html?view=codex', 400, 720], ['More providers · separate API balances', '/index.html?view=providers', 400, 720]],
  },
  statistics: {
    eyebrow: 'OBSERVED USAGE, NOT GUESSWORK', title: 'A history for<br>every module.',
    description: 'Select the provider and quota you want to understand. Compare days without mixing unrelated limits.',
    cards: [['Independent quota pools', 'Gemini and Claude/GPT remain separate, even within Antigravity.'], ['7 or 30 days', 'Compare the current and previous budget day with longer periods.'], ['Honest about missing data', 'Hatched areas identify gaps. Missing readings never become zero consumption.']],
    panes: [['Antigravity · observed quota consumption', '/stats.html?view=statistics', 760, 650]],
  },
  api: {
    eyebrow: 'API BALANCES & REPORTED SPEND', title: 'Follow the balance.<br>Keep the context.',
    description: 'Track reported balances and their changes. Keep currencies and vendor-reported costs separate.',
    cards: [['Balance history', 'See the last reported value per calendar day, plus observed decreases and increases.'], ['No invented costs', 'Top-ups and adjustments are balance changes. Rolling cost reports are never added together.'], ['Choose your provider', 'DeepSeek, Moonshot, xAI and Anthropic use their own dedicated API modules.']],
    panes: [['DeepSeek API · USD balance history', '/stats.html?view=api', 760, 720]],
  },
  settings: {
    eyebrow: 'YOUR STACK, YOUR CHOICE', title: 'Choose what<br>you monitor.',
    description: 'Enable only the services you use. ChatGPT / Codex is a module too.',
    cards: [['Subscriptions & Coding Plans', 'Codex · Antigravity · Claude · Cursor · Grok · MiniMax · z.ai · Kimi'], ['API balances & spend', 'DeepSeek · Moonshot · xAI · Anthropic'], ['Local credentials', 'Saved credentials belong in Windows Credential Manager. Regions have separate entries.']],
    panes: [['Settings · providers & modules', '/index.html?view=settings', 430, 1000]],
  },
};

function showcase(scene) {
  const config = scenes[scene];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CodexTracker ${version} — ${scene}</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#0b1118;color:#eaf2f4;font:15px 'Segoe UI',system-ui,sans-serif}
  .stage{width:1200px;margin:0 auto;padding:34px 38px 28px;background:radial-gradient(ellipse at 80% 0%,#18332e88,transparent 50%),linear-gradient(145deg,#111a24,#0b1118 65%)}
  .brand{display:flex;align-items:center;justify-content:space-between;color:#91a8ad;font-size:12px;letter-spacing:.06em}.brand strong{font-size:17px;color:#eaf2f4;letter-spacing:-.02em}.mark{display:inline-block;width:13px;height:13px;border:3px solid #48d6ae;border-radius:4px;margin-right:8px;vertical-align:-1px}.badge{border:1px solid #30433f;border-radius:20px;padding:6px 12px;color:#8de2c9}
  .intro{display:flex;gap:34px;align-items:flex-end;margin:32px 0 28px}.intro>div{flex:1}.eyebrow{font-size:10px;letter-spacing:.18em;color:#6edbbd;font-weight:650;margin-bottom:12px}h1{font-size:44px;letter-spacing:-.045em;line-height:1.05;font-weight:650;margin:0}.description{width:390px;margin:0 0 3px;color:#a0b3bb;line-height:1.65;font-size:14px}
  .views{display:flex;gap:22px;align-items:flex-start}.pane{flex-shrink:0;border:1px solid #34454f;border-radius:10px;overflow:hidden;background:#101010;box-shadow:0 18px 42px #0005}.chrome{display:flex;align-items:center;gap:8px;height:31px;padding:0 11px;color:#a9bcc3;font-size:10px;background:#17202a;border-bottom:1px solid #29353c}.lights{display:flex;gap:4px}.lights i{width:5px;height:5px;border-radius:50%;background:#547077}.chrome span:last-child{margin-left:4px}iframe{display:block;border:0;background:#101010}
  .notes{min-width:0;flex:1;display:flex;flex-direction:column;gap:28px;padding:16px 0 0 7px}.note-num{color:#4dd4af;font:11px ui-monospace,monospace;margin-bottom:9px}.notes h2{font-size:16px;line-height:1.25;letter-spacing:-.02em;margin:0 0 9px;font-weight:600}.notes p{color:#8fa7b2;font-size:12px;line-height:1.7;margin:0}.footer{display:flex;justify-content:space-between;color:#667e89;font-size:10px;margin-top:25px;border-top:1px solid #22303a;padding-top:15px}.footer b{font-weight:500;color:#91aaa9}
  .single .views{gap:32px}.single .notes{padding:20px 0 0 8px;gap:38px}.single .notes h2{font-size:19px}.single .notes p{font-size:14px}.settings .views{flex-direction:row-reverse;justify-content:space-between;gap:70px}.settings .notes{padding-top:45px;max-width:470px;gap:55px}.settings .notes h2{font-size:23px}.settings .notes p{font-size:17px;line-height:1.8}
  </style></head><body><main class="stage ${config.panes.length===1?'single':''} ${scene}">
  <div class="brand"><strong><i class="mark"></i>CodexTracker</strong><span class="badge">${version} · Windows x64 · Portable</span></div>
  <div class="intro"><div><div class="eyebrow">${config.eyebrow}</div><h1>${config.title}</h1></div><p class="description">${config.description}</p></div>
  <div class="views">${config.panes.map(([label,url,width,height])=>`<div class="pane"><div class="chrome"><span class="lights"><i></i><i></i><i></i></span><span>${label}</span></div><iframe title="${label}" width="${width}" height="${height}" src="${url}"></iframe></div>`).join('')}
  <aside class="notes">${config.cards.map(([title,description],index)=>`<section><div class="note-num">0${index+1}</div><h2>${title}</h2><p>${description}</p></section>`).join('')}</aside></div>
  <div class="footer"><b>Example views · all account and usage values are simulated</b><span>Local history. Optional modules. English & German.</span></div>
  </main></body></html>`;
}

async function main() {
  const entries = await Promise.all(['codex',...PROVIDERS.map(p=>p.id)].map(async id => [id, await statisticsReport({id,region:'global'},fixtures.settings,fixtures.codex,fixtures.codexHistory,store,fixtures.now)]));
  const reports = Object.fromEntries(entries);
  const mock = `
  const data=${JSON.stringify({ settings: fixtures.settings, codex: fixtures.codex, snapshots: fixtures.snapshots, reports })};
  const view=new URLSearchParams(location.search).get('view');
  let settings=structuredClone(data.settings), auth=true;
  if(view==='settings'){settings.codex_enabled=false;settings.providers=[];}
  else if(view==='codex'){settings.providers=[];}
  else if(view==='providers'){settings.codex_enabled=false;settings.providers=settings.providers.filter(p=>['antigravity','deepseek','moonshot'].includes(p.id));}
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
  server.listen(5181,'127.0.0.1',()=>console.log('Screenshot preview: http://127.0.0.1:5181/showcase/dashboard'));
}
main().catch(error=>{console.error(error);process.exitCode=1});

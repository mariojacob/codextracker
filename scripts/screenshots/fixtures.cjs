const day=86400000, minute=60000, week=7*day;
exports.createFixtures = (providers) => {
  const now=Date.now(), reset=now+3.2*day, start=now-30*day;
  const settings={codex_enabled:true,refresh_seconds:60,history_days:30,language:'en',notifications:{enabled:false,rules:[]},
    providers:providers.map(p=>({id:p.id,enabled:true,region:p.id==='kimi'?'china':'global',team_id:''}))};
  const history={antigravity:[],deepseek:[],anthropic:[]}, codexHistory=[];
  const weights=[9,13,11,10,16,8,9];
  function quota(at,factor=1){
    const resetAt=reset-Math.floor((reset-at)/week)*week;
    const elapsed=(at-(resetAt-week))/day, index=Math.min(6,Math.floor(elapsed));
    const used=(weights.slice(0,index).reduce((a,b)=>a+b,0)+(elapsed-index)*weights[index])*factor;
    return {used_percent:Math.round(used*10000)/10000,reset_at:resetAt,window_seconds:604800};
  }
  const amount=(kind,value,currency='USD',period=null)=>({kind,value,currency,period});
  const entry=(id,at,windows,amounts)=>({version:1,id,region:'global',timestamp:new Date(at).toISOString(),context:'screenshot-example',scope:'',segment:'screenshot-example',refresh_seconds:150,windows,amounts});
  for(let at=start;at<=now;at+=5*minute){
    const age=(now-at)/day;
    // One deliberately visible missing interval, shared across these example histories.
    if(age>2.35&&age<2.39)continue;
    const windows=[{id:'gemini',label:'Gemini · weekly',...quota(at)},{id:'claude-gpt',label:'Claude / GPT · weekly',...quota(at,.62)}];
    history.antigravity.push(entry('antigravity',at,windows,[]));
    // Simulate a daily posted charge and a separate top-up, with cent-valued readings.
    const balance=72.84+Math.floor(age)*3.2-(age>12.5?40:0);
    history.deepseek.push(entry('deepseek',at,[],[amount('balance',Math.round(balance*100)/100)]));
    history.anthropic.push(entry('anthropic',at,[],[amount('spend',Math.round((86.42-age*1.8)*10000)/10000,'USD','last_30_days')]));
    codexHistory.push({version:2,timestamp:new Date(at).toISOString(),session_pct_left:null,weekly_pct_left:100-windows[0].used_percent,weekly_reset_at:windows[0].reset_at,weekly_window_seconds:604800,credits_balance:14.75+age*.4,reset_credits_available:3,refresh_seconds:150});
  }
  const codex={fetched_at:new Date(now).toISOString(),error:null,plan:'Pro',email:'demo@example.test',session_pct_left:null,weekly_pct_left:54,credits_balance:14.75,
    session_window_available:false,session_reset_at:null,weekly_reset_at:reset,weekly_window_seconds:604800,session_reset_in:'—',weekly_reset_in:'3d 4h',reset_credits_available:3,
    reset_credit_details:[{id:'example-reset-1',status:'available',title:'Banked reset',expires_at:new Date(now+18*3600000).toISOString()},
      {id:'example-reset-2',status:'available',title:'Banked reset',expires_at:new Date(now+54*3600000).toISOString()},
      {id:'example-reset-3',status:'available',title:'Banked reset',expires_at:new Date(now+10*day).toISOString()}]};
  const snap=(id,windows=[],amounts=[],plan=null)=>({id,region:'global',state:'ready',fetched_at:new Date(now).toISOString(),error:null,source:id==='antigravity'?'local':'api',plan,windows,amounts,warnings:[]});
  const snapshots=[snap('antigravity',[{id:'gemini',label:'Gemini · weekly',...quota(now)},{id:'claude-gpt',label:'Claude / GPT · weekly',...quota(now,.62)}],[],'Google AI Pro'),
    snap('claude',[{id:'session',label:'5h',used_percent:18,reset_at:now+2.5*3600000,window_seconds:18000},{id:'week',label:'weekly',used_percent:39,reset_at:reset,window_seconds:604800}],[],'Max'),
    snap('cursor',[],[amount('included_spend',8.4,'USD','current_cycle'),amount('on_demand_spend',1.25,'USD','current_cycle')],'Pro'),
    snap('deepseek',[],[amount('balance',72.84)]),snap('moonshot',[],[amount('balance',18.9)]),snap('anthropic',[],[amount('spend',86.42,'USD','last_30_days')])];
  return {now,settings,history,codexHistory,codex,snapshots};
};

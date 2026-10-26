// Render the real application with isolated dummy data, then capture compact README images.
const fs = require('node:fs/promises');
const path = require('node:path');
const version = require('../../package.json').version;

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const { startPreview, scenes } = require('./preview.cjs');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

async function waitFor(window, expression) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function checkModes(window) {
  const frame = "document.querySelector('iframe').contentWindow";
  const choose = mode => window.webContents.executeJavaScript(`{ const frame=${frame}; const select=frame.document.querySelector('.manual-reset-toolbar select'); select.value=${JSON.stringify(mode)}; select.dispatchEvent(new frame.Event('change',{bubbles:true})); }`);
  const selected = mode => waitFor(window, `${frame}.document.querySelector('.manual-reset-toolbar select')?.value===${JSON.stringify(mode)}`);
  await selected('banked');
  await choose('auto');
  await selected('auto');
  await choose('manual');
  await waitFor(window, `!!${frame}.document.querySelector('.manual-reset-editor')`);
  await window.webContents.executeJavaScript(`{ const frame=${frame}; const input=frame.document.querySelector('input[name="reset_at"]'); const at=new Date(Date.now()+2*86400000); const pad=n=>String(n).padStart(2,'0'); input.value=at.getFullYear()+'-'+pad(at.getMonth()+1)+'-'+pad(at.getDate())+'T'+pad(at.getHours())+':'+pad(at.getMinutes()); input.form.requestSubmit(); }`);
  await selected('manual');
  await choose('banked');
  await selected('banked');
  if (!await window.webContents.executeJavaScript(`(async()=>{const settings=await ${frame}.codexAPI.getSettings();return settings.codex_banked_reset_budget && !!settings.manual_resets.codex;})()`)) throw new Error('Banked mode lost the saved manual deadline');
  await window.webContents.executeJavaScript(`${frame}.document.querySelector('.manual-reset-toolbar button').click()`);
  await waitFor(window, `!!${frame}.document.querySelector('.manual-reset-editor')`);
  await window.webContents.executeJavaScript(`Array.from(${frame}.document.querySelectorAll('.manual-reset-editor button')).find(button=>button.textContent==='Remove reset').click()`);
  await waitFor(window, `!${frame}.document.querySelector('.manual-reset-editor')`);
  await selected('banked');
  if (await window.webContents.executeJavaScript(`!!document.querySelectorAll('iframe')[1].contentDocument.querySelector('option[value="banked"]')`)) throw new Error('Banked mode leaked to another provider');
  console.log('Verified Automatic → Manual reset → Next banked reset, saved deadline preservation and removal.');
}

app.whenReady().then(async () => {
  const server = await startPreview();
  const window = new BrowserWindow({ show: false, width: 1200, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    for (const scene of Object.keys(scenes)) {
      await window.loadURL(`http://127.0.0.1:5181/showcase/${scene}`);
      await waitFor(window, `Array.from(document.querySelectorAll('iframe')).every(frame=>{const doc=frame.contentDocument;return doc?.querySelector('.provider-card, .providers-empty, .stat-card') && !doc.querySelector('.stats-loading');})`);
      if (scene === 'dashboard') await checkModes(window);
      if (scene === 'settings') {
        await window.webContents.executeJavaScript(`document.querySelector('iframe').contentDocument.querySelector('button[title="Settings"]').click()`);
        await waitFor(window, `!!document.querySelector('iframe').contentDocument.querySelector('.modal')`);
      }
      const size = await window.webContents.executeJavaScript(`({width:document.querySelector('.stage').offsetWidth,height:document.querySelector('.stage').offsetHeight})`);
      window.setContentSize(size.width, size.height);
      await window.webContents.executeJavaScript(`Promise.all(Array.from(document.querySelectorAll('iframe')).map(frame=>frame.contentDocument.fonts.ready)).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
      // Focus the settings image on module selection, without unrelated controls below it.
      const crop = scene === 'settings' ? await window.webContents.executeJavaScript(`(()=>{const frame=document.querySelector('iframe');const origin=frame.getBoundingClientRect();const modal=frame.contentDocument.querySelector('.modal');const box=modal.getBoundingClientRect();const panel=modal.querySelector('.provider-settings').getBoundingClientRect();return {x:Math.floor(origin.x+box.x),y:Math.floor(origin.y+box.y),width:modal.clientWidth,height:Math.ceil(panel.bottom-box.top+12)};})()`) : undefined;
      const screenshot = await window.webContents.capturePage(crop);
      const filename = path.resolve(__dirname, '../../docs/images', `v${version}-${scene === 'api' ? 'api-history' : scene}.png`);
      await fs.writeFile(filename, screenshot.toPNG());
      console.log(`${path.basename(filename)}: ${screenshot.getSize().width} × ${screenshot.getSize().height}`);
    }
  } finally {
    window.destroy();
    server.close();
  }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });

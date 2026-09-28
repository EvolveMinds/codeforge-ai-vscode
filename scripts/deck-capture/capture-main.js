// Boots the real Evolve AI desktop app, then runs a list of scripted "shots":
// each shot runs JS in the renderer, waits, and saves capturePage() at 2x.
// Usage (unset ELECTRON_RUN_AS_NODE first):
//   npx electron scripts/deck-capture/capture-main.js <demoWorkspaceDir> scripts/deck-capture/shots.js <outDir>
// The workspace dir must come first: main.js opens the first existing directory in argv.
// Note: the app records the workspace in ~/.evolve/desktop-recent.json.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('force-device-scale-factor', '2');

const repo = path.resolve(__dirname, '..', '..');
const shotsFile = path.resolve(process.argv[process.argv.length - 2]);
const outDir = path.resolve(process.argv[process.argv.length - 1]);
fs.mkdirSync(outDir, { recursive: true });
const shots = require(shotsFile);

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  if (global.__capWin) return;
  global.__capWin = win;
  win.webContents.once('did-finish-load', async () => {
    try {
      win.setContentSize(1600, 1000);
      await sleep(4000);
      for (const s of shots) {
        const r = await win.webContents.executeJavaScript(`(async()=>{try{${s.js}\nreturn 'ok'}catch(e){return 'ERR '+e.message}})()`);
        await sleep(s.wait || 2500);
        if (s.after) await win.webContents.executeJavaScript(`(async()=>{try{${s.after}}catch(e){}})()`);
        if (s.after) await sleep(s.afterWait || 1500);
        if (s.probe) console.log('PROBE', s.name, await win.webContents.executeJavaScript(s.probe));
        if (s.noShot) { console.log('STEP', s.name, r); continue; }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, s.name + '.png'), img.toPNG());
        console.log('SHOT', s.name, r, img.getSize());
      }
    } catch (e) { console.error('CAPTURE FAILED', e); }
    app.exit(0);
  });
});

require(path.join(repo, 'out/desktop/main/main.js'));

// Runs in the development Electron runtime against the packaged Windows files.
// It creates no windows and does not load account data or make network requests.
const { app, nativeImage } = require('electron');
const path = require('node:path');
const { version } = require('../package.json');

app.whenReady().then(async () => {
  const unpacked = path.resolve(__dirname, '../release/win-unpacked');
  for (const filename of ['icon.ico', 'icon.png']) {
    const image = nativeImage.createFromPath(path.join(unpacked, 'resources/assets', filename));
    if (image.isEmpty()) throw new Error(`Packaged icon could not be decoded: ${filename}`);
  }
  for (const executable of [path.join(unpacked, 'CodexTracker.exe'), path.resolve(__dirname, `../release/CodexTracker-${version}.exe`)]) {
    const shellIcon = await app.getFileIcon(executable, { size: 'large' });
    if (shellIcon.isEmpty()) throw new Error(`Windows could not extract the application icon: ${executable}`);
    const bitmap = shellIcon.toBitmap();
    let green = 0;
    // Windows bitmap pixels use BGRA. Check the actual shell icon for our green ring.
    for (let offset = 0; offset < bitmap.length; offset += 4) {
      const [blue, g, red, alpha] = bitmap.subarray(offset, offset + 4);
      if (alpha > 100 && g > 90 && g > red * 1.4 && g > blue * 1.1) green++;
    }
    if (green < shellIcon.getSize().width * shellIcon.getSize().height * 0.1) {
      throw new Error(`The executable exposes a generic Windows shell icon instead of the CodexTracker icon: ${executable}`);
    }
  }
  console.log('Verified packaged PNG/ICO and Windows shell icons for both application and portable launcher.');
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });

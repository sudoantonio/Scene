const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, '../scene-041-qa-profile'));
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 880, title: 'Scene 0.57.41 — Verifica', titleBarStyle: 'hiddenInset', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'dist/index.html'));
});
app.on('window-all-closed', () => app.quit());

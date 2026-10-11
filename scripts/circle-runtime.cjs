const {app}=require('electron');
app.on('browser-window-created',(_,w)=>w.webContents.on('did-finish-load',()=>{w.webContents.setBackgroundThrottling(false);w.showInactive();}));
Object.defineProperty(app,'isPackaged',{value:true});
require(require('node:path').resolve(__dirname,'../dist-electron/main.cjs'));

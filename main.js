'use strict';
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, safeStorage, nativeImage } = require('electron');
const path = require('path');
const { createStore } = require('./src/store');
const { createService } = require('./src/service');
const { NetlifyClient, normalizeHost } = require('./src/netlify');

const APP_ID = 'com.harrwama.mind.admin';
const POLL_MS = 30000;
app.setAppUserModelId(APP_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win = null;
let tray = null;
let quitting = false;
let hintShown = false;
let lastCounts = { orders: 0, messages: 0 };

const startHidden = process.argv.includes('--hidden');
const iconPath = path.join(__dirname, 'build', 'icon.png');

const crypt = {
  get available() { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } },
  encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64'))
};

let store, service;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function showWindow(page) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (page) send('navigate', page);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1040, minHeight: 640,
    show: false, backgroundColor: '#F3F5F9', title: 'Harrwama Mind Admin',
    icon: iconPath, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  // Liens externes : uniquement dans le navigateur, jamais dans l'appli
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openExternal(url); } });

  win.on('close', (e) => {
    if (!quitting && store.getConfig().runInBackground) {
      e.preventDefault();
      win.hide();
      if (!hintShown && Notification.isSupported()) {
        hintShown = true;
        new Notification({ title: 'Harrwama Mind Admin', body: "L'application reste active en arrière-plan pour vous alerter des nouvelles commandes et messages. Clic droit sur l'icône près de l'horloge pour quitter." }).show();
      }
    }
  });
  win.on('closed', () => { win = null; });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    const host = normalizeHost(store.getConfig().siteUrl);
    const ok = u.protocol === 'https:' && (u.hostname === 'wa.me' || u.hostname === 'api.whatsapp.com' || (host && u.hostname === host));
    if (ok) shell.openExternal(u.toString());
  } catch (e) { /* adresse invalide : ignorée */ }
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Harrwama Mind Admin');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Harrwama Mind Admin', click: () => showWindow() },
    { label: 'Commandes', click: () => showWindow('orders') },
    { label: 'Messagerie', click: () => showWindow('messages') },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => showWindow());
}

function updateTray(r) {
  if (!tray || !r) return;
  const o = (r.orders || []).filter((x) => x.status === 0).length;
  const m = (r.messages || []).filter((x) => !x.read).length;
  lastCounts = { orders: o, messages: m };
  const parts = [];
  if (o) parts.push(o + (o > 1 ? ' nouvelles commandes' : ' nouvelle commande'));
  if (m) parts.push(m + (m > 1 ? ' messages non lus' : ' message non lu'));
  tray.setToolTip('Harrwama Mind Admin' + (parts.length ? ' — ' + parts.join(' · ') : ''));
}

function notify(title, body, page) {
  if (!store.getConfig().notifications || !Notification.isSupported()) return;
  if (win && win.isVisible() && win.isFocused()) return; // l'appli est ouverte : l'alerte s'affiche dedans
  const n = new Notification({ title, body, icon: iconPath });
  n.on('click', () => showWindow(page));
  n.show();
}

function notifyFresh(r) {
  const fo = r.freshOrders, fm = r.freshMessages;
  if (fo.length === 1) notify('Nouvelle commande à livrer', `${fo[0].prenom} — ${fo[0].quantite} × ${fo[0].produit}`, 'orders');
  else if (fo.length > 1) notify(`${fo.length} nouvelles commandes à livrer`, fo.map((o) => o.prenom).join(', '), 'orders');
  if (fm.length === 1) notify('Nouveau message de ' + fm[0].nom, fm[0].message, 'messages');
  else if (fm.length > 1) notify(`${fm.length} nouveaux messages`, fm.map((m) => m.nom).join(', '), 'messages');
}

let inflight = null;
function doRefresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await service.refreshInbox();
      notifyFresh(r);
      updateTray(r);
      return r;
    } finally { inflight = null; }
  })();
  return inflight;
}

async function poll() {
  const c = store.getConfig();
  if (!c.siteUrl || !c.token) return;
  try { send('inbox', await doRefresh()); } catch (e) { /* réseau coupé : prochaine tentative dans 30 s */ }
}

const handlers = {
  async refreshInbox() { return doRefresh(); },
  async getSettings() {
    const c = service.getConfig();
    return { ...c, autoStart: app.getLoginItemSettings().openAtLogin, version: app.getVersion() };
  },
  async saveSettings({ runInBackground, notifications, autoStart }) {
    store.setConfig({ runInBackground, notifications });
    app.setLoginItemSettings({ openAtLogin: !!autoStart, args: ['--hidden'] });
    return handlers.getSettings();
  },
  async openExternal({ url }) { openExternal(url); return true; },
  async saveConnection(args) {
    const r = await service.saveConnection(args);
    setTimeout(poll, 500);
    return r;
  }
};

function bindIpc() {
  const names = ['getConfig', 'loadSite', 'saveHome', 'savePhone', 'addProduct', 'editProduct', 'deleteProduct',
    'addService', 'editService', 'deleteService', 'setOrderStatus', 'markRead', 'deleteOrder', 'deleteMessage'];
  ipcMain.handle('call', async (_e, name, args) => {
    try {
      let fn = handlers[name];
      if (!fn && names.includes(name)) fn = service[name];
      if (!fn) throw new Error('Action inconnue : ' + name);
      return { ok: true, data: await fn(...(args || [])) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  if (!gotLock) return;
  store = createStore(app.getPath('userData'), crypt);
  service = createService({
    store,
    clientFactory: (token, siteUrl) => new NetlifyClient(token, siteUrl),
    onProgress: (s) => send('progress', s)
  });
  bindIpc();
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  setTimeout(poll, 4000);
  setInterval(poll, POLL_MS);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* reste actif dans la zone de notification */ });
app.on('activate', () => showWindow());

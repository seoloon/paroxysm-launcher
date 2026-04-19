'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const MicrosoftAuth    = require('./core/auth/microsoft');
const ModpackParser    = require('./core/modpack/parser');
const ModpackInstaller = require('./core/modpack/installer');
const ModpackLibrary   = require('./core/modpack/library');
const JavaManager      = require('./core/runtime/java');
const MinecraftManager = require('./core/runtime/minecraft');
const ForgeManager     = require('./core/runtime/forge');
const FabricManager    = require('./core/runtime/fabric');
const GameLauncher     = require('./core/runtime/launcher');
const Store            = require('./core/utils/store');

const store   = new Store();
const auth    = new MicrosoftAuth(store);
const library = new ModpackLibrary(store);
store.set('__dataPath__', Store.BASE_DIR);

let mainWindow = null;
const isDev = process.argv.includes('--dev');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 760, minWidth: 900, minHeight: 600,
    frame: false, resizable: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#020617',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

const send = (ch, data) => mainWindow?.webContents?.send(ch, data);

ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win:close',    () => mainWindow?.close());

ipcMain.handle('config:get', (_, key)        => store.get(key));
ipcMain.handle('config:set', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('shell:open',  (_, p) => shell.openPath(p));

// ── Auth ──────────────────────────────────────────────────────────────────────
ipcMain.handle('auth:status', async () => {
  try { return await auth.getProfile(); } catch { return null; }
});

ipcMain.handle('auth:login', async () => {
  try {
    // Lance le serveur local sur :3000, ouvre le navigateur, attend le callback
    send('auth:browser-opening', {});
    const code = await auth.startLogin();
    send('auth:exchanging', {});
    // Échange du code → tokens MS → XBL → XSTS → Minecraft
    const { accessToken, refreshToken } = await auth.exchangeCode(code);
    const profile = await auth._fullAuthChain(accessToken, refreshToken);
    return { ok: true, profile };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:logout', () => { auth.logout(); return true; });

// ── Library ───────────────────────────────────────────────────────────────────
ipcMain.handle('library:list',   ()      => library.list());
ipcMain.handle('library:get',    (_, id) => library.get(id));
ipcMain.handle('library:delete', (_, id) => library.delete(id));

// ── Import ────────────────────────────────────────────────────────────────────
ipcMain.handle('modpack:pick-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer un modpack',
    filters: [
      { name: 'Modpacks', extensions: ['zip', 'mrpack'] },
      { name: 'CurseForge (.zip)', extensions: ['zip'] },
      { name: 'Modrinth (.mrpack)', extensions: ['mrpack'] },
    ],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('modpack:import', async (_, filePath) => {
  try {
    // 1. Parse
    const parsed = await ModpackParser.parse(filePath, msg => send('install:log', msg));
    send('install:log', `✓ ${parsed.name} v${parsed.version} [${parsed.format.toUpperCase()}]`);
    send('install:log', `  MC ${parsed.mcVersion} — ${parsed.modloader} ${parsed.modloaderVersion} — ${parsed.files.length} fichiers`);

    // 2. Java
    send('install:progress', { step: 'java', pct: 0, detail: 'Vérification Java...' });
    const javaPath = await JavaManager.ensureJava(parsed.mcVersion, (pct, detail) => {
      send('install:progress', { step: 'java', pct, detail });
    });
    send('install:log', `✓ Java: ${javaPath}`);
    send('install:progress', { step: 'java', pct: 100, detail: 'Java prêt' });

    // 3. Vanilla Minecraft
    send('install:progress', { step: 'modloader', pct: 0, detail: `Minecraft ${parsed.mcVersion}...` });
    await MinecraftManager.ensureVanilla(parsed.mcVersion, (pct, detail) => {
      send('install:progress', { step: 'modloader', pct: Math.round(pct * 0.4), detail });
      if (detail && !detail.includes('%')) send('install:log', detail);
    });
    send('install:log', `✓ Minecraft ${parsed.mcVersion} client OK`);

    // 4. Modloader
    const loaderLabel = parsed.modloader.charAt(0).toUpperCase() + parsed.modloader.slice(1);
    send('install:progress', { step: 'modloader', pct: 40, detail: `Installation ${loaderLabel}...` });
    let versionId;
    const loaderProgress = (pct, detail) => {
      send('install:progress', { step: 'modloader', pct: 40 + Math.round(pct * 0.6), detail });
      // Always forward Forge/Fabric log lines to UI console (they are valuable for debugging)
      if (detail) send('install:log', detail);
    };
    if (parsed.modloader === 'fabric' || parsed.modloader === 'quilt') {
      versionId = await FabricManager.ensure(parsed.mcVersion, parsed.modloaderVersion, javaPath, loaderProgress);
    } else {
      versionId = await ForgeManager.ensure(parsed.mcVersion, parsed.modloaderVersion, javaPath, loaderProgress, parsed.modloader);
    }
    send('install:log', `✓ ${loaderLabel} installé → ${versionId}`);
    send('install:progress', { step: 'modloader', pct: 100, detail: `${loaderLabel} prêt` });

    // 5. Mods
    send('install:progress', { step: 'mods', pct: 0, detail: 'Téléchargement des mods...' });
    const settings  = store.get('settings') || {};
    const installer = new ModpackInstaller(parsed, settings.cfApiKey || null);
    let modsTotal   = Math.max(parsed.files.length, 1);
    const failed    = await installer.downloadMods((done, total, name) => {
      modsTotal = total || modsTotal;
      send('install:progress', { step: 'mods', pct: Math.round((done / modsTotal) * 100), detail: `[${done}/${modsTotal}] ${name}` });
      send('install:log', `  [${done}/${modsTotal}] ${name}`);
    });
    if (failed.length) send('install:log', `⚠ ${failed.length} mod(s) ont échoué`);
    send('install:progress', { step: 'mods', pct: 100, detail: `${modsTotal - failed.length}/${modsTotal} mods OK` });

    // 6. Overrides
    send('install:progress', { step: 'overrides', pct: 30, detail: 'Application des overrides...' });
    await installer.applyOverrides();
    send('install:log', '✓ Configs et overrides appliqués');
    send('install:progress', { step: 'overrides', pct: 100, detail: 'Overrides appliqués' });

    // 7. Save to library
    const entry = library.add(parsed, failed, versionId);
    send('install:progress', { step: 'done', pct: 100, detail: 'Installation terminée !' });
    send('install:done', entry);
    send('install:log', `✅ ${parsed.name} est prêt !`);
    return { ok: true, entry, failedMods: failed };

  } catch (e) {
    send('install:error', e.message);
    console.error('[import]', e);
    return { ok: false, error: e.message };
  }
});

// ── Launch ────────────────────────────────────────────────────────────────────
ipcMain.handle('game:launch', async (_, modpackId) => {
  try {
    const entry = library.get(modpackId);
    if (!entry) throw new Error('Modpack introuvable dans la bibliothèque');

    const settings     = store.get('settings') || {};
    const profile      = await auth.getProfile().catch(() => null);
    const forceOffline = settings.forceOffline || false;
    const useOnline    = profile && !forceOffline;

    const javaPath = await JavaManager.ensureJava(entry.mcVersion, () => {});

    const child = await GameLauncher.launch({
      entry,
      javaPath,
      profile:     useOnline ? profile      : null,
      accessToken: useOnline ? auth.getStoredToken() : null,
      uuid:        useOnline ? auth.getStoredUUID()  : null,
      ram:         settings.ram || 4,
      offline:     !useOnline,
      offlineName: settings.username || 'Player',
    });

    library.updateLastPlayed(modpackId);
    send('game:launched', { pid: child.pid });
    child.stdout.on('data', d => send('game:log', d.toString()));
    child.stderr.on('data', d => send('game:log', d.toString()));
    child.on('close', code => send('game:closed', { code }));

    return { ok: true, pid: child.pid };
  } catch (e) {
    console.error('[launch]', e);
    return { ok: false, error: e.message };
  }
});

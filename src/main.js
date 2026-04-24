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
    width: 1200, height: 760,
    minWidth: 900, minHeight: 600,
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

// config:get handled below (with instance file scanning support)
ipcMain.handle('config:set', (_, key, value) => { store.set(key, value); return true; });
ipcMain.handle('app:version', () => app.getVersion());

// ── System info ───────────────────────────────────────────────────────────────
ipcMain.handle('system:ram', () => {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024);
  const totalGB = totalMB / 1024;
  return { totalMB, totalGB: Math.round(totalGB * 10) / 10 };
});

// ── Instance file listing (for play panel "Contenu" tab) ──────────────────────
ipcMain.handle('config:get', (_, key) => {
  // Special key: scan instance files with name resolution from manifest
  if (key && key.startsWith('__instanceFiles__:')) {
    const packId = key.slice('__instanceFiles__:'.length);
    const entry  = library.get(packId);
    if (!entry?.gameDir) return [];
    try {
      const fs   = require('fs');
      const path = require('path');

      // Load the manifest (filename → { displayName, projectID, fileID })
      const manifestPath = path.join(entry.gameDir, 'mods-manifest.json');
      let manifest = {};
      try {
        if (fs.existsSync(manifestPath))
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {}

      const results = [];
      const scanDirs = [
        { dir: 'mods',          type: 'mod' },
        { dir: 'shaderpacks',   type: 'shader' },
        { dir: 'resourcepacks', type: 'resourcepack' },
        { dir: 'config',        type: 'config' },
      ];
      for (const { dir, type } of scanDirs) {
        const full = path.join(entry.gameDir, dir);
        if (!fs.existsSync(full)) continue;
        const items = fs.readdirSync(full, { withFileTypes: true });
        for (const item of items) {
          if (!item.isFile()) continue;
          const filePath = path.join(full, item.name);
          let size = 0;
          try { size = fs.statSync(filePath).size; } catch {}

          // Résoudre le nom d'affichage :
          // 1. Manifeste (nom du mod CurseForge)
          // 2. Nom du fichier tel quel (Modrinth / override files sont déjà lisibles)
          const manifestEntry = manifest[item.name];
          const displayName   = manifestEntry?.displayName || cleanFilename(item.name);

          results.push({
            name:        displayName,   // nom affiché
            filename:    item.name,     // nom réel du fichier
            type,
            size,
            dir,
            projectID:   manifestEntry?.projectID,
            fileID:      manifestEntry?.fileID,
          });
        }
      }
      return results.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      return [];
    }
  }
  // Normal config key
  return store.get(key);
});

// Nettoyer un nom de fichier en nom lisible
// Ex: "sodium-fabric-0.5.8+mc1.20.1.jar" → "sodium-fabric 0.5.8"
// Ex: "123456-789012.jar" → "123456-789012" (inchangé si non résolu)
function cleanFilename(filename) {
  return filename
    .replace(/\.jar$/i, '')
    .replace(/[-_]forge[-_]/gi, ' ')
    .replace(/[-_]fabric[-_]/gi, ' ')
    .replace(/[+]mc[\d.]+/g, '')   // retire +mc1.20.1
    .replace(/[-_]\d+\.\d+[\d._-]*/g, (m) => ' ' + m.replace(/^[-_]/, ''))
    .replace(/[-_]+/g, ' ')
    .trim();
}
ipcMain.handle('shell:open',  (_, p) => shell.openPath(p));

// ── Resolve CurseForge mod names for existing instances ──────────────────────
// Called from the "Contenu" tab when files still have numeric names
ipcMain.handle('modpack:resolve-names', async (_, packId) => {
  const entry = library.get(packId);
  if (!entry?.gameDir) return { ok: false };
  try {
    const fs   = require('fs');
    const path = require('path');

    const modsDir     = path.join(entry.gameDir, 'mods');
    const manifestPath = path.join(entry.gameDir, 'mods-manifest.json');
    let manifest = {};
    try {
      if (fs.existsSync(manifestPath))
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {}

    if (!fs.existsSync(modsDir)) return { ok: true, resolved: 0 };

    // Find files matching the pattern projectID-fileID.jar (numeric IDs)
    const numericPattern = /^(\d+)-(\d+)\.jar$/;
    const files = fs.readdirSync(modsDir).filter(f => numericPattern.test(f) && !manifest[f]?.displayName);

    let resolved = 0;
    const fetch = require('node-fetch');
    const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

    // Batch resolve: 5 at a time to avoid rate limiting
    for (let i = 0; i < files.length; i += 5) {
      const chunk = files.slice(i, i + 5);
      await Promise.allSettled(chunk.map(async (filename) => {
        const m = filename.match(numericPattern);
        if (!m) return;
        const [, projectID, fileID] = m;
        try {
          const res = await fetch(`https://www.curseforge.com/api/v1/mods/${projectID}`, {
            headers: HEADERS, timeout: 8000
          });
          if (!res.ok) return;
          const data = await res.json();
          const name = data?.data?.name || data?.name;
          if (name) {
            manifest[filename] = { displayName: name, projectID: +projectID, fileID: +fileID };
            resolved++;
          }
        } catch {}
      }));
      await new Promise(r => setTimeout(r, 150));
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { ok: true, resolved };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Modrinth Browse API ───────────────────────────────────────────────────────
const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_HEADERS = {
  'User-Agent': 'PaROXYSM-Launcher/1.0 (contact@paroxysm.dev)',
  'Accept': 'application/json',
};

async function modrinthFetch(url) {
  const https = require('follow-redirects').https;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: MODRINTH_HEADERS, maxRedirects: 5, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Modrinth')); }
      });
    }).on('error', reject);
  });
}

ipcMain.handle('modrinth:search', async (_, { query='', type='modpack', offset=0, limit=20, gameVersion='', loader='', sort='relevance', categories=[] }) => {
  try {
    const facets = [['project_type:'+type]];
    if (gameVersion) facets.push(['versions:'+gameVersion]);
    if (loader) facets.push(['categories:'+loader]);
    if (categories.length) facets.push(categories.map(c => 'categories:'+c));
    const params = new URLSearchParams({
      query, offset, limit,
      facets: JSON.stringify(facets),
      index: sort || 'relevance',
    });
    return await modrinthFetch(`${MODRINTH_API}/search?${params}`);
  } catch(e) { return { error: e.message, hits: [] }; }
});

ipcMain.handle('modrinth:get-project', async (_, id) => {
  try { return await modrinthFetch(`${MODRINTH_API}/project/${id}`); }
  catch(e) { return { error: e.message }; }
});

ipcMain.handle('modrinth:get-versions', async (_, id) => {
  try { return await modrinthFetch(`${MODRINTH_API}/project/${id}/version`); }
  catch(e) { return { error: e.message }; }
});

ipcMain.handle('modrinth:get-game-versions', async () => {
  try {
    const data = await modrinthFetch(`${MODRINTH_API}/tag/game_version`);
    // Keep only release versions, sorted newest first
    return (data || []).filter(v => v.version_type === 'release').map(v => v.version);
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('modrinth:download', async (_, { projectId, versionId, fileName, destDir }) => {
  try {
    const versions = await modrinthFetch(`${MODRINTH_API}/version/${versionId}`);
    const file = versions.files?.find(f => f.primary) || versions.files?.[0];
    if (!file) throw new Error('Aucun fichier trouvé pour cette version');
    const { downloadFile } = require('./core/utils/download');
    const path = require('path');
    const fs   = require('fs');
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, file.filename);
    await downloadFile(file.url, dest, () => {});
    return { ok: true, path: dest, filename: file.filename };
  } catch(e) { return { ok: false, error: e.message }; }
});

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
ipcMain.handle('library:update', (_, id, fields) => library.update(id, fields));

// ── Per-instance logs ─────────────────────────────────────────────────────────
ipcMain.handle('modpack:get-logs', (_, packId) => {
  const entry = library.get(packId);
  if (!entry?.gameDir) return [];
  try {
    const fs   = require('fs');
    const path = require('path');
    const results = [];
    const logDir    = path.join(entry.gameDir, 'logs');
    const crashDir  = path.join(entry.gameDir, 'crash-reports');
    if (fs.existsSync(logDir)) {
      for (const f of ['latest.log', 'fml-client-latest.log', 'debug.log']) {
        const fp = path.join(logDir, f);
        if (fs.existsSync(fp)) {
          const st = fs.statSync(fp);
          results.push({ name: f, path: fp, type: f.includes('fml') ? 'fml' : 'latest', size: st.size, mtime: st.mtimeMs });
        }
      }
    }
    if (fs.existsSync(crashDir)) {
      const files = fs.readdirSync(crashDir).filter(f => f.endsWith('.txt')).sort().reverse().slice(0, 5);
      for (const f of files) {
        const fp = path.join(crashDir, f);
        const st = fs.statSync(fp);
        results.push({ name: f, path: fp, type: 'crash', size: st.size, mtime: st.mtimeMs });
      }
    }
    return results.sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
});

ipcMain.handle('modpack:read-log', (_, logPath) => {
  try {
    const fs = require('fs');
    if (!fs.existsSync(logPath)) return null;
    const size = fs.statSync(logPath).size;
    const maxBytes = 500 * 1024;
    const buf = Buffer.alloc(Math.min(size, maxBytes));
    const fd  = fs.openSync(logPath, 'r');
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return null; }
});

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

    // Use per-instance RAM if set, otherwise fall back to global setting
    const instanceRam = entry.ram || 0;
    const globalRam   = settings.ram || 4;
    const ramToUse    = instanceRam > 0 ? instanceRam : globalRam;

    const child = await GameLauncher.launch({
      entry,
      javaPath,
      profile:     useOnline ? profile      : null,
      accessToken: useOnline ? auth.getStoredToken() : null,
      uuid:        useOnline ? auth.getStoredUUID()  : null,
      ram:         ramToUse,
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

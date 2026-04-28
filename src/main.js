'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MicrosoftAuth    = require('./core/auth/microsoft');
const ModpackParser    = require('./core/modpack/parser');
const ModpackInstaller = require('./core/modpack/installer');
const ModpackLibrary   = require('./core/modpack/library');
const JavaManager      = require('./core/runtime/java');
const MinecraftManager = require('./core/runtime/minecraft');
const ForgeManager     = require('./core/runtime/forge');
const NeoForgeManager  = require('./core/runtime/neoforge');
const FabricManager    = require('./core/runtime/fabric');
const GameLauncher     = require('./core/runtime/launcher');
const DiscordRpcService = require('./core/integrations/discordRpc');
const Store            = require('./core/utils/store');
let autoUpdater = null;
let autoUpdaterLoadError = null;

const store   = new Store();
const auth    = new MicrosoftAuth(store);
const library = new ModpackLibrary(store);
store.set('__dataPath__', Store.BASE_DIR);
const DISCORD_RPC_CLIENT_ID = '1498344540623470684';
const DISCORD_RPC_LAUNCHER_ASSET_KEY = 'logo_bckg';

// ── IPC security helpers ───────────────────────────────────────────────────────
/**
 * Returns true iff `child` is strictly inside `parent` (no '..' escape).
 */
function containsPath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hashFile(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sanitizeSettings(input, current = {}) {
  const src = (input && typeof input === 'object') ? input : {};
  const cur = (current && typeof current === 'object') ? current : {};
  const out = {};

  if (Number.isFinite(+cur.ram)) out.ram = Math.max(1, Math.min(32, Math.round(+cur.ram)));
  if (typeof cur.username === 'string') out.username = cur.username.trim().slice(0, 16);
  if (typeof cur.forceOffline === 'boolean') out.forceOffline = cur.forceOffline;
  if (typeof cur.cfApiKey === 'string') out.cfApiKey = cur.cfApiKey.trim().slice(0, 256);
  if (typeof cur.language === 'string' && ['fr', 'en'].includes(cur.language)) out.language = cur.language;
  if (typeof cur.updateChannel === 'string' && ['stable', 'beta'].includes(cur.updateChannel)) out.updateChannel = cur.updateChannel;

  if (Number.isFinite(+src.ram)) out.ram = Math.max(1, Math.min(32, Math.round(+src.ram)));
  if (typeof src.username === 'string') out.username = src.username.trim().slice(0, 16);
  if (typeof src.forceOffline === 'boolean') out.forceOffline = src.forceOffline;
  if (typeof src.cfApiKey === 'string') out.cfApiKey = src.cfApiKey.trim().slice(0, 256);
  if (typeof src.language === 'string' && ['fr', 'en'].includes(src.language)) out.language = src.language;
  if (typeof src.updateChannel === 'string' && ['stable', 'beta'].includes(src.updateChannel)) out.updateChannel = src.updateChannel;

  if (!out.updateChannel) out.updateChannel = 'stable';

  return out;
}

function sanitizeFilename(filename, fallback = 'download.bin') {
  const raw = String(filename || '').trim();
  const base = path.basename(raw || fallback);
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '');
  const safe = cleaned || fallback;
  const reserved = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ]);
  const stem = safe.split('.')[0].toUpperCase();
  return reserved.has(stem) ? `_${safe}` : safe;
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'console.curseforge.com';
  } catch {
    return false;
  }
}

/**
 * Build the allowlist for shell:open: BASE_DIR + every known gameDir.
 */
function getAllowedShellRoots() {
  const roots = [Store.BASE_DIR];
  try {
    for (const entry of library.list()) {
      if (entry.gameDir) roots.push(entry.gameDir);
    }
  } catch {}
  return roots.map(r => path.resolve(r));
}

/**
 * Load the cached Mojang version.json for a given MC version.
 * Used at launch time to get javaVersion.majorVersion without re-downloading.
 * Returns null if not yet cached (will fall back to table in JavaManager).
 */
function loadVanillaProfile(mcVersion) {
  try {
    const jsonPath = path.join(Store.BASE_DIR, 'minecraft', 'versions', mcVersion, `${mcVersion}.json`);
    if (fs.existsSync(jsonPath)) return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {}
  return null;
}

let mainWindow = null;
let discordPresence = null;
let runningGameChild = null;
let runningGamePackId = null;
const isDev = process.argv.includes('--dev');

function isGameRunning() {
  return !!(runningGameChild && Number.isInteger(runningGameChild.pid) && runningGameChild.pid > 0);
}

function clearRunningGameState() {
  runningGameChild = null;
  runningGamePackId = null;
}

function killRunningGameProcess() {
  if (!isGameRunning()) return Promise.resolve({ ok: false, error: 'Aucune instance en cours' });
  const pid = runningGameChild.pid;

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err, stdout, stderr) => {
        if (!err) return resolve({ ok: true, pid });
        const out = `${stdout || ''}\n${stderr || ''}\n${err.message || ''}`.toLowerCase();
        if (out.includes('not found') || out.includes('cannot find')) {
          return resolve({ ok: true, pid });
        }
        return resolve({ ok: false, error: `Impossible d'arreter le processus (${pid}): ${err.message || 'taskkill failed'}` });
      });
    });
  }

  try {
    process.kill(-pid, 'SIGKILL');
    return Promise.resolve({ ok: true, pid });
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      return Promise.resolve({ ok: true, pid });
    } catch (e) {
      return Promise.resolve({ ok: false, error: `Impossible d'arreter le processus (${pid}): ${e.message}` });
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 720,
    // width: 1920, height: 1080,
    minWidth: 900, minHeight: 600,
    frame: false, resizable: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
     // zoomFactor: 1.5
    },
    backgroundColor: '#020617',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', () => {
    emitUpdaterState();
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  discordPresence = new DiscordRpcService(
    () => sanitizeSettings(store.get('settings'), store.get('settings')),
    {
      clientId: DISCORD_RPC_CLIENT_ID,
      launcherAssetKey: DISCORD_RPC_LAUNCHER_ASSET_KEY,
    }
  );

  discordPresence.start();
  discordPresence.setPage('library');
});
app.on('window-all-closed', () => {
  try { discordPresence?.stop(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (!mainWindow) createWindow(); });
app.on('before-quit', () => {
  try { discordPresence?.stop(); } catch {}
});
app.on('will-quit', () => {
  try { discordPresence?.stop(); } catch {}
});
app.on('quit', () => {
  try { discordPresence?.stop(); } catch {}
});

const send = (ch, data) => mainWindow?.webContents?.send(ch, data);

let updaterReady = false;
let updaterEventsBound = false;
let updaterCheckPromise = null;
let updaterState = {
  available: false,
  enabled: false,
  channel: 'stable',
  status: 'idle',
  message: '',
  progress: 0,
  updateVersion: null,
  currentVersion: app.getVersion(),
};

function emitUpdaterState() {
  updaterState.currentVersion = app.getVersion();
  send('updates:status', updaterState);
}

function setUpdaterState(patch = {}) {
  updaterState = Object.assign({}, updaterState, patch, { currentVersion: app.getVersion() });
  emitUpdaterState();
  return updaterState;
}

function normalizeUpdateChannel(channel) {
  return channel === 'beta' ? 'beta' : 'stable';
}

function applyUpdateChannel(channel) {
  const normalized = normalizeUpdateChannel(channel);
  updaterState.channel = normalized;
  if (!autoUpdater) return normalized;
  autoUpdater.channel = normalized === 'beta' ? 'beta' : 'latest';
  autoUpdater.allowPrerelease = normalized === 'beta';
  autoUpdater.allowDowngrade = true;
  return normalized;
}

function bindAutoUpdaterEvents() {
  if (!autoUpdater || updaterEventsBound) return;
  updaterEventsBound = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdaterState({
      status: 'checking',
      message: 'Checking for updates...',
      progress: 0,
      updateVersion: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    const version = info?.version || null;
    setUpdaterState({
      status: 'downloading',
      message: version ? `Update ${version} found. Downloading...` : 'Update found. Downloading...',
      progress: 0,
      updateVersion: version,
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const pct = Math.max(0, Math.min(100, Math.round(progressObj?.percent || 0)));
    setUpdaterState({
      status: 'downloading',
      message: `Downloading update... ${pct}%`,
      progress: pct,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdaterState({
      status: 'up_to_date',
      message: 'You already have the latest version.',
      progress: 0,
      updateVersion: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version || updaterState.updateVersion || null;
    setUpdaterState({
      status: 'downloaded',
      message: version ? `Update ${version} is ready. Restart to install.` : 'Update ready. Restart to install.',
      progress: 100,
      updateVersion: version,
    });
  });

  autoUpdater.on('error', (err) => {
    setUpdaterState({
      status: 'error',
      message: `Update error: ${err?.message || String(err)}`,
    });
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    updaterReady = false;
    setUpdaterState({
      available: false,
      enabled: false,
      status: 'disabled',
      message: 'development mode.',
    });
    return;
  }

  if (!autoUpdater) {
    try {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdaterLoadError = null;
    } catch (e) {
      autoUpdaterLoadError = e;
    }
  }

  if (!autoUpdater) {
    updaterReady = false;
    const loadErr = autoUpdaterLoadError?.message ? ` (${autoUpdaterLoadError.message})` : '';
    setUpdaterState({
      available: false,
      enabled: false,
      status: 'disabled',
      message: `electron-updater missing.${loadErr}`,
    });
    return;
  }

  bindAutoUpdaterEvents();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = true;

  const settings = sanitizeSettings(store.get('settings'), store.get('settings'));
  applyUpdateChannel(settings.updateChannel);

  updaterReady = true;
  setUpdaterState({
    available: true,
    enabled: true,
    status: 'idle',
    message: `Auto-update ready (${updaterState.channel}).`,
    progress: 0,
  });

  setTimeout(() => {
    checkForUpdates('startup').catch(() => {});
  }, 3500);
}

async function checkForUpdates(reason = 'manual') {
  if (!updaterReady || !autoUpdater) {
    return { ok: false, error: updaterState.message || 'Auto-update unavailable' };
  }
  if (updaterCheckPromise) return updaterCheckPromise;

  updaterCheckPromise = (async () => {
    try {
      setUpdaterState({
        status: 'checking',
        message: reason === 'manual' ? 'Checking for updates...' : 'Checking updates in background...',
        progress: 0,
      });
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (e) {
      const errorMsg = e?.message || String(e);
      setUpdaterState({
        status: 'error',
        message: `Update check failed: ${errorMsg}`,
      });
      return { ok: false, error: errorMsg };
    } finally {
      updaterCheckPromise = null;
    }
  })();

  return updaterCheckPromise;
}

function installDownloadedUpdateNow() {
  if (!updaterReady || !autoUpdater) return { ok: false, error: 'Auto-update unavailable' };
  if (updaterState.status !== 'downloaded') {
    return { ok: false, error: 'No downloaded update available' };
  }
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
  return { ok: true };
}

ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win:close',    () => mainWindow?.close());

// config:get handled below (with instance file scanning support)
ipcMain.handle('config:set', (_, key, value) => {
  // SECURITY: renderer can only update "settings", with field-level sanitization.
  if (key !== 'settings') {
    console.warn('[config:set] Rejected key:', key);
    return false;
  }
  const current = sanitizeSettings(store.get('settings'), store.get('settings'));
  const safe = sanitizeSettings(value, current);
  store.set('settings', safe);
  discordPresence?.refreshSettings();
  if (updaterReady && current.updateChannel !== safe.updateChannel) {
    applyUpdateChannel(safe.updateChannel);
    setUpdaterState({
      status: 'idle',
      message: `Update channel switched to ${safe.updateChannel}.`,
      progress: 0,
    });
    checkForUpdates('channel-switch').catch(() => {});
  }
  return true;
});
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('updates:get-state', () => updaterState);
ipcMain.handle('updates:check', async () => checkForUpdates('manual'));
ipcMain.handle('updates:install-now', () => installDownloadedUpdateNow());
ipcMain.handle('rpc:set-page', (_, page) => {
  if (typeof page !== 'string') return false;
  discordPresence?.setPage(page);
  return true;
});

// ── System info ───────────────────────────────────────────────────────────────
ipcMain.handle('system:ram', () => {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024);
  const totalGB = totalMB / 1024;
  return { totalMB, totalGB: Math.round(totalGB * 10) / 10 };
});

function scanInstanceFiles(entry, { includeConfig = true } = {}) {
  if (!entry?.gameDir) return [];

  const manifestPath = path.join(entry.gameDir, 'mods-manifest.json');
  let manifest = {};
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  } catch {}

  const scanDirs = [
    { dir: 'mods', type: 'mod' },
    { dir: 'shaderpacks', type: 'shader' },
    { dir: 'resourcepacks', type: 'resourcepack' },
    ...(includeConfig ? [{ dir: 'config', type: 'config' }] : []),
  ];

  const results = [];
  for (const { dir, type } of scanDirs) {
    const full = path.join(entry.gameDir, dir);
    if (!fs.existsSync(full)) continue;
    let items = [];
    try { items = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }

    for (const item of items) {
      if (!item.isFile()) continue;
      const filePath = path.join(full, item.name);
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch {}
      const manifestEntry = manifest[item.name];
      const displayName = manifestEntry?.displayName || cleanFilename(item.name);

      results.push({
        name: displayName,
        filename: item.name,
        type,
        size,
        dir,
        projectID: manifestEntry?.projectID,
        fileID: manifestEntry?.fileID,
      });
    }
  }

  return results;
}

// ── Instance file listing (for play panel "Contenu" tab) ──────────────────────
ipcMain.handle('config:get', async (_, key) => {
  // Special key: scan instance files with name resolution from manifest
  if (key && key.startsWith('__instanceFiles__:')) {
    const packId = key.slice('__instanceFiles__:'.length);
    const entry  = library.get(packId);
    if (!entry?.gameDir) return [];
    try {
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
      return results.sort((a, b) => String(a.name || a.filename).localeCompare(String(b.name || b.filename)));
    } catch (e) {
      return [];
    }
  }
  // Normal config key
  return store.get(key);
});

ipcMain.handle('modrinth:get-installed-files', async (_, packId) => {
  const entry = library.get(String(packId || ''));
  if (!entry?.gameDir) return { ok: false, files: [] };
  try {
    const files = scanInstanceFiles(entry, { includeConfig: false })
      .filter(f => ['mod', 'shader', 'resourcepack'].includes(String(f.type || '')));
    await enrichWithModrinthMetadata(entry, files, { maxLookups: 12 });
    for (const f of files) {
      if (f.modrinthTitle && (!f.projectID || !f.name || f.name === cleanFilename(f.filename))) {
        f.name = f.modrinthTitle;
      }
    }
    return { ok: true, files };
  } catch (e) {
    return { ok: false, files: [], error: e.message };
  }
});

// Nettoyer un nom de fichier en nom lisible
// Ex: "sodium-fabric-0.5.8+mc1.20.1.jar" → "sodium-fabric 0.5.8"
// Ex: "123456-789012.jar" → "123456-789012" (inchangé si non résolu)
function cleanFilename(filename) {
  return filename
    .replace(/\.jar$/i, '')
    .replace(/[-_]forge[-_]/gi, ' ')
    .replace(/[-_]fabric[-_]/gi, ' ')
    .replace(/[-_]neoforge[-_]/gi, ' ')
    .replace(/[-_]quilt[-_]/gi, ' ')
    .replace(/[+]mc[\d.]+/g, '')   // retire +mc1.20.1
    .replace(/[-_]\d+\.\d+[\d._-]*/g, (m) => ' ' + m.replace(/^[-_]/, ''))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function getModrinthHashCachePath() {
  return path.join(Store.BASE_DIR, 'cache', 'modrinth-hash-map.json');
}

function loadModrinthHashCache() {
  const fallback = { byFile: {}, bySha1: {} };
  try {
    const file = getModrinthHashCachePath();
    if (!fs.existsSync(file)) return fallback;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      byFile: (raw.byFile && typeof raw.byFile === 'object') ? raw.byFile : {},
      bySha1: (raw.bySha1 && typeof raw.bySha1 === 'object') ? raw.bySha1 : {},
    };
  } catch {
    return fallback;
  }
}

function saveModrinthHashCache(cache) {
  try {
    const file = getModrinthHashCachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch {}
}

async function fetchModrinthVersionBySha1(sha1) {
  const hash = String(sha1 || '').toLowerCase().trim();
  if (!/^[a-f0-9]{40}$/.test(hash)) return null;
  const urls = [
    `${MODRINTH_API}/version_file/${hash}?algorithm=sha1`,
    `${MODRINTH_API}/version_file/${hash}`,
  ];
  for (const url of urls) {
    try {
      const version = await modrinthFetch(url);
      if (version?.id && version?.project_id) return version;
    } catch {}
  }
  return null;
}

async function enrichWithModrinthMetadata(entry, files, options = {}) {
  if (!entry?.gameDir || !Array.isArray(files) || files.length === 0) return files;
  const allowedTypes = new Set(['mod', 'shader', 'resourcepack']);
  const cache = loadModrinthHashCache();
  const projectMetaCache = new Map();
  let dirty = false;
  let lookupsLeft = Number.isFinite(options.maxLookups) ? Math.max(0, Math.floor(options.maxLookups)) : 8;

  for (const f of files) {
    if (!allowedTypes.has(f.type)) continue;
    const absPath = path.join(entry.gameDir, f.dir || '', f.filename || '');
    if (!fs.existsSync(absPath)) continue;

    let stat;
    try { stat = fs.statSync(absPath); } catch { continue; }
    const fingerprint = `${stat.size}:${Math.floor(stat.mtimeMs)}`;

    const cachedByFile = cache.byFile[absPath];
    if (cachedByFile && cachedByFile.fingerprint === fingerprint) {
      f.sha1 = cachedByFile.sha1 || '';
      f.modrinthProjectId = cachedByFile.projectId || '';
      f.modrinthVersionId = cachedByFile.versionId || '';
      f.modrinthProjectType = cachedByFile.projectType || '';
      f.modrinthSlug = cachedByFile.slug || '';
      f.modrinthTitle = cachedByFile.title || '';
      continue;
    }

    let sha1 = '';
    try { sha1 = hashFile(absPath, 'sha1'); } catch { continue; }

    const cachedBySha1 = cache.bySha1[sha1];
    if (cachedBySha1) {
      cache.byFile[absPath] = { fingerprint, sha1, ...cachedBySha1 };
      dirty = true;
      f.sha1 = sha1;
      f.modrinthProjectId = cachedBySha1.projectId || '';
      f.modrinthVersionId = cachedBySha1.versionId || '';
      f.modrinthProjectType = cachedBySha1.projectType || '';
      f.modrinthSlug = cachedBySha1.slug || '';
      f.modrinthTitle = cachedBySha1.title || '';
      continue;
    }

    if (lookupsLeft <= 0) continue;
    lookupsLeft--;

    const ver = await fetchModrinthVersionBySha1(sha1);
    const meta = {
      projectId: '',
      versionId: '',
      projectType: '',
      slug: '',
      title: '',
      missing: true,
      updatedAt: Date.now(),
    };
    if (ver?.project_id) {
      meta.projectId = String(ver.project_id);
      meta.versionId = String(ver.id || '');
      meta.projectType = String(ver.project_type || '');
      delete meta.missing;
      const cachedProject = projectMetaCache.get(meta.projectId);
      if (cachedProject) {
        meta.slug = cachedProject.slug;
        meta.title = cachedProject.title;
        if (!meta.projectType) meta.projectType = cachedProject.projectType;
      } else {
        try {
          const project = await modrinthFetch(`${MODRINTH_API}/project/${meta.projectId}`);
          const projectMeta = {
            slug: String(project?.slug || ''),
            title: String(project?.title || ''),
            projectType: String(project?.project_type || ''),
          };
          projectMetaCache.set(meta.projectId, projectMeta);
          meta.slug = projectMeta.slug;
          meta.title = projectMeta.title;
          if (!meta.projectType) meta.projectType = projectMeta.projectType;
        } catch {}
      }
    }

    cache.bySha1[sha1] = meta;
    cache.byFile[absPath] = { fingerprint, sha1, ...meta };
    dirty = true;

    f.sha1 = sha1;
    f.modrinthProjectId = meta.projectId || '';
    f.modrinthVersionId = meta.versionId || '';
    f.modrinthProjectType = meta.projectType || '';
    f.modrinthSlug = meta.slug || '';
    f.modrinthTitle = meta.title || '';
  }

  if (dirty) saveModrinthHashCache(cache);
  return files;
}
// SECURITY FIX [Élevé] — shell:open : accepte uniquement les chemins dans BASE_DIR
// ou dans un gameDir connu de la bibliothèque. Refuse toute URL.
ipcMain.handle('shell:open', (_, p) => {
  if (!p || typeof p !== 'string') return { error: 'Chemin invalide' };
  // Reject URL-like strings (e.g. "https://...", "file://../../etc")
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(p)) {
    console.warn('[shell:open] Rejected URL-like string:', p);
    return { error: 'Les URLs ne sont pas autorisées via shell:open' };
  }
  const resolved = path.resolve(p);
  const allowed  = getAllowedShellRoots();
  const ok = allowed.some(root => resolved === root || containsPath(root, resolved));
  if (!ok) {
    console.warn('[shell:open] Rejected path outside allowed roots:', resolved);
    return { error: 'Chemin non autorisé' };
  }
  if (!fs.existsSync(resolved)) return { error: 'Chemin introuvable : ' + resolved };
  return shell.openPath(resolved);
});

ipcMain.handle('shell:open-external', (_, rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return { error: 'URL invalide' };
  if (!isAllowedExternalUrl(rawUrl)) return { error: 'URL non autorisee' };
  return shell.openExternal(rawUrl);
});

// ── Resolve CurseForge mod names for existing instances ──────────────────────
// Called from the "Contenu" tab when files still have numeric names
ipcMain.handle('modpack:resolve-names', async (_, packId) => {
  const entry = library.get(packId);
  if (!entry?.gameDir) return { ok: false };
  try {
    const modsDir     = path.join(entry.gameDir, 'mods');
    const manifestPath = path.join(entry.gameDir, 'mods-manifest.json');
    const cachePath = path.join(Store.BASE_DIR, 'cache', 'curseforge-names.json');
    let manifest = {};
    let cache = {};
    let cacheDirty = false;
    try {
      if (fs.existsSync(manifestPath))
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {}
    try {
      if (fs.existsSync(cachePath))
        cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {};
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
        const cacheKey = String(projectID);

        if (cache[cacheKey]) {
          manifest[filename] = { displayName: cache[cacheKey], projectID: +projectID, fileID: +fileID };
          resolved++;
          return;
        }
        try {
          const res = await fetch(`https://www.curseforge.com/api/v1/mods/${projectID}`, {
            headers: HEADERS, timeout: 8000
          });
          let name = '';
          if (res.ok) {
            const data = await res.json();
            name = data?.data?.name || data?.name || '';
          }

          if (!name) {
            try {
              const fileRes = await fetch(`https://www.curseforge.com/api/v1/mods/${projectID}/files/${fileID}`, {
                headers: HEADERS, timeout: 8000
              });
              if (fileRes.ok) {
                const fileData = await fileRes.json();
                const raw = fileData?.data?.displayName || fileData?.data?.fileName || fileData?.displayName || fileData?.fileName;
                name = String(raw || '').replace(/\.(jar|zip)$/i, '').replace(/[_-]+/g, ' ').trim();
              }
            } catch {}
          }

          if (name) {
            manifest[filename] = { displayName: name, projectID: +projectID, fileID: +fileID };
            cache[cacheKey] = name;
            cacheDirty = true;
            resolved++;
          }
        } catch {}
      }));
      await new Promise(r => setTimeout(r, 150));
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    if (cacheDirty) {
      try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
      } catch {}
    }
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
    const instancesRoot   = path.resolve(path.join(Store.BASE_DIR, 'instances'));
    const downloadsRoot   = path.resolve(path.join(Store.BASE_DIR, 'downloads'));
    const resolvedDestDir = path.resolve(destDir || '');
    const allowedRoots    = [instancesRoot, downloadsRoot];
    const allowedDest     = allowedRoots.some(root => resolvedDestDir === root || containsPath(root, resolvedDestDir));
    if (!allowedDest) throw new Error('Destination non autorisée');

    fs.mkdirSync(resolvedDestDir, { recursive: true });
    const safeFilename = sanitizeFilename(file.filename || fileName || 'modrinth-file.jar', 'modrinth-file.jar');
    const dest = path.join(resolvedDestDir, safeFilename);
    await downloadFile(file.url, dest, () => {});

    if (file.hashes?.sha512) {
      const expected = String(file.hashes.sha512).toLowerCase();
      const actual   = hashFile(dest, 'sha512');
      if (actual !== expected) {
        try { fs.unlinkSync(dest); } catch {}
        throw new Error('Echec verification SHA-512');
      }
    } else if (file.hashes?.sha1) {
      const expected = String(file.hashes.sha1).toLowerCase();
      const actual   = hashFile(dest, 'sha1');
      if (actual !== expected) {
        try { fs.unlinkSync(dest); } catch {}
        throw new Error('Echec verification SHA-1');
      }
    }
    return { ok: true, path: dest, filename: safeFilename };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
ipcMain.handle('auth:status', async () => {
  try { return await auth.getProfile(); } catch { return null; }
});

ipcMain.handle('auth:login', async () => {
  try {
    // Device Code Flow: pas de port local, navigateur + code utilisateur
    send('auth:browser-opening', {});
    const flow = await auth.startLoginDeviceCode((info) => {
      send('auth:device-code', info || {});
    });
    send('auth:exchanging', {});
    // Échange du code → tokens MS → XBL → XSTS → Minecraft
    const { accessToken, refreshToken } = flow;
    const profile = await auth._fullAuthChain(accessToken, refreshToken);
    return { ok: true, profile };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('auth:logout', () => { auth.logout(); return true; });

// ── Library ───────────────────────────────────────────────────────────────────
ipcMain.handle('library:list',   ()      => library.list());
ipcMain.handle('library:get',    (_, id) => library.get(id));
ipcMain.handle('library:delete', (_, id) => library.delete(id));
ipcMain.handle('library:update', (_, id, fields) => {
  const updated = library.update(id, fields);
  if (updated) discordPresence?.syncRunningPack(updated);
  return updated;
});

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

// SECURITY FIX [Élevé] — modpack:read-log : le renderer passe { packId, logPath }.
// On reconstruit l'allowlist côté main et on vérifie que logPath y appartient.
ipcMain.handle('modpack:read-log', (_, payload) => {
  const packId  = payload?.packId;
  const logPath = payload?.logPath;
  if (typeof packId !== 'string' || typeof logPath !== 'string' || !logPath) return null;

  const entry = library.get(packId);
  if (!entry?.gameDir) return null;

  const allowedDirs = [
    path.join(entry.gameDir, 'logs'),
    path.join(entry.gameDir, 'crash-reports'),
  ];
  const resolved = path.resolve(logPath);
  const isAllowed = allowedDirs.some(dir => containsPath(dir, resolved));
  if (!isAllowed) {
    console.warn('[read-log] Rejected path outside log directories:', resolved);
    return null;
  }
  if (!/\.(log|txt)$/i.test(resolved)) return null;

  try {
    if (!fs.existsSync(resolved)) return null;
    const st = fs.statSync(resolved);
    if (!st.isFile()) return null;
    const size = st.size;
    const maxBytes = 500 * 1024;
    const buf = Buffer.alloc(Math.min(size, maxBytes));
    const fd = fs.openSync(resolved, 'r');
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
  const payload = (filePath && typeof filePath === 'object') ? filePath : { filePath };
  const sourcePath = String(payload.filePath || '');
  const cleanupSource = !!payload.cleanupSource;
  try {
    // 1. Parse
    const parsed = await ModpackParser.parse(sourcePath, msg => send('install:log', msg));
    send('install:log', `✓ ${parsed.name} v${parsed.version} [${parsed.format.toUpperCase()}]`);
    send('install:log', `  MC ${parsed.mcVersion} — ${parsed.modloader} ${parsed.modloaderVersion} — ${parsed.files.length} fichiers`);

    // 2. Vanilla Minecraft first — we need the profile to know the required Java version
    send('install:progress', { step: 'modloader', pct: 0, detail: `Minecraft ${parsed.mcVersion}...` });
    const { profile: vanillaProfile } = await MinecraftManager.ensureVanilla(parsed.mcVersion, (pct, detail) => {
      send('install:progress', { step: 'modloader', pct: Math.round(pct * 0.4), detail });
      if (detail && !detail.includes('%')) send('install:log', detail);
    });
    send('install:log', `✓ Minecraft ${parsed.mcVersion} client OK`);

    // 3. Java — now we can read javaVersion.majorVersion from the Mojang profile
    send('install:progress', { step: 'java', pct: 0, detail: 'Vérification Java...' });
    const javaPath = await JavaManager.ensureJava(parsed.mcVersion, (pct, detail) => {
      send('install:progress', { step: 'java', pct, detail });
    }, vanillaProfile);
    send('install:log', `✓ Java: ${javaPath}`);
    send('install:progress', { step: 'java', pct: 100, detail: 'Java prêt' });

    // 4. Modloader
    const loaderLabel =
      parsed.modloader === 'neoforge' ? 'NeoForge' :
      parsed.modloader === 'fabric' ? 'Fabric' :
      parsed.modloader === 'quilt' ? 'Quilt' :
      parsed.modloader === 'forge' ? 'Forge' :
      parsed.modloader;
    send('install:progress', { step: 'modloader', pct: 40, detail: `Installation ${loaderLabel}...` });
    let versionId;
    const loaderProgress = (pct, detail) => {
      send('install:progress', { step: 'modloader', pct: 40 + Math.round(pct * 0.6), detail });
      // Always forward Forge/Fabric log lines to UI console (they are valuable for debugging)
      if (detail) send('install:log', detail);
    };
    if (parsed.modloader === 'fabric' || parsed.modloader === 'quilt') {
      versionId = await FabricManager.ensure(parsed.mcVersion, parsed.modloaderVersion, javaPath, loaderProgress, parsed.modloader);
    } else if (parsed.modloader === 'neoforge') {
      versionId = await NeoForgeManager.ensure(parsed.mcVersion, parsed.modloaderVersion, javaPath, loaderProgress);
    } else if (parsed.modloader === 'forge') {
      versionId = await ForgeManager.ensure(parsed.mcVersion, parsed.modloaderVersion, javaPath, loaderProgress);
    } else {
      throw new Error(`Modloader non supporté pour ce modpack: ${parsed.modloader}`);
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
    if (cleanupSource) {
      try {
        const resolvedSource = path.resolve(sourcePath);
        const downloadsRoot = path.resolve(path.join(Store.BASE_DIR, 'downloads'));
        const ext = path.extname(resolvedSource).toLowerCase();
        const isInsideDownloads = resolvedSource !== downloadsRoot
          && (containsPath(downloadsRoot, resolvedSource) || resolvedSource.startsWith(downloadsRoot + path.sep));
        const shouldDelete = isInsideDownloads && ['.mrpack', '.zip'].includes(ext);
        if (shouldDelete && fs.existsSync(resolvedSource)) {
          fs.unlinkSync(resolvedSource);
          send('install:log', `Archive supprimee: ${path.basename(resolvedSource)}`);
        }
      } catch (cleanupErr) {
        send('install:log', `Nettoyage archive impossible: ${cleanupErr.message}`);
      }
    }
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
    if (isGameRunning()) {
      return { ok: false, error: 'Une instance est deja en cours. Arrete-la avant de relancer.' };
    }
    const entry = library.get(modpackId);
    if (!entry) throw new Error('Modpack introuvable dans la bibliothèque');

    const settings     = store.get('settings') || {};
    const profile      = await auth.getProfile().catch(() => null);
    const forceOffline = settings.forceOffline || false;
    const useOnline    = profile && !forceOffline;

    // Load vanilla profile to get javaVersion.majorVersion for correct Java selection
    const vanillaProfile = loadVanillaProfile(entry.mcVersion);
    const javaPath = await JavaManager.ensureJava(entry.mcVersion, () => {}, vanillaProfile);

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
    runningGameChild = child;
    runningGamePackId = modpackId;
    discordPresence?.setInGame(entry);
    send('game:launched', { pid: child.pid });
    child.stdout.on('data', d => send('game:log', d.toString()));
    child.stderr.on('data', d => send('game:log', d.toString()));
    child.on('close', code => {
      clearRunningGameState();
      discordPresence?.clearInGame();
      send('game:closed', { code });
    });

    return { ok: true, pid: child.pid };
  } catch (e) {
    console.error('[launch]', e);
    return { ok: false, error: e.message };
  }
});

// ── Instance creation ─────────────────────────────────────────────────────────

ipcMain.handle('game:kill', async () => {
  const activePackId = runningGamePackId;
  const result = await killRunningGameProcess();
  if (!result.ok) return result;
  send('game:log', '[Paroxysm] Arret force demande...');
  return { ok: true, pid: result.pid, packId: activePackId };
});

ipcMain.handle('instance:get-mc-versions', async () => {
  try {
    const { fetchJSON } = require('./core/utils/download');
    const manifest = await fetchJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    return manifest.versions
      .filter(v => v.type === 'release')
      .map(v => v.id);
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('instance:get-loader-versions', async (_, { loader, mcVersion }) => {
  try {
    if (loader === 'vanilla') return ['vanilla'];
    const { fetchJSON } = require('./core/utils/download');
    if (loader === 'fabric') {
      const data = await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
      return (data || []).map(v => v.loader.version);
    }
    if (loader === 'quilt') {
      const data = await fetchJSON(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`);
      return (data || []).map(v => v.loader?.version).filter(Boolean);
    }
    if (loader === 'neoforge') {
      return await NeoForgeManager.getVersionsForMc(mcVersion);
    }
    if (loader === 'forge') {
      return await getForgeVersionsForMc(mcVersion);
    }
    return [];
  } catch(e) { return { error: e.message }; }
});

async function getForgeVersionsForMc(mcVersion) {
  const metadataUrls = [
    'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
    'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
  ];
  const prefix = `${mcVersion}-`;
  let lastError = null;

  for (const url of metadataUrls) {
    try {
      const xml = await fetchXML(url);
      const all = parseXMLVersions(xml);
      if (!all.length) throw new Error(`No <version> entries from ${url}`);

      const versions = [...new Set(
        all
          .filter(v => v.startsWith(prefix))
          .map(v => v.slice(prefix.length))
          .filter(Boolean)
      )];

      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      if (versions.length) return versions;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    console.warn('[instance:get-loader-versions][forge] Unable to resolve versions:', lastError.message);
  }
  return [];
}

async function fetchXML(url) {
  const https = require('follow-redirects').https;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'PaROXYSM-Launcher/1.0' },
      maxRedirects: 10, timeout: 20000,
    }, res => {
      if ((res.statusCode || 0) >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseXMLVersions(xml) {
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)];
  return matches.map(m => m[1].trim()).filter(Boolean);
}

ipcMain.handle('instance:create', async (_, { name, mcVersion, loader, loaderVersion }) => {
  try {
    const allowedLoaders = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'vanilla']);
    if (!name || !mcVersion) throw new Error('Nom et version Minecraft requis');
    if (!allowedLoaders.has(loader)) throw new Error('Modloader invalide');
    if (loader !== 'vanilla' && !loaderVersion) throw new Error('Version du modloader requise');

    send('install:log', `Création de l'instance "${name}"...`);

    // Vanilla first — need the profile for correct Java version detection
    send('install:progress', { step: 'modloader', pct: 0, detail: `Minecraft ${mcVersion}...` });
    const { profile: vanillaProfile } = await MinecraftManager.ensureVanilla(mcVersion, (pct, detail) => {
      send('install:progress', { step: 'modloader', pct: Math.round(pct * 0.4), detail });
      if (detail && !detail.includes('%')) send('install:log', detail);
    });

    send('install:progress', { step: 'java', pct: 0, detail: 'Vérification Java...' });
    const javaPath = await JavaManager.ensureJava(mcVersion, (pct, detail) => {
      send('install:progress', { step: 'java', pct, detail });
    }, vanillaProfile);
    send('install:log', `✓ Java: ${javaPath}`);
    send('install:progress', { step: 'java', pct: 100, detail: 'Java prêt' });

    const loaderLabel =
      loader === 'vanilla' ? 'Vanilla' :
      loader === 'neoforge' ? 'NeoForge' :
      loader === 'fabric' ? 'Fabric' :
      loader === 'quilt' ? 'Quilt' :
      loader === 'forge' ? 'Forge' :
      loader;
    let versionId;
    if (loader === 'vanilla') {
      versionId = mcVersion;
      send('install:progress', { step: 'modloader', pct: 100, detail: 'Vanilla prêt' });
      send('install:log', `✓ Minecraft Vanilla ${mcVersion} prêt`);
    } else {
      send('install:progress', { step: 'modloader', pct: 40, detail: `Installation ${loaderLabel}...` });
      const loaderProgress = (pct, detail) => {
        send('install:progress', { step: 'modloader', pct: 40 + Math.round(pct * 0.6), detail });
        if (detail) send('install:log', detail);
      };
      if (loader === 'fabric' || loader === 'quilt') {
        versionId = await FabricManager.ensure(mcVersion, loaderVersion, javaPath, loaderProgress, loader);
      } else if (loader === 'neoforge') {
        versionId = await NeoForgeManager.ensure(mcVersion, loaderVersion, javaPath, loaderProgress);
      } else {
        versionId = await ForgeManager.ensure(mcVersion, loaderVersion, javaPath, loaderProgress);
      }
    }

    send('install:progress', { step: 'mods', pct: 100, detail: 'Instance vide (aucun mod)' });
    send('install:progress', { step: 'overrides', pct: 100, detail: 'Prêt' });

    const sanitize = n => (n||'instance').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_\-. ]/g,'').replace(/\s+/g,'_').slice(0,64)||'instance';
    const instanceDir = path.join(Store.BASE_DIR, 'instances', sanitize(name));
    fs.mkdirSync(path.join(instanceDir, 'mods'), { recursive: true });

    const parsed = {
      name, version: '1.0', author: '', mcVersion,
      modloader: loader, modloaderVersion: loader === 'vanilla' ? '' : loaderVersion,
      format: 'custom', files: [], iconData: null, tmpDir: null,
    };
    const entry = library.add(parsed, [], versionId);

    send('install:progress', { step: 'done', pct: 100, detail: 'Instance créée !' });
    send('install:done', entry);
    send('install:log', `✅ Instance "${name}" prête !`);
    return { ok: true, entry };
  } catch(e) {
    send('install:error', e.message);
    console.error('[instance:create]', e);
    return { ok: false, error: e.message };
  }
});

// ── Modpack icon fetch ────────────────────────────────────────────────────────
ipcMain.handle('modpack:fetch-icon', async (_, { format, name }) => {
  try {
    const q = encodeURIComponent(name);
    const data = await modrinthFetch(`${MODRINTH_API}/search?query=${q}&facets=${encodeURIComponent(JSON.stringify([["project_type:modpack"]]))}&limit=5`);
    if (data.hits?.length) {
      const nameLower = name.toLowerCase().split(' ')[0];
      const best = data.hits.find(h => h.title.toLowerCase().includes(nameLower)) || data.hits[0];
      if (best?.icon_url) return { ok: true, iconUrl: best.icon_url };
    }
    return { ok: false };
  } catch(e) { return { ok: false }; }
});

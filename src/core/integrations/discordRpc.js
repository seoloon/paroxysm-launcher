'use strict';

let RPC = null;
try {
  RPC = require('discord-rpc');
} catch {}

const DEFAULT_LAUNCHER_ASSET_KEY = 'logo_bckg';

class DiscordRpcService {
  constructor(getSettings = () => ({}), fixed = {}) {
    this._getSettings = getSettings;
    this._fixed = normalizeFixed(fixed);
    this._rpc = null;
    this._ready = false;
    this._connecting = false;
    this._lastActivitySig = '';
    this._launcherStartedAt = new Date();
    this._gameStartedAt = null;
    this._currentPage = 'library';
    this._runningPack = null;
    this._settings = {
      enabled: true,
      clientId: '',
      launcherAssetKey: DEFAULT_LAUNCHER_ASSET_KEY,
    };
  }

  start() {
    this._launcherStartedAt = new Date();
    this.refreshSettings();
  }

  refreshSettings() {
    this._settings = normalizeSettings(this._getSettings?.() || {}, this._fixed);

    if (!RPC || !this._settings.enabled || !this._settings.clientId) {
      this._disconnect();
      return;
    }

    const sameClient = this._rpc && this._rpc.clientId === this._settings.clientId;
    if (!sameClient) this._connect();
    this._pushActivity(true);
  }

  setPage(page) {
    if (!page || typeof page !== 'string') return;
    this._currentPage = page.toLowerCase();
    if (!this._runningPack) this._pushActivity();
  }

  setInGame(packEntry) {
    this._runningPack = normalizePack(packEntry);
    this._gameStartedAt = new Date();
    this._pushActivity(true);
  }

  clearInGame() {
    this._runningPack = null;
    this._gameStartedAt = null;
    this._pushActivity(true);
  }

  syncRunningPack(packEntry) {
    if (!this._runningPack || !packEntry || packEntry.id !== this._runningPack.id) return;
    this._runningPack = normalizePack(packEntry);
    this._pushActivity(true);
  }

  stop() {
    this._disconnect();
  }

  _connect() {
    if (!RPC || this._connecting) return;
    this._connecting = true;
    this._disconnect(false);

    try {
      RPC.register(this._settings.clientId);
      this._rpc = new RPC.Client({ transport: 'ipc' });
      this._rpc.clientId = this._settings.clientId;

      this._rpc.on('ready', () => {
        this._ready = true;
        this._connecting = false;
        this._pushActivity(true);
      });

      this._rpc.on('disconnected', () => {
        this._ready = false;
      });

      this._rpc.login({ clientId: this._settings.clientId }).catch((err) => {
        this._connecting = false;
        this._ready = false;
        console.warn('[discord-rpc] Login failed:', err?.message || err);
      });
    } catch (err) {
      this._connecting = false;
      this._ready = false;
      this._rpc = null;
      console.warn('[discord-rpc] Init failed:', err?.message || err);
    }
  }

  _disconnect(resetSig = true) {
    const wasReady = this._ready;
    this._connecting = false;
    this._ready = false;
    if (resetSig) this._lastActivitySig = '';

    if (this._rpc) {
      const rpc = this._rpc;
      this._rpc = null;
      try {
        const maybePromise = wasReady && typeof rpc.clearActivity === 'function'
          ? rpc.clearActivity()
          : null;
        if (maybePromise && typeof maybePromise.finally === 'function') {
          maybePromise.finally(() => {
            try { rpc.destroy(); } catch {}
          });
        } else {
          try { rpc.destroy(); } catch {}
        }
      } catch {
        try { rpc.destroy(); } catch {}
      }
    }
  }

  _pushActivity(force = false) {
    if (!this._ready || !this._rpc) return;
    const activity = this._buildActivity();
    if (!activity) return;
    const sig = JSON.stringify(activity);
    if (!force && sig === this._lastActivitySig) return;

    this._rpc.setActivity(activity)
      .then(() => { this._lastActivitySig = sig; })
      .catch((err) => {
        console.warn('[discord-rpc] setActivity failed:', err?.message || err);
      });
  }

  _buildActivity() {
    const launcherKey = this._settings.launcherAssetKey || DEFAULT_LAUNCHER_ASSET_KEY;
    const running = this._runningPack;

    if (running) {
      const packName = running.customName || running.name || 'Unknown modpack';
      return {
        state: 'Playing Paroxysm Launcher',
        details: packName,
        startTimestamp: this._gameStartedAt || new Date(),
        largeImageKey: launcherKey,
        largeImageText: packName,
        instance: false,
      };
    }

    return {
      state: 'Playing Paroxysm Launcher',
      details: pageDetails(this._currentPage),
      startTimestamp: this._launcherStartedAt,
      largeImageKey: launcherKey,
      largeImageText: 'Paroxysm Launcher',
      instance: false,
    };
  }
}

function pageDetails(page) {
  switch (String(page || '').toLowerCase()) {
    case 'library': return 'Idling in library';
    case 'browse': return 'Browsing mods';
    case 'profile': return 'Managing profile';
    case 'settings': return 'Tweaking settings';
    default: return 'Using launcher';
  }
}

function normalizePack(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: String(entry.id || ''),
    name: String(entry.name || ''),
    customName: String(entry.customName || ''),
  };
}

function normalizeFixed(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    enabled: src.enabled !== false,
    clientId: sanitizeClientId(src.clientId),
    launcherAssetKey: sanitizeAssetKey(src.launcherAssetKey, DEFAULT_LAUNCHER_ASSET_KEY),
  };
}

function normalizeSettings(raw, fixed = {}) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const enabled = fixed.enabled && src.discordRpcEnabled !== false;
  const clientId = fixed.clientId || sanitizeClientId(src.discordClientId);
  const launcherAssetKey = fixed.launcherAssetKey || sanitizeAssetKey(src.discordLauncherAssetKey, DEFAULT_LAUNCHER_ASSET_KEY);
  return { enabled, clientId, launcherAssetKey };
}

function sanitizeClientId(value) {
  const id = String(value || '').trim();
  return /^\d{17,32}$/.test(id) ? id : '';
}

function sanitizeAssetKey(value, fallback = '') {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 32);
  return key || fallback || '';
}

module.exports = DiscordRpcService;

'use strict';

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const { downloadFile, downloadBatch } = require('../utils/download');
const Store = require('../utils/store');

const CF_API_BASE    = 'https://api.curseforge.com/v1';
const CF_WEB_DL      = 'https://www.curseforge.com/api/v1/mods';
const CF_WEB_API     = 'https://www.curseforge.com/api/v1/mods';  // pour résolution de noms
const INSTANCES_BASE = path.join(Store.BASE_DIR, 'instances');
const MANIFEST_FILE  = 'mods-manifest.json';  // filename → { displayName, projectID, fileID }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json',
};

class ModpackInstaller {
  constructor(parsed, cfApiKey = null) {
    this.parsed      = parsed;
    this.cfApiKey    = cfApiKey;
    this.gameDir     = path.join(INSTANCES_BASE, sanitizeName(parsed.name));
    this.modsDir     = path.join(this.gameDir, 'mods');
    this.manifestPath = path.join(this.gameDir, MANIFEST_FILE);
    this._manifest   = this._loadManifest();
  }

  _loadManifest() {
    try {
      if (fs.existsSync(this.manifestPath))
        return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    } catch {}
    return {};
  }

  _saveManifest() {
    try {
      fs.mkdirSync(this.gameDir, { recursive: true });
      fs.writeFileSync(this.manifestPath, JSON.stringify(this._manifest, null, 2));
    } catch (e) {
      console.warn('[installer] Failed to save manifest:', e.message);
    }
  }

  _addToManifest(filename, displayName, projectID, fileID) {
    this._manifest[filename] = { displayName, projectID, fileID };
  }

  async downloadMods(onEach = () => {}) {
    fs.mkdirSync(this.modsDir, { recursive: true });

    const items = this.parsed.format === 'curseforge'
      ? await this._buildCurseForgeItems()
      : this._buildModrinthItems();

    if (items.length === 0) { onEach(0, 0, 'Aucun mod'); return []; }

    let done = 0;
    const failed = await downloadBatch(items, 3, (item, err) => {
      done++;
      const label = item.displayName || path.basename(item.dest);
      onEach(done, items.length, err ? `⚠ ${label}` : label);

      // Enregistrer dans le manifeste si le téléchargement a réussi
      if (!err && item.displayName) {
        const filename = path.basename(item.dest);
        this._addToManifest(filename, item.displayName, item.projectID, item.fileID);
      }
    });

    this._saveManifest();
    return failed;
  }

  // ── CurseForge ─────────────────────────────────────────────────────────────
  async _buildCurseForgeItems() {
    const files = this.parsed.files.filter(f => f.required !== false);
    if (!files.length) return [];

    // Stratégie 1 : API officielle avec clé utilisateur (noms exacts)
    if (this.cfApiKey) {
      try {
        const items = await this._resolveViaCFAPI(files);
        console.log(`[installer] CF API: ${items.length} fichiers résolus`);
        return items;
      } catch (e) {
        console.warn('[installer] CF API échoué, fallback web:', e.message);
      }
    }

    // Stratégie 2 : endpoint web public — on essaie de résoudre les noms
    // via l'API web CF publique (par chunks pour ne pas surcharger)
    console.log(`[installer] Endpoint web CurseForge (${files.length} mods)`);
    const items = files.map(f => buildWebEndpointItem(f, this.modsDir));

    // Résolution des noms en arrière-plan (best-effort, non bloquant)
    this._resolveNamesAsync(files).catch(() => {});

    return items;
  }

  // Résoudre les noms de mods CurseForge via l'API publique (sans clé)
  // URL: https://www.curseforge.com/api/v1/mods/{projectID}
  async _resolveNamesAsync(files) {
    // On traite par lots de 5 pour ne pas surcharger
    for (const chunk of chunkArray(files, 5)) {
      await Promise.allSettled(chunk.map(async (f) => {
        try {
          const res = await fetch(`${CF_WEB_API}/${f.projectID}`, {
            headers: HEADERS,
            timeout: 8000,
          });
          if (!res.ok) return;
          const data = await res.json();
          const modName = data?.data?.name || data?.name;
          if (modName) {
            const filename = `${f.projectID}-${f.fileID}.jar`;
            this._addToManifest(filename, modName, f.projectID, f.fileID);
          }
        } catch {}
      }));
      // Petite pause pour ne pas être rate-limité
      await new Promise(r => setTimeout(r, 200));
    }
    this._saveManifest();
    console.log(`[installer] Noms résolus: ${Object.keys(this._manifest).length} entrées`);
  }

  // API officielle CurseForge (clé utilisateur requise)
  async _resolveViaCFAPI(files) {
    const results = [];
    for (const chunk of chunkArray(files, 50)) {
      const res = await fetch(`${CF_API_BASE}/mods/files`, {
        method:  'POST',
        headers: {
          ...HEADERS,
          'x-api-key':    this.cfApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileIds: chunk.map(f => f.fileID) }),
      });
      if (!res.ok) throw new Error(`CF API status ${res.status}`);
      const data = await res.json();
      const map  = new Map((data.data || []).map(f => [f.id, f]));

      for (const f of chunk) {
        const info = map.get(f.fileID);
        if (info?.downloadUrl) {
          results.push({
            url:         info.downloadUrl,
            dest:        path.join(this.modsDir, sanitizeFileName(info.fileName)),
            displayName: info.displayName || info.fileName,
            projectID:   f.projectID,
            fileID:      f.fileID,
          });
        } else {
          results.push(buildWebEndpointItem(f, this.modsDir));
        }
      }
    }
    return results;
  }

  // ── Modrinth ───────────────────────────────────────────────────────────────
  _buildModrinthItems() {
    return this.parsed.files
      .filter(f => f.url || f.urls?.length)
      .map(f => {
        const url = f.url || f.urls[0];
        const rel = f.path
          ? f.path.replace(/^\/+/, '')
          : `mods/${decodeURIComponent(url.split('/').pop().split('?')[0])}`;
        const filename = path.basename(rel);
        // Le nom Modrinth est souvent déjà lisible dans le path
        return {
          url,
          dest:        path.join(this.gameDir, rel),
          displayName: filename,
          sha512:      f.sha512,
        };
      });
  }

  // ── Overrides ──────────────────────────────────────────────────────────────
  async applyOverrides() {
    const src = this.parsed.overridesDir;
    if (src && fs.existsSync(src)) copyDirSync(src, this.gameDir);
  }

  cleanup() {
    try { fs.rmSync(this.parsed.tmpDir, { recursive: true, force: true }); } catch {}
  }

  getGameDir()      { return this.gameDir; }
  getModsDir()      { return this.modsDir; }
  getManifestPath() { return this.manifestPath; }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildWebEndpointItem(f, modsDir) {
  return {
    projectID:   f.projectID,
    fileID:      f.fileID,
    url:         `${CF_WEB_DL}/${f.projectID}/files/${f.fileID}/download`,
    dest:        path.join(modsDir, `${f.projectID}-${f.fileID}.jar`),
    displayName: `${f.projectID}-${f.fileID}.jar`,  // sera mis à jour dans le manifeste
    headers:     HEADERS,
  };
}

function sanitizeName(n) {
  return (n || 'modpack')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-. ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 64) || 'modpack';
}

function sanitizeFileName(n) { return n.replace(/[/\\:*?"<>|]/g, '_'); }

function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src)) {
    const s = path.join(src, e), d = path.join(dest, e);
    fs.statSync(s).isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

module.exports = ModpackInstaller;

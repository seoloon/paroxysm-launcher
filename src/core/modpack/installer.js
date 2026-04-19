'use strict';
/**
 * ModpackInstaller — v3
 *
 * Stratégie de téléchargement CurseForge (par ordre) :
 *
 *  1. API officielle avec clé (si configurée par l'utilisateur dans Paramètres)
 *     → URLs directes signées, noms de fichiers corrects
 *
 *  2. Endpoint web public CurseForge (SANS clé, toujours accessible)
 *     https://www.curseforge.com/api/v1/mods/{projectID}/files/{fileID}/download
 *     → Redirige vers le vrai fichier. Fonctionne pour tous les mods
 *        dont la distribution est autorisée.
 *
 *  3. CDN edge (fallback, peut 403 sur certains mods restreints)
 *     https://edge.forgecdn.net/files/{AAAA}/{BBB}/{fileID}
 *
 * Mods "distribution disabled" (ex: OptiFine) : certains auteurs désactivent
 * la redistribution automatique. Ceux-là doivent être téléchargés manuellement
 * depuis CurseForge.com et placés dans le dossier mods.
 */

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const { downloadFile, downloadBatch } = require('../utils/download');
const Store = require('../utils/store');

const CF_API_BASE    = 'https://api.curseforge.com/v1';
const CF_WEB_DL      = 'https://www.curseforge.com/api/v1/mods';
const INSTANCES_BASE = path.join(Store.BASE_DIR, 'instances');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json',
};

class ModpackInstaller {
  constructor(parsed, cfApiKey = null) {
    this.parsed   = parsed;
    this.cfApiKey = cfApiKey;
    this.gameDir  = path.join(INSTANCES_BASE, sanitizeName(parsed.name));
    this.modsDir  = path.join(this.gameDir, 'mods');
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
    });
    return failed;
  }

  // ── CurseForge ─────────────────────────────────────────────────────────────
  async _buildCurseForgeItems() {
    const files = this.parsed.files.filter(f => f.required !== false);
    if (!files.length) return [];

    // Stratégie 1 : API officielle avec clé utilisateur
    if (this.cfApiKey) {
      try {
        const items = await this._resolveViaCFAPI(files);
        console.log(`[installer] CF API: ${items.length} fichiers résolus`);
        return items;
      } catch (e) {
        console.warn('[installer] CF API échoué, fallback web:', e.message);
      }
    }

    // Stratégie 2 : endpoint web public (pas de clé requise)
    console.log(`[installer] Utilisation endpoint web CurseForge (${files.length} mods)`);
    return files.map(f => buildWebEndpointItem(f, this.modsDir));
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
            displayName: info.fileName,
          });
        } else {
          // Mod restreint ou absent de l'API → fallback web endpoint
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
        return {
          url,
          dest:        path.join(this.gameDir, rel),
          displayName: path.basename(rel),
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

  getGameDir() { return this.gameDir; }
  getModsDir() { return this.modsDir; }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Construit un item de téléchargement via l'endpoint web public CurseForge.
 * Cet endpoint est public, ne requiert pas de clé API, et redirige vers
 * le vrai fichier. follow-redirects gère la redirection automatiquement.
 *
 * URL: https://www.curseforge.com/api/v1/mods/{projectID}/files/{fileID}/download
 */
function buildWebEndpointItem(f, modsDir) {
  return {
    projectID:   f.projectID,
    fileID:      f.fileID,
    url:         `${CF_WEB_DL}/${f.projectID}/files/${f.fileID}/download`,
    dest:        path.join(modsDir, `${f.projectID}-${f.fileID}.jar`),
    displayName: `${f.projectID}-${f.fileID}.jar`,
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

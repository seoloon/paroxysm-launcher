'use strict';
/**
 * Modpack Installer
 *
 * SECURITY FIX [Élevé] — Path traversal :
 *   - Les f.path Modrinth sont maintenant validés via safeDest() (parser.js).
 *   - copyDirSync (overrides) confine chaque fichier dans dest avant copie.
 *
 * SECURITY FIX [Moyen] — Vérification d'intégrité des mods téléchargés :
 *   - Pour les fichiers Modrinth, sha512 (et sha1 en fallback) sont vérifiés
 *     après téléchargement. Un fichier dont le hash ne correspond pas est
 *     supprimé et signalé en échec.
 *   - Pour CurseForge, le hash n'est pas fourni dans le manifest → on vérifie
 *     que le fichier est un ZIP valide (magic bytes PK).
 */

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { downloadFile, downloadBatch } = require('../utils/download');
const Store = require('../utils/store');
const { safeDest, containsPath } = require('./parser');

const CF_API_BASE    = 'https://api.curseforge.com/v1';
const CF_WEB_DL      = 'https://www.curseforge.com/api/v1/mods';
const CF_WEB_API     = 'https://www.curseforge.com/api/v1/mods';
const INSTANCES_BASE = path.join(Store.BASE_DIR, 'instances');
const MANIFEST_FILE  = 'mods-manifest.json';
const CF_NAME_CACHE_FILE = path.join(Store.BASE_DIR, 'cache', 'curseforge-names.json');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json',
};

class ModpackInstaller {
  constructor(parsed, cfApiKey = null) {
    this.parsed       = parsed;
    this.cfApiKey     = cfApiKey;
    this.gameDir      = path.join(INSTANCES_BASE, sanitizeName(parsed.name));
    this.modsDir      = path.join(this.gameDir, 'mods');
    this.manifestPath = path.join(this.gameDir, MANIFEST_FILE);
    this._manifest    = this._loadManifest();
    this._cfNameCache = loadCurseNameCache();
    this._cfNameCacheDirty = false;
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
      if (this._cfNameCacheDirty) {
        saveCurseNameCache(this._cfNameCache);
        this._cfNameCacheDirty = false;
      }
    } catch (e) {
      console.warn('[installer] Failed to save manifest:', e.message);
    }
  }

  _addToManifest(filename, displayName, projectID, fileID) {
    const normalized = normalizeDisplayName(displayName);
    const existing = this._manifest[filename];
    if (existing?.displayName) {
      const oldScore = scoreDisplayName(existing.displayName);
      const newScore = scoreDisplayName(normalized);
      if (newScore < oldScore) return;
    }
    this._manifest[filename] = {
      displayName: normalized || existing?.displayName || filename,
      projectID: Number.isFinite(+projectID) ? +projectID : existing?.projectID,
      fileID: Number.isFinite(+fileID) ? +fileID : existing?.fileID,
    };
  }

  async downloadMods(onEach = () => {}) {
    fs.mkdirSync(this.modsDir, { recursive: true });

    const items = this.parsed.format === 'curseforge'
      ? await this._buildCurseForgeItems()
      : this._buildModrinthItems();

    if (items.length === 0) { onEach(0, 0, 'Aucun mod'); return []; }

    let done = 0;
    const integrityFailed = [];
    const failed = await downloadBatch(items, 3, (item, err) => {
      done++;
      const label = item.displayName || path.basename(item.dest);

      if (!err) {
        // ── Post-download integrity check ──────────────────────────────────
        const integrityErr = verifyIntegrity(item);
        if (integrityErr) {
          // Remove the corrupted/tampered file
          try { fs.unlinkSync(item.dest); } catch {}
          err = new Error(integrityErr);
          integrityFailed.push({ ...item, error: integrityErr });
        }
      }

      onEach(done, items.length, err ? `⚠ ${label} (${err.message})` : label);

      if (!err) {
        const filename = path.basename(item.dest);
        const cachedProjectName = item.projectID != null ? this._cfNameCache[String(item.projectID)] : '';
        const bestName = cachedProjectName || item.displayName || filename;
        this._addToManifest(filename, bestName, item.projectID, item.fileID);

        if (item.projectID != null && item.fileID != null) {
          const numericAlias = `${item.projectID}-${item.fileID}.jar`;
          if (filename !== numericAlias && this._manifest[numericAlias]) {
            delete this._manifest[numericAlias];
          }
        }
      }
    });

    this._saveManifest();
    return [...failed, ...integrityFailed];
  }

  // ── CurseForge ─────────────────────────────────────────────────────────────
  async _buildCurseForgeItems() {
    const files = this.parsed.files.filter(f => f.required !== false);
    if (!files.length) return [];

    if (this.cfApiKey) {
      try {
        const items = await this._resolveViaCFAPI(files);
        console.log(`[installer] CF API: ${items.length} fichiers résolus`);
        return items;
      } catch (e) {
        console.warn('[installer] CF API échoué, fallback web:', e.message);
      }
    }

    console.log(`[installer] Endpoint web CurseForge (${files.length} mods)`);
    const items = files.map(f => buildWebEndpointItem(f, this.modsDir));
    this._resolveNamesAsync(files).catch(() => {});
    return items;
  }

  async _resolveNamesAsync(files) {
    for (const chunk of chunkArray(files, 5)) {
      await Promise.allSettled(chunk.map(async (f) => {
        try {
          const cacheKey = String(f.projectID);
          const cachedName = this._cfNameCache[cacheKey];
          if (cachedName) {
            const filename = `${f.projectID}-${f.fileID}.jar`;
            this._addToManifest(filename, cachedName, f.projectID, f.fileID);
            return;
          }

          const modName = await fetchCurseProjectName(f.projectID, f.fileID);
          if (modName) {
            const filename = `${f.projectID}-${f.fileID}.jar`;
            this._addToManifest(filename, modName, f.projectID, f.fileID);
            this._cfNameCache[cacheKey] = modName;
            this._cfNameCacheDirty = true;
          }
        } catch {}
      }));
      await new Promise(r => setTimeout(r, 200));
    }
    this._saveManifest();
  }

  async _resolveViaCFAPI(files) {
    const results = [];
    for (const chunk of chunkArray(files, 50)) {
      const res = await fetch(`${CF_API_BASE}/mods/files`, {
        method:  'POST',
        headers: { ...HEADERS, 'x-api-key': this.cfApiKey, 'Content-Type': 'application/json' },
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
            // CF doesn't supply hashes in this endpoint → ZIP magic check only
            checkZip:    true,
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
    const instanceDir = this.gameDir;
    const items = [];

    for (const f of this.parsed.files) {
      if (!f.url && !f.urls?.length) continue;

      const url = f.url || f.urls[0];

      // SECURITY: resolve and confine the destination path
      let dest;
      if (f.path) {
        try {
          dest = safeDest(f.path, instanceDir);
        } catch (e) {
          console.warn(`[installer] Skipping file with unsafe path "${f.path}": ${e.message}`);
          continue;
        }
      } else {
        // No path in manifest: fall back to mods/<filename>
        const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
        dest = path.join(this.modsDir, sanitizeFileName(filename));
      }

      items.push({
        url,
        dest,
        displayName: path.basename(dest),
        sha512:      f.sha512,
        sha1:        f.sha1,
      });
    }

    return items;
  }

  // ── Overrides ──────────────────────────────────────────────────────────────
  async applyOverrides() {
    const src = this.parsed.overridesDir;
    // SECURITY: overridesDir was already validated in parser.js
    if (src && fs.existsSync(src)) {
      copyDirSync(src, this.gameDir, this.gameDir);
    }
  }

  cleanup() {
    try { fs.rmSync(this.parsed.tmpDir, { recursive: true, force: true }); } catch {}
  }

  getGameDir()      { return this.gameDir; }
  getModsDir()      { return this.modsDir; }
  getManifestPath() { return this.manifestPath; }
}

// ── Integrity verification ─────────────────────────────────────────────────────

/**
 * Verify a downloaded file's integrity.
 * Returns an error message string on failure, or null on success.
 */
function verifyIntegrity(item) {
  if (!fs.existsSync(item.dest)) return 'Fichier absent après téléchargement';

  // Modrinth: verify sha512 (preferred) or sha1
  if (item.sha512) {
    const actual = hashFile(item.dest, 'sha512');
    if (actual !== item.sha512.toLowerCase()) {
      return `SHA-512 mismatch (attendu: ${item.sha512.slice(0, 16)}…)`;
    }
    return null;
  }

  if (item.sha1) {
    const actual = hashFile(item.dest, 'sha1');
    if (actual !== item.sha1.toLowerCase()) {
      return `SHA-1 mismatch (attendu: ${item.sha1.slice(0, 8)}…)`;
    }
    return null;
  }

  // CurseForge / no hash supplied: verify at least that the file is a valid ZIP
  if (item.checkZip || item.dest.endsWith('.jar')) {
    if (!isValidZip(item.dest)) {
      return 'Le fichier téléchargé n\'est pas un JAR/ZIP valide (magic bytes incorrects)';
    }
  }

  return null;
}

function hashFile(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function isValidZip(filePath) {
  try {
    const buf = Buffer.alloc(4);
    const fd  = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4B; // PK magic
  } catch {
    return false;
  }
}

// ── Path helpers ───────────────────────────────────────────────────────────────

function buildWebEndpointItem(f, modsDir) {
  return {
    projectID:   f.projectID,
    fileID:      f.fileID,
    url:         `${CF_WEB_DL}/${f.projectID}/files/${f.fileID}/download`,
    dest:        path.join(modsDir, `${f.projectID}-${f.fileID}.jar`),
    displayName: null,
    headers:     HEADERS,
    preferRemoteFilename: true,
    checkZip:    true,
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

function normalizeDisplayName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/\.(jar|zip)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreDisplayName(name) {
  if (!name) return 0;
  const n = String(name).trim();
  if (!n) return 0;
  if (/^\d+-\d+(\.jar)?$/i.test(n)) return 1;
  if (/\.(jar|zip)$/i.test(n) || /\d/.test(n)) return 2;
  return 3;
}

function loadCurseNameCache() {
  try {
    if (!fs.existsSync(CF_NAME_CACHE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CF_NAME_CACHE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return {};
}

function saveCurseNameCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CF_NAME_CACHE_FILE), { recursive: true });
    fs.writeFileSync(CF_NAME_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

async function fetchCurseProjectName(projectID, fileID) {
  try {
    const res = await fetch(`${CF_WEB_API}/${projectID}`, { headers: HEADERS, timeout: 8000 });
    if (res.ok) {
      const data = await res.json();
      const projectName = data?.data?.name || data?.name;
      if (projectName) return normalizeDisplayName(projectName);
    }
  } catch {}

  // Fallback: some responses expose file metadata where the filename is usable.
  if (Number.isFinite(+fileID)) {
    try {
      const res = await fetch(`${CF_WEB_API}/${projectID}/files/${fileID}`, { headers: HEADERS, timeout: 8000 });
      if (!res.ok) return '';
      const data = await res.json();
      const fileName = data?.data?.displayName || data?.data?.fileName || data?.displayName || data?.fileName;
      return normalizeDisplayName(fileName);
    } catch {}
  }
  return '';
}

/**
 * Recursive directory copy with path-containment check.
 * Each file's destination is verified to stay inside `rootDest`.
 *
 * SECURITY: prevents a crafted overrides/ entry with symlinks or '..' components
 * from escaping the instance directory.
 */
function copyDirSync(src, dest, rootDest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);

    // Ensure destination stays within the instance root
    const resolved = path.resolve(d);
    if (!containsPath(rootDest, resolved)) {
      console.warn(`[installer] Skipping override path that escapes instance dir: ${d}`);
      continue;
    }

    if (entry.isDirectory()) {
      copyDirSync(s, d, rootDest);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      try { fs.chmodSync(d, 0o666); } catch {}
    }
    // Silently skip symlinks (potential TOCTOU / escape vector)
  }
}

module.exports = ModpackInstaller;

'use strict';
/**
 * Modpack Parser
 *
 * Supports:
 *  - CurseForge  .zip  → manifest.json
 *  - Modrinth    .mrpack → modrinth.index.json  (which is also a .zip)
 *
 * Returns a unified ParsedModpack object:
 * {
 *   format:            'curseforge' | 'modrinth'
 *   name:              string
 *   version:           string
 *   mcVersion:         string         // e.g. "1.20.1"
 *   modloader:         'forge' | 'neoforge' | 'fabric' | 'quilt'
 *   modloaderVersion:  string
 *   files:             ModFile[]
 *   overridesDir:      string         // extracted tmp path
 *   tmpDir:            string
 * }
 *
 * ModFile (CurseForge):  { type: 'curseforge', projectID, fileID, required }
 * ModFile (Modrinth):    { type: 'modrinth',   url, sha512, path, size }
 */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const extract = require('extract-zip');
const crypto  = require('crypto');

class ModpackParser {
  /**
   * @param {string} filePath  - path to .zip or .mrpack
   * @param {function} log
   * @returns {Promise<ParsedModpack>}
   */
  static async parse(filePath, log = () => {}) {
    log(`Lecture de l'archive: ${path.basename(filePath)}`);

    const ext    = path.extname(filePath).toLowerCase();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paroxysm-'));

    await extract(filePath, { dir: tmpDir });
    log('Archive extraite');

    // Detect format
    const cfManifest  = path.join(tmpDir, 'manifest.json');
    const mrManifest  = path.join(tmpDir, 'modrinth.index.json');

    if (fs.existsSync(cfManifest)) {
      return ModpackParser._parseCurseForge(tmpDir, cfManifest, log);
    }
    if (fs.existsSync(mrManifest)) {
      return ModpackParser._parseModrinth(tmpDir, mrManifest, log);
    }

    throw new Error(
      'Format inconnu: ni manifest.json (CurseForge) ni modrinth.index.json (Modrinth) trouvé.'
    );
  }

  // ── CurseForge ─────────────────────────────────────────────────────────────
  static _parseCurseForge(tmpDir, manifestPath, log) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const mcInfo    = manifest.minecraft || {};
    const loaders   = mcInfo.modLoaders || [];
    const primary   = loaders.find(l => l.primary) || loaders[0];

    if (!primary) throw new Error('Aucun modloader trouvé dans manifest.json');

    const { loader, version: mlVersion } = parseLoaderString(primary.id);

    log(`CurseForge: ${manifest.name} v${manifest.version}`);
    log(`  MC ${mcInfo.version} — ${loader} ${mlVersion}`);
    log(`  ${manifest.files?.length ?? 0} mods`);

    return {
      format:           'curseforge',
      name:             manifest.name || 'Modpack sans nom',
      version:          manifest.version || '1.0',
      author:           manifest.author || '',
      mcVersion:        mcInfo.version,
      modloader:        loader,
      modloaderVersion: mlVersion,
      files:            (manifest.files || []).map(f => ({
        type:      'curseforge',
        projectID: f.projectID,
        fileID:    f.fileID,
        required:  f.required !== false,
      })),
      overridesDir: path.join(tmpDir, manifest.overrides || 'overrides'),
      tmpDir,
    };
  }

  // ── Modrinth ───────────────────────────────────────────────────────────────
  static _parseModrinth(tmpDir, manifestPath, log) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (manifest.formatVersion !== 1) {
      log(`⚠ Format Modrinth v${manifest.formatVersion} (seul v1 supporté officiellement)`);
    }

    const deps    = manifest.dependencies || {};
    const mcVer   = deps['minecraft'];
    const { loader, version: mlVersion } = detectModrinthLoader(deps);

    log(`Modrinth: ${manifest.name} v${manifest.versionId}`);
    log(`  MC ${mcVer} — ${loader} ${mlVersion}`);
    log(`  ${manifest.files?.length ?? 0} fichiers`);

    return {
      format:           'modrinth',
      name:             manifest.name || 'Modpack sans nom',
      version:          manifest.versionId || '1.0',
      author:           '',
      mcVersion:        mcVer,
      modloader:        loader,
      modloaderVersion: mlVersion,
      files:            (manifest.files || []).map(f => ({
        type:    'modrinth',
        url:     f.downloads?.[0],
        urls:    f.downloads || [],
        sha512:  f.hashes?.sha512,
        sha1:    f.hashes?.sha1,
        path:    f.path,   // relative path e.g. "mods/jei-1.20.1.jar"
        size:    f.fileSize,
      })),
      overridesDir: path.join(tmpDir, 'overrides'),
      tmpDir,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a CurseForge loader string like "forge-47.4.0" or "neoforge-20.4.0"
 */
function parseLoaderString(str) {
  const parts = str.split('-');
  const loader = parts[0].toLowerCase();
  const version = parts.slice(1).join('-');
  return {
    loader: normalizeLoader(loader),
    version,
  };
}

/**
 * Detect modloader from Modrinth dependencies map
 */
function detectModrinthLoader(deps) {
  for (const [key, version] of Object.entries(deps)) {
    const loader = normalizeLoader(key);
    if (loader !== 'unknown') return { loader, version };
  }
  return { loader: 'unknown', version: '' };
}

function normalizeLoader(str) {
  const s = str.toLowerCase();
  if (s.includes('neoforge')) return 'neoforge';
  if (s.includes('forge'))    return 'forge';
  if (s.includes('fabric'))   return 'fabric';
  if (s.includes('quilt'))    return 'quilt';
  return 'unknown';
}

module.exports = ModpackParser;

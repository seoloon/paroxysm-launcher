'use strict';
/**
 * Modpack Parser
 *
 * SECURITY FIX [Élevé] — Path traversal :
 *   - manifest.overrides est désormais validé avec containsPath() avant usage.
 *   - Les paths Modrinth (f.path) sont normalisés et confinés à l'instance dir.
 *   - extractIcon() retourne null si le chemin résolu sort du tmpDir.
 */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const extract = require('extract-zip');

class ModpackParser {
  static async parse(filePath, log = () => {}) {
    log(`Lecture de l'archive: ${path.basename(filePath)}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Archive introuvable: ${filePath}`);
    }
    if (!isLikelyZip(filePath)) {
      throw new Error(
        `Archive invalide: "${path.basename(filePath)}" n'est pas un ZIP/.mrpack valide ` +
        `(signature PK manquante).`
      );
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paroxysm-'));
    let parsedResult = null;
    try {
      await extract(filePath, { dir: tmpDir });
      log('Archive extraite');

      const cfManifest = path.join(tmpDir, 'manifest.json');
      const mrManifest = path.join(tmpDir, 'modrinth.index.json');

      if (fs.existsSync(cfManifest)) parsedResult = ModpackParser._parseCurseForge(tmpDir, cfManifest, log);
      else if (fs.existsSync(mrManifest)) parsedResult = ModpackParser._parseModrinth(tmpDir, mrManifest, log);
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      const msg = String(e?.message || '');
      if (/end of central directory|invalid zip|invalid or unsupported zip|corrupt|bad archive/i.test(msg)) {
        throw new Error(
          `Archive .mrpack invalide ou incomplète (${path.basename(filePath)}). ` +
          `Retéléchargez le modpack puis réessayez.`
        );
      }
      throw e;
    }
    if (parsedResult) return parsedResult;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    throw new Error(
      'Format inconnu: ni manifest.json (CurseForge) ni modrinth.index.json (Modrinth) trouvé.'
    );
  }

  // ── CurseForge ─────────────────────────────────────────────────────────────
  static _parseCurseForge(tmpDir, manifestPath, log) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const mcInfo  = manifest.minecraft || {};
    const loaders = mcInfo.modLoaders || [];
    const primary = loaders.find(l => l.primary) || loaders[0];
    if (!primary) throw new Error('Aucun modloader trouvé dans manifest.json');

    const { loader, version: mlVersion } = parseLoaderString(primary.id);

    log(`CurseForge: ${manifest.name} v${manifest.version}`);
    log(`  MC ${mcInfo.version} — ${loader} ${mlVersion} — ${manifest.files?.length ?? 0} mods`);

    // SECURITY: validate the overrides directory name — must stay inside tmpDir
    const rawOverrides    = manifest.overrides || 'overrides';
    const resolvedOverrides = path.resolve(tmpDir, rawOverrides);
    if (!containsPath(tmpDir, resolvedOverrides)) {
      log(`⚠ overrides path traversal détecté ("${rawOverrides}") — remplacé par "overrides"`);
    }
    const safeOverridesDir = containsPath(tmpDir, resolvedOverrides)
      ? resolvedOverrides
      : path.join(tmpDir, 'overrides');

    const iconData = extractIcon(tmpDir);

    return {
      format:           'curseforge',
      name:             manifest.name || 'Modpack sans nom',
      version:          manifest.version || '1.0',
      author:           manifest.author || '',
      mcVersion:        mcInfo.version,
      modloader:        loader,
      modloaderVersion: mlVersion,
      files: (manifest.files || []).map(f => ({
        type:      'curseforge',
        projectID: f.projectID,
        fileID:    f.fileID,
        required:  f.required !== false,
      })),
      overridesDir: safeOverridesDir,
      iconData,
      tmpDir,
    };
  }

  // ── Modrinth ───────────────────────────────────────────────────────────────
  static _parseModrinth(tmpDir, manifestPath, log) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (manifest.formatVersion !== 1) {
      log(`⚠ Format Modrinth v${manifest.formatVersion} (seul v1 supporté officiellement)`);
    }

    const deps = manifest.dependencies || {};
    const mcVer = deps['minecraft'];
    const { loader, version: mlVersion } = detectModrinthLoader(deps);

    log(`Modrinth: ${manifest.name} v${manifest.versionId}`);
    log(`  MC ${mcVer} — ${loader} ${mlVersion} — ${manifest.files?.length ?? 0} fichiers`);

    const iconData = extractIcon(tmpDir);

    return {
      format:           'modrinth',
      name:             manifest.name || 'Modpack sans nom',
      version:          manifest.versionId || '1.0',
      author:           '',
      mcVersion:        mcVer,
      modloader:        loader,
      modloaderVersion: mlVersion,
      files: (manifest.files || []).map(f => ({
        type:   'modrinth',
        url:    f.downloads?.[0],
        urls:   f.downloads || [],
        sha512: f.hashes?.sha512,
        sha1:   f.hashes?.sha1,
        // SECURITY: path will be sanitized later by installer.js using safeDest()
        path:   f.path,
        size:   f.fileSize,
      })),
      overridesDir: path.join(tmpDir, 'overrides'),
      iconData,
      tmpDir,
    };
  }
}

// ── Security helpers ──────────────────────────────────────────────────────────

/**
 * Returns true iff `child` is strictly inside `parent`.
 * Uses path.resolve() so '..' sequences are already collapsed.
 */
function containsPath(parent, child) {
  const rel = path.relative(parent, child);
  // rel must not start with '..' and must not be an absolute path
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Build a safe destination path for a Modrinth file entry.
 * Rejects / strips any path component that would escape instanceDir.
 *
 * @param {string} rawPath   - f.path from modrinth.index.json
 * @param {string} instanceDir
 * @returns {string} safe absolute destination path
 * @throws {Error} if the path cannot be made safe
 */
function safeDest(rawPath, instanceDir) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error(`Modrinth file entry has no path`);
  }

  // Normalise: remove leading slashes/dots, resolve '..' in the middle
  const stripped   = rawPath.replace(/^[/\\]+/, '');
  const resolved   = path.resolve(instanceDir, stripped);

  if (!containsPath(instanceDir, resolved)) {
    throw new Error(
      `Path traversal détecté dans le manifest Modrinth: "${rawPath}" ` +
      `→ "${resolved}" sort de "${instanceDir}"`
    );
  }
  return resolved;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function parseLoaderString(str) {
  const parts  = str.split('-');
  const loader = parts[0].toLowerCase();
  return { loader: normalizeLoader(loader), version: parts.slice(1).join('-') };
}

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

function extractIcon(tmpDir) {
  const candidates = [
    'icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp',
    'logo.png', 'logo.jpg',
    path.join('overrides', 'icon.png'),
    path.join('overrides', 'logo.png'),
  ];
  for (const rel of candidates) {
    // SECURITY: ensure the candidate doesn't escape tmpDir
    const full = path.resolve(tmpDir, rel);
    if (!containsPath(tmpDir, full)) continue;
    if (fs.existsSync(full)) {
      try {
        const ext  = path.extname(rel).slice(1).replace('jpg', 'jpeg');
        const data = fs.readFileSync(full);
        return `data:image/${ext};base64,${data.toString('base64')}`;
      } catch {}
    }
  }
  return null;
}

function isLikelyZip(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 4) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const sig = buf.toString('hex').toLowerCase();
    // PK\x03\x04 (normal), PK\x05\x06 (empty), PK\x07\x08 (spanned)
    return sig === '504b0304' || sig === '504b0506' || sig === '504b0708';
  } catch {
    return false;
  }
}

// Export safeDest so installer.js can use it
module.exports = ModpackParser;
module.exports.safeDest = safeDest;
module.exports.containsPath = containsPath;

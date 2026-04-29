'use strict';
/**
 * Minecraft Vanilla Manager
 *
 * Downloads the Minecraft client JAR and assets index for a given version.
 * This is required BEFORE Forge/Fabric can run, since the Forge installer
 * itself depends on the vanilla client being present.
 *
 * Mojang manifest: https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
 */

const fs   = require('fs');
const path = require('path');
const { downloadFile, fetchJSON } = require('../utils/download');
const Store = require('../utils/store');

const MC_DIR       = path.join(Store.BASE_DIR, 'minecraft');
const VERSIONS_DIR = path.join(MC_DIR, 'versions');
const ASSETS_DIR   = path.join(MC_DIR, 'assets');
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

class MinecraftManager {
  static async ensureLibraries(libraries = [], onProgress = () => {}) {
    await MinecraftManager._downloadLibraries(Array.isArray(libraries) ? libraries : [], onProgress);
  }

  /**
   * Ensure the vanilla client JAR and version JSON are present.
   * Also downloads the assets index (not individual assets — too large).
   * @param {string} mcVersion  e.g. "1.20.1"
   * @param {function} onProgress (pct, detail)
   */
  static async ensureVanilla(mcVersion, onProgress = () => {}) {
    const versionDir  = path.join(VERSIONS_DIR, mcVersion);
    const versionJson = path.join(versionDir, `${mcVersion}.json`);
    const clientJar   = path.join(versionDir, `${mcVersion}.jar`);

    fs.mkdirSync(versionDir, { recursive: true });

    // Step 1: Version JSON
    let profile;
    if (fs.existsSync(versionJson)) {
      profile = JSON.parse(fs.readFileSync(versionJson, 'utf8'));
      onProgress(20, `MC ${mcVersion} (profil déjà présent)`);
    } else {
      onProgress(0, `Téléchargement du manifeste Minecraft...`);
      const manifest = await fetchJSON(MANIFEST_URL);
      const entry = manifest.versions.find(v => v.id === mcVersion);
      if (!entry) throw new Error(`Version Minecraft "${mcVersion}" introuvable dans le manifeste Mojang`);

      onProgress(10, `Téléchargement du profil ${mcVersion}...`);
      profile = await fetchJSON(entry.url);
      fs.writeFileSync(versionJson, JSON.stringify(profile, null, 2));
      onProgress(20, `Profil ${mcVersion} téléchargé`);
    }

    // Step 2: Client JAR
    if (!fs.existsSync(clientJar)) {
      const clientUrl = profile.downloads?.client?.url;
      if (!clientUrl) throw new Error(`URL du client Minecraft ${mcVersion} introuvable`);

      onProgress(20, `Téléchargement de Minecraft ${mcVersion} client...`);
      await downloadFile(clientUrl, clientJar, pct => {
        onProgress(20 + Math.round(pct * 0.5), `MC ${mcVersion} client: ${pct}%`);
      });
      onProgress(70, `Client ${mcVersion} téléchargé`);
    } else {
      onProgress(70, `Client ${mcVersion} déjà présent`);
    }

    // Step 3: Assets index
    const assetIndex   = profile.assetIndex;
    const assetsIdxDir = path.join(ASSETS_DIR, 'indexes');
    const assetsIdxPath = path.join(assetsIdxDir, `${assetIndex.id}.json`);
    fs.mkdirSync(assetsIdxDir, { recursive: true });

    if (!fs.existsSync(assetsIdxPath)) {
      onProgress(70, `Téléchargement de l'index des assets...`);
      await downloadFile(assetIndex.url, assetsIdxPath, pct => {
        onProgress(70 + Math.round(pct * 0.05), `Assets index: ${pct}%`);
      });
    }

    // Step 4: Asset objects (sons, textures, langues)
    // Sans ces fichiers Minecraft lance, affiche le logo puis crash silencieusement.
    onProgress(75, 'Téléchargement des assets...');
    await MinecraftManager._downloadAssets(assetsIdxPath, (pct, detail) => {
      onProgress(75 + Math.round(pct * 0.1), detail);
    });

    // Step 5: Core libraries
    onProgress(85, `Téléchargement des bibliothèques vanilla...`);
    await MinecraftManager._downloadLibraries(profile.libraries || [], (pct) => {
      onProgress(85 + Math.round(pct * 0.14), `Bibliothèques: ${pct}%`);
    });

    // Step 5: Log4j config (security fix, some versions need it)
    await MinecraftManager._ensureLog4jConfig(mcVersion, profile, versionDir);

    onProgress(100, `Minecraft ${mcVersion} prêt`);
    return { profile, versionDir, clientJar };
  }

  static async _downloadAssets(assetsIdxPath, onProgress = () => {}) {
    try {
      const index   = JSON.parse(fs.readFileSync(assetsIdxPath, 'utf8'));
      const objects = Object.values(index.objects || {});
      const objDir  = path.join(ASSETS_DIR, 'objects');

      const missing = objects.filter(o => {
        const sub = o.hash.substring(0, 2);
        return !fs.existsSync(path.join(objDir, sub, o.hash));
      });

      if (missing.length === 0) { onProgress(100, 'Assets déjà présents'); return; }

      let done = 0;
      // Parallèle par lots de 30
      for (let i = 0; i < missing.length; i += 30) {
        const chunk = missing.slice(i, i + 30);
        await Promise.allSettled(chunk.map(async (obj) => {
          const sub  = obj.hash.substring(0, 2);
          const dest = path.join(objDir, sub, obj.hash);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (!fs.existsSync(dest)) {
            try {
              await downloadFile(
                `https://resources.download.minecraft.net/${sub}/${obj.hash}`,
                dest
              );
            } catch {}
          }
          done++;
        }));
        onProgress(Math.round((done / missing.length) * 100), `Assets: ${done}/${missing.length}`);
      }
    } catch (e) {
      console.warn('[minecraft] Asset download error:', e.message);
    }
  }

  static async _downloadLibraries(libraries, onProgress = () => {}) {
    const libsDir = path.join(MC_DIR, 'libraries');
    const toDownload = [];
    const currentOs = osName();

    for (const lib of libraries) {
      if (!isLibAllowed(lib)) continue;

      // Main artifact
      const artifact = lib.downloads?.artifact;
      if (artifact?.url && artifact?.path) {
        const dest = path.join(libsDir, artifact.path);
        if (!fs.existsSync(dest)) {
          toDownload.push({ url: artifact.url, dest, name: lib.name });
        }
      }

      // Legacy natives: lib.natives["windows"] → lib.downloads.classifiers["natives-windows"]
      const legacyNatKey = lib.natives?.[currentOs === 'osx' ? 'osx' : currentOs];
      if (legacyNatKey && lib.downloads?.classifiers?.[legacyNatKey]) {
        const nat = lib.downloads.classifiers[legacyNatKey];
        if (nat?.url && nat?.path) {
          const dest = path.join(libsDir, nat.path);
          if (!fs.existsSync(dest)) {
            toDownload.push({ url: nat.url, dest, name: `${lib.name} [native]` });
          }
        }
      }

      // Modern LWJGL 3 natives: classifier "natives-windows" in the name itself
      // e.g. "org.lwjgl:lwjgl:3.3.3:natives-windows"
      // These already have a proper downloads.artifact entry — handled above.
      // But some may only appear as name-based coords without downloads block.
      if (!artifact && lib.name) {
        const parts = lib.name.split(':');
        const cls   = parts[3] || '';
        if (cls.startsWith('natives-') && cls.includes(currentOs === 'osx' ? 'macos' : currentOs)) {
          // Construct Maven URL from coordinates
          const [grp, art, ver] = parts;
          const groupPath = grp.replace(/\./g, '/');
          const jarName   = `${art}-${ver}-${cls}.jar`;
          const url  = `https://libraries.minecraft.net/${groupPath}/${art}/${ver}/${jarName}`;
          const dest = path.join(libsDir, groupPath.replace(/\//g, path.sep), art, ver, jarName);
          if (!fs.existsSync(dest)) {
            toDownload.push({ url, dest, name: lib.name });
          }
        }
      }
    }

    let done = 0;
    for (const item of toDownload) {
      fs.mkdirSync(path.dirname(item.dest), { recursive: true });
      try {
        await downloadFile(item.url, item.dest);
      } catch (e) {
        console.warn(`[minecraft] Failed to download lib ${item.name}: ${e.message}`);
      }
      done++;
      onProgress(Math.round((done / toDownload.length) * 100));
    }
  }

  static async _ensureLog4jConfig(mcVersion, profile, versionDir) {
    // MC 1.18.1+ includes log4j fix in libraries; older versions need explicit patch
    // For 1.20.1 this is handled by Forge/Fabric themselves — skip
    const [, minor] = mcVersion.split('.').map(Number);
    if (minor >= 18) return;

    const log4jPath = path.join(versionDir, 'log4j2.xml');
    if (fs.existsSync(log4jPath)) return;

    // Download safe config from Mojang
    const url = 'https://launcher.mojang.com/v1/objects/02937d122c86ce73319ef9975b58896fc1b491d1/log4j2_112-116.xml';
    try {
      await downloadFile(url, log4jPath);
    } catch { /* optional */ }
  }

  /**
   * Extract natives for a version to the natives directory.
   */
  static extractNatives(profile, versionId) {
    const libsDir    = path.join(MC_DIR, 'libraries');
    const nativesDir = path.join(VERSIONS_DIR, versionId, 'natives');
    fs.mkdirSync(nativesDir, { recursive: true });

    for (const lib of (profile.libraries || [])) {
      if (!isLibAllowed(lib)) continue;
      const nativeKey = lib.natives?.[osName()];
      if (!nativeKey) continue;

      const nat = lib.downloads?.classifiers?.[nativeKey];
      if (!nat) continue;

      const jarPath = path.join(libsDir, nat.path);
      if (!fs.existsSync(jarPath)) continue;

      try {
        const extract = require('extract-zip');
        extract(jarPath, {
          dir: nativesDir,
          onEntry: (entry) => entry.fileName.startsWith('META-INF/'),
        }).catch(() => {});
      } catch {}
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function isLibAllowed(lib) {
  const rules = lib.rules;
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (rule.action === 'allow'    && (!rule.os || rule.os.name === osName())) allowed = true;
    if (rule.action === 'disallow' && (!rule.os || rule.os.name === osName())) allowed = false;
  }
  return allowed;
}

function osName() {
  return process.platform === 'win32' ? 'windows'
       : process.platform === 'darwin' ? 'osx'
       : 'linux';
}

module.exports = MinecraftManager;

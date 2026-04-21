'use strict';
/**
 * Fabric Manager — v2
 *
 * Installe Fabric via l'API Fabric Meta.
 * Le profile JSON Fabric hérite de vanilla (inheritsFrom) et liste ses propres
 * bibliothèques avec leurs URLs maven exactes dans lib.url.
 *
 * Corrections vs v1 :
 *  - URL maven construite avec '/' (pas path.sep) pour les paths HTTP
 *  - Téléchargement des assets objet (requis pour que MC ne crash pas au démarrage)
 *  - Support du champ lib.url comme base maven correcte
 *  - Téléchargement des libs vanilla manquantes (Fabric hérite de vanilla)
 */

const fs   = require('fs');
const path = require('path');
const { downloadFile, fetchJSON } = require('../utils/download');
const Store = require('../utils/store');

const MC_DIR      = path.join(Store.BASE_DIR, 'minecraft');
const LIBS_DIR    = path.join(MC_DIR, 'libraries');
const ASSETS_DIR  = path.join(MC_DIR, 'assets');
const FABRIC_META = 'https://meta.fabricmc.net/v2';

class FabricManager {
  /**
   * S'assure que Fabric est installé pour une version MC donnée.
   * Télécharge le profil, les bibliothèques Fabric, et les assets vanilla.
   *
   * @returns {string} versionId (ex: "fabric-loader-0.15.11-1.20.1")
   */
  static async ensure(mcVersion, loaderVersion, javaPath, onProgress = () => {}) {
    const versionId   = `fabric-loader-${loaderVersion}-${mcVersion}`;
    const versionDir  = path.join(MC_DIR, 'versions', versionId);
    const versionJson = path.join(versionDir, `${versionId}.json`);

    onProgress(5, `Vérification de Fabric ${loaderVersion}...`);

    // Télécharger le profil Fabric si absent
    let profile;
    if (fs.existsSync(versionJson)) {
      profile = JSON.parse(fs.readFileSync(versionJson, 'utf8'));
    } else {
      onProgress(10, `Téléchargement profil Fabric ${loaderVersion}...`);
      const profileUrl = `${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
      profile = await fetchJSON(profileUrl);
      fs.mkdirSync(versionDir, { recursive: true });
      fs.writeFileSync(versionJson, JSON.stringify(profile, null, 2));
    }

    // Télécharger les bibliothèques Fabric
    const libs = profile.libraries || [];
    onProgress(15, `Téléchargement de ${libs.length} bibliothèques Fabric...`);
    await FabricManager._downloadLibraries(libs, (pct, detail) => {
      onProgress(15 + Math.round(pct * 0.5), detail);
    });

    // Télécharger les assets (indispensable — sans eux MC lance et crash immédiatement)
    onProgress(65, 'Téléchargement des assets Minecraft...');
    await FabricManager._downloadAssets(mcVersion, (pct, detail) => {
      onProgress(65 + Math.round(pct * 0.33), detail);
    });

    onProgress(100, `Fabric ${loaderVersion} prêt`);
    return versionId;
  }

  // ── Bibliothèques Fabric ──────────────────────────────────────────────────
  static async _downloadLibraries(libs, onProgress = () => {}) {
    const toDownload = [];

    for (const lib of libs) {
      if (!lib.name) continue;
      const parts     = lib.name.split(':');
      const [grp, art, ver, cls] = parts;
      const groupSlash = grp.replace(/\./g, '/');      // HTTP path: toujours '/'
      const groupSep   = grp.replace(/\./g, path.sep); // FS path: sep local
      const suffix     = cls ? `-${cls}` : '';
      const jarName    = `${art}-${ver}${suffix}.jar`;

      const dest = path.join(LIBS_DIR, groupSep, art, ver, jarName);
      if (fs.existsSync(dest)) continue;

      // lib.url = base maven (ex: "https://maven.fabricmc.net/")
      // Certaines libs n'ont pas de lib.url → maven central ou fabricmc
      const base = (lib.url || 'https://maven.fabricmc.net/').replace(/\/$/, '');
      const url  = `${base}/${groupSlash}/${art}/${ver}/${jarName}`;

      toDownload.push({ url, dest, name: lib.name });
    }

    let done = 0;
    for (const item of toDownload) {
      fs.mkdirSync(path.dirname(item.dest), { recursive: true });
      try {
        await downloadFile(item.url, item.dest);
      } catch (e) {
        // Essayer le maven central comme fallback
        try {
          const parts     = item.name.split(':');
          const [grp, art, ver] = parts;
          const g = grp.replace(/\./g, '/');
          const fallback = `https://repo1.maven.org/maven2/${g}/${art}/${ver}/${art}-${ver}.jar`;
          await downloadFile(fallback, item.dest);
        } catch {
          console.warn(`[fabric] Lib manquante: ${item.name}`);
        }
      }
      done++;
      const art = item.name.split(':')[1] || item.name;
      onProgress(Math.round((done / toDownload.length) * 100), `Lib ${done}/${toDownload.length}: ${art}`);
    }
  }

  // ── Assets vanilla (nécessaires au démarrage de Minecraft) ───────────────
  // Sans eux : MC se lance, affiche le logo Mojang Studios, puis crash (écran noir).
  // Fabric n'installe pas les assets — c'est notre responsabilité.
  static async _downloadAssets(mcVersion, onProgress = () => {}) {
    const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

    // Récupérer le version.json vanilla pour avoir l'assetIndex
    const versionDir  = path.join(MC_DIR, 'versions', mcVersion);
    const versionJson = path.join(versionDir, `${mcVersion}.json`);
    let vanillaProfile;
    if (fs.existsSync(versionJson)) {
      vanillaProfile = JSON.parse(fs.readFileSync(versionJson, 'utf8'));
    } else {
      onProgress(0, 'Téléchargement du manifeste vanilla...');
      const manifest = await fetchJSON(MANIFEST_URL);
      const entry    = manifest.versions.find(v => v.id === mcVersion);
      if (!entry) throw new Error(`MC ${mcVersion} introuvable dans le manifeste`);
      vanillaProfile = await fetchJSON(entry.url);
      fs.mkdirSync(versionDir, { recursive: true });
      fs.writeFileSync(versionJson, JSON.stringify(vanillaProfile, null, 2));
    }

    // Télécharger le client jar si absent (requis par Fabric pour charger le jeu)
    const clientJar = path.join(versionDir, `${mcVersion}.jar`);
    if (!fs.existsSync(clientJar)) {
      const clientUrl = vanillaProfile.downloads?.client?.url;
      if (clientUrl) {
        onProgress(5, `Téléchargement de Minecraft ${mcVersion}...`);
        await downloadFile(clientUrl, clientJar, pct => {
          onProgress(5 + Math.round(pct * 0.45), `MC ${mcVersion}: ${pct}%`);
        });
      }
    }

    // Télécharger l'index des assets
    const assetIndex    = vanillaProfile.assetIndex;
    const idxDir        = path.join(ASSETS_DIR, 'indexes');
    const idxPath       = path.join(idxDir, `${assetIndex.id}.json`);
    fs.mkdirSync(idxDir, { recursive: true });

    if (!fs.existsSync(idxPath)) {
      onProgress(50, 'Index des assets...');
      await downloadFile(assetIndex.url, idxPath);
    }

    // Télécharger les assets objet (sons, textures, langues)
    // Sans ces fichiers MC affiche logo puis crash silencieusement
    const index   = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    const objects = Object.values(index.objects || {});
    const objDir  = path.join(ASSETS_DIR, 'objects');

    const missing = objects.filter(o => {
      const sub  = o.hash.substring(0, 2);
      const dest = path.join(objDir, sub, o.hash);
      return !fs.existsSync(dest);
    });

    if (missing.length > 0) {
      onProgress(55, `Téléchargement de ${missing.length} assets...`);
      let done = 0;
      // Téléchargement en parallèle par lots de 20
      for (let i = 0; i < missing.length; i += 20) {
        const chunk = missing.slice(i, i + 20);
        await Promise.allSettled(chunk.map(async (obj) => {
          const sub  = obj.hash.substring(0, 2);
          const dest = path.join(objDir, sub, obj.hash);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          try {
            await downloadFile(
              `https://resources.download.minecraft.net/${sub}/${obj.hash}`,
              dest
            );
          } catch {}
          done++;
        }));
        const pct = Math.round((done / missing.length) * 100);
        onProgress(55 + Math.round(pct * 0.45), `Assets: ${done}/${missing.length}`);
      }
    }

    onProgress(100, 'Assets prêts');
  }
}

module.exports = FabricManager;

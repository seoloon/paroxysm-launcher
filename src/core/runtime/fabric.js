'use strict';
/**
 * Fabric Manager
 *
 * Installs Fabric via the official Fabric Meta API (no installer JAR needed).
 * Fabric provides a version.json directly — much simpler than Forge.
 *
 * API: https://meta.fabricmc.net/v2/versions/loader/{mcVersion}/{loaderVersion}/profile/json
 */

const fs   = require('fs');
const path = require('path');
const { downloadFile, fetchJSON } = require('../utils/download');
const Store = require('../utils/store');

const MC_DIR = path.join(Store.BASE_DIR, 'minecraft');
const FABRIC_META = 'https://meta.fabricmc.net/v2';

class FabricManager {
  static async ensure(mcVersion, loaderVersion, javaPath, onProgress = () => {}) {
    const versionId  = `fabric-loader-${loaderVersion}-${mcVersion}`;
    const versionDir = path.join(MC_DIR, 'versions', versionId);
    const versionJson = path.join(versionDir, `${versionId}.json`);

    if (fs.existsSync(versionJson)) {
      onProgress(100, `Fabric ${loaderVersion} déjà installé`);
      return versionId;
    }

    onProgress(10, `Téléchargement profil Fabric ${loaderVersion}...`);

    // Fetch the profile JSON from Fabric Meta
    const profileUrl = `${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`;
    const profile = await fetchJSON(profileUrl);

    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(versionJson, JSON.stringify(profile, null, 2));

    // Download libraries
    const libs = profile.libraries || [];
    onProgress(20, `Téléchargement de ${libs.length} bibliothèques Fabric...`);

    let done = 0;
    for (const lib of libs) {
      const parts = lib.name.split(':');
      const [group, artifact, version] = parts;
      const groupPath = group.replace(/\./g, path.sep);
      const jarName   = `${artifact}-${version}.jar`;
      const libPath   = path.join(MC_DIR, 'libraries', groupPath, artifact, version, jarName);

      if (!fs.existsSync(libPath)) {
        const url = lib.url
          ? `${lib.url}${groupPath}/${artifact}/${version}/${jarName}`
          : `https://maven.fabricmc.net/${groupPath}/${artifact}/${version}/${jarName}`;
        try {
          await downloadFile(url, libPath);
        } catch {
          // Non-fatal — some libraries may be on different mirrors
        }
      }

      done++;
      onProgress(20 + Math.round((done / libs.length) * 75), `Lib ${done}/${libs.length}: ${artifact}`);
    }

    onProgress(100, `Fabric ${loaderVersion} installé`);
    return versionId;
  }
}

module.exports = FabricManager;

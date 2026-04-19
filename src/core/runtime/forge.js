'use strict';
/**
 * Forge & NeoForge Manager — corrected version
 *
 * Key fixes vs previous:
 *  1. cwd set to MC_DIR (Forge installer uses cwd as default install target)
 *  2. --installClient receives the MC_DIR path quoted/clean
 *  3. Full stdout+stderr captured and forwarded so errors are visible
 *  4. On failure, the full log is included in the thrown error message
 *  5. Handles Windows path separators correctly
 *  6. Verifies the installer JAR is a valid ZIP before running it
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { downloadFile } = require('../utils/download');
const Store = require('../utils/store');

const MC_DIR      = path.join(Store.BASE_DIR, 'minecraft');
const FORGE_CACHE = path.join(Store.BASE_DIR, 'cache', 'modloaders');

class ForgeManager {
  static async ensure(mcVersion, loaderVersion, javaPath, onProgress = () => {}, loader = 'forge') {
    const versionId   = buildVersionId(loader, mcVersion, loaderVersion);
    const versionJson = path.join(MC_DIR, 'versions', versionId, `${versionId}.json`);

    if (fs.existsSync(versionJson)) {
      onProgress(100, `${loader} ${loaderVersion} déjà installé ✓`);
      return versionId;
    }

    fs.mkdirSync(FORGE_CACHE, { recursive: true });
    fs.mkdirSync(MC_DIR,      { recursive: true });

    // ── Download installer JAR ─────────────────────────────────────────────
    const installerUrl = buildInstallerUrl(loader, mcVersion, loaderVersion);
    const installerJar = path.join(FORGE_CACHE, `${versionId}-installer.jar`);

    if (!fs.existsSync(installerJar) || !isValidJar(installerJar)) {
      onProgress(5, `Téléchargement ${loaderLabel(loader)} ${loaderVersion}...`);
      // Remove potentially corrupt file
      try { fs.unlinkSync(installerJar); } catch {}

      await downloadFile(installerUrl, installerJar, pct => {
        onProgress(5 + Math.round(pct * 0.35), `${loaderLabel(loader)}: ${pct}%`);
      });

      if (!isValidJar(installerJar)) {
        try { fs.unlinkSync(installerJar); } catch {}
        throw new Error(`Le fichier téléchargé n'est pas un JAR valide.\nURL: ${installerUrl}`);
      }
    } else {
      onProgress(40, `Installer ${loaderLabel(loader)} déjà en cache`);
    }

    // ── Create launcher_profiles.json (required by Forge installer) ──────────
    // Forge checks for this file to confirm a valid Minecraft directory.
    // Without it the installer prints "you need to run the launcher first" and exits 1.
    ensureLauncherProfiles(MC_DIR);

    // ── Run installer ──────────────────────────────────────────────────────
    onProgress(40, `Lancement de l'installer ${loaderLabel(loader)}...`);
    onProgress(41, `(Cette étape peut prendre 3-10 minutes, Forge télécharge les bibliothèques Minecraft)`);

    const fullLog = await runInstaller(javaPath, installerJar, MC_DIR, (line, pct) => {
      onProgress(40 + Math.round(pct * 0.58), line.slice(0, 100));
    });

    // ── Verify installation succeeded ──────────────────────────────────────
    if (!fs.existsSync(versionJson)) {
      // Try alternate version ID formats Forge sometimes uses
      const alt1 = path.join(MC_DIR, 'versions', `${mcVersion}-forge${loaderVersion}`, `${mcVersion}-forge${loaderVersion}.json`);
      const alt2 = path.join(MC_DIR, 'versions', `${mcVersion}-forge-${loaderVersion}`, `${mcVersion}-forge-${loaderVersion}.json`);

      if (!fs.existsSync(alt1) && !fs.existsSync(alt2)) {
        // Installation failed — include last 20 lines of logs in error
        const logTail = fullLog.slice(-20).join('\n');
        throw new Error(
          `L'installer ${loaderLabel(loader)} a terminé mais le profil est introuvable.\n` +
          `Chemin attendu: ${versionJson}\n\n` +
          `Derniers logs Forge:\n${logTail}`
        );
      }
      // Return the actual version ID that was created
      if (fs.existsSync(alt1)) return path.basename(path.dirname(alt1));
      if (fs.existsSync(alt2)) return path.basename(path.dirname(alt2));
    }

    onProgress(100, `${loaderLabel(loader)} ${loaderVersion} installé ✓`);
    return versionId;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildVersionId(loader, mcVersion, loaderVersion) {
  if (loader === 'neoforge') return `${mcVersion}-neoforge-${loaderVersion}`;
  return `${mcVersion}-forge-${loaderVersion}`;
}

function buildInstallerUrl(loader, mcVersion, loaderVersion) {
  if (loader === 'neoforge') {
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }
  const full = `${mcVersion}-${loaderVersion}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
}

function loaderLabel(loader) {
  return loader === 'neoforge' ? 'NeoForge' : 'Forge';
}

/**
 * Create a minimal launcher_profiles.json that Forge installer requires.
 * The Forge installer checks for this file to confirm it's a valid MC directory.
 * It reads it, adds a "forge" profile entry, and rewrites it — so it must exist
 * and be valid JSON before the installer runs.
 */
function ensureLauncherProfiles(mcDir) {
  const profilesPath = path.join(mcDir, 'launcher_profiles.json');
  if (fs.existsSync(profilesPath)) {
    // Already exists — validate it's parseable JSON, reset if corrupt
    try { JSON.parse(fs.readFileSync(profilesPath, 'utf8')); return; } catch {}
  }
  fs.mkdirSync(mcDir, { recursive: true });
  const profiles = {
    profiles: {
      default: {
        name: 'Default',
        type: 'latest-release',
        lastUsed: new Date().toISOString(),
        lastVersionId: 'latest-release',
        icon: 'Grass',
      },
    },
    selectedProfile: 'default',
    clientToken: require('crypto').randomUUID(),
    authenticationDatabase: {},
    settings: { enableAdvanced: false, profileSorting: 'ByLastPlayed' },
    version: 3,
    launcherVersion: { name: '3.0.0', format: 21, profilesFormat: 3 },
  };
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
  console.log('[forge] Created launcher_profiles.json at', profilesPath);
}

/**
 * Check if a file is a valid ZIP/JAR by reading its magic bytes (PK\x03\x04).
 */
function isValidJar(filePath) {
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

/**
 * Run the Forge installer JAR.
 *
 * Critical details:
 *  - cwd MUST be MC_DIR: Forge reads/writes relative to the working directory
 *  - --installClient with the MC_DIR path makes the intent explicit
 *  - We collect all output for diagnostics
 *  - Progress is estimated from known log markers
 */
function runInstaller(javaPath, installerJar, mcDir, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const fullLog = [];
    let progressEstimate = 0;

    // Forge installer known log markers → rough progress mapping
    const MARKERS = [
      { text: 'Downloading minecraft client',      pct: 5  },
      { text: 'Downloading libraries',             pct: 15 },
      { text: 'Considering library',               pct: 20 },
      { text: 'Downloading library',               pct: 30 },
      { text: 'Extracting',                        pct: 60 },
      { text: 'Installing',                        pct: 70 },
      { text: 'Installed',                         pct: 85 },
      { text: 'Running forge installer',           pct: 10 },
      { text: 'Processors',                        pct: 50 },
      { text: 'Building Processor',                pct: 55 },
      { text: 'Task: DOWNLOAD_MOJMAPS',            pct: 25 },
      { text: 'Task: MERGE_MAPPING',               pct: 35 },
      { text: 'Task: DEOBF',                       pct: 45 },
      { text: 'Task: PATCH',                       pct: 65 },
      { text: 'Task: MCINJECT',                    pct: 75 },
      { text: 'Task: STRIP',                       pct: 80 },
      { text: 'Successfully installed',            pct: 100 },
    ];

    const handleData = (data) => {
      const text = data.toString();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      for (const line of lines) {
        fullLog.push(line);
        // Estimate progress from log content
        for (const marker of MARKERS) {
          if (line.toLowerCase().includes(marker.text.toLowerCase()) && marker.pct > progressEstimate) {
            progressEstimate = marker.pct;
          }
        }
        onLine(line, progressEstimate);
      }
    };

    const args = [
      '-jar', installerJar,
      '--installClient', mcDir,
    ];

    // On Windows, ensure no DISPLAY issues (headless mode)
    const env = {
      ...process.env,
      JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true',
    };

    console.log(`[forge] java: ${javaPath}`);
    console.log(`[forge] jar:  ${installerJar}`);
    console.log(`[forge] cwd:  ${mcDir}`);
    console.log(`[forge] mcDir arg: ${mcDir}`);

    const child = spawn(javaPath, args, {
      cwd: mcDir,      // ← CRITICAL: Forge uses cwd, not just the --installClient arg
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      reject(new Error(`Impossible de lancer Java: ${err.message}\nChemin Java: ${javaPath}`));
    });

    child.on('close', (code) => {
      console.log(`[forge] installer exited with code ${code}`);
      if (code === 0) {
        resolve(fullLog);
      } else {
        // Include last 30 lines in the error for diagnosis
        const tail = fullLog.slice(-30).join('\n');
        reject(new Error(
          `Forge installer a quitté avec le code ${code}\n\n` +
          `=== Derniers logs (${fullLog.length} lignes total) ===\n${tail}`
        ));
      }
    });
  });
}

module.exports = ForgeManager;

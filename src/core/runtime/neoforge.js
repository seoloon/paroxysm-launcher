'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { https } = require('follow-redirects');
const { downloadFile } = require('../utils/download');
const Store = require('../utils/store');

const MC_DIR = path.join(Store.BASE_DIR, 'minecraft');
const NEOFORGE_CACHE = path.join(Store.BASE_DIR, 'cache', 'modloaders');
const NEOFORGE_METADATA_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

class NeoForgeManager {
  static async getVersionsForMc(mcVersion) {
    const xml = await fetchXML(NEOFORGE_METADATA_URL);
    const all = parseXMLVersions(xml);
    const prefixes = buildNeoForgePrefixesForMc(mcVersion);

    let compatible = all.filter(v => prefixes.some(prefix => v.startsWith(prefix)));

    // Fallback when mc patch matching is too strict for a given train.
    if (!compatible.length) {
      const majorTrain = getNeoMajorTrain(mcVersion);
      if (majorTrain !== null) compatible = all.filter(v => v.startsWith(`${majorTrain}.`));
    }

    // Last fallback: expose all versions instead of returning an empty list.
    if (!compatible.length) compatible = all;

    return sortVersionsDesc(compatible);
  }

  static async ensure(mcVersion, loaderVersion, javaPath, onProgress = () => {}) {
    if (!loaderVersion) throw new Error('Version NeoForge manquante');

    const existingVersionId = resolveInstalledVersionId(mcVersion, loaderVersion);
    const alreadyInstalled = !!existingVersionId;
    if (alreadyInstalled) {
      onProgress(100, `NeoForge ${loaderVersion} déjà installé ✓`);
      return existingVersionId;
    }

    fs.mkdirSync(NEOFORGE_CACHE, { recursive: true });
    fs.mkdirSync(MC_DIR, { recursive: true });

    const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
    const installerJar = path.join(NEOFORGE_CACHE, `neoforge-${loaderVersion}-installer.jar`);

    if (!fs.existsSync(installerJar) || !isValidJar(installerJar)) {
      onProgress(5, `Téléchargement NeoForge ${loaderVersion}...`);
      try { fs.unlinkSync(installerJar); } catch {}
      await downloadFile(installerUrl, installerJar, pct => {
        onProgress(5 + Math.round(pct * 0.35), `NeoForge: ${pct}%`);
      });
      if (!isValidJar(installerJar)) {
        try { fs.unlinkSync(installerJar); } catch {}
        throw new Error(`Le fichier téléchargé n'est pas un JAR valide.\nURL: ${installerUrl}`);
      }
    }

    ensureLauncherProfiles(MC_DIR);

    onProgress(40, `Lancement de l'installer NeoForge...`);
    const fullLog = await runInstaller(javaPath, installerJar, MC_DIR, (line, pct) => {
      onProgress(40 + Math.round(pct * 0.58), line.slice(0, 100));
    });

    const resolvedVersionId = resolveInstalledVersionId(mcVersion, loaderVersion);
    if (!resolvedVersionId) {
      const tail = fullLog.slice(-25).join('\n');
      throw new Error(
        `NeoForge ${loaderVersion} semble avoir échoué.\n` +
        `Version attendue (candidats): ${buildCandidateVersionIds(mcVersion, loaderVersion).join(', ')}\n\n` +
        `Derniers logs:\n${tail}`
      );
    }

    onProgress(100, `NeoForge ${loaderVersion} installé ✓`);
    return resolvedVersionId;
  }
}

function resolveInstalledVersionId(mcVersion, loaderVersion) {
  const versionsRoot = path.join(MC_DIR, 'versions');
  const candidates = buildCandidateVersionIds(mcVersion, loaderVersion);

  for (const versionId of candidates) {
    const jsonPath = path.join(versionsRoot, versionId, `${versionId}.json`);
    if (fs.existsSync(jsonPath)) return versionId;
  }

  if (!fs.existsSync(versionsRoot)) return null;

  const matches = fs.readdirSync(versionsRoot)
    .filter(dir => /neoforge/i.test(dir))
    .map(dir => {
      const jsonPath = path.join(versionsRoot, dir, `${dir}.json`);
      if (!fs.existsSync(jsonPath)) return null;
      const profile = readVersionJsonSafe(jsonPath);
      const profileMc = inferMcVersion(profile, dir);
      const profileLoader = inferNeoForgeVersion(profile, dir);
      const mcMatches = profileMc ? profileMc === mcVersion : dir.startsWith(`${mcVersion}-`);
      const loaderMatches = profileLoader ? profileLoader === loaderVersion : dir.includes(loaderVersion);
      if (!mcMatches || !loaderMatches) return null;
      const stat = fs.statSync(jsonPath);
      const exactCandidate = candidates.includes(dir);
      return { dir, exactCandidate, mtime: stat.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.exactCandidate !== b.exactCandidate) return a.exactCandidate ? -1 : 1;
      return b.mtime - a.mtime;
    });

  return matches[0]?.dir || null;
}

function buildCandidateVersionIds(mcVersion, loaderVersion) {
  return [
    `${mcVersion}-neoforge-${loaderVersion}`,
    `neoforge-${loaderVersion}`,
  ];
}

function getNeoMajorTrain(mcVersion) {
  const parts = String(mcVersion || '').split('.').map(v => parseInt(v, 10));
  if (parts[0] === 1 && Number.isFinite(parts[1])) return parts[1];
  if (Number.isFinite(parts[0])) return parts[0];
  return null;
}

function buildNeoForgePrefixesForMc(mcVersion) {
  const parts = String(mcVersion || '').split('.').map(v => parseInt(v, 10));
  const prefixes = [];

  // MC 1.x.y => NeoForge x.y.z (1 is omitted)
  if (parts[0] === 1 && Number.isFinite(parts[1])) {
    const minor = parts[1];
    const patch = Number.isFinite(parts[2]) ? parts[2] : 0;
    prefixes.push(`${minor}.${patch}.`);
    prefixes.push(`${minor}.`);
    return prefixes;
  }

  // MC 26.1+ era keeps major train semantics close to Minecraft.
  if (Number.isFinite(parts[0])) {
    const major = parts[0];
    const release = Number.isFinite(parts[1]) ? parts[1] : 0;
    prefixes.push(`${major}.${release}.`);
    prefixes.push(`${major}.`);
  }
  return prefixes;
}

function sortVersionsDesc(versions) {
  return [...new Set(versions)].sort((a, b) => compareVersionLike(b, a));
}

function compareVersionLike(a, b) {
  const tokenize = (v) => String(v)
    .replace(/-/g, '.')
    .split('.')
    .map(part => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) && String(n) === part ? n : part.toLowerCase();
    });

  const aa = tokenize(a);
  const bb = tokenize(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const x = aa[i];
    const y = bb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
      continue;
    }
    if (typeof x === 'number') return 1;
    if (typeof y === 'number') return -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parseXMLVersions(xml) {
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)];
  return matches.map(m => m[1].trim()).filter(Boolean);
}

function readVersionJsonSafe(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function inferMcVersion(profile, dirName) {
  if (profile?.inheritsFrom) return String(profile.inheritsFrom);
  const fromArgs = extractNamedArg(profile?.arguments?.game, '--fml.mcVersion');
  if (fromArgs) return fromArgs;
  const m = String(dirName).match(/^(\d+\.\d+(?:\.\d+)?)-/);
  return m ? m[1] : '';
}

function inferNeoForgeVersion(profile, dirName) {
  const fromArgs = extractNamedArg(profile?.arguments?.game, '--fml.neoForgeVersion');
  if (fromArgs) return fromArgs;
  const m = String(dirName).match(/neoforge[-_]([0-9][\w.+-]*)/i);
  return m ? m[1] : '';
}

function extractNamedArg(gameArgs, argName) {
  if (!Array.isArray(gameArgs)) return '';
  for (let i = 0; i < gameArgs.length - 1; i++) {
    if (gameArgs[i] === argName) return String(gameArgs[i + 1] || '');
  }
  return '';
}

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'PaROXYSM-Launcher/1.0' },
      maxRedirects: 10,
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function ensureLauncherProfiles(mcDir) {
  const profilesPath = path.join(mcDir, 'launcher_profiles.json');
  if (fs.existsSync(profilesPath)) {
    try { JSON.parse(fs.readFileSync(profilesPath, 'utf8')); return; } catch {}
  }
  const crypto = require('crypto');
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
    clientToken: crypto.randomUUID(),
    authenticationDatabase: {},
    settings: { enableAdvanced: false, profileSorting: 'ByLastPlayed' },
    version: 3,
    launcherVersion: { name: '3.0.0', format: 21, profilesFormat: 3 },
  };
  fs.mkdirSync(mcDir, { recursive: true });
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
}

function isValidJar(filePath) {
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4B;
  } catch {
    return false;
  }
}

function runInstaller(javaPath, installerJar, mcDir, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const fullLog = [];
    let progressEstimate = 0;
    const MARKERS = [
      { text: 'Downloading minecraft client', pct: 5 },
      { text: 'Downloading libraries', pct: 15 },
      { text: 'Considering library', pct: 20 },
      { text: 'Downloading library', pct: 30 },
      { text: 'Extracting', pct: 60 },
      { text: 'Installing', pct: 70 },
      { text: 'Installed', pct: 85 },
      { text: 'Running', pct: 10 },
      { text: 'Processors', pct: 50 },
      { text: 'Task: PATCH', pct: 65 },
      { text: 'Successfully installed', pct: 100 },
    ];

    const handleData = (data) => {
      const lines = data.toString().split(/\r?\n/).filter(l => l.trim());
      for (const line of lines) {
        fullLog.push(line);
        for (const marker of MARKERS) {
          if (line.toLowerCase().includes(marker.text.toLowerCase()) && marker.pct > progressEstimate) {
            progressEstimate = marker.pct;
          }
        }
        onLine(line, progressEstimate);
      }
    };

    const child = spawn(javaPath, ['-jar', installerJar, '--installClient', mcDir], {
      cwd: mcDir,
      env: { ...process.env, JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);
    child.on('error', (err) => reject(new Error(`Impossible de lancer Java: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(fullLog);
      else reject(new Error(`NeoForge installer exited with code ${code}\n${fullLog.slice(-30).join('\n')}`));
    });
  });
}

module.exports = NeoForgeManager;

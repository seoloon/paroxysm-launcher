'use strict';
/**
 * Java Manager — Adoptium API
 *
 * Bugs corrigés vs version précédente :
 *
 *  1. requiredJavaMajor() lisait uniquement le minor de la version MC (1.X.Y)
 *     et renvoyait des valeurs fausses. MC 1.21 avec Fabric 0.16+ nécessite
 *     Java 21, pas 21 "par hasard" — on lit maintenant javaVersion.majorVersion
 *     dans le version.json Mojang (source de vérité officielle).
 *
 *  2. findEmbedded() retournait un binaire sans vérifier qu'il correspond au
 *     major demandé → retournait Java 8 quand le dossier java/8/ existait,
 *     peu importe la version réelle du binaire dedans.
 *     → On vérifie maintenant avec getJavaMajorVersion() et on nettoie le
 *       dossier corrompu pour forcer un re-téléchargement.
 *
 *  3. findSystem() utilisait === strict → passait à côté de versions compatibles
 *     supérieures. Java 21 peut faire tourner du code compilé pour Java 17.
 *     → On accepte v >= requiredMajor, avec préférence au plus proche.
 *
 *  4. Apple Silicon (arm64) + Java 8 → force x64 (Rosetta 2).
 *
 *  5. macOS binary path handled correctly (Contents/Home/bin/java).
 */

const fs       = require('fs');
const path     = require('path');
const { execFile, spawn } = require('child_process');
const extract  = require('extract-zip');
const { downloadFile } = require('../utils/download');
const Store    = require('../utils/store');

const JAVA_BASE    = path.join(Store.BASE_DIR, 'java');
const ADOPTIUM_API = 'https://api.adoptium.net/v3/binary/latest';

const OS_MAP   = { win32: 'windows', linux: 'linux', darwin: 'mac' };
const ARCH_MAP = { x64: 'x64', arm64: 'aarch64', ia32: 'x86', arm: 'arm' };

// Fallback table used only when Mojang profile has no javaVersion field.
// Keyed on MC minor version (the "X" in 1.X.Y).
const JAVA_FALLBACK_TABLE = [
  [0,  16,  8],
  [17, 17, 16],
  [18, 20, 17],
  [21, 99, 21],
];

class JavaManager {
  /**
   * @param {string}      mcVersion      e.g. "1.21.1"
   * @param {function}    onProgress     (pct, detail) => void
   * @param {object|null} vanillaProfile Parsed Mojang version.json — used to
   *                                     read javaVersion.majorVersion.
   *                                     Pass it whenever you have it to avoid
   *                                     the "wrong Java version" bug.
   */
  static async ensureJava(mcVersion, onProgress = () => {}, vanillaProfile = null) {
    const major = requiredJavaMajor(mcVersion, vanillaProfile);
    onProgress(0, `Java ${major} requis pour Minecraft ${mcVersion}...`);
    console.log(`[java] requiredJavaMajor(${mcVersion}, profile=${!!vanillaProfile}) = ${major}`);

    const embedded = await findEmbedded(major);
    if (embedded) {
      onProgress(100, `Java ${major} trouvé (cache launcher)`);
      console.log(`[java] embedded ✓ ${embedded}`);
      return embedded;
    }

    const system = await findSystem(major);
    if (system) {
      onProgress(100, `Java ${major} trouvé (système) : ${system}`);
      console.log(`[java] system ✓ ${system}`);
      return system;
    }

    console.log(`[java] downloading Java ${major}...`);
    const javaPath = await JavaManager._download(major, onProgress);
    onProgress(100, `Java ${major} installé`);
    return javaPath;
  }

  static async _download(major, onProgress = () => {}) {
    const platform = process.platform;
    let arch       = process.arch;
    const osName   = OS_MAP[platform];
    if (!osName) throw new Error(`Plateforme non supportée : ${platform}`);

    // Apple Silicon + Java 8 → Rosetta
    if (platform === 'darwin' && arch === 'arm64' && major <= 8) {
      console.log('[java] Apple Silicon + Java 8 → forcing x64 (Rosetta 2)');
      arch = 'x64';
    }

    const archName = ARCH_MAP[arch] || 'x64';
    const apiUrl   = `${ADOPTIUM_API}/${major}/ga/${osName}/${archName}/jre/hotspot/normal/eclipse`;
    onProgress(0, `Téléchargement Java ${major} ${archName} (Adoptium)...`);
    console.log(`[java] Adoptium URL: ${apiUrl}`);

    const isWindows = platform === 'win32';
    const ext       = isWindows ? '.zip' : '.tar.gz';
    const tmpFile   = path.join(JAVA_BASE, `java${major}_download${ext}`);
    const destDir   = path.join(JAVA_BASE, String(major));

    fs.mkdirSync(JAVA_BASE, { recursive: true });
    // Wipe destination to avoid cross-contamination from a previous failed download
    try { if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(destDir, { recursive: true });

    try {
      await downloadFile(apiUrl, tmpFile, pct => {
        onProgress(Math.round(pct * 0.75), `Java ${major} : ${pct}%`);
      });
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch {}
      throw new Error(`Impossible de télécharger Java ${major} : ${e.message}`);
    }

    onProgress(75, 'Extraction de Java...');

    if (isWindows) {
      try { await extract(tmpFile, { dir: destDir }); }
      catch (e) {
        try { fs.unlinkSync(tmpFile); } catch {}
        throw new Error(`Extraction Java échouée : ${e.message}`);
      }
    } else {
      await new Promise((resolve, reject) => {
        const tar = spawn('tar', ['-xzf', tmpFile, '-C', destDir]);
        let stderr = '';
        tar.stderr.on('data', d => { stderr += d.toString(); });
        tar.on('close', code => code === 0 ? resolve() : reject(new Error(`tar (${code}): ${stderr}`)));
        tar.on('error', reject);
      });
    }

    try { fs.unlinkSync(tmpFile); } catch {}

    onProgress(92, 'Vérification du binaire Java...');
    const bin = findJavaBin(destDir);
    if (!bin) {
      const listing = listDeep(destDir, 3);
      throw new Error(`Binaire Java introuvable après extraction.\nContenu :\n${listing}`);
    }

    // Hard verify: make sure what we downloaded is actually the right major
    try {
      const actualMajor = await getJavaMajorVersion(bin);
      if (actualMajor !== major) {
        throw new Error(
          `Le binaire téléchargé est Java ${actualMajor}, attendu Java ${major}.\n` +
          `URL Adoptium: ${apiUrl}`
        );
      }
      console.log(`[java] download verified: Java ${actualMajor} at ${bin}`);
    } catch (e) {
      if (e.message.includes('attendu Java')) throw e;
      console.warn(`[java] could not verify downloaded binary (non-fatal): ${e.message}`);
    }

    try { if (!isWindows) fs.chmodSync(bin, '755'); } catch {}
    return bin;
  }
}

// ── requiredJavaMajor ─────────────────────────────────────────────────────────

function requiredJavaMajor(mcVersion, vanillaProfile = null) {
  // 1st priority: Mojang's official field in the version.json
  //   e.g. MC 1.21.x has { "javaVersion": { "majorVersion": 21 } }
  //   e.g. MC 1.20.x has { "javaVersion": { "majorVersion": 17 } }
  if (vanillaProfile?.javaVersion?.majorVersion) {
    const v = parseInt(vanillaProfile.javaVersion.majorVersion, 10);
    if (!isNaN(v) && v > 0) {
      console.log(`[java] Mojang javaVersion.majorVersion = ${v}`);
      return v;
    }
  }

  // 2nd: fallback table from MC minor version
  const minor = parseInt((mcVersion || '1.21').split('.')[1] || '0', 10);
  for (const [min, max, javaMaj] of JAVA_FALLBACK_TABLE) {
    if (minor >= min && minor <= max) {
      console.log(`[java] fallback table: MC 1.${minor} → Java ${javaMaj}`);
      return javaMaj;
    }
  }

  console.log('[java] default fallback: Java 21');
  return 21;
}

// ── findEmbedded ──────────────────────────────────────────────────────────────

async function findEmbedded(major) {
  const dir = path.join(JAVA_BASE, String(major));
  if (!fs.existsSync(dir)) return null;

  const bin = findJavaBin(dir);
  if (!bin) return null;

  try {
    const actual = await getJavaMajorVersion(bin);
    if (actual !== major) {
      console.warn(`[java] Embedded mismatch: found Java ${actual} in java/${major}/ — cleaning up`);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      return null;
    }
    return bin;
  } catch (e) {
    console.warn(`[java] Could not verify embedded binary ${bin}: ${e.message}`);
    return null;
  }
}

// ── findSystem ────────────────────────────────────────────────────────────────

async function findSystem(requiredMajor) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];

  if (process.env.JAVA_HOME)
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', binName));

  if (process.platform === 'win32') {
    candidates.push('java');
    for (const base of [
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Zulu',
    ]) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base))
        candidates.push(path.join(base, d, 'bin', 'java.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/usr/bin/java', '/usr/local/bin/java');
    for (const base of [
      '/Library/Java/JavaVirtualMachines',
      `${process.env.HOME}/.sdkman/candidates/java`,
    ]) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base)) {
        for (const suffix of ['Contents/Home/bin/java', 'bin/java']) {
          candidates.push(path.join(base, d, suffix));
        }
      }
    }
  } else {
    candidates.push('java', '/usr/bin/java', '/usr/local/bin/java');
    for (const base of ['/usr/lib/jvm', '/opt/java', '/opt/jdk']) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base))
        candidates.push(path.join(base, d, 'bin', 'java'));
    }
  }

  // Gather all candidates that satisfy the minimum requirement
  const valid = [];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = await getJavaMajorVersion(c);
      if (v >= requiredMajor) valid.push({ path: c, version: v });
    } catch {}
  }

  if (!valid.length) return null;

  // Prefer exact match, then lowest compatible
  valid.sort((a, b) => a.version - b.version);
  const exact   = valid.find(x => x.version === requiredMajor);
  const chosen  = exact || valid[0];

  if (chosen.version !== requiredMajor) {
    console.log(`[java] System: no exact Java ${requiredMajor}, using Java ${chosen.version} (compatible)`);
  }
  return chosen.path;
}

// ── findJavaBin ───────────────────────────────────────────────────────────────

function findJavaBin(rootDir) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const isMac   = process.platform === 'darwin';

  if (isMac) {
    const md = path.join(rootDir, 'Contents', 'Home', 'bin', binName);
    if (fs.existsSync(md)) return md;
  }
  const direct = path.join(rootDir, 'bin', binName);
  if (fs.existsSync(direct)) return direct;

  try {
    for (const sub of fs.readdirSync(rootDir)) {
      const subPath = path.join(rootDir, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;

      if (isMac) {
        const mp = path.join(subPath, 'Contents', 'Home', 'bin', binName);
        if (fs.existsSync(mp)) return mp;
      }
      const sp = path.join(subPath, 'bin', binName);
      if (fs.existsSync(sp)) return sp;

      try {
        for (const sub2 of fs.readdirSync(subPath)) {
          const dp = path.join(subPath, sub2, 'bin', binName);
          if (fs.existsSync(dp)) return dp;
          if (isMac) {
            const dmp = path.join(subPath, sub2, 'Contents', 'Home', 'bin', binName);
            if (fs.existsSync(dmp)) return dmp;
          }
        }
      } catch {}
    }
  } catch {}

  return null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getJavaMajorVersion(javaPath) {
  return new Promise((resolve, reject) => {
    execFile(javaPath, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      const out = stderr || stdout || '';
      const m = out.match(/version "(?:1\.)?(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
      else reject(new Error(`Cannot parse java version: ${out.slice(0, 120)}`));
    });
  });
}

function listDeep(dir, depth) {
  if (depth <= 0 || !fs.existsSync(dir)) return '';
  try {
    return fs.readdirSync(dir).map(f => {
      const full  = path.join(dir, f);
      const isDir = fs.statSync(full).isDirectory();
      return `  ${f}${isDir ? '/' : ''}\n${isDir ? listDeep(full, depth - 1).split('\n').map(l => '  ' + l).join('\n') : ''}`;
    }).join('');
  } catch { return ''; }
}

module.exports = JavaManager;

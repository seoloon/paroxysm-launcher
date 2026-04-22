'use strict';
/**
 * Java Manager — Adoptium API
 *
 * Fixes:
 *  1. Apple Silicon (arm64) + Java 8 → force x64, let Rosetta handle it.
 *     Adoptium doesn't ship Java 8 for aarch64/mac.
 *  2. macOS binary path: Adoptium tar.gz on macOS extracts to
 *     jdk-XX.Y.Z+N/Contents/Home/bin/java  (NOT jdk-.../bin/java)
 *  3. (Bug was in launcher.js, fixed separately)
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

class JavaManager {
  static async ensureJava(mcVersion, onProgress = () => {}) {
    const major = requiredJavaMajor(mcVersion);
    onProgress(0, `Java ${major} requis pour Minecraft ${mcVersion}...`);

    const embedded = findEmbedded(major);
    if (embedded) { onProgress(100, `Java ${major} trouvé (cache launcher)`); return embedded; }

    const system = await findSystem(major);
    if (system) { onProgress(100, `Java ${major} trouvé (système) : ${system}`); return system; }

    const javaPath = await JavaManager._download(major, onProgress);
    onProgress(100, `Java ${major} installé`);
    return javaPath;
  }

  static async _download(major, onProgress = () => {}) {
    const platform = process.platform;
    let arch       = process.arch;
    const osName   = OS_MAP[platform];
    if (!osName) throw new Error(`Plateforme non supportée : ${platform}`);

    // ── Fix 1: Apple Silicon + Java 8 ────────────────────────────────────────
    // Adoptium ne publie pas Java 8 pour mac/aarch64.
    // On force x64 et on laisse Rosetta 2 gérer la traduction.
    if (platform === 'darwin' && arch === 'arm64' && major <= 8) {
      console.log('[java] Apple Silicon + Java 8 → forcing x64 (Rosetta 2)');
      arch = 'x64';
    }

    const archName = ARCH_MAP[arch] || 'x64';
    const apiUrl   = `${ADOPTIUM_API}/${major}/ga/${osName}/${archName}/jre/hotspot/normal/eclipse`;
    onProgress(0, `Téléchargement Java ${major} ${archName} (Adoptium)...`);

    const isWindows = platform === 'win32';
    const isMac     = platform === 'darwin';
    const ext       = isWindows ? '.zip' : '.tar.gz';
    const tmpFile   = path.join(JAVA_BASE, `java${major}_download${ext}`);
    const destDir   = path.join(JAVA_BASE, String(major));

    fs.mkdirSync(JAVA_BASE, { recursive: true });
    fs.mkdirSync(destDir,   { recursive: true });

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
      catch (e) { try { fs.unlinkSync(tmpFile); } catch {}; throw new Error(`Extraction Java échouée : ${e.message}`); }
    } else {
      // ── Fix 2: tar extraction sans --strip-components ─────────────────────
      // On extrait avec la structure complète (avec le dossier jdk-XX.Y.Z+N/).
      // findJavaBin() descend ensuite dans la hiérarchie pour trouver le binaire,
      // y compris la structure macOS : jdk-.../Contents/Home/bin/java
      await new Promise((resolve, reject) => {
        const tar = spawn('tar', ['-xzf', tmpFile, '-C', destDir]);
        let stderr = '';
        tar.stderr.on('data', d => { stderr += d.toString(); });
        tar.on('close', code => { code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${stderr}`)); });
        tar.on('error', reject);
      });
    }

    try { fs.unlinkSync(tmpFile); } catch {}

    onProgress(95, 'Localisation du binaire Java...');
    const bin = findJavaBin(destDir);
    if (!bin) {
      const listing = listDeep(destDir, 3);
      throw new Error(`Binaire Java introuvable après extraction.\nContenu :\n${listing}`);
    }

    try { if (!isWindows) fs.chmodSync(bin, '755'); } catch {}
    return bin;
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function requiredJavaMajor(mcVersion) {
  const minor = parseInt((mcVersion.split('.')[1] || '0'), 10);
  if (minor <= 16) return 8;
  if (minor <= 20) return 17;
  return 21;
}

function findEmbedded(major) {
  const dir = path.join(JAVA_BASE, String(major));
  if (!fs.existsSync(dir)) return null;
  return findJavaBin(dir);
}

async function findSystem(requiredMajor) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];

  if (process.env.JAVA_HOME)
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', binName));

  if (process.platform === 'win32') {
    candidates.push('java');
    for (const base of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']) {
      if (fs.existsSync(base))
        for (const d of fs.readdirSync(base))
          candidates.push(path.join(base, d, 'bin', 'java.exe'));
    }
  } else if (process.platform === 'darwin') {
    // macOS system Java via java_home
    candidates.push('java', '/usr/bin/java', '/usr/local/bin/java');
    // Homebrew / SDKMAN / manually installed
    for (const base of [
      '/Library/Java/JavaVirtualMachines',
      `${process.env.HOME}/.sdkman/candidates/java`,
    ]) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base)) {
        // macOS JDK layout: JDK.jdk/Contents/Home/bin/java
        for (const suffix of ['Contents/Home/bin/java', 'bin/java']) {
          candidates.push(path.join(base, d, suffix));
        }
      }
    }
  } else {
    candidates.push('java', '/usr/bin/java', '/usr/local/bin/java');
    for (const base of ['/usr/lib/jvm', '/opt/java']) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base))
        candidates.push(path.join(base, d, 'bin', 'java'));
    }
  }

  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = await getJavaMajorVersion(c);
      if (v === requiredMajor) return c;
    } catch {}
  }
  return null;
}

/**
 * Find java binary inside a root dir.
 * Handles:
 *  - Windows zip:  rootDir/jdk-XX.Y.Z+N/bin/java.exe
 *  - Linux tar:    rootDir/jdk-XX.Y.Z+N/bin/java   (with or without strip)
 *  - macOS tar:    rootDir/jdk-XX.Y.Z+N/Contents/Home/bin/java
 *                  rootDir/jdk-XX.Y.Z+N.jdk/Contents/Home/bin/java
 */
function findJavaBin(rootDir) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const isMac   = process.platform === 'darwin';

  // Check direct (after --strip-components=1 or pre-extracted)
  if (isMac) {
    const macDirect = path.join(rootDir, 'Contents', 'Home', 'bin', binName);
    if (fs.existsSync(macDirect)) return macDirect;
  }
  const direct = path.join(rootDir, 'bin', binName);
  if (fs.existsSync(direct)) return direct;

  // One or two levels deep
  try {
    for (const sub of fs.readdirSync(rootDir)) {
      const subPath = path.join(rootDir, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;

      // macOS layout: sub/Contents/Home/bin/java  or  sub.jdk/Contents/Home/bin/java
      if (isMac) {
        const macPath = path.join(subPath, 'Contents', 'Home', 'bin', binName);
        if (fs.existsSync(macPath)) return macPath;
      }

      // Standard layout: sub/bin/java
      const standard = path.join(subPath, 'bin', binName);
      if (fs.existsSync(standard)) return standard;

      // Go one level deeper (e.g. sub/jre/bin/java for JDK bundles)
      try {
        for (const sub2 of fs.readdirSync(subPath)) {
          const deep = path.join(subPath, sub2, 'bin', binName);
          if (fs.existsSync(deep)) return deep;
        }
      } catch {}
    }
  } catch {}

  return null;
}

function listDeep(dir, depth) {
  if (depth <= 0 || !fs.existsSync(dir)) return '';
  try {
    return fs.readdirSync(dir).map(f => {
      const full = path.join(dir, f);
      const isDir = fs.statSync(full).isDirectory();
      return `  ${f}${isDir ? '/' : ''}\n${isDir ? listDeep(full, depth - 1).split('\n').map(l => '  ' + l).join('\n') : ''}`;
    }).join('');
  } catch { return ''; }
}

function getJavaMajorVersion(javaPath) {
  return new Promise((resolve, reject) => {
    execFile(javaPath, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      const out = stderr || stdout || '';
      const m = out.match(/version "(?:1\.)?(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
      else reject(new Error(`Cannot parse version: ${out.slice(0, 100)}`));
    });
  });
}

module.exports = JavaManager;

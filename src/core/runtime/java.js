'use strict';
/**
 * Java Manager — uses the Adoptium API to always fetch the latest JRE.
 *
 * API endpoint (no hardcoded version numbers ever again):
 *   https://api.adoptium.net/v3/binary/latest/{major}/ga/{os}/{arch}/jre/hotspot/normal/eclipse
 *
 * This URL does a redirect to the actual binary download, which follow-redirects handles.
 *
 * OS mapping:   win32 → windows | linux → linux | darwin → mac
 * Arch mapping: x64 → x64 | arm64 → aarch64 | ia32 → x86
 *
 * Java version matrix:
 *   MC ≤ 1.16  → Java 8
 *   MC 1.17    → Java 17   (16 is EOL, Mojang now recommends 17)
 *   MC 1.18–1.20 → Java 17
 *   MC 1.21+   → Java 21
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const { execFile } = require('child_process');
const extract  = require('extract-zip');
const { downloadFile } = require('../utils/download');
const Store    = require('../utils/store');

const JAVA_BASE    = path.join(Store.BASE_DIR, 'java');
const ADOPTIUM_API = 'https://api.adoptium.net/v3/binary/latest';

// Translate Node platform/arch to Adoptium API names
const OS_MAP   = { win32: 'windows', linux: 'linux', darwin: 'mac' };
const ARCH_MAP = { x64: 'x64', arm64: 'aarch64', ia32: 'x86', arm: 'arm' };

class JavaManager {
  /**
   * Ensure correct Java is available for a given MC version.
   * Returns the path to the java(.exe) binary.
   */
  static async ensureJava(mcVersion, onProgress = () => {}) {
    const major = requiredJavaMajor(mcVersion);
    onProgress(0, `Java ${major} requis pour Minecraft ${mcVersion}...`);

    // 1. Already embedded in launcher data dir?
    const embedded = findEmbedded(major);
    if (embedded) {
      onProgress(100, `Java ${major} trouvé (cache launcher)`);
      return embedded;
    }

    // 2. System Java of the right major version?
    const system = await findSystem(major);
    if (system) {
      onProgress(100, `Java ${major} trouvé (système) : ${system}`);
      return system;
    }

    // 3. Download via Adoptium API
    const javaPath = await JavaManager._download(major, onProgress);
    onProgress(100, `Java ${major} installé`);
    return javaPath;
  }

  static async _download(major, onProgress = () => {}) {
    const platform = process.platform;
    const arch     = process.arch;
    const osName   = OS_MAP[platform];
    const archName = ARCH_MAP[arch] || 'x64';

    if (!osName) throw new Error(`Plateforme non supportée : ${platform}`);

    // Build the Adoptium API URL — this redirects to the actual file
    const apiUrl = `${ADOPTIUM_API}/${major}/ga/${osName}/${archName}/jre/hotspot/normal/eclipse`;
    onProgress(0, `Téléchargement Java ${major} (Adoptium)...`);

    const isWindows = platform === 'win32';
    const ext       = isWindows ? '.zip' : '.tar.gz';
    const tmpFile   = path.join(JAVA_BASE, `java${major}_download${ext}`);
    const destDir   = path.join(JAVA_BASE, String(major));

    fs.mkdirSync(JAVA_BASE, { recursive: true });
    fs.mkdirSync(destDir,   { recursive: true });

    // Download (follow-redirects will follow the 302 from Adoptium to GitHub/CDN)
    try {
      await downloadFile(apiUrl, tmpFile, pct => {
        onProgress(Math.round(pct * 0.75), `Java ${major} : ${pct}%`);
      });
    } catch (e) {
      // Clean up partial download
      try { fs.unlinkSync(tmpFile); } catch {}
      throw new Error(`Impossible de télécharger Java ${major} : ${e.message}\nVérifiez votre connexion internet.`);
    }

    onProgress(75, 'Extraction de Java...');

    if (isWindows) {
      // ZIP extraction (Windows)
      try {
        await extract(tmpFile, { dir: destDir });
      } catch (e) {
        try { fs.unlinkSync(tmpFile); } catch {}
        throw new Error(`Extraction Java échouée : ${e.message}`);
      }
    } else {
      // tar.gz extraction (Linux / macOS)
      await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const tar = spawn('tar', ['-xzf', tmpFile, '-C', destDir, '--strip-components=1']);
        let stderr = '';
        tar.stderr.on('data', d => { stderr += d.toString(); });
        tar.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`tar failed (code ${code}): ${stderr}`));
        });
        tar.on('error', reject);
      });
    }

    // Clean up archive
    try { fs.unlinkSync(tmpFile); } catch {}

    onProgress(95, 'Localisation du binaire Java...');
    const bin = findJavaBin(destDir);
    if (!bin) {
      throw new Error(
        `Binaire Java introuvable après extraction dans : ${destDir}\n` +
        `Contenu : ${fs.readdirSync(destDir).join(', ')}`
      );
    }

    if (platform !== 'win32') {
      try { fs.chmodSync(bin, '755'); } catch {}
    }

    return bin;
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function requiredJavaMajor(mcVersion) {
  const parts = mcVersion.split('.');
  const minor = parseInt(parts[1] || '0', 10);
  if (minor <= 16) return 8;   // MC 1.16 and older
  if (minor <= 20) return 17;  // MC 1.17–1.20 (Java 16 is EOL, 17 is LTS and works)
  return 21;                   // MC 1.21+
}

function findEmbedded(major) {
  const dir = path.join(JAVA_BASE, String(major));
  if (!fs.existsSync(dir)) return null;
  return findJavaBin(dir);
}

async function findSystem(requiredMajor) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';

  // Build candidate list: JAVA_HOME first, then PATH defaults
  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', binName));
  }
  // Common system locations
  if (process.platform === 'win32') {
    candidates.push('java'); // rely on PATH
    // Common Windows install paths
    const javaBase = 'C:\\Program Files\\Eclipse Adoptium';
    if (fs.existsSync(javaBase)) {
      for (const dir of fs.readdirSync(javaBase)) {
        candidates.push(path.join(javaBase, dir, 'bin', 'java.exe'));
      }
    }
    const javaBase2 = 'C:\\Program Files\\Java';
    if (fs.existsSync(javaBase2)) {
      for (const dir of fs.readdirSync(javaBase2)) {
        candidates.push(path.join(javaBase2, dir, 'bin', 'java.exe'));
      }
    }
  } else {
    candidates.push('java', '/usr/bin/java', '/usr/local/bin/java');
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const version = await getJavaMajorVersion(candidate);
      if (version === requiredMajor) return candidate;
    } catch {
      // Not found or wrong version — continue
    }
  }
  return null;
}

function findJavaBin(rootDir) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';

  // Direct: rootDir/bin/java
  const direct = path.join(rootDir, 'bin', binName);
  if (fs.existsSync(direct)) return direct;

  // One level deep: rootDir/jdk-17.0.x+y/bin/java  (zip layout)
  try {
    for (const sub of fs.readdirSync(rootDir)) {
      const candidate = path.join(rootDir, sub, 'bin', binName);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}

  return null;
}

function getJavaMajorVersion(javaPath) {
  return new Promise((resolve, reject) => {
    execFile(javaPath, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      const output = stderr || stdout || '';
      // Handles both "1.8.0_xxx" and "17.0.x" style version strings
      const m = output.match(/version "(?:1\.)?(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
      else reject(new Error(`Cannot parse java version from: ${output.slice(0, 100)}`));
    });
  });
}

module.exports = JavaManager;

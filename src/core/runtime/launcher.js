'use strict';
/**
 * GameLauncher — approche correcte pour Forge 1.17+
 *
 * Forge 1.17+ utilise le système de modules Java (JPMS) via bootstraplauncher.
 * Son version.json contient des arguments JVM précis avec -p (module path),
 * --add-modules, --add-opens, etc.
 *
 * Règle absolue : ne PAS construire notre propre classpath ou module path.
 * On résout uniquement les variables (${classpath}, ${library_directory}…)
 * dans les arguments que Forge a lui-même définis.
 *
 * Le classpath qu'on passe via ${classpath} correspond aux "ignoreList" JARs
 * que Forge exclut du module path (bootstraplauncher, asm, etc.).
 */

const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');
const Store = require('../utils/store');
const MinecraftManager = require('./minecraft');

const MC_BASE      = path.join(Store.BASE_DIR, 'minecraft');
const VERSIONS_DIR = path.join(MC_BASE, 'versions');
const LIBS_DIR     = path.join(MC_BASE, 'libraries');
const ASSETS_DIR   = path.join(MC_BASE, 'assets');

class GameLauncher {
  static async launch(opts) {
    const {
      entry, javaPath, profile, accessToken, uuid, ram, offline, offlineName,
      fullscreen = false, width = 1280, height = 720, extraJvmArgs = [], extraEnv = {},
    } = opts;
    const versionId = entry.versionId;
    const mcVersion = entry.mcVersion;

    sanitizeModsDir(entry.modsDir, mcVersion);
    fs.mkdirSync(entry.gameDir, { recursive: true });
    // Some modpacks ship config files with read-only attributes on Windows.
    // Sodium writes to config/sodium-options.json at startup and crashes otherwise.
    ensureWritableRuntimeFiles(entry.gameDir);

    // ── Load version JSONs ────────────────────────────────────────────────────
    const loaderJson  = loadVersionJson(versionId);
    const vanillaJson = loaderJson.inheritsFrom ? loadVersionJson(loaderJson.inheritsFrom) : {};
    const merged      = mergeProfiles(vanillaJson, loaderJson);

    // Self-heal missing runtime libraries (works for vanilla + all modloaders).
    await MinecraftManager.ensureLibraries(merged.libraries || [], () => {});

    // ── Extract natives ───────────────────────────────────────────────────────
    const nativesDir = path.join(VERSIONS_DIR, versionId, 'natives');
    fs.mkdirSync(nativesDir, { recursive: true });
    await extractNatives(merged.libraries, nativesDir);

    // ── Build the "legacy classpath" that Forge's bootstraplauncher expects ───
    // This is only for JARs that bootstraplauncher loads itself (its ignoreList).
    // Forge's own JVM args contain the real -p / --add-modules for the rest.
    const legacyClasspath = buildLegacyClasspath(merged.libraries, mcVersion, versionId, entry.modloader);

    // ── Auth ──────────────────────────────────────────────────────────────────
    const playerName  = offline ? (offlineName || 'Player') : (profile?.name || offlineName || 'Player');
    const playerUUID  = offline ? generateOfflineUUID(playerName) : (uuid || profile?.id || '00000000-0000-0000-0000-000000000000');
    const playerToken = offline ? '0' : (accessToken || '0');
    const userType    = offline ? 'legacy' : 'msa';
    const assetIndex  = merged.assetIndex?.id || mcVersion;
    const safeWidth  = Number.isFinite(+width)  ? Math.max(320, Math.min(8192, Math.round(+width)))   : 1280;
    const safeHeight = Number.isFinite(+height) ? Math.max(240, Math.min(8192, Math.round(+height)))  : 720;
    const customResolution = Number.isFinite(+width) && Number.isFinite(+height) && safeWidth > 0 && safeHeight > 0;

    const ramMB = Math.max(512, Math.round((ram || 4) * 1024));

    // ── Resolve Forge's JVM arg variables ────────────────────────────────────
    const jvmVars = {
      '${natives_directory}':   nativesDir,
      '${launcher_name}':       'Paroxysm',
      '${launcher_version}':    '1.0',
      '${classpath}':           legacyClasspath,
      '${library_directory}':   LIBS_DIR,
      '${classpath_separator}': path.delimiter,
      '${version_name}':        versionId,
    };

    // Base JVM performance args (added BEFORE Forge's args)
    const baseJvmArgs = [
      `-Xmx${ramMB}M`,
      `-Xms${Math.min(512, ramMB)}M`,
      '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20',
      `-Djava.library.path=${nativesDir}`,
      `-Dminecraft.launcher.brand=Paroxysm`,
      `-Dminecraft.launcher.version=1.0`,
    ];

    // Forge's own JVM args (contains -p, --add-modules, --add-opens, -cp…)
    // We MUST use these exactly — they define the module graph Forge expects.
    const forgeJvmArgs = resolveArgs(merged.arguments?.jvm || [], jvmVars, {});

    // ── Game args ─────────────────────────────────────────────────────────────
    const gameVars = {
      '${auth_player_name}':       playerName,
      '${version_name}':           versionId,
      '${game_directory}':         entry.gameDir,
      '${assets_root}':            ASSETS_DIR,
      '${assets_index_name}':      assetIndex,
      '${auth_uuid}':              playerUUID,
      '${auth_access_token}':      playerToken,
      '${user_type}':              userType,
      '${version_type}':           'release',
      '${resolution_width}':       String(safeWidth),
      '${resolution_height}':      String(safeHeight),
      '${clientid}':               '',
      '${auth_xuid}':              '',
      '${quickPlayPath}':          '',
      '${quickPlaySingleplayer}':  '',
      '${quickPlayMultiplayer}':   '',
      '${quickPlayRealms}':        '',
    };

    const features = {
      is_demo_user:               false,
      has_custom_resolution:      customResolution,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer:  false,
      is_quick_play_realms:       false,
    };

    let rawGameArgs;
    if (merged.minecraftArguments) {
      rawGameArgs = merged.minecraftArguments.split(' ').map(a => substituteVars(a, gameVars));
    } else {
      rawGameArgs = resolveArgs(merged.arguments?.game || [], gameVars, features);
    }

    const finalGameArgs = rawGameArgs.filter(a => a !== '--demo' && !a.includes('${'));
    if (fullscreen && !finalGameArgs.includes('--fullscreen')) finalGameArgs.push('--fullscreen');

    const mainClass = loaderJson.mainClass || vanillaJson.mainClass;
    if (!mainClass) throw new Error(`mainClass introuvable dans ${versionId}`);

    // ── Filter JVM args incompatible with the detected Java version ─────────────
    // --sun-misc-unsafe-memory-access=allow : Java 23+ only
    // --enable-native-access                : Java 21+ only
    const javaVersion = detectJavaMajorVersion(javaPath);
    const filteredJvmArgs = forgeJvmArgs.filter(arg => {
      if (arg.startsWith('--sun-misc-unsafe-memory-access') && javaVersion < 23) return false;
      if (arg.startsWith('--enable-native-access')          && javaVersion < 21) return false;
      return true;
    });

    // Legacy vanilla versions (e.g. 1.8.9) may not provide modern JVM args with -cp.
    // In that case, inject a classpath explicitly so Java can resolve mainClass.
    const hasClasspathArg = (() => {
      for (let i = 0; i < filteredJvmArgs.length; i++) {
        const a = String(filteredJvmArgs[i] || '');
        if (a === '-cp' || a === '-classpath') return true;
        if (a.startsWith('-cp=') || a.startsWith('-classpath=')) return true;
      }
      return false;
    })();
    const effectiveJvmArgs = hasClasspathArg
      ? filteredJvmArgs
      : ['-cp', legacyClasspath, ...filteredJvmArgs];

    // Full command: base perf flags + loader JVM args + main class + game args
    const fullArgs = [...baseJvmArgs, ...(Array.isArray(extraJvmArgs) ? extraJvmArgs : []), ...effectiveJvmArgs, mainClass, ...finalGameArgs].filter(Boolean);

    console.log('[launch] java:      ', javaPath, `(v${javaVersion})`);
    console.log('[launch] mainClass: ', mainClass);
    console.log('[launch] gameDir:   ', entry.gameDir);
    console.log('[launch] nativesDir:', nativesDir, `(${fs.readdirSync(nativesDir).length} files)`);
    console.log('[launch] ramMB:     ', ramMB);

    const child = spawn(javaPath, fullArgs, {
      cwd:      entry.gameDir,
      detached: true,
      stdio:    ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(extraEnv && typeof extraEnv === 'object' ? extraEnv : {}),
        JAVA_HOME:           path.dirname(path.dirname(javaPath)),
        // Forge / Connector sometimes need these
        FORGE_LIBS_PATH:     LIBS_DIR,
      },
    });

    if (!child.pid) throw new Error('Impossible de lancer Minecraft — Java n\'a pas démarré');
    child.unref();
    return child;
  }
}

// ── buildLegacyClasspath ───────────────────────────────────────────────────────
/**
 * Forge 1.17+ uses JPMS: minecraft.jar goes on the module path (-p), NOT -cp.
 * Fabric uses a traditional classpath: minecraft.jar MUST be on -cp or Fabric
 * throws "couldn't locate the game".
 *
 * The modloader parameter controls which behaviour to use.
 */
function buildLegacyClasspath(libraries, mcVersion, versionId, modloader) {
  const seenPath = new Set();
  const seenGA   = new Set();
  const paths    = [];
  const isForge  = modloader === 'forge' || modloader === 'neoforge';

  // For Forge: these go on -p via Forge's own JVM args — exclude from -cp
  const FORGE_MODULE_PATH_ONLY = new Set([
    'net.minecraft:client',
    'net.minecraft:minecraft',
    'net.minecraftforge:forge',
    'net.neoforged:neoforge',
    'net.neoforged:neoforge-dependencies',
  ]);

  for (const lib of libraries) {
    if (!isLibAllowed(lib)) continue;

    const nameParts  = (lib.name || '').split(':');
    const groupArt   = `${nameParts[0]}:${nameParts[1]}`;
    const classifier = nameParts[3] || '';
    const dedupKey   = `${groupArt}:${classifier}`;

    // Natives go to nativesDir via extractNatives(), NOT on the classpath
    if (classifier.startsWith('natives-')) continue;

    // For Forge: these are placed on -p (module path) by Forge's own JVM args
    if (isForge && FORGE_MODULE_PATH_ONLY.has(groupArt)) continue;

    // Avoid runtime duplicates like ASM 9.6 + 9.9 on Fabric classpath.
    // Keep first occurrence (loader libs are ordered before vanilla libs).
    if (nameParts.length >= 3 && seenGA.has(dedupKey)) continue;
    if (nameParts.length >= 3) seenGA.add(dedupKey);

    const p = resolveLibPath(lib);
    if (p && fs.existsSync(p) && !seenPath.has(p)) { seenPath.add(p); paths.push(p); }
  }

  // Fabric needs minecraft.jar explicitly on -cp
  // Forge must NOT have it on -cp (it goes on -p via Forge's args)
  if (!isForge) {
    const clientJar = path.join(VERSIONS_DIR, mcVersion, `${mcVersion}.jar`);
    if (fs.existsSync(clientJar) && !seenPath.has(clientJar)) {
      seenPath.add(clientJar);
      paths.push(clientJar);
    }
  }

  if (paths.length === 0) throw new Error('Classpath vide — relancez l\'installation.');
  return paths.join(path.delimiter);
}

// ── extractNatives ─────────────────────────────────────────────────────────────
async function extractNatives(libraries, nativesDir) {
  const extract  = require('extract-zip');
  const currentOs = process.platform === 'win32' ? 'windows'
                  : process.platform === 'darwin' ? 'macos' : 'linux';
  const legacyOsKey = currentOs === 'macos' ? 'osx' : currentOs;

  const nativeJars = [];

  for (const lib of libraries) {
    if (!isLibAllowed(lib)) continue;
    const classifier = (lib.name || '').split(':')[3] || '';

    // Modern: classifier = "natives-windows"
    if (classifier.startsWith('natives-') && classifier.includes(currentOs)) {
      const p = resolveLibPath(lib);
      if (p && fs.existsSync(p)) nativeJars.push(p);
    }
    // Legacy: lib.natives map
    else if (lib.natives?.[legacyOsKey]) {
      const nat = lib.downloads?.classifiers?.[lib.natives[legacyOsKey]];
      if (nat?.path) {
        const p = path.join(LIBS_DIR, nat.path);
        if (fs.existsSync(p)) nativeJars.push(p);
      }
    }
  }

  console.log(`[natives] ${nativeJars.length} native JAR(s) → ${nativesDir}`);

  for (const jarPath of nativeJars) {
    try {
      await extract(jarPath, {
        dir: nativesDir,
        filter: (entry) => {
          const n = entry.fileName;
          return (n.endsWith('.dll') || n.endsWith('.so') ||
                  n.endsWith('.dylib') || n.endsWith('.jnilib')) &&
                 !n.includes('/');
        },
      });
      console.log('[natives] extracted:', path.basename(jarPath));
    } catch (e) {
      console.warn('[natives] failed:', path.basename(jarPath), e.message);
    }
  }
}

// ── sanitizeModsDir ────────────────────────────────────────────────────────────
function sanitizeModsDir(modsDir, mcVersion) {
  if (!modsDir || !fs.existsSync(modsDir)) return;
  const BANNED = [
    new RegExp(`^minecraft-${mcVersion.replace(/\./g,'\\.')}`,'i'),
    new RegExp(`^${mcVersion.replace(/\./g,'\\.')}\\.jar$`,'i'),
    /^minecraft-client/i, /^minecraft-server/i, /^minecraft-merged/i,
    /forge.*installer/i, /neoforge.*installer/i,
    /^mappings-/i, /^yarn-/i, /^intermediary-/i,
  ];
  for (const file of fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'))) {
    if (BANNED.some(p => p.test(file))) {
      try { fs.unlinkSync(path.join(modsDir, file)); console.log('[launch] removed from mods/:', file); }
      catch {}
    }
  }
}

function ensureWritableRuntimeFiles(gameDir) {
  const targets = [
    path.join(gameDir, 'config'),
    path.join(gameDir, 'options.txt'),
    path.join(gameDir, 'optionsof.txt'),
    path.join(gameDir, 'optionsshaders.txt'),
  ];
  for (const p of targets) {
    if (!fs.existsSync(p)) continue;
    makeWritableRecursive(p);
  }
}

function makeWritableRecursive(target) {
  let st;
  try { st = fs.lstatSync(target); } catch { return; }
  if (st.isSymbolicLink()) return;

  if (st.isDirectory()) {
    let entries = [];
    try { entries = fs.readdirSync(target); } catch {}
    for (const name of entries) makeWritableRecursive(path.join(target, name));
    try { fs.chmodSync(target, st.mode | 0o700); } catch {}
    return;
  }

  if (st.isFile()) {
    try { fs.chmodSync(target, st.mode | 0o200); } catch {}
  }
}

// ── mergeProfiles ──────────────────────────────────────────────────────────────
function mergeProfiles(vanilla, loader) {
  // Keep all library declarations here.
  // Filtering/deduplication must happen later with OS/rules awareness; doing it
  // too early can drop the valid platform-specific LWJGL entry on vanilla 1.16.
  const libs = [...(loader.libraries || []), ...(vanilla.libraries || [])];
  return {
    mainClass:          loader.mainClass          || vanilla.mainClass,
    minecraftArguments: loader.minecraftArguments || vanilla.minecraftArguments,
    assetIndex:         loader.assetIndex         || vanilla.assetIndex,
    assets:             loader.assets             || vanilla.assets,
    libraries:          libs,
    arguments: {
      jvm:  [...(vanilla.arguments?.jvm  || []), ...(loader.arguments?.jvm  || [])],
      game: [...(vanilla.arguments?.game || []), ...(loader.arguments?.game || [])],
    },
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function detectJavaMajorVersion(javaPath) {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
    const all = (r.stdout || '') + (r.stderr || '');
    const m = all.match(/version "(?:1\.)?([0-9]+)/);
    return m ? parseInt(m[1]) : 17;
  } catch (e) {
    return 17;
  }
}

function loadVersionJson(versionId) {
  const p = path.join(VERSIONS_DIR, versionId, `${versionId}.json`);
  if (!fs.existsSync(p)) throw new Error(
    `Version JSON introuvable: ${versionId}\nChemin: ${p}\nRelancez l'installation.`
  );
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function resolveLibPath(lib) {
  const artifact = lib.downloads?.artifact;
  if (artifact?.path) return path.join(LIBS_DIR, artifact.path);
  const parts = (lib.name || '').split(':');
  if (parts.length < 3) return null;
  const [grp, art, ver, cls] = parts;
  const groupPath = grp.replace(/\./g, path.sep);
  const suffix    = cls ? `-${cls}` : '';
  return path.join(LIBS_DIR, groupPath, art, ver, `${art}-${ver}${suffix}.jar`);
}

function isLibAllowed(lib) {
  if (!lib.rules?.length) return true;
  let allowed = false;
  for (const r of lib.rules) {
    const osMatch = !r.os || r.os.name === osName();
    if (r.action === 'allow'    && osMatch) allowed = true;
    if (r.action === 'disallow' && osMatch) allowed = false;
  }
  return allowed;
}

function resolveArgs(template, vars, features = {}) {
  const result = [];
  for (const arg of template) {
    // Plain string argument
    if (typeof arg === 'string') {
      const resolved = substituteVars(arg, vars);
      if (resolved !== undefined && resolved !== 'undefined') result.push(resolved);
      continue;
    }
    // Conditional argument object { rules, value }
    if (!arg || typeof arg !== 'object') continue;
    // No value field → skip entirely (some Forge entries have only rules, no value)
    if (arg.value === undefined || arg.value === null) continue;

    let allowed = !arg.rules?.length;
    for (const r of (arg.rules || [])) {
      const osOk   = !r.os       || r.os.name === osName();
      const featOk = !r.features || Object.entries(r.features).every(([k, v]) => features[k] === v);
      if (r.action === 'allow'    && osOk && featOk) allowed = true;
      if (r.action === 'disallow' && osOk && featOk) allowed = false;
    }
    if (!allowed) continue;

    const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
    for (const v of vals) {
      if (v === undefined || v === null) continue;
      const resolved = substituteVars(String(v), vars);
      if (resolved && resolved !== 'undefined') result.push(resolved);
    }
  }
  return result.filter(a => a && a !== 'undefined');
}

function substituteVars(str, vars) {
  return String(str).replace(/\$\{[^}]+\}/g, m => vars[m] !== undefined ? vars[m] : m);
}

function osName() {
  return process.platform === 'win32' ? 'windows'
       : process.platform === 'darwin' ? 'osx' : 'linux';
}

function generateOfflineUUID(name) {
  const crypto = require('crypto');
  const hash   = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

module.exports = GameLauncher;

'use strict';
const fs   = require('fs');
const path = require('path');
const Store = require('../utils/store');
const INSTANCES_DIR = path.join(Store.BASE_DIR, 'instances');

function containsPath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

class ModpackLibrary {
  constructor(store) { this._store = store; }

  _all() { return this._store.get('library') || {}; }

  _countInstalledMods(entry) {
    try {
      const modsDir = entry?.modsDir;
      if (!modsDir || !fs.existsSync(modsDir)) return 0;
      return fs.readdirSync(modsDir, { withFileTypes: true })
        .filter(d => d.isFile() && /\.jar$/i.test(d.name))
        .length;
    } catch {
      return 0;
    }
  }

  _withRuntimeStats(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const installedMods = this._countInstalledMods(entry);
    return {
      ...entry,
      totalMods: installedMods,
    };
  }

  list() {
    return Object.values(this._all())
      .map(e => this._withRuntimeStats(e))
      .sort((a,b) => new Date(b.addedAt) - new Date(a.addedAt));
  }

  get(id) {
    const entry = this._all()[id] ?? null;
    return entry ? this._withRuntimeStats(entry) : null;
  }

  /**
   * @param {object} parsed        - ParsedModpack
   * @param {array}  failedMods    - array of failed download items
   * @param {string} versionId     - the installed loader version ID (e.g. "1.20.1-forge-47.4.0")
   * @param {object} options       - optional instance flags (contentLocked, lockSource)
   */
  add(parsed, failedMods = [], versionId = null, options = {}) {
    const sanitize = n => (n||'modpack').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_\-. ]/g,'').replace(/\s+/g,'_').slice(0,64)||'modpack';
    const instanceDir = path.join(Store.BASE_DIR, 'instances', sanitize(parsed.name));
    const id = `${sanitize(parsed.name).toLowerCase()}_${Date.now()}`;

    const entry = {
      id,
      name:             parsed.name,
      version:          parsed.version,
      author:           parsed.author || '',
      mcVersion:        parsed.mcVersion,
      modloader:        parsed.modloader,
      modloaderVersion: parsed.modloaderVersion,
      versionId:        versionId || `${parsed.mcVersion}-${parsed.modloader}-${parsed.modloaderVersion}`,
      format:           parsed.format,
      gameDir:          instanceDir,
      modsDir:          path.join(instanceDir, 'mods'),
      totalMods:        parsed.files.length,
      failedMods:       failedMods.length,
      failedModsList:   failedMods.map(f => ({ url: f.url, dest: path.basename(f.dest || ''), error: f.error })),
      addedAt:          new Date().toISOString(),
      lastPlayed:       null,
      iconData:         parsed.iconData || null,   // base64 data URL extracted from zip
      ram:              null,                      // per-instance RAM override (null = use global)
      customName:       null,                      // user-set display name
      notes:            '',                        // user notes
      fullscreen:       null,                      // null => use defaults
      useGlobalResolution: true,                   // true => always use global width/height
      windowWidth:      null,                      // null => use defaults
      windowHeight:     null,                      // null => use defaults
      javaArgs:         '',                        // per-instance JVM args
      envVars:          '',                        // per-instance env vars
      contentLocked:    !!options.contentLocked,  // locked instances cannot receive extra content until unlocked
      lockSource:       options.lockSource || '', // e.g. "browser-official"
    };

    const all = this._all();
    all[id] = entry;
    this._store.set('library', all);

    // Cleanup tmp
    try { if (parsed.tmpDir) fs.rmSync(parsed.tmpDir, { recursive: true, force: true }); } catch {}

    return entry;
  }

  updateLastPlayed(id) {
    const all = this._all();
    if (all[id]) { all[id].lastPlayed = new Date().toISOString(); this._store.set('library', all); }
  }

  update(id, fields) {
    const all = this._all();
    if (!all[id]) return false;
    // Only allow safe fields to be updated
    const allowed = ['customName', 'iconData', 'ram', 'notes', 'fullscreen', 'useGlobalResolution', 'windowWidth', 'windowHeight', 'javaArgs', 'envVars', 'contentLocked', 'lockSource'];
    for (const k of allowed) {
      if (fields[k] !== undefined) all[id][k] = fields[k];
    }
    this._store.set('library', all);
    return all[id];
  }

  delete(id) {
    const all = this._all();
    if (!all[id]) return false;
    const target = path.resolve(all[id].gameDir || '');
    const instancesRoot = path.resolve(INSTANCES_DIR);
    if (containsPath(instancesRoot, target)) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
    } else {
      console.warn('[library:delete] Refused to delete path outside instances dir:', target);
    }
    delete all[id];
    this._store.set('library', all);
    return true;
  }
}

module.exports = ModpackLibrary;

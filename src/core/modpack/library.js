'use strict';
const fs   = require('fs');
const path = require('path');
const Store = require('../utils/store');

class ModpackLibrary {
  constructor(store) { this._store = store; }

  _all() { return this._store.get('library') || {}; }

  list() {
    return Object.values(this._all()).sort((a,b) => new Date(b.addedAt) - new Date(a.addedAt));
  }

  get(id) { return this._all()[id] ?? null; }

  /**
   * @param {object} parsed        - ParsedModpack
   * @param {array}  failedMods    - array of failed download items
   * @param {string} versionId     - the installed loader version ID (e.g. "1.20.1-forge-47.4.0")
   */
  add(parsed, failedMods = [], versionId = null) {
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

  delete(id) {
    const all = this._all();
    if (!all[id]) return false;
    try { fs.rmSync(all[id].gameDir, { recursive: true, force: true }); } catch {}
    delete all[id];
    this._store.set('library', all);
    return true;
  }
}

module.exports = ModpackLibrary;

'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const LEGACY_BASE_DIR = path.resolve(path.join(os.homedir(), '.paroxysm'));

function isDevRuntime() {
  return !!process.defaultApp;
}

function isDirectoryWritable(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const probeFile = path.join(dirPath, `.write-test-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
    return true;
  } catch {
    return false;
  }
}

function copyDirectoryRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function resolveInstallBaseDir() {
  const fromEnv = String(process.env.PAROXYSM_DATA_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);

  if (isDevRuntime()) return LEGACY_BASE_DIR;

  const portableDir = String(process.env.PORTABLE_EXECUTABLE_DIR || '').trim();
  if (portableDir) return path.resolve(path.join(portableDir, '.paroxysm'));

  const exeDir = path.dirname(process.execPath || '');
  if (exeDir) return path.resolve(path.join(exeDir, '.paroxysm'));

  return LEGACY_BASE_DIR;
}

function migrateLegacyDataIfNeeded(targetDir) {
  if (targetDir === LEGACY_BASE_DIR) return true;
  if (!fs.existsSync(LEGACY_BASE_DIR)) return true;
  if (fs.existsSync(targetDir)) return true;

  try {
    const targetParent = path.dirname(targetDir);
    fs.mkdirSync(targetParent, { recursive: true });
    try {
      fs.renameSync(LEGACY_BASE_DIR, targetDir);
      return true;
    } catch {}
    copyDirectoryRecursive(LEGACY_BASE_DIR, targetDir);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseDir() {
  const preferred = resolveInstallBaseDir();
  const migrationOk = migrateLegacyDataIfNeeded(preferred);
  if (!migrationOk) return LEGACY_BASE_DIR;

  if (isDirectoryWritable(preferred)) return preferred;
  return LEGACY_BASE_DIR;
}

const BASE_DIR = resolveBaseDir();
const STORE_FILE = path.join(BASE_DIR, 'store.json');

class Store {
  constructor() {
    if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });
    this._data = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        this._data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      }
    } catch { this._data = {}; }
  }

  _save() {
    fs.writeFileSync(STORE_FILE, JSON.stringify(this._data, null, 2));
  }

  get(key) {
    return key ? this._data[key] : this._data;
  }

  set(key, value) {
    this._data[key] = value;
    this._save();
  }

  delete(key) {
    delete this._data[key];
    this._save();
  }

  static get BASE_DIR() { return BASE_DIR; }
}

module.exports = Store;

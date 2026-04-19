'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE_DIR  = path.join(os.homedir(), '.paroxysm');
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

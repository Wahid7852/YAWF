'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  ctrlEnterToSend: false,
  closeToTray: true,
  startMinimized: false,
  autostart: false,
  idleReloadHours: 4,
  zoomFactor: 1.0,
};

class Settings {
  constructor(userDataDir) {
    this._file = path.join(userDataDir, 'settings.json');
    this._data = { ...DEFAULTS, ...this._load() };
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this._file), { recursive: true });
    fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2));
  }

  get(key) {
    return this._data[key];
  }

  getAll() {
    return { ...this._data };
  }

  set(key, value) {
    this._data[key] = value;
    this._save();
  }
}

module.exports = { Settings, DEFAULTS };

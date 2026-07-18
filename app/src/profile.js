'use strict';

const path = require('node:path');

/** Mirrors the C++ build's `--profile <name>` flag: isolates userData per profile. */
function parseProfileArg(argv) {
  const idx = argv.indexOf('--profile');
  if (idx === -1 || idx === argv.length - 1) return 'default';
  const name = argv[idx + 1].trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid --profile name "${name}": use letters, digits, - or _ only`);
  }
  return name;
}

function applyProfileUserDataPath(app, profileName) {
  if (profileName === 'default') return;
  const base = app.getPath('userData');
  app.setPath('userData', path.join(base, 'profiles', profileName));
}

module.exports = { parseProfileArg, applyProfileUserDataPath };

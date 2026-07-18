'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parseProfileArg, applyProfileUserDataPath } = require('./profile');

test('parseProfileArg defaults to "default" when --profile is absent', () => {
  assert.equal(parseProfileArg(['electron', '.']), 'default');
});

test('parseProfileArg defaults to "default" when --profile is the last arg with no value', () => {
  assert.equal(parseProfileArg(['electron', '.', '--profile']), 'default');
});

test('parseProfileArg reads the value that follows --profile', () => {
  assert.equal(parseProfileArg(['electron', '.', '--profile', 'work']), 'work');
});

test('parseProfileArg accepts letters, digits, hyphen, underscore', () => {
  assert.equal(parseProfileArg(['--profile', 'work-2_test']), 'work-2_test');
});

test('parseProfileArg rejects path traversal and other unsafe characters', () => {
  for (const bad of ['../../etc', 'a/b', 'a b', 'a;rm -rf', '']) {
    assert.throws(() => parseProfileArg(['--profile', bad]), /Invalid --profile name/);
  }
});

test('applyProfileUserDataPath is a no-op for the default profile', () => {
  let setPathCalled = false;
  const fakeApp = {
    getPath: () => '/home/user/.config/YAWF',
    setPath: () => {
      setPathCalled = true;
    },
  };
  applyProfileUserDataPath(fakeApp, 'default');
  assert.equal(setPathCalled, false);
});

test('applyProfileUserDataPath nests non-default profiles under profiles/<name>', () => {
  let newPath = null;
  const fakeApp = {
    getPath: () => '/home/user/.config/YAWF',
    setPath: (key, value) => {
      assert.equal(key, 'userData');
      newPath = value;
    },
  };
  applyProfileUserDataPath(fakeApp, 'work');
  assert.equal(newPath, path.join('/home/user/.config/YAWF', 'profiles', 'work'));
});

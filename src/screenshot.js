'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function commandExists(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

// Ordered by how well each tool does *region* capture (matches YAWF C++ detection order).
const TOOLS = [
  { bin: 'spectacle', args: (out) => ['-b', '-n', '-r', '-o', out] },
  { bin: 'gnome-screenshot', args: (out) => ['-a', '-f', out] },
  { bin: 'flameshot', args: (out) => ['gui', '-r', '-p', out] },
  { bin: 'maim', args: (out) => ['-s', out] },
  { bin: 'import', args: (out) => [out] }, // ImageMagick, prompts for a region via mouse
];

function detectTool() {
  if (commandExists('grim') && commandExists('slurp')) return 'grim-slurp';
  return TOOLS.find((t) => commandExists(t.bin))?.bin ?? null;
}

function runGrimSlurp(outFile) {
  return new Promise((resolve, reject) => {
    const slurp = spawn('slurp');
    let geometry = '';
    slurp.stdout.on('data', (d) => (geometry += d.toString()));
    slurp.on('error', reject);
    slurp.on('close', (code) => {
      geometry = geometry.trim();
      if (code !== 0 || !geometry) return reject(new Error('selection cancelled'));
      const grim = spawn('grim', ['-g', geometry, outFile]);
      grim.on('error', reject);
      grim.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`grim exited ${c}`))));
    });
  });
}

function runTool(tool, outFile) {
  const def = TOOLS.find((t) => t.bin === tool);
  return new Promise((resolve, reject) => {
    const proc = spawn(def.bin, def.args(outFile));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${def.bin} exited ${code}`))));
  });
}

/** Runs the desktop's region-capture tool and returns a PNG Buffer, or null if none is installed. */
async function captureScreenshot() {
  const tool = detectTool();
  if (!tool) return null;

  const outFile = path.join(os.tmpdir(), `yawf-screenshot-${Date.now()}.png`);
  try {
    if (tool === 'grim-slurp') {
      await runGrimSlurp(outFile);
    } else {
      await runTool(tool, outFile);
    }
    const buf = fs.readFileSync(outFile);
    return buf;
  } finally {
    fs.unlink(outFile, () => {});
  }
}

module.exports = { captureScreenshot, detectTool, commandExists };

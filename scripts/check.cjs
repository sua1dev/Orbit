'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = ['main.cjs', 'preload.cjs', 'login-preload.cjs'];
for (const folder of ['lib', 'scripts', 'tests', 'renderer']) {
  for (const name of fs.readdirSync(path.join(root, folder))) if (/\.c?js$/.test(name)) files.push(`${folder}/${name}`);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) { process.stderr.write(result.stderr);process.exit(result.status || 1); }
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error('Package and lockfile versions differ');
for (const asset of ['renderer/index.html', 'renderer/styles.css', 'renderer/features.css', 'renderer/glass.css', 'renderer/icons.css', 'renderer/orbit.ico', 'renderer/brand/orbit-mark.svg', 'renderer/sites/google.png', 'renderer/sites/youtube.png', 'renderer/sites/naver.png', 'renderer/sites/github.png', 'renderer/panes.css', 'renderer/tab-strip.css', 'renderer/start-page.css', 'renderer/sites/discord.png', 'renderer/wallpapers/seoul-day.jpg', 'renderer/wallpapers/seoul-night.jpg', 'renderer/wallpapers/seoul-rain.jpg', 'renderer/wallpapers/seoul-snow.jpg', 'build/orbit.iss', 'electron-builder.yml']) {
  if (!fs.statSync(path.join(root, asset)).size) throw new Error(`Missing release asset: ${asset}`);
}
console.log(`Checked ${files.length} JavaScript files, package metadata and release assets.`);

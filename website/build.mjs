import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const relative = name => new URL(name, import.meta.url);
const assets = relative('./dist/assets/');
const { version } = JSON.parse(await readFile(relative('../package.json'), 'utf8'));
const mobileGradle = await readFile(relative('../mobile/app/build.gradle'), 'utf8');
const mobileVersion = /^\s*versionName '([\w.-]+)'\s*$/m.exec(mobileGradle)?.[1];
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid Orbit version');
if (!mobileVersion) throw new Error('Missing Android version');

await mkdir(assets, { recursive: true });
const html = await readFile(relative('./public/index.html'), 'utf8');
await Promise.all([
  writeFile(relative('./dist/index.html'), html.replaceAll('__ORBIT_VERSION__', version)
    .replaceAll('__ORBIT_ANDROID_VERSION__', mobileVersion)),
  ...['style.css', 'preview.js', '_headers'].map(file =>
    copyFile(relative('./public/' + file), relative('./dist/' + file))),
  copyFile(relative('../renderer/brand/orbit-mark.svg'), new URL('orbit.svg', assets)),
  ...['yuwol-lavender.png', 'yuwol-crescent.png'].map(file =>
    copyFile(relative('../renderer/brand/' + file), new URL(file, assets))),
  ...['day', 'night', 'rain', 'snow'].map(scene => {
    const file = 'seoul-' + scene + '.jpg';
    return copyFile(relative('../renderer/wallpapers/' + file), new URL(file, assets));
  }),
]);
console.log('Built the Orbit ' + version + ' website.');

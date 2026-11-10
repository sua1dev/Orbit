'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const { DebugLogger } = require('builder-util');
const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config');
const { fileTypes } = require('../lib/local-document.cjs');
const { version } = require('../package.json');

const projectDir = path.resolve(__dirname, '..');
const configFile = path.join(projectDir, 'electron-builder.yml');
const innoScript = path.join(projectDir, 'build', 'orbit.iss');

async function findCompiler() {
  const programDirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const standardPaths = programDirs.flatMap(dir => ['Inno Setup 7', 'Inno Setup 6'].map(name => path.join(dir, name, 'ISCC.exe')));
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir.replace(/^"(.*)"$/, '$1'), 'ISCC.exe'));
  const candidates = process.env.ORBIT_ISCC ? [path.resolve(process.env.ORBIT_ISCC)] : [...standardPaths, ...pathEntries];
  for (const candidate of candidates) {
    if ((await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  throw new Error('Install Inno Setup 7 or set ORBIT_ISCC to the full path of ISCC.exe. https://jrsoftware.org/isdl.php');
}

function documentAssociations() {
  return [...fileTypes.keys()].flatMap(extension => {
    const suffix = extension.slice(1);
    const progId = 'OrbitDocument.' + suffix;
    const description = suffix.toUpperCase() + ' Document';
    return [
      `Root: HKCU; Subkey: "{#Capabilities}\\FileAssociations"; ValueType: string; ValueName: "${extension}"; ValueData: "${progId}"`,
      `Root: HKCU; Subkey: "Software\\Classes\\${progId}"; ValueType: string; ValueData: "${description}"; Flags: uninsdeletekey`,
      `Root: HKCU; Subkey: "Software\\Classes\\${progId}\\DefaultIcon"; ValueType: string; ValueData: """{app}\\{#OrbitExe}"",0"`,
      `Root: HKCU; Subkey: "Software\\Classes\\${progId}\\shell\\open\\command"; ValueType: string; ValueData: """{app}\\{#OrbitExe}"" --open-file ""%1"""`,
      `Root: HKCU; Subkey: "Software\\Classes\\${extension}\\OpenWithProgids"; ValueType: string; ValueName: "${progId}"; ValueData: ""; Flags: uninsdeletevalue`,
    ];
  }).join('\r\n') + '\r\n';
}

async function compileInstaller(compiler, payloadDir, outDir) {
  const associations = path.join(outDir, 'orbit-document-associations.iss');
  await fs.writeFile(associations, documentAssociations(), 'utf8');
  const args = ['/Qp', '/O' + outDir, '/DOrbitVersion=' + version, '/DOrbitPayload=' + payloadDir,
    '/DOrbitAssociations=' + associations, innoScript];
  const result = spawnSync(compiler, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Inno Setup exited with status ${result.status}`);
  const installer = path.join(outDir, `Orbit-Setup-${version}-x64.exe`);
  if (!(await fs.stat(installer)).size) throw new Error('The installer build did not produce an Orbit Setup executable.');
  return installer;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const unsupported = [...args].filter(arg => arg !== '--dir' && arg !== '--check');
  if (unsupported.length) throw new Error(`Unsupported build option: ${unsupported.join(', ')}`);

  const config = await getConfig(projectDir, configFile, null);
  await validateConfiguration(config, new DebugLogger(false));
  await fs.access(innoScript);
  if (args.has('--check')) {
    console.log('Windows distribution configuration is valid.');
    return;
  }

  if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows (or use the Windows release workflow).');

  // Empty CI secrets mean an explicitly unsigned beta. A supplied certificate
  // makes signing mandatory, so a broken credential cannot silently ship unsigned.
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) {
    if (process.env[key] === '') delete process.env[key];
  }
  config.forceCodeSigning = !!(process.env.WIN_CSC_LINK || process.env.CSC_LINK);
  const directoryOnly = args.has('--dir');
  const outDir = path.resolve(projectDir, config.directories.output);
  const compiler = directoryOnly ? null : await findCompiler();
  let installer;
  if (compiler && config.forceCodeSigning) {
    // Keep the electron-builder signing session alive until Setup is signed.
    config.afterSign = async ({ appOutDir, packager }) => {
      installer = await compileInstaller(compiler, appOutDir, outDir);
      if (!await packager.signIf(installer)) throw new Error('The Inno Setup executable was not signed.');
    };
  }
  await build({
    projectDir,
    config,
    targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
    publish: 'never'
  });

  if (directoryOnly) {
    console.log('Unpacked Windows application is ready.');
    return;
  }

  if (!installer && config.forceCodeSigning) throw new Error('No signed Inno Setup executable was produced.');
  if (!installer) installer = await compileInstaller(compiler, path.join(outDir, 'win-unpacked'), outDir);
  const checksumFile = path.join(outDir, 'SHA256SUMS.txt');
  await fs.writeFile(checksumFile, `${await sha256(installer)}  ${path.basename(installer)}\n`, 'utf8');
  console.log([installer, checksumFile].join('\n'));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});

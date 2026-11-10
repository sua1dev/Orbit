'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { launchDocumentPath, fileTypes } = require('../lib/local-document.cjs');

const root = path.resolve(__dirname, '..');
const work = path.resolve(root, '..');

async function test() {
  const run = await fs.mkdtemp(path.join(work, 'orbit-documents-'));
  const html = path.join(run, '한글 sample page.html');
  const pdf = path.join(run, 'sample.pdf');
  const xhtml = path.join(run, 'sample.xhtml');
  const svg = path.join(run, 'sample.svg');
  const webp = path.join(run, 'sample.webp');
  const xml = path.join(run, 'sample.xml');
  await fs.writeFile(html, '<!doctype html><title>Local fixture</title><h1>Local Orbit document</h1><script>window.orbitLocalScriptRan=true</script>');
  await fs.writeFile(xhtml, '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>XML page</title></head><body><h1>XHTML fixture</h1></body></html>');
  await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="blue"/></svg>');
  await fs.writeFile(xml, '<?xml version="1.0"?><catalog><item>Orbit XML fixture</item></catalog>');
  assert.equal(launchDocumentPath(['--open-file', html]), html);
  assert.equal(launchDocumentPath(['--open-file', 'relative.html']), null);
  assert.equal(launchDocumentPath(['--open-file', 'https://example.com/x.pdf']), null);
  assert.equal(launchDocumentPath(['--open-file', path.join(run, 'payload.exe')]), null);

  const app = await electron.launch({
    args: [root, '--open-file', html],
    env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: path.join(run, 'profile') },
  });
  const viewer = async filename => {
    const expected = '/' + path.basename(filename);
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const page = app.windows().find(page => {
        const url = URL.parse(page.url());
        return url?.hostname === 'orbit-local.invalid' && decodeURIComponent(url.pathname) === expected;
      });
      if (page) return page;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Document window did not open: ' + expected + '; windows: ' + app.windows().map(page => page.url()));
  };
  const open = async filename => {
    await app.evaluate(({ app }, value) => { app.emit('second-instance', {}, ['Orbit.exe', '--open-file', value]); }, filename);
    return viewer(filename);
  };
  try {
    const htmlPage = await viewer(html);
    await htmlPage.getByText('Local Orbit document').waitFor();
    assert.equal(await htmlPage.evaluate(() => typeof window.orbitLocalScriptRan), 'undefined');
    assert.equal(await htmlPage.evaluate(() => typeof window.browser), 'undefined');
    const webpData = await htmlPage.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      canvas.getContext('2d').fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/webp');
    });
    assert.match(webpData, /^data:image\/webp;base64,/);
    await fs.writeFile(webp, Buffer.from(webpData.split(',')[1], 'base64'));
    const pdfBytes = await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      return (await contents.printToPDF({})).toString('base64');
    }, htmlPage.url());
    await fs.writeFile(pdf, Buffer.from(pdfBytes, 'base64'));
    console.log('PASS startup file renders with scripts blocked and no Orbit IPC bridge');

    const xhtmlPage = await open(xhtml);
    await xhtmlPage.getByText('XHTML fixture').waitFor({ timeout: 6000 });
    console.log('PASS XHTML document');
    const svgPage = await open(svg);
    await svgPage.locator('rect').waitFor({ timeout: 6000 });
    console.log('PASS SVG document');
    const imagePage = await open(webp);
    await imagePage.waitForFunction(() => document.contentType === 'image/webp' && document.querySelector('img')?.naturalWidth === 8);
    const xmlPage = await open(xml);
    assert.equal(await xmlPage.evaluate(() => document.contentType), 'application/xml');
    await xmlPage.getByText('Orbit XML fixture', { exact: true }).filter({ visible: true }).waitFor();
    console.log('PASS WebP and XML documents');
    const pdfPage = await open(pdf);
    assert.equal(await pdfPage.evaluate(() => document.contentType), 'application/pdf');
    const pdfExtension = frame => frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/');
    const pdfFrame = pdfPage.frames().find(pdfExtension) || await pdfPage.waitForEvent('framenavigated', { predicate: pdfExtension, timeout: 6000 });
    await pdfFrame.waitForFunction(() => {
      const viewer = document.querySelector('pdf-viewer');
      return viewer?.documentDimensions?.pageDimensions?.length > 0;
    }, undefined, { timeout: 6000 });
    assert.ok(fileTypes.has('.webp') && fileTypes.has('.xml'));
    console.log('PASS second-instance document routing and Chromium PDF viewer');
  } finally {
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const fallback = setTimeout(() => child.kill(), 5000);
      try {
        await Promise.race([exited, app.evaluate(({ app }) => setImmediate(() => app.exit(0))).catch(() => {})]);
        await exited;
      } finally { clearTimeout(fallback); }
    }
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });

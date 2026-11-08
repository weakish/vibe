import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bunAvailable, bundleIsComplete, bundleStaticAssets } from '../src/static-assets.js';

// These run the real bun from PATH, so they are skipped on machines without it.
const BUN = 'bun';
const skip = (await bunAvailable(BUN)) ? false : 'bun is not on PATH';

// Copies the real public/ and shared/ trees so bun never writes into the checkout.
function copyProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-real-bun-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['public', 'shared']) {
    fs.cpSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), path.join(root, dir), {
      recursive: true,
      filter: (src) => !['dist', '.bundle-staging'].includes(path.basename(src)),
    });
  }
  return root;
}

test('real bun bundles the public pages and follows the shared imports', { skip }, async (t) => {
  const root = copyProject(t);

  const manifest = await bundleStaticAssets({ projectRoot: root, bunBin: BUN });

  assert.match(manifest.app, /^\/dist\/app-[0-9a-z]+\.js$/);
  assert.match(manifest.spec, /^\/dist\/spec-[0-9a-z]+\.js$/);
  assert.match(manifest.styles, /^\/dist\/styles-[0-9a-z]+\.css$/);
  assert.equal(await bundleIsComplete(root, manifest), true);
  // 'boffin-chat-' comes from shared/export.js and 'Static assets' from i18n.js, so both graphs were followed.
  const app = fs.readFileSync(path.join(root, 'public', manifest.app), 'utf8');
  assert.match(app, /boffin-chat-/);
  assert.match(app, /Static assets/);
  const index = fs.readFileSync(path.join(root, 'public', 'dist', 'index.html'), 'utf8');
  assert.match(index, /src="\/dist\/app-[0-9a-z]+\.js"/);
  assert.doesNotMatch(index, /src="\/app\.js"/);
});

test('real bun reports a broken import and leaves no release behind', { skip }, async (t) => {
  const root = copyProject(t);
  fs.writeFileSync(path.join(root, 'public', 'app.js'), "import { missing } from './no-such-module.js';\nconsole.log(missing);\n");
  const logged = [];

  await assert.rejects(
    bundleStaticAssets({ projectRoot: root, bunBin: BUN, logger: { error: (line) => logged.push(line) } }),
    { name: 'BundleError', message: 'Bundling failed.' },
  );
  assert.equal(fs.existsSync(path.join(root, 'public', 'dist')), false);
  assert.match(logged.join('\n'), /no-such-module/);
});

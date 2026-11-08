#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBunBin } from '../src/config.js';
import { bundleStaticAssets, bunAvailable } from '../src/static-assets.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Usage: node scripts/bundle-static.mjs [workdir]. Uses bun_bin from the workdir's config.json.
async function main() {
  let bunBin;
  try {
    bunBin = readBunBin(process.argv[2] ?? process.cwd());
  } catch (error) {
    console.error(`[boffin] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (!(await bunAvailable(bunBin))) {
    console.error(`[boffin] ${bunBin} was not found. Install Bun to bundle static assets.`);
    process.exitCode = 1;
    return;
  }
  try {
    const manifest = await bundleStaticAssets({ projectRoot, bunBin });
    console.log(`[boffin] bundled static assets (${manifest.builtAt})`);
    console.log(`  app: ${manifest.app}`);
    console.log(`  spec: ${manifest.spec}`);
    console.log(`  styles: ${manifest.styles}`);
  } catch (error) {
    console.error(`[boffin] ${error.message}`);
    process.exitCode = 1;
  }
}

main();

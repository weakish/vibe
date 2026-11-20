import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildConversationOverview,
  clearOverviewStory,
  clipSummary,
  overviewPathForState,
  overviewPrompt,
  overviewRelativePath,
  readOverviewStory,
} from '../src/overview.js';

test('clips long texts and collapses whitespace', () => {
  assert.equal(clipSummary('  hello   world  ', 100), 'hello world');
  assert.equal(clipSummary('a'.repeat(10), 10), 'a'.repeat(10));
  assert.equal(clipSummary('a'.repeat(11), 10), `${'a'.repeat(10)}…`);
  assert.equal(clipSummary('héllo wörld', 5), 'héllo…');
});

test('resolves overview.md beside the state file and prompts for a short story', () => {
  const stateFile = '/srv/boffin/data/state.json';
  assert.equal(overviewPathForState(stateFile), '/srv/boffin/data/overview.md');
  assert.equal(overviewRelativePath('/srv/boffin', stateFile), 'data/overview.md');
  assert.match(overviewPrompt('data/overview.md'), /data\/overview\.md/);
  assert.match(overviewPrompt('data/overview.md'), /short, natural story/);
});

test('reads a missing overview file as empty and clears it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-overview-'));
  const file = path.join(dir, 'overview.md');
  assert.equal(await readOverviewStory(file), '');
  fs.writeFileSync(file, '  Ada and Ken caught up about camping.  \n');
  assert.equal(await readOverviewStory(file), 'Ada and Ken caught up about camping.');
  clearOverviewStory(file);
  assert.equal(await readOverviewStory(file), '');
});

test('an empty transcript digests to nothing', () => {
  const overview = buildConversationOverview({ items: [] });
  assert.equal(overview.empty, true);
  assert.equal(overview.story, '');
});

test('uses a saved short story when present', () => {
  const overview = buildConversationOverview({
    items: [{ id: '1', role: 'user', author: 'Ada', text: 'hi' }],
    story: 'Ada and Ken planned their weekend hike and checked what gear they still needed.',
  });
  assert.equal(overview.empty, false);
  assert.equal(overview.story, 'Ada and Ken planned their weekend hike and checked what gear they still needed.');
});

test('builds a concise fallback story without listing every turn', () => {
  const overview = buildConversationOverview({
    items: [
      { id: '1', role: 'user', author: 'Ada', text: 'add dark mode', attachments: [{ name: 'mock.png' }] },
      { id: '2', role: 'assistant', text: 'on it' },
      { id: '3', role: 'user', author: 'Ken', text: 'also check contrast' },
      { id: '4', role: 'user', author: 'Ken', text: 'and a toggle' },
      { id: '5', role: 'assistant', text: 'done', images: [{ id: 'x', name: 'shot.png', mime: 'image/png' }] },
      { id: '6', role: 'notice', level: 'error', text: 'bad line' },
    ],
  });
  assert.equal(overview.empty, false);
  assert.match(overview.story, /Ada/);
  assert.match(overview.story, /add dark mode/);
  assert.match(overview.story, /Ken/);
  assert.match(overview.story, /and a toggle/);
  assert.match(overview.story, /done/);
  assert.match(overview.story, /mock\.png/);
  assert.match(overview.story, /shot\.png/);
  assert.doesNotMatch(overview.story, /also check contrast/);
});

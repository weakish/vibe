import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_SHOPPING_ITEMS,
  emptyShoppingList,
  loadShoppingList,
  parseShoppingList,
  readShoppingList,
  shoppingListPathForState,
  shoppingListPrompt,
  shoppingListRelativePath,
  writeShoppingList,
} from '../src/shopping-list.js';

test('resolves the shopping list beside the state file', () => {
  const stateFile = '/srv/boffin/data/state.json';
  assert.equal(shoppingListPathForState(stateFile), '/srv/boffin/data/shopping-list.json');
  assert.equal(shoppingListRelativePath('/srv/boffin', stateFile), 'data/shopping-list.json');
  assert.match(shoppingListPrompt('data/shopping-list.json'), /data\/shopping-list\.json/);
  assert.match(shoppingListPrompt('data/shopping-list.json'), /already bought/);
});

test('parses a valid list and fills missing ids', () => {
  const list = parseShoppingList({
    items: [{ name: 'Milk', wantedBy: 'Ada', bought: false }],
  });
  assert.equal(list.version, 1);
  assert.equal(list.items.length, 1);
  assert.match(list.items[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(list.items[0].name, 'Milk');
  assert.equal(list.items[0].wantedBy, 'Ada');
  assert.equal(list.items[0].bought, false);
  assert.equal(list.items[0].boughtBy, '');
});

test('refuses an invalid PUT body', () => {
  assert.equal(parseShoppingList(null), null);
  assert.equal(parseShoppingList({ version: 2, items: [] }), null);
  assert.equal(parseShoppingList({ items: [{ name: '', bought: false }] }), null);
  assert.equal(parseShoppingList({ items: [{ name: 'Milk', bought: 'yes' }] }), null);
  assert.equal(parseShoppingList({ items: Array.from({ length: MAX_SHOPPING_ITEMS + 1 }, (_, i) => ({ name: `n${i}`, bought: false })) }), null);
});

test('loads a messy agent file without dropping the whole list', () => {
  const loaded = loadShoppingList(
    JSON.stringify({
      items: [
        { name: 'Eggs', bought: 1, wantedBy: 'Ken' },
        { name: '', bought: false },
        { id: 'not-a-uuid', name: 'Skip', bought: false },
      ],
    }),
  );
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].name, 'Eggs');
  assert.equal(loaded.items[0].bought, true);
  assert.equal(loadShoppingList('not json').items.length, 0);
  assert.deepEqual(loadShoppingList(''), emptyShoppingList());
});

test('reads a missing file as empty and writes atomically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-shop-'));
  const file = path.join(dir, 'shopping-list.json');
  assert.deepEqual(await readShoppingList(file), emptyShoppingList());
  const list = parseShoppingList({ items: [{ name: 'Rice', bought: false }] });
  await writeShoppingList(file, list);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.items[0].name, 'Rice');
});

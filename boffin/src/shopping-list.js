import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SHOPPING_VERSION = 1;
export const MAX_SHOPPING_ITEMS = 200;
export const MAX_SHOPPING_NAME = 200;
export const MAX_SHOPPING_NOTE = 500;
export const MAX_SHOPPING_WHO = 40;
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shoppingListPathForState(stateFile) {
  return path.join(path.dirname(stateFile), 'shopping-list.json');
}

export function shoppingListRelativePath(workdir, stateFile) {
  const full = shoppingListPathForState(stateFile);
  const relative = path.relative(workdir, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(full);
  }
  return relative.split(path.sep).join('/');
}

export function shoppingListPrompt(relativePath) {
  return (
    `Shopping list: ${relativePath} is version-1 JSON ` +
    `{"version":1,"items":[{"id":"<uuid>","name":"...","wantedBy":"...","bought":false,"boughtBy":"","note":""}]}. ` +
    `Whenever someone mentions they want or plan to buy something, or you think it is necessary to buy something for them ` +
    `(for example, they asked about or plan to do something and do not currently have the gear or supplies needed), ` +
    `add it (wantedBy is their name, and note can briefly say why) unless it is already on the list. ` +
    `If they already bought something, set bought true and boughtBy to their name. ` +
    `Leave the file unchanged when nothing needs to be bought or updated.`
  );
}

export function emptyShoppingList() {
  return { version: SHOPPING_VERSION, items: [] };
}

export function parseShoppingList(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  if (raw.version !== undefined && raw.version !== SHOPPING_VERSION) {
    return null;
  }
  if (!Array.isArray(raw.items) || raw.items.length > MAX_SHOPPING_ITEMS) {
    return null;
  }
  const items = [];
  const ids = new Set();
  for (const entry of raw.items) {
    const item = parseItem(entry, { generateId: true });
    if (!item || ids.has(item.id)) {
      return null;
    }
    ids.add(item.id);
    items.push(item);
  }
  return { version: SHOPPING_VERSION, items };
}

export function loadShoppingList(text) {
  if (text == null || text === '') {
    return emptyShoppingList();
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return emptyShoppingList();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.items)) {
    return emptyShoppingList();
  }
  const items = [];
  const ids = new Set();
  for (const entry of data.items) {
    if (items.length >= MAX_SHOPPING_ITEMS) {
      break;
    }
    const item = parseItem(entry, { generateId: true, coerce: true });
    if (!item || ids.has(item.id)) {
      continue;
    }
    ids.add(item.id);
    items.push(item);
  }
  return { version: SHOPPING_VERSION, items };
}

export async function readShoppingList(file) {
  try {
    return loadShoppingList(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptyShoppingList();
    }
    throw error;
  }
}

export async function writeShoppingList(file, list) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const body = `${JSON.stringify(list, null, 2)}\n`;
  try {
    await fs.writeFile(temp, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

function parseItem(entry, { generateId, coerce = false }) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const name = clip(entry.name, MAX_SHOPPING_NAME, coerce);
  if (!name) {
    return null;
  }
  let id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!id && generateId) {
    id = randomUUID();
  }
  if (!ITEM_ID.test(id)) {
    return null;
  }
  const wantedBy = clip(entry.wantedBy, MAX_SHOPPING_WHO, coerce);
  const boughtBy = clip(entry.boughtBy, MAX_SHOPPING_WHO, coerce);
  const note = clip(entry.note, MAX_SHOPPING_NOTE, coerce);
  const bought = coerce ? Boolean(entry.bought) : entry.bought;
  if (wantedBy == null || boughtBy == null || note == null || typeof bought !== 'boolean') {
    return null;
  }
  return { id, name, wantedBy, bought, boughtBy, note };
}

function clip(value, max, coerce) {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    return coerce ? '' : null;
  }
  const text = value.trim();
  if (text.length > max) {
    return coerce ? text.slice(0, max) : null;
  }
  return text;
}

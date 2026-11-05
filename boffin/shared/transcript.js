// Transcript operations are produced by the server and replayed by the browser,
// so both sides must apply them with exactly the same logic.
export function applyOp(items, op) {
  switch (op?.op) {
    case 'add': {
      const item = { ...op.item };
      const index = items.findIndex((entry) => entry.id === item.id);
      if (index === -1) {
        items.push(item);
      } else {
        items[index] = item;
      }
      break;
    }
    case 'append': {
      const item = items.find((entry) => entry.id === op.id);
      if (item) {
        item.text = `${item.text ?? ''}${op.text}`;
      }
      break;
    }
    case 'set': {
      const item = items.find((entry) => entry.id === op.id);
      if (item) {
        Object.assign(item, op.patch);
      }
      break;
    }
    default:
      break;
  }
  return items;
}

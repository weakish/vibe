// Hues stay apart on the wheel and skip yellow, which fails as a bubble color.
const MEMBER_HUES = [
  0, 14, 28, 84, 98, 112, 126, 140, 154, 168, 182, 196, 210, 224, 238, 252, 266, 280, 294, 308, 322, 336, 350,
];

const assigned = new Map();
const used = new Set();

function hashName(name) {
  let hash = 0;
  for (const char of name) {
    hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  }
  return hash;
}

function hueDistance(left, right) {
  const delta = Math.abs(left - right);
  return Math.min(delta, 360 - delta);
}

// The first member keeps a hue from their name. Each later member takes the
// unused hue farthest from those already chosen, so two people do not land
// on neighboring teals.
export function memberHue(name) {
  const remembered = assigned.get(name);
  if (remembered != null) {
    return remembered;
  }
  const preferred = MEMBER_HUES[hashName(name) % MEMBER_HUES.length];
  let chosen = preferred;
  let best = -1;
  for (const hue of MEMBER_HUES) {
    if (used.has(hue)) {
      continue;
    }
    const dist =
      used.size === 0 ? 360 : Math.min(...[...used].map((taken) => hueDistance(hue, taken)));
    const score = dist + (hue === preferred ? 0.5 : 0);
    if (score > best) {
      best = score;
      chosen = hue;
    }
  }
  used.add(chosen);
  assigned.set(name, chosen);
  return chosen;
}

export function resetMemberColors() {
  assigned.clear();
  used.clear();
}

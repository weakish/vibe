// Extractive content digest of the transcript for the overview view.
// Pure: no fs access. Long texts are clipped to excerpts; nothing is sent to
// an agent, so opening the overview is instant and works offline.
const TOPIC_CHARS = 500;
const EXCERPT_CHARS = 300;
const SUMMARY_CHARS = 200;

export function clipSummary(text, max) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if ([...flat].length <= max) {
    return flat;
  }
  return `${[...flat].slice(0, max).join('').trimEnd()}…`;
}

function itemText(item) {
  return typeof item?.text === 'string' ? item.text.trim() : '';
}

function authorName(item) {
  return typeof item?.author === 'string' && item.author.trim() ? item.author.trim() : '';
}

function toolName(item) {
  return typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : 'Tool';
}

function fileNames(items) {
  const names = [];
  const seen = new Set();
  for (const item of items ?? []) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    for (const list of [item.attachments, item.images]) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const file of list) {
        const name = typeof file?.name === 'string' ? file.name.trim() : '';
        if (name && !seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
    }
  }
  return names;
}

// Sections follow the conversation: the opening request first, then what each
// side said, what the agent did, the materials involved, and what went wrong.
export function buildConversationOverview({ items = [] } = {}) {
  const list = Array.isArray(items) ? items : [];
  const firstUser = list.find((item) => item?.role === 'user' && itemText(item));
  const requests = [];
  const responses = [];
  const work = [];
  const issues = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.role === 'user') {
      const text = itemText(item);
      if (text) {
        requests.push({ author: authorName(item), text: clipSummary(text, EXCERPT_CHARS) });
      }
    } else if (item.role === 'assistant') {
      const text = itemText(item);
      if (text) {
        responses.push({ text: clipSummary(text, EXCERPT_CHARS) });
      }
    } else if (item.role === 'tool') {
      work.push({
        name: toolName(item),
        summary: clipSummary(typeof item.summary === 'string' ? item.summary : '', SUMMARY_CHARS),
      });
    } else if (item.role === 'notice' && item.level === 'error') {
      const text = itemText(item);
      if (text) {
        issues.push({ text: clipSummary(text, EXCERPT_CHARS) });
      }
    }
  }

  return {
    empty: requests.length === 0 && responses.length === 0 && work.length === 0,
    topic: firstUser
      ? { author: authorName(firstUser), text: clipSummary(itemText(firstUser), TOPIC_CHARS) }
      : null,
    requests,
    responses,
    work,
    materials: fileNames(list),
    issues,
  };
}

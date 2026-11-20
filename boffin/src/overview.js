import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Short-story overview of the conversation.
// The agent maintains overview.md beside state.json as a cohesive narrative;
// when that file is absent, buildConversationOverview composes a brief fallback
// story from the transcript without listing every turn.
const EXCERPT_CHARS = 160;

export function overviewPathForState(stateFile) {
  return path.join(path.dirname(stateFile), 'overview.md');
}

export function overviewRelativePath(workdir, stateFile) {
  const full = overviewPathForState(stateFile);
  const relative = path.relative(workdir, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(full);
  }
  return relative.split(path.sep).join('/');
}

export function overviewPrompt(relativePath) {
  return (
    `Conversation overview: maintain ${relativePath} as a short, natural story of what everyone has talked about so far, ` +
    `like answering a friend who asks "Oh, you met your old school mates yesterday. What did you talk about during the reunion?" ` +
    `Rewrite it into a brief, cohesive paragraph (or two short paragraphs) as the conversation evolves—do not summarize every turn or append to a list.`
  );
}

export async function readOverviewStory(file) {
  try {
    return (await fsp.readFile(file, 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function clearOverviewStory(file) {
  fs.rmSync(file, { force: true });
}

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

function formatNames(names) {
  if (names.length === 0) {
    return '';
  }
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
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

export function buildConversationOverview({ items = [], story = '' } = {}) {
  const saved = typeof story === 'string' ? story.trim() : '';
  if (saved) {
    return { empty: false, story: saved };
  }

  const list = Array.isArray(items) ? items : [];
  const userTurns = [];
  const assistantTurns = [];
  const participants = [];
  const seenParticipants = new Set();
  let hasErrors = false;

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.role === 'user') {
      const text = itemText(item);
      const author = authorName(item);
      if (author && !seenParticipants.has(author)) {
        seenParticipants.add(author);
        participants.push(author);
      }
      if (text) {
        userTurns.push({ author, text });
      }
    } else if (item.role === 'assistant') {
      const text = itemText(item);
      if (text) {
        assistantTurns.push(text);
      }
    } else if (item.role === 'notice' && item.level === 'error' && itemText(item)) {
      hasErrors = true;
    }
  }

  if (userTurns.length === 0 && assistantTurns.length === 0) {
    return { empty: true, story: '' };
  }

  const sentences = [];
  const first = userTurns[0];
  if (first) {
    const opener = first.author || 'Someone';
    sentences.push(`${opener} started the conversation by bringing up "${clipSummary(first.text, EXCERPT_CHARS)}".`);
  }

  if (participants.length > 1) {
    const others = participants.slice(1);
    sentences.push(`${formatNames(others)} also joined in as the discussion went on.`);
  }

  const lastUser = userTurns.length > 1 ? userTurns[userTurns.length - 1] : null;
  if (lastUser) {
    const speaker = lastUser.author || 'They';
    sentences.push(`Later on, ${speaker} steered things toward "${clipSummary(lastUser.text, EXCERPT_CHARS)}".`);
  }

  const lastAssistant = assistantTurns[assistantTurns.length - 1];
  if (lastAssistant) {
    sentences.push(`Most recently, the assistant wrapped up with "${clipSummary(lastAssistant, EXCERPT_CHARS)}".`);
  }

  const files = fileNames(list);
  if (files.length > 0) {
    const shown = files.slice(0, 3);
    const extra = files.length > 3 ? ` and ${files.length - 3} more` : '';
    sentences.push(`Along the way, ${formatNames(shown)}${extra} came up in the chat.`);
  }

  if (hasErrors) {
    sentences.push('There were a few hiccups along the way.');
  }

  return { empty: false, story: sentences.join(' ') };
}

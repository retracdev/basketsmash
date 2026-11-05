import { checkAccountSession, getAccountSession, subscribeAccountSession } from './account-session.js';

export const LEADERBOARDS = [
  { id: 'play-game', label: 'Play Game', mode: null },
  { id: 'three-point-shootout', label: '3-Point Shootout', mode: 'shootout' },
  { id: 'around-the-world', label: 'Around the World', mode: 'world' },
  { id: 'hot-spots', label: 'Hot Spots', mode: 'hotspots' },
];
const API = 'https://space-api.retrac-space.workers.dev';
const completed = new WeakSet();
const pending = new Set();
const listeners = new Set();
let submissionChain = Promise.resolve();
let recognizedUsername = getAccountSession().status === 'authenticated' ? getAccountSession().username : null;
subscribeAccountSession((session) => {
  if (session.status === 'authenticated') recognizedUsername = session.username;
  else if (session.status === 'guest') recognizedUsername = null;
});

class RequestError extends Error {
  constructor(status, retryAfter = 0) {
    super('Leaderboard request failed');
    this.status = status;
    this.retryable = status === 0 || status === 429 || status >= 500;
    this.retryAfter = retryAfter;
  }
}

function boardPath(board) {
  if (!LEADERBOARDS.some((b) => b.id === board)) throw new RequestError(400);
  return `${API}/v1/games/basketsmash/leaderboards/${board}`;
}

async function requestJson(url, options, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 8000);
  try {
    const response = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
    if (!response.ok) {
      const delay = Math.min(60000, Math.max(0, Number(response.headers.get('Retry-After')) * 1000));
      throw new RequestError(response.status, response.status === 429 ? delay || 60000 : delay);
    }
    const body = await response.json();
    if (controller.signal.aborted) throw new RequestError(0);
    return body;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(0);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function freshToken(username, signal) {
  const session = await checkAccountSession();
  if (session.status === 'error') throw new RequestError(503);
  if (session.status !== 'authenticated' || session.username !== username) throw new RequestError(401);
  const body = await requestJson('https://accounts.retrac.space/api/auth/token', {
    method: 'GET', credentials: 'include',
  }, signal);
  if (typeof body?.token !== 'string' || !body.token || body.token.length > 8192) throw new RequestError(401);
  return body.token;
}

function personalResult(data) {
  if (data?.personalBest === null && data?.rank === null) return data;
  if (!validScore(data?.personalBest) || !Number.isSafeInteger(data?.rank) || data.rank < 1) throw new RequestError(503);
  return { personalBest: data.personalBest, rank: data.rank };
}

export function validScore(score) {
  return Number.isSafeInteger(score) && score >= 0 && score <= 1000000;
}

export async function getRankings(board, offset = 0, signal) {
  const body = await requestJson(`${boardPath(board)}?limit=25&offset=${offset}`, { credentials: 'omit' }, signal);
  const data = body?.data;
  if (!Array.isArray(data?.entries) || !data.entries.every((entry) =>
    Number.isSafeInteger(entry.rank) && entry.rank > 0 && typeof entry.username === 'string' && validScore(entry.score)) ||
    !(data.nextOffset === null || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset))) {
    throw new RequestError(503);
  }
  // The API permits offsets up to 10,000, even if its final page advertises another.
  return { ...data, nextOffset: data.nextOffset > 10000 ? null : data.nextOffset };
}

export async function getPersonalBest(board, username, signal) {
  const token = await freshToken(username, signal);
  const body = await requestJson(`${boardPath(board)}/me`, {
    credentials: 'omit', headers: { Authorization: `Bearer ${token}` },
  }, signal);
  return personalResult(body?.data);
}

export function subscribeLeaderboardChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Invoked only by genuine completion callbacks. No local records are imported.
export function submitCompletedScore(round, board, score, onUpdate) {
  if (completed.has(round)) return;
  completed.add(round);
  // A concurrent refresh must not discard a round from a previously recognized account.
  // Every actual write still rechecks the live session and matching username.
  if (!validScore(score) || !LEADERBOARDS.some((b) => b.id === board) || !recognizedUsername) return;
  if (pending.size >= 16) {
    onUpdate({ status: 'unconfirmed' });
    return;
  }
  const item = { board, score, username: recognizedUsername, attempts: 0, created: Date.now(), onUpdate };
  pending.add(item);
  onUpdate({ status: 'submitting' });
  queue(item);
}

function queue(item, delay = 0) {
  setTimeout(() => {
    submissionChain = submissionChain.then(() => attempt(item)).catch(() => {
      pending.delete(item);
      item.onUpdate({ status: 'unconfirmed' });
    });
  }, delay);
}

async function attempt(item) {
  if (Date.now() - item.created > 180000) {
    pending.delete(item);
    item.onUpdate({ status: 'unconfirmed' });
    return;
  }
  item.attempts++;
  try {
    // Short-lived token exists only in this attempt; fresh session prevents cross-account retries.
    const token = await freshToken(item.username);
    const headers = { Authorization: `Bearer ${token}` };
    if (item.initialBest === undefined) {
      const before = await requestJson(`${boardPath(item.board)}/me`, { credentials: 'omit', headers });
      item.initialBest = personalResult(before?.data).personalBest;
    }
    const body = await requestJson(`${boardPath(item.board)}/scores`, {
      method: 'POST', credentials: 'omit',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ score: item.score }),
    });
    const confirmed = personalResult(body?.data);
    if (confirmed.personalBest === null || confirmed.personalBest < item.score) throw new RequestError(503);
    const improved = confirmed.personalBest === item.score && (item.initialBest === null || confirmed.personalBest > item.initialBest);
    pending.delete(item);
    item.onUpdate({ status: 'saved', improved, ...confirmed });
    for (const listener of listeners) listener(item.board);
  } catch (error) {
    // A UI listener failure after confirmation must never cause another POST.
    if (!pending.has(item)) return;
    const delay = Math.max(error.retryAfter || 0, item.attempts === 1 ? 3000 : 12000);
    if (error.retryable && item.attempts < 3 && Date.now() - item.created + delay < 180000) {
      item.onUpdate({ status: 'retrying' });
      queue(item, delay);
    } else {
      pending.delete(item);
      item.onUpdate({ status: error.status === 401 || error.status === 403 ? 'auth' : 'unconfirmed' });
    }
  }
}

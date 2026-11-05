let state = { status: 'unknown' };
let inFlight = null;
const listeners = new Set();

export const getAccountSession = () => state;

export function subscribeAccountSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next) {
  state = next;
  for (const listener of listeners) listener(state);
  return state;
}

// One shared, read-only request for startup, manual retries, and return-to-tab checks.
export function checkAccountSession() {
  if (inFlight) return inFlight;
  inFlight = requestSession();
  return inFlight;
}

async function requestSession() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  publish({ status: 'checking' });
  try {
    const response = await fetch('https://accounts.retrac.space/api/auth/get-session', {
      method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new Error('Session unavailable');
    const session = await response.json();
    if (controller.signal.aborted) throw new Error('Session timed out');
    const username = session?.user?.username;
    if (typeof username === 'string' && username.trim()) {
      return publish({ status: 'authenticated', username });
    }
    if (session === null) return publish({ status: 'guest' });
    return publish({ status: 'error' });
  } catch {
    return publish({ status: 'error' });
  } finally {
    clearTimeout(timeout);
    inFlight = null;
  }
}

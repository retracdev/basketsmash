import './account-welcome.css';

const greetings = [
  (username) => `Welcome back, ${username}`,
  (username) => `Good to see you, ${username}`,
  (username) => `Hey again, ${username}`,
  (username) => `Ready for another round, ${username}?`,
  (username) => `Glad you're here, ${username}`,
];

let sessionChecked = false;

// Called only from page startup, independently of game loading and scene changes.
export function initAccountWelcome() {
  if (sessionChecked) return;
  sessionChecked = true;
  void checkSession();
}

async function checkSession() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    // The browser sends the account host's own cookies; never read or copy tokens.
    const response = await fetch('https://accounts.retrac.space/api/auth/get-session', {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return;
    const session = await response.json();
    const username = session?.user?.username;
    if (!controller.signal.aborted && typeof username === 'string' && username.trim()) {
      showWelcomePill(username);
    }
  } catch {
    // Guests, timeouts, network failures, and CORS denials never interrupt play.
  } finally {
    clearTimeout(timeout);
  }
}

function showWelcomePill(username) {
  const pill = document.createElement('div');
  pill.className = 'welcome-pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  pill.setAttribute('aria-atomic', 'true');
  pill.innerHTML = `
    <img class="brand-icon" alt="" aria-hidden="true">
    <div class="pill-content">
      <div class="brand-name">retrac.space</div>
      <div class="message"></div>
      <div class="login-confirmation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="m8 12 2.5 2.5L16 9"></path>
        </svg>
        <span>Logged in with your retrac.space account.</span>
      </div>
    </div>
    <span class="check" aria-hidden="true">✓</span>`;
  // Reuse the supplied Retrac favicon without altering or recreating it.
  pill.querySelector('.brand-icon').src = new URL(
    `${import.meta.env.BASE_URL}alt-favicon.png`, document.baseURI,
  ).href;
  // Fullscreen targets document.documentElement, so body overlays stay visible.
  document.body.append(pill);
  setTimeout(() => {
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    // Account-controlled text must never be interpreted as HTML.
    pill.querySelector('.message').textContent = greeting(username);
    pill.classList.add('visible');
  }, 250);
  setTimeout(() => {
    pill.classList.remove('visible');
    pill.classList.add('leaving');
  }, 3400);
  setTimeout(() => pill.remove(), 3800);
}

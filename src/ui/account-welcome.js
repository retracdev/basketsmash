import './account-welcome.css';
import { checkAccountSession, getAccountSession } from '../core/account-session.js';

const greetings = [
  (username) => `Welcome back, ${username}`,
  (username) => `Good to see you, ${username}`,
  (username) => `Hey again, ${username}`,
  (username) => `Ready for another round, ${username}?`,
  (username) => `Glad you're here, ${username}`,
];

let sessionChecked = false;
let welcomeShown = false;

// Called only from page startup, independently of game loading and scene changes.
export function initAccountWelcome() {
  if (sessionChecked) return;
  sessionChecked = true;
  void checkAccountSession().then(welcomeAuthenticatedAccount);
}

export function welcomeAuthenticatedAccount() {
  const session = getAccountSession();
  if (welcomeShown || session.status !== 'authenticated') return;
  welcomeShown = true;
  showWelcomePill(session.username);
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

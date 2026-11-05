import { checkAccountSession, getAccountSession } from '../core/account-session.js';
import { welcomeAuthenticatedAccount } from './account-welcome.js';
import { input } from '../core/input.js';
import './account-sign-in.css';

export const accountIconUrl = new URL(
  `${import.meta.env.BASE_URL}alt-favicon.png`, document.baseURI,
).href;

const screens = {
  confirm: {
    title: 'Connect your retrac.space account',
    description: "We'll open retrac.space Accounts in a new tab. Sign in or create an account there, then return to Basketsmash to continue.",
    actions: [['open', 'Continue to retrac.space'], ['cancel', 'Cancel']],
  },
  waiting: {
    title: 'Finish signing in',
    description: "Sign in or create your account in the new tab. When you're finished, come back here.",
    actions: [['verify', "I've signed in"], ['open', 'Open accounts again'], ['cancel', 'Cancel']],
  },
  checking: {
    title: 'Checking your session', description: 'Just a moment while we check your retrac.space account.',
    actions: [['cancel', 'Cancel']],
  },
  guest: {
    title: 'Not signed in yet',
    description: "We couldn't find an active retrac.space session. Finish signing in or creating your account, then return here and try again.",
    actions: [['verify', 'Try again'], ['open', 'Open accounts'], ['cancel', 'Cancel']],
  },
  error: {
    title: "Couldn't check your session",
    description: 'We could not reach retrac.space Accounts right now. Please try again in a moment. You can keep playing without signing in.',
    actions: [['verify', 'Try again'], ['open', 'Open accounts'], ['cancel', 'Cancel']],
  },
  success: {
    title: 'All set!', description: '', actions: [['done', "Let's play!"]],
  },
};

export class AccountSignIn {
  constructor(menus) {
    this.menus = menus;
    this.flow = 0;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'account-dialog';
    this.dialog.setAttribute('aria-labelledby', 'account-dialog-title');
    this.dialog.setAttribute('aria-describedby', 'account-dialog-description');
    document.body.append(this.dialog);
    this.dialog.addEventListener('click', (event) => {
      const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
      if (action === 'open') this.openAccounts();
      else if (action === 'verify') void this.verify();
      else if (action === 'cancel' || action === 'done') this.close();
    });
    // Native dialog focus trapping and button activation take priority over game input.
    this.dialog.addEventListener('keydown', (event) => event.stopPropagation());
    this.dialog.addEventListener('keyup', (event) => event.stopPropagation());
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.markAway();
      else this.onReturn();
    });
    window.addEventListener('blur', () => this.markAway());
    window.addEventListener('focus', () => this.onReturn());
  }

  get isOpen() { return this.dialog.open; }

  show() {
    if (this.isOpen || getAccountSession().status !== 'guest') return;
    this.flow++;
    this.started = false;
    this.away = false;
    this.trigger = this.menus.root.querySelector('[data-act="account"]');
    input.keys.clear();
    this.render('confirm');
    this.dialog.showModal();
    this.dialog.querySelector('button').focus();
  }

  render(stage) {
    this.stage = stage;
    const screen = screens[stage];
    const waiting = stage === 'waiting' || stage === 'checking';
    this.dialog.innerHTML = `<section class="board account-dialog-panel" data-stage="${stage}">
      <div class="account-dialog-brand"><img src="${accountIconUrl}" alt="Retrac Labs"><span>retrac.space</span></div>
      <h2 id="account-dialog-title">${screen.title}</h2>
      <p id="account-dialog-description"></p>
      ${waiting ? '<div class="account-waiting" role="status"><span aria-hidden="true"></span>Waiting for your account</div>' : ''}
      ${stage === 'success' ? '<div class="account-success-check" aria-hidden="true">&#10003;</div>' : ''}
      <div class="account-dialog-actions">${screen.actions.map(([action, label], i) =>
        `<button type="button" class="btn ${i ? 'dark' : ''}" data-account-action="${action}">${label}</button>`).join('')}
      </div>
    </section>`;
    this.dialog.querySelector('#account-dialog-description').textContent = stage === 'success'
      ? `You're signed in as ${getAccountSession().username}. Your retrac.space account is now connected to Basketsmash.`
      : screen.description;
    if (this.isOpen) this.dialog.querySelector('button').focus({ preventScroll: true });
  }

  openAccounts() {
    // This runs directly in a native button click, with browser user activation intact.
    this.started = true;
    this.away = false;
    window.open('https://accounts.retrac.space', '_blank', 'noopener');
    this.render('waiting');
  }

  markAway() {
    if (this.isOpen && this.started && this.stage !== 'success') this.away = true;
  }

  onReturn() {
    if (!this.isOpen || !this.started || !this.away || document.hidden || !document.hasFocus()) return;
    this.away = false;
    clearTimeout(this.returnTimer);
    // visibilitychange and focus commonly arrive together; consume one return only.
    this.returnTimer = setTimeout(() => {
      if (document.hidden || !document.hasFocus()) this.markAway();
      else if (this.isOpen && this.started && this.stage !== 'success') void this.verify();
    }, 200);
  }

  async verify() {
    clearTimeout(this.returnTimer);
    if (!this.isOpen || this.checking) return;
    this.away = false;
    const flow = this.flow;
    this.checking = true;
    this.render('checking');
    try {
      const session = await checkAccountSession();
      if (!this.isOpen || this.flow !== flow) return;
      this.render(session.status === 'authenticated' ? 'success' : session.status === 'guest' ? 'guest' : 'error');
    } finally {
      if (this.flow === flow) this.checking = false;
    }
  }

  close() {
    const success = this.stage === 'success';
    this.flow++;
    this.started = false;
    this.checking = false;
    clearTimeout(this.returnTimer);
    this.dialog.close();
    input.keys.clear();
    this.menus.updateAccountCard();
    if (this.trigger?.isConnected && !this.trigger.closest('[hidden]')) {
      this.menus.setFocus(this.menus.navs().indexOf(this.trigger), false);
      this.trigger.focus({ preventScroll: true });
    } else {
      this.menus.setFocus(0, false);
      this.menus.root.tabIndex = -1;
      this.menus.root.focus({ preventScroll: true });
    }
    if (success) welcomeAuthenticatedAccount();
  }
}

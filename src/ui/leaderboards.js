import { LEADERBOARDS, getRankings, getPersonalBest, subscribeLeaderboardChanges } from '../core/leaderboards.js';
import { getAccountSession, subscribeAccountSession } from '../core/account-session.js';
import { accountIconUrl } from './account-sign-in.js';
import { input } from '../core/input.js';
import './leaderboards.css';

export class LeaderboardPanel {
  constructor(menus) {
    this.menus = menus;
    this.board = LEADERBOARDS[0].id;
    this.version = 0;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'leaderboard-dialog';
    this.dialog.setAttribute('aria-labelledby', 'leaderboard-title');
    document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('keyup', (event) => event.stopPropagation());
    this.dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      const tabs = [...this.dialog.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(event.target);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      this.select(tabs[next].dataset.board);
    });
    this.dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.board) return this.select(button.dataset.board);
      switch (button.dataset.lbAction) {
        case 'close': this.close(); break;
        case 'retry': void this.load(); break;
        case 'more': void this.load(true); break;
        case 'personalRetry': void this.loadPersonal(); break;
        case 'signIn':
          this.close();
          this.menus.show('main');
          this.menus.accountDialog.show();
          break;
        case 'play': {
          const board = LEADERBOARDS.find((b) => b.id === this.board);
          this.close();
          this.menus.show('team', board.mode ? { flow: 'arcade', mode: board.mode } : { flow: 'match' });
          break;
        }
      }
    });
    subscribeAccountSession((session) => {
      if (!this.isOpen || session.status === 'checking' || session.status === 'error') return;
      const changed = this.account?.status !== session.status || this.account?.username !== session.username;
      this.account = session;
      this.renderAccount();
      this.renderRows();
      if (changed) void this.loadPersonal();
    });
    subscribeLeaderboardChanges((board) => {
      if (this.isOpen && this.board === board) void this.load();
    });
  }

  get isOpen() { return this.dialog.open; }

  show() {
    if (this.isOpen) return;
    input.keys.clear();
    this.account = getAccountSession();
    this.entries = [];
    this.nextOffset = null;
    this.dialog.innerHTML = `<section class="board leaderboard-panel">
      <div class="leaderboard-heading"><h2 id="leaderboard-title">LEADERBOARDS</h2>
        <button type="button" class="btn dark small" data-lb-action="close">BACK</button></div>
      <div class="leaderboard-tabs" role="tablist" aria-label="Game mode">${LEADERBOARDS.map((board) =>
        `<button type="button" role="tab" id="tab-${board.id}" data-board="${board.id}" aria-controls="leaderboard-rankings">${board.label}</button>`).join('')}</div>
      <section class="leaderboard-personal" aria-label="Your personal best" hidden></section>
      <section id="leaderboard-rankings" role="tabpanel" tabindex="0">
        <div class="leaderboard-status" role="status" aria-live="polite"></div>
        <div class="leaderboard-table-wrap"><table class="leaderboard-table"><caption class="lb-sr-only">Personal-best rankings</caption>
          <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Personal best</th></tr></thead><tbody></tbody></table></div>
        <button type="button" class="btn dark small leaderboard-more" data-lb-action="more" hidden>Load More</button>
      </section>
      <section class="leaderboard-invite account-card" hidden><h3>Show off your skills.</h3>
        <p>Want to see your name on the leaderboard? Sign in or create a free retrac.space account to save your best scores.</p>
        <button type="button" class="btn" data-lb-action="signIn"><img src="${accountIconUrl}" alt="" aria-hidden="true"><span>Sign in with retrac.space</span></button>
      </section>
    </section>`;
    this.dialog.showModal();
    this.select(this.board);
    this.dialog.querySelector(`[data-board="${this.board}"]`).focus();
  }

  select(board) {
    this.board = board;
    this.dialog.querySelectorAll('[role="tab"]').forEach((tab) => {
      const selected = tab.dataset.board === board;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    this.dialog.querySelector('[role="tabpanel"]').setAttribute('aria-labelledby', `tab-${board}`);
    void this.load();
  }

  renderAccount() {
    this.dialog.querySelector('.leaderboard-invite').hidden = this.account?.status !== 'guest';
    this.dialog.querySelector('.leaderboard-personal').hidden = this.account?.status !== 'authenticated';
  }

  async load(more = false) {
    if (!this.isOpen || (more && (this.loading || this.nextOffset === null))) return;
    if (!more) {
      this.version++;
      this.rowsController?.abort();
      this.personalController?.abort();
      this.entries = [];
      this.nextOffset = null;
      this.error = false;
      void this.loadPersonal();
    }
    const version = this.version;
    const offset = more ? this.nextOffset : 0;
    this.loading = true;
    this.error = false;
    this.rowsController = new AbortController();
    this.renderAccount();
    this.renderRows();
    try {
      const data = await getRankings(this.board, offset, this.rowsController.signal);
      if (!this.isOpen || version !== this.version) return;
      // Preserve the server's order and actual rank numbers, including any gaps.
      const ranks = new Set(this.entries.map((entry) => entry.rank));
      this.entries.push(...data.entries.filter((entry) => !ranks.has(entry.rank)));
      this.nextOffset = data.nextOffset;
    } catch {
      if (!this.isOpen || version !== this.version) return;
      this.error = true;
    } finally {
      if (this.isOpen && version === this.version) {
        this.loading = false;
        this.renderRows();
      }
    }
  }

  renderRows() {
    if (!this.isOpen) return;
    const status = this.dialog.querySelector('.leaderboard-status');
    const table = this.dialog.querySelector('.leaderboard-table-wrap');
    const tbody = this.dialog.querySelector('tbody');
    tbody.replaceChildren();
    for (const entry of this.entries) {
      const row = document.createElement('tr');
      if (entry.rank <= 3) row.classList.add(`podium-${entry.rank}`);
      if (this.account?.status === 'authenticated' && entry.username === this.account.username) row.classList.add('your-entry');
      for (const text of [`#${entry.rank}`, entry.username, entry.score.toLocaleString()]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      tbody.append(row);
    }
    table.hidden = !this.entries.length;
    status.replaceChildren();
    if (this.loading) status.textContent = 'Loading rankings…';
    else if (this.error) {
      status.innerHTML = '<h3>The scoreboard is taking a timeout.</h3><p>We couldn\'t load the rankings right now. Try again in a moment.</p><button type="button" class="btn dark small" data-lb-action="retry">Retry</button>';
    } else if (!this.entries.length) {
      status.innerHTML = '<h3>The court is yours.</h3><p>No scores yet. Be the first to make your mark!</p>';
      if (this.account?.status === 'authenticated') status.insertAdjacentHTML('beforeend', '<button type="button" class="btn small" data-lb-action="play">Play Now</button>');
    }
    const more = this.dialog.querySelector('.leaderboard-more');
    more.hidden = this.nextOffset === null || this.error;
    more.disabled = this.loading;
    this.dialog.querySelector('[role="tabpanel"]').setAttribute('aria-busy', String(!!this.loading));
  }

  async loadPersonal() {
    this.personalController?.abort();
    this.personalController = new AbortController();
    const controller = this.personalController;
    const version = this.version;
    this.renderAccount();
    if (this.account?.status !== 'authenticated') return;
    const section = this.dialog.querySelector('.leaderboard-personal');
    section.textContent = 'Loading your personal best…';
    try {
      const personal = await getPersonalBest(this.board, this.account.username, controller.signal);
      if (!this.isOpen || version !== this.version || controller !== this.personalController) return;
      section.innerHTML = '<h3>YOUR PERSONAL BEST</h3><p></p>';
      section.querySelector('p').textContent = personal.personalBest === null
        ? 'No score yet. Play a round to earn your place!'
        : `Score: ${personal.personalBest.toLocaleString()} · Rank: #${personal.rank}`;
    } catch {
      if (!this.isOpen || version !== this.version || controller !== this.personalController) return;
      section.innerHTML = '<h3>YOUR PERSONAL BEST</h3><p>We couldn\'t verify your personal ranking. Your public rankings are still available. If your session expired, sign in again from the main menu.</p><button type="button" class="btn dark small" data-lb-action="personalRetry">Retry</button>';
    }
  }

  close() {
    this.version++;
    this.rowsController?.abort();
    this.personalController?.abort();
    this.dialog.close();
    input.keys.clear();
    const index = this.menus.navs().findIndex((button) => button.dataset.act === 'leaderboards');
    this.menus.setFocus(Math.max(0, index), false);
    this.menus.root.tabIndex = -1;
    this.menus.root.focus({ preventScroll: true });
  }
}

export function submissionMarkup(state) {
  if (!state) return '';
  if (state.status === 'saved') return state.improved
    ? `<strong>NEW PERSONAL BEST!</strong><span>Your score is on the leaderboard. Rank: #${state.rank}</span>`
    : '<span>Score recorded. Your personal best still stands!</span>';
  const messages = {
    submitting: 'Recording your score…',
    retrying: 'Score not confirmed yet. Retrying shortly…',
    auth: 'Your session expired or changed. Sign in again to save future scores.',
    unconfirmed: 'Your score could not be confirmed. If the request reached the server, rankings may still update.',
  };
  return `<span>${messages[state.status] || ''}</span>`;
}

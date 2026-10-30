import '../boot';
import { BANK, type AccountSummary, type SessionInfo } from '@dddbanker/shared';
import { ApiClient } from '../api/client';
import { sounds } from '../audio/sounds';
import { SessionWatcher } from '../auth/sessionWatcher';
import { SettingsStore, defaultSettings, type Settings } from '../settings/settings';
import { helpDesk, notificationsWindow } from '../stations/banking/help';
import { TYPE_LABEL, type BankContext } from '../stations/banking/kit';
import { runStation } from '../stations/handlers';
import { STATIONS, type StationDef } from '../stations/stations';
import { DialogStack, h } from '../ui/dialogs';
import { createHelpDialog, createSettingsDialog } from '../ui/menus';
import { TimeoutWarning } from '../ui/timeoutWarning';
import { installMenuKeys } from '../ui/windows/menuKeys';
import { balanceCell } from '../ui/windows/money';
import { Windows } from '../ui/windows/windows';

/**
 * Classic view: the whole bank as a plain web page. Same API, same station
 * menus and windows as the 3D bank, laid out as headings, a table and
 * buttons. Nothing here needs a mouse, WebGL, or good eyesight for 3D.
 */

function safeLocalStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    storage.getItem('probe');
    return storage;
  } catch {
    return null;
  }
}

function applyDocumentSettings(s: Settings) {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(s.textScale));
  root.dataset.readableFont = String(s.readableFont);
  root.dataset.contrast = s.highContrast ? 'high' : 'normal';
  root.dataset.reducedMotion = String(s.reducedMotion);
  root.dataset.statusColors = s.statusColors;
  sounds.configure(s);
}

const media = (q: string) => window.matchMedia(q).matches;
const store = new SettingsStore(
  safeLocalStorage(),
  defaultSettings({
    prefersReducedMotion: media('(prefers-reduced-motion: reduce)'),
    prefersMoreContrast: media('(prefers-contrast: more)'),
    lowPowerDevice: false,
  }),
);
store.subscribe(applyDocumentSettings);

const uiRoot = document.getElementById('ui')!;
const app = document.getElementById('app')!;
const api = new ApiClient();
const watcher = new SessionWatcher(api);
const dialogs = new DialogStack();
// Text appears at once here: the classic view is about getting things done.
const ui = new Windows(dialogs, uiRoot, () => true);
const settingsDialog = createSettingsDialog(store);
const helpDialog = createHelpDialog(store);
uiRoot.append(settingsDialog, helpDialog);
new TimeoutWarning(watcher, dialogs, uiRoot);
installMenuKeys();

const bank: BankContext = { watcher, api, ui, openControls: () => dialogs.open(helpDialog) };

// ---------- Page structure ----------

const announcer = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
const status = h('p', { class: 'classic-status' });
const accountActions = h('div', {
  class: 'classic-actions',
  role: 'group',
  'aria-label': 'Your session',
});
const accountsSection = h('section', {
  class: 'classic-section',
  'aria-labelledby': 'accounts-heading',
});
const lobbyList = h('ul', { class: 'classic-stations' });
const hallList = h('ul', { class: 'classic-stations' });
const hallNote = h('p', { class: 'classic-note' });

app.append(
  h(
    'header',
    { class: 'classic-header' },
    h(
      'div',
      { class: 'classic-header__top' },
      h('h1', {}, BANK.name),
      h('a', { class: 'classic-link', href: '/' }, 'Switch to the 3D bank'),
    ),
    h('p', { class: 'notice' }, h('span', { 'aria-hidden': 'true' }, '⚠ '), BANK.disclaimer),
    status,
    accountActions,
  ),
  h(
    'main',
    { id: 'main', tabindex: '-1' },
    accountsSection,
    h(
      'section',
      { class: 'classic-section', 'aria-labelledby': 'lobby-heading' },
      h('h2', { id: 'lobby-heading' }, 'Front desk'),
      lobbyList,
    ),
    h(
      'section',
      { class: 'classic-section', 'aria-labelledby': 'hall-heading' },
      h('h2', { id: 'hall-heading' }, 'Banking services'),
      hallNote,
      hallList,
    ),
  ),
  h(
    'footer',
    { class: 'classic-footer' },
    h(
      'button',
      {
        type: 'button',
        class: 'classic-button classic-button--quiet',
        onclick: () => dialogs.open(settingsDialog),
      },
      'Display settings',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'classic-button classic-button--quiet',
        onclick: () =>
          void helpDesk(
            STATIONS.find((s) => s.id === 'help')!,
            bank,
          ),
      },
      'Help',
    ),
  ),
  announcer,
);

const announce = (message: string) => {
  announcer.textContent = '';
  requestAnimationFrame(() => (announcer.textContent = message));
};

/** Run a station's menu, then refresh the page with whatever changed. */
async function open(def: StationDef) {
  await runStation(def, bank);
  await watcher.refresh();
  await renderAccounts();
  // The buttons may have been rebuilt meanwhile, so find this station's again.
  const back = document.querySelector<HTMLElement>(`[data-station="${def.id}"]`);
  (back ?? document.getElementById('main'))?.focus();
}

function stationItem(def: StationDef, locked: boolean) {
  const who = def.staff ? `${def.staff.name}, ${def.staff.role}` : 'Self-service';
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        class: 'classic-station',
        'data-station': def.id,
        ...(locked ? { 'aria-disabled': 'true', 'aria-describedby': 'hall-locked' } : {}),
        onclick: () => {
          if (locked) {
            announce('Please check in first to use banking services.');
            return;
          }
          void open(def);
        },
      },
      h('span', { class: 'classic-station__icon', 'aria-hidden': 'true' }, def.icon),
      h('span', { class: 'classic-station__title' }, def.title),
      h('span', { class: 'classic-station__who' }, who),
      h('span', { class: 'classic-station__services' }, def.services.join(' · ')),
    ),
  );
}

function renderStations(signedIn: boolean) {
  lobbyList.replaceChildren(
    ...STATIONS.filter((s) => s.area === 'lobby').map((s) => stationItem(s, false)),
  );
  hallList.replaceChildren(
    ...STATIONS.filter((s) => s.area === 'hall').map((s) => stationItem(s, !signedIn)),
  );
  hallNote.id = 'hall-locked';
  hallNote.textContent = signedIn ? '' : 'Check in at the front desk to use these.';
  hallNote.hidden = signedIn;
}

function renderSession(session: SessionInfo | null) {
  const signedIn = session?.authenticated === true;
  status.textContent = signedIn ? `Checked in as ${session.user.name}.` : 'You are not checked in.';
  const checkin = STATIONS.find((s) => s.id === 'checkin')!;
  const join = STATIONS.find((s) => s.id === 'newAccounts')!;
  const checkout = STATIONS.find((s) => s.id === 'exit')!;
  const button = (label: string, onclick: () => void) =>
    h('button', { type: 'button', class: 'classic-button', onclick }, label);
  accountActions.replaceChildren(
    ...(signedIn
      ? [
          button(
            `Notices${session.unreadNotifications ? ` (${session.unreadNotifications} new)` : ''}`,
            () => void notificationsWindow(bank).then(() => watcher.refresh()),
          ),
          button('Check out', () => void open(checkout)),
        ]
      : [
          button('Check in', () => void open(checkin)),
          button('Open an account', () => void open(join)),
        ]),
  );
  renderStations(signedIn);
}

async function renderAccounts() {
  const signedIn = watcher.signedIn;
  let accounts: AccountSummary[] = [];
  if (signedIn) accounts = await api.getAccounts().catch(() => []);
  const heading = h('h2', { id: 'accounts-heading' }, 'Your accounts');
  if (!signedIn) {
    accountsSection.replaceChildren(
      heading,
      h('p', {}, 'Check in to see your accounts and balances.'),
    );
    return;
  }
  const open = accounts.filter((a) => a.status === 'OPEN');
  const money = (a: AccountSummary) => {
    const cell = balanceCell(a.balanceCents);
    return h('span', { class: `money money--${cell.tone}`, 'aria-label': cell.label }, cell.text);
  };
  accountsSection.replaceChildren(
    heading,
    h(
      'table',
      { class: 'classic-table' },
      h('caption', { class: 'visually-hidden' }, 'Your open accounts and balances'),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Account'),
          h('th', { scope: 'col' }, 'Type'),
          h('th', { scope: 'col' }, 'Number'),
          h('th', { scope: 'col', class: 'cell--end' }, 'Balance'),
        ),
      ),
      h(
        'tbody',
        {},
        ...open.map((a) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, a.nickname),
            h('td', {}, TYPE_LABEL[a.type] ?? a.type),
            h('td', {}, a.maskedNumber),
            h('td', { class: 'cell--end' }, money(a)),
          ),
        ),
      ),
    ),
    h(
      'p',
      { class: 'classic-note' },
      'Loans and credit cards show what you owe as a negative balance.',
    ),
  );
}

watcher.subscribe((change, session) => {
  renderSession(session);
  void renderAccounts();
  if (change.kind === 'signedIn') announce(`Checked in as ${change.session.user.name}.`);
  if (change.kind === 'signedOut')
    announce(
      change.reason === 'expired'
        ? 'Your session has expired. Please check in again.'
        : 'You are checked out.',
    );
});
renderSession(null);
watcher.start();
void watcher.refresh().then(renderAccounts);

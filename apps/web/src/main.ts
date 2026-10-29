import { API_PREFIX, BANK } from '@dddbanker/shared';

// Phase 0 placeholder: proves web -> proxy -> api wiring. The 3D world arrives in Phase 2.
document.title = BANK.name;
document.querySelector('#bank-name')!.textContent = BANK.name;
document.querySelector('#disclaimer')!.textContent = BANK.disclaimer;

const status = document.querySelector<HTMLElement>('#api-status')!;

fetch(`${API_PREFIX}/health`)
  .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
  .then(() => {
    status.textContent = 'API connected. The vault is open.';
  })
  .catch((err: unknown) => {
    status.textContent = `API unreachable (${err instanceof Error ? err.message : 'unknown error'}).`;
  });

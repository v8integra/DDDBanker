/**
 * Bank identity and branding. Change the name here and it updates everywhere
 * (3D signage, menus, classic view, API responses).
 */
export const BANK = {
  name: 'Bank of Bramblewood',
  shortName: 'Bramblewood',
  /** Domain used for seeded/demo emails. `.test` is reserved and never routable. */
  demoEmailDomain: 'bramblewood.test',
  disclaimer: 'Demo bank. Do not enter real personal or financial information.',
  colors: {
    primary: '#2f6f4f',
    accent: '#e8b04a',
    cream: '#fbf3e0',
    ink: '#1d2433',
  },
} as const;

export const API_PREFIX = '/api/v1';

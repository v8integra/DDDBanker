import type { CharacterLook } from '../player/character';

/**
 * Every desk and kiosk in the bank, as data. Position, sign, staff, and what
 * it offers live here; scene code just builds whatever is listed. Adding a
 * station (or a whole mall of them later) means adding an entry.
 */
export type StationId =
  | 'checkin'
  | 'newAccounts'
  | 'teller'
  | 'transfers'
  | 'cards'
  | 'savings'
  | 'autoLoans'
  | 'homeLoans'
  | 'personalLoans'
  | 'insurance'
  | 'security'
  | 'help'
  | 'exit'
  | 'notifications';

export interface StationDef {
  id: StationId;
  /** Text on the hanging sign. */
  title: string;
  icon: string;
  area: 'lobby' | 'hall';
  /** Center of the desk. */
  position: { x: number; z: number };
  /** Heading the desk front (and its staff) faces. 0 = +Z (north). */
  facing: number;
  /** Staff behind the desk; null for self-service kiosks. */
  staff: (CharacterLook & { name: string; role: string }) | null;
  greeting: string;
  /** What this station will offer (shown until its menu is built). */
  services: string[];
  kind: 'desk' | 'round' | 'kiosk';
}

const EAST = Math.PI / 2; // faces +X
const WEST = -Math.PI / 2; // faces -X
const SOUTH = Math.PI; // faces -Z, back toward the gate

export const STATIONS: StationDef[] = [
  // ---- Lobby (public) ----
  {
    id: 'checkin',
    title: 'Check-In',
    icon: '🔑',
    area: 'lobby',
    position: { x: -6.5, z: 6.5 },
    facing: EAST,
    kind: 'desk',
    staff: {
      name: 'Pip',
      role: 'Greeter',
      color: '#e8b04a',
      skin: '#ffe0c2',
      outfit: 'bow',
      accent: '#2f6f4f',
    },
    greeting: 'Welcome to the Bank of Bramblewood! Checking in today?',
    services: ['Check in (log in)', 'Forgot password', 'Two-step verification'],
  },
  {
    id: 'newAccounts',
    title: 'New Accounts',
    icon: '✨',
    area: 'lobby',
    position: { x: 6.5, z: 6.5 },
    facing: WEST,
    kind: 'desk',
    staff: {
      name: 'Juniper',
      role: 'New Accounts',
      color: '#7fbf63',
      skin: '#a86b3c',
      outfit: 'tie',
      accent: '#e8b04a',
    },
    greeting: 'Hello! Opening your first account with us? It only takes a minute.',
    services: ['Open checking and savings', 'Get your $1,000 welcome bonus'],
  },

  // ---- Banking hall, west wall ----
  {
    id: 'teller',
    title: 'Teller',
    icon: '💵',
    area: 'hall',
    position: { x: -13, z: 16 },
    facing: EAST,
    kind: 'desk',
    staff: {
      name: 'Rowan',
      role: 'Teller',
      color: '#5bb8ff',
      skin: '#f1c27d',
      outfit: 'tie',
      accent: '#2f6f4f',
    },
    greeting: 'Next, please! How can I help with your accounts?',
    services: [
      'Balances and history',
      'Statements',
      'Deposits and withdrawals',
      'Open savings or a CD',
      'Rename accounts',
    ],
  },
  {
    id: 'transfers',
    title: 'Transfers',
    icon: '🔁',
    area: 'hall',
    position: { x: -13, z: 21.5 },
    facing: EAST,
    kind: 'desk',
    staff: {
      name: 'Hazel',
      role: 'Payments',
      color: '#c69bff',
      skin: '#d9a066',
      outfit: 'bow',
      accent: '#ffd166',
    },
    greeting: 'Moving money? I can help with that.',
    services: [
      'Transfer between your accounts',
      'Send money to someone',
      'Pay a bill',
      'Scheduled payments',
    ],
  },
  {
    id: 'cards',
    title: 'Cards',
    icon: '💳',
    area: 'hall',
    position: { x: -13, z: 27 },
    facing: EAST,
    kind: 'desk',
    staff: {
      name: 'Basil',
      role: 'Card Services',
      color: '#ff8a5b',
      skin: '#7a4a2a',
      outfit: 'tie',
      accent: '#fbf6ec',
    },
    greeting: 'Card trouble, or looking for a new one?',
    services: ['View cards', 'Lock or unlock', 'Report lost', 'Apply for a credit card'],
  },
  {
    id: 'savings',
    title: 'Savings',
    icon: '🌱',
    area: 'hall',
    position: { x: -13, z: 32.5 },
    facing: EAST,
    kind: 'desk',
    staff: {
      name: 'Clover',
      role: 'Savings',
      color: '#8be07a',
      skin: '#ffe0c2',
      outfit: 'bow',
      accent: '#f2789a',
    },
    greeting: 'Saving up for something nice?',
    services: ['Certificates of deposit', 'Savings goals'],
  },

  // ---- Banking hall, east wall ----
  {
    id: 'autoLoans',
    title: 'Auto Loans',
    icon: '🚗',
    area: 'hall',
    position: { x: 13, z: 16 },
    facing: WEST,
    kind: 'desk',
    staff: {
      name: 'Ash',
      role: 'Auto Lending',
      color: '#ffd25b',
      skin: '#a86b3c',
      outfit: 'tie',
      accent: '#3b6fb6',
    },
    greeting: 'Shopping for a new ride?',
    services: ['Payment calculator', 'Apply', 'View your loan', 'Make a payment'],
  },
  {
    id: 'homeLoans',
    title: 'Home Loans',
    icon: '🏡',
    area: 'hall',
    position: { x: 13, z: 21.5 },
    facing: WEST,
    kind: 'desk',
    staff: {
      name: 'Maple',
      role: 'Mortgages',
      color: '#f2b8b0',
      skin: '#f1c27d',
      outfit: 'bow',
      accent: '#2f6f4f',
    },
    greeting: "Let's find you a place to call home.",
    services: ['Mortgage calculator', 'Prequalify', 'Apply', 'View your loan'],
  },
  {
    id: 'personalLoans',
    title: 'Personal Loans',
    icon: '🧾',
    area: 'hall',
    position: { x: 13, z: 27 },
    facing: WEST,
    kind: 'desk',
    staff: {
      name: 'Fennel',
      role: 'Lending',
      color: '#a9c8e8',
      skin: '#d9a066',
      outfit: 'tie',
      accent: '#e05d4f',
    },
    greeting: 'Need a little extra for something?',
    services: ['Loan calculator', 'Apply', 'View and pay'],
  },
  {
    id: 'insurance',
    title: 'Insurance',
    icon: '☂️',
    area: 'hall',
    position: { x: 13, z: 32.5 },
    facing: WEST,
    kind: 'desk',
    staff: {
      name: 'Sage',
      role: 'Insurance',
      color: '#c8b8e8',
      skin: '#7a4a2a',
      outfit: 'bow',
      accent: '#ffd166',
    },
    greeting: 'Rainy days happen. Let me get you a quote.',
    services: ['Auto, home, renters, and life quotes', 'Start a policy', 'View your policies'],
  },

  // ---- Banking hall, north wall and center ----
  {
    id: 'security',
    title: 'Security Center',
    icon: '🛡️',
    area: 'hall',
    position: { x: -7.5, z: 34.4 },
    facing: SOUTH,
    kind: 'desk',
    staff: {
      name: 'Thorne',
      role: 'Security',
      color: '#3d4452',
      skin: '#f1c27d',
      outfit: 'tie',
      accent: '#e8b04a',
    },
    greeting: 'Keeping your account safe is my whole job.',
    services: ['Change password', 'Two-step verification', 'Active sessions', 'Recent sign-ins'],
  },
  {
    id: 'exit',
    title: 'Check Out',
    icon: '👋',
    area: 'hall',
    position: { x: 7.5, z: 34.4 },
    facing: SOUTH,
    kind: 'desk',
    staff: {
      name: 'Wren',
      role: 'Concierge',
      color: '#ff7fb8',
      skin: '#ffe0c2',
      outfit: 'bow',
      accent: '#2f6f4f',
    },
    greeting: 'All done for today?',
    services: ['Check out (log out)'],
  },
  {
    id: 'help',
    title: 'Help Desk',
    icon: '❓',
    area: 'hall',
    position: { x: 0, z: 24 },
    facing: SOUTH,
    kind: 'round',
    staff: {
      name: 'Bramble',
      role: 'Help Desk',
      color: '#2f6f4f',
      skin: '#d9a066',
      outfit: 'tie',
      accent: '#e8b04a',
    },
    greeting: 'Hi there! Lost, curious, or stuck? Ask away.',
    services: ['Support tickets', 'FAQ', 'Controls help'],
  },
  {
    id: 'notifications',
    title: 'Notices',
    icon: '🔔',
    area: 'hall',
    position: { x: 4.5, z: 17.5 },
    facing: SOUTH,
    kind: 'kiosk',
    staff: null,
    greeting: 'The notices kiosk hums quietly.',
    services: ['Payment, loan, and account alerts'],
  },
];

/** Unit vector a station faces. */
export function facingVector(facing: number) {
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

/** Where the player stands to use a station: in front of the desk. */
export function stationSpot(station: StationDef) {
  const f = facingVector(station.facing);
  const reach = station.kind === 'kiosk' ? 1.0 : station.kind === 'round' ? 1.9 : 1.35;
  return { x: station.position.x + f.x * reach, z: station.position.z + f.z * reach };
}

/** Where the staff member stands: behind the desk. */
export function staffSpot(station: StationDef) {
  const f = facingVector(station.facing);
  const back = station.kind === 'round' ? 0 : 0.95;
  return { x: station.position.x - f.x * back, z: station.position.z - f.z * back };
}

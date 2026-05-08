// System-default event types (per arch § 4.2 seed).
export const DEFAULT_EVENT_TYPES = [
  { label: 'Date Night', emoji: '🌙', durationHours: 3.5, blocksNextMorning: false, sortOrder: 1 },
  { label: 'Overnight', emoji: '🛏️', durationHours: 12.0, blocksNextMorning: true, sortOrder: 2 },
  { label: 'Daytime Hang', emoji: '☀️', durationHours: 2.5, blocksNextMorning: false, sortOrder: 3 },
  { label: 'Pod Gathering', emoji: '🏠', durationHours: 3.5, blocksNextMorning: false, sortOrder: 4 },
  {
    label: 'Sub-group Hang',
    emoji: '👥',
    durationHours: 2.5,
    blocksNextMorning: false,
    sortOrder: 5,
  },
] as const;

// Partner color palette (warm earth tones per PRD § 7.3).
export const PARTNER_COLORS = [
  '#E07A5F', // terracotta
  '#81B29A', // sage
  '#F2CC8F', // warm gold
  '#D08C8C', // dusty rose
  '#9DAB8E', // dusty olive
  '#B08E72', // warm taupe
  '#6E8FA6', // dusty steel-blue
  '#C77F87', // muted rosé
] as const;

// Login code / session TTLs (per arch § 5.1; magic-link concept replaced
// by a 6-character email code so the auth flow survives the email→browser
// →PWA boundary that breaks deep links on iOS).
export const LOGIN_CODE_TTL_MINUTES = 15;
export const LOGIN_CODE_LENGTH = 6;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const SESSION_TTL_DAYS = 60;
export const PARTNER_INVITE_TTL_DAYS = 7;
export const POD_INVITE_TTL_DAYS = 7;

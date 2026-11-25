export type MatchStatus = 'Upcoming' | 'LIVE' | 'Finished';

export interface Channel {
  id: string;
  /** Complete raw HTML defining the channel page (source of truth). */
  html?: string;
  /** Display name parsed from html (data-channel-name / <h1>) or legacy field. */
  name: string;
  /** Legacy fields kept optional for read-time fallback on unmigrated docs. */
  language?: string;
  streamUrl?: string;
  pageContent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CricketMatch {
  id: string;
  slug: string;
  teamA: string;
  teamB: string;
  countryCodeA?: string;
  countryCodeB?: string;
  tournament: string;
  matchNumber: string;
  venue: string;
  /** YYYY-MM-DD in IST */
  date: string;
  /** HH:mm (24h) in IST */
  startTime: string;
  /** HH:mm (24h) in IST */
  endTime: string;
  status: MatchStatus;
  channelIds: string[];
  pageContent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuthRecord {
  email: string;
  passwordHash: string;
  salt: string;
  iterations: number;
  sessionEpoch: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSession {
  token: string;
  email: string;
  sessionEpoch: number;
  issuedAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: number | null;
}

export type AuditAction =
  | 'ADMIN_SETUP'
  | 'ADMIN_LOGIN'
  | 'ADMIN_LOGOUT'
  | 'LOGOUT_ALL_SESSIONS'
  | 'AUTO_LOGOUT_INACTIVITY'
  | 'PASSWORD_CHANGED'
  | 'MATCH_CREATED'
  | 'MATCH_UPDATED'
  | 'MATCH_DELETED'
  | 'CHANNEL_CREATED'
  | 'CHANNEL_UPDATED'
  | 'CHANNEL_DELETED';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  targetName: string;
  adminEmail: string;
  details?: string;
}

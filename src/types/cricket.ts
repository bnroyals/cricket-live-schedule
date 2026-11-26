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

export interface MatchTopPerformer {
  player: string;
  performance: string;
  team?: string;
}

export interface MatchPlayingXI {
  teamA?: string[];
  teamB?: string[];
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
  /** Optional explicit match format (e.g., T20I, ODI, Test, T20) */
  format?: string;
  /** Optional series/event organizer name */
  organizer?: string;
  venue: string;
  /** YYYY-MM-DD in IST */
  date: string;
  /** HH:mm (24h) in IST */
  startTime: string;
  /** HH:mm (24h) in IST */
  endTime: string;
  status: MatchStatus;
  channelIds: string[];
  /** Optional custom preview prose displayed at the start of the Match Preview section */
  previewText?: string;
  pageContent?: string;
  /** Optional Playing XI squads when announced */
  playingXI?: MatchPlayingXI;
  playingXiTeamA?: string[];
  playingXiTeamB?: string[];
  /** Optional post-match result summary & top performers when available */
  result?: string;
  resultSummary?: string;
  playerOfTheMatch?: string;
  topPerformers?: Array<string | MatchTopPerformer>;
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
  | 'CHANNEL_DELETED'
  | 'AD_SLOT_UPDATED';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  targetName: string;
  adminEmail: string;
  details?: string;
}

export type AdSlotPosition =
  | 'home-top'
  | 'home-mid'
  | 'after-each-date-group'
  | 'home-bottom'
  | 'sticky-bottom-banner'
  | 'match-top'
  | 'watch-player-top'
  | 'watch-player-bottom'
  | 'after-match-preview'
  | 'after-match-details'
  | 'after-playing-xi'
  | 'after-result'
  | 'match-bottom'
  | 'watch-above-player'
  | 'watch-below-player'
  | 'footer-top'
  | 'footer-mid'
  | 'footer-bottom';

export type SiteWideAdSlotId = 'social-bar' | 'popunder';

export type AdSlotId = AdSlotPosition | SiteWideAdSlotId;

export interface AdSlotConfig {
  enabled: boolean;
  code: string;
  updatedAt?: string;
}

export type AdSettingsMap = Record<AdSlotId, AdSlotConfig>;

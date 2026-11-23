import type {
  AdminAuthRecord,
  AdminSession,
  AuditAction,
  AuditLogEntry,
  Channel,
  CricketMatch,
  LockoutState,
  MatchStatus,
} from '../types/cricket';
import {
  constantTimeEqual,
  generateCleanSlug,
  generateRandomHex,
  getDefaultHashIterations,
  hashPasswordSha256,
  validateEmail,
  validateSafeText,
  validateStreamUrl,
  validateStrongPassword,
} from './security';
import { isMatchExpired } from './time';

const KEYS = {
  MATCHES: 'clsw_matches_v1',
  CHANNELS: 'clsw_channels_v1',
  EXPIRED_SLUGS: 'clsw_expired_slugs_v1',
  SEEDED: 'clsw_seeded_v1',
  ADMIN_AUTH: 'clsw_admin_auth_v1',
  ADMIN_LOCKOUT: 'clsw_admin_lockout_v1',
  AUDIT_LOG: 'clsw_audit_log_v1',
} as const;

const SESSION_STORAGE_KEY = 'clsw_admin_session_v1';

/**
 * Single authorized administrator email. No other admin account can be registered or sign in.
 */
export const AUTHORIZED_ADMIN_EMAIL = 'biswajitcopy3@gmail.com';

export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_FAILED_ATTEMPTS = 5;

const SEED_CHANNELS: Channel[] = [
  {
    id: 'sony-sports-ten-one',
    name: 'Sony Sports Ten 1',
    language: 'English',
    streamUrl: '',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'sony-sports-ten-three',
    name: 'Sony Sports Ten 3',
    language: 'English',
    streamUrl: '',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'willow-cricket',
    name: 'Willow Cricket',
    language: 'English',
    streamUrl: '',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'ptv-sports',
    name: 'PTV Sports',
    language: 'English',
    streamUrl: '',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'willow-hd',
    name: 'Willow HD',
    language: 'English',
    streamUrl: '',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
  {
    id: 'channel-hd',
    name: 'Channel HD',
    language: 'English',
    streamUrl: '',
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
];

const SEED_MATCHES: CricketMatch[] = [
  {
    id: 'seed-ind-a-vs-pak-a',
    slug: 'india-a-vs-pakistan-a',
    teamA: 'India A',
    teamB: 'Pakistan A',
    tournament: "ACC Men's Asia Cup Rising Stars 2026",
    matchNumber: 'Match 8',
    venue: 'West End Park International Cricket Stadium, Doha',
    date: '2026-11-22',
    startTime: '15:30',
    endTime: '19:30',
    status: 'Upcoming',
    channelIds: ['sony-sports-ten-three', 'willow-cricket'],
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
  },
];

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function notifyDataChanged(): void {
  window.dispatchEvent(new CustomEvent('clsw:data-changed'));
}

/**
 * Ensures any previously stored non-authorized admin record is purged,
 * and cleans up any legacy non-English channel tags in localStorage.
 */
function enforceSingleAdminAndEnglishData(): void {
  const existingAdmin = safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null);
  if (existingAdmin && existingAdmin.email.trim().toLowerCase() !== AUTHORIZED_ADMIN_EMAIL) {
    window.localStorage.removeItem(KEYS.ADMIN_AUTH);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }

  const existingChannels = safeReadJson<Channel[] | null>(KEYS.CHANNELS, null);
  if (existingChannels) {
    let changed = false;
    const normalized = existingChannels.map((ch) => {
      if (ch.language.trim().toLowerCase() === 'hindi') {
        changed = true;
        return { ...ch, language: 'English' };
      }
      return ch;
    });
    if (changed) {
      safeWriteJson(KEYS.CHANNELS, normalized);
    }
  }
}

/**
 * Initializes seed data once on first visit. Channels are permanent.
 */
export function ensureSeedData(): void {
  const alreadySeeded = window.localStorage.getItem(KEYS.SEEDED);
  if (!alreadySeeded) {
    safeWriteJson(KEYS.CHANNELS, SEED_CHANNELS);
    safeWriteJson(KEYS.MATCHES, SEED_MATCHES);
    safeWriteJson(KEYS.EXPIRED_SLUGS, []);
    window.localStorage.setItem(KEYS.SEEDED, 'true');
  } else {
    const existingChannels = safeReadJson<Channel[] | null>(KEYS.CHANNELS, null);
    if (!existingChannels) {
      safeWriteJson(KEYS.CHANNELS, SEED_CHANNELS);
    }
  }
  enforceSingleAdminAndEnglishData();
}

/**
 * Checks all scheduled matches and permanently deletes any match whose endTime + 30 min has passed.
 * Channels are NEVER touched by auto-delete.
 */
export function purgeExpiredMatches(nowMs: number = Date.now()): { removedCount: number } {
  ensureSeedData();
  const matches = safeReadJson<CricketMatch[]>(KEYS.MATCHES, []);
  const expiredSlugs = safeReadJson<string[]>(KEYS.EXPIRED_SLUGS, []);
  const expiredSet = new Set(expiredSlugs);

  const active: CricketMatch[] = [];
  let removedCount = 0;

  for (const match of matches) {
    if (isMatchExpired(match, nowMs)) {
      removedCount += 1;
      expiredSet.add(match.slug);
    } else {
      active.push(match);
    }
  }

  if (removedCount > 0) {
    safeWriteJson(KEYS.MATCHES, active);
    safeWriteJson(KEYS.EXPIRED_SLUGS, Array.from(expiredSet).slice(-200));
    notifyDataChanged();
  }

  return { removedCount };
}

// ============================================================================
// PUBLIC READ-ONLY API (Enforces Firestore-style read-only intent for viewers)
// ============================================================================

export function getPublicMatches(): CricketMatch[] {
  ensureSeedData();
  const matches = safeReadJson<CricketMatch[]>(KEYS.MATCHES, []);
  return [...matches].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.startTime.localeCompare(b.startTime);
  });
}

export function getPublicMatchBySlug(slug: string): CricketMatch | null {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;
  const matches = getPublicMatches();
  return matches.find((m) => m.slug.toLowerCase() === clean) ?? null;
}

export function getPublicChannels(): Channel[] {
  ensureSeedData();
  return safeReadJson<Channel[]>(KEYS.CHANNELS, []);
}

// ============================================================================
// SINGLE-ADMIN AUTHENTICATION, BRUTE-FORCE LOCKOUT & SESSION MANAGEMENT
// ============================================================================

export function isAdminConfigured(): boolean {
  enforceSingleAdminAndEnglishData();
  const record = safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null);
  return Boolean(
    record &&
      record.email.trim().toLowerCase() === AUTHORIZED_ADMIN_EMAIL &&
      record.passwordHash &&
      record.salt
  );
}

export function getLockoutState(nowMs: number = Date.now()): {
  isLocked: boolean;
  remainingMs: number;
  failedAttempts: number;
} {
  const state = safeReadJson<LockoutState>(KEYS.ADMIN_LOCKOUT, {
    failedAttempts: 0,
    lockedUntil: null,
  });

  if (state.lockedUntil && nowMs < state.lockedUntil) {
    return {
      isLocked: true,
      remainingMs: state.lockedUntil - nowMs,
      failedAttempts: state.failedAttempts,
    };
  }

  if (state.lockedUntil && nowMs >= state.lockedUntil) {
    safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, {
      failedAttempts: 0,
      lockedUntil: null,
    });
    return { isLocked: false, remainingMs: 0, failedAttempts: 0 };
  }

  return {
    isLocked: false,
    remainingMs: 0,
    failedAttempts: state.failedAttempts,
  };
}

function appendAuditLog(
  action: AuditAction,
  targetName: string,
  adminEmail: string,
  details?: string
): void {
  const entries = safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
  const next: AuditLogEntry = {
    id: generateRandomHex(8),
    timestamp: new Date().toISOString(),
    action,
    targetName,
    adminEmail,
    details,
  };
  safeWriteJson(KEYS.AUDIT_LOG, [next, ...entries].slice(0, 500));
}

function saveSession(session: AdminSession | null): void {
  if (!session) {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function getActiveAdminSession(nowMs: number = Date.now()): AdminSession | null {
  try {
    enforceSingleAdminAndEnglishData();
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AdminSession;
    const authRecord = safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null);

    if (!authRecord || authRecord.email !== AUTHORIZED_ADMIN_EMAIL) {
      saveSession(null);
      return null;
    }

    if (
      session.sessionEpoch !== authRecord.sessionEpoch ||
      session.email !== AUTHORIZED_ADMIN_EMAIL
    ) {
      saveSession(null);
      return null;
    }

    // Enforce 15-minute inactivity timeout
    if (nowMs - session.lastActivityAt >= INACTIVITY_TIMEOUT_MS || nowMs >= session.expiresAt) {
      saveSession(null);
      appendAuditLog(
        'AUTO_LOGOUT_INACTIVITY',
        'Admin Session',
        authRecord.email,
        'Session ended after 15 minutes of inactivity'
      );
      return null;
    }

    return session;
  } catch {
    saveSession(null);
    return null;
  }
}

export function touchAdminSession(nowMs: number = Date.now()): AdminSession | null {
  const session = getActiveAdminSession(nowMs);
  if (!session) return null;
  const updated: AdminSession = {
    ...session,
    lastActivityAt: nowMs,
    expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
  };
  saveSession(updated);
  return updated;
}

/**
 * Strict write-guard: public viewers can NEVER execute any write mutation,
 * and only the single authorized administrator can write.
 */
function assertAuthorizedAdminSession(providedSession: AdminSession | null): AdminSession {
  const active = getActiveAdminSession();
  if (!active || !providedSession || active.email !== AUTHORIZED_ADMIN_EMAIL) {
    throw new Error('Unauthorized: Authenticated admin session required.');
  }
  if (
    !constantTimeEqual(active.token, providedSession.token) ||
    active.sessionEpoch !== providedSession.sessionEpoch
  ) {
    throw new Error('Unauthorized: Session invalid or expired. Please sign in again.');
  }
  return touchAdminSession() ?? active;
}

/**
 * First-time admin setup: strictly allows ONLY biswajitcopy3@gmail.com.
 * Refuses every other email and refuses creating a second admin once configured.
 */
export async function setupFirstAdmin(
  emailInput: string,
  password: string,
  confirmPassword: string
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  if (isAdminConfigured()) {
    return { ok: false, error: 'Admin account is already configured.' };
  }

  const emailCheck = validateEmail(emailInput);
  if (!emailCheck.valid) {
    return { ok: false, error: emailCheck.error || 'Invalid email.' };
  }

  if (!constantTimeEqual(emailCheck.value, AUTHORIZED_ADMIN_EMAIL)) {
    return {
      ok: false,
      error: 'Unauthorized email. Admin setup is restricted to the designated administrator account only.',
    };
  }

  const pwCheck = validateStrongPassword(password);
  if (!pwCheck.valid) {
    return { ok: false, error: pwCheck.errors[0] };
  }

  if (password !== confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  const salt = generateRandomHex(16);
  const iterations = getDefaultHashIterations();
  const passwordHash = await hashPasswordSha256(password, salt, iterations);
  const nowIso = new Date().toISOString();

  const record: AdminAuthRecord = {
    email: AUTHORIZED_ADMIN_EMAIL,
    passwordHash,
    salt,
    iterations,
    sessionEpoch: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  safeWriteJson(KEYS.ADMIN_AUTH, record);
  safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, { failedAttempts: 0, lockedUntil: null });

  const nowMs = Date.now();
  const session: AdminSession = {
    token: generateRandomHex(32),
    email: AUTHORIZED_ADMIN_EMAIL,
    sessionEpoch: record.sessionEpoch,
    issuedAt: nowMs,
    lastActivityAt: nowMs,
    expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
  };
  saveSession(session);

  appendAuditLog('ADMIN_SETUP', 'Admin Account', AUTHORIZED_ADMIN_EMAIL, 'Initial admin credentials configured');
  return { ok: true, session };
}

function recordFailedLoginAttempt(
  nowMs: number,
  currentFailedAttempts: number
): { ok: false; error: string; lockedUntil?: number | null } {
  const nextFailed = currentFailedAttempts + 1;
  if (nextFailed >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = nowMs + LOCKOUT_DURATION_MS;
    safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, {
      failedAttempts: nextFailed,
      lockedUntil,
    });
    return {
      ok: false,
      error: 'Login locked for 15 minutes due to 5 failed attempts.',
      lockedUntil,
    };
  }

  safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, {
    failedAttempts: nextFailed,
    lockedUntil: null,
  });
  return {
    ok: false,
    error: 'Login failed. Invalid email or password.',
  };
}

/**
 * Hardened single-admin login:
 * Checks email against AUTHORIZED_ADMIN_EMAIL FIRST before any password verification.
 * Returns a generic login-failed message for any other email or invalid password.
 */
export async function loginAdmin(
  emailInput: string,
  password: string
): Promise<
  | { ok: true; session: AdminSession }
  | { ok: false; error: string; lockedUntil?: number | null }
> {
  const nowMs = Date.now();
  const lockout = getLockoutState(nowMs);
  if (lockout.isLocked) {
    return {
      ok: false,
      error: 'Too many failed attempts. Admin login is temporarily locked.',
      lockedUntil: nowMs + lockout.remainingMs,
    };
  }

  // Step 1: Check email FIRST before any password verification
  const emailNorm = emailInput.trim().toLowerCase();
  if (!constantTimeEqual(emailNorm, AUTHORIZED_ADMIN_EMAIL)) {
    return recordFailedLoginAttempt(nowMs, lockout.failedAttempts);
  }

  const authRecord = safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null);
  if (!authRecord || authRecord.email !== AUTHORIZED_ADMIN_EMAIL) {
    return { ok: false, error: 'Admin account is not set up yet.' };
  }

  // Step 2: Verify password hash only for the authorized admin email
  const candidateHash = await hashPasswordSha256(
    password,
    authRecord.salt,
    authRecord.iterations
  );

  if (!constantTimeEqual(candidateHash, authRecord.passwordHash)) {
    return recordFailedLoginAttempt(nowMs, lockout.failedAttempts);
  }

  // Successful login resets lockout
  safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, { failedAttempts: 0, lockedUntil: null });
  const session: AdminSession = {
    token: generateRandomHex(32),
    email: AUTHORIZED_ADMIN_EMAIL,
    sessionEpoch: authRecord.sessionEpoch,
    issuedAt: nowMs,
    lastActivityAt: nowMs,
    expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
  };
  saveSession(session);
  appendAuditLog('ADMIN_LOGIN', 'Admin Panel', AUTHORIZED_ADMIN_EMAIL);
  return { ok: true, session };
}

export function logoutAdmin(session: AdminSession | null): void {
  const email = session?.email ?? safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null)?.email;
  if (email) {
    appendAuditLog('ADMIN_LOGOUT', 'Admin Session', email);
  }
  saveSession(null);
}

/**
 * Invalidates every open admin session across all tabs by advancing sessionEpoch.
 */
export function logoutAllAdminSessions(session: AdminSession | null): void {
  const verified = assertAuthorizedAdminSession(session);
  const authRecord = safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null);
  if (authRecord && authRecord.email === AUTHORIZED_ADMIN_EMAIL) {
    const updated: AdminAuthRecord = {
      ...authRecord,
      sessionEpoch: authRecord.sessionEpoch + 1,
      updatedAt: new Date().toISOString(),
    };
    safeWriteJson(KEYS.ADMIN_AUTH, updated);
    appendAuditLog(
      'LOGOUT_ALL_SESSIONS',
      'All Active Sessions',
      verified.email,
      'Revoked all sessions across browser tabs'
    );
  }
  saveSession(null);
  notifyDataChanged();
}

export async function adminChangePassword(
  session: AdminSession | null,
  currentPassword: string,
  newPassword: string,
  confirmNewPassword: string
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  const verified = assertAuthorizedAdminSession(session);
  const authRecord = safeReadJson<AdminAuthRecord | null>(KEYS.ADMIN_AUTH, null);
  if (!authRecord || authRecord.email !== AUTHORIZED_ADMIN_EMAIL) {
    return { ok: false, error: 'Admin account not found.' };
  }

  const currentHash = await hashPasswordSha256(
    currentPassword,
    authRecord.salt,
    authRecord.iterations
  );
  if (!constantTimeEqual(currentHash, authRecord.passwordHash)) {
    return { ok: false, error: 'Current password is incorrect.' };
  }

  const pwCheck = validateStrongPassword(newPassword);
  if (!pwCheck.valid) {
    return { ok: false, error: pwCheck.errors[0] };
  }

  if (newPassword !== confirmNewPassword) {
    return { ok: false, error: 'New passwords do not match.' };
  }

  if (currentPassword === newPassword) {
    return { ok: false, error: 'New password must be different from your current password.' };
  }

  const newSalt = generateRandomHex(16);
  const iterations = getDefaultHashIterations();
  const newHash = await hashPasswordSha256(newPassword, newSalt, iterations);
  const nextEpoch = authRecord.sessionEpoch + 1;

  const updatedRecord: AdminAuthRecord = {
    ...authRecord,
    passwordHash: newHash,
    salt: newSalt,
    iterations,
    sessionEpoch: nextEpoch,
    updatedAt: new Date().toISOString(),
  };
  safeWriteJson(KEYS.ADMIN_AUTH, updatedRecord);

  const nowMs = Date.now();
  const nextSession: AdminSession = {
    token: generateRandomHex(32),
    email: AUTHORIZED_ADMIN_EMAIL,
    sessionEpoch: nextEpoch,
    issuedAt: nowMs,
    lastActivityAt: nowMs,
    expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
  };
  saveSession(nextSession);

  appendAuditLog(
    'PASSWORD_CHANGED',
    'Admin Account',
    verified.email,
    'Password rotated and older sessions invalidated'
  );
  notifyDataChanged();
  return { ok: true, session: nextSession };
}

export function adminGetAuditLog(session: AdminSession | null): AuditLogEntry[] {
  assertAuthorizedAdminSession(session);
  return safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
}

// ============================================================================
// ADMIN-ONLY WRITE OPERATIONS (Matches & Channels)
// ============================================================================

export interface MatchInput {
  teamA: string;
  teamB: string;
  tournament: string;
  matchNumber: string;
  venue: string;
  date: string;
  startTime: string;
  endTime: string;
  status: MatchStatus;
  channelIds: string[];
}

function validateMatchInput(input: MatchInput): { ok: true; data: MatchInput } | { ok: false; error: string } {
  const teamA = validateSafeText(input.teamA, 'Team A', { required: true, maxLength: 60 });
  if (!teamA.valid) return { ok: false, error: teamA.error! };

  const teamB = validateSafeText(input.teamB, 'Team B', { required: true, maxLength: 60 });
  if (!teamB.valid) return { ok: false, error: teamB.error! };

  const tournament = validateSafeText(input.tournament, 'Tournament', {
    required: true,
    maxLength: 120,
  });
  if (!tournament.valid) return { ok: false, error: tournament.error! };

  const matchNumber = validateSafeText(input.matchNumber, 'Match label', {
    required: false,
    maxLength: 40,
  });
  if (!matchNumber.valid) return { ok: false, error: matchNumber.error! };

  const venue = validateSafeText(input.venue, 'Venue', { required: true, maxLength: 140 });
  if (!venue.valid) return { ok: false, error: venue.error! };

  const normalizedStart = input.startTime.trim().slice(0, 5);
  const normalizedEnd = input.endTime.trim().slice(0, 5);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) {
    return { ok: false, error: 'Select a valid match date.' };
  }
  if (!/^\d{2}:\d{2}$/.test(normalizedStart)) {
    return { ok: false, error: 'Select a valid start time (IST).' };
  }
  if (!/^\d{2}:\d{2}$/.test(normalizedEnd)) {
    return { ok: false, error: 'Select a valid end time (IST).' };
  }

  const allowedStatuses: MatchStatus[] = ['Upcoming', 'LIVE', 'Finished'];
  if (!allowedStatuses.includes(input.status)) {
    return { ok: false, error: 'Invalid match status.' };
  }

  const knownChannelIds = new Set(getPublicChannels().map((c) => c.id));
  const cleanChannelIds = Array.from(
    new Set((input.channelIds || []).filter((id) => knownChannelIds.has(id)))
  );

  return {
    ok: true,
    data: {
      teamA: teamA.value,
      teamB: teamB.value,
      tournament: tournament.value,
      matchNumber: matchNumber.value,
      venue: venue.value,
      date: input.date.trim(),
      startTime: normalizedStart,
      endTime: normalizedEnd,
      status: input.status,
      channelIds: cleanChannelIds,
    },
  };
}

export function adminCreateMatch(
  session: AdminSession | null,
  input: MatchInput
): { ok: true; match: CricketMatch } | { ok: false; error: string } {
  const verified = assertAuthorizedAdminSession(session);
  const validated = validateMatchInput(input);
  if (!validated.ok) return validated;

  const existing = getPublicMatches();
  const slug = generateCleanSlug(
    validated.data.teamA,
    validated.data.teamB,
    existing.map((m) => m.slug)
  );
  const nowIso = new Date().toISOString();

  const match: CricketMatch = {
    id: `m-${generateRandomHex(6)}`,
    slug,
    ...validated.data,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  safeWriteJson(KEYS.MATCHES, [...existing, match]);
  appendAuditLog(
    'MATCH_CREATED',
    `${match.teamA} vs ${match.teamB}`,
    verified.email,
    `Slug: /match/${match.slug}`
  );
  notifyDataChanged();
  return { ok: true, match };
}

export function adminUpdateMatch(
  session: AdminSession | null,
  matchId: string,
  input: MatchInput
): { ok: true; match: CricketMatch } | { ok: false; error: string } {
  const verified = assertAuthorizedAdminSession(session);
  const validated = validateMatchInput(input);
  if (!validated.ok) return validated;

  const existing = getPublicMatches();
  const idx = existing.findIndex((m) => m.id === matchId);
  if (idx === -1) {
    return { ok: false, error: 'Match not found.' };
  }

  const target = existing[idx];
  const teamsChanged =
    target.teamA !== validated.data.teamA || target.teamB !== validated.data.teamB;
  const otherSlugs = existing.filter((m) => m.id !== matchId).map((m) => m.slug);
  const slug = teamsChanged
    ? generateCleanSlug(validated.data.teamA, validated.data.teamB, otherSlugs)
    : target.slug;

  const updated: CricketMatch = {
    ...target,
    ...validated.data,
    slug,
    updatedAt: new Date().toISOString(),
  };

  const nextList = [...existing];
  nextList[idx] = updated;
  safeWriteJson(KEYS.MATCHES, nextList);

  appendAuditLog(
    'MATCH_UPDATED',
    `${updated.teamA} vs ${updated.teamB}`,
    verified.email,
    `Status: ${updated.status}`
  );
  notifyDataChanged();
  return { ok: true, match: updated };
}

export function adminDeleteMatch(
  session: AdminSession | null,
  matchId: string
): { ok: true } | { ok: false; error: string } {
  const verified = assertAuthorizedAdminSession(session);
  const existing = getPublicMatches();
  const target = existing.find((m) => m.id === matchId);
  if (!target) {
    return { ok: false, error: 'Match not found.' };
  }

  safeWriteJson(
    KEYS.MATCHES,
    existing.filter((m) => m.id !== matchId)
  );
  appendAuditLog('MATCH_DELETED', `${target.teamA} vs ${target.teamB}`, verified.email);
  notifyDataChanged();
  return { ok: true };
}

export interface ChannelInput {
  name: string;
  language: string;
  streamUrl: string;
}

function validateChannelInput(
  input: ChannelInput
): { ok: true; data: ChannelInput } | { ok: false; error: string } {
  const name = validateSafeText(input.name, 'Channel name', { required: true, maxLength: 80 });
  if (!name.valid) return { ok: false, error: name.error! };

  const language = validateSafeText(input.language, 'Language', {
    required: true,
    maxLength: 40,
  });
  if (!language.valid) return { ok: false, error: language.error! };

  const streamUrl = validateStreamUrl(input.streamUrl);
  if (!streamUrl.valid) return { ok: false, error: streamUrl.error! };

  return {
    ok: true,
    data: {
      name: name.value,
      language: language.value,
      streamUrl: streamUrl.value,
    },
  };
}

export function adminCreateChannel(
  session: AdminSession | null,
  input: ChannelInput
): { ok: true; channel: Channel } | { ok: false; error: string } {
  const verified = assertAuthorizedAdminSession(session);
  const validated = validateChannelInput(input);
  if (!validated.ok) return validated;

  const existing = getPublicChannels();
  const nowIso = new Date().toISOString();
  const channel: Channel = {
    id: `ch-${generateRandomHex(6)}`,
    ...validated.data,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  safeWriteJson(KEYS.CHANNELS, [...existing, channel]);
  appendAuditLog('CHANNEL_CREATED', channel.name, verified.email, channel.language);
  notifyDataChanged();
  return { ok: true, channel };
}

export function adminUpdateChannel(
  session: AdminSession | null,
  channelId: string,
  input: ChannelInput
): { ok: true; channel: Channel } | { ok: false; error: string } {
  const verified = assertAuthorizedAdminSession(session);
  const validated = validateChannelInput(input);
  if (!validated.ok) return validated;

  const existing = getPublicChannels();
  const idx = existing.findIndex((c) => c.id === channelId);
  if (idx === -1) {
    return { ok: false, error: 'Channel not found.' };
  }

  const updated: Channel = {
    ...existing[idx],
    ...validated.data,
    updatedAt: new Date().toISOString(),
  };

  const next = [...existing];
  next[idx] = updated;
  safeWriteJson(KEYS.CHANNELS, next);
  appendAuditLog(
    'CHANNEL_UPDATED',
    updated.name,
    verified.email,
    updated.streamUrl ? 'Stream URL updated' : 'Stream URL cleared'
  );
  notifyDataChanged();
  return { ok: true, channel: updated };
}

export function adminDeleteChannel(
  session: AdminSession | null,
  channelId: string
): { ok: true } | { ok: false; error: string } {
  const verified = assertAuthorizedAdminSession(session);
  const existing = getPublicChannels();
  const target = existing.find((c) => c.id === channelId);
  if (!target) {
    return { ok: false, error: 'Channel not found.' };
  }

  safeWriteJson(
    KEYS.CHANNELS,
    existing.filter((c) => c.id !== channelId)
  );

  // Clean up references in scheduled matches
  const matches = getPublicMatches();
  const cleanedMatches = matches.map((m) => ({
    ...m,
    channelIds: m.channelIds.filter((id) => id !== channelId),
  }));
  safeWriteJson(KEYS.MATCHES, cleanedMatches);

  appendAuditLog('CHANNEL_DELETED', target.name, verified.email);
  notifyDataChanged();
  return { ok: true };
}

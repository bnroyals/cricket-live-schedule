import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb } from './firebase';
import type {
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
  validateEmail,
  validateSafeText,
  validateStreamUrl,
  validateStrongPassword,
} from './security';
import { isMatchExpired } from './time';

/**
 * Admin auth + data storage.
 *
 * The admin account and the matches / channels / audit data live in
 * Firebase Auth + Firestore (server-side), NOT in browser localStorage.
 * localStorage is used only as a local cache for public content and for the
 * lockout counters; the admin session lives in sessionStorage with a
 * 15-minute inactivity timeout. Clearing browser data therefore never
 * deletes the admin account: after clearing, the admin page still finds the
 * admin record in Firestore (admin/config) and asks for login, never for
 * setup again.
 *
 * Firestore rules (see firestore.rules, also published in the console):
 * public read-only for matches/channels, write only for the authenticated
 * admin biswajitcopy3@gmail.com. The admin/config document is readable by
 * everyone so the login page can tell setup from login; only the admin can
 * write it. security/lockout holds only failed-login counters.
 */

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

export const AUTHORIZED_ADMIN_EMAIL = 'biswajitcopy3@gmail.com';
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;

const SEED_CHANNELS: Channel[] = [
  { id: 'sony-sports-ten-one', name: 'Sony Sports Ten 1', language: 'English', streamUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'sony-sports-ten-three', name: 'Sony Sports Ten 3', language: 'English', streamUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'willow-cricket', name: 'Willow Cricket', language: 'English', streamUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ptv-sports', name: 'PTV Sports', language: 'English', streamUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'willow-hd', name: 'Willow HD', language: 'English', streamUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'channel-hd', name: 'Channel HD', language: 'English', streamUrl: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
];

const SEED_MATCHES: CricketMatch[] = [
  {
    id: 'seed-ind-a-vs-pak-a',
    slug: 'india-a-vs-pakistan-a',
    teamA: 'India A',
    teamB: 'Pakistan A',
    tournament: "ACC Men's Asia Cup Rising Stars 2026",
    matchNumber: 'Match 8',
    venue: 'West End Park International Cricket Stadium Doha',
    date: '2026-11-22',
    startTime: '15:30',
    endTime: '19:30',
    status: 'Upcoming',
    channelIds: ['sony-sports-ten-three', 'willow-cricket'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be full or unavailable; Firestore remains the source of truth.
  }
}

function notifyDataChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('clsw:data-changed'));
  } catch {
    // Ignore event errors.
  }
}

// ---------- Firebase helpers ----------

type AdminConfigDoc = {
  email: string;
  uid: string;
  sessionEpoch: number;
  createdAt: string;
  updatedAt: string;
};

let adminConfiguredCache: boolean | null = null;
let adminConfigCache: AdminConfigDoc | null = null;
let adminConfigCacheAt = 0;
let adminConfigFetchPromise: Promise<boolean> | null = null;
let firestoreLockoutCache: LockoutState | null = null;
let authReady = false;
let authReadyPromise: Promise<User | null> | null = null;

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Resolves once Firebase Auth has restored (or found no) signed-in user. */
export function waitForFirebaseAuthReady(): Promise<User | null> {
  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
        authReady = true;
        unsubscribe();
        resolve(user);
      });
    });
  }
  return authReadyPromise;
}

/**
 * Ask Firestore whether an admin account exists. This is the ONLY place
 * that decides setup vs login, so clearing browser data can never bring
 * the setup screen back once an admin exists.
 */
export async function fetchAdminConfigured(): Promise<boolean> {
  if (adminConfigFetchPromise) return adminConfigFetchPromise;
  adminConfigFetchPromise = (async () => {
    try {
      const snap = await getDoc(doc(getFirestoreDb(), 'admin', 'config'));
      if (snap.exists()) {
        const d = snap.data();
        adminConfigCache = {
          email: typeof d.email === 'string' ? d.email : AUTHORIZED_ADMIN_EMAIL,
          uid: typeof d.uid === 'string' ? d.uid : '',
          sessionEpoch: typeof d.sessionEpoch === 'number' ? d.sessionEpoch : 1,
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
          updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '',
        };
        adminConfigCacheAt = Date.now();
        adminConfiguredCache = true;
        return true;
      }
      adminConfigCache = null;
      adminConfiguredCache = false;
      return false;
    } catch {
      return adminConfiguredCache ?? false;
    } finally {
      adminConfigFetchPromise = null;
    }
  })();
  return adminConfigFetchPromise;
}

function refreshAdminConfigInBackground(): void {
  if (Date.now() - adminConfigCacheAt < 30000) return;
  if (adminConfigFetchPromise) return;
  void fetchAdminConfigured();
}

async function ensureAdminConfigDoc(uid: string): Promise<void> {
  try {
    const ref = doc(getFirestoreDb(), 'admin', 'config');
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const nowIso = new Date().toISOString();
      await setDoc(ref, { email: AUTHORIZED_ADMIN_EMAIL, uid, sessionEpoch: 1, createdAt: nowIso, updatedAt: nowIso });
    }
    await fetchAdminConfigured();
  } catch {
    // The sign-in itself already succeeded; the config doc heals on next login.
  }
}

async function persistMatchToFirestore(match: CricketMatch): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await setDoc(doc(getFirestoreDb(), 'matches', match.id), stripUndefined(match));
  } catch {
    // Best-effort; the local cache already holds the change.
  }
}

async function persistMatchesToFirestore(matches: CricketMatch[]): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    const db = getFirestoreDb();
    const batch = writeBatch(db);
    matches.forEach((m) => batch.set(doc(db, 'matches', m.id), stripUndefined(m)));
    await batch.commit();
  } catch {
    // Best-effort.
  }
}

async function deleteMatchFromFirestore(id: string): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await deleteDoc(doc(getFirestoreDb(), 'matches', id));
  } catch {
    // Best-effort.
  }
}

async function persistChannelToFirestore(channel: Channel): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await setDoc(doc(getFirestoreDb(), 'channels', channel.id), stripUndefined(channel));
  } catch {
    // Best-effort.
  }
}

async function deleteChannelFromFirestore(id: string): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await deleteDoc(doc(getFirestoreDb(), 'channels', id));
  } catch {
    // Best-effort.
  }
}

async function persistAuditEntry(entry: AuditLogEntry): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await setDoc(doc(getFirestoreDb(), 'auditLog', entry.id), stripUndefined(entry));
  } catch {
    // Best-effort.
  }
}

async function mirrorLockoutToFirestore(state: LockoutState): Promise<void> {
  try {
    await setDoc(doc(getFirestoreDb(), 'security', 'lockout'), { failedAttempts: state.failedAttempts, lockedUntil: state.lockedUntil, lastFailedAt: Date.now() }, { merge: true });
  } catch {
    // Best-effort; the local lockout still applies in this browser.
  }
}

async function clearFirestoreLockout(): Promise<void> {
  try {
    await deleteDoc(doc(getFirestoreDb(), 'security', 'lockout'));
  } catch {
    // Best-effort.
  }
}

export async function fetchLockoutState(): Promise<{ isLocked: boolean; remainingMs: number; failedAttempts: number }> {
  try {
    const snap = await getDoc(doc(getFirestoreDb(), 'security', 'lockout'));
    if (snap.exists()) {
      const d = snap.data();
      firestoreLockoutCache = {
        failedAttempts: typeof d.failedAttempts === 'number' ? d.failedAttempts : 0,
        lockedUntil: typeof d.lockedUntil === 'number' ? d.lockedUntil : null,
      };
    }
  } catch {
    // Keep the local lockout state.
  }
  return getLockoutState(Date.now());
}

/**
 * Pull the server-side public data (Firestore) into the local cache and
 * notify the app to refresh. Firestore is empty on first run: the signed-in
 * admin's local seed data is published there once so every browser and
 * device sees the same schedule.
 */
export async function refreshPublicDataFromFirestore(): Promise<void> {
  try {
    const db = getFirestoreDb();
    const [matchSnap, channelSnap] = await Promise.all([
      getDocs(collection(db, 'matches')),
      getDocs(collection(db, 'channels')),
    ]);
    let changed = false;
    if (!matchSnap.empty) {
      const matches = matchSnap.docs.map((d) => d.data() as CricketMatch);
      safeWriteJson(KEYS.MATCHES, matches);
      changed = true;
    } else if (getFirebaseAuth().currentUser) {
      await persistMatchesToFirestore(getPublicMatches());
    }
    if (!channelSnap.empty) {
      const channels = channelSnap.docs.map((d) => d.data() as Channel);
      safeWriteJson(KEYS.CHANNELS, channels);
      changed = true;
    } else if (getFirebaseAuth().currentUser) {
      const db2 = getFirestoreDb();
      const batch = writeBatch(db2);
      getPublicChannels().forEach((c) => batch.set(doc(db2, 'channels', c.id), stripUndefined(c)));
      await batch.commit();
    }
    if (changed) notifyDataChanged();
  } catch {
    // Keep the local cache when Firestore is unreachable.
  }
}

function enforceSingleAdminAndEnglishData(): void {
  try {
    // Any local admin record is legacy: the admin now lives in Firebase
    // Auth + Firestore, and a local record must never be trusted again.
    if (window.localStorage.getItem(KEYS.ADMIN_AUTH)) {
      window.localStorage.removeItem(KEYS.ADMIN_AUTH);
    }
    const matches = safeReadJson<CricketMatch[]>(KEYS.MATCHES, []);
    const hindiChannels = new Set(['sony-sports-ten-three', 'willow-cricket']);
    let changed = false;
    const cleanedMatches = matches.map((match) => {
      const channelIds = (match.channelIds || []).filter((id) => !hindiChannels.has(id));
      if (channelIds.length !== (match.channelIds || []).length) {
        changed = true;
        return { ...match, channelIds };
      }
      return match;
    });
    if (changed) safeWriteJson(KEYS.MATCHES, cleanedMatches);
  } catch {
    // Never block the app for cleanup failures.
  }
}

export function ensureSeedData(): void {
  try {
    if (window.localStorage.getItem(KEYS.SEEDED)) return;
    const expiredSlugs = new Set(safeReadJson<string[]>(KEYS.EXPIRED_SLUGS, []));
    const matches = SEED_MATCHES.filter((match) => !expiredSlugs.has(match.id));
    safeWriteJson(KEYS.MATCHES, matches);
    safeWriteJson(KEYS.CHANNELS, SEED_CHANNELS);
    window.localStorage.setItem(KEYS.SEEDED, '1');
  } catch {
    // Ignore seed failures; public pages render an empty schedule instead.
  }
}

export function purgeExpiredMatches(nowMs: number = Date.now()): { removedCount: number } {
  try {
    ensureSeedData();
    const matches = safeReadJson<CricketMatch[]>(KEYS.MATCHES, []);
    const expired = matches.filter((match) => isMatchExpired(match, nowMs));
    if (expired.length === 0) return { removedCount: 0 };
    const expiredIds = new Set(expired.map((match) => match.id));
    const expiredSlugs = new Set(safeReadJson<string[]>(KEYS.EXPIRED_SLUGS, []));
    expired.forEach((match) => expiredSlugs.add(match.slug));
    safeWriteJson(KEYS.EXPIRED_SLUGS, Array.from(expiredSlugs));
    const remaining = matches.filter((match) => !expiredIds.has(match.id));
    safeWriteJson(KEYS.MATCHES, remaining);
    expired.forEach((match) => void deleteMatchFromFirestore(match.id));
    return { removedCount: expired.length };
  } catch {
    return { removedCount: 0 };
  }
}

export function getPublicMatches(): CricketMatch[] {
  try {
    enforceSingleAdminAndEnglishData();
    ensureSeedData();
    const matches = safeReadJson<CricketMatch[]>(KEYS.MATCHES, []);
    const cleaned = matches.map((match) => ({
      ...match,
      channelIds: Array.isArray(match.channelIds) ? match.channelIds : [],
    }));
    return cleaned.sort((a, b) => {
      const aKey = `${a.date}T${a.startTime}`;
      const bKey = `${b.date}T${b.startTime}`;
      return aKey.localeCompare(bKey);
    });
  } catch {
    return [];
  }
}

export function getPublicMatchBySlug(slug: string): CricketMatch | null {
  const normalized = slug.trim().toLowerCase();
  return getPublicMatches().find((match) => match.slug.toLowerCase() === normalized) ?? null;
}

export function getPublicChannels(): Channel[] {
  try {
    ensureSeedData();
    const channels = safeReadJson<Channel[]>(KEYS.CHANNELS, []);
    const unique = new Map<string, Channel>();
    channels.forEach((channel) => {
      if (!unique.has(channel.id)) unique.set(channel.id, channel);
    });
    return Array.from(unique.values());
  } catch {
    return [];
  }
}

/** Sync check of the last known Firestore admin state. Never reads localStorage. */
export function isAdminConfigured(): boolean {
  enforceSingleAdminAndEnglishData();
  return adminConfiguredCache === true;
}

export function getLockoutState(nowMs: number): { isLocked: boolean; remainingMs: number; failedAttempts: number } {
  const lockout = safeReadJson<LockoutState>(KEYS.ADMIN_LOCKOUT, { failedAttempts: 0, lockedUntil: null });
  let failedAttempts = lockout.failedAttempts || 0;
  let lockedUntil = lockout.lockedUntil || null;
  const remote = firestoreLockoutCache;
  if (remote) {
    failedAttempts = Math.max(failedAttempts, remote.failedAttempts);
    lockedUntil = Math.max(lockedUntil || 0, remote.lockedUntil || 0) || null;
  }
  if (lockedUntil && lockedUntil <= nowMs) {
    return { isLocked: false, remainingMs: 0, failedAttempts: 0 };
  }
  if (!lockedUntil) {
    return { isLocked: false, remainingMs: 0, failedAttempts };
  }
  return { isLocked: true, remainingMs: lockedUntil - nowMs, failedAttempts };
}

function appendAuditLog(action: AuditAction, targetName: string, adminEmail: string, details?: string): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `audit_${Date.now()}_${generateRandomHex(8)}`,
    timestamp: new Date().toISOString(),
    action,
    targetName,
    adminEmail,
    details,
  };
  try {
    const log = safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
    log.unshift(entry);
    safeWriteJson(KEYS.AUDIT_LOG, log.slice(0, 500));
  } catch {
    // Audit logging must never break the admin flow.
  }
  void persistAuditEntry(entry);
  return entry;
}

function saveSession(session: AdminSession | null): void {
  try {
    if (!session) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Session storage may be unavailable in some embedded browsers.
  }
}

export function getActiveAdminSession(nowMs: number = Date.now()): AdminSession | null {
  try {
    enforceSingleAdminAndEnglishData();
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AdminSession;
    if (session.email !== AUTHORIZED_ADMIN_EMAIL) {
      saveSession(null);
      return null;
    }
    // Session epoch: enforce it once the Firestore admin config is known.
    // While it is still loading, refresh it in the background and validate
    // the session against the local checks only (the config is re-checked
    // by the admin page every second).
    if (adminConfigCache) {
      if (session.sessionEpoch !== adminConfigCache.sessionEpoch) {
        saveSession(null);
        return null;
      }
    } else {
      refreshAdminConfigInBackground();
    }
    // Firebase Auth: enforce once Auth has restored its state. Before
    // that, the local session checks below still apply.
    if (authReady) {
      const user = getFirebaseAuth().currentUser;
      if (!user || user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
        saveSession(null);
        return null;
      }
    }
    if (nowMs - session.lastActivityAt >= INACTIVITY_TIMEOUT_MS || nowMs >= session.expiresAt) {
      saveSession(null);
      appendAuditLog('AUTO_LOGOUT_INACTIVITY', 'Admin Session', AUTHORIZED_ADMIN_EMAIL, 'Session ended after 15 minutes of inactivity');
      return null;
    }
    return session;
  } catch {
    saveSession(null);
    return null;
  }
}

export function touchAdminSession(nowMs: number): AdminSession | null {
  const active = getActiveAdminSession(nowMs);
  if (!active) return null;
  const refreshed: AdminSession = { ...active, lastActivityAt: nowMs, expiresAt: nowMs + INACTIVITY_TIMEOUT_MS };
  saveSession(refreshed);
  return refreshed;
}

function assertAuthorizedAdminSession(session: AdminSession | null): AdminSession {
  const active = getActiveAdminSession();
  if (!session || !active || session.email !== AUTHORIZED_ADMIN_EMAIL) {
    throw new Error('Admin session expired. Sign in again.');
  }
  if (!constantTimeEqual(session.token, active.token)) {
    throw new Error('Admin session expired. Sign in again.');
  }
  if (active.sessionEpoch !== session.sessionEpoch) {
    throw new Error('Admin session expired. Sign in again.');
  }
  return active;
}

export async function setupFirstAdmin(emailInput: string, password: string, confirmPassword: string): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  const configured = await fetchAdminConfigured();
  if (configured) {
    return { ok: false, error: 'Admin account is already configured.' };
  }
  const emailCheck = validateEmail(emailInput);
  if (!emailCheck.valid) {
    return { ok: false, error: emailCheck.error || 'Enter a valid email address.' };
  }
  if (!constantTimeEqual(emailCheck.value, AUTHORIZED_ADMIN_EMAIL)) {
    return { ok: false, error: 'Unauthorized email. Admin setup is restricted to the designated administrator account only.' };
  }
  const passwordCheck = validateStrongPassword(password);
  if (!passwordCheck.valid) {
    return { ok: false, error: passwordCheck.errors[0] || 'Password is not strong enough.' };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }
  try {
    const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), AUTHORIZED_ADMIN_EMAIL, password);
    const nowIso = new Date().toISOString();
    const config: AdminConfigDoc = { email: AUTHORIZED_ADMIN_EMAIL, uid: credential.user.uid, sessionEpoch: 1, createdAt: nowIso, updatedAt: nowIso };
    await setDoc(doc(getFirestoreDb(), 'admin', 'config'), config);
    adminConfigCache = config;
    adminConfigCacheAt = Date.now();
    adminConfiguredCache = true;
    safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, { failedAttempts: 0, lockedUntil: null });
    const nowMs = Date.now();
    const session: AdminSession = {
      token: generateRandomHex(32),
      email: AUTHORIZED_ADMIN_EMAIL,
      sessionEpoch: 1,
      issuedAt: nowMs,
      lastActivityAt: nowMs,
      expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
    };
    saveSession(session);
    appendAuditLog('ADMIN_SETUP', 'Admin Account', AUTHORIZED_ADMIN_EMAIL, 'Initial admin account created in Firebase Auth + Firestore.');
    return { ok: true, session };
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    if (code === 'auth/email-already-in-use') {
      return { ok: false, error: 'Admin account is already configured.' };
    }
    if (code === 'auth/weak-password') {
      return { ok: false, error: 'Password is too weak. Use at least 12 characters with upper and lower case letters, a number and a symbol.' };
    }
    return { ok: false, error: 'Could not create the admin account. Please try again.' };
  }
}

function recordFailedLoginAttempt(nowMs: number, failedAttempts: number): { ok: false; error: string; lockedUntil?: number } {
  const attempts = failedAttempts + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? nowMs + LOCKOUT_DURATION_MS : null;
  const state: LockoutState = { failedAttempts: attempts, lockedUntil };
  safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, state);
  void mirrorLockoutToFirestore(state);
  if (lockedUntil) {
    return { ok: false, error: 'Too many failed attempts. Admin login is temporarily locked for 15 minutes.', lockedUntil };
  }
  return { ok: false, error: 'Login failed. Invalid email or password.' };
}

export async function loginAdmin(emailInput: string, password: string): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string; lockedUntil?: number }> {
  const nowMs = Date.now();
  const lockout = getLockoutState(nowMs);
  if (lockout.isLocked) {
    return { ok: false, error: 'Too many failed attempts. Admin login is temporarily locked.', lockedUntil: nowMs + lockout.remainingMs };
  }
  const emailNorm = emailInput.trim().toLowerCase();
  if (!constantTimeEqual(emailNorm, AUTHORIZED_ADMIN_EMAIL)) {
    return recordFailedLoginAttempt(nowMs, lockout.failedAttempts);
  }
  try {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), AUTHORIZED_ADMIN_EMAIL, password);
    if (credential.user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
      await signOut(getFirebaseAuth());
      return { ok: false, error: 'Login failed. Invalid email or password.' };
    }
    safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, { failedAttempts: 0, lockedUntil: null });
    await clearFirestoreLockout();
    await ensureAdminConfigDoc(credential.user.uid);
    const epoch = adminConfigCache?.sessionEpoch ?? 1;
    const session: AdminSession = {
      token: generateRandomHex(32),
      email: AUTHORIZED_ADMIN_EMAIL,
      sessionEpoch: epoch,
      issuedAt: nowMs,
      lastActivityAt: nowMs,
      expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
    };
    saveSession(session);
    appendAuditLog('ADMIN_LOGIN', 'Admin Panel', AUTHORIZED_ADMIN_EMAIL);
    return { ok: true, session };
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    if (code === 'auth/user-not-found') {
      return { ok: false, error: 'Admin account is not set up yet.' };
    }
    return recordFailedLoginAttempt(nowMs, lockout.failedAttempts);
  }
}

export function logoutAdmin(session: AdminSession | null): void {
  const email = session?.email ?? AUTHORIZED_ADMIN_EMAIL;
  appendAuditLog('ADMIN_LOGOUT', 'Admin Session', email);
  saveSession(null);
  void signOut(getFirebaseAuth());
}

export function logoutAllAdminSessions(session: AdminSession | null): void {
  const verified = assertAuthorizedAdminSession(session);
  const nextEpoch = (adminConfigCache?.sessionEpoch ?? verified.sessionEpoch) + 1;
  adminConfigCache = adminConfigCache ? { ...adminConfigCache, sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() } : null;
  adminConfigCacheAt = Date.now();
  void (async () => {
    try {
      await setDoc(doc(getFirestoreDb(), 'admin', 'config'), { sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() }, { merge: true });
    } catch {
      // The local session is revoked regardless.
    }
  })();
  appendAuditLog('LOGOUT_ALL_SESSIONS', 'All Active Sessions', verified.email, 'Revoked all sessions across browser tabs');
  saveSession(null);
  notifyDataChanged();
}

export async function adminChangePassword(session: AdminSession | null, currentPassword: string, newPassword: string, confirmNewPassword: string): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  const verified = assertAuthorizedAdminSession(session);
  const user = getFirebaseAuth().currentUser;
  if (!user || !user.email) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
  } catch {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  const passwordCheck = validateStrongPassword(newPassword);
  if (!passwordCheck.valid) {
    return { ok: false, error: passwordCheck.errors[0] || 'Password is not strong enough.' };
  }
  if (newPassword !== confirmNewPassword) {
    return { ok: false, error: 'New passwords do not match.' };
  }
  if (currentPassword === newPassword) {
    return { ok: false, error: 'New password must be different from your current password.' };
  }
  try {
    await updatePassword(user, newPassword);
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    if (code === 'auth/requires-recent-login') {
      return { ok: false, error: 'For security, sign in again and then change the password.' };
    }
    return { ok: false, error: 'Could not change the password. Please try again.' };
  }
  const nextEpoch = (adminConfigCache?.sessionEpoch ?? verified.sessionEpoch) + 1;
  adminConfigCache = adminConfigCache ? { ...adminConfigCache, sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() } : null;
  adminConfigCacheAt = Date.now();
  void (async () => {
    try {
      await setDoc(doc(getFirestoreDb(), 'admin', 'config'), { sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() }, { merge: true });
    } catch {
      // The password itself was already changed in Firebase Auth.
    }
  })();
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
  appendAuditLog('PASSWORD_CHANGED', 'Admin Account', verified.email, 'Password rotated and older sessions invalidated');
  notifyDataChanged();
  return { ok: true, session: nextSession };
}

export function adminGetAuditLog(session: AdminSession | null): AuditLogEntry[] {
  assertAuthorizedAdminSession(session);
  return safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
}

/** Fetch the server-side audit log (Firestore) and merge it with the local cache. */
export async function fetchAuditLog(session: AdminSession | null): Promise<AuditLogEntry[]> {
  assertAuthorizedAdminSession(session);
  try {
    if (!getFirebaseAuth().currentUser) return safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
    const snap = await getDocs(collection(getFirestoreDb(), 'auditLog'));
    const remote = snap.docs.map((d) => d.data() as AuditLogEntry);
    const local = safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
    const merged = new Map<string, AuditLogEntry>();
    [...local, ...remote].forEach((entry) => {
      if (entry && entry.id) merged.set(entry.id, entry);
    });
    const sorted = [...merged.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 500);
    safeWriteJson(KEYS.AUDIT_LOG, sorted);
    return sorted;
  } catch {
    return safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
  }
}

interface MatchInput {
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

function validateMatchInput(input: MatchInput): { ok: boolean; error?: string } {
  const teamA = validateSafeText(input.teamA, 'Team A', { required: true, maxLength: 60 });
  if (!teamA.valid) return { ok: false, error: teamA.error };
  const teamB = validateSafeText(input.teamB, 'Team B', { required: true, maxLength: 60 });
  if (!teamB.valid) return { ok: false, error: teamB.error };
  if (teamA.value === teamB.value) {
    return { ok: false, error: 'Team A and Team B must be different.' };
  }
  const tournament = validateSafeText(input.tournament, 'Tournament', { required: true, maxLength: 160 });
  if (!tournament.valid) return { ok: false, error: tournament.error };
  const matchNumber = validateSafeText(input.matchNumber, 'Match Number', { required: true, maxLength: 80 });
  if (!matchNumber.valid) return { ok: false, error: matchNumber.error };
  const venue = validateSafeText(input.venue, 'Venue', { required: true, maxLength: 200 });
  if (!venue.valid) return { ok: false, error: venue.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: 'Date must use YYYY-MM-DD format.' };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    return { ok: false, error: 'Start time must use HH:MM format.' };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime)) {
    return { ok: false, error: 'End time must use HH:MM format.' };
  }
  if (input.endTime <= input.startTime) {
    return { ok: false, error: 'End time must be later than start time.' };
  }
  if (!['Upcoming', 'LIVE', 'Finished'].includes(input.status)) {
    return { ok: false, error: 'Select a valid status.' };
  }
  return { ok: true };
}

export function adminCreateMatch(session: AdminSession | null, input: MatchInput): { ok: boolean; match?: CricketMatch; error?: string } {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.' };
  }
  const validation = validateMatchInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const matches = getPublicMatches();
  const slug = generateCleanSlug(input.teamA, input.teamB, matches.map((match) => match.slug));
  const nowIso = new Date().toISOString();
  const match: CricketMatch = {
    id: `match_${Date.now()}_${generateRandomHex(6)}`,
    slug,
    teamA: input.teamA.trim(),
    teamB: input.teamB.trim(),
    tournament: input.tournament.trim(),
    matchNumber: input.matchNumber.trim(),
    venue: input.venue.trim(),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    status: input.status,
    channelIds: [...input.channelIds],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const next = [...matches, match];
  safeWriteJson(KEYS.MATCHES, next);
  void persistMatchToFirestore(match);
  appendAuditLog('MATCH_CREATED', `${match.teamA} vs ${match.teamB}`, AUTHORIZED_ADMIN_EMAIL, `${match.tournament} · ${match.date} ${match.startTime} IST`);
  notifyDataChanged();
  return { ok: true, match };
}

export function adminUpdateMatch(session: AdminSession | null, matchId: string, input: MatchInput): { ok: boolean; match?: CricketMatch; error?: string } {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.' };
  }
  const validation = validateMatchInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const matches = getPublicMatches();
  const target = matches.find((match) => match.id === matchId);
  if (!target) {
    return { ok: false, error: 'Match not found.' };
  }
  const others = matches.filter((match) => match.id !== matchId);
  const slug = target.slug && target.teamA === input.teamA.trim() && target.teamB === input.teamB.trim()
    ? target.slug
    : generateCleanSlug(input.teamA, input.teamB, others.map((match) => match.slug));
  const updated: CricketMatch = {
    ...target,
    slug,
    teamA: input.teamA.trim(),
    teamB: input.teamB.trim(),
    tournament: input.tournament.trim(),
    matchNumber: input.matchNumber.trim(),
    venue: input.venue.trim(),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    status: input.status,
    channelIds: [...input.channelIds],
    updatedAt: new Date().toISOString(),
  };
  safeWriteJson(KEYS.MATCHES, [...others, updated]);
  void persistMatchToFirestore(updated);
  appendAuditLog('MATCH_UPDATED', `${updated.teamA} vs ${updated.teamB}`, AUTHORIZED_ADMIN_EMAIL, `${updated.tournament} · ${updated.date} ${updated.startTime} IST`);
  notifyDataChanged();
  return { ok: true, match: updated };
}

export function adminDeleteMatch(session: AdminSession | null, matchId: string): { ok: boolean; error?: string } {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.' };
  }
  const matches = getPublicMatches();
  const target = matches.find((match) => match.id === matchId);
  if (!target) {
    return { ok: false, error: 'Match not found.' };
  }
  safeWriteJson(KEYS.MATCHES, matches.filter((match) => match.id !== matchId));
  void deleteMatchFromFirestore(matchId);
  appendAuditLog('MATCH_DELETED', `${target.teamA} vs ${target.teamB}`, AUTHORIZED_ADMIN_EMAIL, `${target.tournament} · ${target.date} ${target.startTime} IST`);
  notifyDataChanged();
  return { ok: true };
}

interface ChannelInput {
  name: string;
  language: string;
  streamUrl: string;
}

function validateChannelInput(input: ChannelInput): { ok: boolean; error?: string } {
  const name = validateSafeText(input.name, 'Channel Name', { required: true, maxLength: 60 });
  if (!name.valid) return { ok: false, error: name.error };
  const language = validateSafeText(input.language, 'Language', { required: true, maxLength: 40 });
  if (!language.valid) return { ok: false, error: language.error };
  const url = validateStreamUrl(input.streamUrl);
  if (!url.valid) return { ok: false, error: url.error };
  return { ok: true };
}

export function adminCreateChannel(session: AdminSession | null, input: ChannelInput): { ok: boolean; channel?: Channel; error?: string } {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.' };
  }
  const validation = validateChannelInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const channels = getPublicChannels();
  const nowIso = new Date().toISOString();
  const channel: Channel = {
    id: `channel_${Date.now()}_${generateRandomHex(6)}`,
    name: input.name.trim(),
    language: input.language.trim(),
    streamUrl: input.streamUrl.trim(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  safeWriteJson(KEYS.CHANNELS, [...channels, channel]);
  void persistChannelToFirestore(channel);
  appendAuditLog('CHANNEL_CREATED', channel.name, AUTHORIZED_ADMIN_EMAIL, `${channel.language} channel`);
  notifyDataChanged();
  return { ok: true, channel };
}

export function adminUpdateChannel(session: AdminSession | null, channelId: string, input: ChannelInput): { ok: boolean; channel?: Channel; error?: string } {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.' };
  }
  const validation = validateChannelInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const channels = getPublicChannels();
  const target = channels.find((channel) => channel.id === channelId);
  if (!target) {
    return { ok: false, error: 'Channel not found.' };
  }
  const updated: Channel = {
    ...target,
    name: input.name.trim(),
    language: input.language.trim(),
    streamUrl: input.streamUrl.trim(),
    updatedAt: new Date().toISOString(),
  };
  safeWriteJson(KEYS.CHANNELS, channels.map((channel) => (channel.id === channelId ? updated : channel)));
  void persistChannelToFirestore(updated);
  appendAuditLog('CHANNEL_UPDATED', updated.name, AUTHORIZED_ADMIN_EMAIL, `${updated.language} channel`);
  notifyDataChanged();
  return { ok: true, channel: updated };
}

export function adminDeleteChannel(session: AdminSession | null, channelId: string): { ok: boolean; error?: string } {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.' };
  }
  const channels = getPublicChannels();
  const target = channels.find((channel) => channel.id === channelId);
  if (!target) {
    return { ok: false, error: 'Channel not found.' };
  }
  const matches = getPublicMatches();
  const cleanedMatches = matches.map((match) => ({
    ...match,
    channelIds: match.channelIds.filter((id) => id !== channelId),
  }));
  safeWriteJson(KEYS.MATCHES, cleanedMatches);
  void persistMatchesToFirestore(cleanedMatches);
  safeWriteJson(KEYS.CHANNELS, channels.filter((channel) => channel.id !== channelId));
  void deleteChannelFromFirestore(channelId);
  appendAuditLog('CHANNEL_DELETED', target.name, AUTHORIZED_ADMIN_EMAIL, `${target.language} channel`);
  notifyDataChanged();
  return { ok: true };
}

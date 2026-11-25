import {
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
  onSnapshot,
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
  validateSafeText,
  validateStrongPassword,
} from './security';
import {
  buildChannelHtmlFromLegacy,
  getChannelHtml,
  parseChannelNameFromHtml,
} from './channelHtml';
import { isMatchExpired } from './time';
import { isValidCountryCode, isWestIndiesTeam, normalizeCountryCode } from './countries';
import { resolveBackfillCountryCode } from './teamFlags';

/**
 * Live Firebase Firestore storage + hardened single-admin Firebase Auth.
 *
 * All matches, channels, audit logs, and session epoch metadata live in
 * Firebase Firestore (server-side) and are controlled exclusively from the
 * Admin Panel. Public pages subscribe LIVE to Firestore via onSnapshot so
 * every admin add/edit/delete takes effect immediately with zero rebuilds
 * and zero hardcoded content in code.
 */

const KEYS = {
  LEGACY_MATCHES: 'clsw_matches_v1',
  LEGACY_CHANNELS: 'clsw_channels_v1',
  LEGACY_EXPIRED_SLUGS: 'clsw_expired_slugs_v1',
  LEGACY_SEEDED: 'clsw_seeded_v1',
  LEGACY_ADMIN_AUTH: 'clsw_admin_auth_v1',
  ADMIN_LOCKOUT: 'clsw_admin_lockout_v1',
  AUDIT_LOG: 'clsw_audit_log_v1',
} as const;

const SESSION_STORAGE_KEY = 'clsw_admin_session_v1';

export const AUTHORIZED_ADMIN_EMAIL = 'biswajitcopy3@gmail.com';
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;

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

function cleanupLegacyLocalStorage(): void {
  try {
    window.localStorage.removeItem(KEYS.LEGACY_ADMIN_AUTH);
    window.localStorage.removeItem(KEYS.LEGACY_MATCHES);
    window.localStorage.removeItem(KEYS.LEGACY_CHANNELS);
    window.localStorage.removeItem(KEYS.LEGACY_EXPIRED_SLUGS);
    window.localStorage.removeItem(KEYS.LEGACY_SEEDED);
  } catch {
    // Ignore storage cleanup errors.
  }
}

// ---------- In-memory live Firestore mirror ----------

let liveMatches: CricketMatch[] = [];
let liveChannels: Channel[] = [];

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
let oneTimeSeedAttempted = false;

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

function normalizeMatches(raw: CricketMatch[]): CricketMatch[] {
  return raw
    .map((match) => ({
      ...match,
      countryCodeA: normalizeCountryCode(match.countryCodeA),
      countryCodeB: normalizeCountryCode(match.countryCodeB),
      channelIds: Array.isArray(match.channelIds) ? match.channelIds : [],
      pageContent: typeof match.pageContent === 'string' ? match.pageContent : '',
    }))
    .sort((a, b) => {
      const aKey = `${a.date}T${a.startTime}`;
      const bKey = `${b.date}T${b.startTime}`;
      return aKey.localeCompare(bKey);
    });
}

function normalizeChannels(raw: Channel[]): Channel[] {
  const unique = new Map<string, Channel>();
  raw.forEach((channel) => {
    if (channel && channel.id && !unique.has(channel.id)) {
      const html = getChannelHtml(channel);
      const name = parseChannelNameFromHtml(html, channel.name || channel.id);
      unique.set(channel.id, {
        ...channel,
        html,
        name,
        language: typeof channel.language === 'string' ? channel.language : undefined,
        streamUrl: typeof channel.streamUrl === 'string' ? channel.streamUrl : undefined,
        pageContent: typeof channel.pageContent === 'string' ? channel.pageContent : undefined,
      });
    }
  });
  return Array.from(unique.values()).sort((a, b) => {
    const aTime = a.createdAt || '';
    const bTime = b.createdAt || '';
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return a.name.localeCompare(b.name);
  });
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
 * Fetch the Firestore admin/config document (including sessionEpoch) to keep
 * server-side session revocation metadata in sync.
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
      await setDoc(ref, {
        email: AUTHORIZED_ADMIN_EMAIL,
        uid,
        sessionEpoch: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    await fetchAdminConfigured();
  } catch {
    // The sign-in itself already succeeded; the config doc heals on next login.
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
    await setDoc(
      doc(getFirestoreDb(), 'security', 'lockout'),
      {
        failedAttempts: state.failedAttempts,
        lockedUntil: state.lockedUntil,
        lastFailedAt: Date.now(),
      },
      { merge: true }
    );
  } catch {
    // Best-effort; local lockout still applies in this browser.
  }
}

async function clearFirestoreLockout(): Promise<void> {
  try {
    await deleteDoc(doc(getFirestoreDb(), 'security', 'lockout'));
  } catch {
    // Best-effort.
  }
}

export async function fetchLockoutState(): Promise<{
  isLocked: boolean;
  remainingMs: number;
  failedAttempts: number;
}> {
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
    // Keep local lockout state.
  }
  return getLockoutState(Date.now());
}

/**
 * Subscribe LIVE to the Firestore matches collection.
 * Home Page, Match Page, and Admin Panel all read strictly from Firestore.
 */
export function subscribeToLiveMatches(
  onUpdate: (matches: CricketMatch[]) => void,
  onReady?: () => void
): () => void {
  cleanupLegacyLocalStorage();
  const db = getFirestoreDb();
  let notifiedReady = false;
  return onSnapshot(
    collection(db, 'matches'),
    (snap) => {
      const next = normalizeMatches(snap.docs.map((d) => d.data() as CricketMatch));
      liveMatches = next;
      onUpdate(next);
      if (!notifiedReady) {
        notifiedReady = true;
        onReady?.();
      }
    },
    () => {
      if (!notifiedReady) {
        notifiedReady = true;
        onReady?.();
      }
    }
  );
}

/**
 * Subscribe LIVE to the Firestore channels collection.
 * Channels Page, Live Player Page, Match Page, and Admin Panel all read strictly from Firestore.
 */
export function subscribeToLiveChannels(
  onUpdate: (channels: Channel[]) => void,
  onReady?: () => void
): () => void {
  cleanupLegacyLocalStorage();
  const db = getFirestoreDb();
  let notifiedReady = false;
  return onSnapshot(
    collection(db, 'channels'),
    (snap) => {
      const next = normalizeChannels(snap.docs.map((d) => d.data() as Channel));
      liveChannels = next;
      onUpdate(next);
      if (!notifiedReady) {
        notifiedReady = true;
        onReady?.();
      }
    },
    () => {
      if (!notifiedReady) {
        notifiedReady = true;
        onReady?.();
      }
    }
  );
}

/**
 * One-time Firestore seed for initial channels ONLY when the Firestore channels
 * collection is completely empty and the authorized admin is signed in.
 * If channels already exist in Firestore, performs a one-time non-destructive
 * migration of any legacy channel doc lacking `html` into pure HTML using its
 * own live Firestore fields (name, streamUrl, pageContent). Never overwrites
 * any channel that already has saved HTML.
 */
export async function ensureSeedData(): Promise<void> {
  cleanupLegacyLocalStorage();
  if (oneTimeSeedAttempted) return;
  const user = getFirebaseAuth().currentUser;
  if (!user || user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
    return;
  }
  oneTimeSeedAttempted = true;
  try {
    const db = getFirestoreDb();
    const channelSnap = await getDocs(collection(db, 'channels'));
    const nowIso = new Date().toISOString();

    if (!channelSnap.empty) {
      // Non-destructively migrate only legacy channel docs that do not have `html` yet.
      const batch = writeBatch(db);
      let migratedCount = 0;
      channelSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as Partial<Channel>;
        const existingHtml = typeof data.html === 'string' ? data.html.trim() : '';
        if (!existingHtml) {
          const generatedHtml = buildChannelHtmlFromLegacy({
            name: typeof data.name === 'string' ? data.name : docSnap.id,
            language: typeof data.language === 'string' ? data.language : '',
            streamUrl: typeof data.streamUrl === 'string' ? data.streamUrl : '',
            pageContent: typeof data.pageContent === 'string' ? data.pageContent : '',
          });
          const resolvedName = parseChannelNameFromHtml(
            generatedHtml,
            typeof data.name === 'string' ? data.name : docSnap.id
          );
          batch.set(
            doc(db, 'channels', docSnap.id),
            {
              html: generatedHtml,
              name: resolvedName,
              updatedAt: nowIso,
            },
            { merge: true }
          );
          migratedCount += 1;
        }
      });
      if (migratedCount > 0) {
        await batch.commit();
      }
      return;
    }

    const { default: initialChannels } = await import('../data/initial-channels.json');
    const batch = writeBatch(db);
    initialChannels.forEach((item, index) => {
      const createdAt = new Date(Date.parse(nowIso) + index).toISOString();
      const html = typeof item.html === 'string' ? item.html : buildChannelHtmlFromLegacy(item);
      const name = parseChannelNameFromHtml(html, item.name || item.id);
      const channel: Channel = {
        id: item.id,
        name,
        html,
        createdAt,
        updatedAt: nowIso,
      };
      batch.set(doc(db, 'channels', channel.id), stripUndefined(channel));
    });
    await batch.commit();
  } catch {
    oneTimeSeedAttempted = false;
  }
}

/**
 * Force-refresh matches and channels from Firestore (useful after admin login).
 * Also runs the one-time empty-collection channel seed if channels is empty.
 */
export async function refreshPublicDataFromFirestore(): Promise<void> {
  cleanupLegacyLocalStorage();
  await ensureSeedData();
  try {
    const db = getFirestoreDb();
    const [matchSnap, channelSnap] = await Promise.all([
      getDocs(collection(db, 'matches')),
      getDocs(collection(db, 'channels')),
    ]);
    liveMatches = normalizeMatches(matchSnap.docs.map((d) => d.data() as CricketMatch));
    liveChannels = normalizeChannels(channelSnap.docs.map((d) => d.data() as Channel));
  } catch {
    // Live onSnapshot listeners remain authoritative when connected.
  }
}

/**
 * Delete expired matches (30+ minutes past end time) from Firestore when the
 * authorized admin is signed in. Public views also filter expired matches live.
 */
export async function purgeExpiredMatches(
  nowMs: number = Date.now()
): Promise<{ removedCount: number }> {
  const expired = liveMatches.filter((match) => isMatchExpired(match, nowMs));
  if (expired.length === 0) return { removedCount: 0 };

  const user = getFirebaseAuth().currentUser;
  if (user && user.email?.toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
    try {
      const db = getFirestoreDb();
      const batch = writeBatch(db);
      expired.forEach((match) => batch.delete(doc(db, 'matches', match.id)));
      await batch.commit();
    } catch {
      // Will retry on next check.
    }
  }
  return { removedCount: expired.length };
}

export function getPublicMatches(): CricketMatch[] {
  return liveMatches;
}

export function getPublicMatchBySlug(slug: string): CricketMatch | null {
  const normalized = slug.trim().toLowerCase();
  return liveMatches.find((match) => match.slug.toLowerCase() === normalized) ?? null;
}

export function getPublicChannels(): Channel[] {
  return liveChannels;
}

/** Sync check of the last known Firestore admin state. Never reads localStorage. */
export function isAdminConfigured(): boolean {
  cleanupLegacyLocalStorage();
  return adminConfiguredCache === true;
}

export function getLockoutState(nowMs: number): {
  isLocked: boolean;
  remainingMs: number;
  failedAttempts: number;
} {
  const lockout = safeReadJson<LockoutState>(KEYS.ADMIN_LOCKOUT, {
    failedAttempts: 0,
    lockedUntil: null,
  });
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

function appendAuditLog(
  action: AuditAction,
  targetName: string,
  adminEmail: string,
  details?: string
): AuditLogEntry {
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
    cleanupLegacyLocalStorage();
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AdminSession;
    if (session.email !== AUTHORIZED_ADMIN_EMAIL) {
      saveSession(null);
      return null;
    }
    if (adminConfigCache) {
      if (session.sessionEpoch !== adminConfigCache.sessionEpoch) {
        saveSession(null);
        return null;
      }
    } else {
      refreshAdminConfigInBackground();
    }
    if (authReady) {
      const user = getFirebaseAuth().currentUser;
      if (!user || user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
        saveSession(null);
        return null;
      }
    }
    if (nowMs - session.lastActivityAt >= INACTIVITY_TIMEOUT_MS || nowMs >= session.expiresAt) {
      saveSession(null);
      appendAuditLog(
        'AUTO_LOGOUT_INACTIVITY',
        'Admin Session',
        AUTHORIZED_ADMIN_EMAIL,
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

export function touchAdminSession(nowMs: number): AdminSession | null {
  const active = getActiveAdminSession(nowMs);
  if (!active) return null;
  const refreshed: AdminSession = {
    ...active,
    lastActivityAt: nowMs,
    expiresAt: nowMs + INACTIVITY_TIMEOUT_MS,
  };
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
  const user = getFirebaseAuth().currentUser;
  if (!user || user.email?.toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('Firebase authentication session expired. Sign in again.');
  }
  return active;
}

function recordFailedLoginAttempt(
  nowMs: number,
  failedAttempts: number
): { ok: false; error: string; lockedUntil?: number } {
  const attempts = failedAttempts + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? nowMs + LOCKOUT_DURATION_MS : null;
  const state: LockoutState = { failedAttempts: attempts, lockedUntil };
  safeWriteJson<LockoutState>(KEYS.ADMIN_LOCKOUT, state);
  void mirrorLockoutToFirestore(state);
  if (lockedUntil) {
    return {
      ok: false,
      error: 'Too many failed attempts. Admin login is temporarily locked for 15 minutes.',
      lockedUntil,
    };
  }
  return { ok: false, error: 'Login failed. Invalid email or password.' };
}

export async function loginAdmin(
  emailInput: string,
  password: string
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string; lockedUntil?: number }> {
  const nowMs = Date.now();
  const lockout = getLockoutState(nowMs);
  if (lockout.isLocked) {
    return {
      ok: false,
      error: 'Too many failed attempts. Admin login is temporarily locked.',
      lockedUntil: nowMs + lockout.remainingMs,
    };
  }
  const emailNorm = emailInput.trim().toLowerCase();
  if (!constantTimeEqual(emailNorm, AUTHORIZED_ADMIN_EMAIL)) {
    return recordFailedLoginAttempt(nowMs, lockout.failedAttempts);
  }
  try {
    const credential = await signInWithEmailAndPassword(
      getFirebaseAuth(),
      AUTHORIZED_ADMIN_EMAIL,
      password
    );
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
  } catch {
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
  adminConfigCache = adminConfigCache
    ? { ...adminConfigCache, sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() }
    : null;
  adminConfigCacheAt = Date.now();
  void (async () => {
    try {
      await setDoc(
        doc(getFirestoreDb(), 'admin', 'config'),
        { sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch {
      // The local session is revoked regardless.
    }
  })();
  appendAuditLog(
    'LOGOUT_ALL_SESSIONS',
    'All Active Sessions',
    verified.email,
    'Revoked all sessions across browser tabs'
  );
  saveSession(null);
}

export async function adminChangePassword(
  session: AdminSession | null,
  currentPassword: string,
  newPassword: string,
  confirmNewPassword: string
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
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
  adminConfigCache = adminConfigCache
    ? { ...adminConfigCache, sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() }
    : null;
  adminConfigCacheAt = Date.now();
  try {
    await setDoc(
      doc(getFirestoreDb(), 'admin', 'config'),
      { sessionEpoch: nextEpoch, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch {
    // Password was already changed in Firebase Auth.
  }
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
    const sorted = [...merged.values()]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 500);
    safeWriteJson(KEYS.AUDIT_LOG, sorted);
    return sorted;
  } catch {
    return safeReadJson<AuditLogEntry[]>(KEYS.AUDIT_LOG, []);
  }
}

interface MatchInput {
  teamA: string;
  teamB: string;
  countryCodeA?: string;
  countryCodeB?: string;
  tournament: string;
  matchNumber: string;
  venue: string;
  date: string;
  startTime: string;
  endTime: string;
  status: MatchStatus;
  channelIds: string[];
  pageContent?: string;
}

function validateMatchInput(input: MatchInput): { ok: boolean; error?: string } {
  const teamA = validateSafeText(input.teamA, 'Team A', { required: true, maxLength: 60 });
  if (!teamA.valid) return { ok: false, error: teamA.error };
  const teamB = validateSafeText(input.teamB, 'Team B', { required: true, maxLength: 60 });
  if (!teamB.valid) return { ok: false, error: teamB.error };
  if (teamA.value === teamB.value) {
    return { ok: false, error: 'Team A and Team B must be different.' };
  }
  if (input.countryCodeA && input.countryCodeA.trim() && !isValidCountryCode(input.countryCodeA)) {
    return { ok: false, error: 'Select a valid country for Team A.' };
  }
  if (input.countryCodeB && input.countryCodeB.trim() && !isValidCountryCode(input.countryCodeB)) {
    return { ok: false, error: 'Select a valid country for Team B.' };
  }
  const tournament = validateSafeText(input.tournament, 'Tournament', {
    required: true,
    maxLength: 160,
  });
  if (!tournament.valid) return { ok: false, error: tournament.error };
  const matchNumber = validateSafeText(input.matchNumber, 'Match Number', {
    required: true,
    maxLength: 80,
  });
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

export async function adminCreateMatch(
  session: AdminSession | null,
  input: MatchInput
): Promise<{ ok: boolean; match?: CricketMatch; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }
  const validation = validateMatchInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const slug = generateCleanSlug(
    input.teamA,
    input.teamB,
    liveMatches.map((match) => match.slug)
  );
  const nowIso = new Date().toISOString();
  const teamATrimmed = input.teamA.trim();
  const teamBTrimmed = input.teamB.trim();
  const countryCodeA = isWestIndiesTeam(teamATrimmed)
    ? undefined
    : normalizeCountryCode(input.countryCodeA);
  const countryCodeB = isWestIndiesTeam(teamBTrimmed)
    ? undefined
    : normalizeCountryCode(input.countryCodeB);
  const match: CricketMatch = {
    id: `match_${Date.now()}_${generateRandomHex(6)}`,
    slug,
    teamA: teamATrimmed,
    teamB: teamBTrimmed,
    countryCodeA,
    countryCodeB,
    tournament: input.tournament.trim(),
    matchNumber: input.matchNumber.trim(),
    venue: input.venue.trim(),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    status: input.status,
    channelIds: [...input.channelIds],
    pageContent: typeof input.pageContent === 'string' ? input.pageContent : '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  try {
    await setDoc(doc(getFirestoreDb(), 'matches', match.id), stripUndefined(match));
  } catch {
    return { ok: false, error: 'Failed to save match to Firestore. Check your connection and try again.' };
  }
  appendAuditLog(
    'MATCH_CREATED',
    `${match.teamA} vs ${match.teamB}`,
    AUTHORIZED_ADMIN_EMAIL,
    `${match.tournament} · ${match.date} ${match.startTime} IST`
  );
  return { ok: true, match };
}

export async function adminUpdateMatch(
  session: AdminSession | null,
  matchId: string,
  input: MatchInput
): Promise<{ ok: boolean; match?: CricketMatch; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }
  const validation = validateMatchInput(input);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const target = liveMatches.find((match) => match.id === matchId);
  if (!target) {
    return { ok: false, error: 'Match not found.' };
  }
  const others = liveMatches.filter((match) => match.id !== matchId);
  const slug =
    target.slug && target.teamA === input.teamA.trim() && target.teamB === input.teamB.trim()
      ? target.slug
      : generateCleanSlug(
          input.teamA,
          input.teamB,
          others.map((match) => match.slug)
        );
  const teamATrimmed = input.teamA.trim();
  const teamBTrimmed = input.teamB.trim();
  const countryCodeA = isWestIndiesTeam(teamATrimmed)
    ? undefined
    : normalizeCountryCode(input.countryCodeA);
  const countryCodeB = isWestIndiesTeam(teamBTrimmed)
    ? undefined
    : normalizeCountryCode(input.countryCodeB);
  const updated: CricketMatch = {
    ...target,
    slug,
    teamA: teamATrimmed,
    teamB: teamBTrimmed,
    countryCodeA,
    countryCodeB,
    tournament: input.tournament.trim(),
    matchNumber: input.matchNumber.trim(),
    venue: input.venue.trim(),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    status: input.status,
    channelIds: [...input.channelIds],
    pageContent:
      input.pageContent !== undefined
        ? input.pageContent
        : (target.pageContent ?? ''),
    updatedAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(getFirestoreDb(), 'matches', updated.id), stripUndefined(updated));
  } catch {
    return { ok: false, error: 'Failed to update match in Firestore. Check your connection and try again.' };
  }
  appendAuditLog(
    'MATCH_UPDATED',
    `${updated.teamA} vs ${updated.teamB}`,
    AUTHORIZED_ADMIN_EMAIL,
    `${updated.tournament} · ${updated.date} ${updated.startTime} IST`
  );
  return { ok: true, match: updated };
}

export async function adminBackfillMatchCountryCodes(
  session: AdminSession | null
): Promise<{ ok: boolean; updatedCount: number; totalChecked: number; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      updatedCount: 0,
      totalChecked: 0,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }

  try {
    const db = getFirestoreDb();
    const snap = await getDocs(collection(db, 'matches'));
    const pendingUpdates: Array<{ id: string; patch: Partial<Pick<CricketMatch, 'countryCodeA' | 'countryCodeB'>> }> = [];

    for (const matchDoc of snap.docs) {
      const data = matchDoc.data() as CricketMatch;
      const patch: Partial<Pick<CricketMatch, 'countryCodeA' | 'countryCodeB'>> = {};

      if (!normalizeCountryCode(data.countryCodeA)) {
        const resolvedA = resolveBackfillCountryCode(data.teamA, data.tournament);
        if (resolvedA) {
          patch.countryCodeA = resolvedA;
        }
      }

      if (!normalizeCountryCode(data.countryCodeB)) {
        const resolvedB = resolveBackfillCountryCode(data.teamB, data.tournament);
        if (resolvedB) {
          patch.countryCodeB = resolvedB;
        }
      }

      if (patch.countryCodeA || patch.countryCodeB) {
        pendingUpdates.push({ id: matchDoc.id, patch });
      }
    }

    const BATCH_LIMIT = 400;
    for (let i = 0; i < pendingUpdates.length; i += BATCH_LIMIT) {
      const chunk = pendingUpdates.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const item of chunk) {
        batch.update(doc(db, 'matches', item.id), item.patch);
      }
      await batch.commit();
    }

    if (pendingUpdates.length > 0) {
      appendAuditLog(
        'MATCH_UPDATED',
        'Backfill Country Codes',
        AUTHORIZED_ADMIN_EMAIL,
        `Updated country codes on ${pendingUpdates.length} ${pendingUpdates.length === 1 ? 'match' : 'matches'}`
      );
    }

    return {
      ok: true,
      updatedCount: pendingUpdates.length,
      totalChecked: snap.size,
    };
  } catch {
    return {
      ok: false,
      updatedCount: 0,
      totalChecked: 0,
      error: 'Failed to backfill country codes in Firestore. Check your connection and try again.',
    };
  }
}

export async function adminDeleteMatch(
  session: AdminSession | null,
  matchId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }
  const target = liveMatches.find((match) => match.id === matchId);
  if (!target) {
    return { ok: false, error: 'Match not found.' };
  }
  try {
    await deleteDoc(doc(getFirestoreDb(), 'matches', matchId));
  } catch {
    return { ok: false, error: 'Failed to delete match from Firestore. Check your connection and try again.' };
  }
  appendAuditLog(
    'MATCH_DELETED',
    `${target.teamA} vs ${target.teamB}`,
    AUTHORIZED_ADMIN_EMAIL,
    `${target.tournament} · ${target.date} ${target.startTime} IST`
  );
  return { ok: true };
}

interface ChannelInput {
  html: string;
}

function generateChannelIdFromName(name: string, existingIds: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const taken = new Set(existingIds.map((id) => id.toLowerCase()));
  if (base && !taken.has(base)) {
    return base;
  }
  return `${base || 'channel'}-${generateRandomHex(4)}`;
}

function validateChannelInput(
  input: ChannelInput
): { ok: boolean; html?: string; name?: string; error?: string } {
  const html = typeof input.html === 'string' ? input.html.trim() : '';
  if (!html) {
    return { ok: false, error: 'Channel HTML code is required.' };
  }
  const parsedName = parseChannelNameFromHtml(html);
  if (!parsedName) {
    return {
      ok: false,
      error:
        'Include a channel name in the HTML using data-channel-name="Channel Name" (e.g. <div data-channel-name="Willow Cricket">) or an <h1> heading.',
    };
  }
  if (parsedName.length > 80) {
    return { ok: false, error: 'Parsed channel name must be 80 characters or fewer.' };
  }
  return { ok: true, html, name: parsedName };
}

export async function adminCreateChannel(
  session: AdminSession | null,
  input: ChannelInput
): Promise<{ ok: boolean; channel?: Channel; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }
  const validation = validateChannelInput(input);
  if (!validation.ok || !validation.html || !validation.name) {
    return { ok: false, error: validation.error };
  }
  const nowIso = new Date().toISOString();
  const id = generateChannelIdFromName(
    validation.name,
    liveChannels.map((c) => c.id)
  );
  const channel: Channel = {
    id,
    name: validation.name,
    html: validation.html,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  try {
    await setDoc(doc(getFirestoreDb(), 'channels', channel.id), stripUndefined(channel));
  } catch {
    return { ok: false, error: 'Failed to save channel to Firestore. Check your connection and try again.' };
  }
  appendAuditLog('CHANNEL_CREATED', channel.name, AUTHORIZED_ADMIN_EMAIL, `ID: ${channel.id}`);
  return { ok: true, channel };
}

export async function adminUpdateChannel(
  session: AdminSession | null,
  channelId: string,
  input: ChannelInput
): Promise<{ ok: boolean; channel?: Channel; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }
  const validation = validateChannelInput(input);
  if (!validation.ok || !validation.html || !validation.name) {
    return { ok: false, error: validation.error };
  }
  const target = liveChannels.find((channel) => channel.id === channelId);
  if (!target) {
    return { ok: false, error: 'Channel not found.' };
  }
  const updated: Channel = {
    id: target.id,
    name: validation.name,
    html: validation.html,
    createdAt: target.createdAt,
    updatedAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(getFirestoreDb(), 'channels', updated.id), stripUndefined(updated));
  } catch {
    return { ok: false, error: 'Failed to update channel in Firestore. Check your connection and try again.' };
  }
  appendAuditLog('CHANNEL_UPDATED', updated.name, AUTHORIZED_ADMIN_EMAIL, `ID: ${updated.id}`);
  return { ok: true, channel: updated };
}

export async function adminDeleteChannel(
  session: AdminSession | null,
  channelId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    assertAuthorizedAdminSession(session);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Admin session expired. Sign in again.',
    };
  }
  const target = liveChannels.find((channel) => channel.id === channelId);
  if (!target) {
    return { ok: false, error: 'Channel not found.' };
  }
  try {
    const db = getFirestoreDb();
    const batch = writeBatch(db);
    liveMatches.forEach((match) => {
      if (match.channelIds.includes(channelId)) {
        const cleanedMatch: CricketMatch = {
          ...match,
          channelIds: match.channelIds.filter((id) => id !== channelId),
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'matches', match.id), stripUndefined(cleanedMatch));
      }
    });
    batch.delete(doc(db, 'channels', channelId));
    await batch.commit();
  } catch {
    return { ok: false, error: 'Failed to delete channel from Firestore. Check your connection and try again.' };
  }
  appendAuditLog('CHANNEL_DELETED', target.name, AUTHORIZED_ADMIN_EMAIL, `ID: ${target.id}`);
  return { ok: true };
}

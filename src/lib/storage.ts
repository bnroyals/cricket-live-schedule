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
import { ADMIN_EMAIL, getFirebaseAuth, getFirestoreDb } from './firebase';
import type {
  AdminSession,
  AuditAction,
  AuditLogEntry,
  Channel,
  CricketMatch,
  LockoutState,
  MatchStatus,
  WatchLink,
} from '../types/cricket';
import {
  generateCleanSlug,
  generateRandomHex,
  validateEmail,
  validateSafeText,
  validateStreamUrl,
  validateStrongPassword,
} from './security';
import { isMatchExpired } from './time';

/**
 * Admin auth + data storage (Firebase Auth + Firestore, server-side).
 *
 * The admin account and the matches / channels / audit data live in
 * Firebase Auth + Firestore, NOT in browser localStorage. localStorage is
 * used only as a local cache for public content and for the 15-minute
 * inactivity session timer. Clearing browser data therefore never deletes
 * the admin account: after clearing, this module still finds the admin
 * record in Firestore (admin/config) and the admin page asks for login,
 * never for setup again.
 *
 * Firestore rules (see firestore.rules, also published in the console):
 * public read-only for matches/channels, write only for the authenticated
 * admin biswajitcopy3@gmail.com. The admin/config document is readable by
 * everyone so the login page can tell setup from login; only the admin can
 * write it. security/lockout holds only failed-login counters.
 */

export const storageVersion = '2.0.0';

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
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_AUDIT_ENTRIES = 500;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const SEED_CHANNELS: Channel[] = [
  { id: 'star-sports-1', name: 'Star Sports 1', description: 'Cricket · Hindi & English', logoUrl: '', streamUrl: 'https://www.hotstar.com/in/sports/cricket', country: 'India', language: 'English', isActive: true, createdAt: 1700000000000, updatedAt: 1700000000000 },
  { id: 'jiohotstar', name: 'JioHotstar', description: 'Live cricket streaming', logoUrl: '', streamUrl: 'https://www.hotstar.com/in/sports/cricket', country: 'India', language: 'English', isActive: true, createdAt: 1700000001000, updatedAt: 1700000001000 },
  { id: 'sky-sports-cricket', name: 'Sky Sports Cricket', description: 'Live cricket from England', logoUrl: '', streamUrl: 'https://www.skysports.com/cricket', country: 'United Kingdom', language: 'English', isActive: true, createdAt: 1700000002000, updatedAt: 1700000002000 },
  { id: 'willow-tv', name: 'Willow TV', description: 'Live cricket in the USA', logoUrl: '', streamUrl: 'https://www.willow.tv', country: 'United States', language: 'English', isActive: true, createdAt: 1700000003000, updatedAt: 1700000003000 },
  { id: 'ptv-sports', name: 'PTV Sports', description: 'Live cricket from Pakistan', logoUrl: '', streamUrl: 'https://www.ptvsports.pk', country: 'Pakistan', language: 'English', isActive: true, createdAt: 1700000004000, updatedAt: 1700000004000 },
];

const SEED_MATCHES: CricketMatch[] = [
  { id: 'india-vs-australia-1st-t20i', series: 'Australia tour of India', teamA: 'India', teamB: 'Australia', matchDate: '2026-11-20', startTime: '19:00', endTime: '22:30', venue: 'Eden Gardens', status: 'completed', channels: ['star-sports-1', 'jiohotstar'], watchLinks: [{ label: 'Star Sports 1', url: 'https://www.hotstar.com/in/sports/cricket' }, { label: 'JioHotstar', url: 'https://www.hotstar.com/in/sports/cricket' }], streamUrls: ['https://www.hotstar.com/in/sports/cricket'], matchUrl: 'https://www.hotstar.com/in/sports/cricket', tags: ['T20I', 'India', 'Australia'], createdAt: 1700000000000, updatedAt: 1700000000000 },
  { id: 'england-vs-south-africa-2nd-odi', series: 'South Africa tour of England', teamA: 'England', teamB: 'South Africa', matchDate: '2026-11-21', startTime: '15:30', endTime: '23:00', venue: "Lord's", status: 'completed', channels: ['sky-sports-cricket'], watchLinks: [{ label: 'Sky Sports Cricket', url: 'https://www.skysports.com/cricket' }], streamUrls: ['https://www.skysports.com/cricket'], matchUrl: 'https://www.skysports.com/cricket', tags: ['ODI', 'England', 'South Africa'], createdAt: 1700000001000, updatedAt: 1700000001000 },
  { id: 'pakistan-vs-new-zealand-3rd-t20i', series: 'New Zealand tour of Pakistan', teamA: 'Pakistan', teamB: 'New Zealand', matchDate: '2026-11-22', startTime: '19:30', endTime: '23:00', venue: 'Gaddafi Stadium', status: 'completed', channels: ['ptv-sports', 'willow-tv'], watchLinks: [{ label: 'PTV Sports', url: 'https://www.ptvsports.pk' }, { label: 'Willow TV', url: 'https://www.willow.tv' }], streamUrls: ['https://www.ptvsports.pk', 'https://www.willow.tv'], matchUrl: 'https://www.willow.tv', tags: ['T20I', 'Pakistan', 'New Zealand'], createdAt: 1700000002000, updatedAt: 1700000002000 },
  { id: 'india-vs-australia-2nd-t20i', series: 'Australia tour of India', teamA: 'India', teamB: 'Australia', matchDate: '2026-11-23', startTime: '19:00', endTime: '22:30', venue: 'M. Chinnaswamy Stadium', status: 'live', channels: ['star-sports-1', 'jiohotstar'], watchLinks: [{ label: 'Star Sports 1', url: 'https://www.hotstar.com/in/sports/cricket' }, { label: 'JioHotstar', url: 'https://www.hotstar.com/in/sports/cricket' }], streamUrls: ['https://www.hotstar.com/in/sports/cricket'], matchUrl: 'https://www.hotstar.com/in/sports/cricket', tags: ['T20I', 'India', 'Australia'], createdAt: 1700000003000, updatedAt: 1700000003000 },
  { id: 'west-indies-vs-sri-lanka-1st-test', series: 'Sri Lanka tour of West Indies', teamA: 'West Indies', teamB: 'Sri Lanka', matchDate: '2026-11-24', startTime: '10:00', endTime: '17:00', venue: 'Sabina Park', status: 'upcoming', channels: ['willow-tv'], watchLinks: [{ label: 'Willow TV', url: 'https://www.willow.tv' }], streamUrls: ['https://www.willow.tv'], matchUrl: 'https://www.willow.tv', tags: ['Test', 'West Indies', 'Sri Lanka'], createdAt: 1700000004000, updatedAt: 1700000004000 },
  { id: 'bangladesh-vs-afghanistan-1st-odi', series: 'Afghanistan tour of Bangladesh', teamA: 'Bangladesh', teamB: 'Afghanistan', matchDate: '2026-11-25', startTime: '14:00', endTime: '21:30', venue: 'Shere Bangla National Stadium', status: 'upcoming', channels: ['gazi-tv'], watchLinks: [{ label: 'Gazi TV', url: 'https://www.gtv.com.bd' }], streamUrls: ['https://www.gtv.com.bd'], matchUrl: 'https://www.gtv.com.bd', tags: ['ODI', 'Bangladesh', 'Afghanistan'], createdAt: 1700000005000, updatedAt: 1700000005000 },
];

export function normalizeSeriesName(series: string): string {
  return series.trim().replace(/\s+/g, ' ');
}

export function normalizeTeamName(team: string): string {
  return team.trim().replace(/\s+/g, ' ');
}

export function normalizeChannelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function localStorageAvailable(): boolean {
  try {
    const testKey = '__clsw_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; Firestore remains the source of truth.
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

// In-memory caches. Sync getters read these (seeded from the local cache on
// first use); async loaders refresh them from Firestore.
let matchesCache: CricketMatch[] | null = null;
let channelsCache: Channel[] | null = null;
let auditCache: AuditLogEntry[] | null = null;
let adminConfiguredCache: boolean | null = null;
let adminEmailCache: string | null = null;
let firestoreLockoutCache: LockoutState | null = null;
let authReadyPromise: Promise<User | null> | null = null;

function getExpiredSlugs(): string[] {
  const parsed = readJson<string[]>(KEYS.EXPIRED_SLUGS);
  return Array.isArray(parsed) ? parsed : [];
}

function seedIfNeeded(): void {
  try {
    if (window.localStorage.getItem(KEYS.SEEDED)) return;
    const expiredSlugs = new Set(getExpiredSlugs());
    const matches = SEED_MATCHES.filter((m) => !expiredSlugs.has(m.id));
    writeJson(KEYS.MATCHES, matches);
    writeJson(KEYS.CHANNELS, SEED_CHANNELS);
    window.localStorage.setItem(KEYS.SEEDED, '1');
  } catch {
    // Ignore storage errors.
  }
}

function loadMatchesFromStorage(): CricketMatch[] {
  seedIfNeeded();
  if (matchesCache) return matchesCache;
  const stored = readJson<CricketMatch[]>(KEYS.MATCHES);
  if (Array.isArray(stored) && stored.length > 0) {
    matchesCache = stored.map(normalizeMatchDates);
    return matchesCache;
  }
  matchesCache = SEED_MATCHES.filter((m) => !new Set(getExpiredSlugs()).has(m.id)).map((m) => ({ ...m }));
  return matchesCache;
}

function saveMatchesToStorage(matches: CricketMatch[]): void {
  matchesCache = matches;
  writeJson(KEYS.MATCHES, matches);
}

function loadChannelsFromStorage(): Channel[] {
  seedIfNeeded();
  if (channelsCache) return channelsCache;
  const stored = readJson<Channel[]>(KEYS.CHANNELS);
  if (Array.isArray(stored) && stored.length > 0) {
    channelsCache = stored.map(normalizeChannel);
    return channelsCache;
  }
  channelsCache = SEED_CHANNELS.map((c) => ({ ...c }));
  return channelsCache;
}

function saveChannelsToStorage(channels: Channel[]): void {
  channelsCache = channels;
  writeJson(KEYS.CHANNELS, channels);
}

export function normalizeMatchDates(match: CricketMatch): CricketMatch {
  const normalized = { ...match };
  if (typeof normalized.matchDate === 'string') {
    const parsed = new Date(normalized.matchDate);
    if (!Number.isNaN(parsed.getTime())) {
      normalized.matchDate = parsed.toISOString().slice(0, 10);
    }
  }
  return normalized;
}

export function normalizeChannel(channel: Channel): Channel {
  return {
    ...channel,
    name: normalizeChannelName(channel.name || ''),
    streamUrl: (channel.streamUrl || '').trim(),
  };
}

export function getLiveMatches(matches: CricketMatch[]): CricketMatch[] {
  return matches.filter((m) => m.status === 'live');
}

export function getMatchById(matches: CricketMatch[], id: string): CricketMatch | undefined {
  return matches.find((m) => m.id === id);
}

export function getPublicMatches(): CricketMatch[] {
  return loadMatchesFromStorage().filter((match) => match.status !== 'cancelled');
}

export function getPublicMatchesLiveFirst(): CricketMatch[] {
  const all = getPublicMatches();
  return [...all].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (a.status !== 'live' && b.status === 'live') return 1;
    return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime();
  });
}

export function getChannelsForMatch(match: CricketMatch): Channel[] {
  const channels = loadChannelsFromStorage();
  const ids = new Set(match.channels || []);
  return channels.filter((c) => ids.has(c.id) && c.isActive);
}

export function getChannels(): Channel[] {
  return [...loadChannelsFromStorage()];
}

export function getChannelById(id: string): Channel | undefined {
  return loadChannelsFromStorage().find((c) => c.id === id);
}

export function getVisibleChannels(): Channel[] {
  return loadChannelsFromStorage().filter((c) => c.isActive);
}

export function getChannelLogo(channel: Channel): string {
  return channel.logoUrl || '';
}

export function sanitizeChannelName(name: string): string {
  return normalizeChannelName(name);
}

export function getChannelForMatch(match: CricketMatch): Channel | undefined {
  return getChannelsForMatch(match)[0];
}

export function channelHasStreamUrl(channel: Channel): boolean {
  return Boolean(channel.streamUrl && channel.streamUrl.trim().length > 0);
}

// ---------- Firestore helpers ----------

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

async function firestoreGetMatches(): Promise<CricketMatch[] | null> {
  try {
    const snap = await getDocs(collection(getFirestoreDb(), 'matches'));
    return snap.docs.map((d) => normalizeMatchDates(d.data() as CricketMatch));
  } catch {
    return null;
  }
}

async function firestoreGetChannels(): Promise<Channel[] | null> {
  try {
    const snap = await getDocs(collection(getFirestoreDb(), 'channels'));
    return snap.docs.map((d) => normalizeChannel(d.data() as Channel));
  } catch {
    return null;
  }
}

async function seedFirestoreMatches(matches: CricketMatch[]): Promise<void> {
  try {
    const db = getFirestoreDb();
    const batch = writeBatch(db);
    matches.forEach((m) => batch.set(doc(db, 'matches', m.id), stripUndefined(normalizeMatchDates(m))));
    await batch.commit();
  } catch {
    // Seeding is best-effort; the local cache still serves the page.
  }
}

async function seedFirestoreChannels(channels: Channel[]): Promise<void> {
  try {
    const db = getFirestoreDb();
    const batch = writeBatch(db);
    channels.forEach((c) => batch.set(doc(db, 'channels', c.id), stripUndefined(normalizeChannel(c))));
    await batch.commit();
  } catch {
    // Best-effort.
  }
}

async function persistMatchToFirestore(match: CricketMatch): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await setDoc(doc(getFirestoreDb(), 'matches', match.id), stripUndefined(normalizeMatchDates(match)));
  } catch {
    // The local cache already holds the change; Firestore sync retries on next load.
  }
}

async function deleteFirestoreMatches(ids: string[]): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser || ids.length === 0) return;
    const db = getFirestoreDb();
    const batch = writeBatch(db);
    ids.forEach((id) => batch.delete(doc(db, 'matches', id)));
    await batch.commit();
  } catch {
    // Best-effort.
  }
}

async function persistChannelToFirestore(channel: Channel): Promise<void> {
  try {
    if (!getFirebaseAuth().currentUser) return;
    await setDoc(doc(getFirestoreDb(), 'channels', channel.id), stripUndefined(normalizeChannel(channel)));
  } catch {
    // Best-effort.
  }
}

async function deleteFirestoreChannel(id: string): Promise<void> {
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

/**
 * Load matches from Firestore (server-side source of truth). Falls back to
 * the local cache / seed data when Firestore is unreachable. When the admin
 * is signed in and Firestore is still empty, the seed data is published to
 * Firestore once so every browser and device sees the same content.
 */
export async function loadMatches(): Promise<CricketMatch[]> {
  const fromFirestore = await firestoreGetMatches();
  if (fromFirestore && fromFirestore.length > 0) {
    saveMatchesToStorage(fromFirestore.map(normalizeMatchDates));
    return [...fromFirestore];
  }
  if (fromFirestore && fromFirestore.length === 0 && getFirebaseAuth().currentUser) {
    const local = loadMatchesFromStorage();
    await seedFirestoreMatches(local);
  }
  return [...loadMatchesFromStorage()];
}

export async function loadChannels(): Promise<Channel[]> {
  const fromFirestore = await firestoreGetChannels();
  if (fromFirestore && fromFirestore.length > 0) {
    saveChannelsToStorage(fromFirestore.map(normalizeChannel));
    return [...fromFirestore];
  }
  if (fromFirestore && fromFirestore.length === 0 && getFirebaseAuth().currentUser) {
    const local = loadChannelsFromStorage();
    await seedFirestoreChannels(local);
  }
  return [...loadChannelsFromStorage()];
}

export async function saveMatches(matches: CricketMatch[]): Promise<void> {
  const normalized = matches.map(normalizeMatchDates);
  saveMatchesToStorage(normalized);
  try {
    if (!getFirebaseAuth().currentUser) return;
    const db = getFirestoreDb();
    const existing = await getDocs(collection(db, 'matches'));
    const batch = writeBatch(db);
    const wanted = new Set(normalized.map((m) => m.id));
    existing.docs.forEach((d) => {
      if (!wanted.has(d.id)) batch.delete(d.ref);
    });
    normalized.forEach((m) => batch.set(doc(db, 'matches', m.id), stripUndefined(normalizeMatchDates(m))));
    await batch.commit();
  } catch {
    // Best-effort.
  }
}

export async function saveChannels(channels: Channel[]): Promise<void> {
  const normalized = channels.map(normalizeChannel);
  saveChannelsToStorage(normalized);
  try {
    if (!getFirebaseAuth().currentUser) return;
    const db = getFirestoreDb();
    const existing = await getDocs(collection(db, 'channels'));
    const batch = writeBatch(db);
    const wanted = new Set(normalized.map((c) => c.id));
    existing.docs.forEach((d) => {
      if (!wanted.has(d.id)) batch.delete(d.ref);
    });
    normalized.forEach((c) => batch.set(doc(db, 'channels', c.id), stripUndefined(normalizeChannel(c))));
    await batch.commit();
  } catch {
    // Best-effort.
  }
}

export function mergeChannelList(existing: Channel[], incoming: Channel[]): Channel[] {
  const map = new Map(existing.map((c) => [c.id, c]));
  incoming.forEach((c) => {
    if (!map.has(c.id)) map.set(c.id, normalizeChannel(c));
  });
  return Array.from(map.values());
}

export function mergeMatchList(existing: CricketMatch[], incoming: CricketMatch[]): CricketMatch[] {
  const map = new Map(existing.map((m) => [m.id, m]));
  incoming.forEach((m) => {
    if (!map.has(m.id)) map.set(m.id, normalizeMatchDates(m));
  });
  return Array.from(map.values());
}

export function seedMatchesIfNeeded(): CricketMatch[] {
  return [...loadMatchesFromStorage()];
}

export function seedChannelsIfNeeded(): Channel[] {
  return [...loadChannelsFromStorage()];
}

// ---------- Admin configuration (Firestore is the source of truth) ----------

/**
 * Ask Firestore whether an admin account exists. This is the ONLY place
 * that decides setup vs login, so clearing browser data can never bring
 * the setup screen back once an admin exists.
 */
export async function fetchAdminConfigured(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(getFirestoreDb(), 'admin', 'config'));
    adminConfiguredCache = snap.exists();
    if (snap.exists()) {
      const data = snap.data();
      if (typeof data.email === 'string') adminEmailCache = data.email;
    }
    return adminConfiguredCache;
  } catch {
    return adminConfiguredCache ?? false;
  }
}

/** Sync check of the last known Firestore admin state. Never reads localStorage. */
export function isAdminConfigured(): boolean {
  return adminConfiguredCache === true;
}

export function getAdminEmail(): string | null {
  if (adminEmailCache) return adminEmailCache;
  const user = getFirebaseAuth().currentUser;
  if (user?.email) {
    adminEmailCache = user.email;
    return adminEmailCache;
  }
  return null;
}

/** Resolves once Firebase Auth has restored (or found no) signed-in user. */
export function waitForFirebaseAuthReady(): Promise<User | null> {
  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }
  return authReadyPromise;
}

async function ensureAdminConfigDoc(uid: string): Promise<void> {
  try {
    const ref = doc(getFirestoreDb(), 'admin', 'config');
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { email: ADMIN_EMAIL, uid, createdAt: Date.now() });
    }
    adminConfiguredCache = true;
    adminEmailCache = ADMIN_EMAIL;
  } catch {
    // The login itself already succeeded; the config doc heals on next login.
  }
}

// ---------- Lockout (5 failed attempts -> 15 minute lock) ----------

function saveLockoutState(state: LockoutState): void {
  writeJson(KEYS.ADMIN_LOCKOUT, state);
}

export function getLockoutState(): LockoutState {
  const local = readJson<LockoutState>(KEYS.ADMIN_LOCKOUT);
  const localState: LockoutState = {
    failedAttempts: local?.failedAttempts || 0,
    lockedUntil: local?.lockedUntil || null,
  };
  if (localState.lockedUntil && localState.lockedUntil <= Date.now()) {
    return { failedAttempts: 0, lockedUntil: null };
  }
  const remote = firestoreLockoutCache;
  if (!remote) return localState;
  if (remote.lockedUntil && remote.lockedUntil <= Date.now()) return localState;
  return {
    failedAttempts: Math.max(localState.failedAttempts, remote.failedAttempts),
    lockedUntil: Math.max(localState.lockedUntil || 0, remote.lockedUntil || 0) || null,
  };
}

export function getFailedAttemptsCount(): number {
  return getLockoutState().failedAttempts;
}

function recordFailedLoginAttempt(): LockoutState {
  const current = getLockoutState();
  const failedAttempts = current.failedAttempts + 1;
  const lockedUntil = failedAttempts >= LOCKOUT_THRESHOLD ? Date.now() + LOCKOUT_DURATION_MS : null;
  const next: LockoutState = { failedAttempts, lockedUntil };
  saveLockoutState(next);
  return next;
}

function resetLockoutState(): void {
  removeKey(KEYS.ADMIN_LOCKOUT);
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

export async function fetchLockoutState(): Promise<LockoutState> {
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
  return getLockoutState();
}

// ---------- Admin session (15-minute inactivity timeout) ----------

function readLocalSession(): AdminSession | null {
  const session = readJson<AdminSession>(SESSION_STORAGE_KEY);
  if (!session) return null;
  if (Date.now() - session.lastActivityAt > SESSION_TIMEOUT_MS) {
    removeKey(SESSION_STORAGE_KEY);
    return null;
  }
  return session;
}

export function getActiveAdminSession(): AdminSession | null {
  const session = readLocalSession();
  if (!session) return null;
  // The session is only valid while Firebase Auth still has the admin signed in.
  const user = getFirebaseAuth().currentUser;
  if (!user || user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return null;
  return session;
}

export function touchAdminSession(): void {
  const session = readLocalSession();
  if (!session) return;
  session.lastActivityAt = Date.now();
  writeJson(SESSION_STORAGE_KEY, session);
}

function createLocalSession(email: string): AdminSession {
  const session: AdminSession = { email, createdAt: Date.now(), lastActivityAt: Date.now() };
  writeJson(SESSION_STORAGE_KEY, session);
  return session;
}

export function getAdminSessions(): AdminSession[] {
  const session = getActiveAdminSession();
  return session ? [session] : [];
}

export function adminLogout(): void {
  const email = getAdminEmail();
  if (email) addAuditEntry('logout', 'Administrator signed out.', email);
  removeKey(SESSION_STORAGE_KEY);
  void signOut(getFirebaseAuth());
}

// ---------- Admin auth (Firebase Auth, server-side) ----------

export async function setupFirstAdmin(email: string, password: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== ADMIN_EMAIL) {
    return { ok: false, error: 'Only biswajitcopy3@gmail.com can be the administrator.' };
  }
  if (!validateEmail(normalizedEmail)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const passwordValidation = validateStrongPassword(password);
  if (!passwordValidation.ok) {
    return { ok: false, error: passwordValidation.error || 'Password is not strong enough.' };
  }
  const configured = await fetchAdminConfigured();
  if (configured) {
    return { ok: false, error: 'An administrator account already exists. Use the login form.' };
  }
  try {
    const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), normalizedEmail, password);
    await setDoc(doc(getFirestoreDb(), 'admin', 'config'), { email: normalizedEmail, uid: credential.user.uid, createdAt: Date.now() });
    adminConfiguredCache = true;
    adminEmailCache = normalizedEmail;
    createLocalSession(normalizedEmail);
    addAuditEntry('setup', 'Administrator account created in Firebase Auth + Firestore.', normalizedEmail);
    return { ok: true, message: 'Administrator account created. Sign in with your email and password.' };
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    if (code === 'auth/email-already-in-use') {
      return { ok: false, error: 'An administrator account already exists. Use the login form.' };
    }
    if (code === 'auth/weak-password') {
      return { ok: false, error: 'Password is too weak. Use at least 12 characters with upper and lower case letters, a number and a symbol.' };
    }
    return { ok: false, error: 'Could not create the administrator account. Please try again.' };
  }
}

export async function loginAdmin(email: string, password: string): Promise<{ ok: boolean; error?: string; lockoutUntil?: number; session?: AdminSession; message?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const lockout = getLockoutState();
  if (lockout.lockedUntil && lockout.lockedUntil > Date.now()) {
    const minutes = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
    return { ok: false, error: `Too many failed attempts. Try again in ${minutes} minute(s).`, lockoutUntil: lockout.lockedUntil };
  }
  if (normalizedEmail !== ADMIN_EMAIL) {
    const state = recordFailedLoginAttempt();
    await mirrorLockoutToFirestore(state);
    return { ok: false, error: 'Invalid email or password.' };
  }
  try {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), normalizedEmail, password);
    if (credential.user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      await signOut(getFirebaseAuth());
      return { ok: false, error: 'Invalid email or password.' };
    }
    resetLockoutState();
    await clearFirestoreLockout();
    await ensureAdminConfigDoc(credential.user.uid);
    const session = createLocalSession(normalizedEmail);
    addAuditEntry('login', 'Administrator signed in.', normalizedEmail);
    return { ok: true, session, message: 'Signed in.' };
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    const state = recordFailedLoginAttempt();
    await mirrorLockoutToFirestore(state);
    if (state.lockedUntil && state.lockedUntil > Date.now()) {
      return { ok: false, error: 'Too many failed attempts. Account locked for 15 minutes.', lockoutUntil: state.lockedUntil };
    }
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-email') {
      return { ok: false, error: 'Invalid email or password.' };
    }
    return { ok: false, error: 'Could not sign in. Please try again.' };
  }
}

export async function adminChangePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const session = getActiveAdminSession();
  if (!session) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const strength = validateStrongPassword(newPassword);
  if (!strength.ok) {
    return { ok: false, error: strength.error || 'Password is not strong enough.' };
  }
  const user = getFirebaseAuth().currentUser;
  if (!user || !user.email) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    addAuditEntry('password_change', 'Administrator password changed.', user.email);
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return { ok: false, error: 'Current password is incorrect.' };
    }
    if (code === 'auth/requires-recent-login') {
      return { ok: false, error: 'For security, sign in again and then change the password.' };
    }
    return { ok: false, error: 'Could not change the password. Please try again.' };
  }
}

export function requireAdminSession(): boolean {
  return getActiveAdminSession() !== null;
}

// ---------- Audit log (Firestore, admin only) ----------

export function addAuditEntry(action: AuditAction, details: string, adminEmail?: string): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `audit_${Date.now()}_${generateRandomHex(8)}`,
    timestamp: Date.now(),
    action,
    details,
    adminEmail: adminEmail || getAdminEmail() || 'unknown',
  };
  const log = getAuditLog();
  log.unshift(entry);
  auditCache = log.slice(0, MAX_AUDIT_ENTRIES);
  writeJson(KEYS.AUDIT_LOG, auditCache);
  void persistAuditEntry(entry);
  return entry;
}

export function getAuditLog(): AuditLogEntry[] {
  if (auditCache) return [...auditCache];
  const stored = readJson<AuditLogEntry[]>(KEYS.AUDIT_LOG);
  auditCache = Array.isArray(stored) ? stored : [];
  return [...auditCache];
}

export function adminGetAuditLog(): AuditLogEntry[] {
  return getAuditLog();
}

export async function fetchAuditLog(): Promise<AuditLogEntry[]> {
  try {
    if (!getFirebaseAuth().currentUser) return getAuditLog();
    const snap = await getDocs(collection(getFirestoreDb(), 'auditLog'));
    const entries = (snap.docs.map((d) => d.data() as AuditLogEntry)).sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_AUDIT_ENTRIES);
    if (entries.length > 0) {
      auditCache = entries;
      writeJson(KEYS.AUDIT_LOG, entries);
    }
    return [...(auditCache || [])];
  } catch {
    return getAuditLog();
  }
}

// ---------- Export / import / reset ----------

export function adminExportData(): { ok: boolean; data?: string; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  try {
    const payload = {
      version: storageVersion,
      exportedAt: new Date().toISOString(),
      matches: loadMatchesFromStorage(),
      channels: loadChannelsFromStorage(),
      auditLog: getAuditLog(),
    };
    return { ok: true, data: JSON.stringify(payload, null, 2) };
  } catch {
    return { ok: false, error: 'Could not export data.' };
  }
}

export async function adminImportData(json: string): Promise<{ ok: boolean; importedMatches: number; importedChannels: number; error?: string }> {
  if (!requireAdminSession()) {
    return { ok: false, importedMatches: 0, importedChannels: 0, error: 'Admin session expired. Sign in again.' };
  }
  try {
    const parsed = JSON.parse(json) as { matches?: unknown; channels?: unknown };
    const importedMatches = Array.isArray(parsed.matches) ? (parsed.matches as CricketMatch[]).map(normalizeMatchDates) : [];
    const importedChannels = Array.isArray(parsed.channels) ? (parsed.channels as Channel[]).map(normalizeChannel) : [];
    if (importedMatches.length === 0 && importedChannels.length === 0) {
      return { ok: false, importedMatches: 0, importedChannels: 0, error: 'No matches or channels found in the file.' };
    }
    if (importedMatches.length > 0) await saveMatches(importedMatches);
    if (importedChannels.length > 0) await saveChannels(importedChannels);
    addAuditEntry('data_import', `Imported ${importedMatches.length} matches and ${importedChannels.length} channels.`);
    return { ok: true, importedMatches: importedMatches.length, importedChannels: importedChannels.length };
  } catch {
    return { ok: false, importedMatches: 0, importedChannels: 0, error: 'The file is not valid JSON data.' };
  }
}

export async function adminResetAllData(): Promise<{ ok: boolean; error?: string }> {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  try {
    const db = getFirestoreDb();
    const [matchSnap, channelSnap, auditSnap] = await Promise.all([
      getDocs(collection(db, 'matches')),
      getDocs(collection(db, 'channels')),
      getDocs(collection(db, 'auditLog')),
    ]);
    const batch = writeBatch(db);
    matchSnap.docs.forEach((d) => batch.delete(d.ref));
    channelSnap.docs.forEach((d) => batch.delete(d.ref));
    auditSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch {
    // Continue with the local reset even if Firestore is unreachable.
  }
  matchesCache = null;
  channelsCache = null;
  auditCache = [];
  removeKey(KEYS.MATCHES);
  removeKey(KEYS.CHANNELS);
  removeKey(KEYS.AUDIT_LOG);
  removeKey(KEYS.SEEDED);
  removeKey(KEYS.EXPIRED_SLUGS);
  seedIfNeeded();
  addAuditEntry('data_reset', 'All data was reset to the default schedule.');
  return { ok: true };
}

// ---------- Admin match / channel management ----------

type MatchInput = {
  series: string;
  teamA: string;
  teamB: string;
  teamAFlag?: string;
  teamBFlag?: string;
  matchDate: string;
  startTime: string;
  endTime?: string;
  venue?: string;
  status?: MatchStatus;
  channels?: string[];
  watchLinks?: WatchLink[];
  streamUrls?: string[];
  matchUrl?: string;
  tags?: string[];
};

function validateMatchInput(data: MatchInput): string | null {
  const seriesCheck = validateSafeText(data.series, 120);
  if (!seriesCheck.ok) return seriesCheck.error || 'Invalid series name.';
  const teamACheck = validateSafeText(data.teamA, 80);
  if (!teamACheck.ok) return teamACheck.error || 'Invalid team name.';
  const teamBCheck = validateSafeText(data.teamB, 80);
  if (!teamBCheck.ok) return teamBCheck.error || 'Invalid team name.';
  if (data.venue) {
    const venueCheck = validateSafeText(data.venue, 120);
    if (!venueCheck.ok) return venueCheck.error || 'Invalid venue.';
  }
  if (!data.matchDate || Number.isNaN(new Date(data.matchDate).getTime())) return 'Enter a valid match date.';
  if (!data.startTime) return 'Enter a start time.';
  for (const url of data.streamUrls || []) {
    const urlCheck = validateStreamUrl(url);
    if (!urlCheck.ok) return urlCheck.error || 'Invalid stream URL.';
  }
  if (data.matchUrl) {
    const urlCheck = validateStreamUrl(data.matchUrl);
    if (!urlCheck.ok) return urlCheck.error || 'Invalid match URL.';
  }
  return null;
}

export function adminCreateMatch(data: MatchInput): { ok: boolean; match?: CricketMatch; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const validationError = validateMatchInput(data);
  if (validationError) return { ok: false, error: validationError };
  const matches = loadMatchesFromStorage();
  const baseId = generateCleanSlug(`${data.teamA}-vs-${data.teamB}-${data.matchDate}`) || `match-${Date.now()}`;
  let id = baseId;
  let counter = 2;
  while (matches.some((m) => m.id === id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }
  const now = Date.now();
  const match: CricketMatch = {
    id,
    series: normalizeSeriesName(data.series),
    teamA: normalizeTeamName(data.teamA),
    teamB: normalizeTeamName(data.teamB),
    teamAFlag: data.teamAFlag,
    teamBFlag: data.teamBFlag,
    matchDate: data.matchDate,
    startTime: data.startTime,
    endTime: data.endTime,
    venue: data.venue,
    status: data.status || 'upcoming',
    channels: data.channels || [],
    watchLinks: data.watchLinks || [],
    streamUrls: data.streamUrls || [],
    matchUrl: data.matchUrl,
    tags: data.tags || [],
    createdAt: now,
    updatedAt: now,
  };
  const next = [...matches, normalizeMatchDates(match)];
  saveMatchesToStorage(next);
  void persistMatchToFirestore(match);
  addAuditEntry('match_create', `Created match ${match.teamA} vs ${match.teamB} (${match.matchDate}).`);
  return { ok: true, match };
}

export function adminUpdateMatch(id: string, data: Partial<MatchInput>): { ok: boolean; match?: CricketMatch; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const matches = loadMatchesFromStorage();
  const index = matches.findIndex((m) => m.id === id);
  if (index === -1) return { ok: false, error: 'Match not found.' };
  const merged: MatchInput = {
    series: data.series ?? matches[index].series,
    teamA: data.teamA ?? matches[index].teamA,
    teamB: data.teamB ?? matches[index].teamB,
    teamAFlag: data.teamAFlag ?? matches[index].teamAFlag,
    teamBFlag: data.teamBFlag ?? matches[index].teamBFlag,
    matchDate: data.matchDate ?? matches[index].matchDate,
    startTime: data.startTime ?? matches[index].startTime,
    endTime: data.endTime ?? matches[index].endTime,
    venue: data.venue ?? matches[index].venue,
    status: data.status ?? matches[index].status,
    channels: data.channels ?? matches[index].channels,
    watchLinks: data.watchLinks ?? matches[index].watchLinks,
    streamUrls: data.streamUrls ?? matches[index].streamUrls,
    matchUrl: data.matchUrl ?? matches[index].matchUrl,
    tags: data.tags ?? matches[index].tags,
  };
  const validationError = validateMatchInput(merged);
  if (validationError) return { ok: false, error: validationError };
  const updated: CricketMatch = {
    ...matches[index],
    series: normalizeSeriesName(merged.series),
    teamA: normalizeTeamName(merged.teamA),
    teamB: normalizeTeamName(merged.teamB),
    teamAFlag: merged.teamAFlag,
    teamBFlag: merged.teamBFlag,
    matchDate: merged.matchDate,
    startTime: merged.startTime,
    endTime: merged.endTime,
    venue: merged.venue,
    status: merged.status,
    channels: merged.channels || [],
    watchLinks: merged.watchLinks || [],
    streamUrls: merged.streamUrls || [],
    matchUrl: merged.matchUrl,
    tags: merged.tags || [],
    updatedAt: Date.now(),
  };
  const next = [...matches];
  next[index] = normalizeMatchDates(updated);
  saveMatchesToStorage(next);
  void persistMatchToFirestore(updated);
  addAuditEntry('match_update', `Updated match ${updated.teamA} vs ${updated.teamB} (${updated.matchDate}).`);
  return { ok: true, match: updated };
}

export function adminDeleteMatch(id: string): { ok: boolean; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const matches = loadMatchesFromStorage();
  const target = matches.find((m) => m.id === id);
  if (!target) return { ok: false, error: 'Match not found.' };
  saveMatchesToStorage(matches.filter((m) => m.id !== id));
  void deleteFirestoreMatches([id]);
  addAuditEntry('match_delete', `Deleted match ${target.teamA} vs ${target.teamB} (${target.matchDate}).`);
  return { ok: true };
}

type ChannelInput = {
  name: string;
  description?: string;
  logoUrl?: string;
  streamUrl?: string;
  country?: string;
  language?: string;
  isActive?: boolean;
};

function validateChannelInput(data: ChannelInput): string | null {
  const nameCheck = validateSafeText(data.name, 80);
  if (!nameCheck.ok) return nameCheck.error || 'Invalid channel name.';
  if (data.description) {
    const descCheck = validateSafeText(data.description, 200);
    if (!descCheck.ok) return descCheck.error || 'Invalid channel description.';
  }
  if (data.streamUrl) {
    const urlCheck = validateStreamUrl(data.streamUrl);
    if (!urlCheck.ok) return urlCheck.error || 'Invalid stream URL.';
  }
  if (data.logoUrl) {
    const urlCheck = validateStreamUrl(data.logoUrl);
    if (!urlCheck.ok) return urlCheck.error || 'Invalid logo URL.';
  }
  return null;
}

export function adminCreateChannel(data: ChannelInput): { ok: boolean; channel?: Channel; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const validationError = validateChannelInput(data);
  if (validationError) return { ok: false, error: validationError };
  const channels = loadChannelsFromStorage();
  const baseId = generateCleanSlug(data.name) || `channel-${Date.now()}`;
  let id = baseId;
  let counter = 2;
  while (channels.some((c) => c.id === id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }
  const now = Date.now();
  const channel: Channel = {
    id,
    name: normalizeChannelName(data.name),
    description: data.description || '',
    logoUrl: data.logoUrl || '',
    streamUrl: data.streamUrl || '',
    country: data.country || '',
    language: data.language || 'English',
    isActive: data.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  saveChannelsToStorage([...channels, normalizeChannel(channel)]);
  void persistChannelToFirestore(channel);
  addAuditEntry('channel_create', `Created channel ${channel.name}.`);
  return { ok: true, channel };
}

export function adminUpdateChannel(id: string, data: Partial<ChannelInput>): { ok: boolean; channel?: Channel; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const channels = loadChannelsFromStorage();
  const index = channels.findIndex((c) => c.id === id);
  if (index === -1) return { ok: false, error: 'Channel not found.' };
  const merged: ChannelInput = {
    name: data.name ?? channels[index].name,
    description: data.description ?? channels[index].description,
    logoUrl: data.logoUrl ?? channels[index].logoUrl,
    streamUrl: data.streamUrl ?? channels[index].streamUrl,
    country: data.country ?? channels[index].country,
    language: data.language ?? channels[index].language,
    isActive: data.isActive ?? channels[index].isActive,
  };
  const validationError = validateChannelInput(merged);
  if (validationError) return { ok: false, error: validationError };
  const updated: Channel = {
    ...channels[index],
    name: normalizeChannelName(merged.name),
    description: merged.description || '',
    logoUrl: merged.logoUrl || '',
    streamUrl: merged.streamUrl || '',
    country: merged.country || '',
    language: merged.language || 'English',
    isActive: merged.isActive !== false,
    updatedAt: Date.now(),
  };
  const next = [...channels];
  next[index] = normalizeChannel(updated);
  saveChannelsToStorage(next);
  void persistChannelToFirestore(updated);
  addAuditEntry('channel_update', `Updated channel ${updated.name}.`);
  return { ok: true, channel: updated };
}

export function adminDeleteChannel(id: string): { ok: boolean; error?: string } {
  if (!requireAdminSession()) {
    return { ok: false, error: 'Admin session expired. Sign in again.' };
  }
  const channels = loadChannelsFromStorage();
  const target = channels.find((c) => c.id === id);
  if (!target) return { ok: false, error: 'Channel not found.' };
  saveChannelsToStorage(channels.filter((c) => c.id !== id));
  void deleteFirestoreChannel(id);
  addAuditEntry('channel_delete', `Deleted channel ${target.name}.`);
  return { ok: true };
}

// ---------- Maintenance ----------

export function purgeExpiredMatches(): number {
  const matches = loadMatchesFromStorage();
  const expired = matches.filter((m) => isMatchExpired(m));
  if (expired.length === 0) return 0;
  const expiredSlugs = new Set(getExpiredSlugs());
  expired.forEach((m) => expiredSlugs.add(m.id));
  writeJson(KEYS.EXPIRED_SLUGS, [...expiredSlugs]);
  const remaining = matches.filter((m) => !isMatchExpired(m));
  saveMatchesToStorage(remaining);
  void deleteFirestoreMatches(expired.map((m) => m.id));
  return expired.length;
}

/** Remove any leftover local admin records from the old localStorage-only setup. */
export function clearLegacyAdminKeys(): void {
  removeKey(KEYS.ADMIN_AUTH);
  removeKey(KEYS.ADMIN_LOCKOUT);
}

export function adminStorageNotice(): string {
  return 'Admin data is stored in Firebase Firestore (server-side). Clearing browser data does not remove the admin account.';
}

export function isUsingLocalStorage(): boolean {
  return false;
}

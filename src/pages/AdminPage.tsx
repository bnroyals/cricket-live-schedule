import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  Shield,
  Trash2,
  Tv,
  Calendar,
  FileText,
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react';
import type {
  AdminSession,
  AuditLogEntry,
  Channel,
  CricketMatch,
  MatchStatus,
} from '../types/cricket';
import {
  adminBackfillMatchCountryCodes,
  adminChangePassword,
  adminCreateChannel,
  adminCreateMatch,
  adminDeleteChannel,
  adminDeleteMatch,
  adminGetAuditLog,
  adminUpdateChannel,
  adminUpdateMatch,
  ensureSeedData,
  fetchAdminConfigured,
  fetchAuditLog,
  fetchLockoutState,
  getActiveAdminSession,
  getLockoutState,
  INACTIVITY_TIMEOUT_MS,
  loginAdmin,
  logoutAdmin,
  logoutAllAdminSessions,
  refreshPublicDataFromFirestore,
  touchAdminSession,
  waitForFirebaseAuthReady,
} from '../lib/storage';
import { COUNTRIES } from '../lib/countries';
import { generateCleanSlug, validateStrongPassword } from '../lib/security';
import {
  formatAuditTimestamp,
  formatDisplayDate,
  formatIstTime,
  formatMmSs,
  getEffectiveMatchStatus,
  getIstDateString,
} from '../lib/time';
import { useNavigate } from '../lib/router';
import { RichTextEditor } from '../components/RichTextEditor';
import {
  getChannelDisplayName,
  getChannelHtml,
  parseChannelNameFromHtml,
} from '../lib/channelHtml';

interface AdminPageProps {
  matches: CricketMatch[];
  channels: Channel[];
  onRefreshData: () => void;
}

type AdminTab = 'matches' | 'channels' | 'audit' | 'security';

function createEmptyMatchForm() {
  return {
    teamA: '',
    teamB: '',
    countryCodeA: '',
    countryCodeB: '',
    tournament: '',
    matchNumber: '',
    venue: '',
    date: getIstDateString(),
    startTime: '15:30',
    endTime: '19:30',
    status: 'Upcoming' as MatchStatus,
    channelIds: [] as string[],
    pageContent: '',
  };
}

const EMPTY_CHANNEL_FORM = {
  html: '',
};

export function AdminPage({ matches, channels, onRefreshData }: AdminPageProps) {
  const navigate = useNavigate();

  // Wait for Firebase Auth to restore and sync Firestore session config & lockout state on load.
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Login Form States
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Dashboard UI State
  const [activeTab, setActiveTab] = useState<AdminTab>('matches');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Match CRUD State
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [matchForm, setMatchForm] = useState(() => createEmptyMatchForm());
  const [confirmDeleteMatchId, setConfirmDeleteMatchId] = useState<string | null>(null);
  const [matchSubmitting, setMatchSubmitting] = useState(false);
  const [backfillingCodes, setBackfillingCodes] = useState(false);

  // Channel CRUD State
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState(EMPTY_CHANNEL_FORM);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<string | null>(null);
  const [channelSubmitting, setChannelSubmitting] = useState(false);

  // Change Password State
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // Audit Log State
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);

  const loadAuditLog = useCallback(async (activeSession: AdminSession | null) => {
    if (!activeSession) {
      setAuditEntries([]);
      return;
    }
    try {
      // Show cached entries immediately while pulling full history from Firestore
      setAuditEntries(adminGetAuditLog(activeSession));
      const remoteEntries = await fetchAuditLog(activeSession);
      setAuditEntries(remoteEntries);
    } catch {
      setAuditEntries([]);
    }
  }, []);

  // On mount: sync Firestore session metadata and server-side lockout state,
  // and wait for Firebase Auth to restore before checking for an active session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          fetchAdminConfigured(),
          waitForFirebaseAuthReady(),
          fetchLockoutState(),
        ]);
        if (cancelled) return;
        const restored = getActiveAdminSession(Date.now());
        setSession(restored);
        if (restored) {
          void ensureSeedData();
        }
        setNowMs(Date.now());
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 1-second clock for lockout countdown & 15-minute inactivity enforcement
  useEffect(() => {
    if (authChecking) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);

      if (session) {
        const active = getActiveAdminSession(current);
        if (!active) {
          setSession(null);
          setAuditEntries([]);
          setAuthNotice('Signed out automatically after 15 minutes of inactivity or session revocation.');
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [authChecking, session]);

  // Cross-tab sessionEpoch invalidation ("Log out all sessions")
  useEffect(() => {
    if (authChecking) return;
    const handleStorage = () => {
      void fetchAdminConfigured().then(() => {
        const active = getActiveAdminSession();
        if (!active && session) {
          setSession(null);
          setAuditEntries([]);
          setAuthNotice('Session ended because all sessions were logged out.');
        }
      });
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [authChecking, session]);

  // Track user activity to extend 15-minute inactivity window while logged in
  useEffect(() => {
    if (!session) return;
    let lastTouch = Date.now();

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastTouch < 5000) return;
      lastTouch = now;
      const refreshed = touchAdminSession(now);
      if (refreshed) {
        setSession(refreshed);
      } else {
        setSession(null);
        setAuditEntries([]);
        setAuthNotice('Signed out automatically due to inactivity.');
      }
    };

    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));
    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleActivity));
    };
  }, [session]);

  // Refresh audit log from Firestore whenever authenticated session or data changes
  useEffect(() => {
    void loadAuditLog(session);
  }, [session, matches, channels, activeTab, loadAuditLog]);

  const lockout = getLockoutState(nowMs);
  const newPwStrength = useMemo(() => validateStrongPassword(newPw), [newPw]);

  const slugPreview = useMemo(() => {
    if (!matchForm.teamA.trim() && !matchForm.teamB.trim()) return 'team-a-vs-team-b';
    const otherSlugs = matches
      .filter((m) => m.id !== editingMatchId)
      .map((m) => m.slug);
    return generateCleanSlug(matchForm.teamA, matchForm.teamB, otherSlugs);
  }, [matchForm.teamA, matchForm.teamB, matches, editingMatchId]);

  const remainingSessionMs = session
    ? Math.max(0, INACTIVITY_TIMEOUT_MS - (nowMs - session.lastActivityAt))
    : 0;

  // ============================================================================
  // AUTH HANDLERS
  // ============================================================================

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setAuthSubmitting(true);
    try {
      const res = await loginAdmin(emailInput, passwordInput);
      if (!res.ok) {
        setAuthError(res.error);
        setPasswordInput('');
        await fetchLockoutState();
        setNowMs(Date.now());
        return;
      }
      setSession(res.session);
      setEmailInput('');
      setPasswordInput('');
      setFeedback(null);
      void refreshPublicDataFromFirestore();
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    logoutAdmin(session);
    setSession(null);
    setAuditEntries([]);
    setFeedback(null);
    setAuthNotice('You have been logged out.');
  };

  const handleLogoutAll = () => {
    try {
      logoutAllAdminSessions(session);
      setSession(null);
      setAuditEntries([]);
      setFeedback(null);
      setAuthNotice('All active admin sessions have been signed out.');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to revoke sessions.',
      });
    }
  };

  // ============================================================================
  // MATCH CRUD HANDLERS
  // ============================================================================

  const handleMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setMatchSubmitting(true);
    try {
      const res = editingMatchId
        ? await adminUpdateMatch(session, editingMatchId, matchForm)
        : await adminCreateMatch(session, matchForm);

      if (!res.ok || !res.match) {
        setFeedback({ type: 'error', text: res.error || 'Unable to save match.' });
        return;
      }

      setFeedback({
        type: 'success',
        text: editingMatchId
          ? `Match updated: ${res.match.teamA} vs ${res.match.teamB}`
          : `Match scheduled! Live page ready at /match/${res.match.slug}`,
      });
      setEditingMatchId(null);
      setMatchForm(createEmptyMatchForm());
      onRefreshData();
      void loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save match.',
      });
    } finally {
      setMatchSubmitting(false);
    }
  };

  const startEditMatch = (match: CricketMatch) => {
    setEditingMatchId(match.id);
    setMatchForm({
      teamA: match.teamA,
      teamB: match.teamB,
      countryCodeA: match.countryCodeA ?? '',
      countryCodeB: match.countryCodeB ?? '',
      tournament: match.tournament,
      matchNumber: match.matchNumber,
      venue: match.venue,
      date: match.date,
      startTime: match.startTime,
      endTime: match.endTime,
      status: match.status,
      channelIds: match.channelIds,
      pageContent: match.pageContent ?? '',
    });
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackfillCountryCodes = async () => {
    setFeedback(null);
    setBackfillingCodes(true);
    try {
      const res = await adminBackfillMatchCountryCodes(session);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error || 'Unable to backfill country codes.' });
        return;
      }
      setFeedback({
        type: 'success',
        text:
          res.updatedCount > 0
            ? `Updated country codes for ${res.updatedCount} ${res.updatedCount === 1 ? 'match' : 'matches'} (checked ${res.totalChecked}).`
            : `No matches needed country code updates (checked ${res.totalChecked}).`,
      });
      onRefreshData();
      void loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to backfill country codes.',
      });
    } finally {
      setBackfillingCodes(false);
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    setFeedback(null);
    try {
      const res = await adminDeleteMatch(session, matchId);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error || 'Unable to delete match.' });
        return;
      }
      if (editingMatchId === matchId) {
        setEditingMatchId(null);
        setMatchForm(createEmptyMatchForm());
      }
      setConfirmDeleteMatchId(null);
      setFeedback({ type: 'success', text: 'Match deleted.' });
      onRefreshData();
      void loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete match.',
      });
    }
  };

  const toggleMatchChannel = (channelId: string) => {
    setMatchForm((prev) => ({
      ...prev,
      channelIds: prev.channelIds.includes(channelId)
        ? prev.channelIds.filter((id) => id !== channelId)
        : [...prev.channelIds, channelId],
    }));
  };

  // ============================================================================
  // CHANNEL CRUD HANDLERS
  // ============================================================================

  const handleChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setChannelSubmitting(true);
    try {
      const res = editingChannelId
        ? await adminUpdateChannel(session, editingChannelId, channelForm)
        : await adminCreateChannel(session, channelForm);

      if (!res.ok || !res.channel) {
        setFeedback({ type: 'error', text: res.error || 'Unable to save channel.' });
        return;
      }

      setFeedback({
        type: 'success',
        text: editingChannelId
          ? `Channel updated: ${res.channel.name}`
          : `Channel added: ${res.channel.name}`,
      });
      setEditingChannelId(null);
      setChannelForm(EMPTY_CHANNEL_FORM);
      onRefreshData();
      void loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save channel.',
      });
    } finally {
      setChannelSubmitting(false);
    }
  };

  const startEditChannel = (ch: Channel) => {
    setEditingChannelId(ch.id);
    setChannelForm({
      html: getChannelHtml(ch),
    });
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteChannel = async (channelId: string) => {
    setFeedback(null);
    try {
      const res = await adminDeleteChannel(session, channelId);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error || 'Unable to delete channel.' });
        return;
      }
      if (editingChannelId === channelId) {
        setEditingChannelId(null);
        setChannelForm(EMPTY_CHANNEL_FORM);
      }
      setConfirmDeleteChannelId(null);
      setFeedback({ type: 'success', text: 'Channel deleted.' });
      onRefreshData();
      void loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete channel.',
      });
    }
  };

  // ============================================================================
  // PASSWORD CHANGE HANDLER
  // ============================================================================

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setPwSubmitting(true);
    try {
      const res = await adminChangePassword(session, currentPw, newPw, confirmNewPw);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error });
        return;
      }
      setSession(res.session);
      setCurrentPw('');
      setNewPw('');
      setConfirmNewPw('');
      setFeedback({
        type: 'success',
        text: 'Password updated in Firebase Auth. Previous sessions invalidated.',
      });
      void loadAuditLog(res.session);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to change password.',
      });
    } finally {
      setPwSubmitting(false);
    }
  };

  // ============================================================================
  // INITIAL LOADING STATE: WAITING FOR FIRESTORE & FIREBASE AUTH
  // ============================================================================

  if (authChecking) {
    return (
      <div className="min-h-dvh bg-[#F5F7F9] text-slate-900 flex flex-col justify-between px-4 py-10">
        <div className="max-w-md w-full mx-auto my-auto">
          <div className="mb-6 flex items-center justify-between">
            <span className="font-display text-2xl font-extrabold tracking-wide text-emerald-800">
              Cricket Live Admin
            </span>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 min-h-[40px] px-2 transition-colors"
            >
              Public Schedule
            </button>
          </div>
          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-8 text-center">
            <Shield className="w-7 h-7 text-emerald-700 mx-auto" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-slate-900 mt-3">
              Checking Administrator Session
            </h1>
            <p className="text-xs text-slate-600 mt-1.5">
              Verifying administrator session and security status...
            </p>
          </section>
        </div>

        <footer className="max-w-md w-full mx-auto pt-8 text-center text-xs text-slate-500">
          Storage: <span className="text-slate-800 font-semibold">Firebase Firestore (server-side)</span> · Clearing browser data does not remove the admin account.
        </footer>
      </div>
    );
  }

  // ============================================================================
  // UNAUTHENTICATED VIEW: HARDENED SINGLE-ADMIN LOGIN ONLY
  // ============================================================================

  if (!session) {
    return (
      <div className="min-h-dvh bg-[#F5F7F9] text-slate-900 flex flex-col justify-between px-4 py-10">
        <div className="max-w-md w-full mx-auto my-auto">
          <div className="mb-6 flex items-center justify-between">
            <span className="font-display text-2xl font-extrabold tracking-wide text-emerald-800">
              Cricket Live Admin
            </span>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 min-h-[40px] px-2 transition-colors"
            >
              Public Schedule
            </button>
          </div>

          <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900 leading-tight">
                  Admin Sign In
                </h1>
                <p className="text-xs text-slate-600 mt-0.5">
                  Protected by Firebase Auth (server-side password hashing) & brute-force lockout
                </p>
              </div>
            </div>

            {authNotice && (
              <div
                role="status"
                className="mt-5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs font-medium text-amber-900"
              >
                {authNotice}
              </div>
            )}

            {lockout.isLocked ? (
              <div
                role="alert"
                className="mt-6 rounded-xl bg-red-50 border border-red-200 p-5 text-center"
              >
                <AlertTriangle className="w-7 h-7 text-red-600 mx-auto" aria-hidden="true" />
                <h2 className="text-base font-bold text-red-800 mt-2">
                  Admin Login Temporarily Locked
                </h2>
                <p className="text-xs text-red-700 mt-1">
                  Too many failed sign-in attempts. Try again when the timer ends.
                </p>
                <p className="font-mono-tabular text-3xl font-bold text-slate-900 mt-4">
                  {formatMmSs(lockout.remainingMs)}
                </p>
              </div>
            ) : (
              /* Hardened Single-Admin Login Form — ZERO password hints */
              <form onSubmit={handleLogin} className="mt-6 space-y-4" noValidate>
                <div>
                  <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Administrator Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-900"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {authError && (
                  <p role="alert" className="text-xs text-red-600 font-semibold">
                    {authError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-bold transition-colors"
                >
                  {authSubmitting ? 'Verifying...' : 'Sign In'}
                </button>
              </form>
            )}
          </section>
        </div>

        <footer className="max-w-md w-full mx-auto pt-8 text-center text-xs text-slate-500">
          Storage: <span className="text-slate-800 font-semibold">Firebase Firestore (server-side)</span> · Clearing browser data does not remove the admin account.
        </footer>
      </div>
    );
  }

  // ============================================================================
  // AUTHENTICATED ADMIN DASHBOARD (LIGHT MODE ONLY, ENGLISH ONLY)
  // ============================================================================

  return (
    <div className="min-h-dvh bg-[#F5F7F9] text-slate-900 pb-16">
      {/* Top Light Admin Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 min-h-14 py-2 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl font-extrabold tracking-wide text-emerald-800 whitespace-nowrap">
              Cricket Live Admin
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="text-slate-600 hidden md:inline">
              {session.email}
              <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono-tabular font-semibold text-slate-800">
                Timeout {formatMmSs(remainingSessionMs)}
              </span>
            </span>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="min-h-[40px] px-3 py-2 rounded-lg text-slate-700 hover:text-slate-900 hover:bg-slate-100 font-semibold whitespace-nowrap transition-colors"
            >
              Public Site
            </button>

            <button
              type="button"
              onClick={handleLogoutAll}
              className="min-h-[40px] px-3 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold whitespace-nowrap transition-colors"
            >
              Log Out All Sessions
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold whitespace-nowrap transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Storage & Security Status Line — Shown ONLY inside Admin Panel */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-5 border-b border-slate-200 text-xs text-slate-600">
          <div>
            Storage: <span className="text-slate-900 font-bold">Firebase Firestore (server-side)</span>
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span>Clearing browser data does not remove the admin account</span>
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span>Public read-only / Admin authenticated write</span>
          </div>
          <div className="font-mono-tabular font-semibold text-slate-800 sm:hidden">
            {session.email} · Auto-logout in {formatMmSs(remainingSessionMs)}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Admin sections"
          className="mt-5 inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-slate-200 shadow-xs w-full sm:w-auto overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matches'}
            onClick={() => {
              setActiveTab('matches');
              setFeedback(null);
            }}
            className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'matches'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-4 h-4" aria-hidden="true" />
            <span>Matches ({matches.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'channels'}
            onClick={() => {
              setActiveTab('channels');
              setFeedback(null);
            }}
            className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'channels'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Tv className="w-4 h-4" aria-hidden="true" />
            <span>Channels ({channels.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audit'}
            onClick={() => {
              setActiveTab('audit');
              setFeedback(null);
            }}
            className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'audit'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>Audit Log ({auditEntries.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'security'}
            onClick={() => {
              setActiveTab('security');
              setFeedback(null);
            }}
            className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors ${
              activeTab === 'security'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            <span>Security</span>
          </button>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            role={feedback.type === 'error' ? 'alert' : 'status'}
            className={`mt-5 rounded-xl px-4 py-3 text-sm font-semibold border ${
              feedback.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* ================================================================ */}
        {/* MATCHES TAB */}
        {/* ================================================================ */}
        {activeTab === 'matches' && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  {editingMatchId ? 'Edit Match' : 'Schedule New Match'}
                </h2>
                {editingMatchId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMatchId(null);
                      setMatchForm(createEmptyMatchForm());
                    }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Auto-created URL:{' '}
                <span className="font-mono-tabular font-semibold text-emerald-700">
                  /match/{slugPreview}
                </span>
              </p>

              <form onSubmit={handleMatchSubmit} noValidate className="mt-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="match-team-a" className="block text-xs font-semibold text-slate-700 mb-1">
                      Team A *
                    </label>
                    <input
                      id="match-team-a"
                      type="text"
                      maxLength={60}
                      value={matchForm.teamA}
                      onChange={(e) => setMatchForm((f) => ({ ...f, teamA: e.target.value }))}
                      placeholder="e.g. India"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="match-team-b" className="block text-xs font-semibold text-slate-700 mb-1">
                      Team B *
                    </label>
                    <input
                      id="match-team-b"
                      type="text"
                      maxLength={60}
                      value={matchForm.teamB}
                      onChange={(e) => setMatchForm((f) => ({ ...f, teamB: e.target.value }))}
                      placeholder="e.g. Australia"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="match-country-a" className="block text-xs font-semibold text-slate-700 mb-1">
                      Team A Country
                    </label>
                    <select
                      id="match-country-a"
                      value={matchForm.countryCodeA}
                      onChange={(e) =>
                        setMatchForm((f) => ({ ...f, countryCodeA: e.target.value }))
                      }
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                    >
                      <option value="">No flag / none</option>
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="match-country-b" className="block text-xs font-semibold text-slate-700 mb-1">
                      Team B Country
                    </label>
                    <select
                      id="match-country-b"
                      value={matchForm.countryCodeB}
                      onChange={(e) =>
                        setMatchForm((f) => ({ ...f, countryCodeB: e.target.value }))
                      }
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                    >
                      <option value="">No flag / none</option>
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="match-tournament" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tournament *
                  </label>
                  <input
                    id="match-tournament"
                    type="text"
                    maxLength={120}
                    value={matchForm.tournament}
                    onChange={(e) => setMatchForm((f) => ({ ...f, tournament: e.target.value }))}
                    placeholder="e.g. ACC Men's Asia Cup 2026"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="match-label" className="block text-xs font-semibold text-slate-700 mb-1">
                      Match Label *
                    </label>
                    <input
                      id="match-label"
                      type="text"
                      maxLength={40}
                      value={matchForm.matchNumber}
                      onChange={(e) => setMatchForm((f) => ({ ...f, matchNumber: e.target.value }))}
                      placeholder="e.g. Match 9"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="match-status" className="block text-xs font-semibold text-slate-700 mb-1">
                      Status *
                    </label>
                    <select
                      id="match-status"
                      value={matchForm.status}
                      onChange={(e) =>
                        setMatchForm((f) => ({ ...f, status: e.target.value as MatchStatus }))
                      }
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                    >
                      <option value="Upcoming">Upcoming</option>
                      <option value="LIVE">LIVE</option>
                      <option value="Finished">Finished</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="match-venue" className="block text-xs font-semibold text-slate-700 mb-1">
                    Venue *
                  </label>
                  <input
                    id="match-venue"
                    type="text"
                    maxLength={140}
                    value={matchForm.venue}
                    onChange={(e) => setMatchForm((f) => ({ ...f, venue: e.target.value }))}
                    placeholder="e.g. Wankhede Stadium, Mumbai"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="match-date" className="block text-xs font-semibold text-slate-700 mb-1">
                      Date (IST) *
                    </label>
                    <input
                      id="match-date"
                      type="date"
                      value={matchForm.date}
                      onChange={(e) => setMatchForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm font-mono-tabular text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="match-start" className="block text-xs font-semibold text-slate-700 mb-1">
                      Start (IST) *
                    </label>
                    <input
                      id="match-start"
                      type="time"
                      step={60}
                      value={matchForm.startTime}
                      onChange={(e) => setMatchForm((f) => ({ ...f, startTime: e.target.value }))}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm font-mono-tabular text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="match-end" className="block text-xs font-semibold text-slate-700 mb-1">
                      End (IST) *
                    </label>
                    <input
                      id="match-end"
                      type="time"
                      step={60}
                      value={matchForm.endTime}
                      onChange={(e) => setMatchForm((f) => ({ ...f, endTime: e.target.value }))}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm font-mono-tabular text-slate-900 focus:border-emerald-600 focus:outline-none"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  Auto-delete: Match page &amp; schedule entry are automatically removed 30 minutes after the end time.
                </p>

                {/* Assign Channels */}
                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-2">Broadcast Channels</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {channels.map((ch) => {
                      const checked = matchForm.channelIds.includes(ch.id);
                      return (
                        <label
                          key={ch.id}
                          className={`flex items-center gap-2.5 px-3 py-2 min-h-[40px] rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                            checked
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMatchChannel(ch.id)}
                            className="accent-emerald-700"
                          />
                          <span className="truncate">{getChannelDisplayName(ch)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Match Page Content — Blogger-style WYSIWYG Editor */}
                <RichTextEditor
                  id="match-page-content"
                  label="Page Content"
                  value={matchForm.pageContent}
                  onChange={(html) => setMatchForm((f) => ({ ...f, pageContent: html }))}
                  placeholder="Write match preview, pitch report, playing XI, links, or images..."
                />

                <button
                  type="submit"
                  disabled={matchSubmitting}
                  className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {matchSubmitting
                      ? 'Saving...'
                      : editingMatchId
                        ? 'Save Match Changes'
                        : 'Schedule Match'}
                  </span>
                </button>
              </form>
            </section>

            {/* Full Match List */}
            <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <h2 className="font-display text-2xl font-bold text-slate-900">
                    Scheduled Matches
                  </h2>
                  <span className="text-xs font-semibold text-slate-500 font-mono-tabular">
                    {matches.length} active
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleBackfillCountryCodes}
                  disabled={backfillingCodes}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-60 border border-slate-200 text-xs font-semibold text-slate-800 transition-colors"
                >
                  {backfillingCodes ? 'Backfilling...' : 'Backfill country codes for existing matches'}
                </button>
              </div>

              {matches.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-600">
                  No active matches scheduled. Use the form to create a new match.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 mt-2">
                  {matches.map((m) => {
                    const effective = getEffectiveMatchStatus(m, nowMs);
                    const confirming = confirmDeleteMatchId === m.id;
                    return (
                      <div key={m.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className={`font-bold ${
                                effective === 'LIVE'
                                  ? 'text-red-600'
                                  : effective === 'Finished'
                                    ? 'text-slate-500'
                                    : 'text-emerald-700'
                              }`}
                            >
                              {effective}
                            </span>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="text-slate-600 font-medium truncate">{m.tournament}</span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 mt-1">
                            {m.teamA} vs {m.teamB}
                          </h3>
                          <p className="text-xs text-slate-600 mt-1 font-mono-tabular">
                            {formatDisplayDate(m.date)} · {formatIstTime(m.startTime)} – {formatIstTime(m.endTime)}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{m.venue}</p>
                          <button
                            type="button"
                            onClick={() => navigate(`/match/${m.slug}`)}
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline font-mono-tabular"
                          >
                            <span>/match/{m.slug}</span>
                            <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditMatch(m)}
                            className="min-h-[40px] px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>

                          {confirming ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDeleteMatch(m.id)}
                                className="min-h-[40px] px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteMatchId(null)}
                                className="min-h-[40px] px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteMatchId(m.id)}
                              className="min-h-[40px] px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================================================================ */}
        {/* CHANNELS TAB */}
        {/* ================================================================ */}
        {activeTab === 'channels' && (() => {
          const detectedChannelName = parseChannelNameFromHtml(channelForm.html);
          const channelHtmlLines = channelForm.html ? channelForm.html.split('\n').length : 1;

          return (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-2xl font-bold text-slate-900">
                    {editingChannelId ? 'Edit Channel HTML' : 'Add Channel HTML'}
                  </h2>
                  {editingChannelId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingChannelId(null);
                        setChannelForm(EMPTY_CHANNEL_FORM);
                      }}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <form onSubmit={handleChannelSubmit} noValidate className="mt-4 space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label
                        htmlFor="channel-raw-html"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                      >
                        <Code2 className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                        <span>Channel HTML Code *</span>
                      </label>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-tabular">
                        <span
                          className={
                            detectedChannelName
                              ? 'text-emerald-700 font-semibold font-sans'
                              : 'text-amber-700 font-medium font-sans'
                          }
                        >
                          {detectedChannelName
                            ? `Name: ${detectedChannelName}`
                            : 'No name detected yet'}
                        </span>
                        <span className="text-slate-500">
                          {channelHtmlLines} {channelHtmlLines === 1 ? 'line' : 'lines'} · {channelForm.html.length} chars
                        </span>
                      </div>
                    </div>

                    <textarea
                      id="channel-raw-html"
                      value={channelForm.html}
                      onChange={(e) => setChannelForm({ html: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          const target = e.currentTarget;
                          const start = target.selectionStart;
                          const end = target.selectionEnd;
                          const nextValue = `${channelForm.html.slice(0, start)}  ${channelForm.html.slice(end)}`;
                          setChannelForm({ html: nextValue });
                          window.requestAnimationFrame(() => {
                            target.selectionStart = start + 2;
                            target.selectionEnd = start + 2;
                          });
                        }
                      }}
                      placeholder={`<div data-channel-name="Willow Cricket">\n  <h1>Willow Cricket</h1>\n  <div style="position:relative;width:100%;aspect-ratio:16/9;background:#020617;border-radius:12px;overflow:hidden;">\n    <iframe src="https://example.com/embed" style="width:100%;height:100%;border:0;margin:0;border-radius:0;" allow="autoplay *; fullscreen *; encrypted-media *; picture-in-picture *" allowfullscreen referrerpolicy="no-referrer"></iframe>\n  </div>\n</div>`}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      rows={18}
                      className="block w-full min-h-[420px] p-4 rounded-xl bg-white border border-slate-300 text-slate-900 font-mono-tabular text-xs sm:text-sm leading-relaxed focus:border-emerald-600 focus:outline-none resize-y placeholder:text-slate-400"
                    />

                    {/* Convention note for setting the channel name in HTML */}
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      Set the channel name shown on match page Watch buttons using{' '}
                      <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-900 font-mono-tabular text-[11px]">
                        data-channel-name=&quot;Channel Name&quot;
                      </code>{' '}
                      (for example{' '}
                      <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-900 font-mono-tabular text-[11px]">
                        &lt;div data-channel-name=&quot;Willow Cricket&quot;&gt;
                      </code>
                      ), or an{' '}
                      <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-900 font-mono-tabular text-[11px]">
                        &lt;h1&gt;
                      </code>{' '}
                      heading as fallback. Everything on the channel page renders directly from this HTML.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={channelSubmitting}
                    className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {channelSubmitting
                        ? 'Saving...'
                        : editingChannelId
                          ? 'Save Channel HTML'
                          : 'Add Channel'}
                    </span>
                  </button>
                </form>
              </section>

              <section className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                  <h2 className="font-display text-2xl font-bold text-slate-900">
                    Permanent Channels
                  </h2>
                  <span className="text-xs font-semibold text-slate-500 font-mono-tabular">
                    {channels.length} total
                  </span>
                </div>

                <div className="divide-y divide-slate-200 mt-2">
                  {channels.map((ch) => {
                    const confirming = confirmDeleteChannelId === ch.id;
                    const displayName = getChannelDisplayName(ch);
                    return (
                      <div key={ch.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-slate-900 truncate">{displayName}</h3>
                          <p className="text-xs text-slate-500 mt-0.5 font-mono-tabular truncate">
                            ID: {ch.id}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEditChannel(ch)}
                            className="min-h-[40px] px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>

                          {confirming ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleDeleteChannel(ch.id)}
                                className="min-h-[40px] px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-bold text-white transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteChannelId(null)}
                                className="min-h-[40px] px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteChannelId(ch.id)}
                              className="min-h-[40px] px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          );
        })()}

        {/* ================================================================ */}
        {/* AUDIT LOG TAB (Admin-only visibility, synced with Firestore) */}
        {/* ================================================================ */}
        {activeTab === 'audit' && (
          <section className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Admin Audit Log
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Records every authenticated admin action in Firebase Firestore. Visible strictly inside the Admin Panel.
                </p>
              </div>
              <span className="text-xs font-semibold font-mono-tabular text-slate-500">
                {auditEntries.length} events
              </span>
            </div>

            {auditEntries.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-600">No audit entries yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 text-xs">
                      <th className="py-3 pr-4 font-semibold">Date / Time (IST)</th>
                      <th className="py-3 pr-4 font-semibold">Action</th>
                      <th className="py-3 pr-4 font-semibold">Match / Channel</th>
                      <th className="py-3 font-semibold">Admin Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditEntries.map((entry) => (
                      <tr key={entry.id} className="align-top">
                        <td className="py-3 pr-4 font-mono-tabular text-xs text-slate-600 whitespace-nowrap">
                          {formatAuditTimestamp(entry.timestamp)}
                        </td>
                        <td className="py-3 pr-4 font-bold text-slate-900 whitespace-nowrap">
                          {entry.action.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 pr-4 text-slate-800">
                          <div className="font-medium">{entry.targetName}</div>
                          {entry.details && (
                            <div className="text-xs text-slate-500 mt-0.5">{entry.details}</div>
                          )}
                        </td>
                        <td className="py-3 text-slate-600 whitespace-nowrap">
                          {entry.adminEmail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ================================================================ */}
        {/* SECURITY TAB: Change Password & Session Controls */}
        {/* ================================================================ */}
        {activeTab === 'security' && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Change Password
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Changing your password updates Firebase Auth (server-side password hashing) and invalidates all other sessions.
              </p>

              <form onSubmit={handlePasswordChange} noValidate className="mt-5 space-y-4">
                <div>
                  <label htmlFor="sec-cur-pw" className="block text-xs font-semibold text-slate-700 mb-1">
                    Current Password
                  </label>
                  <input
                    id="sec-cur-pw"
                    type="password"
                    autoComplete="current-password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="sec-new-pw" className="block text-xs font-semibold text-slate-700 mb-1">
                    New Strong Password
                  </label>
                  <input
                    id="sec-new-pw"
                    type="password"
                    autoComplete="new-password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                  <ul className="mt-2 grid grid-cols-2 gap-1.5 text-xs font-medium">
                    <li className={newPwStrength.minLength ? 'text-emerald-700' : 'text-slate-500'}>
                      {newPwStrength.minLength ? '✓' : '·'} 12+ characters
                    </li>
                    <li className={newPwStrength.hasLetter ? 'text-emerald-700' : 'text-slate-500'}>
                      {newPwStrength.hasLetter ? '✓' : '·'} Letters (A-Z)
                    </li>
                    <li className={newPwStrength.hasNumber ? 'text-emerald-700' : 'text-slate-500'}>
                      {newPwStrength.hasNumber ? '✓' : '·'} Numbers (0-9)
                    </li>
                    <li className={newPwStrength.hasSymbol ? 'text-emerald-700' : 'text-slate-500'}>
                      {newPwStrength.hasSymbol ? '✓' : '·'} Symbols (!@#$%)
                    </li>
                  </ul>
                </div>

                <div>
                  <label htmlFor="sec-confirm-pw" className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    id="sec-confirm-pw"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPw}
                    onChange={(e) => setConfirmNewPw(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={pwSubmitting}
                  className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>{pwSubmitting ? 'Updating...' : 'Update Password'}</span>
                </button>
              </form>
            </section>

            <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Session &amp; Access Controls
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Authorized administrator: <span className="text-slate-900 font-semibold">{session.email}</span>
                </p>
              </div>

              <dl className="space-y-3 text-sm border-y border-slate-200 py-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">Inactivity Auto-Logout</dt>
                  <dd className="font-mono-tabular font-bold text-slate-900">
                    {formatMmSs(remainingSessionMs)} remaining
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">Password Storage</dt>
                  <dd className="text-emerald-700 font-semibold">Firebase Auth (server-side password hashing)</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">Admin Account Persistence</dt>
                  <dd className="text-slate-900 font-medium">Firebase Firestore (server-side)</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">Brute-Force Lockout</dt>
                  <dd className="text-slate-900 font-medium">5 attempts → 15 min lock</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">Admin Account Policy</dt>
                  <dd className="text-slate-900 font-medium">Single authorized account only</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-600">Public Access Policy</dt>
                  <dd className="text-slate-900 font-medium">Read-only (no public writes)</dd>
                </div>
              </dl>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-bold text-slate-900 transition-colors"
                >
                  Log Out Current Session
                </button>
                <button
                  type="button"
                  onClick={handleLogoutAll}
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-sm font-bold text-red-700 transition-colors"
                >
                  Log Out All Sessions
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

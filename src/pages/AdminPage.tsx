import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
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
  ExternalLink,
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
  adminChangePassword,
  adminCreateChannel,
  adminCreateMatch,
  adminDeleteChannel,
  adminDeleteMatch,
  adminGetAuditLog,
  adminUpdateChannel,
  adminUpdateMatch,
  getActiveAdminSession,
  getLockoutState,
  INACTIVITY_TIMEOUT_MS,
  isAdminConfigured,
  loginAdmin,
  logoutAdmin,
  logoutAllAdminSessions,
  setupFirstAdmin,
  touchAdminSession,
} from '../lib/storage';
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
    tournament: '',
    matchNumber: '',
    venue: '',
    date: getIstDateString(),
    startTime: '15:30',
    endTime: '19:30',
    status: 'Upcoming' as MatchStatus,
    channelIds: [] as string[],
  };
}

const EMPTY_CHANNEL_FORM = {
  name: '',
  language: 'English',
  streamUrl: '',
};

export function AdminPage({ matches, channels, onRefreshData }: AdminPageProps) {
  const navigate = useNavigate();

  const [configured, setConfigured] = useState<boolean>(() => isAdminConfigured());
  const [session, setSession] = useState<AdminSession | null>(() => getActiveAdminSession());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Setup / Login Form States
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
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

  // Channel CRUD State
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState(EMPTY_CHANNEL_FORM);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<string | null>(null);

  // Change Password State
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);

  // Audit Log State
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);

  const loadAuditLog = useCallback((activeSession: AdminSession | null) => {
    if (!activeSession) {
      setAuditEntries([]);
      return;
    }
    try {
      setAuditEntries(adminGetAuditLog(activeSession));
    } catch {
      setAuditEntries([]);
    }
  }, []);

  // 1-second clock for lockout countdown & 15-minute inactivity enforcement
  useEffect(() => {
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
  }, [session]);

  // Cross-tab sessionEpoch invalidation ("Log out all sessions")
  useEffect(() => {
    const handleStorage = () => {
      setConfigured(isAdminConfigured());
      const active = getActiveAdminSession();
      if (!active && session) {
        setSession(null);
        setAuditEntries([]);
        setAuthNotice('Session ended because all sessions were logged out.');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [session]);

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

  useEffect(() => {
    loadAuditLog(session);
  }, [session, matches, channels, activeTab, loadAuditLog]);

  const lockout = getLockoutState(nowMs);
  const setupStrength = useMemo(() => validateStrongPassword(passwordInput), [passwordInput]);
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

  const handleFirstTimeSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setAuthSubmitting(true);
    try {
      const res = await setupFirstAdmin(emailInput, passwordInput, confirmPasswordInput);
      if (!res.ok) {
        setAuthError(res.error);
        return;
      }
      setConfigured(true);
      setSession(res.session);
      setEmailInput('');
      setPasswordInput('');
      setConfirmPasswordInput('');
      setFeedback({ type: 'success', text: 'Admin account created and signed in.' });
    } finally {
      setAuthSubmitting(false);
    }
  };

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
        setNowMs(Date.now());
        return;
      }
      setSession(res.session);
      setEmailInput('');
      setPasswordInput('');
      setFeedback(null);
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

  const handleMatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = editingMatchId
        ? adminUpdateMatch(session, editingMatchId, matchForm)
        : adminCreateMatch(session, matchForm);

      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error });
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
      loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save match.',
      });
    }
  };

  const startEditMatch = (match: CricketMatch) => {
    setEditingMatchId(match.id);
    setMatchForm({
      teamA: match.teamA,
      teamB: match.teamB,
      tournament: match.tournament,
      matchNumber: match.matchNumber,
      venue: match.venue,
      date: match.date,
      startTime: match.startTime,
      endTime: match.endTime,
      status: match.status,
      channelIds: match.channelIds,
    });
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteMatch = (matchId: string) => {
    setFeedback(null);
    try {
      const res = adminDeleteMatch(session, matchId);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error });
        return;
      }
      if (editingMatchId === matchId) {
        setEditingMatchId(null);
        setMatchForm(createEmptyMatchForm());
      }
      setConfirmDeleteMatchId(null);
      setFeedback({ type: 'success', text: 'Match deleted.' });
      onRefreshData();
      loadAuditLog(getActiveAdminSession());
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

  const handleChannelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = editingChannelId
        ? adminUpdateChannel(session, editingChannelId, channelForm)
        : adminCreateChannel(session, channelForm);

      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error });
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
      loadAuditLog(getActiveAdminSession());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save channel.',
      });
    }
  };

  const startEditChannel = (ch: Channel) => {
    setEditingChannelId(ch.id);
    setChannelForm({
      name: ch.name,
      language: ch.language.trim().toLowerCase() === 'hindi' ? 'English' : ch.language,
      streamUrl: ch.streamUrl,
    });
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteChannel = (channelId: string) => {
    setFeedback(null);
    try {
      const res = adminDeleteChannel(session, channelId);
      if (!res.ok) {
        setFeedback({ type: 'error', text: res.error });
        return;
      }
      if (editingChannelId === channelId) {
        setEditingChannelId(null);
        setChannelForm(EMPTY_CHANNEL_FORM);
      }
      setConfirmDeleteChannelId(null);
      setFeedback({ type: 'success', text: 'Channel deleted.' });
      onRefreshData();
      loadAuditLog(getActiveAdminSession());
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
        text: 'Password updated with SHA-256 hash. Previous sessions invalidated.',
      });
      loadAuditLog(res.session);
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
  // UNAUTHENTICATED VIEW: SINGLE-ADMIN SETUP OR HARDENED LOGIN
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
                {configured ? <Lock className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-slate-900 leading-tight">
                  {configured ? 'Admin Sign In' : 'First-Time Admin Setup'}
                </h1>
                <p className="text-xs text-slate-600 mt-0.5">
                  {configured
                    ? 'Protected by SHA-256 hashing & brute-force lockout'
                    : 'Set up the authorized single administrator password'}
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

            {configured && lockout.isLocked ? (
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
            ) : !configured ? (
              <form onSubmit={handleFirstTimeSetup} className="mt-6 space-y-4" noValidate>
                <div>
                  <label htmlFor="setup-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Administrator Email
                  </label>
                  <input
                    id="setup-email"
                    type="email"
                    autoComplete="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="Enter authorized administrator email"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="setup-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Strong Password
                  </label>
                  <div className="relative">
                    <input
                      id="setup-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Min 12 chars with letters, numbers & symbols"
                      className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
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

                  {/* Clean unboxed requirement checklist */}
                  <ul className="mt-2.5 grid grid-cols-2 gap-1.5 text-xs font-medium">
                    <li className={setupStrength.minLength ? 'text-emerald-700' : 'text-slate-500'}>
                      {setupStrength.minLength ? '✓' : '·'} 12+ characters
                    </li>
                    <li className={setupStrength.hasLetter ? 'text-emerald-700' : 'text-slate-500'}>
                      {setupStrength.hasLetter ? '✓' : '·'} Letters (A-Z)
                    </li>
                    <li className={setupStrength.hasNumber ? 'text-emerald-700' : 'text-slate-500'}>
                      {setupStrength.hasNumber ? '✓' : '·'} Numbers (0-9)
                    </li>
                    <li className={setupStrength.hasSymbol ? 'text-emerald-700' : 'text-slate-500'}>
                      {setupStrength.hasSymbol ? '✓' : '·'} Symbols (!@#$%)
                    </li>
                  </ul>
                </div>

                <div>
                  <label htmlFor="setup-confirm" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Confirm Password
                  </label>
                  <input
                    id="setup-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPasswordInput}
                    onChange={(e) => setConfirmPasswordInput(e.target.value)}
                    placeholder="Re-enter strong password"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
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
                  {authSubmitting ? 'Securing Account...' : 'Create Admin Account'}
                </button>
              </form>
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
          Storage: <span className="text-slate-800 font-semibold">localStorage</span> (Firebase Firestore unavailable)
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
            Storage: <span className="text-slate-900 font-bold">localStorage</span> (Firebase Firestore unavailable)
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span>Public read-only · Single-admin authenticated write</span>
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
                      Match Label
                    </label>
                    <input
                      id="match-label"
                      type="text"
                      maxLength={40}
                      value={matchForm.matchNumber}
                      onChange={(e) => setMatchForm((f) => ({ ...f, matchNumber: e.target.value }))}
                      placeholder="e.g. Match 9 (optional)"
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
                          <span className="truncate">{ch.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>{editingMatchId ? 'Save Match Changes' : 'Schedule Match'}</span>
                </button>
              </form>
            </section>

            {/* Full Match List */}
            <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Scheduled Matches
                </h2>
                <span className="text-xs font-semibold text-slate-500 font-mono-tabular">
                  {matches.length} active
                </span>
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
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
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
        {activeTab === 'channels' && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  {editingChannelId ? 'Edit Channel' : 'Add Channel'}
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
              <p className="text-xs text-slate-600 mt-1">
                Channels on <span className="font-mono-tabular font-semibold text-slate-900">/channels</span> are permanent and never auto-delete.
              </p>

              <form onSubmit={handleChannelSubmit} noValidate className="mt-5 space-y-4">
                <div>
                  <label htmlFor="ch-name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Channel Name *
                  </label>
                  <input
                    id="ch-name"
                    type="text"
                    maxLength={80}
                    value={channelForm.name}
                    onChange={(e) => setChannelForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Sony Sports Ten 3"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="ch-lang" className="block text-xs font-semibold text-slate-700 mb-1">
                    Language *
                  </label>
                  <input
                    id="ch-lang"
                    type="text"
                    maxLength={40}
                    value={channelForm.language}
                    onChange={(e) => setChannelForm((f) => ({ ...f, language: e.target.value }))}
                    placeholder="e.g. English"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="ch-url" className="block text-xs font-semibold text-slate-700 mb-1">
                    Live Stream URL (https:// or leave blank)
                  </label>
                  <input
                    id="ch-url"
                    type="url"
                    maxLength={500}
                    value={channelForm.streamUrl}
                    onChange={(e) => setChannelForm((f) => ({ ...f, streamUrl: e.target.value }))}
                    placeholder="https://example.com/live-stream"
                    className="w-full min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>{editingChannelId ? 'Save Channel Changes' : 'Add Channel'}</span>
                </button>
              </form>
            </section>

            <section className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
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
                  const displayLang =
                    ch.language.trim().toLowerCase() === 'hindi' ? 'English' : ch.language;
                  return (
                    <div key={ch.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-900">{ch.name}</h3>
                        <p className="text-xs text-slate-600 mt-0.5 truncate">
                          <span className="font-semibold text-slate-800">{displayLang}</span>
                          <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
                          <span className={ch.streamUrl ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                            {ch.streamUrl ? ch.streamUrl : 'Empty placeholder URL'}
                          </span>
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
        )}

        {/* ================================================================ */}
        {/* AUDIT LOG TAB (Admin-only visibility) */}
        {/* ================================================================ */}
        {activeTab === 'audit' && (
          <section className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Admin Audit Log
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Records every authenticated admin action. Visible strictly inside the Admin Panel.
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
                Changing your password rotates the SHA-256 salt and invalidates all other sessions.
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
                  <dd className="text-emerald-700 font-semibold">Salted PBKDF2-SHA-256</dd>
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

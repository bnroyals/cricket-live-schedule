import { useCallback, useEffect, useMemo, useState } from 'react';
import { PublicLayout } from './components/PublicLayout';
import { HomePage } from './pages/HomePage';
import { MatchPage } from './pages/MatchPage';
import { WatchPlayerPage } from './pages/WatchPlayerPage';
import { AdminPage } from './pages/AdminPage';
import { navigate, usePathname } from './lib/router';
import { SECRET_ADMIN_PATH } from './lib/firebase';
import {
  purgeExpiredMatches,
  subscribeToLiveAdSettings,
  subscribeToLiveChannels,
  subscribeToLiveMatches,
} from './lib/storage';
import { isChannelEntryOpen, isMatchExpired } from './lib/time';
import { createDefaultAdSettings } from './lib/adSlots';
import { AdSettingsProvider } from './lib/adContext';
import type { AdSettingsMap, Channel, CricketMatch } from './types/cricket';

export default function App() {
  const pathname = usePathname();

  // Live Firestore collections (zero hardcoded or localStorage fallback content).
  const [rawMatches, setRawMatches] = useState<CricketMatch[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [adSettings, setAdSettings] = useState<AdSettingsMap>(() => createDefaultAdSettings());
  const [matchesLoading, setMatchesLoading] = useState<boolean>(true);
  const [channelsLoading, setChannelsLoading] = useState<boolean>(true);

  // Pure in-memory selected channel state — channels have NO public URL and can
  // ONLY be opened via a Match Page Watch button.
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  // 1-second clock tick for smooth live match countdowns and expiry checks.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Subscribe LIVE to Firestore matches, channels & ad placements so Admin Panel edits appear immediately.
  useEffect(() => {
    const unsubMatches = subscribeToLiveMatches(
      (nextMatches) => setRawMatches(nextMatches),
      () => setMatchesLoading(false)
    );
    const unsubChannels = subscribeToLiveChannels(
      (nextChannels) => setChannels(nextChannels),
      () => setChannelsLoading(false)
    );
    const unsubAds = subscribeToLiveAdSettings((nextAds) => setAdSettings(nextAds));
    return () => {
      unsubMatches();
      unsubChannels();
      unsubAds();
    };
  }, []);

  const refreshAll = useCallback(() => {
    setNowMs(Date.now());
    void purgeExpiredMatches(Date.now());
  }, []);

  const handleOpenChannel = useCallback((channelId: string, match: CricketMatch | null) => {
    if (!match || !isChannelEntryOpen(match, Date.now())) {
      return;
    }
    setActiveChannelId(channelId);
    window.scrollTo({ top: 0 });
  }, []);

  const handleCloseChannel = useCallback(() => {
    setActiveChannelId(null);
  }, []);

  const handleBackToSchedule = useCallback(() => {
    setActiveChannelId(null);
    navigate('/');
  }, []);

  // Normalize path (strip trailing slash except root)
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Clear in-app channel view whenever the route changes (e.g. Back/Forward or nav links).
  useEffect(() => {
    setActiveChannelId(null);
  }, [pathname]);

  // Redirect removed /channels and /watch routes directly to Home/Schedule (/)
  useEffect(() => {
    const lowerPath = normalizedPath.toLowerCase();
    if (
      lowerPath === '/channels' ||
      lowerPath.startsWith('/channels/') ||
      lowerPath === '/watch' ||
      lowerPath.startsWith('/watch/')
    ) {
      setActiveChannelId(null);
      navigate('/', true);
    }
  }, [normalizedPath]);

  // Check expiry on mount, route navigation, and every 15 seconds.
  useEffect(() => {
    refreshAll();
  }, [pathname, refreshAll]);

  useEffect(() => {
    const expiryTimer = window.setInterval(() => {
      void purgeExpiredMatches(Date.now());
    }, 15000);
    const clockTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(expiryTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  // Filter out expired matches (30 min after end time) in real time.
  const activeMatches = useMemo(
    () => rawMatches.filter((m) => !isMatchExpired(m, nowMs)),
    [rawMatches, nowMs]
  );

  // Admin Panel — lives ONLY at the secret URL (28 random characters).
  // It is never linked from any public page, and /admin shows the Home page.
  if (normalizedPath === SECRET_ADMIN_PATH) {
    return (
      <AdminPage
        matches={activeMatches}
        channels={channels}
        adSettings={adSettings}
        onRefreshData={refreshAll}
      />
    );
  }

  // In-App Channel View — opened ONLY through a Match Page Watch button via app state.
  // Never exposed at a public URL; browser address never changes to /watch/<channelId>.
  if (activeChannelId !== null) {
    return (
      <AdSettingsProvider settings={adSettings}>
        <PublicLayout pathname="" onNavigate={handleCloseChannel}>
          <WatchPlayerPage
            channelId={activeChannelId}
            channels={channels}
            loading={channelsLoading}
            onBackToSchedule={handleBackToSchedule}
          />
        </PublicLayout>
      </AdSettingsProvider>
    );
  }

  // Match Page (/match/<slug>)
  if (normalizedPath.startsWith('/match/')) {
    const slug = decodeURIComponent(normalizedPath.slice('/match/'.length));
    const normalizedSlug = slug.trim().toLowerCase();
    const match =
      activeMatches.find((m) => m.slug.toLowerCase() === normalizedSlug) ?? null;
    return (
      <AdSettingsProvider settings={adSettings}>
        <PublicLayout pathname={normalizedPath}>
          <MatchPage
            slug={slug}
            match={match}
            channels={channels}
            nowMs={nowMs}
            loading={matchesLoading}
            onOpenChannel={(channelId) => handleOpenChannel(channelId, match)}
          />
        </PublicLayout>
      </AdSettingsProvider>
    );
  }

  // Home Page (/) and fallback (including redirected /channels and /watch)
  return (
    <AdSettingsProvider settings={adSettings}>
      <PublicLayout pathname="/">
        <HomePage matches={activeMatches} nowMs={nowMs} />
      </PublicLayout>
    </AdSettingsProvider>
  );
}

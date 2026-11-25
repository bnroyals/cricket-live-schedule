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
  subscribeToLiveChannels,
  subscribeToLiveMatches,
} from './lib/storage';
import { isMatchExpired } from './lib/time';
import type { Channel, CricketMatch } from './types/cricket';

export default function App() {
  const pathname = usePathname();

  // Live Firestore collections (zero hardcoded or localStorage fallback content).
  const [rawMatches, setRawMatches] = useState<CricketMatch[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [matchesLoading, setMatchesLoading] = useState<boolean>(true);
  const [channelsLoading, setChannelsLoading] = useState<boolean>(true);

  // 1-second clock tick for smooth live match countdowns and expiry checks.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Subscribe LIVE to Firestore matches & channels so Admin Panel edits appear immediately.
  useEffect(() => {
    const unsubMatches = subscribeToLiveMatches(
      (nextMatches) => setRawMatches(nextMatches),
      () => setMatchesLoading(false)
    );
    const unsubChannels = subscribeToLiveChannels(
      (nextChannels) => setChannels(nextChannels),
      () => setChannelsLoading(false)
    );
    return () => {
      unsubMatches();
      unsubChannels();
    };
  }, []);

  const refreshAll = useCallback(() => {
    setNowMs(Date.now());
    void purgeExpiredMatches(Date.now());
  }, []);

  // Normalize path (strip trailing slash except root)
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Redirect removed /channels route directly to Home/Schedule (/)
  useEffect(() => {
    const lowerPath = normalizedPath.toLowerCase();
    if (lowerPath === '/channels' || lowerPath.startsWith('/channels/')) {
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
        onRefreshData={refreshAll}
      />
    );
  }

  // In-App Live Embedded Player Page (/watch/<channelId>)
  if (normalizedPath.startsWith('/watch/')) {
    const channelId = decodeURIComponent(normalizedPath.slice('/watch/'.length));
    return (
      <PublicLayout pathname={normalizedPath}>
        <WatchPlayerPage
          channelId={channelId}
          channels={channels}
          loading={channelsLoading}
        />
      </PublicLayout>
    );
  }

  // Match Page (/match/<slug>)
  if (normalizedPath.startsWith('/match/')) {
    const slug = decodeURIComponent(normalizedPath.slice('/match/'.length));
    const normalizedSlug = slug.trim().toLowerCase();
    const match =
      activeMatches.find((m) => m.slug.toLowerCase() === normalizedSlug) ?? null;
    return (
      <PublicLayout pathname={normalizedPath}>
        <MatchPage
          slug={slug}
          match={match}
          channels={channels}
          nowMs={nowMs}
          loading={matchesLoading}
        />
      </PublicLayout>
    );
  }

  // Home Page (/) and fallback (including redirected /channels)
  return (
    <PublicLayout pathname="/">
      <HomePage matches={activeMatches} nowMs={nowMs} />
    </PublicLayout>
  );
}

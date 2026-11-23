import { useCallback, useEffect, useState } from 'react';
import { PublicLayout } from './components/PublicLayout';
import { HomePage } from './pages/HomePage';
import { MatchPage } from './pages/MatchPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { AdminPage } from './pages/AdminPage';
import { usePathname } from './lib/router';
import { SECRET_ADMIN_PATH } from './lib/firebase';
import {
  ensureSeedData,
  getPublicChannels,
  getPublicMatchBySlug,
  getPublicMatches,
  purgeExpiredMatches,
  refreshPublicDataFromFirestore,
} from './lib/storage';
import type { Channel, CricketMatch } from './types/cricket';

export default function App() {
  const pathname = usePathname();

  // Load the single source of truth for every page.
  const [matches, setMatches] = useState<CricketMatch[]>(() => {
    ensureSeedData();
    purgeExpiredMatches();
    return getPublicMatches();
  });
  const [channels, setChannels] = useState<Channel[]>(() => {
    ensureSeedData();
    return getPublicChannels();
  });

  // 1-second clock tick for smooth live match countdowns.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const refreshAll = useCallback(() => {
    purgeExpiredMatches(Date.now());
    setMatches(getPublicMatches());
    setChannels(getPublicChannels());
  }, []);

  // Check expiry on mount, route navigation, and every 15 seconds.
  useEffect(() => {
    refreshAll();
  }, [pathname, refreshAll]);

  // Pull the server-side public data (Firestore) into the local cache once
  // on load, so every browser and device sees the same schedule. Falls back
  // to the local cache when Firestore is unreachable.
  useEffect(() => {
    void refreshPublicDataFromFirestore();
  }, []);

  useEffect(() => {
    // 15-second check to remove finished matches.
    const expiryTimer = window.setInterval(() => {
      purgeExpiredMatches(Date.now());
      setMatches(getPublicMatches());
      setChannels(getPublicChannels());
    }, 15000);
    // 1-second clock tick for smooth live match countdowns
    const clockTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    const handleSync = () => {
      refreshAll();
    };
    window.addEventListener('clsw:data-changed', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.clearInterval(expiryTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener('clsw:data-changed', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, [refreshAll]);

  // Normalize path (strip trailing slash except root)
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Admin Panel — lives ONLY at the secret URL (28 random characters).
  // It is never linked from any public page, and /admin shows the Home page.
  if (normalizedPath === SECRET_ADMIN_PATH) {
    return (
      <AdminPage
        matches={matches}
        channels={channels}
        onRefreshData={refreshAll}
      />
    );
  }

  // Match Page (/match/<slug>)
  if (normalizedPath.startsWith('/match/')) {
    const slug = decodeURIComponent(normalizedPath.slice('/match/'.length));
    const match = getPublicMatchBySlug(slug);
    return (
      <PublicLayout pathname={normalizedPath}>
        <MatchPage slug={slug} match={match} channels={channels} nowMs={nowMs} />
      </PublicLayout>
    );
  }

  // Permanent Channels Page (/channels)
  if (normalizedPath === '/channels') {
    return (
      <PublicLayout pathname={normalizedPath}>
        <ChannelsPage channels={channels} />
      </PublicLayout>
    );
  }

  // Home Page (/) and fallback
  return (
    <PublicLayout pathname="/">
      <HomePage matches={matches} channels={channels} nowMs={nowMs} />
    </PublicLayout>
  );
}

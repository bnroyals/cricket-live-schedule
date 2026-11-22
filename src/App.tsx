import { useCallback, useEffect, useState } from 'react';
import { PublicLayout } from './components/PublicLayout';
import { HomePage } from './pages/HomePage';
import { MatchPage } from './pages/MatchPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { AdminPage } from './pages/AdminPage';
import { usePathname } from './lib/router';
import {
  ensureSeedData,
  getPublicChannels,
  getPublicMatchBySlug,
  getPublicMatches,
  purgeExpiredMatches,
} from './lib/storage';
import type { Channel, CricketMatch } from './types/cricket';

export default function App() {
  const pathname = usePathname();
  const [matches, setMatches] = useState<CricketMatch[]>(() => {
    ensureSeedData();
    purgeExpiredMatches();
    return getPublicMatches();
  });
  const [channels, setChannels] = useState<Channel[]>(() => {
    ensureSeedData();
    return getPublicChannels();
  });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const refreshAll = useCallback(() => {
    purgeExpiredMatches(Date.now());
    setMatches(getPublicMatches());
    setChannels(getPublicChannels());
  }, []);

  // Check expiry on mount, route navigation, and every 15 seconds
  useEffect(() => {
    refreshAll();
  }, [pathname, refreshAll]);

  useEffect(() => {
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

  // Admin Panel (/admin) — standalone shell, never linked from public pages
  if (normalizedPath === '/admin') {
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

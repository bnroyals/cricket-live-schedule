import React from 'react';
import { Calendar, Tv } from 'lucide-react';
import { useNavigate } from '../lib/router';

interface PublicLayoutProps {
  pathname: string;
  children: React.ReactNode;
}

/**
 * Light-mode-only public layout shell for Home (/), Match Page (/match/<slug>), and Channels (/channels).
 * Deliberately contains ZERO links or references to /admin and NO dark/light toggle.
 */
export function PublicLayout({ pathname, children }: PublicLayoutProps) {
  const navigate = useNavigate();

  const isScheduleActive = pathname === '/' || pathname.startsWith('/match/');
  const isChannelsActive = pathname === '/channels';

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    navigate(path);
  };

  return (
    <div className="min-h-dvh flex flex-col bg-[#F5F7F9] text-slate-900 pb-16 sm:pb-0">
      {/* Sticky Light Top Bar — Strict 3-zone contract, 56px height */}
      <header className="sticky top-0 z-40 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <a
            href="/"
            onClick={(e) => handleLinkClick(e, '/')}
            className="font-display text-2xl font-extrabold tracking-wide text-emerald-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
          >
            Cricket Live
          </a>

          {/* Zone 2: Clean single-line typography nav links */}
          <nav
            aria-label="Primary navigation"
            className="hidden sm:flex items-center gap-7 text-sm font-semibold"
          >
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors duration-150 ${
                isScheduleActive
                  ? 'text-emerald-800 border-emerald-600'
                  : 'text-slate-600 border-transparent hover:text-slate-900'
              }`}
            >
              Schedule · शेड्यूल
            </a>
            <a
              href="/channels"
              onClick={(e) => handleLinkClick(e, '/channels')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors duration-150 ${
                isChannelsActive
                  ? 'text-emerald-800 border-emerald-600'
                  : 'text-slate-600 border-transparent hover:text-slate-900'
              }`}
            >
              Channels · चैनल
            </a>
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="flex items-center shrink-0">
            <a
              href="/channels"
              onClick={(e) => handleLinkClick(e, '/channels')}
              className="inline-flex items-center justify-center min-h-[40px] px-4 py-2 rounded-xl text-sm font-bold bg-emerald-700 text-white hover:bg-emerald-800 active:scale-[0.98] transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              Watch Live · देखें
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Quiet Light Footer — Explicitly states storage mode, zero admin links */}
      <footer className="border-t border-slate-200 bg-white mt-16 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-slate-900 font-semibold">Cricket Live Schedule &amp; Watch</span>
            <span aria-hidden="true">·</span>
            <span>All match timings in IST (UTC+5:30) · सभी समय भारतीय मानक समय में</span>
          </div>
          <div className="text-slate-600">
            Storage: <span className="text-slate-900 font-semibold">localStorage</span> (Firebase Firestore unavailable)
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar — Compact 56px light bar, thumb-zone ergonomics, zero admin link */}
      <nav
        aria-label="Mobile navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-2"
      >
        <a
          href="/"
          onClick={(e) => handleLinkClick(e, '/')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            isScheduleActive ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          <Calendar className="w-5 h-5" aria-hidden="true" />
          <span className="whitespace-nowrap">Schedule · शेड्यूल</span>
        </a>
        <a
          href="/channels"
          onClick={(e) => handleLinkClick(e, '/channels')}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            isChannelsActive ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          <Tv className="w-5 h-5" aria-hidden="true" />
          <span className="whitespace-nowrap">Channels · चैनल</span>
        </a>
      </nav>
    </div>
  );
}

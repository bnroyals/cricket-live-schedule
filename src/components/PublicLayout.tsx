import React from 'react';
import { Calendar } from 'lucide-react';
import { useNavigate } from '../lib/router';
import { AdSlot } from './AdSlot';
import { SiteWideAds } from './SiteWideAds';

interface PublicLayoutProps {
  pathname: string;
  children: React.ReactNode;
  onNavigate?: () => void;
}

/**
 * Light-mode-only, English-only public layout shell for Home (/), Match Page (/match/<slug>), and in-app Channel View.
 * Contains ZERO links to /admin, ZERO /channels directory links, ZERO /watch links, ZERO dark/light toggle, and ZERO storage notice.
 */
export function PublicLayout({ pathname, children, onNavigate }: PublicLayoutProps) {
  const navigate = useNavigate();

  const isScheduleActive = pathname === '/' || pathname.startsWith('/match/');

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate?.();
    navigate(path);
  };

  return (
    <div className="min-h-dvh flex flex-col bg-[#F5F7F9] text-slate-900 pb-16 sm:pb-0">
      {/* Sticky Light Top Bar — 56px height */}
      <header className="sticky top-0 z-40 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          {/* Single-line brand wordmark */}
          <a
            href="/"
            onClick={(e) => handleLinkClick(e, '/')}
            className="font-display text-2xl font-extrabold tracking-wide text-emerald-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
          >
            Cricket Live
          </a>

          {/* Clean single-line typography nav */}
          <nav
            aria-label="Primary navigation"
            className="flex items-center gap-7 text-sm font-semibold"
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
              Schedule
            </a>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      <AdSlot positionId="footer-top" />

      {/* Quiet Light Footer — English only, zero storage notice, zero admin or directory links */}
      <footer className="border-t border-slate-200 bg-white mt-16 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-slate-900 font-semibold">Cricket Live Schedule &amp; Watch</span>
            <span aria-hidden="true">·</span>
            <span>All match timings shown in IST (UTC+5:30)</span>
          </div>
          <AdSlot positionId="footer-mid" />
          <div className="text-slate-500">Worldwide Cricket Fixtures &amp; Live Schedule</div>
        </div>
      </footer>

      <AdSlot positionId="footer-bottom" />

      {/* Mobile Bottom Navigation Bar — Schedule only */}
      <nav
        aria-label="Mobile navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 flex items-center justify-center"
      >
        <a
          href="/"
          onClick={(e) => handleLinkClick(e, '/')}
          className={`flex flex-col items-center justify-center gap-0.5 px-6 h-full text-[11px] font-semibold transition-colors ${
            isScheduleActive ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          <Calendar className="w-5 h-5" aria-hidden="true" />
          <span className="whitespace-nowrap">Schedule</span>
        </a>
      </nav>

      {/* Site-wide script slots (Social Bar, optional Popunder — only run when ON with code) */}
      <SiteWideAds />
    </div>
  );
}

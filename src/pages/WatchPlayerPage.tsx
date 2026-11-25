import { ArrowLeft, Tv } from 'lucide-react';
import type { Channel } from '../types/cricket';
import { PageContent } from '../components/PageContent';
import { AdSlot } from '../components/AdSlot';
import { getChannelDisplayName, getChannelHtml } from '../lib/channelHtml';
import { useNavigate } from '../lib/router';

interface WatchPlayerPageProps {
  channelId: string;
  channels: Channel[];
  loading?: boolean;
  onBackToSchedule?: () => void;
}

/**
 * Pure-HTML in-app Channel View (no public URL; opened only from a Match Page Watch button).
 * Renders ONLY the channel's saved HTML code (with automatic read-time
 * fallback generation from legacy fields if a stored channel has no HTML yet).
 */
export function WatchPlayerPage({
  channelId,
  channels,
  loading = false,
  onBackToSchedule,
}: WatchPlayerPageProps) {
  const navigate = useNavigate();

  const handleBackToSchedule = () => {
    if (onBackToSchedule) {
      onBackToSchedule();
    } else {
      navigate('/');
    }
  };

  const normalizedId = channelId.trim().toLowerCase();
  const channel =
    channels.find((c) => c.id.toLowerCase() === normalizedId) ??
    channels.find((c) => getChannelDisplayName(c).trim().toLowerCase() === normalizedId) ??
    null;

  if (loading && !channel) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-10 text-center">
          <Tv className="w-8 h-8 text-emerald-700 mx-auto" aria-hidden="true" />
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3">
            Loading Channel
          </h1>
          <p className="text-sm text-slate-600 mt-1.5">
            Fetching live channel content...
          </p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-8 sm:p-12 text-center">
          <Tv className="w-9 h-9 text-slate-400 mx-auto" aria-hidden="true" />
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 mt-3">
            Channel Not Found
          </h1>
          <p className="text-sm text-slate-600 mt-3 max-w-md mx-auto leading-relaxed">
            The requested broadcast channel does not exist or has been removed.
          </p>
          <div className="mt-7 flex items-center justify-center">
            <button
              type="button"
              onClick={handleBackToSchedule}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold whitespace-nowrap transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Back to Schedule</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const channelHtml = getChannelHtml(channel);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBackToSchedule}
          className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Schedule</span>
        </button>
      </div>

      <AdSlot positionId="watch-player-top" />

      <section className="mt-3 rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
        <PageContent html={channelHtml} />
      </section>
    </div>
  );
}

import { ArrowLeft, Calendar, Play, Radio, Tv } from 'lucide-react';
import type { Channel } from '../types/cricket';
import { PageContent } from '../components/PageContent';
import { hasPageContent } from '../lib/pageContent';
import { getSafeEmbedUrl } from '../lib/security';
import { useNavigate } from '../lib/router';

interface WatchPlayerPageProps {
  channelId: string;
  channels: Channel[];
  loading?: boolean;
}

export function WatchPlayerPage({ channelId, channels, loading = false }: WatchPlayerPageProps) {
  const navigate = useNavigate();

  const normalizedId = channelId.trim().toLowerCase();
  const channel =
    channels.find((c) => c.id.toLowerCase() === normalizedId) ??
    channels.find((c) => c.name.trim().toLowerCase() === normalizedId) ??
    null;

  if (loading && !channel) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-10 text-center">
          <Tv className="w-8 h-8 text-emerald-700 mx-auto" aria-hidden="true" />
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-3">
            Loading Live Player
          </h1>
          <p className="text-sm text-slate-600 mt-1.5">
            Fetching live channel stream configuration...
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
            The requested broadcast channel does not exist or has been removed. Choose an available live channel below.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/channels')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold whitespace-nowrap transition-colors"
            >
              <Tv className="w-4 h-4" aria-hidden="true" />
              <span>Browse Channels</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-sm font-bold whitespace-nowrap transition-colors"
            >
              <Calendar className="w-4 h-4" aria-hidden="true" />
              <span>Match Schedule</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const embedUrl = getSafeEmbedUrl(channel.streamUrl);
  const isPlayable = Boolean(embedUrl);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      {/* Top In-App Navigation Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/channels')}
          className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to Channels</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-emerald-700 hover:text-emerald-800 transition-colors"
        >
          <Calendar className="w-4 h-4" aria-hidden="true" />
          <span>Match Schedule</span>
        </button>
      </div>

      {/* Main Embedded Live Player Card */}
      <section className="mt-3 rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
        {/* Player Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-emerald-700">Live Broadcast Player</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-semibold text-slate-800">{channel.language}</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-0.5 leading-tight">
              {channel.name}
            </h1>
          </div>

          <div
            className={`inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap ${
              isPlayable ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isPlayable ? 'Embedded Stream Ready' : 'Stream Unavailable'}</span>
          </div>
        </div>

        {/* Responsive 16:9 In-App Player Area */}
        <div className="p-4 sm:p-6 bg-[#F8FAFC]">
          <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-200 bg-white">
            {isPlayable && embedUrl ? (
              <iframe
                key={embedUrl}
                src={embedUrl}
                title={`${channel.name} Live Stream`}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 sm:p-10 bg-slate-50">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                  <Tv className="w-7 h-7" aria-hidden="true" />
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-4">
                  Stream Currently Unavailable
                </h2>
                <p className="text-sm text-slate-600 mt-2 max-w-md leading-relaxed">
                  No playable embedded stream is currently available for{' '}
                  <span className="font-semibold text-slate-900">{channel.name}</span>. Please
                  select another live channel below or check back later.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/channels')}
                  className="mt-5 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold transition-colors"
                >
                  <Tv className="w-4 h-4" aria-hidden="true" />
                  <span>View All Channels</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Admin-Authored Rich Channel Page Content */}
      {hasPageContent(channel.pageContent) && (
        <section className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-xs p-6 sm:p-8">
          <PageContent html={channel.pageContent} />
        </section>
      )}

      {/* In-App Channel Switcher */}
      {channels.length > 1 && (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Switch Channel
            </h2>
            <span className="text-xs font-semibold text-slate-500 font-mono-tabular">
              {channels.length} channels
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {channels.map((item) => {
              const isCurrent = item.id === channel.id;
              const itemPlayable = Boolean(getSafeEmbedUrl(item.streamUrl));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/watch/${encodeURIComponent(item.id)}`)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`text-left rounded-xl p-4 border transition-all flex items-center justify-between gap-3 min-h-[68px] ${
                    isCurrent
                      ? 'bg-emerald-50 border-emerald-500 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{item.name}</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      <span className="font-semibold text-slate-800">{item.language}</span>
                      <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                      <span className={itemPlayable ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                        {itemPlayable ? 'Ready' : 'Unavailable'}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold shrink-0 px-3 py-1.5 rounded-lg ${
                      isCurrent
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                    <span>{isCurrent ? 'Watching' : 'Watch'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

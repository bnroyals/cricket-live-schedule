import { ArrowLeft, Calendar, ChevronRight, Clock, Tv } from 'lucide-react';
import type { Channel, CricketMatch } from '../types/cricket';
import { PageContent } from '../components/PageContent';
import { hasPageContent } from '../lib/pageContent';
import { getSafeEmbedUrl } from '../lib/security';
import {
  formatDisplayDate,
  formatIstTime,
  getEffectiveMatchStatus,
} from '../lib/time';
import { useNavigate } from '../lib/router';

interface ChannelsPageProps {
  channels: Channel[];
  matches: CricketMatch[];
  nowMs: number;
  loading?: boolean;
}

export function ChannelsPage({
  channels,
  matches,
  nowMs,
  loading = false,
}: ChannelsPageProps) {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Back to Schedule</span>
      </button>

      <div className="mt-3 pb-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-emerald-700">
            Permanent Broadcast Directory
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mt-1">
            Live Cricket Channels
          </h1>
          <p className="text-sm text-slate-600 mt-1.5">
            Browse broadcast channels below to find scheduled matches covered on each channel.
          </p>
        </div>
        <span className="text-xs font-semibold text-slate-500 font-mono-tabular whitespace-nowrap">
          {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
        </span>
      </div>

      {loading && channels.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-white border border-slate-200 shadow-xs p-10 text-center">
          <p className="text-base font-bold text-slate-900">Loading live channels...</p>
          <p className="text-sm text-slate-600 mt-1">
            Connecting to the live broadcast directory.
          </p>
        </div>
      ) : channels.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-white border border-slate-200 shadow-xs p-10 text-center">
          <p className="text-base font-bold text-slate-900">No channels configured yet.</p>
          <p className="text-sm text-slate-600 mt-1">
            Broadcast channels will appear here once added.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {channels.map((channel) => {
            const embedUrl = getSafeEmbedUrl(channel.streamUrl);
            const isPlayable = Boolean(embedUrl);
            const hasContent = hasPageContent(channel.pageContent);
            const channelMatches = matches.filter((match) =>
              match.channelIds.includes(channel.id)
            );

            return (
              <article
                key={channel.id}
                className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 flex flex-col justify-between gap-5"
              >
                <div className="space-y-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 text-emerald-700">
                      <Tv className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-slate-900 leading-snug truncate">
                        {channel.name}
                      </h2>
                      <p className="text-xs text-slate-600 mt-1">
                        <span className="font-semibold text-slate-800">{channel.language}</span>
                        <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                        <span className={isPlayable ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                          {isPlayable ? 'Stream ready' : 'Stream unavailable'}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Scheduled matches covered by this channel */}
                  <div className="pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className="text-xs font-semibold text-slate-500">
                        Scheduled Matches
                      </span>
                      <span className="text-xs font-semibold text-slate-500 font-mono-tabular">
                        {channelMatches.length}
                      </span>
                    </div>

                    {channelMatches.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">
                        No scheduled matches on this channel
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {channelMatches.map((match) => {
                          const effectiveStatus = getEffectiveMatchStatus(match, nowMs);
                          const matchPath = `/match/${match.slug}`;

                          return (
                            <li key={match.id}>
                              <a
                                href={matchPath}
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(matchPath);
                                }}
                                className="flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 transition-colors group"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    <span
                                      className={`font-bold ${
                                        effectiveStatus === 'LIVE'
                                          ? 'text-red-600'
                                          : effectiveStatus === 'Finished'
                                            ? 'text-slate-500'
                                            : 'text-emerald-700'
                                      }`}
                                    >
                                      {effectiveStatus}
                                    </span>
                                    <span className="text-slate-300" aria-hidden="true">·</span>
                                    <span className="text-slate-600 truncate">
                                      {match.tournament}
                                    </span>
                                  </div>
                                  <p className="text-sm font-bold text-slate-900 group-hover:text-emerald-800 truncate mt-0.5">
                                    {match.teamA} vs {match.teamB}
                                  </p>
                                  <div className="flex items-center gap-2 text-[11px] text-slate-600 mt-0.5 font-mono-tabular">
                                    <span className="inline-flex items-center gap-1">
                                      <Calendar className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                                      <span>{formatDisplayDate(match.date)}</span>
                                    </span>
                                    <span className="text-slate-300" aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                                      <span>{formatIstTime(match.startTime)}</span>
                                    </span>
                                  </div>
                                </div>
                                <ChevronRight
                                  className="w-4 h-4 text-slate-400 group-hover:text-emerald-700 shrink-0 transition-colors"
                                  aria-hidden="true"
                                />
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {hasContent && (
                  <div className="pt-4 border-t border-slate-200">
                    <PageContent html={channel.pageContent} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

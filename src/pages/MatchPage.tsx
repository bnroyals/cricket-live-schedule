import { ArrowLeft, Calendar, Clock, Lock, MapPin, Play } from 'lucide-react';
import type { Channel, CricketMatch } from '../types/cricket';
import { PageContent } from '../components/PageContent';
import { hasPageContent } from '../lib/pageContent';
import { channelHasPlayableEmbed, getChannelDisplayName } from '../lib/channelHtml';
import {
  formatCountdownDuration,
  formatDisplayDate,
  formatIstTime,
  getChannelEntryOpenTimestamp,
  getCountdownToStart,
  getEffectiveMatchStatus,
  getMatchExpiryTimestamp,
  isChannelEntryOpen,
} from '../lib/time';
import { useNavigate } from '../lib/router';
import { TeamNameWithFlag } from '../components/TeamNameWithFlag';

interface MatchPageProps {
  slug: string;
  match: CricketMatch | null;
  channels: Channel[];
  nowMs: number;
  loading?: boolean;
  onOpenChannel: (channelId: string) => void;
}

export function MatchPage({
  match,
  channels,
  nowMs,
  loading = false,
  onOpenChannel,
}: MatchPageProps) {
  const navigate = useNavigate();

  if (loading && !match) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-8 sm:p-12 text-center">
          <p className="text-xs font-semibold text-emerald-700">Live Schedule</p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 mt-2">
            Loading Match Details
          </h1>
          <p className="text-sm text-slate-600 mt-3">
            Fetching live fixture details...
          </p>
        </div>
      </div>
    );
  }

  // Auto-deleted or expired match view
  if (!match) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-8 sm:p-12 text-center">
          <p className="text-xs font-semibold text-amber-700">Match Notice</p>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold text-slate-900 mt-2">
            Match ended
          </h1>
          <p className="text-sm text-slate-600 mt-4 max-w-md mx-auto leading-relaxed">
            This match page has expired and been automatically removed 30 minutes after the match end time.
          </p>
          <div className="mt-7 flex items-center justify-center">
            <button
              type="button"
              onClick={() => navigate('/')}
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

  const effectiveStatus = getEffectiveMatchStatus(match, nowMs);
  const countdown = getCountdownToStart(match, nowMs);
  const expiryMs = getMatchExpiryTimestamp(match);
  const minutesUntilAutoDelete = Math.max(0, Math.ceil((expiryMs - nowMs) / 60000));

  // Channel entry opens strictly from 10 minutes before scheduled IST start time onward.
  const channelEntryOpen = isChannelEntryOpen(match, nowMs);
  const channelOpenAtMs = getChannelEntryOpenTimestamp(match);
  const msUntilChannelOpens = Math.max(0, channelOpenAtMs - nowMs);
  const matchStartCountdownText = formatCountdownDuration(countdown.totalMs);
  const channelOpenCountdownText = formatCountdownDuration(msUntilChannelOpens);

  // Strict match-only channel resolution: ONLY channels assigned to THIS match
  // whose HTML contains a playable embed (or valid legacy streamUrl).
  const playableAssignedChannels = match.channelIds
    .map((id) => channels.find((c) => c.id === id))
    .filter((c): c is Channel => c !== undefined && channelHasPlayableEmbed(c));

  const primaryChannel = playableAssignedChannels[0] ?? null;
  const primaryChannelName = primaryChannel ? getChannelDisplayName(primaryChannel) : '';

  const handleWatchClick = (channelId: string) => {
    if (!channelEntryOpen) return;
    onOpenChannel(channelId);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>All Matches</span>
      </button>

      {/* Main Match Card */}
      <section className="mt-3 rounded-2xl bg-white border border-slate-200 shadow-xs p-6 sm:p-8">
        {/* Top Metadata Line (Zero pills) */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="text-slate-600">
            <span className="font-bold text-slate-900">{match.tournament}</span>
            {match.matchNumber && (
              <>
                <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
                <span>{match.matchNumber}</span>
              </>
            )}
          </div>
          <div
            className={`font-bold tracking-wide whitespace-nowrap ${
              effectiveStatus === 'LIVE'
                ? 'text-red-600'
                : effectiveStatus === 'Finished'
                  ? 'text-slate-500'
                  : 'text-emerald-700'
            }`}
          >
            {effectiveStatus === 'LIVE' && 'LIVE NOW'}
            {effectiveStatus === 'Upcoming' && 'UPCOMING'}
            {effectiveStatus === 'Finished' && 'FINISHED'}
          </div>
        </div>

        {/* Teams Display */}
        <div className="mt-6 py-7 border-y border-slate-200 text-center bg-[#F8FAFC] -mx-6 sm:-mx-8 px-6 sm:px-8">
          <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 leading-none flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-2">
            <TeamNameWithFlag teamName={match.teamA} countryCode={match.countryCodeA} />
            <span className="text-amber-600 text-3xl sm:text-4xl font-bold">vs</span>
            <TeamNameWithFlag teamName={match.teamB} countryCode={match.countryCodeB} />
          </h1>

          {/* Countdown or Live Status */}
          <div className="mt-6">
            {effectiveStatus === 'Upcoming' && !countdown.isStarted ? (
              <div>
                <p className="text-xs font-semibold text-slate-600">
                  Match starts in
                </p>
                <div className="mt-2 inline-flex items-baseline gap-4 sm:gap-6 font-mono-tabular">
                  {countdown.days > 0 && (
                    <div>
                      <span className="text-3xl sm:text-4xl font-bold text-slate-900">
                        {String(countdown.days).padStart(2, '0')}
                      </span>
                      <span className="block text-[11px] text-slate-500 font-sans mt-0.5">
                        Days
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-3xl sm:text-4xl font-bold text-slate-900">
                      {String(countdown.hours).padStart(2, '0')}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-sans mt-0.5">
                      Hrs
                    </span>
                  </div>
                  <div>
                    <span className="text-3xl sm:text-4xl font-bold text-slate-900">
                      {String(countdown.minutes).padStart(2, '0')}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-sans mt-0.5">
                      Min
                    </span>
                  </div>
                  <div>
                    <span className="text-3xl sm:text-4xl font-bold text-emerald-700">
                      {String(countdown.seconds).padStart(2, '0')}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-sans mt-0.5">
                      Sec
                    </span>
                  </div>
                </div>
              </div>
            ) : effectiveStatus === 'LIVE' ? (
              <div>
                <p className="text-lg sm:text-xl font-bold text-red-600">
                  Match is LIVE now
                </p>
                {primaryChannel && channelEntryOpen && (
                  <p className="text-xs sm:text-sm text-slate-600 mt-1">
                    Tap Watch below to open the built-in live broadcast player.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-base font-bold text-slate-800">
                  Match finished
                </p>
                <p className="text-xs text-slate-500 mt-1 font-mono-tabular">
                  This match page auto-deletes in ~{minutesUntilAutoDelete} min
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Match Facts Grid */}
        <dl className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-5 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Calendar className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>Date</span>
            </dt>
            <dd className="mt-1 font-bold text-slate-900">{formatDisplayDate(match.date)}</dd>
          </div>

          <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Clock className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>Timing (IST)</span>
            </dt>
            <dd className="mt-1 font-mono-tabular font-bold text-slate-900">
              {formatIstTime(match.startTime)} – {formatIstTime(match.endTime)}
            </dd>
          </div>

          <div>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <MapPin className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>Venue</span>
            </dt>
            <dd className="mt-1 font-bold text-slate-900">{match.venue}</dd>
          </div>
        </dl>

        {/* Live Match-Start Countdown Timer above the Watch button(s) */}
        {primaryChannel && !countdown.isStarted && (
          <div
            className={`mt-6 rounded-xl border px-4 py-3.5 text-center ${
              channelEntryOpen
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <p className="text-sm sm:text-base font-bold text-slate-900 font-mono-tabular">
              Match starts in{' '}
              <span className={channelEntryOpen ? 'text-emerald-700' : 'text-slate-900'}>
                {matchStartCountdownText}
              </span>
            </p>
            {channelEntryOpen ? (
              <p className="text-xs font-semibold text-emerald-700 mt-1">
                Match starting soon — channel is now open
              </p>
            ) : (
              <p className="text-xs text-slate-600 mt-1 font-mono-tabular">
                Channel opens 10 minutes before match start (in {channelOpenCountdownText})
              </p>
            )}
          </div>
        )}

        {/* Additional Playable Channels Assigned to THIS Match Only */}
        {playableAssignedChannels.length > 1 && (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-xs font-medium text-slate-500">
              Watch This Match On
            </p>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {playableAssignedChannels.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  disabled={!channelEntryOpen}
                  aria-disabled={!channelEntryOpen}
                  onClick={() => handleWatchClick(ch.id)}
                  className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors min-h-[48px] ${
                    channelEntryOpen
                      ? 'bg-slate-50 hover:bg-emerald-50 border-slate-200 hover:border-emerald-400 cursor-pointer'
                      : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-80'
                  }`}
                >
                  <div className="min-w-0">
                    <span
                      className={`block text-sm font-bold truncate ${
                        channelEntryOpen ? 'text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      {getChannelDisplayName(ch)}
                    </span>
                  </div>
                  {channelEntryOpen ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 shrink-0">
                      <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                      <span>Watch</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 shrink-0">
                      <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Locked</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Primary Focal CTA — Shown ONLY if this match has a playable assigned channel */}
        {primaryChannel && (
          <div className="mt-6 flex items-stretch">
            <button
              type="button"
              disabled={!channelEntryOpen}
              aria-disabled={!channelEntryOpen}
              onClick={() => handleWatchClick(primaryChannel.id)}
              className={`w-full min-h-[52px] px-6 py-3.5 rounded-xl text-base font-bold inline-flex items-center justify-center gap-2.5 transition-all duration-150 ${
                channelEntryOpen
                  ? 'bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
            >
              {channelEntryOpen ? (
                <Play className="w-5 h-5 fill-current" aria-hidden="true" />
              ) : (
                <Lock className="w-4 h-4" aria-hidden="true" />
              )}
              <span>Watch Live on {primaryChannelName}</span>
            </button>
          </div>
        )}
      </section>

      {/* Admin-Authored Rich Match Page Content */}
      {hasPageContent(match.pageContent) && (
        <section className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-xs p-6 sm:p-8">
          <PageContent html={match.pageContent} />
        </section>
      )}
    </div>
  );
}

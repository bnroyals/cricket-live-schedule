import React, { useMemo, useState } from 'react';
import { Calendar, ChevronRight, Clock, MapPin, Play } from 'lucide-react';
import type { CricketMatch, MatchStatus } from '../types/cricket';
import {
  formatDisplayDate,
  formatIstTime,
  getEffectiveMatchStatus,
  getIstDateString,
  getIstTomorrowDateString,
} from '../lib/time';
import { useNavigate } from '../lib/router';
import { TeamNameWithFlag } from '../components/TeamNameWithFlag';
import { AdSlot } from '../components/AdSlot';

interface HomePageProps {
  matches: CricketMatch[];
  nowMs: number;
}

type DateFilterMode = 'today' | 'tomorrow' | 'custom' | 'all';

function getStatusLabel(status: MatchStatus): string {
  switch (status) {
    case 'LIVE':
      return 'LIVE';
    case 'Finished':
      return 'Finished';
    default:
      return 'Upcoming';
  }
}

export function HomePage({ matches, nowMs }: HomePageProps) {
  const navigate = useNavigate();
  const todayIst = getIstDateString(new Date(nowMs));
  const tomorrowIst = getIstTomorrowDateString(new Date(nowMs));

  const [filterMode, setFilterMode] = useState<DateFilterMode>('today');
  const [selectedDate, setSelectedDate] = useState<string>(todayIst);
  const [heroImgError, setHeroImgError] = useState(false);

  const activeDate =
    filterMode === 'today'
      ? todayIst
      : filterMode === 'tomorrow'
        ? tomorrowIst
        : filterMode === 'custom'
          ? selectedDate
          : null;

  const filteredMatches = useMemo(() => {
    if (!activeDate) return matches;
    return matches.filter((m) => m.date === activeDate);
  }, [matches, activeDate]);

  const liveCount = useMemo(
    () => matches.filter((m) => getEffectiveMatchStatus(m, nowMs) === 'LIVE').length,
    [matches, nowMs]
  );

  const handleDatePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    setSelectedDate(val);
    if (val === todayIst) {
      setFilterMode('today');
    } else if (val === tomorrowIst) {
      setFilterMode('tomorrow');
    } else {
      setFilterMode('custom');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
      <AdSlot positionId="home-top" />
      {/* Light Sporty 2-Column Hero Card */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between gap-5">
          <div>
            <p className="text-xs sm:text-sm font-bold text-emerald-700">
              Worldwide Match Centre
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 mt-1.5 leading-[1.03]">
              Cricket Live Schedule &amp; Watch
            </h1>
            <p className="text-sm sm:text-base text-slate-600 mt-3 leading-relaxed max-w-xl">
              Follow daily international &amp; domestic cricket fixtures in IST with instant match countdowns and live match coverage.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="flex flex-wrap items-center gap-2 text-slate-700 font-medium">
              <span>
                {matches.length} scheduled {matches.length === 1 ? 'fixture' : 'fixtures'}
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              {liveCount > 0 ? (
                <span className="text-red-600 font-bold">{liveCount} LIVE now</span>
              ) : (
                <span className="text-amber-700 font-semibold">IST timings</span>
              )}
            </div>
            <div className="text-xs text-slate-500 font-mono-tabular">
              Today (IST): {formatDisplayDate(todayIst)}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[190px] sm:min-h-[230px] lg:min-h-full bg-emerald-50">
          {!heroImgError ? (
            <img
              src="/src/assets/images/cricket_stadium_daylight_1795358509911.jpg"
              alt="Sunlit international cricket stadium outfield and pitch"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgError(true)}
              className="w-full h-full object-cover object-center lg:absolute lg:inset-0"
            />
          ) : (
            <div
              aria-hidden="true"
              className="w-full h-full min-h-[190px] bg-gradient-to-br from-emerald-100 via-emerald-50 to-amber-100 flex items-center justify-center p-6 text-emerald-800 font-display text-2xl font-bold"
            >
              Matchday Centre
            </div>
          )}
        </div>
      </section>

      {/* Date Filter Bar — Interactive Tabs + Date Picker */}
      <section aria-label="Filter matches by date" className="mt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Date quick filters"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-slate-200 shadow-xs w-full sm:w-auto overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'today'}
            onClick={() => {
              setFilterMode('today');
              setSelectedDate(todayIst);
            }}
            className={`flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors duration-150 ${
              filterMode === 'today'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'tomorrow'}
            onClick={() => {
              setFilterMode('tomorrow');
              setSelectedDate(tomorrowIst);
            }}
            className={`flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors duration-150 ${
              filterMode === 'tomorrow'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Tomorrow
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'all'}
            onClick={() => setFilterMode('all')}
            className={`flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap shrink-0 transition-colors duration-150 ${
              filterMode === 'all'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            All
          </button>
        </div>

        {/* Date Picker */}
        <label className="flex items-center gap-2.5 px-3.5 min-h-[44px] rounded-xl bg-white border border-slate-200 shadow-xs text-sm text-slate-700 focus-within:border-emerald-600 transition-colors">
          <Calendar className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap">Pick Date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={handleDatePickerChange}
            aria-label="Pick match date"
            className="bg-transparent text-slate-900 text-sm font-mono-tabular font-medium outline-none cursor-pointer"
          />
        </label>
      </section>

      <AdSlot positionId="home-mid" />

      {/* Active Filter Summary */}
      <div className="mt-6 flex items-center justify-between border-b border-slate-200 pb-3">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-wide">
          {filterMode === 'today' && `Today's Matches`}
          {filterMode === 'tomorrow' && `Tomorrow's Matches`}
          {filterMode === 'custom' && `Matches on ${formatDisplayDate(selectedDate)}`}
          {filterMode === 'all' && `All Scheduled Matches`}
        </h2>
        <span className="text-xs font-semibold text-slate-500 font-mono-tabular">
          {filteredMatches.length} {filteredMatches.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      {/* Match Cards Grid */}
      {filteredMatches.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-white border border-slate-200 p-8 sm:p-12 text-center shadow-xs">
          <p className="text-lg font-bold text-slate-900">
            No matches scheduled for this date
          </p>
          <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
            Try switching to Today, Tomorrow, or view all scheduled fixtures.
          </p>
          {filterMode !== 'all' && matches.length > 0 && (
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className="mt-5 inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-sm font-bold transition-colors"
            >
              Show All Scheduled Matches
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredMatches.map((match) => {
            const effectiveStatus = getEffectiveMatchStatus(match, nowMs);

            return (
              <article
                key={match.id}
                className="rounded-2xl bg-white border border-slate-200 hover:border-emerald-300 shadow-xs transition-colors p-5 sm:p-6 flex flex-col justify-between gap-5"
              >
                <div>
                  {/* Quiet 1-line unboxed metadata kicker + status */}
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <div className="text-slate-600 leading-relaxed">
                      <span className="text-slate-900 font-semibold">{match.tournament}</span>
                      {match.matchNumber && (
                        <>
                          <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                          <span>{match.matchNumber}</span>
                        </>
                      )}
                    </div>
                    <span
                      className={`shrink-0 whitespace-nowrap font-bold tracking-wide ${
                        effectiveStatus === 'LIVE'
                          ? 'text-red-600'
                          : effectiveStatus === 'Finished'
                            ? 'text-slate-500'
                            : 'text-emerald-700'
                      }`}
                    >
                      {getStatusLabel(effectiveStatus)}
                    </span>
                  </div>

                  {/* Teams Headline */}
                  <h3 className="font-display text-3xl sm:text-[34px] font-extrabold text-slate-900 tracking-tight mt-3 leading-tight flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <TeamNameWithFlag teamName={match.teamA} countryCode={match.countryCodeA} />
                    <span className="text-amber-600 font-bold text-2xl">vs</span>
                    <TeamNameWithFlag teamName={match.teamB} countryCode={match.countryCodeB} />
                  </h3>

                  {/* Time, Date & Venue */}
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-sm text-slate-700">
                    <div className="flex items-center gap-2 font-mono-tabular font-semibold text-slate-900">
                      <Clock className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                      <span>{formatIstTime(match.startTime)}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-slate-600 font-sans font-medium">
                        {formatDisplayDate(match.date)}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-slate-600 text-xs sm:text-sm">
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{match.venue}</span>
                    </div>
                  </div>
                </div>

                {/* Footer Row: Match status cue + Primary Watch CTA */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
                  <div className="text-xs text-slate-600 font-medium">
                    {effectiveStatus === 'LIVE'
                      ? 'Match is live now'
                      : effectiveStatus === 'Finished'
                        ? 'Match finished'
                        : 'Live match page & countdown'}
                  </div>

                  <button
                    type="button"
                    onClick={() => navigate(`/match/${match.slug}`)}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white text-sm font-bold whitespace-nowrap shrink-0 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  >
                    <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                    <span>Watch</span>
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

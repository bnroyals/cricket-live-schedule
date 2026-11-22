import type { CricketMatch, MatchStatus } from '../types/cricket';

export const AUTO_DELETE_GRACE_MS = 30 * 60 * 1000; // 30 minutes after match end time

/**
 * Returns YYYY-MM-DD for a given Date in IST (Asia/Kolkata).
 */
export function getIstDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Returns Tomorrow's YYYY-MM-DD string in IST.
 */
export function getIstTomorrowDateString(now: Date = new Date()): string {
  const todayIst = getIstDateString(now);
  const noonIst = new Date(`${todayIst}T12:00:00+05:30`);
  const tomorrow = new Date(noonIst.getTime() + 24 * 60 * 60 * 1000);
  return getIstDateString(tomorrow);
}

/**
 * Converts YYYY-MM-DD + HH:mm (IST) into UTC epoch milliseconds.
 */
export function getIstTimestamp(dateStr: string, timeStr: string): number {
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr.trim().length === 5 ? timeStr.trim() : '00:00';
  const parsed = Date.parse(`${cleanDate}T${cleanTime}:00+05:30`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Computes match end epoch in ms (handles matches ending after midnight IST).
 */
export function getMatchEndTimestamp(match: Pick<CricketMatch, 'date' | 'startTime' | 'endTime'>): number {
  const startMs = getIstTimestamp(match.date, match.startTime);
  let endMs = getIstTimestamp(match.date, match.endTime);
  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000;
  }
  return endMs;
}

/**
 * Computes the auto-delete expiry epoch: 30 minutes after match end time.
 */
export function getMatchExpiryTimestamp(
  match: Pick<CricketMatch, 'date' | 'startTime' | 'endTime'>
): number {
  return getMatchEndTimestamp(match) + AUTO_DELETE_GRACE_MS;
}

/**
 * Checks whether a match has passed its 30-minute post-end auto-delete threshold.
 */
export function isMatchExpired(
  match: Pick<CricketMatch, 'date' | 'startTime' | 'endTime'>,
  nowMs: number = Date.now()
): boolean {
  const expiryMs = getMatchExpiryTimestamp(match);
  return expiryMs > 0 && nowMs >= expiryMs;
}

/**
 * Formats 24h HH:mm into "3:30 PM IST".
 */
export function formatIstTime(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return `${time24} IST`;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period} IST`;
}

/**
 * Formats YYYY-MM-DD into readable display date like "22 Nov 2026".
 */
export function formatDisplayDate(dateStr: string): string {
  const ms = getIstTimestamp(dateStr, '12:00');
  if (!ms) return dateStr;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ms));
}

/**
 * Formats an ISO timestamp into IST date/time for Audit Logs.
 */
export function formatAuditTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d) + ' IST'
  );
}

/**
 * Computes effective match status, respecting manual admin status while also reflecting live/finished timing.
 */
export function getEffectiveMatchStatus(match: CricketMatch, nowMs: number = Date.now()): MatchStatus {
  if (match.status === 'LIVE' || match.status === 'Finished') {
    return match.status;
  }
  const startMs = getIstTimestamp(match.date, match.startTime);
  const endMs = getMatchEndTimestamp(match);
  if (nowMs >= endMs) return 'Finished';
  if (nowMs >= startMs && nowMs < endMs) return 'LIVE';
  return 'Upcoming';
}

export interface CountdownParts {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isStarted: boolean;
}

export function getCountdownToStart(match: CricketMatch, nowMs: number = Date.now()): CountdownParts {
  const startMs = getIstTimestamp(match.date, match.startTime);
  const diff = startMs - nowMs;
  if (diff <= 0) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isStarted: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { totalMs: diff, days, hours, minutes, seconds, isStarted: false };
}

export function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

import type { CricketMatch, MatchStatus, MatchTopPerformer } from '../types/cricket';
import {
  formatDisplayDate,
  formatIstTime,
  getIstTimestamp,
  getMatchEndTimestamp,
} from './time';

export interface MatchPlayingXIData {
  teamA: string[];
  teamB: string[];
  hasAny: boolean;
}

export interface MatchResultData {
  resultText: string | null;
  playerOfTheMatch: string | null;
  topPerformers: string[];
  hasAny: boolean;
}

export interface MatchFaqItem {
  question: string;
  answer: string;
}

export interface MatchDetailRow {
  label: string;
  value: string;
}

/**
 * Removes all anchor links (`<a>...</a>`) from admin-authored match HTML while
 * preserving the visible inner text and non-link formatting so Match Page
 * content sections never contain external or internal links.
 */
export function stripLinksFromHtml(html: string): string {
  const raw = typeof html === 'string' ? html : '';
  if (!raw.trim()) return '';

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      const anchors = Array.from(doc.body.querySelectorAll('a'));
      anchors.forEach((anchor) => {
        const span = doc.createElement('span');
        while (anchor.firstChild) {
          span.appendChild(anchor.firstChild);
        }
        anchor.parentNode?.replaceChild(span, anchor);
      });
      return doc.body.innerHTML;
    } catch {
      // Fall through to regex fallback
    }
  }

  return raw.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
}

/**
 * Returns the explicit match format when set on the match record, or detects
 * an unambiguous format directly from the match's own tournament/matchNumber
 * text. Returns null when no format is explicitly indicated (never guesses).
 */
export function detectMatchFormat(
  match: Pick<CricketMatch, 'format' | 'tournament' | 'matchNumber'>
): string | null {
  if (typeof match.format === 'string' && match.format.trim()) {
    return match.format.trim();
  }

  const combined = `${match.matchNumber ?? ''} ${match.tournament ?? ''}`.trim();
  if (!combined) return null;

  if (/\bT20I\b/i.test(combined)) return 'T20 International (T20I)';
  if (/\bODI\b/i.test(combined)) return 'One-Day International (ODI)';
  if (/\bTest\b/i.test(combined)) return 'Test Match';
  if (/\bT10\b/i.test(combined)) return 'T10';
  if (/\bThe Hundred\b|\b100-ball\b/i.test(combined)) return 'The Hundred (100-ball)';
  if (
    /\bT20\b|\bWBBL\b|\bBBL\b|\bBig Bash\b|\bIPL\b|\bWPL\b|\bPSL\b|\bCPL\b|\bILT20\b|\bSA20\b|\bMLC\b|\bSuper Smash\b|\bVitality Blast\b/i.test(
      combined
    )
  ) {
    return 'T20';
  }
  if (/\bList\s*A\b|\bOne-Day\b|\bOne Day\b|\bVijay Hazare\b/i.test(combined)) {
    return 'One-Day (List A)';
  }
  if (
    /\bFirst-Class\b|\bFirst Class\b|\bRanji Trophy\b|\bDuleep Trophy\b|\bSheffield Shield\b|\bCounty Championship\b|\bPlunket Shield\b/i.test(
      combined
    )
  ) {
    return 'First-Class';
  }

  return null;
}

/**
 * Extracts real Playing XI player arrays from the match document if present.
 * Never invents players.
 */
export function getMatchPlayingXI(match: CricketMatch): MatchPlayingXIData {
  const cleanList = (arr?: string[]): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

  const teamA = cleanList(match.playingXI?.teamA ?? match.playingXiTeamA);
  const teamB = cleanList(match.playingXI?.teamB ?? match.playingXiTeamB);

  return {
    teamA,
    teamB,
    hasAny: teamA.length > 0 || teamB.length > 0,
  };
}

/**
 * Extracts real post-match result & top-performer records if present.
 * Never invents results or performances.
 */
export function getMatchResultInfo(match: CricketMatch): MatchResultData {
  const resultText =
    typeof match.result === 'string' && match.result.trim() ? match.result.trim() : null;
  const playerOfTheMatch =
    typeof match.playerOfTheMatch === 'string' && match.playerOfTheMatch.trim()
      ? match.playerOfTheMatch.trim()
      : null;

  const topPerformers: string[] = [];
  if (Array.isArray(match.topPerformers)) {
    match.topPerformers.forEach((entry) => {
      if (typeof entry === 'string') {
        const cleaned = entry.trim();
        if (cleaned) topPerformers.push(cleaned);
      } else if (entry && typeof entry === 'object') {
        const obj = entry as MatchTopPerformer;
        const player = typeof obj.player === 'string' ? obj.player.trim() : '';
        const perf = typeof obj.performance === 'string' ? obj.performance.trim() : '';
        const team = typeof obj.team === 'string' ? obj.team.trim() : '';
        if (player && perf) {
          topPerformers.push(team ? `${player} (${team}) — ${perf}` : `${player} — ${perf}`);
        } else if (player) {
          topPerformers.push(player);
        }
      }
    });
  }

  return {
    resultText,
    playerOfTheMatch,
    topPerformers,
    hasAny: Boolean(resultText || playerOfTheMatch || topPerformers.length > 0),
  };
}

function formatChannelNamesList(names: string[]): string {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

function getScheduledDurationLabel(match: CricketMatch): string | null {
  const startMs = getIstTimestamp(match.date, match.startTime);
  const endMs = getMatchEndTimestamp(match);
  if (startMs <= 0 || endMs <= startMs) return null;
  const diffMin = Math.round((endMs - startMs) / 60000);
  if (diffMin < 30 || diffMin > 16 * 60) return null;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${mins} minutes`;
}

/**
 * Formats an IST epoch timestamp (ms) into a strict ISO-8601 string with
 * +05:30 offset (e.g., "2026-11-25T19:30:00+05:30") for Schema.org JSON-LD.
 */
export function formatEpochAsIstIso(epochMs: number): string | null {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));

  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = map.get('year');
  const month = map.get('month');
  const day = map.get('day');
  const hour = map.get('hour');
  const minute = map.get('minute');
  const second = map.get('second');
  if (!year || !month || !day || !hour || !minute || !second) return null;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
}

/**
 * Builds unique, factual Match Preview prose paragraphs strictly from this
 * match's own data fields (series, match number, teams, format, venue, IST
 * date/time, current status, and assigned broadcast channel names in plain text).
 */
export function buildMatchPreviewParagraphs(
  match: CricketMatch,
  effectiveStatus: MatchStatus,
  format: string | null,
  assignedChannelNames: string[]
): string[] {
  const paragraphs: string[] = [];
  const teamA = match.teamA.trim();
  const teamB = match.teamB.trim();
  const tournament = match.tournament?.trim() || '';
  const matchNumber = match.matchNumber?.trim() || '';
  const venue = match.venue?.trim() || '';
  const displayDate = match.date ? formatDisplayDate(match.date) : '';
  const startIst = match.startTime ? formatIstTime(match.startTime) : '';
  const endIst = match.endTime ? formatIstTime(match.endTime) : '';
  const durationLabel = getScheduledDurationLabel(match);
  const channelText = formatChannelNamesList(assignedChannelNames);

  // Paragraph 1: Matchup, series/fixture context, format, venue, and IST date/start time.
  const p1Parts: string[] = [];
  if (tournament && matchNumber) {
    p1Parts.push(
      `${teamA} take on ${teamB} in ${matchNumber} of ${tournament}${
        format ? ` (${format})` : ''
      }.`
    );
  } else if (tournament) {
    p1Parts.push(
      `${teamA} face ${teamB} in ${tournament}${format ? ` (${format})` : ''}.`
    );
  } else if (matchNumber) {
    p1Parts.push(
      `${teamA} meet ${teamB} in ${matchNumber}${format ? ` (${format})` : ''}.`
    );
  } else {
    p1Parts.push(
      `${teamA} and ${teamB} meet in this scheduled${format ? ` ${format}` : ''} cricket fixture.`
    );
  }

  if (displayDate && startIst && venue) {
    p1Parts.push(
      `The contest is scheduled for ${displayDate} at ${venue}, with play set to begin at ${startIst}.`
    );
  } else if (displayDate && startIst) {
    p1Parts.push(`The match is scheduled for ${displayDate}, starting at ${startIst}.`);
  } else if (venue && displayDate) {
    p1Parts.push(`The match takes place at ${venue} on ${displayDate}.`);
  } else if (venue) {
    p1Parts.push(`The fixture is hosted at ${venue}.`);
  }

  paragraphs.push(p1Parts.join(' '));

  // Paragraph 2: IST timing window, current match status context, and plain-text broadcast info.
  const p2Parts: string[] = [];
  if (startIst && endIst) {
    p2Parts.push(
      `In Indian Standard Time (IST), the scheduled match window runs from ${startIst} to ${endIst}${
        durationLabel ? ` (approximately ${durationLabel})` : ''
      }.`
    );
  }

  if (effectiveStatus === 'LIVE') {
    p2Parts.push(
      `${teamA} vs ${teamB} is currently live${venue ? ` at ${venue}` : ''}.`
    );
  } else if (effectiveStatus === 'Finished') {
    p2Parts.push(
      `This scheduled ${tournament || 'fixture'} meeting between ${teamA} and ${teamB} has concluded.`
    );
  } else if (startIst) {
    p2Parts.push(
      `Confirmed Playing XI lineups and toss updates for ${teamA} and ${teamB} are finalized ahead of the ${startIst} start.`
    );
  }

  if (channelText) {
    p2Parts.push(
      `Scheduled broadcast coverage for this fixture is listed on ${channelText}.`
    );
  }

  if (p2Parts.length > 0) {
    paragraphs.push(p2Parts.join(' '));
  }

  return paragraphs;
}

/**
 * Builds structured Match Details rows strictly from existing match fields.
 */
export function buildMatchDetailsRows(
  match: CricketMatch,
  effectiveStatus: MatchStatus,
  format: string | null,
  assignedChannelNames: string[]
): MatchDetailRow[] {
  const rows: MatchDetailRow[] = [
    { label: 'Teams', value: `${match.teamA} vs ${match.teamB}` },
  ];

  if (match.tournament?.trim()) {
    rows.push({ label: 'Series', value: match.tournament.trim() });
  }
  if (match.matchNumber?.trim()) {
    rows.push({ label: 'Match', value: match.matchNumber.trim() });
  }
  if (format) {
    rows.push({ label: 'Format', value: format });
  }
  if (match.date?.trim()) {
    rows.push({ label: 'Date (IST)', value: formatDisplayDate(match.date) });
  }
  if (match.startTime?.trim()) {
    const timingValue = match.endTime?.trim()
      ? `${formatIstTime(match.startTime)} – ${formatIstTime(match.endTime)}`
      : formatIstTime(match.startTime);
    rows.push({ label: 'Time (IST)', value: timingValue });
  }
  if (match.venue?.trim()) {
    rows.push({ label: 'Venue', value: match.venue.trim() });
  }

  rows.push({ label: 'Status', value: effectiveStatus });

  const channelText = formatChannelNamesList(assignedChannelNames);
  if (channelText) {
    rows.push({ label: 'Broadcast Channel', value: channelText });
  }

  return rows;
}

/**
 * Builds plain-text FAQs strictly from this match's own data (zero links).
 */
export function buildMatchFaqs(
  match: CricketMatch,
  format: string | null,
  assignedChannelNames: string[]
): MatchFaqItem[] {
  const teamA = match.teamA.trim();
  const teamB = match.teamB.trim();
  const tournament = match.tournament?.trim() || '';
  const matchNumber = match.matchNumber?.trim() || '';
  const venue = match.venue?.trim() || '';
  const displayDate = match.date ? formatDisplayDate(match.date) : '';
  const startIst = match.startTime ? formatIstTime(match.startTime) : '';
  const endIst = match.endTime ? formatIstTime(match.endTime) : '';
  const channelText = formatChannelNamesList(assignedChannelNames);

  const faqs: MatchFaqItem[] = [];

  if (displayDate && startIst) {
    const windowNote = endIst
      ? ` The scheduled match window runs from ${startIst} to ${endIst}.`
      : '';
    faqs.push({
      question: `When is the ${teamA} vs ${teamB} match?`,
      answer: `${teamA} vs ${teamB}${tournament ? ` (${tournament})` : ''} is scheduled for ${displayDate}, starting at ${startIst}.${windowNote}`,
    });
  } else if (displayDate) {
    faqs.push({
      question: `When is the ${teamA} vs ${teamB} match?`,
      answer: `${teamA} vs ${teamB}${tournament ? ` (${tournament})` : ''} is scheduled for ${displayDate} (IST).`,
    });
  }

  if (venue) {
    faqs.push({
      question: `Where is ${teamA} vs ${teamB} being played?`,
      answer: `${teamA} vs ${teamB}${matchNumber ? ` (${matchNumber})` : ''} is being played at ${venue}.`,
    });
  }

  faqs.push({
    question: `Which channel is broadcasting ${teamA} vs ${teamB}?`,
    answer: channelText
      ? `${teamA} vs ${teamB} is scheduled to be broadcast on ${channelText}.`
      : `Broadcast channel information for ${teamA} vs ${teamB} has not been announced yet.`,
  });

  if (format) {
    faqs.push({
      question: `What format is ${teamA} vs ${teamB}?`,
      answer: `${teamA} vs ${teamB}${tournament ? ` in ${tournament}` : ''} is a ${format} fixture.`,
    });
  }

  return faqs;
}

/**
 * Builds valid Schema.org SportsEvent JSON-LD structured data for a match page.
 */
export function buildMatchSportsEventJsonLd(
  match: CricketMatch,
  effectiveStatus: MatchStatus,
  format: string | null
): Record<string, unknown> {
  const teamA = match.teamA.trim();
  const teamB = match.teamB.trim();
  const tournament = match.tournament?.trim() || '';
  const matchNumber = match.matchNumber?.trim() || '';
  const venue = match.venue?.trim() || '';

  const nameParts = [`${teamA} vs ${teamB}`];
  if (tournament && matchNumber) {
    nameParts.push(`${tournament}, ${matchNumber}`);
  } else if (tournament) {
    nameParts.push(tournament);
  } else if (matchNumber) {
    nameParts.push(matchNumber);
  }

  const startMs = getIstTimestamp(match.date, match.startTime);
  const endMs = getMatchEndTimestamp(match);
  const startDateIso = formatEpochAsIstIso(startMs);
  const endDateIso = endMs > startMs ? formatEpochAsIstIso(endMs) : null;

  const homeTeam = {
    '@type': 'SportsTeam',
    name: teamA,
  };
  const awayTeam = {
    '@type': 'SportsTeam',
    name: teamB,
  };

  const descriptionParts: string[] = [
    `${teamA} vs ${teamB}${tournament ? ` in ${tournament}` : ''}${format ? ` (${format})` : ''}`,
  ];
  if (match.date && match.startTime) {
    descriptionParts.push(`on ${formatDisplayDate(match.date)} at ${formatIstTime(match.startTime)}`);
  }
  if (venue) {
    descriptionParts.push(`at ${venue}`);
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: nameParts.join(' — '),
    sport: 'Cricket',
    description: `${descriptionParts.join(' ')}.`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    homeTeam,
    awayTeam,
    competitor: [homeTeam, awayTeam],
  };

  if (startDateIso) {
    jsonLd.startDate = startDateIso;
  }
  if (endDateIso) {
    jsonLd.endDate = endDateIso;
  }

  if (venue) {
    const venueParts = venue.split(',').map((p) => p.trim()).filter(Boolean);
    jsonLd.location = {
      '@type': 'Place',
      name: venueParts[0] || venue,
      address: venue,
    };
  }

  const organizerName = match.organizer?.trim() || tournament;
  if (organizerName) {
    jsonLd.organizer = {
      '@type': 'Organization',
      name: organizerName,
    };
  }

  // Keep effectiveStatus referenced cleanly (all valid scheduled/live/completed matches use EventScheduled).
  void effectiveStatus;

  return jsonLd;
}

/**
 * Safely serializes JSON-LD so `<` characters can never break out of a <script> tag.
 */
export function serializeJsonLdSafe(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * Builds a concise, unique SEO page title and meta description for a match page.
 */
export function buildMatchPageMeta(
  match: CricketMatch,
  format: string | null
): { title: string; description: string } {
  const teamA = match.teamA.trim();
  const teamB = match.teamB.trim();
  const tournament = match.tournament?.trim() || '';
  const venue = match.venue?.trim() || '';
  const displayDate = match.date ? formatDisplayDate(match.date) : '';
  const startIst = match.startTime ? formatIstTime(match.startTime) : '';

  const title = tournament
    ? `${teamA} vs ${teamB} — ${tournament} | Cricket Live Schedule`
    : `${teamA} vs ${teamB} | Cricket Live Schedule`;

  const descParts: string[] = [
    `${teamA} vs ${teamB}${tournament ? ` (${tournament})` : ''}${format ? ` ${format}` : ''} match preview, details, Playing XI, and FAQs.`,
  ];
  if (displayDate && startIst) {
    descParts.push(
      `Scheduled for ${displayDate} at ${startIst}${venue ? ` at ${venue}` : ''}.`
    );
  } else if (venue) {
    descParts.push(`Played at ${venue}.`);
  }

  return {
    title,
    description: descParts.join(' '),
  };
}

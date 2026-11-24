import {
  findCountryCodeByName,
  getCountryFlagUrl,
  isWestIndiesTeam,
} from './countries';

/**
 * Fallback exact national team name -> flagcdn.com w80 PNG URL mapping,
 * derived from the single-source COUNTRIES list (plus USA/UAE/UK aliases).
 * Always returns null for West Indies and non-country team names.
 */
export function getTeamFlagUrl(teamName: string): string | null {
  if (!teamName || typeof teamName !== 'string' || isWestIndiesTeam(teamName)) {
    return null;
  }
  const code = findCountryCodeByName(teamName);
  return getCountryFlagUrl(code);
}

const NATIONAL_SQUAD_SUFFIX_RE = /\s+(?:women|men|a|u-?19|under-?19)$/i;

/**
 * Backfill helper for existing Firestore matches missing countryCodeA / countryCodeB.
 * Rules:
 *  - Never set a code for West Indies.
 *  - Match national team names against COUNTRIES (including Women/Men/A/U19 squads).
 *  - League defaults by tournament or team name:
 *      - ILT20 -> ae
 *      - WBBL -> au
 *      - Inter-Zonal or any team name containing 'Zone' -> in
 *  - Return null if no rule applies (no guessing).
 */
export function resolveBackfillCountryCode(
  teamName: string,
  tournament: string
): string | null {
  if (!teamName || typeof teamName !== 'string') return null;
  if (isWestIndiesTeam(teamName)) return null;

  const trimmedName = teamName.trim();
  const lowerName = trimmedName.toLowerCase();
  const lowerTournament = (tournament || '').trim().toLowerCase();

  // 1. Direct national team match against COUNTRIES
  const directCode = findCountryCodeByName(trimmedName);
  if (directCode) return directCode;

  // 2. National squad suffix match (e.g. "India Women", "South Africa Women", "Australia A")
  const strippedBase = trimmedName.replace(NATIONAL_SQUAD_SUFFIX_RE, '').trim();
  if (strippedBase && strippedBase !== trimmedName) {
    const baseCode = findCountryCodeByName(strippedBase);
    if (baseCode) return baseCode;
  }

  // 3. League defaults by tournament or team name
  if (
    lowerTournament.includes('inter-zonal') ||
    lowerTournament.includes('inter zonal') ||
    lowerName.includes('zone')
  ) {
    return 'in';
  }

  if (
    lowerTournament.includes('wbbl') ||
    lowerTournament.includes("women's big bash") ||
    lowerTournament.includes('womens big bash') ||
    lowerTournament.includes('big bash') ||
    lowerName.includes('wbbl')
  ) {
    return 'au';
  }

  if (
    lowerTournament.includes('ilt20') ||
    lowerTournament.includes('international league t20') ||
    lowerName.includes('ilt20')
  ) {
    return 'ae';
  }

  return null;
}

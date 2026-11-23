/**
 * Exact national team name -> flagcdn.com ISO code mapping.
 * Returns null for any team not in this exact allowlist (e.g., West Indies,
 * franchise teams, WBBL teams, Inter-Zonal teams).
 */
const TEAM_FLAG_CODES = new Map<string, string>([
  ['india', 'in'],
  ['pakistan', 'pk'],
  ['bangladesh', 'bd'],
  ['sri lanka', 'lk'],
  ['australia', 'au'],
  ['new zealand', 'nz'],
  ['south africa', 'za'],
  ['england', 'gb-eng'],
  ['afghanistan', 'af'],
  ['zimbabwe', 'zw'],
  ['ireland', 'ie'],
  ['netherlands', 'nl'],
  ['scotland', 'gb-sct'],
  ['nepal', 'np'],
  ['united states', 'us'],
  ['usa', 'us'],
  ['canada', 'ca'],
  ['united arab emirates', 'ae'],
  ['uae', 'ae'],
  ['oman', 'om'],
  ['namibia', 'na'],
  ['kenya', 'ke'],
  ['papua new guinea', 'pg'],
]);

/**
 * Returns the flagcdn.com w80 PNG URL for an exact national team name
 * (trimmed, case-insensitive), or null if the team is not in the map.
 */
export function getTeamFlagUrl(teamName: string): string | null {
  if (!teamName || typeof teamName !== 'string') return null;
  const code = TEAM_FLAG_CODES.get(teamName.trim().toLowerCase());
  if (!code) return null;
  return `https://flagcdn.com/w80/${code}.png`;
}

import { useEffect, useState } from 'react';
import { getCountryFlagUrl, isWestIndiesTeam } from '../lib/countries';
import { getTeamFlagUrl } from '../lib/teamFlags';

interface TeamNameWithFlagProps {
  teamName: string;
  countryCode?: string;
}

/**
 * Renders a country flag image immediately to the left of a team name.
 * Uses the match's stored ISO countryCode when provided; otherwise falls back to
 * exact national team lookup via getTeamFlagUrl(teamName).
 * Never renders a flag for West Indies or when no code/fallback exists, and hides
 * cleanly on image load error.
 */
export function TeamNameWithFlag({ teamName, countryCode }: TeamNameWithFlagProps) {
  const flagUrl = isWestIndiesTeam(teamName)
    ? null
    : (getCountryFlagUrl(countryCode) ?? getTeamFlagUrl(teamName));

  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [flagUrl]);

  if (!flagUrl || imgError) {
    return <span>{teamName}</span>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      <img
        src={flagUrl}
        alt={`${teamName} flag`}
        loading="lazy"
        onError={() => setImgError(true)}
        className="w-[30px] h-auto shrink-0 rounded-sm border border-slate-200 ring-1 ring-slate-900/5 object-cover"
      />
      <span>{teamName}</span>
    </span>
  );
}

import { useEffect, useState } from 'react';
import { getTeamFlagUrl } from '../lib/teamFlags';

interface TeamNameWithFlagProps {
  teamName: string;
}

/**
 * Renders a country flag image immediately to the left of an exact national team name.
 * For non-mapped teams (franchise, WBBL, zonal, West Indies) or on image load error,
 * renders only the team name cleanly.
 */
export function TeamNameWithFlag({ teamName }: TeamNameWithFlagProps) {
  const flagUrl = getTeamFlagUrl(teamName);
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

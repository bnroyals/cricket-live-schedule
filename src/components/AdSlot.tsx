export type AdSlotPosition = 'home-top' | 'home-mid' | 'watch-player-top';

export interface AdSlotProps {
  positionId: AdSlotPosition;
}

/**
 * Reserved placeholder for future Adsterra banner/native ad placements.
 * Plug Adsterra rendering logic in here later keyed by `positionId` so page
 * layouts do not need to change. Intentionally renders nothing and loads
 * no ad scripts or network requests until Adsterra is connected.
 */
export function AdSlot({ positionId }: AdSlotProps): null {
  void positionId;
  return null;
}

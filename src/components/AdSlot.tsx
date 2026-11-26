import { useEffect, useRef } from 'react';
import type { AdSlotPosition } from '../types/cricket';
import { isAdSlotActive } from '../lib/adSlots';
import { useAdSettings } from '../lib/adContext';

export type { AdSlotPosition };

export interface AdSlotProps {
  positionId: AdSlotPosition;
}

/**
 * Live Firestore-backed banner ad slot keyed by `positionId`.
 * Renders NOTHING (zero wrapper, zero empty box, zero placeholder text, zero scripts)
 * whenever the slot is switched off or has no ad code.
 */
export function AdSlot({ positionId }: AdSlotProps) {
  const settings = useAdSettings();
  const slot = settings[positionId];
  const active = isAdSlotActive(slot);
  const code = active ? slot.code.trim() : '';
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!active || !code) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = code;

    // Re-create script tags so pasted ad-network <script> snippets execute cleanly.
    const scripts = Array.from(container.querySelectorAll('script'));
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      if (oldScript.textContent) {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.parentNode?.replaceChild(newScript, oldScript);
    });

    return () => {
      container.innerHTML = '';
    };
  }, [active, code]);

  if (!active) {
    return null;
  }

  if (positionId === 'sticky-bottom-banner') {
    return (
      <div
        data-ad-slot={positionId}
        className="fixed bottom-14 sm:bottom-0 left-0 right-0 z-30 flex justify-center px-2 py-1.5 pointer-events-none"
      >
        <div
          ref={containerRef}
          className="pointer-events-auto max-w-full overflow-x-auto"
        />
      </div>
    );
  }

  return (
    <div
      data-ad-slot={positionId}
      className="my-4 w-full flex justify-center overflow-x-auto"
    >
      <div ref={containerRef} className="max-w-full" />
    </div>
  );
}

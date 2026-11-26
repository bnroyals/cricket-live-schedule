import { useEffect, useRef } from 'react';
import type { SiteWideAdSlotId } from '../types/cricket';
import { isAdSlotActive } from '../lib/adSlots';
import { useAdSettings } from '../lib/adContext';

function SiteWideScriptRunner({ slotId }: { slotId: SiteWideAdSlotId }) {
  const settings = useAdSettings();
  const slot = settings[slotId];
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

  return <div ref={containerRef} data-sitewide-ad={slotId} />;
}

/**
 * Loads site-wide scripts (Social Bar, and optional Popunder ONLY if explicitly
 * enabled with non-empty code in Firestore). Renders nothing and loads no
 * scripts when disabled or empty. Mounted only inside PublicLayout (never Admin).
 */
export function SiteWideAds() {
  return (
    <>
      <SiteWideScriptRunner slotId="social-bar" />
      <SiteWideScriptRunner slotId="popunder" />
    </>
  );
}

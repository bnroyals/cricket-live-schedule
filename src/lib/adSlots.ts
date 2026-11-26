import type { AdSettingsMap, AdSlotConfig, AdSlotId } from '../types/cricket';

export type AdSlotGroup = 'home' | 'match' | 'watch' | 'footer' | 'sitewide';

export interface AdSlotDefinition {
  id: AdSlotId;
  label: string;
  group: AdSlotGroup;
  description: string;
}

export const AD_SLOT_DEFINITIONS: AdSlotDefinition[] = [
  // HOME page banner slots
  {
    id: 'home-top',
    label: 'Home Top',
    group: 'home',
    description: 'Banner placement at the top of the Home / Schedule page.',
  },
  {
    id: 'home-mid',
    label: 'Home Mid',
    group: 'home',
    description: 'Banner placement between the date filters and match schedule on Home.',
  },
  {
    id: 'after-each-date-group',
    label: 'After Each Date Group',
    group: 'home',
    description: 'Renders one banner slot after each date group in the Home schedule.',
  },
  {
    id: 'home-bottom',
    label: 'Home Bottom',
    group: 'home',
    description: 'Banner placement below the schedule on the Home page.',
  },
  {
    id: 'sticky-bottom-banner',
    label: 'Sticky Bottom Banner',
    group: 'home',
    description: 'Fixed sticky banner along the bottom of the Home page viewport.',
  },

  // MATCH page banner slots
  {
    id: 'match-top',
    label: 'Match Top',
    group: 'match',
    description: 'Banner placement above the match title on Match pages.',
  },
  {
    id: 'watch-player-top',
    label: 'Watch Player Top',
    group: 'match',
    description: 'Banner placement above the Watch button / player area.',
  },
  {
    id: 'watch-player-bottom',
    label: 'Watch Player Bottom',
    group: 'match',
    description: 'Banner placement below the Watch button / player area.',
  },
  {
    id: 'after-match-preview',
    label: 'After Match Preview',
    group: 'match',
    description: 'Banner placement directly after the Match Preview section.',
  },
  {
    id: 'after-match-details',
    label: 'After Match Details',
    group: 'match',
    description: 'Banner placement directly after the Match Details section.',
  },
  {
    id: 'after-playing-xi',
    label: 'After Playing XI',
    group: 'match',
    description: 'Banner placement directly after the Playing XI section.',
  },
  {
    id: 'after-result',
    label: 'After Result',
    group: 'match',
    description: 'Banner placement directly after the Result section.',
  },
  {
    id: 'match-bottom',
    label: 'Match Bottom',
    group: 'match',
    description: 'Banner placement after the FAQs section at the bottom of Match pages.',
  },

  // WATCH / Channel page banner slots
  {
    id: 'watch-above-player',
    label: 'Watch Above Player',
    group: 'watch',
    description: 'Banner placement directly above the stream player on the Watch / Channel view.',
  },
  {
    id: 'watch-below-player',
    label: 'Watch Below Player',
    group: 'watch',
    description: 'Banner placement directly below the stream player on the Watch / Channel view.',
  },

  // FOOTER banner slots
  {
    id: 'footer-top',
    label: 'Footer Top',
    group: 'footer',
    description: 'Full-width banner placement directly above the site footer.',
  },
  {
    id: 'footer-mid',
    label: 'Footer Mid',
    group: 'footer',
    description: 'Banner placement between the two text blocks inside the site footer.',
  },
  {
    id: 'footer-bottom',
    label: 'Footer Bottom',
    group: 'footer',
    description: 'Full-width banner placement directly below the site footer.',
  },

  // Site-wide script slots
  {
    id: 'social-bar',
    label: 'Social Bar',
    group: 'sitewide',
    description: 'Site-wide Social Bar script. Loaded on public pages only when switched ON and code is pasted.',
  },
  {
    id: 'popunder',
    label: 'Popunder (Optional)',
    group: 'sitewide',
    description: 'Optional site-wide Popunder slot. Switched OFF with no code by default; nothing runs unless turned ON with code later.',
  },
];

export const ALL_AD_SLOT_IDS: AdSlotId[] = AD_SLOT_DEFINITIONS.map((def) => def.id);

export function createDefaultAdSettings(): AdSettingsMap {
  const settings = {} as AdSettingsMap;
  for (const id of ALL_AD_SLOT_IDS) {
    settings[id] = { enabled: false, code: '' };
  }
  return settings;
}

export function normalizeAdSettings(raw: unknown): AdSettingsMap {
  const result = createDefaultAdSettings();
  if (!raw || typeof raw !== 'object') return result;

  const container =
    'slots' in raw && raw.slots && typeof raw.slots === 'object'
      ? (raw.slots as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  for (const id of ALL_AD_SLOT_IDS) {
    const entry = container[id];
    if (entry && typeof entry === 'object') {
      const obj = entry as Partial<AdSlotConfig>;
      result[id] = {
        enabled: obj.enabled === true,
        code: typeof obj.code === 'string' ? obj.code : '',
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
      };
    }
  }

  return result;
}

export function isAdSlotActive(slot?: AdSlotConfig | null): boolean {
  return Boolean(slot && slot.enabled === true && typeof slot.code === 'string' && slot.code.trim().length > 0);
}

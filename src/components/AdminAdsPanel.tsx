import { useEffect, useState } from 'react';
import { Check, Megaphone, Trash2 } from 'lucide-react';
import type { AdSettingsMap, AdSlotId, AdminSession } from '../types/cricket';
import {
  AD_SLOT_DEFINITIONS,
  isAdSlotActive,
  type AdSlotDefinition,
  type AdSlotGroup,
} from '../lib/adSlots';
import { adminSaveAdSlot } from '../lib/storage';

interface AdminAdsPanelProps {
  session: AdminSession | null;
  adSettings: AdSettingsMap;
  onFeedback: (feedback: { type: 'success' | 'error'; text: string }) => void;
  onSaved: () => void;
}

const BANNER_GROUPS: Array<{ group: AdSlotGroup; title: string; subtitle: string }> = [
  {
    group: 'home',
    title: 'Home Page Slots',
    subtitle: 'Banner placements on the Home / Schedule page.',
  },
  {
    group: 'match',
    title: 'Match Page Slots',
    subtitle: 'Banner placements on individual Match pages.',
  },
  {
    group: 'watch',
    title: 'Watch / Channel Page Slots',
    subtitle: 'Banner placements above and below the stream player.',
  },
  {
    group: 'footer',
    title: 'Footer Slots',
    subtitle: 'Banner placements directly above, inside, and below the site footer.',
  },
];

export function AdminAdsPanel({
  session,
  adSettings,
  onFeedback,
  onSaved,
}: AdminAdsPanelProps) {
  const [drafts, setDrafts] = useState<AdSettingsMap>(() => adSettings);
  const [savingId, setSavingId] = useState<AdSlotId | null>(null);

  // Keep local drafts synced whenever Firestore ad settings update.
  useEffect(() => {
    setDrafts(adSettings);
  }, [adSettings]);

  const handleSaveSlot = async (
    slotId: AdSlotId,
    nextEnabled: boolean,
    nextCode: string,
    label: string
  ) => {
    setSavingId(slotId);
    try {
      const res = await adminSaveAdSlot(session, slotId, {
        enabled: nextEnabled,
        code: nextCode,
      });
      if (!res.ok) {
        onFeedback({ type: 'error', text: res.error || `Unable to save ${label}.` });
        return;
      }
      onFeedback({
        type: 'success',
        text: `${label} (${slotId}) saved live to Firestore — ${
          nextEnabled && nextCode.trim() ? 'ON and active' : 'OFF / inactive'
        }.`,
      });
      onSaved();
    } catch (err) {
      onFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : `Unable to save ${label}.`,
      });
    } finally {
      setSavingId(null);
    }
  };

  const renderSlotCard = (def: AdSlotDefinition) => {
    const saved = adSettings[def.id];
    const draft = drafts[def.id] ?? { enabled: false, code: '' };
    const isSaving = savingId === def.id;
    const isDirty = draft.code !== saved.code || draft.enabled !== saved.enabled;
    const isLiveActive = isAdSlotActive(saved);

    return (
      <div
        key={def.id}
        className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5 space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">{def.label}</h3>
              <code className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] font-mono-tabular text-slate-700">
                {def.id}
              </code>
              <span
                className={`text-[11px] font-bold ${
                  isLiveActive ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {isLiveActive ? 'Live' : 'Off'}
              </span>
              {isDirty && (
                <span className="text-[11px] font-semibold text-amber-700">
                  Unsaved changes
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-1">{def.description}</p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            aria-label={`Toggle ${def.label}`}
            disabled={isSaving}
            onClick={() => {
              const nextEnabled = !draft.enabled;
              setDrafts((prev) => ({
                ...prev,
                [def.id]: { ...draft, enabled: nextEnabled },
              }));
              void handleSaveSlot(def.id, nextEnabled, draft.code, def.label);
            }}
            className={`inline-flex items-center gap-2 min-h-[38px] px-3.5 py-1.5 rounded-lg border text-xs font-bold transition-colors shrink-0 disabled:opacity-60 ${
              draft.enabled
                ? 'bg-emerald-700 border-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span>{draft.enabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div>
          <label
            htmlFor={`ad-slot-code-${def.id}`}
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Ad Code (HTML / Script)
          </label>
          <textarea
            id={`ad-slot-code-${def.id}`}
            rows={4}
            spellCheck={false}
            value={draft.code}
            onChange={(e) =>
              setDrafts((prev) => ({
                ...prev,
                [def.id]: { ...draft, code: e.target.value },
              }))
            }
            placeholder="Paste ad code here. Leave empty or switch OFF to render nothing."
            className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-xs font-mono-tabular text-slate-900 focus:border-emerald-600 focus:outline-none resize-y"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 font-mono-tabular">
            {draft.code.trim().length} chars
          </span>
          <div className="flex items-center gap-2">
            {(draft.code.length > 0 || draft.enabled) && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setDrafts((prev) => ({
                    ...prev,
                    [def.id]: { enabled: false, code: '' },
                  }));
                  void handleSaveSlot(def.id, false, '', def.label);
                }}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 disabled:opacity-60 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Clear &amp; Disable</span>
              </button>
            )}
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSaveSlot(def.id, draft.enabled, draft.code, def.label)}
              className="min-h-[38px] px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSaving ? 'Saving...' : 'Save Slot'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const siteWideSlots = AD_SLOT_DEFINITIONS.filter((def) => def.group === 'sitewide');

  return (
    <div className="mt-6 space-y-6">
      {/* Banner Ad Placements */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <span>Banner Ad Placements</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Toggle each named slot ON/OFF and paste ad code. Changes save live to Firestore with no rebuild. Empty or OFF slots render nothing on the public site.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-8">
          {BANNER_GROUPS.map(({ group, title, subtitle }) => {
            const slots = AD_SLOT_DEFINITIONS.filter((def) => def.group === group);
            return (
              <div key={group} className="space-y-3">
                <div className="border-b border-slate-200 pb-2">
                  <h3 className="text-base font-bold text-slate-900">{title}</h3>
                  <p className="text-xs text-slate-500">{subtitle}</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {slots.map(renderSlotCard)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Site-Wide Code Boxes (Separate Section) */}
      <section className="rounded-2xl bg-white border border-slate-200 shadow-xs p-5 sm:p-6">
        <div className="pb-4 border-b border-slate-200">
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Site-Wide Code Boxes
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Scripts loaded across public pages only when switched ON AND code is present. Never runs inside the Admin Panel. Popunder is switched OFF with no code by default.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {siteWideSlots.map(renderSlotCard)}
        </div>
      </section>
    </div>
  );
}

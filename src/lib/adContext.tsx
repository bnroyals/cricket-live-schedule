import React, { createContext, useContext } from 'react';
import type { AdSettingsMap } from '../types/cricket';
import { createDefaultAdSettings } from './adSlots';

const AdSettingsContext = createContext<AdSettingsMap>(createDefaultAdSettings());

export function AdSettingsProvider({
  settings,
  children,
}: {
  settings: AdSettingsMap;
  children: React.ReactNode;
}) {
  return (
    <AdSettingsContext.Provider value={settings}>
      {children}
    </AdSettingsContext.Provider>
  );
}

export function useAdSettings(): AdSettingsMap {
  return useContext(AdSettingsContext);
}

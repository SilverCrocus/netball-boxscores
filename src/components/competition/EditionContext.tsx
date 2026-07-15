'use client';

import { createContext, useContext } from 'react';
import type { EditionContextValue } from '@/lib/edition-context';

interface EditionContextState {
  current: EditionContextValue;
  editions: EditionContextValue[];
}

const EditionContext = createContext<EditionContextState | null>(null);

export function EditionContextProvider({
  value,
  children,
}: {
  value: EditionContextState;
  children: React.ReactNode;
}) {
  return <EditionContext.Provider value={value}>{children}</EditionContext.Provider>;
}

export function useEditionContext(): EditionContextState {
  const context = useContext(EditionContext);
  if (!context) {
    throw new Error('useEditionContext must be used inside EditionContextProvider');
  }
  return context;
}

"use client";

import { createContext, useContext, useState, useCallback } from "react";

export type DraftTone = "casual" | "warm" | "professional" | "congratulatory" | "checking_in";
export type DraftContext = "reply_email" | "catching_up" | "congratulate" | "ask" | "follow_up";

export interface DraftComposerState {
  readonly isOpen: boolean;
  readonly contactId?: string;
  readonly presetTone?: DraftTone;
  readonly presetContext?: DraftContext;
  readonly threadSubject?: string;
  readonly threadSnippet?: string;
}

interface DraftComposerActions {
  openComposer: (opts?: Partial<Omit<DraftComposerState, "isOpen">>) => void;
  closeComposer: () => void;
}

const initialState: DraftComposerState = { isOpen: false };

const DraftComposerCtx = createContext<(DraftComposerState & DraftComposerActions) | null>(null);

export function DraftComposerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DraftComposerState>(initialState);

  const openComposer = useCallback((opts: Partial<Omit<DraftComposerState, "isOpen">> = {}) => {
    setState({ isOpen: true, ...opts });
  }, []);

  const closeComposer = useCallback(() => {
    setState(initialState);
  }, []);

  return (
    <DraftComposerCtx.Provider value={{ ...state, openComposer, closeComposer }}>
      {children}
    </DraftComposerCtx.Provider>
  );
}

export function useDraftComposer() {
  const ctx = useContext(DraftComposerCtx);
  if (!ctx) throw new Error("useDraftComposer must be used within DraftComposerProvider");
  return ctx;
}

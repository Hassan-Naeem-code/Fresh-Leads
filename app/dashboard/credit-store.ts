"use client";

import { useSyncExternalStore } from "react";

// The credit balance is shown in the header but changed by actions deep in the page
// (unlocking a lead, exporting). Rather than lift all of that state into a shared
// parent or refetch the route, both sides talk to this one tiny store.
//
// Deliberately not a context provider: the header lives in a server-rendered layout
// and the results list is a separate client tree, so there is no common client
// ancestor to hold the state.
//
// The server is always the authority. Every mutation here comes from a response
// that already told us the balance, so this never guesses or decrements optimistically.

// null means "not seeded yet", which is NOT the same as a balance of zero. Using 0 as
// the empty state is what made a genuinely empty balance fall back to the stale
// server value and keep showing the old number after the last credit was spent.
let credits: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setCredits(next: number) {
  if (!Number.isFinite(next) || next === credits) return;
  credits = Math.max(0, Math.floor(next));
  emit();
}

/** Seed from the server-rendered value, once, without clobbering later updates. */
export function initCredits(value: number) {
  if (credits !== null) return;
  if (!Number.isFinite(value)) return;
  credits = Math.max(0, Math.floor(value));
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const snapshot = () => credits;

/**
 * The live balance, or null until it has been seeded.
 *
 * Callers must distinguish the two with `??`, never `||`: a real balance of zero is
 * falsy, and treating it as "no value" is precisely how a spent-out account kept
 * displaying the credits it started the session with.
 */
export function useCredits(): number | null {
  // Same snapshot on the server as the first client render, so hydration matches.
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

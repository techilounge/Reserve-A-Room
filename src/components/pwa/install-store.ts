"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks whether the app can be installed. Chromium browsers fire `beforeinstallprompt`;
 * iOS has no such event, so it gets manual "Add to Home Screen" instructions. Nothing is
 * offered when already running as an installed app.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallMode = "native" | "ios" | "none";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // we show our own, less intrusive prompt
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function getSnapshot(): InstallMode {
  if (installed || isStandalone()) return "none";
  if (deferred) return "native";
  return isIos() ? "ios" : "none";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "none");
}

/** Shows the browser's install dialog. Resolves true if the visitor installed. */
export async function promptNativeInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null; // a prompt event can only be used once
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

const DISMISS_KEY = "rar-install-dismissed-at";
const DISMISS_DAYS = 30;

export function wasDismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode): the banner simply shows again next visit.
  }
}

"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Cloudflare Turnstile (optional, ADR-14). Rendered only when the site has both keys
 * configured; the token is verified server-side and is single-use, so the parent remounts
 * this component (new `key`) after every submission attempt.
 */

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  action = "reserve",
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Cloudflare "action" label. The server only accepts a token minted for the action it expects. */
  action?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ kind: "load" | "challenge" | "timeout"; code?: string } | null>(null);

  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    callback.current(null);
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return;
        container.current.replaceChildren();
        widgetId = turnstile.render(container.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          size: "flexible",
          callback: (token: string) => {
            setFailure(null);
            callback.current(token);
          },
          "expired-callback": () => callback.current(null),
          "timeout-callback": () => {
            callback.current(null);
            setFailure({ kind: "timeout" });
          },
          "error-callback": (code: string) => {
            callback.current(null);
            setFailure({ kind: "challenge", code });
            return true;
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailure({ kind: "load" });
      });
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action, attempt]);

  const failureMessage =
    failure?.code === "110200"
      ? "Verification is not authorized for this website. Please contact the church office."
      : failure?.code === "200500"
        ? "Your browser or network blocked the verification frame. Pause content blockers for this site and try again."
        : failure?.kind === "timeout"
          ? "The verification timed out. Please try it again."
          : "The verification service couldn't connect. Check your connection or content blocker, then try again.";

  return (
    <div className="flex flex-col gap-2">
      <div ref={container} className="min-h-[65px]" />
      {failure ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger-soft-foreground">
          <p>
            {failureMessage}
            {failure.code ? <span className="ml-1 text-xs opacity-80">(Cloudflare code {failure.code})</span> : null}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setFailure(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry verification
          </Button>
        </div>
      ) : null}
    </div>
  );
}

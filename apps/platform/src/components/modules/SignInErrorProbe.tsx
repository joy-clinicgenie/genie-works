"use client";

import { useEffect } from "react";

/** Sends the sign-in failure code to the local debug session. No addresses or secrets. */
export function SignInErrorProbe({
  error,
  cause,
  dbHostKind,
  authUrlHost,
}: {
  error?: string;
  cause?: string;
  dbHostKind: "missing" | "local" | "remote";
  authUrlHost: string;
}) {
  useEffect(() => {
    // #region agent log
    fetch("http://127.0.0.1:7497/ingest/623c1501-d99c-4ad1-856f-8a22aec65c5b", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "19cd7c" },
      body: JSON.stringify({
        sessionId: "19cd7c",
        runId: "pre-fix",
        hypothesisId: "A-E",
        location: "SignInErrorProbe.tsx",
        message: "preview sign-in page",
        data: {
          error: error ?? null,
          cause: cause ?? null,
          dbHostKind,
          authUrlHost,
          pageHost: window.location.host,
          hostMatchesAuthUrl: window.location.host === authUrlHost,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [error, cause, dbHostKind, authUrlHost]);
  return null;
}

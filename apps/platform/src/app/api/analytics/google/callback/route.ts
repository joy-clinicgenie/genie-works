import { NextResponse } from "next/server";
import { AnalyticsRuleError, canManageRegistry, decryptSecret, exchangeOAuthState, sha256 } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx } from "@/lib/db";

function settingsRedirect(request: Request, query: Record<string, string | null | undefined>) {
  const target = new URL("/settings", request.url);
  for (const [key, value] of Object.entries(query)) if (value) target.searchParams.set(key, value);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const access = await requireAccess();
  if (!canManageRegistry(access)) return settingsRedirect(request, { analyticsError: "denied" });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const clientId = process.env.ANALYTICS_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.ANALYTICS_GOOGLE_CLIENT_SECRET;
  const clinicId = state ? await clientForState(state) : null;
  if (!code || !state || !clientId || !clientSecret) {
    return settingsRedirect(request, { analyticsError: "not_configured", client: clinicId });
  }
  const redirectUri = new URL("/api/analytics/google/callback", process.env.AUTH_URL || url.origin).toString();
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: await verifierFor(state),
      }),
    });
    const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!tokenResponse.ok || !token.access_token) {
      return settingsRedirect(request, { analyticsError: "oauth_failed", client: clinicId });
    }
    const exchanged = await serviceTx((db) => exchangeOAuthState(db, {
      state,
      token: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
      },
    }));
    return settingsRedirect(request, { client: exchanged.clientId, analyticsState: state });
  } catch (error) {
    console.error("Analytics OAuth callback failed", { name: error instanceof Error ? error.name : "Error" });
    return settingsRedirect(request, { analyticsError: "oauth_failed", client: clinicId });
  }
}

async function clientForState(state: string): Promise<string | null> {
  return serviceTx(async (db) => {
    const { rows } = await db.query<{ client_id: string }>(
      "select client_id from analytics_oauth_states where state_hash = $1",
      [sha256(state)],
    );
    return rows[0]?.client_id ?? null;
  }).catch(() => null);
}

async function verifierFor(state: string): Promise<string> {
  return serviceTx(async (db) => {
    const { rows } = await db.query<{ code_verifier_ciphertext: string | null; code_verifier_nonce: string | null }>(
      "select code_verifier_ciphertext, code_verifier_nonce from analytics_oauth_states where state_hash = $1",
      [sha256(state)],
    );
    const row = rows[0];
    if (!row?.code_verifier_ciphertext || !row.code_verifier_nonce) throw new AnalyticsRuleError("This connection attempt has expired.");
    return decryptSecret(row.code_verifier_ciphertext, row.code_verifier_nonce);
  });
}

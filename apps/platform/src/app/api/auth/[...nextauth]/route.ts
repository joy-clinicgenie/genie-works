import type { NextRequest } from "next/server";
import { handlers, takeAuthDebug } from "@/lib/auth";

function withDebugCookie(request: NextRequest, response: Response): Response {
  const token = takeAuthDebug();
  if (!token) return response;
  const headers = new Headers(response.headers);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  headers.append("set-cookie", `gw_dbg=${encodeURIComponent(token)}; Path=/; Max-Age=180; SameSite=Lax${secure}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function GET(request: NextRequest) {
  return withDebugCookie(request, await handlers.GET(request));
}

export async function POST(request: NextRequest) {
  return withDebugCookie(request, await handlers.POST(request));
}

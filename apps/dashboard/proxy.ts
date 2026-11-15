import { NextResponse, type NextRequest } from "next/server";
import "./lib/env";
import { SESSION_COOKIE, verifySession } from "./lib/session-token";
import { getShop } from "./lib/shops";

/**
 * Two jobs.
 * - The widget's frame (/embed/<shop>): only the websites the shop listed may show it (frame-ancestors).
 * - The back office: early redirect to /login. The shop chat (/s/...), signup, login and the buyer
 *   agents' storefront (checkout, OAuth, the Airwallex webhook) are public. The real check is
 *   requireOwner() in every page, action and route.
 */
export async function proxy(req: NextRequest) {
  const embed = /^\/embed\/([^/]+)\/?$/.exec(req.nextUrl.pathname);
  if (embed) {
    const origins = getShop(decodeURIComponent(embed[1]!))?.embedOrigins ?? [];
    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", `frame-ancestors 'self' ${origins.join(" ")}`.trim());
    return res;
  }
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (ok) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!login|signup|s/|api/s/|api/agentic/|api/airwallex/|oauth/|\\.well-known/|widget\\.js|_next/|favicon.ico).*)"] };

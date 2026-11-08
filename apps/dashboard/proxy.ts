import { NextResponse, type NextRequest } from "next/server";
import "./lib/env";
import { SESSION_COOKIE, verifySession } from "./lib/session-token";

/** Early redirect to /login for the back office. The shop chat (/s/...), signup and login are public. The real check is requireOwner() in every page, action and route. */
export async function proxy(req: NextRequest) {
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (ok) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!login|signup|s/|api/s/|embed|_next/|favicon.ico).*)"] };

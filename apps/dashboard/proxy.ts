import { NextResponse, type NextRequest } from "next/server";
import "./lib/env";
import { SESSION_COOKIE, verifySession } from "./lib/session-token";

/** Early redirect to /login. The real check is requireOwner() in every page, action and route. */
export async function proxy(req: NextRequest) {
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET, process.env.OWNER_EMAIL?.trim().toLowerCase());
  if (ok) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!login|_next/|favicon.ico).*)"] };

import "server-only";

import { redirect } from "next/navigation";
import { safeAdminReturnPath } from "./paths";
import { getAdminSession } from "./vercel";
import type { AdminSession } from "./vercel";

type SessionLoader = () => Promise<AdminSession | null>;

export async function resolveAdminSession(
  loadSession: SessionLoader = getAdminSession,
): Promise<AdminSession | null> {
  return loadSession();
}

function loginPath(returnTo: string): string {
  return `/admin/login?returnTo=${encodeURIComponent(safeAdminReturnPath(returnTo))}`;
}

export async function requireAdminPage(
  returnTo = "/admin",
  loadSession: SessionLoader = getAdminSession,
) {
  const session = await resolveAdminSession(loadSession);
  if (!session) redirect(loginPath(returnTo));
  return session;
}

export async function requireAdminAction(
  returnTo = "/admin",
  loadSession: SessionLoader = getAdminSession,
) {
  const session = await resolveAdminSession(loadSession);
  if (!session) redirect(loginPath(returnTo));
  return session;
}

export async function requireAdminApi(): Promise<
  { ok: true; sub: string } | { ok: false; response: Response }
> {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }),
    };
  }
  return { ok: true, sub: session.sub };
}

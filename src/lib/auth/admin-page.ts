import "server-only";

import { redirect } from "next/navigation";
import { getAdminSession } from "./vercel";

export async function requireAdminPage(returnTo = "/admin") {
  const session = await getAdminSession();
  if (!session) redirect(`/admin/login?returnTo=${encodeURIComponent(returnTo)}`);
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

import { getPublicVersionInfo } from "../../../lib/version";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getPublicVersionInfo(), {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Vercel-CDN-Cache-Control": "no-store",
      Expires: "0",
      Pragma: "no-cache",
    },
  });
}

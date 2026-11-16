import { indexExists, structuredExists } from "@/lib/db";
import { config } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const structured = structuredExists();
  const index = indexExists();
  const ok = structured && index;
  return Response.json(
    {
      ok,
      version: config.gameVersion,
      data: { structured, index },
      at: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}

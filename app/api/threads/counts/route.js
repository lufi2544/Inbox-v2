import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { cacheGet, cacheSet } from "@/lib/redis";

const COUNTS_TTL = 15; // seconds

// GET /api/threads/counts
// Returns thread counts per status for the current org.
// Cached in Redis for 15s — SSE invalidates on change so staleness is bounded.
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const cacheKey = `counts:${session.orgId}`;

  try {
    // Try Redis cache first
    const cached = await cacheGet(cacheKey);
    if (cached) return Response.json(cached);

    const counts = await db.thread.groupBy({
      by: ["status"],
      where: { orgId: session.orgId },
      _count: { _all: true },
    });

    const result = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, SNOOZED: 0 };
    for (const row of counts) {
      result[row.status] = row._count._all;
    }

    await cacheSet(cacheKey, result, COUNTS_TTL);
    return Response.json(result);
  } catch (err) {
    console.error("GET /api/threads/counts error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

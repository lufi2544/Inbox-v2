// GET /api/health
// Lightweight health check for Vercel, uptime monitors, and load balancers.
// Checks DB connectivity and returns service status.
// Does NOT require authentication — safe to expose publicly.

import { db } from "@/lib/db";

export async function GET() {
  const start = Date.now();

  try {
    // Cheapest possible DB query to verify connectivity
    await db.$queryRaw`SELECT 1`;

    return Response.json(
      {
        status: "ok",
        db: "ok",
        latency_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[health] DB check failed:", err);
    return Response.json(
      {
        status: "error",
        db: "unreachable",
        error: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

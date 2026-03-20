export const runtime = "nodejs";

// GET /api/sse
// Server-Sent Events endpoint.
// Keeps a connection open and pushes a "sync" event whenever the org's
// inbox activity changes (set by the Gmail push webhook or any sync).
//
// When Redis is configured: polls a Redis key (cheap GET every 5s).
// When Redis is not configured: falls back to polling org.lastActivityAt in DB.
//
// Each connection lives up to 55s, then closes. EventSource auto-reconnects.

import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { db } from "@/lib/db";
import { getOrgActivity } from "@/lib/redis";

export const maxDuration = 60; // Vercel Pro: up to 60s streaming

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.orgId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = session.orgId;
  const encoder = new TextEncoder();
  const useRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

  // Capture current activity marker so we only fire on *new* changes
  let lastSeen;
  if (useRedis) {
    lastSeen = await getOrgActivity(orgId);
  } else {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { lastActivityAt: true },
    });
    lastSeen = org?.lastActivityAt?.toISOString() ?? null;
  }

  let intervalId;
  let heartbeatId;
  let closeTimeout;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Poll for activity every 5 seconds
      intervalId = setInterval(async () => {
        try {
          let latest;
          if (useRedis) {
            latest = await getOrgActivity(orgId);
          } else {
            const org = await db.organization.findUnique({
              where: { id: orgId },
              select: { lastActivityAt: true },
            });
            latest = org?.lastActivityAt?.toISOString() ?? null;
          }

          if (latest && latest !== lastSeen) {
            lastSeen = latest;
            controller.enqueue(encoder.encode(`data: sync\n\n`));
          }
        } catch {
          // Keep connection alive on transient errors
        }
      }, 5_000);

      // Heartbeat every 20s to prevent proxies from dropping the connection
      heartbeatId = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* closed */ }
      }, 20_000);

      // Close after 55s — EventSource auto-reconnects
      closeTimeout = setTimeout(() => {
        clearInterval(intervalId);
        clearInterval(heartbeatId);
        try { controller.close(); } catch { /* already closed */ }
      }, 55_000);
    },
    cancel() {
      clearInterval(intervalId);
      clearInterval(heartbeatId);
      clearTimeout(closeTimeout);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

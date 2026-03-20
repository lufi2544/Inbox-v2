// GET /api/cron/unsnooze
// Vercel Cron job — runs every 5 minutes.
// Reopens threads whose snooze time has passed.
//
// Vercel automatically sends `Authorization: Bearer CRON_SECRET` on cron calls.
// Set CRON_SECRET in your Vercel env vars.

import { db } from "@/lib/db";

export async function GET(req) {
  // Verify this was called by Vercel's cron runner, not a random visitor
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await db.thread.updateMany({
      where: {
        status: "SNOOZED",
        snoozedUntil: { lte: new Date() },
      },
      data: {
        status: "OPEN",
        snoozedUntil: null,
      },
    });

    // Bump lastActivityAt on any affected orgs so SSE notifies their clients
    if (result.count > 0) {
      const affectedThreads = await db.thread.findMany({
        where: { status: "OPEN", snoozedUntil: null, updatedAt: { gte: new Date(Date.now() - 10_000) } },
        select: { orgId: true },
        distinct: ["orgId"],
      });
      await Promise.all(
        affectedThreads.map((t) =>
          db.organization.update({ where: { id: t.orgId }, data: { lastActivityAt: new Date() } })
        )
      );
    }

    console.log(`[cron/unsnooze] Reopened ${result.count} thread(s)`);
    return Response.json({ unsnoozed: result.count });
  } catch (err) {
    console.error("[cron/unsnooze] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

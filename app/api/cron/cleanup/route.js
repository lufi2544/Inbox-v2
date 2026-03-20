// GET /api/cron/cleanup
// Vercel Cron job — runs daily at 3 AM UTC.
// Deletes AuditLog entries older than 90 days to prevent unbounded table growth.
//
// Vercel automatically sends `Authorization: Bearer CRON_SECRET` on cron calls.

import { db } from "@/lib/db";

const RETENTION_DAYS = 90;

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const result = await db.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    console.log(`[cron/cleanup] Deleted ${result.count} audit log entries older than ${RETENTION_DAYS} days`);
    return Response.json({ deleted: result.count, cutoff: cutoff.toISOString() });
  } catch (err) {
    console.error("[cron/cleanup] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { invalidateOrgCounts, invalidateOrgThreads, setOrgActivity } from "@/lib/redis";

// POST /api/threads/bulk
// Body: { ids: string[], action: "resolve" | "markRead" | "assign", assignedToId?: string }
export async function POST(req) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { ids, action, assignedToId } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: "ids required" }, { status: 400 });

  // Verify all threads belong to this org
  const count = await db.thread.count({ where: { id: { in: ids }, orgId: session.orgId } });
  if (count !== ids.length) return Response.json({ error: "Some threads not found" }, { status: 404 });

  let data = {};
  if (action === "resolve") data = { status: "RESOLVED", isRead: true, needsReply: false, lockedByUserId: null, lockedAt: null };
  else if (action === "markRead") data = { isRead: true };
  else if (action === "assign") data = { assignedToId: assignedToId ?? null };
  else return Response.json({ error: "Invalid action" }, { status: 400 });

  await db.thread.updateMany({ where: { id: { in: ids }, orgId: session.orgId }, data });

  await db.auditLog.create({
    data: { action: `thread.bulk_${action}`, metadata: { ids, count: ids.length }, orgId: session.orgId, userId: session.userId },
  });

  await Promise.all([invalidateOrgCounts(session.orgId), invalidateOrgThreads(session.orgId), setOrgActivity(session.orgId)]);
  return Response.json({ ok: true, count: ids.length });
}

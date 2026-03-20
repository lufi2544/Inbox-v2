import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { cacheGet, cacheSet, getOrgThreadVersion } from "@/lib/redis";

const PAGE_SIZE = 50;

// GET /api/threads
// DB-first thread list for the current org.
// Query params:
//   status        — comma-separated list e.g. "OPEN,IN_PROGRESS" (default: all active)
//   assignedToId  — filter by agent (use "me" to get current user's threads)
//   unassigned    — "true" to show only unassigned threads
//   q             — full-text search across subject, senderName, snippet (searches all statuses)
//   cursor        — lastMessageAt ISO string for cursor-based pagination
export async function GET(req) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);

    // Auto-unsnooze any expired threads for this org before returning results.
    await db.thread.updateMany({
      where: { orgId: session.orgId, status: "SNOOZED", snoozedUntil: { lte: new Date() } },
      data: { status: "OPEN", snoozedUntil: null },
    });

    const q = searchParams.get("q")?.trim() || "";
    const cursor = searchParams.get("cursor") || null;
    const statusParam = searchParams.get("status");

    // Cache key includes a version counter that increments on any mutation.
    // 8s TTL as safety net; invalidation is the primary freshness mechanism.
    const version = await getOrgThreadVersion(session.orgId);
    const cacheKey = `threads:${session.orgId}:v${version}:${statusParam ?? ""}:${searchParams.get("assignedToId") ?? ""}:${searchParams.get("unassigned") ?? ""}:${q}:${cursor ?? ""}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return Response.json(cached);
    const statuses = statusParam
      ? statusParam.split(",").map((s) => s.trim().toUpperCase())
      : ["OPEN", "IN_PROGRESS", "SNOOZED"];

    const assignedToIdParam = searchParams.get("assignedToId");
    const unassigned = searchParams.get("unassigned") === "true";

    let assignedToFilter = {};
    if (unassigned) {
      assignedToFilter = { assignedToId: null };
    } else if (assignedToIdParam === "me") {
      assignedToFilter = { assignedToId: session.userId };
    } else if (assignedToIdParam) {
      assignedToFilter = { assignedToId: assignedToIdParam };
    }

    const where = {
      orgId: session.orgId,
      status: { in: q ? ["OPEN", "IN_PROGRESS", "RESOLVED", "SNOOZED"] : statuses },
      ...assignedToFilter,
      ...(q && {
        OR: [
          { subject: { contains: q, mode: "insensitive" } },
          { senderName: { contains: q, mode: "insensitive" } },
          { snippet: { contains: q, mode: "insensitive" } },
        ],
      }),
      // Cursor: only threads older than the cursor's lastMessageAt
      ...(cursor && { lastMessageAt: { lt: new Date(cursor) } }),
    };

    const threads = await db.thread.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        lockedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: PAGE_SIZE,
    });

    const LOCK_TTL_MS = 10 * 60 * 1000;
    const now = Date.now();

    const result = threads.map((t) => {
      const lockExpired = !t.lockedAt || now - new Date(t.lockedAt).getTime() > LOCK_TTL_MS;
      return {
        id: t.id,
        gmailId: t.gmailId,
        subject: t.subject,
        status: t.status,
        isRead: t.isRead,
        snippet: t.snippet,
        senderName: t.senderName,
        senderEmail: t.senderEmail,
        snoozedUntil: t.snoozedUntil,
        lastMessageAt: t.lastMessageAt,
        needsReply: t.needsReply,
        assignedTo: t.assignedTo,
        lockedBy: lockExpired ? null : t.lockedBy,
        messageCount: t._count.messages,
        updatedAt: t.updatedAt,
      };
    });

    // Provide a cursor for the next page (lastMessageAt of the last item)
    const nextCursor =
      threads.length === PAGE_SIZE
        ? (threads[threads.length - 1].lastMessageAt?.toISOString() ?? null)
        : null;

    const payload = { threads: result, nextCursor };
    await cacheSet(cacheKey, payload, 8);
    return Response.json(payload);
  } catch (err) {
    console.error("GET /api/threads error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

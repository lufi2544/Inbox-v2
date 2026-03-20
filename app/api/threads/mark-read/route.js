import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// POST /api/threads/mark-read
// Marks all currently visible threads as read for the org.
// Body: { status[] } — same filter as the current view so we only mark what's visible.
export async function POST(req) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { statuses } = await req.json();

    const where = {
      orgId: session.orgId,
      isRead: false,
      ...(statuses?.length && { status: { in: statuses } }),
    };

    const { count } = await db.thread.updateMany({ where, data: { isRead: true } });

    return Response.json({ count });
  } catch (err) {
    console.error("POST /api/threads/mark-read error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

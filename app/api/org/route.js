import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// GET /api/org
// Returns org info, members, AI settings, and current-month usage count.
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [org, aiCallsThisMonth] = await Promise.all([
      db.organization.findUnique({
        where: { id: session.orgId },
        include: {
          users: {
            select: { id: true, name: true, email: true, role: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
          aiSettings: true,
        },
      }),
      db.auditLog.count({
        where: {
          orgId: session.orgId,
          action: "reply.generated",
          createdAt: { gte: startOfMonth },
        },
      }),
    ]);

    if (!org) {
      return Response.json({ error: "Org not found" }, { status: 404 });
    }

    return Response.json({ ...org, aiCallsThisMonth });
  } catch (err) {
    console.error("GET /api/org error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

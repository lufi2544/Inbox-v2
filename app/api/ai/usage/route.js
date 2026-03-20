import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// GET /api/ai/usage — current month AI usage for the current user and org
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const [userCount, orgCount] = await Promise.all([
    db.auditLog.count({ where: { userId: session.userId, action: "reply.generated", createdAt: { gte: startOfMonth } } }),
    db.auditLog.count({ where: { orgId: session.orgId, action: "reply.generated", createdAt: { gte: startOfMonth } } }),
  ]);
  return Response.json({ user: userCount, org: orgCount });
}

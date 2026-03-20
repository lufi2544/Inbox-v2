import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// DELETE /api/templates/[id]
export async function DELETE(req, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await params;
  const template = await db.savedReply.findFirst({ where: { id, orgId: session.orgId } });
  if (!template) return Response.json({ error: "Not found" }, { status: 404 });
  await db.savedReply.delete({ where: { id } });
  return Response.json({ ok: true });
}

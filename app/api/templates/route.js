import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// GET /api/templates — list org saved replies
// POST /api/templates — create a saved reply { title, body, shortcut? }
export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  const templates = await db.savedReply.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, body: true, shortcut: true, createdAt: true },
  });
  return Response.json(templates);
}

export async function POST(req) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { title, body, shortcut } = await req.json();
  if (!title?.trim() || !body?.trim()) {
    return Response.json({ error: "Title and body are required" }, { status: 400 });
  }
  const template = await db.savedReply.create({
    data: { title: title.trim(), body: body.trim(), shortcut: shortcut?.trim() || null, orgId: session.orgId, createdById: session.userId },
  });
  return Response.json(template);
}

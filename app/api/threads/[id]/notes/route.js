import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// GET /api/threads/[id]/notes
// POST /api/threads/[id]/notes { body }
export async function GET(req, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await params;
  const thread = await db.thread.findFirst({ where: { id, orgId: session.orgId } });
  if (!thread) return Response.json({ error: "Not found" }, { status: 404 });
  const notes = await db.note.findMany({
    where: { threadId: id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  return Response.json(notes);
}

export async function POST(req, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const { id } = await params;
  const { body } = await req.json();
  if (!body?.trim()) return Response.json({ error: "Body is required" }, { status: 400 });
  const thread = await db.thread.findFirst({ where: { id, orgId: session.orgId } });
  if (!thread) return Response.json({ error: "Not found" }, { status: 404 });
  const note = await db.note.create({
    data: { body: body.trim(), threadId: id, authorId: session.userId },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  return Response.json(note);
}

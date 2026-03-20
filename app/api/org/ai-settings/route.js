import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// PATCH /api/org/ai-settings
// Admin updates the org's AI system prompt.
export async function PATCH(req) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const { systemPrompt } = await req.json();

    if (!systemPrompt?.trim()) {
      return Response.json({ error: "System prompt cannot be empty" }, { status: 400 });
    }

    const settings = await db.aISettings.upsert({
      where: { orgId: session.orgId },
      update: { systemPrompt: systemPrompt.trim() },
      create: { orgId: session.orgId, systemPrompt: systemPrompt.trim() },
    });

    await db.auditLog.create({
      data: {
        action: "ai_settings.updated",
        metadata: {},
        orgId: session.orgId,
        userId: session.userId,
      },
    });

    return Response.json(settings);
  } catch (err) {
    console.error("PATCH /api/org/ai-settings error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

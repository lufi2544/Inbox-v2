import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// POST /api/invites/[token]/accept
// Signed-in user accepts an invite — moves them into the invited org.
export async function POST(req, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { token } = await params;

    const invite = await db.invite.findUnique({
      where: { token },
    });

    if (!invite) {
      return Response.json({ error: "Invite not found" }, { status: 404 });
    }

    if (invite.usedAt) {
      return Response.json({ error: "Invite already used" }, { status: 410 });
    }

    if (invite.expiresAt < new Date()) {
      return Response.json({ error: "Invite expired" }, { status: 410 });
    }

    const previousOrgId = session.orgId;
    const newOrgId = invite.orgId;

    // Move user + their connected accounts to the new org
    await db.user.update({
      where: { id: session.userId },
      data: { orgId: newOrgId, role: invite.role },
    });

    await db.connectedAccount.updateMany({
      where: { userId: session.userId },
      data: { orgId: newOrgId },
    });

    // Mark invite as used
    await db.invite.update({
      where: { token },
      data: { usedAt: new Date() },
    });

    // Clean up the old auto-created org if no other users are left in it
    if (previousOrgId !== newOrgId) {
      const remainingUsers = await db.user.count({
        where: { orgId: previousOrgId },
      });

      if (remainingUsers === 0) {
        await db.organization.delete({ where: { id: previousOrgId } });
      }
    }

    await db.auditLog.create({
      data: {
        action: "invite.accepted",
        metadata: { token, previousOrgId },
        orgId: newOrgId,
        userId: session.userId,
      },
    });

    return Response.json({ success: true, orgId: newOrgId });
  } catch (err) {
    console.error("POST /api/invites/[token]/accept error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

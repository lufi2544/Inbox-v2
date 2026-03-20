import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLimit, isBillingEnabled } from "@/lib/plans";
import { sendInviteEmail } from "@/lib/email";

// POST /api/invites
// Admin creates an invite link for a given email + role.
// Sends an invite email automatically if RESEND_API_KEY is configured.
export async function POST(req) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  try {
    const { email, role = "AGENT" } = await req.json();

    if (!email) return Response.json({ error: "Email is required" }, { status: 400 });
    if (!["ADMIN", "AGENT"].includes(role)) return Response.json({ error: "Invalid role" }, { status: 400 });

    // ── Seat limit (only enforced when BILLING_ENABLED=true) ──
    if (isBillingEnabled()) {
      const org = await db.organization.findUnique({ where: { id: session.orgId }, select: { plan: true } });
      const seatLimit = getLimit(org.plan, "seats");
      const currentSeats = await db.user.count({ where: { orgId: session.orgId } });
      if (currentSeats >= seatLimit) {
        return Response.json(
          { error: `Seat limit reached (${seatLimit} members). Upgrade your plan to add more teammates.`, limitReached: true },
          { status: 403 }
        );
      }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [invite, org, inviter] = await Promise.all([
      db.invite.create({ data: { email, role, expiresAt, orgId: session.orgId } }),
      db.organization.findUnique({ where: { id: session.orgId }, select: { name: true } }),
      db.user.findUnique({ where: { id: session.userId }, select: { name: true, email: true } }),
    ]);

    await db.auditLog.create({
      data: { action: "invite.created", metadata: { invitedEmail: email, role }, orgId: session.orgId, userId: session.userId },
    });

    // Send invite email — fire and forget, never blocks the response
    sendInviteEmail({
      to: email,
      inviteToken: invite.token,
      orgName: org?.name ?? "your organization",
      role,
      invitedByName: inviter?.name ?? inviter?.email ?? "An admin",
    }).catch(() => {}); // already logged inside sendInviteEmail

    return Response.json({ token: invite.token, expiresAt: invite.expiresAt });
  } catch (err) {
    console.error("POST /api/invites error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

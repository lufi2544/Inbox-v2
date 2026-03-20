import { db } from "@/lib/db";

// GET /api/invites/[token]
// Public — used by the invite accept page to show org name and invite details.
export async function GET(req, { params }) {
  try {
    const { token } = await params;

    const invite = await db.invite.findUnique({
      where: { token },
      include: { org: { select: { name: true, slug: true } } },
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

    return Response.json({
      email: invite.email,
      role: invite.role,
      org: invite.org,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    console.error("GET /api/invites/[token] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

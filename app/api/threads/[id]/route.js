import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { google } from "googleapis";
import { sendAssignedEmail } from "@/lib/email";
import { invalidateOrgCounts, invalidateOrgThreads, setOrgActivity } from "@/lib/redis";

// PATCH /api/threads/[id]
// Update status, assignment, or lock state of a thread.
// Body: { status?, assignedToId?, lock?, unlock? }
//   status       — new ThreadStatus value
//   assignedToId — userId to assign, or null to unassign
//   lock         — true: claim this thread (sets lockedBy = current user)
//   unlock       — true: release the lock
export async function PATCH(req, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  try {
    const { id } = await params;
    const body = await req.json();
    const { status, assignedToId, lock, unlock, isRead, snoozedUntil } = body;

    // Verify the thread belongs to this org
    const thread = await db.thread.findFirst({
      where: { id, orgId: session.orgId },
    });

    if (!thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const updateData = {};

    if (status !== undefined) {
      updateData.status = status;
      // Clear snooze when moving out of SNOOZED
      if (status !== "SNOOZED") updateData.snoozedUntil = null;
    }

    if (snoozedUntil !== undefined) {
      updateData.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
    }

    // assignedToId can be null (unassign) or a userId string
    if ("assignedToId" in body) {
      updateData.assignedToId = assignedToId;
    }

    if (lock) {
      updateData.lockedByUserId = session.userId;
      updateData.lockedAt = new Date();
    }

    if (unlock) {
      updateData.lockedByUserId = null;
      updateData.lockedAt = null;
    }

    if (isRead !== undefined) {
      updateData.isRead = isRead;
      // Mirror the read/unread state to Gmail so both stay in sync
      if (session.accessToken) {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: session.accessToken });
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });
        await gmail.users.threads.modify({
          userId: "me",
          id: thread.gmailId,
          requestBody: isRead
            ? { removeLabelIds: ["UNREAD"] }
            : { addLabelIds: ["UNREAD"] },
        });
      }
    }

    const updated = await db.thread.update({
      where: { id },
      data: updateData,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        lockedBy: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit + notify on meaningful changes
    if (status !== undefined || "assignedToId" in body) {
      await db.auditLog.create({
        data: {
          action: status !== undefined ? "thread.status_changed" : "thread.assigned",
          metadata: {
            threadId: id,
            ...(status !== undefined && { from: thread.status, to: status }),
            ...("assignedToId" in body && { assignedToId }),
          },
          orgId: session.orgId,
          userId: session.userId,
        },
      });

      // Notify assignee by email when thread is routed to someone else
      if ("assignedToId" in body && assignedToId && assignedToId !== session.userId) {
        const [assignee, assigner] = await Promise.all([
          db.user.findUnique({ where: { id: assignedToId }, select: { email: true } }),
          db.user.findUnique({ where: { id: session.userId }, select: { name: true, email: true } }),
        ]);
        if (assignee) {
          sendAssignedEmail({
            to: assignee.email,
            threadSubject: thread.subject,
            assignedByName: assigner?.name ?? assigner?.email ?? "A teammate",
          }).catch(() => {});
        }
      }
    }

    // Bust caches so all clients see the update immediately
    await Promise.all([
      invalidateOrgCounts(session.orgId),
      invalidateOrgThreads(session.orgId),
      setOrgActivity(session.orgId),
    ]);

    return Response.json(updated);
  } catch (err) {
    console.error("PATCH /api/threads/[id] error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

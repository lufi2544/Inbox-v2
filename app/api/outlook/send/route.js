// POST /api/outlook/send
// Sends a reply via Microsoft Graph API and resolves the thread.
// Body: { to, subject, message, conversationId, replyToMessageId, dbThreadId, aiReplyId }

import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { db } from "@/lib/db";
import { invalidateOrgCounts, invalidateOrgThreads, setOrgActivity } from "@/lib/redis";

const GRAPH = "https://graph.microsoft.com/v1.0";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return Response.json({ error: "No auth" }, { status: 401 });
  if (!session?.orgId || !session?.userId) return Response.json({ error: "No org or user" }, { status: 401 });
  if (session.provider !== "azure-ad") {
    return Response.json({ error: "This endpoint is for Outlook accounts only." }, { status: 400 });
  }

  try {
    const { to, subject, message, replyToMessageId, dbThreadId, aiReplyId } = await req.json();

    // Reply to the specific message so it threads correctly in Outlook
    const replyRes = await fetch(`${GRAPH}/me/messages/${replyToMessageId}/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          body: { contentType: "Text", content: message },
        },
        comment: message,
      }),
    });

    if (!replyRes.ok) {
      const err = await replyRes.text();
      throw new Error(`Graph send failed ${replyRes.status}: ${err}`);
    }

    // Resolve thread and clear lock
    if (dbThreadId) {
      await db.thread.update({
        where: { id: dbThreadId },
        data: { status: "RESOLVED", isRead: true, lockedByUserId: null, lockedAt: null },
      });
    }

    if (aiReplyId) {
      await db.aIReply.update({
        where: { id: aiReplyId },
        data: { final: message, status: "SENT", sentAt: new Date() },
      });
    }

    await db.auditLog.create({
      data: {
        action: "reply.sent",
        metadata: { to, subject, provider: "outlook" },
        orgId: session.orgId,
        userId: session.userId,
      },
    });

    await Promise.all([
      invalidateOrgCounts(session.orgId),
      invalidateOrgThreads(session.orgId),
      setOrgActivity(session.orgId),
    ]);

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/outlook/send error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

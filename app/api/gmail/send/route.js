import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";
import { db } from "@/lib/db";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return Response.json({ error: "No auth" }, { status: 401 });
  }

  if (!session?.orgId || !session?.userId) {
    return Response.json({ error: "No org or user" }, { status: 401 });
  }

  try {
    const { to, subject, message, threadId, messageId, id, dbThreadId, aiReplyId } =
      await req.json();

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Build RFC 2822 compliant email with threading headers
    const rawMessage = [
      `To: ${to}`,
      `Subject: Re: ${subject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      message,
    ].join("\n");

    const encodedMessage = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId,
      },
    });

    // Mark thread as read and archive it (removes from Gmail inbox)
    await gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: { removeLabelIds: ["UNREAD", "INBOX"] },
    });

    // Resolve thread and clear the soft lock
    if (dbThreadId) {
      await db.thread.update({
        where: { id: dbThreadId },
        data: {
          status: "RESOLVED",
          isRead: true,
          lockedByUserId: null,
          lockedAt: null,
          needsReply: false,
        },
      });
    }

    // Mark the AIReply as SENT and save the final text that was actually sent
    if (aiReplyId) {
      await db.aIReply.update({
        where: { id: aiReplyId },
        data: {
          final: message,
          status: "SENT",
          sentAt: new Date(),
        },
      });
    }

    // Log the action for audit trail
    await db.auditLog.create({
      data: {
        action: "reply.sent",
        metadata: { to, subject, gmailThreadId: threadId },
        orgId: session.orgId,
        userId: session.userId,
      },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/gmail/send error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

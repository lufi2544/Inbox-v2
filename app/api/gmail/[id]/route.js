import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { extractBody, sanitizeEmailHtml, extractIsHtml } from "@/lib/sanitize";

export async function GET(req, context) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return Response.json({ error: "No auth" }, { status: 401 });
  if (!session?.orgId) return Response.json({ error: "No org" }, { status: 401 });

  try {
    const { id } = await context.params;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const res = await gmail.users.threads.get({ userId: "me", id });
    const messages = res.data.messages || [];

    const firstHeaders = messages[0]?.payload?.headers || [];
    const subject = firstHeaders.find((h) => h.name === "Subject")?.value || "No subject";

    const dbThread = await db.thread.upsert({
      where: { gmailId_orgId: { gmailId: id, orgId: session.orgId } },
      update: {},
      create: { gmailId: id, subject, orgId: session.orgId },
    });

    const parsedMessages = await Promise.all(
      messages.map(async (msg) => {
        const headers = msg.payload.headers || [];
        const from = headers.find((h) => h.name === "From")?.value || "";
        const msgSubject = headers.find((h) => h.name === "Subject")?.value || "";
        const messageId = headers.find((h) => h.name === "Message-ID")?.value || "";
        const sentAt = new Date(parseInt(msg.internalDate));

        const rawBody = extractBody(msg.payload);
        const isHtml = extractIsHtml(msg.payload);
        const body = isHtml ? sanitizeEmailHtml(rawBody) : rawBody;

        await db.message.upsert({
          where: { gmailId: msg.id },
          update: {},
          create: { gmailId: msg.id, from, body, sentAt, threadId: dbThread.id },
        });

        return { id: msg.id, messageId, from, subject: msgSubject, body, isHtml };
      })
    );

    return Response.json(parsedMessages);
  } catch (error) {
    console.error("GET /api/gmail/[id] error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { extractBody, sanitizeEmailHtml, extractIsHtml } from "@/lib/sanitize";
import { sendNewThreadsNotification } from "@/lib/email";
import { setOrgActivity, invalidateOrgCounts, invalidateOrgThreads } from "@/lib/redis";

const BATCH_SIZE = 10; // max concurrent Gmail API calls per sync pass

async function processThread(thread, gmail, session, orgMemberEmails) {
  const full = await gmail.users.threads.get({ userId: "me", id: thread.id });

  const messages = full.data.messages || [];
  const lastMessage = messages[messages.length - 1];
  const headers = lastMessage.payload.headers || [];

  const subject = headers.find((h) => h.name === "Subject")?.value || "No subject";
  const isRead = !messages.some((m) => m.labelIds?.includes("UNREAD"));
  const snippet = full.data.snippet || "";
  const lastMessageAt = new Date(parseInt(lastMessage.internalDate));

  const firstHeaders = messages[0]?.payload?.headers || [];
  const fromRaw = firstHeaders.find((h) => h.name === "From")?.value || "";
  const senderName = fromRaw.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || fromRaw;
  const emailMatch = fromRaw.match(/<(.+?)>/);
  const senderEmail = emailMatch ? emailMatch[1] : fromRaw;

  const lastMsgFrom = lastMessage.payload.headers?.find(h => h.name === "From")?.value ?? "";
  const lastMsgEmail = lastMsgFrom.match(/<(.+?)>/)?.[1]?.toLowerCase() ?? lastMsgFrom.toLowerCase();
  const needsReply = !isRead && !orgMemberEmails.has(lastMsgEmail);

  const dbThread = await db.thread.upsert({
    where: { gmailId_orgId: { gmailId: thread.id, orgId: session.orgId } },
    update: { subject, isRead, snippet, senderName, senderEmail, lastMessageAt, needsReply, updatedAt: new Date() },
    create: { gmailId: thread.id, subject, isRead, snippet, senderName, senderEmail, lastMessageAt, needsReply, orgId: session.orgId },
  });

  // Reopen resolved/snoozed threads if the client sent a new message
  if (!isRead && (dbThread.status === "RESOLVED" || dbThread.status === "SNOOZED")) {
    await db.thread.update({
      where: { id: dbThread.id },
      data: { status: "OPEN", assignedToId: null, lockedByUserId: null, lockedAt: null, snoozedUntil: null },
    });
    dbThread.status = "OPEN";
  }

  for (const msg of messages) {
    const msgHeaders = msg.payload.headers || [];
    const from = msgHeaders.find((h) => h.name === "From")?.value || "";
    const sentAt = new Date(parseInt(msg.internalDate));
    const rawBody = extractBody(msg.payload);
    const isHtml = extractIsHtml(msg.payload);
    const body = isHtml ? sanitizeEmailHtml(rawBody) : rawBody;

    await db.message.upsert({
      where: { gmailId: msg.id },
      update: {},
      create: { gmailId: msg.id, from, body, sentAt, threadId: dbThread.id },
    });
  }

  return {
    id: lastMessage.id,
    threadId: thread.id,
    dbThreadId: dbThread.id,
    subject,
    status: dbThread.status,
    isRead: dbThread.isRead,
    needsReply: dbThread.needsReply,
    assignedToId: dbThread.assignedToId,
  };
}

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return Response.json({ error: "No access token" }, { status: 401 });
  if (!session?.orgId) return Response.json({ error: "No org" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const pageToken = searchParams.get("pageToken") || undefined;

    if (!pageToken) {
      const recentSync = await db.auditLog.findFirst({
        where: { userId: session.userId, action: "gmail.synced", createdAt: { gte: new Date(Date.now() - 30_000) } },
      });
      if (recentSync) {
        return Response.json({ error: "Please wait 30 seconds before syncing again." }, { status: 429 });
      }
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: session.accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const list = await gmail.users.threads.list({ userId: "me", maxResults: 50, labelIds: ["INBOX"], pageToken });
    const threadRefs = list.data.threads || [];

    // Fetch org member emails to determine needsReply
    const orgMembers = await db.user.findMany({ where: { orgId: session.orgId }, select: { email: true } });
    const orgMemberEmails = new Set(orgMembers.map(m => m.email.toLowerCase()));

    // Process in batches of BATCH_SIZE to avoid hammering the Gmail API
    const threads = [];
    for (let i = 0; i < threadRefs.length; i += BATCH_SIZE) {
      const batch = threadRefs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((t) => processThread(t, gmail, session, orgMemberEmails)));
      threads.push(...results);
    }

    if (!pageToken) {
      await db.auditLog.create({
        data: { action: "gmail.synced", metadata: { threadCount: threads.length }, orgId: session.orgId, userId: session.userId },
      });

      // Count truly new threads (status OPEN means they were just created or reopened)
      const newCount = threads.filter((t) => t.status === "OPEN").length;
      if (newCount > 0) {
        // Rate limit notifications: max 1 per org per 5 minutes
        const recentNotif = await db.auditLog.findFirst({
          where: { orgId: session.orgId, action: "notification.new_threads", createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
        });
        if (!recentNotif) {
          const [org, members] = await Promise.all([
            db.organization.findUnique({ where: { id: session.orgId }, select: { name: true } }),
            db.user.findMany({ where: { orgId: session.orgId }, select: { email: true } }),
          ]);
          const recipients = members.map((m) => m.email);
          sendNewThreadsNotification({ to: recipients, count: newCount, orgName: org?.name ?? "your inbox" }).catch(() => {});
          await db.auditLog.create({
            data: { action: "notification.new_threads", metadata: { count: newCount }, orgId: session.orgId, userId: session.userId },
          });
        }
      }
    }

    // Bust caches after sync so all clients see fresh data
    if (!pageToken) {
      await Promise.all([
        setOrgActivity(session.orgId),
        invalidateOrgCounts(session.orgId),
        invalidateOrgThreads(session.orgId),
      ]);
    }

    // Set up Gmail push notifications on first-page syncs (no pageToken).
    // Watch expires after 7 days; calling watch() again silently renews it.
    // Requires PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/gmail-push in env.
    if (!pageToken && process.env.PUBSUB_TOPIC) {
      gmail.users.watch({
        userId: "me",
        requestBody: { labelIds: ["INBOX"], topicName: process.env.PUBSUB_TOPIC },
      }).catch((e) => console.warn("[gmail] watch() failed (non-fatal):", e?.message));
    }

    return Response.json({ threads, nextPageToken: list.data.nextPageToken ?? null });
  } catch (error) {
    console.error("GET /api/gmail error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

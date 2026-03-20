// GET /api/outlook
// Syncs the user's Outlook inbox via Microsoft Graph API.
// Works the same as /api/gmail — call it, get threads, they appear in the inbox.
//
// Microsoft uses "conversations" (conversationId) instead of Gmail threads.
// We map conversationId → Thread.gmailId so the rest of the app is provider-agnostic.
//
// Setup:
//   1. portal.azure.com → App registrations → New registration
//   2. Add redirect URI: https://your-app.vercel.app/api/auth/callback/azure-ad
//   3. API permissions → Microsoft Graph → Mail.Read, Mail.Send, Mail.ReadWrite, offline_access
//   4. Certificates & secrets → New client secret
//   5. Add to env: AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID

import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { db } from "@/lib/db";
import { sanitizeEmailHtml } from "@/lib/sanitize";
import { setOrgActivity, invalidateOrgCounts, invalidateOrgThreads } from "@/lib/redis";
import { sendNewThreadsNotification } from "@/lib/email";

const GRAPH = "https://graph.microsoft.com/v1.0";
const BATCH_SIZE = 10;

async function graphFetch(path, accessToken) {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  return res.json();
}

// Recursively extract text/html or text/plain body from a Graph message
function extractOutlookBody(message) {
  const body = message.body;
  if (!body) return { text: "", isHtml: false };
  const isHtml = body.contentType === "html";
  const raw = body.content ?? "";
  return { text: isHtml ? sanitizeEmailHtml(raw) : raw, isHtml };
}

async function processConversation(conversationId, messages, session) {
  if (!messages.length) return null;

  // Sort by receivedDateTime ascending — oldest first
  messages.sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));

  const last = messages[messages.length - 1];
  const first = messages[0];

  const subject = first.subject || "No subject";
  const isRead = messages.every((m) => m.isRead);
  const snippet = last.bodyPreview ?? "";
  const lastMessageAt = new Date(last.receivedDateTime);

  const fromRaw = first.from?.emailAddress?.name ?? "";
  const senderName = fromRaw || (first.from?.emailAddress?.address ?? "");
  const senderEmail = first.from?.emailAddress?.address ?? "";

  const dbThread = await db.thread.upsert({
    where: { gmailId_orgId: { gmailId: conversationId, orgId: session.orgId } },
    update: { subject, isRead, snippet, senderName, senderEmail, lastMessageAt, updatedAt: new Date() },
    create: { gmailId: conversationId, subject, isRead, snippet, senderName, senderEmail, lastMessageAt, orgId: session.orgId },
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
    const from = msg.from?.emailAddress?.address ?? "";
    const sentAt = new Date(msg.receivedDateTime);
    const { text: body } = extractOutlookBody(msg);

    await db.message.upsert({
      where: { gmailId: msg.id },
      update: {},
      create: { gmailId: msg.id, from, body, sentAt, threadId: dbThread.id },
    });
  }

  return {
    id: last.id,
    threadId: conversationId,
    dbThreadId: dbThread.id,
    subject,
    status: dbThread.status,
    isRead: dbThread.isRead,
    assignedToId: dbThread.assignedToId,
  };
}

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) return Response.json({ error: "No access token" }, { status: 401 });
  if (!session?.orgId) return Response.json({ error: "No org" }, { status: 401 });
  if (session.provider !== "azure-ad") {
    return Response.json({ error: "This endpoint is for Outlook accounts only." }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const skipToken = searchParams.get("skipToken") || null;

    // Rate limit: same 30s cooldown as Gmail sync
    if (!skipToken) {
      const recentSync = await db.auditLog.findFirst({
        where: { userId: session.userId, action: "outlook.synced", createdAt: { gte: new Date(Date.now() - 30_000) } },
      });
      if (recentSync) {
        return Response.json({ error: "Please wait 30 seconds before syncing again." }, { status: 429 });
      }
    }

    // Fetch recent inbox messages with body
    let url = `/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,bodyPreview,isRead,receivedDateTime,body`;
    if (skipToken) url += `&$skiptoken=${skipToken}`;

    const data = await graphFetch(url, session.accessToken);
    const messages = data.value ?? [];

    // Group messages by conversationId
    const byConversation = new Map();
    for (const msg of messages) {
      const id = msg.conversationId;
      if (!byConversation.has(id)) byConversation.set(id, []);
      byConversation.get(id).push(msg);
    }

    const conversationEntries = Array.from(byConversation.entries());

    // Process in batches
    const threads = [];
    for (let i = 0; i < conversationEntries.length; i += BATCH_SIZE) {
      const batch = conversationEntries.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(([convId, msgs]) => processConversation(convId, msgs, session))
      );
      threads.push(...results.filter(Boolean));
    }

    if (!skipToken) {
      await db.auditLog.create({
        data: { action: "outlook.synced", metadata: { threadCount: threads.length }, orgId: session.orgId, userId: session.userId },
      });

      // Notify org members of new threads
      const newCount = threads.filter((t) => t.status === "OPEN").length;
      if (newCount > 0) {
        const recentNotif = await db.auditLog.findFirst({
          where: { orgId: session.orgId, action: "notification.new_threads", createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
        });
        if (!recentNotif) {
          const [org, members] = await Promise.all([
            db.organization.findUnique({ where: { id: session.orgId }, select: { name: true } }),
            db.user.findMany({ where: { orgId: session.orgId }, select: { email: true } }),
          ]);
          sendNewThreadsNotification({ to: members.map((m) => m.email), count: newCount, orgName: org?.name ?? "your inbox" }).catch(() => {});
          await db.auditLog.create({
            data: { action: "notification.new_threads", metadata: { count: newCount }, orgId: session.orgId, userId: session.userId },
          });
        }
      }

      // Bust caches
      await Promise.all([
        setOrgActivity(session.orgId),
        invalidateOrgCounts(session.orgId),
        invalidateOrgThreads(session.orgId),
      ]);
    }

    // Microsoft pagination uses @odata.nextLink with a $skiptoken
    const nextLink = data["@odata.nextLink"] ?? null;
    const nextSkipToken = nextLink ? new URL(nextLink).searchParams.get("$skiptoken") : null;

    return Response.json({ threads, nextSkipToken });
  } catch (error) {
    console.error("GET /api/outlook error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

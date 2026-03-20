import "@/lib/env"; // validate required env vars at startup
import OpenAI from "openai";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { db } from "@/lib/db";
import { getLimit, isBillingEnabled } from "@/lib/plans";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_PROMPT =
  "Reply to emails in a professional, concise, and friendly tone. Only write the reply body — no greetings like 'Dear AI' or sign-offs unless they are natural.";

export async function POST(req) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return Response.json({ error: "No auth" }, { status: 401 });
  }

  if (!session?.orgId || !session?.userId) {
    return Response.json({ error: "No org or user" }, { status: 401 });
  }

  try {
    const { email, dbThreadId, mode = "default" } = await req.json();

    const MODE_PROMPTS = {
      short:    "Write a short, concise reply in 2-3 sentences maximum.",
      detailed: "Write a detailed, thorough reply addressing all points.",
      formal:   "Reply in a formal, professional business tone.",
      friendly: "Reply in a warm, friendly, conversational tone.",
    };

    // Rate limiting — checked against AuditLog (works across serverless instances).
    // No external dependency needed: the log already tracks every reply.generated.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const LIMIT_PER_USER = 30;
    const LIMIT_PER_ORG = 100;

    // ── Monthly billing limit (only enforced when BILLING_ENABLED=true) ──
    if (isBillingEnabled()) {
      const org = await db.organization.findUnique({ where: { id: session.orgId }, select: { plan: true } });
      const monthlyLimit = getLimit(org.plan, "aiRepliesPerMonth");
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const monthlyCount = await db.auditLog.count({
        where: { orgId: session.orgId, action: "reply.generated", createdAt: { gte: startOfMonth } },
      });
      if (monthlyCount >= monthlyLimit) {
        return Response.json(
          { error: `Monthly AI limit reached (${monthlyLimit} replies). Upgrade your plan for more.`, limitReached: true },
          { status: 429 }
        );
      }
    }

    const [userCount, orgCount] = await Promise.all([
      db.auditLog.count({
        where: {
          userId: session.userId,
          action: "reply.generated",
          createdAt: { gte: oneHourAgo },
        },
      }),
      db.auditLog.count({
        where: {
          orgId: session.orgId,
          action: "reply.generated",
          createdAt: { gte: oneHourAgo },
        },
      }),
    ]);

    if (userCount >= LIMIT_PER_USER) {
      return Response.json(
        { error: `Rate limit exceeded: max ${LIMIT_PER_USER} AI replies per hour per user.` },
        { status: 429 }
      );
    }
    if (orgCount >= LIMIT_PER_ORG) {
      return Response.json(
        { error: `Rate limit exceeded: max ${LIMIT_PER_ORG} AI replies per hour per organization.` },
        { status: 429 }
      );
    }

    // Hard lock check — if another agent is actively composing a reply on this
    // thread (lock set within the last 10 minutes), reject to prevent double-send.
    if (dbThreadId) {
      const LOCK_TTL_MS = 10 * 60 * 1000;
      const lockedThread = await db.thread.findFirst({
        where: {
          id: dbThreadId,
          orgId: session.orgId,
          lockedByUserId: { not: null },
          NOT: { lockedByUserId: session.userId },
        },
        include: { lockedBy: { select: { name: true, email: true } } },
      });

      if (lockedThread?.lockedAt) {
        const lockAge = Date.now() - new Date(lockedThread.lockedAt).getTime();
        if (lockAge < LOCK_TTL_MS) {
          const agent = lockedThread.lockedBy?.name ?? lockedThread.lockedBy?.email ?? "Another agent";
          return Response.json(
            { error: `${agent} is currently composing a reply on this thread.` },
            { status: 409 }
          );
        }
      }
    }

    // Load this org's custom system prompt, or fall back to the default.
    // upsert ensures AISettings always exists — safe to call on every request.
    const aiSettings = await db.aISettings.upsert({
      where: { orgId: session.orgId },
      update: {},
      create: {
        orgId: session.orgId,
        systemPrompt: DEFAULT_PROMPT,
      },
    });

    const modeInstruction = MODE_PROMPTS[mode] ?? "";
    const systemPrompt = modeInstruction
      ? `${aiSettings.systemPrompt}\n\n${modeInstruction}`
      : aiSettings.systemPrompt;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: email,
        },
      ],
    });

    const draft = completion.choices[0].message.content;

    // Persist the AI draft linked to thread + author.
    // dbThreadId is optional — present when user clicked a Gmail thread first.
    let aiReply = null;
    if (dbThreadId) {
      aiReply = await db.aIReply.create({
        data: {
          draft,
          status: "DRAFT",
          threadId: dbThreadId,
          authorId: session.userId,
        },
      });

      // Move thread to IN_PROGRESS and set soft lock so teammates see who's working it
      await db.thread.update({
        where: { id: dbThreadId },
        data: {
          status: "IN_PROGRESS",
          assignedToId: session.userId,
          lockedByUserId: session.userId,
          lockedAt: new Date(),
        },
      });
    }

    // Audit log
    await db.auditLog.create({
      data: {
        action: "reply.generated",
        metadata: { dbThreadId: dbThreadId ?? null },
        orgId: session.orgId,
        userId: session.userId,
      },
    });

    return Response.json({
      result: draft,
      aiReplyId: aiReply?.id ?? null,
    });
  } catch (error) {
    console.error("POST /api/ai error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

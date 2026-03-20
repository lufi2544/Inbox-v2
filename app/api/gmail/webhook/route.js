// POST /api/gmail/webhook
// Receives Google Cloud Pub/Sub push notifications when a Gmail mailbox changes.
//
// Setup (one-time, in Google Cloud Console):
//   1. Create a Pub/Sub topic: projects/YOUR_PROJECT/topics/gmail-push
//   2. Grant Gmail permission to publish:
//      gcloud pubsub topics add-iam-policy-binding gmail-push \
//        --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
//        --role=roles/pubsub.publisher
//   3. Create a push subscription pointing to:
//      https://your-app.vercel.app/api/gmail/webhook?token=YOUR_WEBHOOK_SECRET
//   4. Set WEBHOOK_SECRET and PUBSUB_TOPIC in env vars.
//
// Flow:
//   Gmail change → Pub/Sub topic → push subscription → this endpoint
//   → set Redis activity key (or DB fallback) → SSE notifies clients → clients sync

import { db } from "@/lib/db";
import { setOrgActivity, invalidateOrgCounts, invalidateOrgThreads } from "@/lib/redis";

export async function POST(req) {
  // Validate the shared secret so only our Pub/Sub subscription can call this
  const { searchParams } = new URL(req.url);
  if (searchParams.get("token") !== process.env.WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();
    const encoded = body?.message?.data;
    if (!encoded) return new Response("OK", { status: 200 });

    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const { emailAddress } = JSON.parse(decoded);
    if (!emailAddress) return new Response("OK", { status: 200 });

    const user = await db.user.findUnique({
      where: { email: emailAddress },
      select: { orgId: true },
    });

    if (user?.orgId) {
      const orgId = user.orgId;
      await Promise.all([
        // Signal SSE clients via Redis (fast path) or DB (fallback)
        setOrgActivity(orgId),
        db.organization.update({ where: { id: orgId }, data: { lastActivityAt: new Date() } }),
        // Bust caches so next request gets fresh data
        invalidateOrgCounts(orgId),
        invalidateOrgThreads(orgId),
      ]);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("POST /api/gmail/webhook error:", err);
    // Always 200 — returning 5xx causes Pub/Sub to retry with backoff
    return new Response("OK", { status: 200 });
  }
}

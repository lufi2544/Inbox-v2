// ─────────────────────────────────────────────────────────────────────────────
// Email sending via Resend
//
// All functions are no-ops when RESEND_API_KEY is not set, so the app works
// without email configured (e.g. local dev).
//
// Setup:
//   1. Sign up at https://resend.com (free tier: 3,000 emails/month)
//   2. Verify your sending domain (or use onboarding@resend.dev for testing)
//   3. Add RESEND_API_KEY and EMAIL_FROM to your .env.local
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from "resend";

let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

const FROM = process.env.EMAIL_FROM ?? "InboxAI <notifications@inboxai.app>";
const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// Shared send wrapper — catches errors so email failures never break the app
async function send(payload) {
  if (!resend) return; // not configured — skip silently
  try {
    await resend.emails.send(payload);
  } catch (err) {
    console.error("[email] Failed to send:", err?.message ?? err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invite email
// Sent when an admin creates an invite. Replaces manual copy-paste.
// ─────────────────────────────────────────────────────────────────────────────

export async function sendInviteEmail({ to, inviteToken, orgName, role, invitedByName }) {
  const inviteUrl = `${APP_URL}/invite/${inviteToken}`;
  await send({
    from: FROM,
    to,
    subject: `You've been invited to join ${orgName} on InboxAI`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="font-size:22px;font-weight:700;color:#111;margin-bottom:8px">InboxAI</div>
        <p style="color:#555;font-size:15px;margin-bottom:24px">
          ${invitedByName ?? "Someone"} invited you to join <strong>${orgName}</strong>
          as a <strong>${role.charAt(0) + role.slice(1).toLowerCase()}</strong>.
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
          Accept invite
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px">
          This link expires in 7 days and can only be used once.<br>
          If you weren't expecting this, you can ignore this email.
        </p>
      </div>
    `,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// New threads notification
// Sent to all org members when new emails arrive during a sync.
// Rate-limited externally (call site checks the AuditLog).
// ─────────────────────────────────────────────────────────────────────────────

export async function sendNewThreadsNotification({ to, count, orgName }) {
  const label = count === 1 ? "1 new email" : `${count} new emails`;
  await send({
    from: FROM,
    to,
    subject: `${label} in ${orgName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="font-size:22px;font-weight:700;color:#111;margin-bottom:8px">InboxAI</div>
        <p style="color:#555;font-size:15px;margin-bottom:24px">
          You have <strong>${label}</strong> waiting in <strong>${orgName}</strong>.
        </p>
        <a href="${APP_URL}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
          Open inbox
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px">
          You're receiving this because you're a member of ${orgName} on InboxAI.
        </p>
      </div>
    `,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Thread assigned notification
// Sent to the assignee when a thread is routed to them.
// ─────────────────────────────────────────────────────────────────────────────

export async function sendAssignedEmail({ to, threadSubject, assignedByName }) {
  await send({
    from: FROM,
    to,
    subject: `Thread assigned to you: ${threadSubject}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="font-size:22px;font-weight:700;color:#111;margin-bottom:8px">InboxAI</div>
        <p style="color:#555;font-size:15px;margin-bottom:24px">
          <strong>${assignedByName ?? "A teammate"}</strong> assigned a thread to you:
          <br><strong style="color:#111">${threadSubject}</strong>
        </p>
        <a href="${APP_URL}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
          Open inbox
        </a>
      </div>
    `,
  });
}

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Member = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
};

type AISettings = {
  systemPrompt: string;
};

type Org = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  users: Member[];
  aiSettings: AISettings | null;
  aiCallsThisMonth: number;
};

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("AGENT");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteError, setInviteError] = useState("");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
    if (status === "authenticated" && session.role !== "ADMIN") router.replace("/");
  }, [status, session, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/org")
      .then((r) => r.json())
      .then((data) => {
        setOrg(data);
        setSystemPrompt(data.aiSettings?.systemPrompt ?? "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [status]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    setInviteLink("");
    setInviteError("");
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setInviteError(d.error ?? "Failed to create invite");
        return;
      }
      const data = await res.json();
      setInviteLink(`${window.location.origin}/invite/${data.token}`);
      setInviteEmail("");
    } catch (err) {
      console.error(err);
    } finally {
      setInviting(false);
    }
  };

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrompt(true);
    setPromptSaved(false);
    setPromptError("");
    try {
      const res = await fetch("/api/org/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPromptError(d.error ?? "Failed to save");
        return;
      }
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPrompt(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!org) return null;

  const planBadge: Record<string, string> = {
    FREE: "bg-gray-100 text-gray-600",
    PRO: "bg-blue-100 text-blue-700",
    ENTERPRISE: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <span className="text-sm font-semibold text-gray-900">Settings</span>
        </div>
        <span className="text-xs text-gray-400">{session?.user?.email}</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

        {/* Org info */}
        <Card title="Organization">
          <div className="space-y-3">
            <Row label="Name" value={org.name} />
            <Row label="Slug" value={org.slug} />
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500 w-16 flex-shrink-0">Plan</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planBadge[org.plan] ?? "bg-gray-100 text-gray-600"}`}>
                {org.plan}
              </span>
            </div>
          </div>
        </Card>

        {/* AI usage */}
        <Card title="AI Usage">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700">Replies generated this month</p>
              <p className="text-xs text-gray-400 mt-0.5">Resets on the 1st of each month</p>
            </div>
            <span className="text-3xl font-semibold text-gray-900">{org.aiCallsThisMonth}</span>
          </div>
        </Card>

        {/* AI system prompt */}
        <Card title="AI System Prompt">
          <p className="text-xs text-gray-500 mb-3">
            Customize how the AI responds. This instruction is sent before every reply generation.
          </p>
          <form onSubmit={handleSavePrompt}>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder='e.g. "Reply in Spanish. Always mention our 24/7 hotline."'
              className="w-full px-3 py-2.5 text-sm rounded-lg border border-gray-200 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400 transition-shadow"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                type="submit"
                disabled={savingPrompt}
                className="px-4 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 cursor-pointer transition-colors"
              >
                {savingPrompt ? "Saving…" : "Save prompt"}
              </button>
              {promptSaved && <span className="text-xs text-green-600 font-medium">Saved</span>}
              {promptError && <span className="text-xs text-red-600">{promptError}</span>}
            </div>
          </form>
        </Card>

        {/* Members */}
        <Card title="Team members">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-xs font-medium text-gray-400">Name</th>
                <th className="text-left pb-2 text-xs font-medium text-gray-400">Email</th>
                <th className="text-left pb-2 text-xs font-medium text-gray-400">Role</th>
              </tr>
            </thead>
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 text-gray-900">{u.name ?? "—"}</td>
                  <td className="py-2.5 text-gray-500 text-xs">{u.email}</td>
                  <td className="py-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
                      u.role === "ADMIN" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Invite */}
        <Card title="Invite teammate">
          <p className="text-xs text-gray-500 mb-3">
            Generate a one-time invite link. Links expire after 7 days.
          </p>
          <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
            <input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="AGENT">Agent</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 cursor-pointer transition-colors"
            >
              {inviting ? "Creating…" : "Create link"}
            </button>
          </form>

          {inviteError && (
            <p className="mt-2 text-xs text-red-600">{inviteError}</p>
          )}

          {inviteLink && (
            <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs text-gray-500 mb-2">Share this link — expires in 7 days:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-gray-700 break-all">{inviteLink}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(inviteLink)}
                  className="text-xs px-2.5 py-1 rounded-md bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors flex-shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-gray-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

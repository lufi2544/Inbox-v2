"use client";

import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";

type InviteInfo = {
  email: string;
  role: string;
  org: { name: string; slug: string };
  expiresAt: string;
};

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setInviteError(data.error);
        else setInvite(data);
      })
      .catch(() => setInviteError("Failed to load invite"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const res = await fetch(`/api/invites/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        setInviteError(data.error ?? "Failed to accept invite");
        return;
      }
      // Sign out so the next sign-in mints a fresh JWT with the new orgId
      await signOut({ callbackUrl: "/?joined=1" });
    } catch (err) {
      console.error("Accept error:", err);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <p className="text-sm text-gray-400">Loading invite…</p>
      </Screen>
    );
  }

  if (inviteError) {
    return (
      <Screen>
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">Invite unavailable</h2>
        <p className="text-sm text-gray-500 mb-6">{inviteError}</p>
        <a href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Go to inbox →</a>
      </Screen>
    );
  }

  if (!invite) return null;

  return (
    <Screen>
      <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-5">
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>

      <h1 className="text-lg font-semibold text-gray-900 mb-1">You've been invited</h1>
      <p className="text-sm text-gray-500 mb-6">
        Join <strong className="text-gray-700">{invite.org.name}</strong> as{" "}
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">{invite.role}</span>
      </p>

      {status === "unauthenticated" && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Sign in with Google to accept this invite.</p>
          <button
            onClick={() => signIn("google", { callbackUrl: `/invite/${token}` })}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      )}

      {status === "authenticated" && (
        <div>
          <p className="text-xs text-gray-400 mb-4">Signed in as {session.user?.email}</p>
          {session.orgId === invite.org.slug ? (
            <p className="text-sm text-gray-500">You're already in this organization.</p>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-5">
                Accepting will move you into <strong className="text-gray-700">{invite.org.name}</strong>.
              </p>
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 cursor-pointer transition-colors"
              >
                {accepting ? "Joining…" : `Join ${invite.org.name}`}
              </button>
            </>
          )}
        </div>
      )}

      {status === "loading" && <p className="text-sm text-gray-400">Loading…</p>}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-sm mx-4 bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}

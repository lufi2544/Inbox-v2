"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signIn } from "next-auth/react";

// ── Types ──────────────────────────────────────────────────────────────

type Member = { id: string; name: string | null; email: string; role: string };

type ThreadSummary = {
  id: string;
  gmailId: string;
  subject: string;
  status: ThreadStatus;
  isRead: boolean;
  snippet: string;
  senderName: string;
  senderEmail: string;
  assignedTo: Member | null;
  lockedBy: Member | null;
  messageCount: number;
  updatedAt: string;
  lastMessageAt: string | null;
  needsReply: boolean;
  snoozedUntil?: string | null;
};

type Message = {
  id: string;
  messageId: string;
  from: string;
  subject: string;
  body: string;
  isHtml: boolean;
};

type Selected = ThreadSummary & {
  messages: Message[];
  response: string;
  aiReplyId: string | null;
};

type ThreadStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "SNOOZED";

type Filters = {
  statuses: ThreadStatus[];
  assignedToId: string;
};

// ── Constants ──────────────────────────────────────────────────────────

const SNOOZE_OPTIONS: { label: string; getDate: () => Date }[] = [
  { label: "1 hour",     getDate: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: "Later today",getDate: () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; } },
  { label: "Tomorrow",   getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: "Next week",  getDate: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; } },
];

const STATUS_TABS: { label: string; statuses: ThreadStatus[] }[] = [
  { label: "Active", statuses: ["OPEN", "IN_PROGRESS"] },
  { label: "Open", statuses: ["OPEN"] },
  { label: "In Progress", statuses: ["IN_PROGRESS"] },
  { label: "Resolved", statuses: ["RESOLVED"] },
  { label: "Snoozed", statuses: ["SNOOZED"] },
  { label: "All", statuses: ["OPEN", "IN_PROGRESS", "RESOLVED", "SNOOZED"] },
];

const STATUS_BADGE: Record<ThreadStatus, string> = {
  OPEN: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  RESOLVED: "bg-green-100 text-green-700",
  SNOOZED: "bg-purple-100 text-purple-700",
};

// ── Helpers ────────────────────────────────────────────────────────────

function extractEmail(from: string): string {
  if (!from) return "";
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

function formatSnoozeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isToday) return `today ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + ` ${time}`;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Component ──────────────────────────────────────────────────────────

export default function Home() {
  const { data: session, status } = useSession();

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  const [filters, setFilters] = useState<Filters>({
    statuses: ["OPEN", "IN_PROGRESS"],
    assignedToId: "",
  });
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextThreadCursor, setNextThreadCursor] = useState<string | null>(null);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<ThreadSummary | null>(null);
  const [showReplyContext, setShowReplyContext] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [snoozePicker, setSnoozePicker] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Bulk selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sync status
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Templates
  const [templates, setTemplates] = useState<{ id: string; title: string; body: string; shortcut?: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ title: "", body: "", shortcut: "" });
  const [showNewTemplate, setShowNewTemplate] = useState(false);

  // Notes
  const [notes, setNotes] = useState<{ id: string; body: string; createdAt: string; author: { id: string; name: string | null; email: string } }[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // AI
  const [aiMode, setAiMode] = useState<"default" | "short" | "detailed" | "formal" | "friendly">("default");
  const [aiUsage, setAiUsage] = useState<{ user: number; org: number } | null>(null);

  // Auto-sync ref
  const autoSyncedRef = useRef(false);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    if (session?.error === "RefreshAccessTokenError") signIn("google");
  }, [session]);

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("joined")) {
      showToast("Welcome to your new organization!");
      window.history.replaceState({}, "", "/");
    }
  }, [showToast]);

  // ── Data fetching ────────────────────────────────────────────────────

  const fetchCounts = useCallback(async () => {
    const res = await fetch("/api/threads/counts");
    if (res.ok) setTabCounts(await res.json());
  }, []);

  const fetchThreads = useCallback(async (currentFilters: Filters, search = "") => {
    const params = new URLSearchParams();
    params.set("status", currentFilters.statuses.join(","));
    if (search.trim()) params.set("q", search.trim());
    if (currentFilters.assignedToId === "unassigned") {
      params.set("unassigned", "true");
    } else if (currentFilters.assignedToId) {
      params.set("assignedToId", currentFilters.assignedToId);
    }
    const res = await fetch(`/api/threads?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error ?? "Failed to load threads — run: npx prisma migrate dev", "error");
      return;
    }
    const data = await res.json();
    setThreads(data.threads ?? []);
    setNextThreadCursor(data.nextCursor ?? null);
  }, [showToast]);

  const handleLoadMoreThreads = async () => {
    if (!nextThreadCursor) return;
    setLoadingMoreThreads(true);
    try {
      const params = new URLSearchParams();
      params.set("status", filters.statuses.join(","));
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      if (filters.assignedToId === "unassigned") params.set("unassigned", "true");
      else if (filters.assignedToId) params.set("assignedToId", filters.assignedToId);
      params.set("cursor", nextThreadCursor);
      const res = await fetch(`/api/threads?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setThreads((prev) => [...prev, ...(data.threads ?? [])]);
      setNextThreadCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMoreThreads(false);
    }
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoadingThreads(true);
    Promise.all([
      fetchThreads(filters),
      fetchCounts(),
      fetch("/api/org").then((r) => r.json()).then((d) => setMembers(d.users ?? [])),
      fetch("/api/templates").then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d : [])),
      fetch("/api/ai/usage").then((r) => r.json()).then((d) => setAiUsage(d)),
    ]).catch(console.error).finally(() => {
      setLoadingThreads(false);
      // Auto-sync on very first login
      if (!autoSyncedRef.current) {
        autoSyncedRef.current = true;
        const syncKey = `inboxai_synced_${session?.userId ?? ""}`;
        if (typeof window !== "undefined" && !localStorage.getItem(syncKey)) {
          localStorage.setItem(syncKey, "1");
          setTimeout(() => {
            setSyncing(true);
            fetch("/api/gmail").then(r => r.json()).then(async (data) => {
              if (data.nextPageToken || data.nextSkipToken) setNextPageToken(data.nextPageToken ?? data.nextSkipToken);
              setLastSyncedAt(new Date());
              await Promise.all([fetchThreads(filters), fetchCounts()]);
            }).catch(console.error).finally(() => setSyncing(false));
          }, 500);
        }
      }
    });
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search input — waits 300ms after typing stops before fetching
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoadingThreads(true);
    fetchThreads(filters, debouncedSearch).finally(() => setLoadingThreads(false));
  }, [filters, fetchThreads, status, debouncedSearch]);

  // ── SSE — real-time updates via Gmail push notifications ────────────
  // When a Gmail push webhook fires, the server bumps org.lastActivityAt.
  // The SSE endpoint detects this and sends a "sync" event, triggering a
  // thread refresh without waiting for the 60s fallback poll.
  useEffect(() => {
    if (status !== "authenticated") return;
    let es: EventSource | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;

    function connect() {
      es = new EventSource("/api/sse");
      es.onmessage = (e) => {
        if (e.data === "sync") {
          fetchThreads(filters, debouncedSearch);
          fetchCounts();
        }
      };
      es.onerror = () => {
        // Connection dropped or server closed after 55s — auto-reconnect
        es?.close();
        setTimeout(connect, 3_000);
      };
    }

    connect();

    // 60s fallback poll — catches changes that slip through (tab in background, etc.)
    fallback = setInterval(() => {
      fetchThreads(filters, debouncedSearch);
      fetchCounts();
    }, 60_000);

    return () => {
      es?.close();
      if (fallback) clearInterval(fallback);
    };
  }, [filters, fetchThreads, fetchCounts, status, debouncedSearch]);

  // Refresh threads when the user switches back to this tab
  useEffect(() => {
    if (status !== "authenticated") return;
    const handleFocus = () => fetchThreads(filters, debouncedSearch);
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [status, filters, fetchThreads, debouncedSearch]);

  // Page title reflects unread count so agents can see it in the tab
  const unreadCount = threads.filter((t) => !t.isRead).length;
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) InboxAI` : "InboxAI";
  }, [unreadCount]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleMarkAllRead = async () => {
    const res = await fetch("/api/threads/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statuses: filters.statuses }),
    });
    if (!res.ok) return;
    setThreads((prev) => prev.map((t) => ({ ...t, isRead: true })));
    if (selected) setSelected((s) => s && { ...s, isRead: true });
    await fetchCounts();
  };

  const handleMarkRead = async (threadId: string, isRead: boolean) => {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead }),
    });
    if (!res.ok) return;
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, isRead } : t));
    if (selected?.id === threadId) setSelected((s) => s && { ...s, isRead });
  };

  const openThread = async (item: ThreadSummary) => {
    setPendingSwitch(null);
    setSelected({ ...item, messages: [], response: "", aiReplyId: null });
    setNotes([]);
    setShowNotes(false);
    setNoteInput("");
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/gmail/${item.gmailId}`);
      if (!res.ok) { console.error(await res.text()); return; }
      const messages: Message[] = await res.json();
      setSelected((s) => s && { ...s, messages });
      if (!item.isRead) handleMarkRead(item.id, true);
      // Prefetch notes in background
      fetch(`/api/threads/${item.id}/notes`).then(r => r.json()).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => {});
    } catch (err) {
      console.error("Thread fetch error:", err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSelectThread = (item: ThreadSummary) => {
    // Warn before discarding an unsent reply
    if (selected?.response?.trim() && selected.id !== item.id) {
      setPendingSwitch(item);
      return;
    }
    openThread(item);
  };

  const isOutlook = session?.provider === "azure-ad";

  const handleSyncGmail = async () => {
    setSyncing(true);
    try {
      const endpoint = isOutlook ? "/api/outlook" : "/api/gmail";
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Sync failed", "error");
        return;
      }
      // Gmail uses nextPageToken, Outlook uses nextSkipToken
      setNextPageToken(data.nextPageToken ?? data.nextSkipToken ?? null);
      setLastSyncedAt(new Date());
      await Promise.all([fetchThreads(filters, debouncedSearch), fetchCounts()]);
    } finally {
      setSyncing(false);
    }
  };

  const handleLoadMore = async () => {
    if (!nextPageToken) return;
    setLoadingMore(true);
    try {
      const endpoint = isOutlook
        ? `/api/outlook?skipToken=${encodeURIComponent(nextPageToken)}`
        : `/api/gmail?pageToken=${encodeURIComponent(nextPageToken)}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to load more", "error");
        return;
      }
      setNextPageToken(data.nextPageToken ?? data.nextSkipToken ?? null);
      await fetchThreads(filters, debouncedSearch);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleStatusChange = async (threadId: string, newStatus: ThreadStatus) => {
    if (newStatus === "SNOOZED") {
      // Show snooze picker instead of patching immediately
      setSnoozePicker(threadId);
      return;
    }
    setSnoozePicker(null);
    const res = await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) return;
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, status: newStatus } : t));
    if (selected?.id === threadId) setSelected((s) => s && { ...s, status: newStatus });
  };

  const handleSnooze = async (threadId: string, until: Date) => {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SNOOZED", snoozedUntil: until.toISOString() }),
    });
    if (!res.ok) return;
    setSnoozePicker(null);
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, status: "SNOOZED" } : t));
    if (selected?.id === threadId) setSelected((s) => s && { ...s, status: "SNOOZED" });
    showToast(`Snoozed until ${until.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`);
  };

  const handleAssign = async (threadId: string, assignedToId: string | null) => {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId }),
    });
    if (!res.ok) return;
    const member = assignedToId ? members.find((m) => m.id === assignedToId) ?? null : null;
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, assignedTo: member } : t));
    if (selected?.id === threadId) setSelected((s) => s && { ...s, assignedTo: member });
  };

  const handleGenerateReply = async () => {
    if (!selected) return;
    const lastMessage = selected.messages[selected.messages.length - 1];
    const fullEmail = `Subject: ${selected.subject}\n\nBody:\n${lastMessage.body}`;
    setLoadingAI(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fullEmail, dbThreadId: selected.id, mode: aiMode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error ?? "Failed to generate reply", "error");
        return;
      }
      const data = await res.json();
      setSelected((s) => s && { ...s, response: data.result, aiReplyId: data.aiReplyId });
      // Refresh AI usage counter
      fetch("/api/ai/usage").then(r => r.json()).then(d => setAiUsage(d)).catch(() => {});
      setThreads((prev) =>
        prev.map((t) =>
          t.id === selected.id
            ? {
                ...t,
                status: "IN_PROGRESS",
                assignedTo: members.find((m) => m.id === session?.userId) ?? t.assignedTo,
                lockedBy: members.find((m) => m.id === session?.userId) ?? null,
              }
            : t
        )
      );
    } finally {
      setLoadingAI(false);
    }
  };

  const handleAddNote = async () => {
    if (!selected || !noteInput.trim()) return;
    const res = await fetch(`/api/threads/${selected.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteInput.trim() }),
    });
    if (!res.ok) return;
    const note = await res.json();
    setNotes(prev => [...prev, note]);
    setNoteInput("");
  };

  const handleBulkAction = async (action: string, assignedToId?: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const res = await fetch("/api/threads/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, assignedToId }),
    });
    if (!res.ok) return;
    if (action === "resolve") {
      setThreads(prev => prev.filter(t => !selectedIds.has(t.id)));
    } else if (action === "markRead") {
      setThreads(prev => prev.map(t => selectedIds.has(t.id) ? { ...t, isRead: true } : t));
    } else if (action === "assign") {
      const member = assignedToId ? members.find(m => m.id === assignedToId) ?? null : null;
      setThreads(prev => prev.map(t => selectedIds.has(t.id) ? { ...t, assignedTo: member } : t));
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    await fetchCounts();
    showToast(`Done — ${ids.length} thread${ids.length !== 1 ? "s" : ""} updated`);
  };

  const handleInsertTemplate = (body: string) => {
    setSelected(s => s && { ...s, response: (s.response ? s.response + "\n\n" : "") + body });
    setShowTemplates(false);
  };

  const handleSaveTemplate = async () => {
    if (!newTemplate.title.trim() || !newTemplate.body.trim()) return;
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTemplate),
    });
    if (!res.ok) return;
    const t = await res.json();
    setTemplates(prev => [...prev, t]);
    setNewTemplate({ title: "", body: "", shortcut: "" });
    setShowNewTemplate(false);
    showToast("Template saved");
  };

  const handleDeleteTemplate = async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const handleSendReply = async () => {
    if (!selected?.response) return;
    const myEmail = session?.user?.email ?? "";
    const lastFromClient = [...selected.messages].reverse().find((msg) => !msg.from.includes(myEmail));
    const toEmail = extractEmail(lastFromClient?.from ?? "");
    const lastMessage = selected.messages[selected.messages.length - 1];
    setSending(true);
    try {
      const sendEndpoint = isOutlook ? "/api/outlook/send" : "/api/gmail/send";
      const res = await fetch(sendEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toEmail,
          subject: selected.subject,
          message: selected.response,
          threadId: selected.gmailId,           // Gmail: gmailId; Outlook: conversationId
          messageId: lastMessage.messageId,
          replyToMessageId: lastMessage.id,     // Outlook uses this for reply threading
          id: lastMessage.id,
          dbThreadId: selected.id,
          aiReplyId: selected.aiReplyId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error ?? "Failed to send reply", "error");
        console.error(err);
        return;
      }
      setThreads((prev) => prev.map((t) => t.id === selected.id ? { ...t, status: "RESOLVED", isRead: true, lockedBy: null } : t));
      setSelected((s) => s && { ...s, response: "", aiReplyId: null, status: "RESOLVED", isRead: true, lockedBy: null });
      showToast("Reply sent successfully");
    } finally {
      setSending(false);
    }
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  // j = next thread, k = prev thread, Escape = close thread
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") { setSelected(null); return; }
      if (e.key === "j" || e.key === "k") {
        const idx = selected ? threads.findIndex((t) => t.id === selected.id) : -1;
        const next = e.key === "j" ? idx + 1 : idx - 1;
        if (next >= 0 && next < threads.length) handleSelectThread(threads[next]);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [threads, selected, handleSelectThread]);

  // Auto-grow reply textarea as user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, [selected?.response]);

  // Reset reply context toggle when switching threads
  useEffect(() => { setShowReplyContext(false); }, [selected?.id]);

  // ── Auth screens ─────────────────────────────────────────────────────

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-full max-w-sm mx-4 bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">InboxAI</h1>
          <p className="text-sm text-gray-500 mb-6">AI-powered shared inbox for your team</p>
          <button
            onClick={() => signIn("google")}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-white text-sm overflow-hidden">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-white text-sm font-medium shadow-lg pointer-events-none transition-opacity ${toast.type === "error" ? "bg-red-600" : "bg-gray-900"}`}>
          {toast.message}
        </div>
      )}

      {/* ── LEFT PANEL ── */}
      <div className="w-72 border-r border-gray-200 flex flex-col flex-shrink-0 bg-white">

        {/* Header */}
        <div className="px-4 h-12 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 tracking-tight">Inbox</span>
            {unreadCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white font-semibold leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 cursor-pointer transition-colors"
                title="Mark all visible threads as read"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }}
              className={`text-xs px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${selectMode ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-600"}`}
            >
              {selectMode ? `${selectedIds.size} selected` : "Select"}
            </button>
            <div className="flex flex-col items-end">
              <button
                onClick={handleSyncGmail}
                disabled={syncing}
                className="text-xs px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium disabled:opacity-50 cursor-pointer transition-colors"
              >
                {syncing ? "Syncing…" : "Sync Gmail"}
              </button>
              {lastSyncedAt && (
                <span className="text-[10px] text-gray-400" title={lastSyncedAt.toLocaleString()}>
                  {formatTime(lastSyncedAt.toISOString())}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex border-b border-gray-200 overflow-x-auto flex-shrink-0">
          {STATUS_TABS.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => { setActiveTabIndex(i); setFilters((f) => ({ ...f, statuses: tab.statuses })); }}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer flex items-center gap-1 ${
                activeTabIndex === i
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {tab.label}
              {(() => {
                const count = tab.statuses.reduce((sum, s) => sum + (tabCounts[s] ?? 0), 0);
                return count > 0 ? (
                  <span className={`text-[10px] px-1 py-0.5 rounded font-semibold leading-none ${
                    activeTabIndex === i ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                  }`}>
                    {count}
                  </span>
                ) : null;
              })()}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-6 py-1.5 text-xs rounded-md border border-gray-200 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer text-sm leading-none"
              >
                ×
              </button>
            )}
          </div>
          {debouncedSearch && (
            <p className="text-[10px] text-gray-400 mt-1">
              {threads.length > 0 ? `${threads.length} result${threads.length !== 1 ? "s" : ""} across all statuses` : "Searching all statuses…"}
            </p>
          )}
        </div>

        {/* Assignee filter */}
        <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
          <select
            value={filters.assignedToId}
            onChange={(e) => setFilters((f) => ({ ...f, assignedToId: e.target.value }))}
            className="w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">All agents</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
        </div>

        {/* Bulk action bar */}
        {selectMode && selectedIds.size > 0 && (
          <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 flex-shrink-0">
            <button onClick={() => handleBulkAction("resolve")} className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-md font-medium cursor-pointer hover:bg-green-700">Resolve all</button>
            <button onClick={() => handleBulkAction("markRead")} className="text-xs px-2.5 py-1 bg-white border border-gray-200 text-gray-700 rounded-md font-medium cursor-pointer hover:bg-gray-50">Mark read</button>
            <button onClick={() => { setSelectedIds(new Set()); setSelectMode(false); }} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer ml-auto">Cancel</button>
          </div>
        )}

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {loadingThreads && (
            <div className="space-y-0">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="h-2.5 bg-gray-200 rounded animate-pulse w-28" />
                    <div className="h-2 bg-gray-200 rounded animate-pulse w-8" />
                  </div>
                  <div className="h-2 bg-gray-200 rounded animate-pulse w-40 mb-1.5" />
                  <div className="h-2 bg-gray-100 rounded animate-pulse w-32" />
                </div>
              ))}
            </div>
          )}
          {!loadingThreads && threads.length === 0 && (() => {
            const isActiveTab = filters.statuses.includes("OPEN") || filters.statuses.includes("IN_PROGRESS");
            const hasActive = (tabCounts["OPEN"] ?? 0) + (tabCounts["IN_PROGRESS"] ?? 0) > 0;
            const isAllCaughtUp = isActiveTab && !hasActive && !debouncedSearch && Object.keys(tabCounts).length > 0;
            return isAllCaughtUp ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-xs font-semibold text-gray-700">You're all caught up</p>
                <p className="text-xs text-gray-400 mt-1">No open emails right now</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-gray-500">{debouncedSearch ? "No results" : "No threads here"}</p>
                {debouncedSearch ? (
                  <p className="text-xs text-gray-400 mt-1">Try a different search</p>
                ) : (
                  <div className="mt-3">
                    <button
                      onClick={handleSyncGmail}
                      disabled={syncing}
                      className="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer transition-colors disabled:opacity-50"
                    >
                      {syncing ? "Syncing…" : "Sync inbox now"}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => handleSelectThread(t)}
              className={`group relative px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                selected?.id === t.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
              }`}
            >
              {/* Checkbox for bulk select mode */}
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(t.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(t.id); else next.delete(t.id);
                      return next;
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="mr-2 mt-0.5 flex-shrink-0 cursor-pointer"
                />
              )}
              {/* Quick resolve button — appears on hover */}
              {t.status !== "RESOLVED" && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleStatusChange(t.id, "RESOLVED"); }}
                  title="Resolve"
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full bg-green-100 hover:bg-green-200 text-green-600 flex items-center justify-center transition-opacity cursor-pointer"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              {/* Row 1: sender + time */}
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  {!t.isRead && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                  <span
                    className={`text-xs truncate ${!t.isRead ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}
                    title={t.senderEmail || undefined}
                  >
                    {t.senderName || t.subject}
                  </span>
                </div>
                <span
                  className="text-[10px] text-gray-400 flex-shrink-0"
                  title={new Date(t.lastMessageAt ?? t.updatedAt).toLocaleString()}
                >
                  {formatTime(t.lastMessageAt ?? t.updatedAt)}
                </span>
              </div>

              {/* Row 2: subject (only if sender is shown separately) */}
              {t.senderName && (
                <p className={`text-xs truncate mb-0.5 ${!t.isRead ? "text-gray-700" : "text-gray-500"}`}>
                  {t.subject}
                </p>
              )}

              {/* Row 3: snippet */}
              {t.snippet && (
                <p className="text-[11px] text-gray-400 truncate mb-1">{t.snippet}</p>
              )}

              {/* Row 4: badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <StatusBadge status={t.status} />
                {t.status === "SNOOZED" && t.snoozedUntil && (
                  <span className="text-[10px] text-purple-500">↩ {formatSnoozeTime(t.snoozedUntil)}</span>
                )}
                {t.needsReply && t.status !== "RESOLVED" && (
                  <span className="text-[10px] text-orange-500 font-medium">↩ reply needed</span>
                )}
                {t.messageCount > 1 && (
                  <span className="text-[10px] text-gray-400">{t.messageCount} msgs</span>
                )}
                {t.assignedTo && (
                  <span className="text-[10px] text-gray-400">{t.assignedTo.name ?? t.assignedTo.email}</span>
                )}
                {t.lockedBy && (
                  <span className="text-[10px] text-amber-600 font-medium">✎ {t.lockedBy.name ?? t.lockedBy.email}</span>
                )}
              </div>
            </div>
          ))}

          {/* Load more from DB (cursor pagination) */}
          {nextThreadCursor && !loadingThreads && (
            <div className="px-4 py-2">
              <button
                onClick={handleLoadMoreThreads}
                disabled={loadingMoreThreads}
                className="w-full text-xs py-2 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-500 font-medium disabled:opacity-50 cursor-pointer transition-colors"
              >
                {loadingMoreThreads ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {/* Load more from Gmail (sync older pages) */}
          {nextPageToken && !loadingThreads && (
            <div className="px-4 py-2 border-t border-gray-100">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full text-xs py-2 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-400 font-medium disabled:opacity-50 cursor-pointer transition-colors"
              >
                {loadingMore ? "Syncing from Gmail…" : "Sync older Gmail threads"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* App header */}
        <div className="px-5 h-12 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <span className="font-semibold text-gray-900 tracking-tight">InboxAI</span>
          <div className="flex items-center gap-4">
            <a href="/settings" className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Settings</a>
            <span className="text-xs text-gray-400">{session?.user?.email}</span>
          </div>
        </div>

        {/* Empty state */}
        {!selected && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">Select a thread to start replying</p>
          </div>
        )}

        {/* Thread view */}
        {selected && (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Thread header */}
            <div className="px-5 py-3 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-900 mb-2 truncate">{selected.subject}</h2>
              <div className="flex items-center gap-3 flex-wrap">

                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Status</label>
                  <select
                    value={selected.status}
                    onChange={(e) => handleStatusChange(selected.id, e.target.value as ThreadStatus)}
                    className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="OPEN">Open</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="SNOOZED">Snoozed</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Assigned</label>
                  <select
                    value={selected.assignedTo?.id ?? ""}
                    onChange={(e) => handleAssign(selected.id, e.target.value || null)}
                    className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ?? m.email}{m.id === session?.userId ? " (me)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {selected.assignedTo?.id !== session?.userId && (
                  <button
                    onClick={() => handleAssign(selected.id, session?.userId ?? null)}
                    className="text-[11px] px-2 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium cursor-pointer transition-colors"
                  >
                    Take this
                  </button>
                )}

                <button
                  onClick={() => handleMarkRead(selected.id, !selected.isRead)}
                  className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                >
                  {selected.isRead ? "Mark unread" : "Mark read"}
                </button>
              </div>

              {/* Snooze duration picker — shown after selecting Snoozed */}
              {snoozePicker === selected.id && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Snooze until:</span>
                  {SNOOZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => handleSnooze(selected.id, opt.getDate())}
                      className="text-xs px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setSnoozePicker(null)}
                    className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Lock warning */}
            {selected.lockedBy && selected.lockedBy.id !== session?.userId && (
              <div className="mx-5 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex-shrink-0">
                ✎ <strong>{selected.lockedBy.name ?? selected.lockedBy.email}</strong> is currently composing a reply
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loadingMessages && (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
                      <div className="max-w-[60%]">
                        <div className="h-2 bg-gray-200 rounded animate-pulse w-24 mb-1.5" />
                        <div className="px-4 py-3 rounded-2xl bg-gray-100 space-y-1.5">
                          <div className="h-2 bg-gray-200 rounded animate-pulse w-48" />
                          <div className="h-2 bg-gray-200 rounded animate-pulse w-40" />
                          <div className="h-2 bg-gray-200 rounded animate-pulse w-32" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loadingMessages && selected.messages.map((msg, i) => {
                const isMe = msg.from.includes(session?.user?.email ?? "____");
                return (
                  <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[72%]">
                      <p className={`text-[10px] mb-1 text-gray-400 ${isMe ? "text-right" : ""}`}>
                        {msg.from}
                      </p>
                      <div className={`px-4 py-3 rounded-2xl text-xs leading-relaxed ${
                        isMe
                          ? "bg-blue-600 text-white rounded-tr-sm"
                          : "bg-gray-100 text-gray-900 rounded-tl-sm"
                      }`}>
                        {msg.isHtml ? (
                          <div
                            className="prose prose-xs max-w-none"
                            dangerouslySetInnerHTML={{ __html: msg.body }}
                          />
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!loadingMessages && selected.messages.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">No messages found in this thread.</p>
              )}
            </div>

            {/* Notes panel */}
            {selected && (
              <div className="border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={async () => {
                    if (!showNotes && notes.length === 0) {
                      setLoadingNotes(true);
                      fetch(`/api/threads/${selected.id}/notes`).then(r => r.json()).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoadingNotes(false));
                    }
                    setShowNotes(v => !v);
                  }}
                  className="w-full px-5 py-2 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span>{showNotes ? "▾" : "▸"}</span>
                  <span>Internal notes{notes.length > 0 ? ` (${notes.length})` : ""}</span>
                  <span className="text-[10px] text-gray-300 ml-1">— only visible to your team</span>
                </button>
                {showNotes && (
                  <div className="px-5 pb-3">
                    {loadingNotes && <p className="text-[11px] text-gray-400 py-2">Loading…</p>}
                    {!loadingNotes && notes.map(n => (
                      <div key={n.id} className="mb-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] font-medium text-gray-600">{n.author.name ?? n.author.email}</span>
                          <span className="text-[10px] text-gray-400">{formatTime(n.createdAt)}</span>
                        </div>
                        <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg text-xs text-gray-700 whitespace-pre-wrap">
                          {n.body}
                        </div>
                      </div>
                    ))}
                    {!loadingNotes && notes.length === 0 && (
                      <p className="text-[11px] text-gray-400 py-1">No notes yet. Add a note below.</p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <input
                        type="text"
                        value={noteInput}
                        onChange={e => setNoteInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
                        placeholder="Add an internal note…"
                        className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleAddNote}
                        disabled={!noteInput.trim()}
                        className="text-xs px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-medium cursor-pointer disabled:opacity-40 transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Unsent reply warning — shown when user tries to switch threads */}
            {pendingSwitch && (
              <div className="mx-5 mb-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-3 flex-shrink-0">
                <p className="text-xs text-amber-800">You have an unsent reply. Discard it and switch?</p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setPendingSwitch(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => openThread(pendingSwitch)}
                    className="text-xs px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium cursor-pointer transition-colors"
                  >
                    Discard &amp; switch
                  </button>
                </div>
              </div>
            )}

            {/* Reply compose */}
            <div className="border-t border-gray-200 px-5 py-4 flex-shrink-0 bg-gray-50">
              {/* Reply context — collapsed quote of the last client message */}
              {(() => {
                const myEmail = session?.user?.email ?? "";
                const lastClient = [...selected.messages].reverse().find((m) => !m.from.includes(myEmail));
                return lastClient ? (
                  <div className="mb-2">
                    <button
                      onClick={() => setShowReplyContext((v) => !v)}
                      className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer flex items-center gap-1 mb-1"
                    >
                      <span>{showReplyContext ? "▾" : "▸"}</span>
                      <span>Replying to: {lastClient.from.replace(/<[^>]+>/, "").trim()}</span>
                    </button>
                    {showReplyContext && (
                      <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-500 leading-relaxed max-h-28 overflow-y-auto">
                        {lastClient.isHtml
                          ? <div dangerouslySetInnerHTML={{ __html: lastClient.body }} />
                          : <p className="whitespace-pre-wrap">{lastClient.body.slice(0, 500)}{lastClient.body.length > 500 ? "…" : ""}</p>
                        }
                      </div>
                    )}
                  </div>
                ) : null;
              })()}
              {/* Templates panel */}
              {showTemplates && (
                <div className="mb-3 border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-700">Saved Replies</span>
                    <button
                      onClick={() => setShowNewTemplate(v => !v)}
                      className="text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer font-medium"
                    >
                      + New
                    </button>
                  </div>
                  {showNewTemplate && (
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 space-y-1.5">
                      <input
                        placeholder="Title (e.g. Thank you)"
                        value={newTemplate.title}
                        onChange={e => setNewTemplate(p => ({ ...p, title: e.target.value }))}
                        className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <textarea
                        placeholder="Reply body…"
                        value={newTemplate.body}
                        onChange={e => setNewTemplate(p => ({ ...p, body: e.target.value }))}
                        rows={3}
                        className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        placeholder="Shortcut (optional, e.g. ty)"
                        value={newTemplate.shortcut}
                        onChange={e => setNewTemplate(p => ({ ...p, shortcut: e.target.value }))}
                        className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        <button onClick={handleSaveTemplate} className="text-xs px-3 py-1 rounded bg-blue-600 text-white font-medium cursor-pointer hover:bg-blue-700">Save</button>
                        <button onClick={() => setShowNewTemplate(false)} className="text-xs px-3 py-1 rounded bg-white border border-gray-200 text-gray-500 cursor-pointer hover:bg-gray-50">Cancel</button>
                      </div>
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto">
                    {templates.length === 0 && <p className="px-3 py-3 text-[11px] text-gray-400">No templates yet. Click + New to create one.</p>}
                    {templates.map(t => (
                      <div
                        key={t.id}
                        className="px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 cursor-pointer group flex items-start justify-between gap-2"
                        onClick={() => handleInsertTemplate(t.body)}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-gray-800">{t.title}</span>
                            {t.shortcut && <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1 rounded">{t.shortcut}</span>}
                          </div>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{t.body.slice(0, 60)}{t.body.length > 60 ? "…" : ""}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 cursor-pointer text-sm flex-shrink-0 transition-opacity"
                          title="Delete"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={selected.response ?? ""}
                onChange={(e) => setSelected((s) => s && { ...s, response: e.target.value })}
                placeholder="Write a reply, or click Generate AI reply below…"
                className="w-full min-h-[7rem] px-3 py-2.5 text-xs rounded-lg border border-gray-200 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-400 transition-shadow"
              />
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleGenerateReply}
                    disabled={loadingAI}
                    className="px-3 py-1.5 text-xs rounded-l-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 font-medium cursor-pointer transition-colors"
                  >
                    {loadingAI ? "Generating…" : "✨ AI reply"}
                  </button>
                  <select
                    value={aiMode}
                    onChange={e => setAiMode(e.target.value as typeof aiMode)}
                    disabled={loadingAI}
                    className="text-xs py-1.5 pl-1.5 pr-5 rounded-r-md border border-l-0 border-gray-200 text-gray-600 bg-white focus:outline-none cursor-pointer disabled:opacity-50 appearance-none"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%236b7280' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
                  >
                    <option value="default">Default</option>
                    <option value="short">Short</option>
                    <option value="detailed">Detailed</option>
                    <option value="formal">Formal</option>
                    <option value="friendly">Friendly</option>
                  </select>
                </div>
                {aiUsage && (
                  <span className="text-[10px] text-gray-400" title={`This month: ${aiUsage.user} by you, ${aiUsage.org} by org`}>
                    {aiUsage.user} AI uses this month
                  </span>
                )}
                <button
                  onClick={() => setShowTemplates(v => !v)}
                  className="px-3 py-1.5 text-xs rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium cursor-pointer transition-colors"
                  title="Saved replies"
                >
                  📋 Templates
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(selected.response ?? "")}
                  disabled={!selected.response}
                  className="px-3 py-1.5 text-xs rounded-md bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  Copy
                </button>
                {selected.response && (
                  <button
                    onClick={() => setSelected((s) => s && { ...s, response: "", aiReplyId: null })}
                    className="px-3 py-1.5 text-xs rounded-md bg-white border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 cursor-pointer transition-colors"
                  >
                    Discard
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={handleSendReply}
                  disabled={sending || !selected.response}
                  className="px-4 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  {sending ? "Sending…" : "Send reply →"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: ThreadStatus }) {
  const label = status === "IN_PROGRESS" ? "In Progress" : status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[status] ?? "bg-gray-100 text-gray-500"}`}>
      {label}
    </span>
  );
}

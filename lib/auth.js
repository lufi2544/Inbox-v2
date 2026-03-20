import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

// Returns the session or a 401 Response.
// Usage:
//   const { session, error } = await requireAuth();
//   if (error) return error;
export async function requireAuth() {
  const session = await getServerSession(authOptions);

  if (!session?.userId || !session?.orgId) {
    return {
      session: null,
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { session, error: null };
}

// Same as requireAuth but also enforces ADMIN role.
export async function requireAdmin() {
  const { session, error } = await requireAuth();
  if (error) return { session: null, error };

  if (session.role !== "ADMIN") {
    return {
      session: null,
      error: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session, error: null };
}

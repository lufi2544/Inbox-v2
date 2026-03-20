import "next-auth";

// Extends the built-in NextAuth types to include the custom fields
// added in the session callback (app/api/auth/[...nextauth]/route.js).

declare module "next-auth" {
  interface Session {
    accessToken: string;
    userId: string;
    orgId: string;
    role: "ADMIN" | "AGENT";
    provider?: string;
    error?: string;
  }
}

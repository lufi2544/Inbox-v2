import "@/lib/env"; // validate required env vars at startup
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/encrypt";

// ─────────────────────────────────────────────
// Token refresh
// Called when the access token has expired.
// Uses the stored refresh token to get a new one from Google.
// ─────────────────────────────────────────────

// DB provider enum mapping
const PROVIDER_MAP = { google: "GOOGLE", "azure-ad": "MICROSOFT" };

async function refreshMicrosoftToken(refreshToken) {
  const tenantId = process.env.AZURE_AD_TENANT_ID ?? "common";
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.AZURE_AD_CLIENT_ID,
      client_secret: process.env.AZURE_AD_CLIENT_SECRET,
      refresh_token: refreshToken,
      scope: "openid profile email offline_access Mail.Read Mail.Send Mail.ReadWrite",
    }),
  });
  if (!res.ok) throw new Error(`Microsoft token refresh failed: ${res.status}`);
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

async function refreshGoogleToken(refreshToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials;
}

// ─────────────────────────────────────────────
// Auth options
// ─────────────────────────────────────────────

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify",
          prompt: "consent",       // always re-consent so Google returns a refresh token
          access_type: "offline",  // required for refresh token
        },
      },
    }),
    // Microsoft Outlook — only active when Azure AD credentials are configured.
    // Register an app at portal.azure.com → App registrations.
    ...(process.env.AZURE_AD_CLIENT_ID
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
            tenantId: process.env.AZURE_AD_TENANT_ID ?? "common",
            authorization: {
              params: {
                scope: "openid profile email offline_access Mail.Read Mail.Send Mail.ReadWrite",
              },
            },
          }),
        ]
      : []),
  ],

  callbacks: {
    // ── signIn ──────────────────────────────
    // Fires on every sign-in before the JWT is created.
    // Creates the User + Organization on first sign-in.
    // Always upserts the ConnectedAccount with fresh tokens.
    async signIn({ user, account }) {
      const dbProvider = PROVIDER_MAP[account?.provider];
      if (!dbProvider) return true; // unknown provider — skip

      try {
        let dbUser = await db.user.findUnique({ where: { email: user.email } });

        if (!dbUser) {
          // First sign-in: create org + admin user.
          // Org slug is derived from the email domain + timestamp to ensure uniqueness.
          const domain = user.email.split("@")[1];
          const slug = `${domain.replace(/\./g, "-")}-${Date.now()}`;

          const org = await db.organization.create({
            data: {
              name: domain,
              slug,
            },
          });

          dbUser = await db.user.create({
            data: {
              email: user.email,
              name: user.name,
              orgId: org.id,
              role: "ADMIN",
            },
          });
        }

        // Upsert connected account — tokens are encrypted at rest.
        await db.connectedAccount.upsert({
          where: {
            userId_provider: { userId: dbUser.id, provider: dbProvider },
          },
          update: {
            accessToken: encrypt(account.access_token),
            refreshToken: account.refresh_token ? encrypt(account.refresh_token) : undefined,
            expiresAt: new Date(account.expires_at * 1000),
          },
          create: {
            provider: dbProvider,
            email: user.email,
            accessToken: encrypt(account.access_token),
            refreshToken: encrypt(account.refresh_token),
            expiresAt: new Date(account.expires_at * 1000),
            userId: dbUser.id,
            orgId: dbUser.orgId,
          },
        });

        return true;
      } catch (error) {
        console.error("signIn callback error:", error);
        return false;
      }
    },

    // ── jwt ─────────────────────────────────
    // Runs on every request that touches the session.
    // On first sign-in: stores tokens + user identifiers in the JWT.
    // On subsequent requests: checks expiry and refreshes if needed.
    async jwt({ token, account, user }) {
      // Initial sign-in — enrich token with DB ids and OAuth tokens
      if (account && user) {
        const dbUser = await db.user.findUnique({
          where: { email: user.email },
          select: { id: true, orgId: true, role: true },
        });

        return {
          ...token,
          provider: account.provider,
          userId: dbUser.id,
          orgId: dbUser.orgId,
          role: dbUser.role,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at, // unix seconds
          lastOrgSync: Date.now(),
        };
      }

      // Re-sync org + role from DB every 2 minutes.
      // Catches invite acceptance without requiring sign-out.
      const TWO_MIN = 2 * 60 * 1000;
      if (token.userId && (!token.lastOrgSync || Date.now() - token.lastOrgSync > TWO_MIN)) {
        try {
          const dbUser = await db.user.findUnique({
            where: { id: token.userId },
            select: { orgId: true, role: true },
          });
          if (dbUser) {
            token = { ...token, orgId: dbUser.orgId, role: dbUser.role, lastOrgSync: Date.now() };
          }
        } catch {
          // Non-fatal — keep existing values
        }
      }

      // Token still valid (with 60s buffer)
      if (Date.now() < token.expiresAt * 1000 - 60_000) {
        return token;
      }

      // Token expired — refresh silently using the right provider
      try {
        const isMicrosoft = token.provider === "azure-ad";
        const refreshed = isMicrosoft
          ? await refreshMicrosoftToken(token.refreshToken)
          : await refreshGoogleToken(token.refreshToken);

        const dbProvider = PROVIDER_MAP[token.provider] ?? "GOOGLE";
        await db.connectedAccount.update({
          where: { userId_provider: { userId: token.userId, provider: dbProvider } },
          data: {
            accessToken: encrypt(refreshed.access_token),
            ...(refreshed.refresh_token && { refreshToken: encrypt(refreshed.refresh_token) }),
            expiresAt: new Date(refreshed.expiry_date),
          },
        });

        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: Math.floor(refreshed.expiry_date / 1000),
          error: undefined,
        };
      } catch (error) {
        console.error("Token refresh failed:", error);
        return { ...token, error: "RefreshAccessTokenError" };
      }
    },

    // ── session ─────────────────────────────
    // Shapes what the client receives from useSession() / getServerSession().
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.userId = token.userId;
      session.orgId = token.orgId;
      session.role = token.role;
      session.provider = token.provider;  // "google" | "azure-ad"
      session.error = token.error;
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

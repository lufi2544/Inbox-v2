// Validates required environment variables at startup.
// Import this in any server route that depends on these vars — it throws
// immediately with a clear message rather than silently failing later.
//
// Usage: import "@/lib/env" (side-effect import for validation only)
//    or: import { env } from "@/lib/env" (access typed vars)

const REQUIRED = [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "OPENAI_API_KEY",
];

// These are only required in production
const REQUIRED_IN_PROD = [
  "TOKEN_ENCRYPTION_KEY",
  "CRON_SECRET",
];

const missing = REQUIRED.filter((k) => !process.env[k]);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables:\n  ${missing.join("\n  ")}\n\n` +
    `Copy .env.example to .env.local and fill in the values.`
  );
}

if (process.env.NODE_ENV === "production") {
  const missingProd = REQUIRED_IN_PROD.filter((k) => !process.env[k]);
  if (missingProd.length > 0) {
    throw new Error(
      `Missing required production environment variables:\n  ${missingProd.join("\n  ")}\n\n` +
      `These are required in production for security. See .env.example.`
    );
  }
} else {
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.warn(
      "[env] TOKEN_ENCRYPTION_KEY is not set — OAuth tokens will be stored as plaintext. " +
      "Set this in production."
    );
  }
}

export const env = {
  DATABASE_URL:          process.env.DATABASE_URL,
  GOOGLE_CLIENT_ID:      process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET:  process.env.GOOGLE_CLIENT_SECRET,
  NEXTAUTH_SECRET:       process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL:          process.env.NEXTAUTH_URL,
  OPENAI_API_KEY:        process.env.OPENAI_API_KEY,
  TOKEN_ENCRYPTION_KEY:  process.env.TOKEN_ENCRYPTION_KEY,
};

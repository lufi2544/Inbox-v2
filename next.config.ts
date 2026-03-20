import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // Sentry organization + project (set in CI/Vercel env vars)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps (SENTRY_AUTH_TOKEN env var)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress the Sentry CLI output during builds
  silent: !process.env.CI,

  // Upload source maps so stack traces are readable in Sentry
  widenClientFileUpload: true,

  // Hide Sentry SDK from bundle to keep client JS smaller
  hideSourceMaps: true,

  // Tree-shake Sentry logger statements from production bundles
  // and automatically instrument Vercel Cron monitors
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
  },
});

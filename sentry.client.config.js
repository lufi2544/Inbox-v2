import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 10% of sessions for performance monitoring (raises to 100% on errors)
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  // Only enable in production — keeps local dev logs clean
  enabled: process.env.NODE_ENV === "production",

  integrations: [
    Sentry.replayIntegration({
      // Mask all text/inputs for privacy by default
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});

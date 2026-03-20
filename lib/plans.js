// ─────────────────────────────────────────────────────────────────────────────
// Plan definitions
//
// Limits are defined here for every tier. Billing enforcement is OFF by default.
// To enable enforcement, set BILLING_ENABLED=true in your environment.
//
// When Stripe is ready:
//   1. Set BILLING_ENABLED=true
//   2. Wire up Stripe webhooks to update org.plan on payment events
//   3. Done — all limits below become active automatically
// ─────────────────────────────────────────────────────────────────────────────

export const PLANS = {
  FREE: {
    name: "Free",
    priceMonthly: 0,
    badge: "Free",
    color: "gray",
    limits: {
      seats: 3,               // max users per org
      aiRepliesPerMonth: 100, // AI replies per calendar month
    },
    features: [
      "3 team members",
      "100 AI replies per month",
      "Gmail inbox sync",
      "Shared inbox + assignments",
      "Basic email support",
    ],
  },

  PRO: {
    name: "Pro",
    priceMonthly: 49,
    badge: "Pro",
    color: "blue",
    limits: {
      seats: 15,
      aiRepliesPerMonth: 1000,
    },
    features: [
      "15 team members",
      "1,000 AI replies per month",
      "Everything in Free",
      "Priority email support",
      "Custom AI system prompt",
    ],
  },

  ENTERPRISE: {
    name: "Enterprise",
    priceMonthly: null, // custom
    badge: "Enterprise",
    color: "purple",
    limits: {
      seats: Infinity,
      aiRepliesPerMonth: Infinity,
    },
    features: [
      "Unlimited team members",
      "Unlimited AI replies",
      "Everything in Pro",
      "SLA + dedicated support",
      "Custom integrations",
      "Audit log export",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Billing is disabled until BILLING_ENABLED=true is set.
// While disabled, all orgs get unlimited access to everything.
// ─────────────────────────────────────────────────────────────────────────────

export function isBillingEnabled() {
  return process.env.BILLING_ENABLED === "true";
}

// Returns the effective limit for a given plan + key.
// Returns Infinity when billing is disabled.
export function getLimit(plan, key) {
  if (!isBillingEnabled()) return Infinity;
  return PLANS[plan]?.limits[key] ?? PLANS.FREE.limits[key];
}

// Returns a human-readable label for a limit value.
export function formatLimit(value) {
  if (value === Infinity) return "Unlimited";
  return value.toLocaleString();
}

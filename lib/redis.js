// ─────────────────────────────────────────────────────────────────────────────
// Upstash Redis client
//
// Used for:
//   1. Activity signal — SSE polls this instead of DB (much cheaper at scale)
//   2. Tab-count cache — 15s TTL, shared across all serverless instances
//   3. Thread-list cache — 8s TTL, per org+filter combo
//
// Everything gracefully degrades to DB-direct when Redis is not configured.
// Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to env to enable.
//
// Setup (free tier: 10k commands/day):
//   1. console.upstash.com → Create Database → copy REST URL + token
//   2. Add both to .env.local and Vercel env vars
// ─────────────────────────────────────────────────────────────────────────────

import { Redis } from "@upstash/redis";

let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export { redis };

// ── Activity signal ───────────────────────────────────────────────────────────
// SSE clients poll this key to detect inbox changes.
// Much cheaper than a DB query — single Redis GET every 5s per client.

export async function setOrgActivity(orgId) {
  if (!redis) return;
  const ts = Date.now().toString();
  await redis.set(`org:${orgId}:activity`, ts, { ex: 3600 }).catch(() => {});
}

export async function getOrgActivity(orgId) {
  if (!redis) return null;
  try {
    return await redis.get(`org:${orgId}:activity`);
  } catch {
    return null;
  }
}

// ── Generic cache helpers ─────────────────────────────────────────────────────

export async function cacheGet(key) {
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch { /* non-fatal */ }
}

export async function cacheDel(key) {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch { /* non-fatal */ }
}

// ── Invalidation helpers ──────────────────────────────────────────────────────
// Call these when data changes so stale cache is cleared immediately.

export async function invalidateOrgCounts(orgId) {
  await cacheDel(`counts:${orgId}`);
}

export async function invalidateOrgThreads(orgId) {
  // Thread list keys include filter params — easier to bump a version key
  // that gets included in all thread cache keys for this org.
  if (!redis) return;
  try {
    await redis.incr(`org:${orgId}:threadVersion`);
    await redis.expire(`org:${orgId}:threadVersion`, 3600);
  } catch { /* non-fatal */ }
}

export async function getOrgThreadVersion(orgId) {
  if (!redis) return "0";
  try {
    const v = await redis.get(`org:${orgId}:threadVersion`);
    return v?.toString() ?? "0";
  } catch {
    return "0";
  }
}

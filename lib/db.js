import { PrismaClient } from "@prisma/client";
import { readReplicas } from "@prisma/extension-read-replicas";

// Prevent multiple PrismaClient instances in development due to hot reloading.
// In production Next.js only instantiates once, so this guard only matters locally.
const globalForPrisma = global;

function createClient() {
  const client = new PrismaClient();

  // Use a read replica for all read queries when DATABASE_URL_REPLICA is set.
  // Writes still go to the primary. Reduces load on the primary at scale.
  // Neon: create a replica in your project → copy the connection string.
  if (process.env.DATABASE_URL_REPLICA) {
    return client.$extends(
      readReplicas({ replicas: [process.env.DATABASE_URL_REPLICA] })
    );
  }

  return client;
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

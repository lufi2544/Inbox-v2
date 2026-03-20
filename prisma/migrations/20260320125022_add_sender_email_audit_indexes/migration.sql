-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "senderEmail" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "AuditLog_userId_action_createdAt_idx" ON "AuditLog"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_action_createdAt_idx" ON "AuditLog"("orgId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "Thread_orgId_status_lastMessageAt_idx" ON "Thread"("orgId", "status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Thread_orgId_assignedToId_idx" ON "Thread"("orgId", "assignedToId");

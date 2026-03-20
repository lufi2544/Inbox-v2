-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "senderName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "snippet" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

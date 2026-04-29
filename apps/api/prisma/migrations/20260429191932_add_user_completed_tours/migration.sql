-- AlterTable
ALTER TABLE "users" ADD COLUMN     "completedTours" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "sampleDataLoadedAt" TIMESTAMP(3);

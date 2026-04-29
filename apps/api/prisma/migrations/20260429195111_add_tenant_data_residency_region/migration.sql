-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "region" TEXT DEFAULT 'EU';

-- CreateIndex
CREATE INDEX "tenants_region_idx" ON "tenants"("region");

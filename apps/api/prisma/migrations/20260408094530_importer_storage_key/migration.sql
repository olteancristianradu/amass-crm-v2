/*
  Warnings:

  - You are about to drop the column `filePath` on the `import_jobs` table. All the data in the column will be lost.
  - Added the required column `storageKey` to the `import_jobs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "import_jobs" DROP COLUMN "filePath",
ADD COLUMN     "storageKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN "nationality" TEXT,
ADD COLUMN "dateOfBirth" TIMESTAMP(3),
ADD COLUMN "height" TEXT,
ADD COLUMN "birthLocation" TEXT,
ADD COLUMN "biography" TEXT,
ADD COLUMN "theSportsDbId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Player_theSportsDbId_key" ON "Player"("theSportsDbId");

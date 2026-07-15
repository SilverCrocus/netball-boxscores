ALTER TABLE "Player"
  ADD COLUMN "photoSourceUrl" TEXT,
  ADD COLUMN "photoCredit" TEXT,
  ADD COLUMN "photoLicense" TEXT,
  ADD COLUMN "photoVerifiedAt" TIMESTAMPTZ(3);

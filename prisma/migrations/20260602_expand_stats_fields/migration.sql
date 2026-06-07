-- Add extended player stat fields to PlayerMatchStats
ALTER TABLE "PlayerMatchStats" ADD COLUMN "goal2" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "attempt2" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "netPoints" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "goalMisses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "feedWithAttempt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "gain" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "pickups" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "contactPenalties" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "obstructionPenalties" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "centrePassToGoalPerc" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "quartersPlayed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "blocks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "tossUpWin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "secondPhaseReceive" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "possessionChanges" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "unforcedTurnovers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerMatchStats" ADD COLUMN "interceptPassThrown" INTEGER NOT NULL DEFAULT 0;

-- Create TeamMatchStats table
CREATE TABLE "TeamMatchStats" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "goalAttempts" INTEGER NOT NULL DEFAULT 0,
    "goal2" INTEGER NOT NULL DEFAULT 0,
    "attempt2" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "goalAssists" INTEGER NOT NULL DEFAULT 0,
    "intercepts" INTEGER NOT NULL DEFAULT 0,
    "deflections" INTEGER NOT NULL DEFAULT 0,
    "rebounds" INTEGER NOT NULL DEFAULT 0,
    "penalties" INTEGER NOT NULL DEFAULT 0,
    "contactPenalties" INTEGER NOT NULL DEFAULT 0,
    "obstructionPenalties" INTEGER NOT NULL DEFAULT 0,
    "feeds" INTEGER NOT NULL DEFAULT 0,
    "feedWithAttempt" INTEGER NOT NULL DEFAULT 0,
    "centrePassReceives" INTEGER NOT NULL DEFAULT 0,
    "turnovers" INTEGER NOT NULL DEFAULT 0,
    "gain" INTEGER NOT NULL DEFAULT 0,
    "timeout" INTEGER NOT NULL DEFAULT 0,
    "timeInPossession" INTEGER NOT NULL DEFAULT 0,
    "timeToScore" INTEGER NOT NULL DEFAULT 0,
    "goalsFromCentrePass" INTEGER NOT NULL DEFAULT 0,
    "goalsFromGain" INTEGER NOT NULL DEFAULT 0,
    "centrePassToGoalPerc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gainToGoalPerc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "possessionChanges" INTEGER NOT NULL DEFAULT 0,
    "netPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goalMisses" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "pickups" INTEGER NOT NULL DEFAULT 0,
    "tossUpWin" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TeamMatchStats_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint and indexes
CREATE UNIQUE INDEX "TeamMatchStats_matchId_teamId_key" ON "TeamMatchStats"("matchId", "teamId");

-- Add foreign keys
ALTER TABLE "TeamMatchStats" ADD CONSTRAINT "TeamMatchStats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMatchStats" ADD CONSTRAINT "TeamMatchStats_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Update ScoreFlow unique constraint (from previous fix)
DROP INDEX IF EXISTS "ScoreFlow_matchId_period_periodSeconds_key";
CREATE UNIQUE INDEX "ScoreFlow_matchId_period_periodSeconds_scoringTeamId_key" ON "ScoreFlow"("matchId", "period", "periodSeconds", "scoringTeamId");

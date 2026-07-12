-- Homepage season/status ordering and team fixture history.
CREATE INDEX "Match_competitionId_status_scheduledAt_idx"
ON "Match"("competitionId", "status", "scheduledAt");

CREATE INDEX "Match_homeTeamId_scheduledAt_idx"
ON "Match"("homeTeamId", "scheduledAt");

CREATE INDEX "Match_awayTeamId_scheduledAt_idx"
ON "Match"("awayTeamId", "scheduledAt");

-- Team roster ordering and match-first player-stat lookups.
CREATE INDEX "Player_teamId_name_idx"
ON "Player"("teamId", "name");

CREATE INDEX "PlayerMatchStats_matchId_idx"
ON "PlayerMatchStats"("matchId");

-- Remaining foreign-key indexes reported by the Supabase database advisor.
CREATE INDEX "Account_userId_idx"
ON "Account"("userId");

CREATE INDEX "MatchEvent_playerId_idx"
ON "MatchEvent"("playerId");

CREATE INDEX "MatchEvent_teamId_idx"
ON "MatchEvent"("teamId");

CREATE INDEX "ScoreFlow_scorerPlayerId_idx"
ON "ScoreFlow"("scorerPlayerId");

CREATE INDEX "ScoreFlow_scoringTeamId_idx"
ON "ScoreFlow"("scoringTeamId");

CREATE INDEX "Session_userId_idx"
ON "Session"("userId");

CREATE INDEX "Standing_teamId_idx"
ON "Standing"("teamId");

CREATE INDEX "Team_competitionId_idx"
ON "Team"("competitionId");

CREATE INDEX "TeamMatchStats_teamId_idx"
ON "TeamMatchStats"("teamId");

CREATE INDEX "UserFavorite_matchId_idx"
ON "UserFavorite"("matchId");

CREATE INDEX "UserReminder_matchId_idx"
ON "UserReminder"("matchId");

CREATE INDEX "UserTeam_teamId_idx"
ON "UserTeam"("teamId");

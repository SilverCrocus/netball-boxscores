-- Convert the existing compound unique index into the table's primary key.
-- PostgreSQL reuses the index, avoiding a table rewrite.
ALTER TABLE "VerificationToken"
ADD CONSTRAINT "VerificationToken_pkey"
PRIMARY KEY USING INDEX "VerificationToken_identifier_token_key";

-- CentrePass accesses Postgres only through its server-side Prisma connection.
-- Keep the Supabase Data API closed explicitly, even if table grants change.
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Competition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Match" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchQuarter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Player" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerMatchStats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PollLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScoreFlow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Standing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMatchStats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserFavorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserTeam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_data_api_access" ON "Account" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Competition" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Match" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "MatchEvent" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "MatchQuarter" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Player" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "PlayerMatchStats" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "PollLog" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "ScoreFlow" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Session" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Standing" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "Team" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "TeamMatchStats" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "User" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "UserFavorite" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "UserReminder" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "UserTeam" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny_data_api_access" ON "VerificationToken" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

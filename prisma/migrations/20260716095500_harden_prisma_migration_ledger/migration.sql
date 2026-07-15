-- Prisma owns this table through the server-side database role. It must never
-- be readable through Supabase's exposed public Data API schema.
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM anon, authenticated;

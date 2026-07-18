-- PostgreSQL 17 adds MAINTAIN to table privileges. Earlier hardening migrations
-- predate that privilege, so close it for current and future postgres-owned
-- public objects without changing Supabase provider-owned default ACLs.
DO $migration$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public '
      || 'FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
      || 'REVOKE MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END
$migration$;

-- ========================================================================
-- RLS setup — รันบน database ทุกตัวที่ระบบนี้จะไปอยู่ (dev / V3 / production)
-- ถ้าไม่รัน: withRls จะ throw ตอน SET LOCAL ROLE app_user แล้วทุก endpoint พัง 500
--
-- รันด้วย user ที่เป็นเจ้าของตาราง (postgres) ใน DBeaver: Alt+X
-- คำสั่งทั้งหมด idempotent — รันซ้ำได้
-- ========================================================================

-- ---------- 1. role ที่แอปใช้ตอน query ----------
-- ต้องไม่ใช่ superuser และไม่มี BYPASSRLS ไม่งั้น policy ไม่มีผล
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

-- ให้ role ที่ connection string ใช้ (postgres) สลับไปเป็น app_user ได้
GRANT app_user TO CURRENT_USER;

-- ---------- 2. สิทธิ์บนตาราง/sequence ----------
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ตาราง/sequence ที่ prisma migrate สร้างใหม่ในอนาคต
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ---------- 3. เปิด RLS + policy 7 ตาราง × 4 action ----------
-- FORCE จำเป็นสำหรับกรณีที่ app ต่อด้วย table owner
-- (แต่ FORCE ไม่กัน superuser/BYPASSRLS — จึงต้อง SET LOCAL ROLE app_user ใน withRls ด้วย)
DO $$
DECLARE
    t text;
    ctx constant text := 'users_id = NULLIF(current_setting(''app.current_user_id'', true), '''')::int4';
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'temperature_records',
        'heartrate_records',
        'dlocation',
        'fall_records',
        'location',
        'safezone',
        'takecareperson',
        'temperature_settings',
        'heartrate_settings'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS allow_select_own_records ON %I', t);
        EXECUTE format('CREATE POLICY allow_select_own_records ON %I FOR SELECT USING (%s)', t, ctx);

        EXECUTE format('DROP POLICY IF EXISTS allow_insert_own_records ON %I', t);
        EXECUTE format('CREATE POLICY allow_insert_own_records ON %I FOR INSERT WITH CHECK (%s)', t, ctx);

        EXECUTE format('DROP POLICY IF EXISTS allow_update_own_records ON %I', t);
        EXECUTE format('CREATE POLICY allow_update_own_records ON %I FOR UPDATE USING (%s) WITH CHECK (%s)', t, ctx, ctx);

        EXECUTE format('DROP POLICY IF EXISTS allow_delete_own_records ON %I', t);
        EXECUTE format('CREATE POLICY allow_delete_own_records ON %I FOR DELETE USING (%s)', t, ctx);
    END LOOP;
END
$$;

-- ---------- 4. ตรวจผล ----------
-- ต้องได้ 7 แถว enabled=true forced=true
SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
FROM pg_class
WHERE relname IN ('temperature_records','heartrate_records','dlocation',
                  'fall_records','location','safezone','takecareperson')
ORDER BY relname;

-- ต้องได้ 28 แถว
SELECT count(*) AS policy_count FROM pg_policies WHERE schemaname = 'public';

-- app_user ต้องเป็น false ทั้งสองช่อง
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';

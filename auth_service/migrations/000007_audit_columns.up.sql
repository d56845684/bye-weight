-- 稽核欄位 + trigger
--
-- 規範：所有會被編輯的實體表都有 created_by / updated_at / updated_by /
-- deleted_at / deleted_by。junction 與 log 表不套用。
--
-- Trigger 讀 PostgreSQL session 變數 `app.current_user`（應用程式每個 tx 起
-- 頭 SET LOCAL）來填 updated_by / created_by。沒設就保留 NULL。
-- `deleted_at` / `deleted_by` 不用 trigger 自動 —— soft delete 是應用層明確
-- 動作，不該被一般 UPDATE 誤觸發。

BEGIN;

-- ── Trigger function：INSERT 時填 created_by（若 NULL），UPDATE 時填 updated_{at,by} ──
CREATE OR REPLACE FUNCTION audit_autofill() RETURNS TRIGGER AS $$
DECLARE
    uid INT;
BEGIN
    BEGIN
        uid := NULLIF(current_setting('app.current_user', true), '')::INT;
    EXCEPTION WHEN others THEN
        uid := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by IS NULL THEN
            NEW.created_by := uid;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.updated_at := NOW();
        NEW.updated_by := uid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── users / tenants / services / action_mappings / policies / roles 加欄位 + trigger ──
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'tenants', 'services', 'action_mappings', 'policies', 'roles']
    LOOP
        EXECUTE format(
            'ALTER TABLE %I
                 ADD COLUMN IF NOT EXISTS created_by INT,
                 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
                 ADD COLUMN IF NOT EXISTS updated_by INT,
                 ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
                 ADD COLUMN IF NOT EXISTS deleted_by INT', t);
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%s_audit ON %I;
             CREATE TRIGGER trg_%s_audit
                 BEFORE INSERT OR UPDATE ON %I
                 FOR EACH ROW EXECUTE FUNCTION audit_autofill()', t, t, t, t);
    END LOOP;
END $$;

COMMIT;

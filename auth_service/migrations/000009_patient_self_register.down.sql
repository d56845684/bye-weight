BEGIN;

-- 1. 從 patient-self-access.actions 拿掉 main:patient:read / main:patient:register
DO $$
DECLARE
    doc jsonb;
    acts jsonb;
BEGIN
    SELECT document INTO doc FROM policies WHERE name = 'patient-self-access';
    IF doc IS NULL THEN RETURN; END IF;
    acts := doc -> 'statements' -> 0 -> 'actions';
    acts := acts - 'main:patient:read' - 'main:patient:register';
    doc := jsonb_set(doc, '{statements,0,actions}', acts, false);
    UPDATE policies SET document = doc WHERE name = 'patient-self-access';
END $$;

-- 2. 拔掉兩筆 action_mapping
DELETE FROM action_mappings
 WHERE service_id = (SELECT id FROM services WHERE name = 'main')
   AND (
       (http_method = 'GET'  AND url_pattern = '/patients/me')
    OR (http_method = 'POST' AND url_pattern = '/patients/register')
   );

COMMIT;

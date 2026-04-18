BEGIN;

DELETE FROM users WHERE line_uuid = 'dev-admin';

COMMIT;

BEGIN;

-- 刪 password identities
DELETE FROM auth_identities WHERE user_id BETWEEN 1001 AND 1006;

-- 刪 dev users
DELETE FROM users WHERE id BETWEEN 1001 AND 1006;

-- 解綁 policy
DELETE FROM role_policies
WHERE policy_id = (SELECT id FROM policies WHERE name = 'kuji-user-policy')
   OR role_id   = (SELECT id FROM roles    WHERE name = 'kuji_user');

DELETE FROM policies WHERE name = 'kuji-user-policy';
DELETE FROM roles    WHERE name = 'kuji_user';
DELETE FROM action_mappings WHERE service_id = (SELECT id FROM services WHERE name = 'kuji');
DELETE FROM services WHERE name = 'kuji';

COMMIT;

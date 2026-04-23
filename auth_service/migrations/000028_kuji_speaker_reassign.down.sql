BEGIN;

DELETE FROM action_mappings
WHERE service_id = (SELECT id FROM services WHERE name = 'kuji')
  AND url_pattern = '/meetings/{id}/speakers/{speaker_id}'
  AND http_method = 'PATCH';

COMMIT;

BEGIN;

DELETE FROM action_mappings am
USING services s
WHERE am.service_id = s.id
  AND s.name = 'main'
  AND am.http_method = 'GET'
  AND am.url_pattern IN (
      '/inbody/me/summary',
      '/food-logs/me/summary',
      '/visits/me/timeline'
  );

COMMIT;

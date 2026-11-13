-- GitHub's own `schedule:` cron trigger is best-effort and was observed
-- firing 3.5-12 hours late instead of every 30 min (a known platform
-- limitation, not a config bug). pg_cron + pg_net already run in this
-- project, so trigger the workflow_dispatch API from here instead - a real
-- scheduler, not GitHub's deprioritized queue for high-frequency schedules.
select cron.schedule(
  'trigger-scrape-workflow',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/lordgoldjewels/checkregalar/actions/workflows/scrape.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'token ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_pat'),
      'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main')
  );
  $$
);

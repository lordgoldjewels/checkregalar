-- Switch dashboard_snapshots from insert-every-run (full history) to
-- upsert-in-place (one row per account) - the trend chart that used the
-- history is being removed, and hourly runs would otherwise grow this
-- table unboundedly. Keep only the latest row per account first, since
-- a unique constraint can't be added while duplicates exist.
delete from public.dashboard_snapshots
where id not in (
  select distinct on (account_id) id
  from public.dashboard_snapshots
  order by account_id, captured_at desc, id desc
);

alter table public.dashboard_snapshots
  add constraint dashboard_snapshots_account_id_key unique (account_id);

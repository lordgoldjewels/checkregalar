-- Contract-risk alert state.
-- Coverage countdown is per-account (the latest-expiring active digital contract
-- is what keeps the account earning); the deferred-payout countdown is per-bond.
-- All additive.
alter table public.accounts
  add column if not exists coverage_target date,
  add column if not exists coverage_last_alerted date,
  add column if not exists coverage_expired_alerted boolean not null default false;

alter table public.bonds
  add column if not exists payout_stage integer not null default 0;

-- Make the new Telegram toggle visible + persistable in the admin UI. Also seed
-- the three types that were added to ALL_NOTIFICATION_TYPES but never seeded
-- (they currently work only via the default-true fallback).
insert into public.notification_settings (type) values
  ('contract_risk'),
  ('wallet_balance'),
  ('distributor_update'),
  ('bond_update')
on conflict (type) do nothing;

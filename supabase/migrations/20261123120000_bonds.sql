-- Bonds / contracts per account, from GET /api/v1/member/bonds (the "Schemes &
-- Contract" page). Each row is one purchased plan: the committed value, its term
-- (bond_date -> expires_on), and the promotional (cbc) + level-commission
-- (lvlcom) pin-issuance counters, plus refundable-deposit paid so far.
-- Keyed by (account_id, bond_id): each account owns its own contracts. Rows are
-- upserted each run so status / counters / rd_paid reflect the latest snapshot.
-- Watched signal: status active -> matured/completed, or an rd_paid bump, around
-- the 12-month anniversary = the back-half of the CBC payout releasing.
create table if not exists public.bonds (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts (member_id),
  bond_id bigint not null,          -- the API's bond id (stable per account)
  invoice_no text,
  plan_code text,                   -- e.g. P202
  plan_name text,                   -- e.g. G12 Forward contractors
  plan_type text,                   -- gold | digital | ...
  value numeric,                    -- committed contract value
  bond_date date,
  expires_on date,
  status text,                      -- active | matured | completed | ...
  cbc_issued integer,               -- total promotional pins the bond will issue
  cbc_count integer,                -- promotional pins issued so far
  lvlcom_issued integer,
  lvlcom_count integer,
  rd_paid numeric,                  -- refundable deposit paid out so far
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, bond_id)
);
create index if not exists bonds_account_idx on public.bonds (account_id);
create index if not exists bonds_expires_idx on public.bonds (expires_on);

alter table public.bonds enable row level security;
create policy "authenticated can read bonds"
  on public.bonds for select to authenticated using (true);
grant select on public.bonds to authenticated;
grant all on public.bonds to service_role;

-- Distributor network per account, from GET /api/v1/member/genealogy (the full
-- team tree, flattened to one row per member) enriched with joined_on from
-- GET /api/v1/member/downline. Keyed by (account_id, member_code): each account
-- keeps its own view of the tree, so a member who appears under more than one
-- tracked account is stored once per owning account. Rows are upserted each run,
-- so bv / gbv / rank / status / team_size always reflect the latest snapshot.
create table if not exists public.distributors (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts (member_id),
  member_code text not null,
  name text,
  rank text,
  status text,
  bv numeric,
  gbv numeric,
  team_size integer,
  parent_code text,          -- member_code of the upline node (null for the root = the account itself)
  level integer,             -- depth in the tree (0 = root)
  joined_on date,            -- only populated for direct downline (from /member/downline)
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, member_code)
);
create index if not exists distributors_account_idx on public.distributors (account_id);
create index if not exists distributors_parent_idx on public.distributors (account_id, parent_code);

alter table public.distributors enable row level security;
create policy "authenticated can read distributors"
  on public.distributors for select to authenticated using (true);
grant select on public.distributors to authenticated;
grant all on public.distributors to service_role;

-- Wallet withdrawals, from GET /api/v1/member/wallet/withdrawals (one row per
-- request; the API's own id is unique per withdrawal). Status moves
-- pending -> (disbursed / rejected), so rows are upserted, not appended.
create table if not exists public.wallet_withdrawals (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts (member_id),
  withdrawal_id bigint not null,
  branch text,
  amount numeric not null,
  status text,
  disbursal_mode text,
  requested_at timestamptz,
  disbursed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, withdrawal_id)
);
create index if not exists wallet_withdrawals_requested_at_idx on public.wallet_withdrawals (requested_at desc);

alter table public.wallet_withdrawals enable row level security;
create policy "authenticated can read wallet_withdrawals"
  on public.wallet_withdrawals for select to authenticated using (true);
grant select on public.wallet_withdrawals to authenticated;
grant all on public.wallet_withdrawals to service_role;

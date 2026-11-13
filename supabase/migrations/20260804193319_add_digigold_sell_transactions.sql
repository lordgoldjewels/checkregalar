create table public.digigold_sell_transactions (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts(member_id),
  transaction_remarks text not null,
  sell_date date,
  weight_gm numeric,
  gold_worth numeric,
  wallet_remarks text,
  status text,
  created_at timestamptz not null default now(),
  unique (account_id, transaction_remarks)
);

alter table public.digigold_sell_transactions enable row level security;

create policy "authenticated read" on public.digigold_sell_transactions
  for select to authenticated using (true);

grant select on public.digigold_sell_transactions to authenticated;
grant all on public.digigold_sell_transactions to service_role;
grant usage, select on sequence digigold_sell_transactions_id_seq to service_role;

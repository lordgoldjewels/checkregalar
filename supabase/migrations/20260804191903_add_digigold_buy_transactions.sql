create table public.digigold_buy_transactions (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts(member_id),
  order_id text not null,
  buy_date date,
  weight_gm numeric,
  gold_worth numeric,
  price_on_day numeric,
  created_at timestamptz not null default now(),
  unique (account_id, order_id)
);

alter table public.digigold_buy_transactions enable row level security;

create policy "authenticated read" on public.digigold_buy_transactions
  for select to authenticated using (true);

grant select on public.digigold_buy_transactions to authenticated;
grant all on public.digigold_buy_transactions to service_role;
grant usage, select on sequence digigold_buy_transactions_id_seq to service_role;

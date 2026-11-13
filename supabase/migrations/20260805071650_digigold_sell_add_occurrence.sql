alter table public.digigold_sell_transactions
  add column occurrence integer not null default 0;

alter table public.digigold_sell_transactions
  drop constraint digigold_sell_transactions_account_id_date_weight_worth_key;

alter table public.digigold_sell_transactions
  add constraint digigold_sell_transactions_account_id_date_weight_worth_occ_key
  unique (account_id, sell_date, weight_gm, gold_worth, occurrence);

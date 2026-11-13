alter table public.digigold_sell_transactions
  drop constraint digigold_sell_transactions_account_id_transaction_remarks_key;

alter table public.digigold_sell_transactions
  add constraint digigold_sell_transactions_account_id_date_weight_worth_key
  unique (account_id, sell_date, weight_gm, gold_worth);

create table phone_sessions (
  phone_number text primary key,
  storage_state jsonb not null,
  status text not null default 'active',
  updated_at timestamptz not null default now()
);
alter table phone_sessions enable row level security;

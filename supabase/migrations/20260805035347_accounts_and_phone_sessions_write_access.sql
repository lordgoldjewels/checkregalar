-- accounts: add write access (currently SELECT-only for authenticated)
create policy "authenticated can insert accounts" on public.accounts for insert to authenticated with check (true);
create policy "authenticated can update accounts" on public.accounts for update to authenticated using (true) with check (true);
create policy "authenticated can delete accounts" on public.accounts for delete to authenticated using (true);
grant insert, update, delete on public.accounts to authenticated;

-- phone_sessions: currently has RLS enabled with zero policies (no access at all).
-- Grant only the safe columns - never storage_state.
create policy "authenticated can read phone_sessions" on public.phone_sessions for select to authenticated using (true);
create policy "authenticated can update phone_sessions status" on public.phone_sessions for update to authenticated using (true) with check (true);
grant select (phone_number, status, updated_at) on public.phone_sessions to authenticated;
grant update (status) on public.phone_sessions to authenticated;

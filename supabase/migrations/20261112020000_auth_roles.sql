-- Stage 3: profiles on signup, role helpers, row-level security, privileges.
-- Tickets, restocks and the audit log have no write policies on purpose: every write
-- to them goes through the stage 4 business functions (security definer).

-- Profiles are created automatically for every new auth user (default role: staff).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    )
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The shop can never be left without an active admin.
create function public.profiles_guard_last_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'cannot remove the last active admin';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger profiles_guard_last_admin
  before update or delete on public.profiles
  for each row execute function public.profiles_guard_last_admin();

-- Role of the signed-in user; null when signed out or deactivated.
create function public.app_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and active;
$$;

-- Stock quantities for staff, without unit costs.
create function public.stock_levels()
returns table (item public.stock_item, doses integer)
language sql stable security definer
set search_path = ''
as $$
  select i, public.stock_balance(i)
  from unnest(enum_range(null::public.stock_item)) as i
  where public.app_role() is not null;
$$;

-- Privileges: nothing for anon, no writes to ticket-side tables from the API ---------
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke insert, update, delete on public.tickets, public.restocks, public.audit_log from authenticated;
revoke insert, delete on public.profiles, public.settings from authenticated;

revoke all on function public.stock_balance(public.stock_item, uuid) from public, anon, authenticated;
revoke all on function public.tickets_before_write() from public, anon, authenticated;
revoke all on function public.tickets_no_delete() from public, anon, authenticated;
revoke all on function public.append_only() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.profiles_guard_last_admin() from public, anon, authenticated;
revoke all on function public.app_role() from public, anon;
revoke all on function public.stock_levels() from public, anon;
grant execute on function public.app_role() to authenticated;
grant execute on function public.stock_levels() to authenticated;

-- Policies -------------------------------------------------------------------------
-- profiles: own row, or every row for an admin; only an admin can change them.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.app_role()) = 'admin');
create policy profiles_update_admin on public.profiles for update to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

-- machines and price_list: any active user reads, admin writes.
create policy machines_select on public.machines for select to authenticated
  using ((select public.app_role()) is not null);
create policy machines_admin_write on public.machines for all to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy price_list_select on public.price_list for select to authenticated
  using ((select public.app_role()) is not null);
create policy price_list_admin_write on public.price_list for all to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

-- Admin only: settings (hours and estimate assumptions), utility rates, restock costs, audit log.
create policy settings_admin on public.settings for select to authenticated
  using ((select public.app_role()) = 'admin');
create policy settings_admin_update on public.settings for update to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy utility_rates_admin on public.utility_rates for all to authenticated
  using ((select public.app_role()) = 'admin') with check ((select public.app_role()) = 'admin');

create policy restocks_admin_select on public.restocks for select to authenticated
  using ((select public.app_role()) = 'admin');

create policy audit_log_admin_select on public.audit_log for select to authenticated
  using ((select public.app_role()) = 'admin');

-- tickets: staff see open (pending, unvoided) tickets; admin sees everything.
create policy tickets_select_staff on public.tickets for select to authenticated
  using ((select public.app_role()) = 'staff' and status = 'pending' and voided_at is null);
create policy tickets_select_admin on public.tickets for select to authenticated
  using ((select public.app_role()) = 'admin');

-- Admin setup writes: audit trail on the setup tables, and the restock function.

-- Generic row audit. Runs as the table owner so API users never need write access to audit_log.
create function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (table_name, row_id, action, actor, before, after)
  values (
    tg_table_name,
    to_jsonb(coalesce(new, old)) ->> 'id',
    lower(tg_op),
    (select auth.uid()),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;
revoke all on function public.audit_row() from public, anon, authenticated;

create trigger audit_machines      after insert or update or delete on public.machines      for each row execute function public.audit_row();
create trigger audit_price_list    after insert or update or delete on public.price_list    for each row execute function public.audit_row();
create trigger audit_settings      after insert or update or delete on public.settings      for each row execute function public.audit_row();
create trigger audit_utility_rates after insert or update or delete on public.utility_rates for each row execute function public.audit_row();
create trigger audit_profiles      after insert or update or delete on public.profiles      for each row execute function public.audit_row();

-- Restock: admin only; the table itself has no API write access.
create function public.restock(p_item public.stock_item, p_doses integer, p_unit_cost numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'only an admin can restock';
  end if;
  insert into public.restocks (item, doses, unit_cost, created_by)
  values (p_item, p_doses, p_unit_cost, (select auth.uid()))
  returning id into new_id;
  insert into public.audit_log (table_name, row_id, action, actor, after)
  select 'restocks', id::text, 'insert', (select auth.uid()), to_jsonb(r)
  from public.restocks r where id = new_id;
  return new_id;
end;
$$;
revoke all on function public.restock(public.stock_item, integer, numeric) from public, anon;
grant execute on function public.restock(public.stock_item, integer, numeric) to authenticated;

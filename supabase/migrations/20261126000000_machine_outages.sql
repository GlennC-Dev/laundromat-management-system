-- Taking a machine out of service, and bringing it back, with a reason and a history.
-- Only an admin can do either (staff do it through the admin-override edge function, like a void).
-- A machine must have no open ticket to be taken down. While out of service no job can start on it
-- (tickets_before_write already refuses an unavailable machine).

create type public.outage_reason as enum ('broken', 'maintenance', 'out_of_service', 'waiting_for_parts', 'other');

create table public.machine_outages (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete restrict,
  reason     public.outage_reason not null,
  note       text,
  started_at timestamptz not null default now(),
  started_by uuid references public.profiles (id),
  ended_at   timestamptz,
  ended_by   uuid references public.profiles (id),
  end_note   text,
  constraint machine_outages_ended check (ended_at is null or ended_at >= started_at)
);
-- One open outage per machine.
create unique index machine_outages_one_open on public.machine_outages (machine_id) where ended_at is null;
create index machine_outages_machine on public.machine_outages (machine_id, started_at);

alter table public.machine_outages enable row level security;
revoke insert, update, delete on public.machine_outages from authenticated;
create policy machine_outages_select on public.machine_outages for select to authenticated
  using ((select public.app_role()) is not null);

create function public.take_machine_down(
  p_machine_id uuid, p_reason public.outage_reason, p_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.machines;
  after_row public.machines;
  v_note text := nullif(btrim(p_note), '');
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'only an admin can take a machine out of service';
  end if;
  select * into m from public.machines where id = p_machine_id for update;
  if not found then raise exception 'unknown machine'; end if;
  if not m.active then raise exception 'machine % is not active', m.label; end if;
  if m.status = 'out_of_service' then raise exception 'machine % is already out of service', m.label; end if;
  if p_reason = 'other' and v_note is null then raise exception 'describe the problem'; end if;
  if exists (
    select 1 from public.tickets where machine_id = m.id and status = 'pending' and voided_at is null
  ) then
    raise exception 'machine % has an open ticket; finish or void it first', m.label;
  end if;

  insert into public.machine_outages (machine_id, reason, note, started_by)
  values (m.id, p_reason, v_note, (select auth.uid()));
  update public.machines set status = 'out_of_service' where id = m.id returning * into after_row;
  perform public.log_audit('machines', m.id::text, 'take_down', to_jsonb(m),
    to_jsonb(after_row) || jsonb_build_object('reason', p_reason, 'note', v_note));
end;
$$;

create function public.bring_machine_up(p_machine_id uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  m public.machines;
  after_row public.machines;
  v_note text := nullif(btrim(p_note), '');
begin
  if (select public.app_role()) is distinct from 'admin' then
    raise exception 'only an admin can bring a machine back into service';
  end if;
  select * into m from public.machines where id = p_machine_id for update;
  if not found then raise exception 'unknown machine'; end if;
  if m.status <> 'out_of_service' then raise exception 'machine % is not out of service', m.label; end if;

  update public.machine_outages
    set ended_at = now(), ended_by = (select auth.uid()), end_note = v_note
    where machine_id = m.id and ended_at is null;
  update public.machines set status = 'available' where id = m.id returning * into after_row;
  perform public.log_audit('machines', m.id::text, 'bring_up', to_jsonb(m),
    to_jsonb(after_row) || jsonb_build_object('note', v_note));
end;
$$;

-- Changing the status on the Machines page keeps the history too.
create function public.machines_status_outage()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'out_of_service' and old.status is distinct from new.status
     and not exists (select 1 from public.machine_outages where machine_id = new.id and ended_at is null) then
    insert into public.machine_outages (machine_id, reason, note, started_by)
    values (new.id, 'other', 'Set on the Machines page', (select auth.uid()));
  elsif new.status = 'available' and old.status = 'out_of_service' then
    update public.machine_outages
      set ended_at = now(), ended_by = (select auth.uid()), end_note = 'Set on the Machines page'
      where machine_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;
create trigger machines_status_outage after update of status on public.machines
  for each row execute function public.machines_status_outage();

revoke all on function public.take_machine_down(uuid, public.outage_reason, text) from public, anon;
revoke all on function public.bring_machine_up(uuid, text) from public, anon;
revoke all on function public.machines_status_outage() from public, anon, authenticated;
grant execute on function public.take_machine_down(uuid, public.outage_reason, text) to authenticated;
grant execute on function public.bring_machine_up(uuid, text) to authenticated;

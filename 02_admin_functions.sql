-- Execute AFTER the initial schema and issue_queue_numbers function.
-- Only the server's service_role may invoke these functions.
create or replace function public.queue_staff_state()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d date := (now() at time zone 'Europe/Athens')::date;
dayrow public.queue_days%rowtype;
tickets jsonb;
waiting_count integer;
begin
  update public.queue_tickets set status='expired'
    where queue_date=d and status='waiting' and created_at < now()-interval '60 minutes';
  select * into dayrow from public.queue_days where queue_date=d;
  select coalesce(jsonb_agg(jsonb_build_object('number',number,'status',status,'source',source) order by number),'[]'::jsonb),
         count(*) filter(where status='waiting')
    into tickets,waiting_count from public.queue_tickets where queue_date=d;
  return jsonb_build_object('day',d,'next',coalesce(dayrow.next_number,1),'current',dayrow.current_number,
    'paused',coalesce(dayrow.paused,false),'tickets',tickets,'waiting',waiting_count);
end $$;

create or replace function public.queue_admin_action(p_action text,p_paused boolean default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare d date := (now() at time zone 'Europe/Athens')::date;
current_n integer;
next_n integer;
begin
  if p_action not in ('next','finish','skip','pause','reset') then raise exception 'Invalid action'; end if;
  insert into public.queue_days(queue_date) values(d) on conflict do nothing;
  perform 1 from public.queue_days where queue_date=d for update;
  select current_number into current_n from public.queue_days where queue_date=d;
  if p_action='reset' then
    delete from public.queue_tickets where queue_date=d;
    update public.queue_days set next_number=1,current_number=null,paused=false where queue_date=d;
    return;
  end if;
  if p_action='pause' then
    update public.queue_days set paused=coalesce(p_paused,false) where queue_date=d;
    return;
  end if;
  if current_n is not null then
    update public.queue_tickets set status=case when p_action='skip' then 'skipped' else 'served' end
      where queue_date=d and number=current_n and status='called';
  end if;
  update public.queue_days set current_number=null where queue_date=d;
  if p_action='next' then
    update public.queue_tickets set status='expired'
      where queue_date=d and status='waiting' and created_at < now()-interval '60 minutes';
    select number into next_n from public.queue_tickets
      where queue_date=d and status='waiting' order by number limit 1 for update;
    if next_n is not null then
      update public.queue_tickets set status='called' where queue_date=d and number=next_n;
      update public.queue_days set current_number=next_n where queue_date=d;
    end if;
  end if;
end $$;

revoke all on function public.queue_staff_state() from public,anon,authenticated;
revoke all on function public.queue_admin_action(text,boolean) from public,anon,authenticated;
grant execute on function public.queue_staff_state() to service_role;
grant execute on function public.queue_admin_action(text,boolean) to service_role;

create extension if not exists "pgcrypto";

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  symptom text not null default '',
  duration text not null default '',
  therapist_name text not null,
  appointment_date date not null,
  appointment_time text not null,
  note text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists symptom text not null default '';

alter table public.appointments
  add column if not exists duration text not null default '';

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_settings (
  id bigint primary key generated always as identity,
  channel text not null check (channel in ('email_webhook', 'line_webhook')),
  webhook_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.appointment_audit_logs (
  id bigint primary key generated always as identity,
  appointment_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_user_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.appointments enable row level security;
alter table public.admin_users enable row level security;
alter table public.notification_settings enable row level security;
alter table public.appointment_audit_logs enable row level security;

drop policy if exists "public can insert appointments" on public.appointments;
drop policy if exists "public can read appointments" on public.appointments;
drop policy if exists "public can update appointments" on public.appointments;
drop policy if exists "public can delete appointments" on public.appointments;

drop policy if exists "appointments insert public" on public.appointments;
drop policy if exists "appointments select admin only" on public.appointments;
drop policy if exists "appointments update admin only" on public.appointments;
drop policy if exists "appointments delete admin only" on public.appointments;
drop policy if exists "admin users self read" on public.admin_users;
drop policy if exists "notification settings admin read" on public.notification_settings;
drop policy if exists "audit logs admin read" on public.appointment_audit_logs;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- 前台可以匿名送出預約
create policy "appointments insert public"
on public.appointments
for insert
to anon
with check (true);

-- 後台僅管理員可讀
create policy "appointments select admin only"
on public.appointments
for select
to authenticated
using (public.is_admin());

-- 後台僅管理員可改
create policy "appointments update admin only"
on public.appointments
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 後台僅管理員可刪
create policy "appointments delete admin only"
on public.appointments
for delete
to authenticated
using (public.is_admin());

-- 限制同一位調理師在同日期同時段，只能有一筆有效預約
create unique index if not exists uniq_therapist_slot_active
on public.appointments (therapist_name, appointment_date, appointment_time)
where status in ('pending', 'confirmed');

-- 管理員只能讀自己的 admin 對應，用於前端判斷與除錯
create policy "admin users self read"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

create policy "notification settings admin read"
on public.notification_settings
for select
to authenticated
using (public.is_admin());

create policy "audit logs admin read"
on public.appointment_audit_logs
for select
to authenticated
using (public.is_admin());

create or replace function public.write_appointment_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_audit_logs (appointment_id, action, actor_user_id, after_data)
    values (new.id, 'insert', auth.uid(), to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.appointment_audit_logs (appointment_id, action, actor_user_id, before_data, after_data)
    values (new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.appointment_audit_logs (appointment_id, action, actor_user_id, before_data)
    values (old.id, 'delete', auth.uid(), to_jsonb(old));
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_appointment_audit_log on public.appointments;
create trigger trg_appointment_audit_log
after insert or update or delete
on public.appointments
for each row
execute function public.write_appointment_audit_log();

create extension if not exists pg_net;

create or replace function public.send_appointment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  target_url text;
begin
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('confirmed', 'cancelled', 'completed')) then
    payload := jsonb_build_object(
      'event', tg_op,
      'appointment_id', new.id,
      'customer_name', new.customer_name,
      'customer_phone', new.customer_phone,
      'symptom', new.symptom,
      'duration', new.duration,
      'therapist_name', new.therapist_name,
      'appointment_date', new.appointment_date,
      'appointment_time', new.appointment_time,
      'status', new.status,
      'note', new.note
    );

    for target_url in
      select webhook_url
      from public.notification_settings
      where is_active = true
    loop
      perform net.http_post(
        url := target_url,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := payload
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_send_appointment_notification on public.appointments;
create trigger trg_send_appointment_notification
after insert or update
on public.appointments
for each row
execute function public.send_appointment_notification();

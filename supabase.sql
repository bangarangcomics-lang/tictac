-- =====================================================================
-- Tictac · base de datos para Supabase
-- Pega todo este archivo en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------

create table if not exists public.company (
  id int primary key default 1 check (id = 1),
  name text not null,
  cif text not null default '',
  center text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.gerentes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  afil text not null default '',
  mode text not null default 'week' check (mode in ('day', 'week')),
  hours numeric not null check (hours > 0),
  jornadas int not null default 5 check (jornadas between 1 and 7),
  days int[] not null default '{1,2,3,4,5}',
  hol_mode text not null default 'reduce' check (hol_mode in ('reduce', 'keep')),
  can_edit boolean not null default false,
  active boolean not null default true,
  pin_hash text,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  time_in timestamptz not null,
  time_out timestamptz,
  edits jsonb not null default '[]',
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  constraint punches_order check (time_out is null or time_out > time_in)
);
create index if not exists punches_emp_in on public.punches (employee_id, time_in);
create index if not exists punches_in on public.punches (time_in);
-- como mucho una entrada abierta (sin salida) por empleado
create unique index if not exists punches_one_open on public.punches (employee_id) where time_out is null;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  punch_id uuid references public.punches(id) on delete set null,
  kind text not null check (kind in ('edit', 'add')),
  entry_date date not null,
  old_in timestamptz,
  old_out timestamptz,
  new_in timestamptz not null,
  new_out timestamptz,
  reason text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- sesiones de empleado (se crean al entrar con el PIN)
create table if not exists public.emp_sessions (
  token uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  expires_at timestamptz not null
);

-- ---------- Seguridad ----------
-- Solo el gerente (usuario de Supabase registrado en "gerentes") lee y escribe las tablas.
-- Los empleados nunca acceden a las tablas: usan las funciones tt_emp_* con su sesión.

alter table public.company enable row level security;
alter table public.gerentes enable row level security;
alter table public.employees enable row level security;
alter table public.punches enable row level security;
alter table public.notes enable row level security;
alter table public.emp_sessions enable row level security;

revoke all on public.company, public.gerentes, public.employees, public.punches, public.notes, public.emp_sessions from anon;
revoke all on public.emp_sessions from authenticated;

create or replace function public.is_gerente() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gerentes where user_id = auth.uid());
$$;

-- El primer usuario que entra en la app como gerente queda registrado como tal.
create or replace function public.tt_claim_gerente() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from public.gerentes) then
    insert into public.gerentes (user_id) values (auth.uid());
  end if;
  return exists (select 1 from public.gerentes where user_id = auth.uid());
end $$;

drop policy if exists gerente_own on public.gerentes;
create policy gerente_own on public.gerentes for select to authenticated using (user_id = auth.uid());

drop policy if exists gerente_all on public.company;
create policy gerente_all on public.company for all to authenticated using (public.is_gerente()) with check (public.is_gerente());
drop policy if exists gerente_all on public.employees;
create policy gerente_all on public.employees for all to authenticated using (public.is_gerente()) with check (public.is_gerente());
drop policy if exists gerente_all on public.punches;
create policy gerente_all on public.punches for all to authenticated using (public.is_gerente()) with check (public.is_gerente());
drop policy if exists gerente_all on public.notes;
create policy gerente_all on public.notes for all to authenticated using (public.is_gerente()) with check (public.is_gerente());

-- ---------- Funciones del gerente ----------

create or replace function public.tt_set_pin(p_emp uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_gerente() then raise exception 'not_allowed'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'bad_pin'; end if;
  update public.employees
     set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null
   where id = p_emp;
  delete from public.emp_sessions where employee_id = p_emp; -- cierra las sesiones abiertas con el PIN anterior
end $$;

-- ---------- Funciones públicas y de empleado ----------

-- Pantalla de inicio: nombre de la empresa y empleados activos (sin datos sensibles)
create or replace function public.tt_public_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', (select name from public.company where id = 1),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'name', e.name,
               'since', (select p.time_in from public.punches p where p.employee_id = e.id and p.time_out is null limit 1))
             order by e.name)
        from public.employees e where e.active), '[]'::jsonb)
  );
$$;

create or replace function public.tt_session_emp(p_token uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.employee_id
    from public.emp_sessions s join public.employees e on e.id = s.employee_id
   where s.token = p_token and s.expires_at > now() and e.active;
$$;

-- Entrar con PIN. Tras 5 fallos seguidos, el empleado queda bloqueado 15 minutos.
create or replace function public.tt_emp_login(p_emp uuid, p_pin text, p_remember boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  e public.employees;
  t uuid;
begin
  select * into e from public.employees where id = p_emp and active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.locked_until is not null and e.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', e.locked_until);
  end if;
  if e.pin_hash is null or crypt(coalesce(p_pin, ''), e.pin_hash) <> e.pin_hash then
    if e.failed_attempts + 1 >= 5 then
      update public.employees set failed_attempts = 0, locked_until = now() + interval '15 minutes' where id = e.id;
      return jsonb_build_object('ok', false, 'error', 'locked', 'until', now() + interval '15 minutes');
    end if;
    update public.employees set failed_attempts = e.failed_attempts + 1 where id = e.id;
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;
  update public.employees set failed_attempts = 0, locked_until = null where id = e.id;
  delete from public.emp_sessions where expires_at < now();
  insert into public.emp_sessions (employee_id, expires_at)
       values (e.id, now() + case when p_remember then interval '120 days' else interval '12 hours' end)
    returning token into t;
  return jsonb_build_object('ok', true, 'token', t);
end $$;

create or replace function public.tt_emp_logout(p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.emp_sessions where token = p_token;
$$;

-- Datos del empleado: su ficha y sus fichajes de los últimos 45 días
create or replace function public.tt_emp_data(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.tt_session_emp(p_token);
begin
  if v is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  return jsonb_build_object(
    'ok', true,
    'company', (select name from public.company where id = 1),
    'employee', (select to_jsonb(e) - 'pin_hash' - 'failed_attempts' - 'locked_until' from public.employees e where e.id = v),
    'punches', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.time_in)
        from public.punches p
       where p.employee_id = v and (p.time_in > now() - interval '45 days' or p.time_out is null)), '[]'::jsonb)
  );
end $$;

-- Fichar: con la hora del servidor (no se puede falsear desde el móvil)
create or replace function public.tt_emp_punch(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := public.tt_session_emp(p_token);
  o public.punches;
begin
  if v is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  select * into o from public.punches where employee_id = v and time_out is null for update;
  if found then
    if now() - o.time_in < interval '1 minute' then
      return jsonb_build_object('ok', false, 'error', 'too_soon');
    end if;
    update public.punches set time_out = now() where id = o.id;
    return jsonb_build_object('ok', true, 'action', 'out', 'at', now(), 'since', o.time_in);
  end if;
  insert into public.punches (employee_id, time_in) values (v, now());
  return jsonb_build_object('ok', true, 'action', 'in', 'at', now());
end $$;

-- Corregir un fichaje (p_punch) o añadir uno olvidado (p_punch = null). Deja aviso al gerente.
create or replace function public.tt_emp_edit(p_token uuid, p_punch uuid, p_in timestamptz, p_out timestamptz, p_reason text, p_date date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := public.tt_session_emp(p_token);
  e public.employees;
  p public.punches;
  why text := trim(coalesce(p_reason, ''));
  ed jsonb;
begin
  if v is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  select * into e from public.employees where id = v;
  if not e.can_edit then return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if length(why) < 4 then return jsonb_build_object('ok', false, 'error', 'reason'); end if;
  if p_in is null then return jsonb_build_object('ok', false, 'error', 'in_required'); end if;
  if p_in > now() + interval '2 minutes' or (p_out is not null and p_out > now() + interval '2 minutes') then
    return jsonb_build_object('ok', false, 'error', 'future');
  end if;
  if p_out is not null and p_out <= p_in then return jsonb_build_object('ok', false, 'error', 'order'); end if;
  if p_out is not null and p_out - p_in > interval '20 hours' then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;

  if p_punch is null then
    if p_out is null then return jsonb_build_object('ok', false, 'error', 'out_required'); end if;
    ed := jsonb_build_object('at', now(), 'by', 'employee', 'oldIn', null, 'oldOut', null, 'newIn', p_in, 'newOut', p_out, 'reason', why);
    insert into public.punches (employee_id, time_in, time_out, manual, edits)
         values (v, p_in, p_out, true, jsonb_build_array(ed))
      returning * into p;
    insert into public.notes (employee_id, punch_id, kind, entry_date, new_in, new_out, reason)
         values (v, p.id, 'add', p_date, p_in, p_out, why);
  else
    select * into p from public.punches where id = p_punch and employee_id = v for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if p.time_in = p_in and p.time_out is not distinct from p_out then
      return jsonb_build_object('ok', false, 'error', 'no_change');
    end if;
    ed := jsonb_build_object('at', now(), 'by', 'employee', 'oldIn', p.time_in, 'oldOut', p.time_out, 'newIn', p_in, 'newOut', p_out, 'reason', why);
    update public.punches set time_in = p_in, time_out = p_out, edits = edits || jsonb_build_array(ed) where id = p.id;
    insert into public.notes (employee_id, punch_id, kind, entry_date, old_in, old_out, new_in, new_out, reason)
         values (v, p.id, 'edit', p_date, p.time_in, p.time_out, p_in, p_out, why);
  end if;
  return jsonb_build_object('ok', true);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'open_exists');
end $$;

-- ---------- Permisos de las funciones ----------

revoke execute on function public.tt_session_emp(uuid) from public, anon, authenticated;
revoke execute on function public.tt_set_pin(uuid, text) from public, anon;
revoke execute on function public.tt_claim_gerente() from public, anon;
revoke execute on function public.is_gerente() from public, anon;
grant execute on function public.tt_set_pin(uuid, text) to authenticated;
grant execute on function public.tt_claim_gerente() to authenticated;
grant execute on function public.is_gerente() to authenticated;
grant execute on function public.tt_public_info() to anon, authenticated;
grant execute on function public.tt_emp_login(uuid, text, boolean) to anon, authenticated;
grant execute on function public.tt_emp_logout(uuid) to anon, authenticated;
grant execute on function public.tt_emp_data(uuid) to anon, authenticated;
grant execute on function public.tt_emp_punch(uuid) to anon, authenticated;
grant execute on function public.tt_emp_edit(uuid, uuid, timestamptz, timestamptz, text, date) to anon, authenticated;

-- ---------- Tiempo real para el panel del gerente ----------
do $$
begin
  begin alter publication supabase_realtime add table public.punches; exception when others then null; end;
  begin alter publication supabase_realtime add table public.notes; exception when others then null; end;
  begin alter publication supabase_realtime add table public.employees; exception when others then null; end;
end $$;

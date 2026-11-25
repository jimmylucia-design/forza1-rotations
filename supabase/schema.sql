-- Volleyball team app schema (single team, parents join with a code)
create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text unique not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  team_id uuid not null references public.teams on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'parent' check (role in ('admin','scorekeeper','parent')),
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  name text not null,
  number text,
  position text,
  status text not null default 'starter' check (status in ('starter','alternate')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.lineups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  opponent text not null,
  played_on date not null default current_date,
  lineup jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  status text not null default 'live' check (status in ('live','final')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  user_id uuid not null references auth.users on delete cascade,
  player_id uuid not null references public.players on delete cascade,
  primary key (user_id, player_id)
);

-- helpers
create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from members where team_id = t and user_id = auth.uid())
$$;

create or replace function public.has_role(t uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from members where team_id = t and user_id = auth.uid() and role = any(roles))
$$;

create or replace function public.create_team(team_name text, my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; code text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists(select 1 from teams) then raise exception 'A team already exists. Ask the coach for the join code.'; end if;
  code := upper(substr(md5(random()::text), 1, 6));
  insert into teams(name, join_code, created_by) values (team_name, code, auth.uid()) returning id into tid;
  insert into members(team_id, user_id, role, display_name, email)
    values (tid, auth.uid(), 'admin', my_name, (select email from auth.users where id = auth.uid()));
  return tid;
end $$;

create or replace function public.join_team(code text, my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into tid from teams where join_code = upper(trim(code));
  if tid is null then raise exception 'That join code does not match the team.'; end if;
  insert into members(team_id, user_id, role, display_name, email)
    values (tid, auth.uid(), 'parent', my_name, (select email from auth.users where id = auth.uid()))
    on conflict (team_id, user_id) do update set display_name = excluded.display_name;
  return tid;
end $$;

create or replace function public.team_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from teams)
$$;

grant execute on function public.create_team(text,text), public.join_team(text,text), public.team_exists(),
  public.is_member(uuid), public.has_role(uuid,text[]) to authenticated;

-- row level security
alter table public.teams enable row level security;
alter table public.members enable row level security;
alter table public.players enable row level security;
alter table public.lineups enable row level security;
alter table public.matches enable row level security;
alter table public.follows enable row level security;

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to authenticated using (is_member(id));
drop policy if exists teams_admin on public.teams;
create policy teams_admin on public.teams for update to authenticated using (has_role(id, array['admin'])) with check (has_role(id, array['admin']));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (is_member(team_id));
drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members for update to authenticated
  using (has_role(team_id, array['admin'])) with check (has_role(team_id, array['admin']));
drop policy if exists members_self_update on public.members;
create policy members_self_update on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and role = (select m.role from members m where m.team_id = members.team_id and m.user_id = auth.uid()));
drop policy if exists members_admin_delete on public.members;
create policy members_admin_delete on public.members for delete to authenticated using (has_role(team_id, array['admin']));

drop policy if exists players_read on public.players;
create policy players_read on public.players for select to authenticated using (is_member(team_id));
drop policy if exists players_write on public.players;
create policy players_write on public.players for all to authenticated
  using (has_role(team_id, array['admin'])) with check (has_role(team_id, array['admin']));

drop policy if exists lineups_read on public.lineups;
create policy lineups_read on public.lineups for select to authenticated using (is_member(team_id));
drop policy if exists lineups_write on public.lineups;
create policy lineups_write on public.lineups for all to authenticated
  using (has_role(team_id, array['admin'])) with check (has_role(team_id, array['admin']));

drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select to authenticated using (is_member(team_id));
drop policy if exists matches_insert on public.matches;
create policy matches_insert on public.matches for insert to authenticated with check (has_role(team_id, array['admin','scorekeeper']));
drop policy if exists matches_update on public.matches;
create policy matches_update on public.matches for update to authenticated
  using (has_role(team_id, array['admin','scorekeeper'])) with check (has_role(team_id, array['admin','scorekeeper']));
drop policy if exists matches_delete on public.matches;
create policy matches_delete on public.matches for delete to authenticated using (has_role(team_id, array['admin']));

drop policy if exists follows_own on public.follows;
create policy follows_own on public.follows for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists(select 1 from players p where p.id = player_id and is_member(p.team_id)));

-- live updates
alter table public.matches replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.lineups; exception when duplicate_object then null; end;
end $$;

-- API access (new projects may not auto-grant)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.teams, public.members, public.players, public.lineups, public.matches, public.follows to authenticated;

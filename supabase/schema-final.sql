create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('student', 'teacher'));
  end if;
end $$;

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  student_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null,
  student_email text not null,
  course_id text not null,
  course_name text not null,
  exam_id text not null,
  exam_title text not null,
  attempt integer not null,
  score numeric(4,1) not null,
  correct integer not null,
  total integer not null,
  answers jsonb not null default '{}'::jsonb,
  question_ids jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  seconds_used integer not null default 0,
  completion_reason text,
  created_at timestamptz not null default now()
);

alter table public.results add column if not exists submission_id uuid;
alter table public.results add column if not exists student_id uuid references auth.users(id) on delete cascade;
alter table public.results add column if not exists student_name text not null default '';
alter table public.results add column if not exists student_email text not null default '';
alter table public.results add column if not exists course_id text not null default '';
alter table public.results add column if not exists course_name text not null default '';
alter table public.results add column if not exists exam_id text not null default '';
alter table public.results add column if not exists exam_title text not null default '';
alter table public.results add column if not exists attempt integer not null default 1;
alter table public.results add column if not exists score numeric(4,1) not null default 0;
alter table public.results add column if not exists correct integer not null default 0;
alter table public.results add column if not exists total integer not null default 1;
alter table public.results add column if not exists answers jsonb not null default '{}'::jsonb;
alter table public.results add column if not exists question_ids jsonb not null default '[]'::jsonb;
alter table public.results add column if not exists started_at timestamptz;
alter table public.results add column if not exists seconds_used integer not null default 0;
alter table public.results add column if not exists completion_reason text;
alter table public.results add column if not exists created_at timestamptz not null default now();

alter table public.results alter column submission_id set default gen_random_uuid();
update public.results set submission_id = gen_random_uuid() where submission_id is null;
alter table public.results alter column submission_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_submission_id_unique'
      and conrelid = 'public.results'::regclass
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'results_submission_id_key'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_submission_id_unique unique (submission_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_student_exam_attempt_unique'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_student_exam_attempt_unique unique (student_id, exam_id, attempt);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_attempt_check'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_attempt_check check (attempt >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_score_check'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_score_check check (score >= 0 and score <= 20);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_correct_check'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_correct_check check (correct >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_total_check'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_total_check check (total > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'results_seconds_used_check'
      and conrelid = 'public.results'::regclass
  ) then
    alter table public.results
      add constraint results_seconds_used_check check (seconds_used >= 0);
  end if;
end $$;

create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists results_student_id_idx on public.results (student_id);
create index if not exists results_exam_id_idx on public.results (exam_id);
create index if not exists results_created_at_idx on public.results (created_at desc);
create index if not exists results_course_id_idx on public.results (course_id);
create index if not exists results_student_exam_idx on public.results (student_id, exam_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    'student'
  )
  on conflict (id) do update
  set full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
      email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_user_profile();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_user_profile();

create or replace function public.is_teacher(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'teacher'
  );
$$;

alter table public.profiles enable row level security;
alter table public.results enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_teacher" on public.profiles;
drop policy if exists "profiles_update_own_name_email" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "results_insert_own" on public.results;
drop policy if exists "results_select_own" on public.results;
drop policy if exists "results_select_teacher" on public.results;
drop policy if exists "results_delete_teacher" on public.results;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "profiles_select_teacher"
on public.profiles
for select
to authenticated
using (public.is_teacher());

create policy "profiles_update_own_name_email"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "results_insert_own"
on public.results
for insert
to authenticated
with check (student_id = auth.uid());

create policy "results_select_own"
on public.results
for select
to authenticated
using (student_id = auth.uid());

create policy "results_select_teacher"
on public.results
for select
to authenticated
using (public.is_teacher());

create policy "results_delete_teacher"
on public.results
for delete
to authenticated
using (public.is_teacher());

revoke all on public.profiles from anon;
revoke all on public.results from anon;
revoke all on public.profiles from authenticated;
revoke all on public.results from authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, email) on public.profiles to authenticated;
grant select, insert, delete on public.results to authenticated;
grant usage on schema public to authenticated;

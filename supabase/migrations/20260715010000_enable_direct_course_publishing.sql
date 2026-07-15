create table if not exists public.published_courses (
  course_id text primary key,
  name text not null,
  description text not null default '',
  teacher_name text not null default 'Profesor',
  exams jsonb not null default '[]'::jsonb,
  published boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.published_courses enable row level security;

drop policy if exists "published_courses_select" on public.published_courses;
create policy "published_courses_select"
on public.published_courses for select to authenticated
using (published = true);

drop policy if exists "published_courses_teacher_insert" on public.published_courses;
create policy "published_courses_teacher_insert"
on public.published_courses for insert to authenticated
with check (public.is_teacher() and updated_by = auth.uid());

drop policy if exists "published_courses_teacher_update" on public.published_courses;
create policy "published_courses_teacher_update"
on public.published_courses for update to authenticated
using (public.is_teacher())
with check (public.is_teacher() and updated_by = auth.uid());

drop policy if exists "published_courses_teacher_delete" on public.published_courses;
create policy "published_courses_teacher_delete"
on public.published_courses for delete to authenticated
using (public.is_teacher());

create or replace function public.touch_published_courses_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists published_courses_set_updated_at on public.published_courses;
create trigger published_courses_set_updated_at
before update on public.published_courses
for each row execute function public.touch_published_courses_updated_at();

revoke all on public.published_courses from anon, authenticated;
grant select, insert, update, delete on public.published_courses to authenticated;

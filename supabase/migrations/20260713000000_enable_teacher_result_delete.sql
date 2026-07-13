do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'results'
      and policyname = 'results_delete_teacher'
  ) then
    create policy "results_delete_teacher"
    on public.results
    for delete
    to authenticated
    using (public.is_teacher());
  end if;
end
$$;

grant delete on public.results to authenticated;

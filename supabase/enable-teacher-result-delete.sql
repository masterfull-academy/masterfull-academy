drop policy if exists "results_delete_teacher" on public.results;

create policy "results_delete_teacher"
on public.results
for delete
to authenticated
using (public.is_teacher());

grant delete on public.results to authenticated;

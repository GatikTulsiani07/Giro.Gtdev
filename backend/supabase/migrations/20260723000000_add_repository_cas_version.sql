alter table public.repositories
  add column if not exists repository_version bigint not null default 1;

alter table public.repositories
  drop constraint if exists repositories_version_positive,
  add constraint repositories_version_positive check (repository_version >= 1);

create or replace function public.enforce_repository_version_increment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.repository_version = old.repository_version then
    new.repository_version := old.repository_version + 1;
  elsif new.repository_version <> old.repository_version + 1 then
    raise serialization_failure using message = 'repository_concurrency_conflict';
  end if;
  return new;
end;
$$;

drop trigger if exists repositories_enforce_version_increment on public.repositories;
create trigger repositories_enforce_version_increment
before update on public.repositories
for each row execute function public.enforce_repository_version_increment();

revoke all on function public.enforce_repository_version_increment()
  from public, anon, authenticated;
grant execute on function public.enforce_repository_version_increment()
  to service_role;

comment on column public.repositories.repository_version is
  'Monotonic compare-and-swap version incremented by every repository row update.';
comment on function public.enforce_repository_version_increment() is
  'Prevents version skipping and automatically versions transactional repository updates such as snapshot publication.';

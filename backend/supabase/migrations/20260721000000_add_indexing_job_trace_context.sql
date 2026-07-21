alter table public.indexing_jobs
  add column if not exists traceparent text;

alter table public.indexing_jobs
  drop constraint if exists indexing_jobs_traceparent_valid;

alter table public.indexing_jobs
  add constraint indexing_jobs_traceparent_valid check (
    traceparent is null
    or traceparent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'
  );

drop function if exists public.create_indexing_job(
  text, text, text, text, text, text, integer, text
);

create function public.create_indexing_job(
  input_repository_id text,
  input_owner_user_id text,
  input_repository_owner text,
  input_repository_name text,
  input_repository_url text,
  input_branch text,
  input_max_attempts integer,
  input_request_id text default null,
  input_traceparent text default null
)
returns setof public.indexing_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing_job public.indexing_jobs%rowtype;
  created_job public.indexing_jobs%rowtype;
  allocated_sequence bigint;
begin
  select * into existing_job
  from public.indexing_jobs
  where repository_id = input_repository_id
    and status in ('queued', 'claimed', 'running')
  order by created_order, sequence, job_id
  limit 1;

  if found then
    return next existing_job;
    return;
  end if;

  begin
    allocated_sequence := nextval('public.indexing_job_sequence_seq');
    insert into public.indexing_jobs (
      job_id, sequence, repository_id, owner_user_id, repository_owner,
      repository_name, repository_url, branch, max_attempts, request_id,
      traceparent
    ) values (
      'indexing-job-' || allocated_sequence::text,
      allocated_sequence,
      input_repository_id,
      input_owner_user_id,
      input_repository_owner,
      input_repository_name,
      input_repository_url,
      input_branch,
      input_max_attempts,
      input_request_id,
      input_traceparent
    )
    returning * into created_job;
  exception when unique_violation then
    select * into existing_job
    from public.indexing_jobs
    where repository_id = input_repository_id
      and status in ('queued', 'claimed', 'running')
    order by created_order, sequence, job_id
    limit 1;

    if not found then raise; end if;
    return next existing_job;
    return;
  end;

  return next created_job;
end;
$$;

revoke all on function public.create_indexing_job(
  text, text, text, text, text, text, integer, text, text
) from public, anon, authenticated;

grant execute on function public.create_indexing_job(
  text, text, text, text, text, text, integer, text, text
) to service_role;

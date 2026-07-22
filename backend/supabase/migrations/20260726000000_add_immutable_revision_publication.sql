alter table public.repositories
  add column if not exists current_revision text,
  add column if not exists publishing_revision text,
  add column if not exists previous_revision text;

update public.repositories set current_revision = indexed_revision
where current_revision is null and indexed_revision is not null;

alter table public.repositories
  drop constraint if exists repositories_current_revision_sha,
  drop constraint if exists repositories_publishing_revision_sha,
  drop constraint if exists repositories_previous_revision_sha;
alter table public.repositories
  add constraint repositories_current_revision_sha check (current_revision is null or current_revision ~ '^[0-9a-f]{40}$'),
  add constraint repositories_publishing_revision_sha check (publishing_revision is null or publishing_revision ~ '^[0-9a-f]{40}$'),
  add constraint repositories_previous_revision_sha check (previous_revision is null or previous_revision ~ '^[0-9a-f]{40}$');

create or replace function public.begin_repository_snapshot(
  input_repository_id text, input_revision text, input_branch text,
  input_job_id text, input_worker_id text, input_claim_token text
)
returns table (
  already_published boolean, chunk_count integer, file_count integer,
  symbol_count integer, graph_node_count integer, graph_edge_count integer,
  summary_available boolean
)
language plpgsql security invoker set search_path = public as $$
declare repository_row public.repositories%rowtype;
begin
  if input_revision is null or input_revision !~ '^[0-9a-f]{40}$' then
    raise check_violation using message = 'repository revision must be a full lowercase commit SHA';
  end if;
  perform 1 from public.indexing_jobs where job_id = input_job_id
    and repository_id = input_repository_id and claimed_by = input_worker_id
    and claim_token = input_claim_token and status = 'running' and lease_expires_at > now() for update;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;
  select * into repository_row from public.repositories where repository_id = input_repository_id for update;
  if not found then raise foreign_key_violation using message = 'repository does not exist'; end if;
  if repository_row.current_revision = input_revision then
    return query select true, repository_row.chunk_count, repository_row.file_count,
      repository_row.symbol_count, repository_row.graph_node_count,
      repository_row.graph_edge_count, repository_row.metadata_available;
    return;
  end if;
  if repository_row.publishing_revision is not null and repository_row.publishing_revision <> input_revision
    and exists (
      select 1 from public.repository_snapshots s join public.indexing_jobs j on j.job_id = s.job_id
      where s.repository_id = input_repository_id and s.revision = repository_row.publishing_revision
        and s.status = 'building' and j.status in ('claimed','running') and j.lease_expires_at > now()
    ) then raise serialization_failure using message = 'repository_publication_in_progress';
  end if;
  update public.repositories set publishing_revision = input_revision,
    status = case when current_revision is null then 'indexing' else 'indexed' end,
    repository_version = repository_version + 1, updated_at = now()
  where repository_id = input_repository_id;
  if exists (select 1 from public.repository_snapshots s join public.repository_artifacts a
      on a.repository_id = s.repository_id and a.repository_revision = s.revision
      where s.repository_id = input_repository_id and s.revision = input_revision
        and s.status = 'superseded') then
    update public.repository_snapshots set status = 'building', job_id = input_job_id,
      branch = input_branch, updated_at = now()
      where repository_id = input_repository_id and revision = input_revision;
    return query select true, s.chunk_count, s.file_count, s.symbol_count,
      s.graph_node_count, s.graph_edge_count, s.summary_available
      from public.repository_snapshots s
      where s.repository_id = input_repository_id and s.revision = input_revision;
    return;
  end if;
  update public.repository_snapshots set status = 'failed', updated_at = now()
  where repository_id = input_repository_id and job_id = input_job_id
    and status = 'building' and revision <> input_revision;
  insert into public.repository_snapshots(repository_id, revision, commit_sha, branch, job_id, status, updated_at)
  values(input_repository_id, input_revision, input_revision, input_branch, input_job_id, 'building', now())
  on conflict (repository_id, revision) do update set branch = excluded.branch,
    job_id = excluded.job_id, status = 'building', indexed_at = null, updated_at = now()
  where repository_snapshots.status in ('failed','superseded');
  if not exists (select 1 from public.repository_snapshots where repository_id = input_repository_id
    and revision = input_revision and job_id = input_job_id and status = 'building') then
    raise check_violation using message = 'repository revision is already being built';
  end if;
  return query select false, 0, 0, 0, 0, 0, false;
end; $$;

create or replace function public.publish_repository_snapshot(
  input_repository_id text, input_revision text, input_branch text,
  input_job_id text, input_worker_id text, input_claim_token text,
  input_chunk_count integer, input_file_count integer, input_symbol_count integer,
  input_graph_node_count integer, input_graph_edge_count integer,
  input_summary_available boolean, input_index_mode text, input_changed_file_count integer
)
returns void language plpgsql security invoker set search_path = public as $$
declare actual_chunk_count bigint; published_at timestamptz := now(); repository_row public.repositories%rowtype;
begin
  perform 1 from public.indexing_jobs where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status = 'running' and lease_expires_at > published_at for update;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;
  select * into repository_row from public.repositories where repository_id = input_repository_id for update;
  if not found then raise foreign_key_violation using message = 'repository does not exist'; end if;
  if repository_row.current_revision <> input_revision then
    if repository_row.publishing_revision is distinct from input_revision then
      raise serialization_failure using message = 'repository_publication_fence_conflict';
    end if;
    perform 1 from public.repository_snapshots where repository_id = input_repository_id
      and revision = input_revision and job_id = input_job_id and status = 'building' for update;
    if not found then raise check_violation using message = 'repository snapshot is not ready to publish'; end if;
    perform 1 from public.repository_artifacts where repository_id = input_repository_id
      and repository_revision = input_revision;
    if not found then raise check_violation using message = 'repository artifacts are not ready to publish'; end if;
    select count(*) into actual_chunk_count from public.repository_chunks
      where repository = input_repository_id and repository_revision = input_revision;
    if actual_chunk_count <> input_chunk_count then
      raise check_violation using message = 'repository snapshot chunk count does not match';
    end if;
    update public.repository_snapshots set status = 'superseded', indexed_at = null, updated_at = published_at
      where repository_id = input_repository_id and status = 'published';
    update public.repository_snapshots set status = 'published', indexed_at = published_at,
      updated_at = published_at, branch = input_branch, chunk_count = input_chunk_count,
      file_count = input_file_count, symbol_count = input_symbol_count,
      graph_node_count = input_graph_node_count, graph_edge_count = input_graph_edge_count,
      summary_available = input_summary_available
      where repository_id = input_repository_id and revision = input_revision
        and job_id = input_job_id and status = 'building';
    update public.repositories set status = 'indexed', previous_revision = current_revision,
      current_revision = input_revision, indexed_revision = input_revision, publishing_revision = null,
      indexed_at = published_at, first_indexed_at = coalesce(first_indexed_at, published_at),
      last_indexed_at = published_at, indexing_mode = input_index_mode,
      last_changed_file_count = input_changed_file_count, chunk_count = input_chunk_count,
      file_count = input_file_count, symbol_count = input_symbol_count,
      graph_node_count = input_graph_node_count, graph_edge_count = input_graph_edge_count,
      metadata_available = input_summary_available, total_indexed_files = input_file_count,
      repository_version = repository_version + 1, updated_at = published_at
      where repository_id = input_repository_id;
  else
    update public.repositories set publishing_revision = null,
      repository_version = repository_version + 1, updated_at = published_at
      where repository_id = input_repository_id and publishing_revision = input_revision;
  end if;
  update public.indexing_jobs set status = 'succeeded', progress = 100, current_stage = 'complete'
    where job_id = input_job_id and claimed_by = input_worker_id and claim_token = input_claim_token
      and status = 'running' and lease_expires_at > published_at;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;
end; $$;

create or replace function public.discard_repository_snapshot(
  input_repository_id text, input_revision text, input_job_id text,
  input_worker_id text, input_claim_token text
)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.indexing_jobs where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status in ('claimed','running') and lease_expires_at > now() for update;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;
  perform 1 from public.repositories where repository_id = input_repository_id for update;
  if exists (select 1 from public.repositories where repository_id = input_repository_id
    and current_revision = input_revision) then return; end if;
  if exists (select 1 from public.repositories where repository_id = input_repository_id
    and previous_revision = input_revision) then
    update public.repository_snapshots set status = 'superseded', indexed_at = null, updated_at = now()
      where repository_id = input_repository_id and revision = input_revision
        and job_id = input_job_id and status = 'building';
  else
    delete from public.repository_chunks where repository = input_repository_id and repository_revision = input_revision;
    delete from public.repository_summaries where repository = input_repository_id and repository_revision = input_revision;
    delete from public.repository_artifacts where repository_id = input_repository_id and repository_revision = input_revision;
    update public.repository_snapshots set status = 'failed', indexed_at = null, updated_at = now()
      where repository_id = input_repository_id and revision = input_revision
        and job_id = input_job_id and status = 'building';
  end if;
  update public.repositories set publishing_revision = null,
    status = case when current_revision is null then 'failed' else 'indexed' end,
    repository_version = repository_version + 1, updated_at = now()
    where repository_id = input_repository_id and publishing_revision = input_revision;
end; $$;

create or replace function public.get_current_repository_artifacts(input_repository_id text)
returns table(repository_id text, repository_revision text, graph jsonb, summary jsonb,
  file_snapshot jsonb, symbol_index jsonb, graph_source jsonb)
language sql stable security invoker set search_path = public as $$
  select a.repository_id, a.repository_revision, a.graph, a.summary,
    a.file_snapshot, a.symbol_index, a.graph_source
  from public.repositories r join public.repository_artifacts a
    on a.repository_id = r.repository_id and a.repository_revision = r.current_revision
  where r.repository_id = input_repository_id;
$$;

create or replace function public.collect_repository_artifacts(input_repository_id text, input_retention_count integer default 3)
returns integer language plpgsql security invoker set search_path = public as $$
declare deleted_count integer := 0; repository_row public.repositories%rowtype;
begin
  if input_retention_count < 1 then raise check_violation using message = 'retention count must be positive'; end if;
  select * into repository_row from public.repositories where repository_id = input_repository_id for update;
  if not found then return 0; end if;
  with retained as (
    select revision from public.repository_snapshots where repository_id = input_repository_id
      and status in ('published','superseded') order by coalesce(indexed_at, updated_at) desc, revision
      limit input_retention_count
  ), deleted as (
    delete from public.repository_snapshots s where s.repository_id = input_repository_id
      and s.status <> 'building' and s.revision <> coalesce(repository_row.current_revision, '')
      and s.revision <> coalesce(repository_row.publishing_revision, '')
      and s.revision <> coalesce(repository_row.previous_revision, '')
      and not exists (select 1 from retained r where r.revision = s.revision) returning revision
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end; $$;

create or replace function public.rollback_repository_revision(input_repository_id text)
returns text language plpgsql security invoker set search_path = public as $$
declare repository_row public.repositories%rowtype; rollback_revision text;
begin
  select * into repository_row from public.repositories where repository_id = input_repository_id for update;
  if not found then raise foreign_key_violation using message = 'repository does not exist'; end if;
  if repository_row.publishing_revision is not null then
    raise serialization_failure using message = 'repository_publication_in_progress';
  end if;
  rollback_revision := repository_row.previous_revision;
  if rollback_revision is null or not exists (select 1 from public.repository_artifacts
    where repository_id = input_repository_id and repository_revision = rollback_revision) then
    raise check_violation using message = 'repository rollback revision is unavailable';
  end if;
  update public.repository_snapshots set status = 'superseded', indexed_at = null, updated_at = now()
    where repository_id = input_repository_id and revision = repository_row.current_revision;
  update public.repository_snapshots set status = 'published', indexed_at = now(), updated_at = now()
    where repository_id = input_repository_id and revision = rollback_revision;
  update public.repositories set current_revision = rollback_revision, indexed_revision = rollback_revision,
    previous_revision = repository_row.current_revision, repository_version = repository_version + 1,
    status = 'indexed',
    chunk_count = (select chunk_count from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    file_count = (select file_count from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    symbol_count = (select symbol_count from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    graph_node_count = (select graph_node_count from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    graph_edge_count = (select graph_edge_count from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    metadata_available = (select summary_available from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    total_indexed_files = (select file_count from public.repository_snapshots where repository_id = input_repository_id and revision = rollback_revision),
    updated_at = now() where repository_id = input_repository_id;
  return rollback_revision;
end; $$;

revoke all on function public.rollback_repository_revision(text) from public, anon, authenticated;
grant execute on function public.rollback_repository_revision(text) to service_role;

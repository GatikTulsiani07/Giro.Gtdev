create table if not exists public.repository_artifacts (
  repository_id text not null,
  repository_revision text not null,
  graph jsonb not null,
  summary jsonb not null,
  file_snapshot jsonb not null,
  symbol_index jsonb not null,
  graph_source jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repository_id, repository_revision),
  constraint repository_artifacts_snapshot_fk
    foreign key (repository_id, repository_revision)
    references public.repository_snapshots(repository_id, revision) on delete cascade,
  constraint repository_artifacts_revision_sha
    check (repository_revision ~ '^[0-9a-f]{40}$'),
  constraint repository_artifacts_json_shapes check (
    jsonb_typeof(graph) = 'object' and jsonb_typeof(summary) = 'object'
    and jsonb_typeof(file_snapshot) = 'object'
    and jsonb_typeof(symbol_index) = 'array'
    and jsonb_typeof(graph_source) = 'array'
  )
);

create index if not exists repository_artifacts_revision_idx
  on public.repository_artifacts (repository_revision, repository_id);
create index if not exists repository_artifacts_cleanup_idx
  on public.repository_artifacts (repository_id, updated_at desc);

alter table public.repository_artifacts enable row level security;
revoke all on table public.repository_artifacts from public, anon, authenticated;
grant all on table public.repository_artifacts to service_role;

create or replace function public.stage_repository_artifacts(
  input_repository_id text,
  input_repository_revision text,
  input_job_id text,
  input_worker_id text,
  input_claim_token text,
  input_graph jsonb,
  input_summary jsonb,
  input_file_snapshot jsonb,
  input_symbol_index jsonb,
  input_graph_source jsonb
)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.indexing_jobs
  where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status = 'running' and lease_expires_at > now()
  for update;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;

  perform 1 from public.repository_snapshots
  where repository_id = input_repository_id and revision = input_repository_revision
    and job_id = input_job_id and status = 'building'
  for update;
  if not found then raise check_violation using message = 'repository snapshot is not accepting artifacts'; end if;

  insert into public.repository_artifacts (
    repository_id, repository_revision, graph, summary, file_snapshot,
    symbol_index, graph_source
  ) values (
    input_repository_id, input_repository_revision, input_graph, input_summary,
    input_file_snapshot, input_symbol_index, input_graph_source
  )
  on conflict (repository_id, repository_revision) do update set
    graph = excluded.graph, summary = excluded.summary,
    file_snapshot = excluded.file_snapshot, symbol_index = excluded.symbol_index,
    graph_source = excluded.graph_source, updated_at = now();
end;
$$;

-- Replaces the prior publisher. Artifacts, the active revision pointer, snapshot
-- state, repository CAS update, and job completion share this transaction.
create or replace function public.publish_repository_snapshot(
  input_repository_id text, input_revision text, input_branch text,
  input_job_id text, input_worker_id text, input_claim_token text,
  input_chunk_count integer, input_file_count integer, input_symbol_count integer,
  input_graph_node_count integer, input_graph_edge_count integer,
  input_summary_available boolean, input_index_mode text,
  input_changed_file_count integer
)
returns void language plpgsql security invoker set search_path = public as $$
declare
  actual_chunk_count bigint;
  published_at timestamptz := now();
begin
  perform 1 from public.indexing_jobs
  where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status = 'running' and lease_expires_at > published_at for update;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;
  perform 1 from public.repositories where repository_id = input_repository_id for update;
  if not found then raise foreign_key_violation using message = 'repository does not exist'; end if;

  if not exists (select 1 from public.repositories
    where repository_id = input_repository_id and indexed_revision = input_revision) then
    perform 1 from public.repository_snapshots
    where repository_id = input_repository_id and revision = input_revision
      and job_id = input_job_id and status = 'building' for update;
    if not found then raise check_violation using message = 'repository snapshot is not ready to publish'; end if;
    perform 1 from public.repository_artifacts
    where repository_id = input_repository_id and repository_revision = input_revision;
    if not found then raise check_violation using message = 'repository artifacts are not ready to publish'; end if;
    select count(*) into actual_chunk_count from public.repository_chunks
    where repository = input_repository_id and repository_revision = input_revision;
    if actual_chunk_count <> input_chunk_count then
      raise check_violation using message = 'repository snapshot chunk count does not match';
    end if;

    update public.repository_snapshots set status = 'superseded', indexed_at = null,
      updated_at = published_at
    where repository_id = input_repository_id and status = 'published';
    update public.repository_snapshots set status = 'published', indexed_at = published_at,
      updated_at = published_at, branch = input_branch, chunk_count = input_chunk_count,
      file_count = input_file_count, symbol_count = input_symbol_count,
      graph_node_count = input_graph_node_count, graph_edge_count = input_graph_edge_count,
      summary_available = input_summary_available
    where repository_id = input_repository_id and revision = input_revision
      and job_id = input_job_id and status = 'building';
    update public.repositories set status = 'indexed', indexed_revision = input_revision,
      indexed_at = published_at, first_indexed_at = coalesce(first_indexed_at, published_at),
      last_indexed_at = published_at, indexing_mode = input_index_mode,
      last_changed_file_count = input_changed_file_count, chunk_count = input_chunk_count,
      file_count = input_file_count, symbol_count = input_symbol_count,
      graph_node_count = input_graph_node_count, graph_edge_count = input_graph_edge_count,
      metadata_available = input_summary_available, total_indexed_files = input_file_count,
      updated_at = published_at
    where repository_id = input_repository_id;
  end if;

  update public.indexing_jobs set status = 'succeeded', progress = 100,
    current_stage = 'complete'
  where job_id = input_job_id and claimed_by = input_worker_id
    and claim_token = input_claim_token and status = 'running'
    and lease_expires_at > published_at;
  if not found then raise serialization_failure using message = 'indexing_job_lease_conflict'; end if;
end;
$$;

create or replace function public.get_repository_artifacts(
  input_repository_id text, input_repository_revision text
)
returns table (
  repository_id text, repository_revision text, graph jsonb, summary jsonb,
  file_snapshot jsonb, symbol_index jsonb, graph_source jsonb
) language sql stable security invoker set search_path = public as $$
  select a.repository_id, a.repository_revision, a.graph, a.summary,
    a.file_snapshot, a.symbol_index, a.graph_source
  from public.repository_artifacts a
  join public.repository_snapshots s on s.repository_id = a.repository_id
    and s.revision = a.repository_revision
  where a.repository_id = input_repository_id
    and a.repository_revision = input_repository_revision
    and s.status in ('published', 'superseded');
$$;

create or replace function public.get_current_repository_artifacts(input_repository_id text)
returns table (
  repository_id text, repository_revision text, graph jsonb, summary jsonb,
  file_snapshot jsonb, symbol_index jsonb, graph_source jsonb
) language sql stable security invoker set search_path = public as $$
  select a.repository_id, a.repository_revision, a.graph, a.summary,
    a.file_snapshot, a.symbol_index, a.graph_source
  from public.repositories r
  join public.repository_artifacts a on a.repository_id = r.repository_id
    and a.repository_revision = r.indexed_revision
  where r.repository_id = input_repository_id;
$$;

create or replace function public.collect_repository_artifacts(
  input_repository_id text, input_retention_count integer default 3
)
returns integer language plpgsql security invoker set search_path = public as $$
declare deleted_count integer := 0;
begin
  if input_retention_count < 1 then raise check_violation using message = 'retention count must be positive'; end if;
  perform 1 from public.repositories where repository_id = input_repository_id for update;
  if not found then return 0; end if;
  with retained as (
    select revision from public.repository_snapshots
    where repository_id = input_repository_id and status in ('published', 'superseded')
    order by coalesce(indexed_at, updated_at) desc, revision
    limit input_retention_count
  ), deleted as (
    delete from public.repository_snapshots s
    where s.repository_id = input_repository_id and s.status <> 'building'
      and s.revision <> coalesce((select indexed_revision from public.repositories
        where repository_id = input_repository_id), '')
      and not exists (select 1 from retained r where r.revision = s.revision)
    returning revision
  ) select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;

revoke all on function public.stage_repository_artifacts(text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.get_repository_artifacts(text,text) from public, anon, authenticated;
revoke all on function public.get_current_repository_artifacts(text) from public, anon, authenticated;
revoke all on function public.collect_repository_artifacts(text,integer) from public, anon, authenticated;
grant execute on function public.stage_repository_artifacts(text,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.get_repository_artifacts(text,text) to service_role;
grant execute on function public.get_current_repository_artifacts(text) to service_role;
grant execute on function public.collect_repository_artifacts(text,integer) to service_role;

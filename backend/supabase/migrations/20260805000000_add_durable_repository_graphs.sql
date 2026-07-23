create table if not exists public.repository_graph_versions (
  graph_version text primary key,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  parser_version text not null,
  graph_schema_version text not null default 'repository-graph-v1',
  job_id text references public.indexing_jobs(job_id) on delete set null,
  status text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint repository_graph_versions_revision_fkey
    foreign key (repository_id, repository_revision)
    references public.repository_snapshots(repository_id, revision) on delete cascade,
  constraint repository_graph_versions_identity_unique
    unique (graph_version, repository_id, repository_revision, parser_version),
  constraint repository_graph_versions_status_valid
    check (status in ('building', 'validating', 'published', 'failed', 'superseded')),
  constraint repository_graph_versions_metadata_present check (
    btrim(graph_version) <> '' and btrim(repository_revision) <> ''
    and btrim(parser_version) <> '' and btrim(graph_schema_version) <> ''
  ),
  constraint repository_graph_versions_publication_timestamp check (
    status <> 'published' or published_at is not null
  )
);

create unique index if not exists repository_graph_versions_single_pending_idx
  on public.repository_graph_versions(repository_id, repository_revision)
  where status in ('building', 'validating');
create index if not exists repository_graph_versions_revision_parser_idx
  on public.repository_graph_versions(
    repository_id, repository_revision, parser_version, status, published_at desc
  );
create index if not exists repository_graph_versions_retention_idx
  on public.repository_graph_versions(repository_id, status, published_at desc, updated_at)
  where status in ('failed', 'superseded', 'building', 'validating');

create table if not exists public.repository_graph_nodes (
  graph_version text not null
    references public.repository_graph_versions(graph_version) on delete cascade,
  node_id text not null,
  repository_id text not null,
  repository_revision text not null,
  parser_version text not null,
  kind text not null,
  name text not null,
  qualified_name text not null,
  file_path text not null,
  language text not null,
  start_line integer not null,
  end_line integer not null,
  start_column integer not null,
  end_column integer not null,
  exported boolean not null default false,
  default_export boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  primary key (graph_version, node_id),
  constraint repository_graph_nodes_version_identity_fkey
    foreign key (graph_version, repository_id, repository_revision, parser_version)
    references public.repository_graph_versions(
      graph_version, repository_id, repository_revision, parser_version
    ) on delete cascade,
  constraint repository_graph_nodes_location_valid check (
    start_line > 0 and end_line >= start_line
    and start_column > 0 and end_column > 0
  ),
  constraint repository_graph_nodes_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists repository_graph_nodes_symbol_idx
  on public.repository_graph_nodes(
    repository_id, repository_revision, parser_version, name, kind, file_path
  );
create index if not exists repository_graph_nodes_file_location_idx
  on public.repository_graph_nodes(
    graph_version, file_path, start_line, end_line, node_id
  );
create index if not exists repository_graph_nodes_qualified_name_idx
  on public.repository_graph_nodes(graph_version, qualified_name, node_id);

create table if not exists public.repository_graph_edges (
  graph_version text not null
    references public.repository_graph_versions(graph_version) on delete cascade,
  edge_id text not null,
  repository_id text not null,
  repository_revision text not null,
  parser_version text not null,
  from_node_id text not null,
  to_node_id text not null,
  kind text not null,
  distance integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  primary key (graph_version, edge_id),
  constraint repository_graph_edges_version_identity_fkey
    foreign key (graph_version, repository_id, repository_revision, parser_version)
    references public.repository_graph_versions(
      graph_version, repository_id, repository_revision, parser_version
    ) on delete cascade,
  constraint repository_graph_edges_distance_valid check (distance > 0),
  constraint repository_graph_edges_kind_valid check (
    kind in (
      'contains', 'imports', 'exports', 're_exports', 'references', 'calls',
      'extends', 'implements', 'overrides', 'resolves_to', 'overriddenBy',
      'parent', 'child'
    )
  ),
  constraint repository_graph_edges_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists repository_graph_edges_outbound_idx
  on public.repository_graph_edges(graph_version, from_node_id, kind, to_node_id);
create index if not exists repository_graph_edges_inbound_idx
  on public.repository_graph_edges(graph_version, to_node_id, kind, from_node_id);
create index if not exists repository_graph_edges_kind_idx
  on public.repository_graph_edges(graph_version, kind, edge_id);

create table if not exists public.repository_graph_diagnostics (
  graph_version text primary key
    references public.repository_graph_versions(graph_version) on delete cascade,
  parsed_file_count integer not null default 0,
  parser_failure_count integer not null default 0,
  unresolved_import_count integer not null default 0,
  import_count integer not null default 0,
  unresolved_file_ratio double precision not null default 0,
  parser_failure_ratio double precision not null default 0,
  orphan_symbol_count integer not null default 0,
  duplicate_node_id_count integer not null default 0,
  duplicate_edge_id_count integer not null default 0,
  missing_endpoint_count integer not null default 0,
  impossible_self_edge_count integer not null default 0,
  graph_bytes bigint not null default 0,
  duration_ms double precision not null default 0,
  is_valid boolean,
  validated_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  constraint repository_graph_diagnostics_counts_valid check (
    parsed_file_count >= 0 and parser_failure_count >= 0
    and unresolved_import_count >= 0 and import_count >= 0
    and orphan_symbol_count >= 0 and duplicate_node_id_count >= 0
    and duplicate_edge_id_count >= 0 and missing_endpoint_count >= 0
    and impossible_self_edge_count >= 0 and graph_bytes >= 0 and duration_ms >= 0
    and unresolved_file_ratio between 0 and 1
    and parser_failure_ratio between 0 and 1
  ),
  constraint repository_graph_diagnostics_details_object
    check (jsonb_typeof(details) = 'object')
);

create table if not exists public.repository_graph_publications (
  repository_id text primary key
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  parser_version text not null,
  graph_version text not null unique,
  published_at timestamptz not null,
  constraint repository_graph_publications_version_identity_fkey
    foreign key (graph_version, repository_id, repository_revision, parser_version)
    references public.repository_graph_versions(
      graph_version, repository_id, repository_revision, parser_version
    ) on delete restrict
);

create index if not exists repository_graph_publications_revision_idx
  on public.repository_graph_publications(
    repository_id, repository_revision, parser_version, graph_version
  );

create or replace function public.enforce_repository_graph_immutability()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.graph_version is distinct from old.graph_version
    or new.repository_id is distinct from old.repository_id
    or new.repository_revision is distinct from old.repository_revision
    or new.parser_version is distinct from old.parser_version
    or new.graph_schema_version is distinct from old.graph_schema_version
    or new.created_at is distinct from old.created_at then
    raise check_violation using message = 'repository graph version identity is immutable';
  end if;
  return new;
end; $$;

drop trigger if exists repository_graph_versions_immutable_identity_trigger
  on public.repository_graph_versions;
create trigger repository_graph_versions_immutable_identity_trigger
before update on public.repository_graph_versions
for each row execute function public.enforce_repository_graph_immutability();

create or replace function public.enforce_repository_graph_content_mutability()
returns trigger language plpgsql security invoker set search_path = public as $$
declare content_graph_version text := coalesce(new.graph_version, old.graph_version);
declare version_status text;
begin
  select status into version_status from public.repository_graph_versions
  where graph_version = content_graph_version;
  if tg_op = 'INSERT' and version_status is distinct from 'building' then
    raise check_violation using message = 'repository graph is immutable';
  elsif tg_op = 'UPDATE' and version_status is distinct from 'building' then
    raise check_violation using message = 'repository graph is immutable';
  elsif tg_op = 'DELETE'
    and version_status is not null
    and version_status not in ('building', 'failed', 'superseded') then
    raise check_violation using message = 'published repository graph is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

drop trigger if exists repository_graph_nodes_mutability_trigger
  on public.repository_graph_nodes;
create trigger repository_graph_nodes_mutability_trigger
before insert or update or delete on public.repository_graph_nodes
for each row execute function public.enforce_repository_graph_content_mutability();

drop trigger if exists repository_graph_edges_mutability_trigger
  on public.repository_graph_edges;
create trigger repository_graph_edges_mutability_trigger
before insert or update or delete on public.repository_graph_edges
for each row execute function public.enforce_repository_graph_content_mutability();

create or replace function public.begin_repository_graph_version(
  input_repository_id text,
  input_repository_revision text,
  input_graph_version text,
  input_parser_version text,
  input_job_id text,
  input_worker_id text,
  input_claim_token text
)
returns table(already_published boolean, graph_version text)
language plpgsql security invoker set search_path = public as $$
declare existing public.repository_graph_versions%rowtype;
begin
  perform 1 from public.indexing_jobs
  where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status = 'running' and lease_expires_at > now()
  for update;
  if not found then
    raise serialization_failure using message = 'indexing_job_lease_conflict';
  end if;
  perform 1 from public.repository_snapshots
  where repository_id = input_repository_id and revision = input_repository_revision
    and (
      (status = 'building' and job_id = input_job_id)
      or status = 'published'
    )
  for update;
  if not found then
    raise check_violation using message = 'repository snapshot is not ready for graph staging';
  end if;

  select * into existing from public.repository_graph_versions
  where repository_graph_versions.graph_version = input_graph_version
  for update;
  if found then
    if existing.repository_id is distinct from input_repository_id
      or existing.repository_revision is distinct from input_repository_revision
      or existing.parser_version is distinct from input_parser_version then
      raise check_violation using message = 'repository graph version configuration mismatch';
    end if;
    if existing.status = 'published'
      and exists (
        select 1 from public.repository_graph_publications publications
        join public.repository_graph_diagnostics diagnostics
          on diagnostics.graph_version = publications.graph_version
          and diagnostics.is_valid
        where publications.repository_id = input_repository_id
          and publications.repository_revision = input_repository_revision
          and publications.graph_version = input_graph_version
      ) then
      return query select true, input_graph_version;
      return;
    end if;
    if existing.status in ('building', 'validating') and existing.job_id <> input_job_id then
      raise serialization_failure using message = 'repository_graph_publication_in_progress';
    end if;
    update public.repository_graph_versions
    set status = 'building', job_id = input_job_id, published_at = null, updated_at = now()
    where repository_graph_versions.graph_version = input_graph_version;
    delete from public.repository_graph_edges where repository_graph_edges.graph_version = input_graph_version;
    delete from public.repository_graph_nodes where repository_graph_nodes.graph_version = input_graph_version;
    delete from public.repository_graph_diagnostics where repository_graph_diagnostics.graph_version = input_graph_version;
  else
    insert into public.repository_graph_versions(
      graph_version, repository_id, repository_revision, parser_version, job_id, status
    ) values (
      input_graph_version, input_repository_id, input_repository_revision,
      input_parser_version, input_job_id, 'building'
    );
  end if;
  return query select false, input_graph_version;
end; $$;

create or replace function public.stage_repository_graph_version(
  input_repository_id text,
  input_repository_revision text,
  input_graph_version text,
  input_job_id text,
  input_worker_id text,
  input_claim_token text,
  input_nodes jsonb,
  input_edges jsonb,
  input_diagnostics jsonb
)
returns void language plpgsql security invoker set search_path = public as $$
declare duplicate_nodes integer;
declare duplicate_edges integer;
begin
  perform 1 from public.indexing_jobs
  where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status = 'running' and lease_expires_at > now()
  for update;
  if not found then
    raise serialization_failure using message = 'indexing_job_lease_conflict';
  end if;
  perform 1 from public.repository_graph_versions
  where graph_version = input_graph_version
    and repository_id = input_repository_id
    and repository_revision = input_repository_revision
    and job_id = input_job_id and status = 'building'
  for update;
  if not found then
    raise check_violation using message = 'repository graph is not mutable';
  end if;
  if jsonb_typeof(input_nodes) <> 'array'
    or jsonb_typeof(input_edges) <> 'array'
    or jsonb_typeof(input_diagnostics) <> 'object' then
    raise check_violation using message = 'repository graph payload is invalid';
  end if;

  select count(*) - count(distinct item->>'nodeId') into duplicate_nodes
  from jsonb_array_elements(input_nodes) item;
  select count(*) - count(distinct item->>'edgeId') into duplicate_edges
  from jsonb_array_elements(input_edges) item;

  delete from public.repository_graph_edges where graph_version = input_graph_version;
  delete from public.repository_graph_nodes where graph_version = input_graph_version;

  insert into public.repository_graph_nodes(
    graph_version, node_id, repository_id, repository_revision, parser_version,
    kind, name, qualified_name, file_path, language, start_line, end_line,
    start_column, end_column, exported, default_export, metadata
  )
  select input_graph_version, item->>'nodeId', input_repository_id,
    input_repository_revision, versions.parser_version, item->>'kind',
    item->>'name', item->>'qualifiedName', coalesce(item->>'file', ''),
    coalesce(item->>'language', 'unknown'), (item->>'line')::integer,
    (item->>'endLine')::integer, (item->>'column')::integer,
    (item->>'endColumn')::integer, coalesce((item->>'exported')::boolean, false),
    coalesce((item->>'defaultExport')::boolean, false),
    coalesce(item->'metadata', '{}'::jsonb)
  from jsonb_array_elements(input_nodes) item
  join public.repository_graph_versions versions
    on versions.graph_version = input_graph_version
  where item ? 'nodeId'
  on conflict (graph_version, node_id) do nothing;

  insert into public.repository_graph_edges(
    graph_version, edge_id, repository_id, repository_revision, parser_version,
    from_node_id, to_node_id, kind, distance, metadata
  )
  select input_graph_version, item->>'edgeId', input_repository_id,
    input_repository_revision, versions.parser_version, item->>'fromNodeId',
    item->>'toNodeId', item->>'kind', coalesce((item->>'distance')::integer, 1),
    coalesce(item->'metadata', '{}'::jsonb)
  from jsonb_array_elements(input_edges) item
  join public.repository_graph_versions versions
    on versions.graph_version = input_graph_version
  where item ? 'edgeId'
  on conflict (graph_version, edge_id) do nothing;

  insert into public.repository_graph_diagnostics(
    graph_version, parsed_file_count, parser_failure_count,
    unresolved_import_count, import_count, unresolved_file_ratio,
    parser_failure_ratio, orphan_symbol_count, duplicate_node_id_count,
    duplicate_edge_id_count, graph_bytes, duration_ms, details
  ) values (
    input_graph_version,
    coalesce((input_diagnostics->>'parsedFileCount')::integer, 0),
    coalesce((input_diagnostics->>'parserFailureCount')::integer, 0),
    coalesce((input_diagnostics->>'unresolvedImportCount')::integer, 0),
    coalesce((input_diagnostics->>'importCount')::integer, 0),
    coalesce((input_diagnostics->>'unresolvedFileRatio')::double precision, 0),
    coalesce((input_diagnostics->>'parserFailureRatio')::double precision, 0),
    coalesce((input_diagnostics->>'orphanSymbolCount')::integer, 0),
    greatest(duplicate_nodes, coalesce((input_diagnostics->>'duplicateNodeIdCount')::integer, 0)),
    greatest(duplicate_edges, coalesce((input_diagnostics->>'duplicateEdgeIdCount')::integer, 0)),
    coalesce((input_diagnostics->>'graphBytes')::bigint, 0),
    coalesce((input_diagnostics->>'durationMs')::double precision, 0),
    jsonb_build_object('failures', coalesce(input_diagnostics->'failures', '[]'::jsonb))
  )
  on conflict (graph_version) do update set
    parsed_file_count = excluded.parsed_file_count,
    parser_failure_count = excluded.parser_failure_count,
    unresolved_import_count = excluded.unresolved_import_count,
    import_count = excluded.import_count,
    unresolved_file_ratio = excluded.unresolved_file_ratio,
    parser_failure_ratio = excluded.parser_failure_ratio,
    orphan_symbol_count = excluded.orphan_symbol_count,
    duplicate_node_id_count = excluded.duplicate_node_id_count,
    duplicate_edge_id_count = excluded.duplicate_edge_id_count,
    graph_bytes = excluded.graph_bytes,
    duration_ms = excluded.duration_ms,
    details = excluded.details;
end; $$;

create or replace function public.validate_repository_graph_version(
  input_repository_id text,
  input_repository_revision text,
  input_graph_version text,
  input_job_id text,
  input_worker_id text,
  input_claim_token text,
  input_max_nodes integer,
  input_max_edges integer,
  input_max_duration_ms integer,
  input_max_graph_bytes bigint,
  input_max_unresolved_ratio double precision,
  input_max_parser_failure_ratio double precision
)
returns table(
  valid boolean, node_count bigint, edge_count bigint,
  duplicate_node_id_count integer, duplicate_edge_id_count integer,
  missing_endpoint_count bigint, impossible_self_edge_count bigint,
  orphan_symbol_count integer, unresolved_file_ratio double precision,
  parser_failure_ratio double precision, graph_bytes bigint,
  duration_ms double precision, validated_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare diagnostics public.repository_graph_diagnostics%rowtype;
declare nodes bigint;
declare edges bigint;
declare missing_endpoints bigint;
declare self_edges bigint;
declare validation_valid boolean;
declare validation_time timestamptz := now();
begin
  perform 1 from public.indexing_jobs
  where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and status = 'running' and lease_expires_at > now()
  for update;
  if not found then
    raise serialization_failure using message = 'indexing_job_lease_conflict';
  end if;
  perform 1 from public.repository_graph_versions
  where graph_version = input_graph_version
    and repository_id = input_repository_id
    and repository_revision = input_repository_revision
    and job_id = input_job_id and status = 'building'
  for update;
  if not found then
    raise check_violation using message = 'repository graph is not ready for validation';
  end if;
  update public.repository_graph_versions
  set status = 'validating', updated_at = validation_time
  where graph_version = input_graph_version;

  select * into diagnostics from public.repository_graph_diagnostics
  where graph_version = input_graph_version for update;
  if not found then
    raise check_violation using message = 'repository graph diagnostics are missing';
  end if;
  select count(*) into nodes from public.repository_graph_nodes
  where graph_version = input_graph_version;
  select count(*) into edges from public.repository_graph_edges
  where graph_version = input_graph_version;
  select count(*) into missing_endpoints
  from public.repository_graph_edges graph_edges
  left join public.repository_graph_nodes source
    on source.graph_version = graph_edges.graph_version
    and source.node_id = graph_edges.from_node_id
  left join public.repository_graph_nodes target
    on target.graph_version = graph_edges.graph_version
    and target.node_id = graph_edges.to_node_id
  where graph_edges.graph_version = input_graph_version
    and (source.node_id is null or target.node_id is null);
  select count(*) into self_edges from public.repository_graph_edges
  where graph_version = input_graph_version
    and from_node_id = to_node_id and kind <> 'references';

  validation_valid :=
    nodes <= input_max_nodes and edges <= input_max_edges
    and diagnostics.duration_ms <= input_max_duration_ms
    and diagnostics.graph_bytes <= input_max_graph_bytes
    and diagnostics.unresolved_file_ratio <= input_max_unresolved_ratio
    and diagnostics.parser_failure_ratio <= input_max_parser_failure_ratio
    and diagnostics.duplicate_node_id_count = 0
    and diagnostics.duplicate_edge_id_count = 0
    and missing_endpoints = 0 and self_edges = 0
    and diagnostics.orphan_symbol_count = 0
    and exists (
      select 1 from public.repository_snapshots
      where repository_id = input_repository_id
        and revision = input_repository_revision
        and status in ('building', 'published')
    );

  update public.repository_graph_diagnostics
  set missing_endpoint_count = missing_endpoints,
      impossible_self_edge_count = self_edges,
      is_valid = validation_valid,
      validated_at = validation_time
  where graph_version = input_graph_version;
  if not validation_valid then
    update public.repository_graph_versions
    set status = 'failed', updated_at = validation_time
    where graph_version = input_graph_version;
  end if;

  if nodes > input_max_nodes then
    raise check_violation using message = 'repository_quota_exceeded:graph_nodes';
  elsif edges > input_max_edges then
    raise check_violation using message = 'repository_quota_exceeded:graph_edges';
  elsif diagnostics.duration_ms > input_max_duration_ms then
    raise check_violation using message = 'repository_quota_exceeded:graph_duration';
  elsif diagnostics.graph_bytes > input_max_graph_bytes then
    raise check_violation using message = 'repository_quota_exceeded:graph_bytes';
  end if;

  return query select validation_valid, nodes, edges,
    diagnostics.duplicate_node_id_count, diagnostics.duplicate_edge_id_count,
    missing_endpoints, self_edges, diagnostics.orphan_symbol_count,
    diagnostics.unresolved_file_ratio, diagnostics.parser_failure_ratio,
    diagnostics.graph_bytes, diagnostics.duration_ms, validation_time;
end; $$;

create or replace function public.discard_repository_graph_version(
  input_repository_id text,
  input_repository_revision text,
  input_graph_version text,
  input_job_id text,
  input_worker_id text,
  input_claim_token text,
  input_diagnostics jsonb default '{}'::jsonb
)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.indexing_jobs
  where job_id = input_job_id and repository_id = input_repository_id
    and claimed_by = input_worker_id and claim_token = input_claim_token
    and ((status in ('claimed', 'running') and lease_expires_at > now()) or status = 'failed')
  for update;
  if not found then
    raise serialization_failure using message = 'indexing_job_lease_conflict';
  end if;
  update public.repository_graph_versions
  set status = 'failed', published_at = null, updated_at = now()
  where graph_version = input_graph_version
    and repository_id = input_repository_id
    and repository_revision = input_repository_revision
    and job_id = input_job_id and status in ('building', 'validating', 'failed');
  update public.repository_graph_diagnostics
  set details = details || jsonb_build_object('failure', input_diagnostics)
  where graph_version = input_graph_version;
  delete from public.repository_graph_edges where graph_version = input_graph_version;
  delete from public.repository_graph_nodes where graph_version = input_graph_version;
end; $$;

create or replace function public.get_published_repository_graph(
  input_repository_id text,
  input_repository_revision text
)
returns table(
  graph_version text, repository_id text, repository_revision text,
  parser_version text, created_at timestamptz, published_at timestamptz,
  nodes jsonb, edges jsonb, diagnostics jsonb
)
language sql stable security invoker set search_path = public as $$
  select versions.graph_version, versions.repository_id,
    versions.repository_revision, versions.parser_version, versions.created_at,
    versions.published_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'nodeId', graph_nodes.node_id, 'symbolId', graph_nodes.node_id,
        'graphVersion', graph_nodes.graph_version,
        'repositoryId', graph_nodes.repository_id,
        'repositoryRevision', graph_nodes.repository_revision,
        'repositoryVersion', graph_nodes.repository_revision,
        'parserVersion', graph_nodes.parser_version,
        'name', graph_nodes.name, 'qualifiedName', graph_nodes.qualified_name,
        'kind', graph_nodes.kind, 'language', graph_nodes.language,
        'file', graph_nodes.file_path, 'line', graph_nodes.start_line,
        'endLine', graph_nodes.end_line, 'column', graph_nodes.start_column,
        'endColumn', graph_nodes.end_column, 'exported', graph_nodes.exported,
        'defaultExport', graph_nodes.default_export, 'metadata', graph_nodes.metadata
      ) order by graph_nodes.node_id)
      from public.repository_graph_nodes graph_nodes
      where graph_nodes.graph_version = versions.graph_version
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'edgeId', graph_edges.edge_id, 'graphVersion', graph_edges.graph_version,
        'repositoryId', graph_edges.repository_id,
        'repositoryRevision', graph_edges.repository_revision,
        'parserVersion', graph_edges.parser_version,
        'fromNodeId', graph_edges.from_node_id,
        'toNodeId', graph_edges.to_node_id,
        'fromSymbolId', graph_edges.from_node_id,
        'toSymbolId', graph_edges.to_node_id,
        'kind', graph_edges.kind, 'distance', graph_edges.distance,
        'metadata', graph_edges.metadata
      ) order by graph_edges.edge_id)
      from public.repository_graph_edges graph_edges
      where graph_edges.graph_version = versions.graph_version
    ), '[]'::jsonb),
    jsonb_build_object(
      'parsedFileCount', diagnostics.parsed_file_count,
      'parserFailureCount', diagnostics.parser_failure_count,
      'unresolvedImportCount', diagnostics.unresolved_import_count,
      'importCount', diagnostics.import_count,
      'unresolvedFileRatio', diagnostics.unresolved_file_ratio,
      'parserFailureRatio', diagnostics.parser_failure_ratio,
      'orphanSymbolCount', diagnostics.orphan_symbol_count,
      'duplicateNodeIdCount', diagnostics.duplicate_node_id_count,
      'duplicateEdgeIdCount', diagnostics.duplicate_edge_id_count,
      'missingEndpointCount', diagnostics.missing_endpoint_count,
      'impossibleSelfEdgeCount', diagnostics.impossible_self_edge_count,
      'graphBytes', diagnostics.graph_bytes,
      'durationMs', diagnostics.duration_ms,
      'failures', coalesce(diagnostics.details->'failures', '[]'::jsonb)
    )
  from public.repository_graph_publications publications
  join public.repository_graph_versions versions
    on versions.graph_version = publications.graph_version
    and versions.status = 'published'
  join public.repository_graph_diagnostics diagnostics
    on diagnostics.graph_version = versions.graph_version and diagnostics.is_valid
  join public.repositories repositories
    on repositories.repository_id = publications.repository_id
    and repositories.current_revision = publications.repository_revision
  where publications.repository_id = input_repository_id
    and publications.repository_revision = input_repository_revision;
$$;

create or replace function public.collect_repository_graph_versions(
  input_repository_id text,
  input_retention_count integer default 3
)
returns bigint language plpgsql security invoker set search_path = public as $$
declare deleted_count bigint;
begin
  if input_retention_count < 1 then
    raise check_violation using message = 'repository graph retention must be positive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(input_repository_id || ':repository_graph_gc', 0));
  with retained as (
    select graph_version from public.repository_graph_versions
    where repository_id = input_repository_id
      and status in ('published', 'superseded')
    order by published_at desc nulls last, created_at desc, graph_version
    limit input_retention_count
  ), removed as (
    delete from public.repository_graph_versions versions
    where versions.repository_id = input_repository_id
      and versions.status in ('failed', 'superseded')
      and not exists (select 1 from retained where retained.graph_version = versions.graph_version)
      and not exists (
        select 1 from public.repository_graph_publications publications
        where publications.graph_version = versions.graph_version
      )
    returning versions.graph_version
  )
  select count(*) into deleted_count from removed;
  return deleted_count;
end; $$;

create or replace function public.recover_repository_graph_versions()
returns table(cleaned_version_count bigint)
language plpgsql security invoker set search_path = public as $$
declare cleaned bigint;
begin
  with abandoned as (
    update public.repository_graph_versions versions
    set status = 'failed', published_at = null, updated_at = now()
    where versions.status in ('building', 'validating')
      and not exists (
        select 1 from public.indexing_jobs jobs
        where jobs.job_id = versions.job_id
          and jobs.status in ('claimed', 'running')
          and jobs.lease_expires_at > now()
      )
    returning versions.graph_version
  ), removed_edges as (
    delete from public.repository_graph_edges edges using abandoned
    where edges.graph_version = abandoned.graph_version
    returning edges.graph_version
  ), removed_nodes as (
    delete from public.repository_graph_nodes nodes using abandoned
    where nodes.graph_version = abandoned.graph_version
    returning nodes.graph_version
  )
  select count(*) into cleaned from abandoned;
  return query select coalesce(cleaned, 0);
end; $$;

create or replace function public.verify_repository_graph_contract()
returns table(valid boolean)
language plpgsql stable security invoker set search_path = public, pg_catalog as $$
begin
  if to_regclass('public.repository_graph_versions') is null
    or to_regclass('public.repository_graph_nodes') is null
    or to_regclass('public.repository_graph_edges') is null
    or to_regclass('public.repository_graph_diagnostics') is null
    or to_regclass('public.repository_graph_publications') is null
    or to_regclass('public.repository_graph_edges_outbound_idx') is null
    or to_regclass('public.repository_graph_edges_inbound_idx') is null then
    raise exception 'repository graph database objects are missing' using errcode = '42P01';
  end if;
  if exists (
    select 1 from public.repository_graph_publications publications
    left join public.repository_graph_versions versions
      on versions.graph_version = publications.graph_version
    left join public.repository_graph_diagnostics diagnostics
      on diagnostics.graph_version = publications.graph_version
    left join public.repositories repositories
      on repositories.repository_id = publications.repository_id
    where versions.status is distinct from 'published'
      or diagnostics.is_valid is distinct from true
      or versions.repository_revision is distinct from publications.repository_revision
      or repositories.current_revision is distinct from publications.repository_revision
  ) then
    raise check_violation using message = 'repository graph publication contract is invalid';
  end if;
  if exists (
    select 1 from public.repository_graph_edges edges
    left join public.repository_graph_nodes source
      on source.graph_version = edges.graph_version and source.node_id = edges.from_node_id
    left join public.repository_graph_nodes target
      on target.graph_version = edges.graph_version and target.node_id = edges.to_node_id
    where source.node_id is null or target.node_id is null
  ) then
    raise check_violation using message = 'repository graph contains missing endpoints';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.repository_graph_versions'::regclass
      and relation.relrowsecurity
  ) then
    raise check_violation using message = 'repository graph RLS is not enabled';
  end if;
  return query select true;
end; $$;

do $migration$
begin
  if to_regprocedure(
    'public.publish_repository_snapshot_without_graph(text,text,text,text,text,text,integer,integer,integer,integer,integer,boolean,text,text,integer,text,bigint,integer,bigint)'
  ) is null then
    alter function public.publish_repository_snapshot(
      text,text,text,text,text,text,integer,integer,integer,integer,integer,
      boolean,text,text,integer,text,bigint,integer,bigint
    ) rename to publish_repository_snapshot_without_graph;
  end if;
end;
$migration$;

create or replace function public.publish_repository_snapshot(
  input_repository_id text, input_revision text, input_branch text,
  input_job_id text, input_worker_id text, input_claim_token text,
  input_chunk_count integer, input_file_count integer, input_symbol_count integer,
  input_graph_node_count integer, input_graph_edge_count integer,
  input_summary_available boolean, input_embedding_version text,
  input_index_mode text, input_changed_file_count integer,
  input_owner_user_id text, input_repository_storage_bytes bigint,
  input_max_indexed_repositories integer, input_max_user_storage_bytes bigint
)
returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare graph_row public.repository_graph_versions%rowtype;
begin
  select versions.* into graph_row
  from public.repository_graph_versions versions
  join public.repository_graph_diagnostics diagnostics
    on diagnostics.graph_version = versions.graph_version and diagnostics.is_valid
  where versions.repository_id = input_repository_id
    and versions.repository_revision = input_revision
    and (
      (versions.status = 'validating' and versions.job_id = input_job_id)
      or (
        versions.status = 'published'
        and exists (
          select 1 from public.repository_graph_publications publications
          where publications.repository_id = input_repository_id
            and publications.repository_revision = input_revision
            and publications.graph_version = versions.graph_version
        )
      )
    )
  order by versions.created_at desc, versions.graph_version
  limit 1
  for update of versions;
  if not found then
    raise check_violation using message = 'validated repository graph is required for publication';
  end if;
  if (
    select count(*) from public.repository_graph_nodes
    where graph_version = graph_row.graph_version
  ) <> input_graph_node_count then
    raise check_violation using message = 'repository graph node count does not match';
  end if;
  if (
    select count(*) from public.repository_graph_edges
    where graph_version = graph_row.graph_version
  ) <> input_graph_edge_count then
    raise check_violation using message = 'repository graph edge count does not match';
  end if;

  perform public.publish_repository_snapshot_without_graph(
    input_repository_id, input_revision, input_branch, input_job_id,
    input_worker_id, input_claim_token, input_chunk_count, input_file_count,
    input_symbol_count, input_graph_node_count, input_graph_edge_count,
    input_summary_available, input_embedding_version, input_index_mode,
    input_changed_file_count, input_owner_user_id, input_repository_storage_bytes,
    input_max_indexed_repositories, input_max_user_storage_bytes
  );

  update public.repository_graph_versions
  set status = 'superseded', published_at = null, updated_at = now()
  where graph_version = (
    select publications.graph_version from public.repository_graph_publications publications
    where publications.repository_id = input_repository_id
      and publications.graph_version <> graph_row.graph_version
  );
  update public.repository_graph_versions
  set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
  where graph_version = graph_row.graph_version;
  insert into public.repository_graph_publications(
    repository_id, repository_revision, parser_version, graph_version, published_at
  ) values (
    input_repository_id, input_revision, graph_row.parser_version,
    graph_row.graph_version,
    (select published_at from public.repository_graph_versions
      where graph_version = graph_row.graph_version)
  )
  on conflict (repository_id) do update set
    repository_revision = excluded.repository_revision,
    parser_version = excluded.parser_version,
    graph_version = excluded.graph_version,
    published_at = excluded.published_at;
end; $$;

alter table public.repository_graph_versions enable row level security;
alter table public.repository_graph_nodes enable row level security;
alter table public.repository_graph_edges enable row level security;
alter table public.repository_graph_diagnostics enable row level security;
alter table public.repository_graph_publications enable row level security;

revoke all on table public.repository_graph_versions from public, anon, authenticated;
revoke all on table public.repository_graph_nodes from public, anon, authenticated;
revoke all on table public.repository_graph_edges from public, anon, authenticated;
revoke all on table public.repository_graph_diagnostics from public, anon, authenticated;
revoke all on table public.repository_graph_publications from public, anon, authenticated;
grant all on table public.repository_graph_versions to service_role;
grant all on table public.repository_graph_nodes to service_role;
grant all on table public.repository_graph_edges to service_role;
grant all on table public.repository_graph_diagnostics to service_role;
grant all on table public.repository_graph_publications to service_role;

revoke all on function public.begin_repository_graph_version(
  text,text,text,text,text,text,text
) from public, anon, authenticated;
revoke all on function public.stage_repository_graph_version(
  text,text,text,text,text,text,jsonb,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.validate_repository_graph_version(
  text,text,text,text,text,text,integer,integer,integer,bigint,double precision,double precision
) from public, anon, authenticated;
revoke all on function public.discard_repository_graph_version(
  text,text,text,text,text,text,jsonb
) from public, anon, authenticated;
revoke all on function public.get_published_repository_graph(text,text)
  from public, anon, authenticated;
revoke all on function public.collect_repository_graph_versions(text,integer)
  from public, anon, authenticated;
revoke all on function public.recover_repository_graph_versions()
  from public, anon, authenticated;
revoke all on function public.verify_repository_graph_contract()
  from public, anon, authenticated;
revoke all on function public.publish_repository_snapshot_without_graph(
  text,text,text,text,text,text,integer,integer,integer,integer,integer,
  boolean,text,text,integer,text,bigint,integer,bigint
) from public, anon, authenticated, service_role;
revoke all on function public.publish_repository_snapshot(
  text,text,text,text,text,text,integer,integer,integer,integer,integer,
  boolean,text,text,integer,text,bigint,integer,bigint
) from public, anon, authenticated;

grant execute on function public.begin_repository_graph_version(
  text,text,text,text,text,text,text
) to service_role;
grant execute on function public.stage_repository_graph_version(
  text,text,text,text,text,text,jsonb,jsonb,jsonb
) to service_role;
grant execute on function public.validate_repository_graph_version(
  text,text,text,text,text,text,integer,integer,integer,bigint,double precision,double precision
) to service_role;
grant execute on function public.discard_repository_graph_version(
  text,text,text,text,text,text,jsonb
) to service_role;
grant execute on function public.get_published_repository_graph(text,text)
  to service_role;
grant execute on function public.collect_repository_graph_versions(text,integer)
  to service_role;
grant execute on function public.recover_repository_graph_versions()
  to service_role;
grant execute on function public.verify_repository_graph_contract()
  to service_role;
grant execute on function public.publish_repository_snapshot(
  text,text,text,text,text,text,integer,integer,integer,integer,integer,
  boolean,text,text,integer,text,bigint,integer,bigint
) to service_role;

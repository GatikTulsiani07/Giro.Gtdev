create table if not exists public.semantic_graph_versions (
  tenant_id text not null,
  graph_version text not null,
  schema_version text not null,
  persistence_version bigint not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  snapshot_fingerprint text not null,
  lifecycle text not null,
  adapter_versions jsonb not null,
  state jsonb not null,
  indexed_symbols integer not null,
  indexed_relationships integer not null,
  indexing_duration_ms double precision not null,
  graph_rebuilds integer not null,
  incremental_updates integer not null,
  recovery_operations integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  primary key(tenant_id,graph_version),
  unique(tenant_id,repository_id,repository_revision),
  constraint semantic_graph_schema_version_valid
    check(schema_version='semantic-code-graph-v1'),
  constraint semantic_graph_identity_non_empty check(
    tenant_id<>'' and graph_version<>'' and owner_id<>'' and repository_id<>''
    and repository_revision<>'' and snapshot_fingerprint<>''
  ),
  constraint semantic_graph_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint semantic_graph_lifecycle_valid check(
    lifecycle in('building','validating','published','failed','superseded')
  ),
  constraint semantic_graph_counts_nonnegative check(
    indexed_symbols>=0 and indexed_relationships>=0
    and indexing_duration_ms>=0 and graph_rebuilds>=0
    and incremental_updates>=0 and recovery_operations>=0
  ),
  constraint semantic_graph_state_object check(jsonb_typeof(state)='object'),
  constraint semantic_graph_adapters_array
    check(jsonb_typeof(adapter_versions)='array')
);

create table if not exists public.semantic_symbols (
  tenant_id text not null,
  graph_version text not null,
  symbol_id text not null,
  repository_id text not null,
  repository_revision text not null,
  file_path text not null,
  language text not null,
  symbol_kind text not null,
  qualified_name text not null,
  visibility text not null,
  signature text not null,
  documentation_hash text not null,
  symbol jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,graph_version,symbol_id),
  constraint semantic_symbol_graph_fk
    foreign key(tenant_id,graph_version)
    references public.semantic_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint semantic_symbol_kind_valid check(symbol_kind in(
    'module','namespace','class','interface','enum','struct','function',
    'method','constructor','variable','constant','import','export'
  )),
  constraint semantic_symbol_language_valid
    check(language in('typescript','javascript')),
  constraint semantic_symbol_visibility_valid
    check(visibility in('public','protected','private','internal')),
  constraint semantic_symbol_identity_non_empty check(
    symbol_id<>'' and repository_id<>'' and repository_revision<>''
    and file_path<>'' and qualified_name<>'' and documentation_hash<>''
  ),
  constraint semantic_symbol_object check(jsonb_typeof(symbol)='object')
);

create table if not exists public.semantic_edges (
  tenant_id text not null,
  graph_version text not null,
  relationship_id text not null,
  repository_id text not null,
  repository_revision text not null,
  from_symbol_id text not null,
  to_symbol_id text not null,
  relationship_kind text not null,
  relationship jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,graph_version,relationship_id),
  unique(tenant_id,graph_version,from_symbol_id,to_symbol_id,relationship_kind),
  constraint semantic_edge_graph_fk
    foreign key(tenant_id,graph_version)
    references public.semantic_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint semantic_edge_from_symbol_fk
    foreign key(tenant_id,graph_version,from_symbol_id)
    references public.semantic_symbols(tenant_id,graph_version,symbol_id)
    on delete cascade,
  constraint semantic_edge_to_symbol_fk
    foreign key(tenant_id,graph_version,to_symbol_id)
    references public.semantic_symbols(tenant_id,graph_version,symbol_id)
    on delete cascade,
  constraint semantic_edge_kind_valid check(relationship_kind in(
    'calls','called_by','implements','implemented_by','extends','inherited_by',
    'imports','imported_by','references','referenced_by',
    'overrides','overridden_by'
  )),
  constraint semantic_edge_not_self check(from_symbol_id<>to_symbol_id),
  constraint semantic_edge_object check(jsonb_typeof(relationship)='object')
);

create table if not exists public.semantic_language_metadata (
  tenant_id text not null,
  graph_version text not null,
  file_path text not null,
  language text not null,
  adapter_version text not null,
  content_hash text not null,
  metadata jsonb not null,
  primary key(tenant_id,graph_version,file_path),
  constraint semantic_language_graph_fk
    foreign key(tenant_id,graph_version)
    references public.semantic_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint semantic_language_valid check(language in('typescript','javascript')),
  constraint semantic_language_identity_non_empty check(
    file_path<>'' and adapter_version<>'' and content_hash<>''
  ),
  constraint semantic_language_metadata_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.semantic_indexing_diagnostics (
  tenant_id text not null,
  graph_version text not null,
  diagnostic_position integer not null,
  diagnostic_code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,graph_version,diagnostic_position),
  constraint semantic_diagnostic_graph_fk
    foreign key(tenant_id,graph_version)
    references public.semantic_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint semantic_diagnostic_position_nonnegative
    check(diagnostic_position>=0),
  constraint semantic_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint semantic_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.semantic_graph_retention (
  tenant_id text primary key,
  retained_versions integer not null,
  updated_at timestamptz not null default now(),
  constraint semantic_graph_retention_positive check(retained_versions>0)
);

create index if not exists semantic_graph_owner_repository_idx
  on public.semantic_graph_versions(
    tenant_id,owner_id,repository_id,lifecycle,updated_at desc
  );
create index if not exists semantic_graph_recovery_idx
  on public.semantic_graph_versions(lifecycle,updated_at)
  where lifecycle in('building','validating');
create index if not exists semantic_symbols_definition_idx
  on public.semantic_symbols(
    tenant_id,repository_id,repository_revision,qualified_name
  );
create index if not exists semantic_symbols_file_idx
  on public.semantic_symbols(tenant_id,graph_version,file_path);
create index if not exists semantic_edges_from_kind_idx
  on public.semantic_edges(tenant_id,graph_version,from_symbol_id,relationship_kind);
create index if not exists semantic_edges_to_kind_idx
  on public.semantic_edges(tenant_id,graph_version,to_symbol_id,relationship_kind);
create index if not exists semantic_diagnostics_retention_idx
  on public.semantic_indexing_diagnostics(tenant_id,graph_version,created_at desc);

create or replace function public.get_semantic_code_graph(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_repository_revision text
) returns table(graph jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.semantic_graph_versions
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and repository_id=input_repository_id
    and repository_revision=input_repository_revision
    and lifecycle='published'
$$;

create or replace function public.save_semantic_code_graph(
  input_graph jsonb,input_expected_version text
) returns table(graph jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.semantic_graph_versions%rowtype;
declare symbol_value jsonb;
declare edge_value jsonb;
declare file_value jsonb;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
declare tenant_value text:=input_graph->>'tenantId';
declare graph_value text:=input_graph->>'graphVersion';
begin
  if jsonb_typeof(input_graph)<>'object'
    or jsonb_typeof(input_graph->'symbols')<>'array'
    or jsonb_typeof(input_graph->'relationships')<>'array'
    or jsonb_typeof(input_graph->'fileAnalyses')<>'array'
    or jsonb_typeof(input_graph->'diagnostics')<>'array'
    or input_graph->>'schemaVersion'<>'semantic-code-graph-v1' then
    raise check_violation using message='semantic_graph_state_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_graph->>'repositoryId'
      and repository.owner_user_id=input_graph->>'ownerId'
      and repository.current_revision=input_graph->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='semantic_repository_access_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||(input_graph->>'repositoryId'),0
  ));
  select * into existing from public.semantic_graph_versions candidate
  where candidate.tenant_id=tenant_value
    and candidate.graph_version=graph_value for update;
  if found and input_expected_version is not null
    and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure using message='semantic_graph_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='semantic_graph_version_conflict';
  end if;

  update public.semantic_graph_versions set
    lifecycle='superseded',updated_at=(input_graph->>'updatedAt')::timestamptz,
    state=jsonb_set(state,'{lifecycle}','"superseded"'::jsonb)
  where tenant_id=tenant_value
    and repository_id=input_graph->>'repositoryId'
    and graph_version<>graph_value and lifecycle='published';

  insert into public.semantic_graph_versions(
    tenant_id,graph_version,schema_version,persistence_version,owner_id,
    repository_id,repository_revision,snapshot_fingerprint,lifecycle,
    adapter_versions,state,indexed_symbols,indexed_relationships,
    indexing_duration_ms,graph_rebuilds,incremental_updates,recovery_operations,
    created_at,updated_at,published_at
  ) values(
    tenant_value,graph_value,input_graph->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),input_graph->>'ownerId',
    input_graph->>'repositoryId',input_graph->>'repositoryRevision',
    input_graph->>'snapshotFingerprint',input_graph->>'lifecycle',
    input_graph->'adapterVersions',
    jsonb_set(input_graph,'{persistenceVersion}',
      to_jsonb(coalesce(existing.persistence_version+1,1))),
    (input_graph->'metrics'->>'indexedSymbols')::integer,
    (input_graph->'metrics'->>'indexedRelationships')::integer,
    (input_graph->'metrics'->>'indexingDurationMs')::double precision,
    (input_graph->'metrics'->>'graphRebuilds')::integer,
    (input_graph->'metrics'->>'incrementalUpdates')::integer,
    (input_graph->'metrics'->>'recoveryOperations')::integer,
    (input_graph->>'createdAt')::timestamptz,
    (input_graph->>'updatedAt')::timestamptz,
    nullif(input_graph->>'publishedAt','')::timestamptz
  ) on conflict(tenant_id,graph_version) do update set
    persistence_version=excluded.persistence_version,
    lifecycle=excluded.lifecycle,state=excluded.state,
    indexed_symbols=excluded.indexed_symbols,
    indexed_relationships=excluded.indexed_relationships,
    indexing_duration_ms=excluded.indexing_duration_ms,
    graph_rebuilds=excluded.graph_rebuilds,
    incremental_updates=excluded.incremental_updates,
    recovery_operations=excluded.recovery_operations,
    updated_at=excluded.updated_at,published_at=excluded.published_at;

  delete from public.semantic_edges
    where tenant_id=tenant_value and graph_version=graph_value;
  delete from public.semantic_symbols
    where tenant_id=tenant_value and graph_version=graph_value;
  delete from public.semantic_language_metadata
    where tenant_id=tenant_value and graph_version=graph_value;
  delete from public.semantic_indexing_diagnostics
    where tenant_id=tenant_value and graph_version=graph_value;

  for symbol_value in select value from jsonb_array_elements(input_graph->'symbols')
  loop
    insert into public.semantic_symbols(
      tenant_id,graph_version,symbol_id,repository_id,repository_revision,
      file_path,language,symbol_kind,qualified_name,visibility,signature,
      documentation_hash,symbol,created_at,updated_at
    ) values(
      tenant_value,graph_value,symbol_value->>'symbolId',
      symbol_value->>'repositoryId',symbol_value->>'repositoryRevision',
      symbol_value->>'file',symbol_value->>'language',symbol_value->>'kind',
      symbol_value->>'qualifiedName',symbol_value->>'visibility',
      symbol_value->>'signature',symbol_value->>'documentationHash',symbol_value,
      (symbol_value->>'createdAt')::timestamptz,
      (symbol_value->>'updatedAt')::timestamptz
    );
  end loop;
  for edge_value in select value
    from jsonb_array_elements(input_graph->'relationships')
  loop
    insert into public.semantic_edges(
      tenant_id,graph_version,relationship_id,repository_id,
      repository_revision,from_symbol_id,to_symbol_id,relationship_kind,
      relationship,created_at
    ) values(
      tenant_value,graph_value,edge_value->>'relationshipId',
      edge_value->>'repositoryId',edge_value->>'repositoryRevision',
      edge_value->>'fromSymbolId',edge_value->>'toSymbolId',
      edge_value->>'kind',edge_value,(edge_value->>'createdAt')::timestamptz
    );
  end loop;
  for file_value in select value
    from jsonb_array_elements(input_graph->'fileAnalyses')
  loop
    if file_value->>'adapterVersion'<>'unsupported' then
      insert into public.semantic_language_metadata(
        tenant_id,graph_version,file_path,language,adapter_version,
        content_hash,metadata
      ) values(
        tenant_value,graph_value,file_value->>'file',file_value->>'language',
        file_value->>'adapterVersion',file_value->>'contentHash',file_value
      );
    end if;
  end loop;
  for diagnostic_value in select value
    from jsonb_array_elements(input_graph->'diagnostics')
  loop
    insert into public.semantic_indexing_diagnostics(
      tenant_id,graph_version,diagnostic_position,diagnostic_code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,graph_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value,(input_graph->>'updatedAt')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;
  return query select state from public.semantic_graph_versions
    where tenant_id=tenant_value and graph_version=graph_value;
end; $$;

create or replace function public.recover_semantic_code_graphs()
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  update public.semantic_graph_versions set
    lifecycle='failed',published_at=null,updated_at=now(),
    recovery_operations=recovery_operations+1,
    state=jsonb_set(jsonb_set(jsonb_set(
      state,'{lifecycle}','"failed"'::jsonb),
      '{publishedAt}','null'::jsonb),
      '{metrics,recoveryOperations}',to_jsonb(recovery_operations+1),true)
  where lifecycle in('building','validating');
  get diagnostics affected=row_count;
  delete from public.semantic_edges edge
  where not exists(select 1 from public.semantic_symbols symbol
    where symbol.tenant_id=edge.tenant_id
      and symbol.graph_version=edge.graph_version
      and symbol.symbol_id=edge.from_symbol_id)
    or not exists(select 1 from public.semantic_symbols symbol
      where symbol.tenant_id=edge.tenant_id
        and symbol.graph_version=edge.graph_version
        and symbol.symbol_id=edge.to_symbol_id);
  return query select affected;
end; $$;

create or replace function public.semantic_code_graph_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'indexedSymbols',coalesce(sum(indexed_symbols),0),
    'indexedRelationships',coalesce(sum(indexed_relationships),0),
    'indexingDurationMs',coalesce(sum(indexing_duration_ms),0),
    'graphRebuilds',coalesce(sum(graph_rebuilds),0),
    'incrementalUpdates',coalesce(sum(incremental_updates),0),
    'recoveryOperations',coalesce(sum(recovery_operations),0)
  ) from public.semantic_graph_versions graph
  where input_tenant_id is null or graph.tenant_id=input_tenant_id
$$;

create or replace function public.collect_semantic_code_graphs(
  input_tenant_id text,input_retained_versions integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.semantic_graph_retention(tenant_id,retained_versions)
  values(input_tenant_id,greatest(1,input_retained_versions))
  on conflict(tenant_id) do update set
    retained_versions=excluded.retained_versions,updated_at=now();
  with victims as(
    select graph_version from public.semantic_graph_versions
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,graph_version desc
    offset greatest(1,input_retained_versions)
  )
  delete from public.semantic_graph_versions graph using victims
  where graph.tenant_id=input_tenant_id
    and graph.graph_version=victims.graph_version;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_semantic_code_graph_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'semantic-code-intelligence-v1'
    or input_schema_version<>'semantic-code-graph-v1' then
    issues:=issues||'"semantic_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'semantic_graph_versions','semantic_symbols','semantic_edges',
    'semantic_language_metadata','semantic_indexing_diagnostics',
    'semantic_graph_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='semantic_symbols_definition_idx')
    or not exists(select 1 from pg_indexes
      where indexname='semantic_edges_from_kind_idx')
    or not exists(select 1 from pg_indexes
      where indexname='semantic_edges_to_kind_idx')
    or not exists(select 1 from pg_constraint
      where conname='semantic_edge_from_symbol_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='semantic_edge_to_symbol_fk' and confdeltype='c') then
    issues:=issues||'"semantic_indexes_or_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.semantic_graph_versions','select')
    or has_table_privilege(
      'anon','public.semantic_graph_versions','select')
    or not has_function_privilege(
      'service_role','public.save_semantic_code_graph(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_semantic_code_graph(jsonb,text)','execute') then
    issues:=issues||'"semantic_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_semantic_code_graphs(text,integer)') is null
    or to_regprocedure('public.recover_semantic_code_graphs()') is null then
    issues:=issues||'"semantic_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'semantic_graph_versions','semantic_symbols','semantic_edges',
    'semantic_language_metadata','semantic_indexing_diagnostics',
    'semantic_graph_retention'
  ] loop
    execute format('alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',object_name
    );
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name
    );
  end loop;
end $$;

revoke all on function public.get_semantic_code_graph(text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.save_semantic_code_graph(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.recover_semantic_code_graphs()
  from public,anon,authenticated;
revoke all on function public.semantic_code_graph_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_semantic_code_graphs(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_semantic_code_graph_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_semantic_code_graph(text,text,text,text)
  to service_role;
grant execute on function public.save_semantic_code_graph(jsonb,text)
  to service_role;
grant execute on function public.recover_semantic_code_graphs()
  to service_role;
grant execute on function public.semantic_code_graph_metrics(text)
  to service_role;
grant execute on function public.collect_semantic_code_graphs(text,integer)
  to service_role;
grant execute on function public.verify_semantic_code_graph_contract(text,text)
  to service_role;

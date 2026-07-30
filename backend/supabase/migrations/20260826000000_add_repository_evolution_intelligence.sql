create table if not exists public.repository_evolution_records (
  tenant_id text not null,
  evolution_id text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  base_revision text not null,
  target_revision text not null,
  schema_version text not null,
  analysis_version text not null,
  persistence_version bigint not null,
  source_fingerprint text not null,
  source_versions jsonb not null,
  lifecycle text not null,
  reused_count bigint not null default 0,
  comparison_latency_ms double precision not null,
  recovery_count bigint not null default 0,
  comparison_timestamp timestamptz not null,
  state jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  primary key(tenant_id,evolution_id),
  constraint repository_evolution_base_snapshot_fk
    foreign key(repository_id,base_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_evolution_target_snapshot_fk
    foreign key(repository_id,target_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_evolution_identity_non_empty check(
    tenant_id<>'' and evolution_id<>'' and owner_id<>''
    and repository_id<>'' and source_fingerprint<>''
  ),
  constraint repository_evolution_revisions_valid check(
    base_revision~'^[0-9a-f]{40}$'
    and target_revision~'^[0-9a-f]{40}$'
    and base_revision<>target_revision
  ),
  constraint repository_evolution_schema_valid
    check(schema_version='repository-evolution-schema-v1'),
  constraint repository_evolution_analysis_valid
    check(analysis_version='repository-evolution-analysis-v1'),
  constraint repository_evolution_lifecycle_valid check(
    lifecycle in('comparing','published','failed','superseded')
  ),
  constraint repository_evolution_metrics_valid check(
    reused_count>=0 and comparison_latency_ms>=0 and recovery_count>=0
  ),
  constraint repository_evolution_state_object check(
    jsonb_typeof(source_versions)='object' and jsonb_typeof(state)='object'
  ),
  constraint repository_evolution_publication_consistent check(
    lifecycle<>'published' or published_at is not null
  )
);

create table if not exists public.repository_revision_comparisons (
  tenant_id text not null,
  evolution_id text not null,
  comparison jsonb not null,
  feature_change_count integer not null,
  architecture_change_count integer not null,
  dependency_change_count integer not null,
  semantic_change_count integer not null,
  workflow_change_count integer not null,
  knowledge_change_count integer not null,
  created_at timestamptz not null,
  primary key(tenant_id,evolution_id),
  constraint repository_revision_comparison_evolution_fk
    foreign key(tenant_id,evolution_id)
    references public.repository_evolution_records(tenant_id,evolution_id)
    on delete cascade,
  constraint repository_revision_comparison_counts_valid check(
    feature_change_count>=0 and architecture_change_count>=0
    and dependency_change_count>=0 and semantic_change_count>=0
    and workflow_change_count>=0 and knowledge_change_count>=0
  ),
  constraint repository_revision_comparison_object
    check(jsonb_typeof(comparison)='object')
);

create table if not exists public.repository_evolution_timelines (
  tenant_id text not null,
  evolution_id text not null,
  timeline_id text not null,
  timeline_kind text not null,
  entity_id text not null,
  entity_name text not null,
  change_kind text not null,
  base_revision text not null,
  target_revision text not null,
  evidence jsonb not null,
  details jsonb not null,
  occurred_at timestamptz not null,
  primary key(tenant_id,evolution_id,timeline_id),
  constraint repository_evolution_timeline_record_fk
    foreign key(tenant_id,evolution_id)
    references public.repository_evolution_records(tenant_id,evolution_id)
    on delete cascade,
  constraint repository_evolution_timeline_kind_valid check(
    timeline_kind in(
      'file','module','feature','symbol','architecture','dependency','api'
    )
  ),
  constraint repository_evolution_timeline_change_valid
    check(change_kind in('added','removed','modified')),
  constraint repository_evolution_timeline_identity_non_empty check(
    timeline_id<>'' and entity_id<>'' and entity_name<>''
  ),
  constraint repository_evolution_timeline_json_valid check(
    jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)>0
    and jsonb_typeof(details)='object'
  )
);

create table if not exists public.repository_evolution_trend_summaries (
  tenant_id text not null,
  evolution_id text not null,
  trend_id text not null,
  trend_type text not null,
  direction text not null,
  magnitude double precision not null,
  confidence double precision not null,
  summary text not null,
  evidence jsonb not null,
  trend jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,evolution_id,trend_id),
  constraint repository_evolution_trend_record_fk
    foreign key(tenant_id,evolution_id)
    references public.repository_evolution_records(tenant_id,evolution_id)
    on delete cascade,
  constraint repository_evolution_trend_type_valid check(trend_type in(
    'increasing coupling','expanding features','shrinking modules',
    'unstable APIs','growing dependency chains'
  )),
  constraint repository_evolution_trend_direction_valid
    check(direction in('increasing','decreasing','unstable')),
  constraint repository_evolution_trend_values_valid check(
    magnitude between 0 and 1 and confidence between 0 and 1
    and summary<>''
  ),
  constraint repository_evolution_trend_json_valid check(
    jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)>0
    and jsonb_typeof(trend)='object'
  )
);

create table if not exists public.repository_evolution_diagnostics (
  tenant_id text not null,
  evolution_id text not null,
  diagnostic_position integer not null,
  code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,evolution_id,diagnostic_position),
  constraint repository_evolution_diagnostic_record_fk
    foreign key(tenant_id,evolution_id)
    references public.repository_evolution_records(tenant_id,evolution_id)
    on delete cascade,
  constraint repository_evolution_diagnostic_position_valid
    check(diagnostic_position>=0),
  constraint repository_evolution_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_evolution_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_evolution_retention (
  tenant_id text primary key,
  retained_records integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_evolution_retention_positive
    check(retained_records>0)
);

create unique index if not exists repository_evolution_revision_pair_idx
  on public.repository_evolution_records(
    tenant_id,owner_id,repository_id,base_revision,target_revision
  ) where lifecycle='published';
create index if not exists repository_evolution_target_timeline_idx
  on public.repository_evolution_records(
    tenant_id,repository_id,target_revision,comparison_timestamp desc
  ) where lifecycle='published';
create index if not exists repository_evolution_source_idx
  on public.repository_evolution_records(
    tenant_id,repository_id,target_revision,source_fingerprint
  );
create index if not exists repository_evolution_recovery_idx
  on public.repository_evolution_records(lifecycle,updated_at)
  where lifecycle in('comparing','failed','superseded');
create index if not exists repository_evolution_history_navigation_idx
  on public.repository_evolution_timelines(
    tenant_id,timeline_kind,entity_id,occurred_at desc
  );
create index if not exists repository_evolution_trend_navigation_idx
  on public.repository_evolution_trend_summaries(
    tenant_id,trend_type,magnitude desc,evolution_id
  );
create index if not exists repository_evolution_diagnostic_code_idx
  on public.repository_evolution_diagnostics(
    tenant_id,code,severity,created_at desc
  );

create or replace function public.get_repository_evolution_record(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_base_revision text,input_target_revision text
) returns table(record jsonb)
language sql stable security invoker set search_path=public as $$
  select evolution.state
  from public.repository_evolution_records evolution
  where evolution.tenant_id=input_tenant_id
    and evolution.owner_id=input_owner_id
    and evolution.repository_id=input_repository_id
    and evolution.base_revision=input_base_revision
    and evolution.target_revision=input_target_revision
    and evolution.lifecycle='published'
  order by evolution.comparison_timestamp desc,evolution.evolution_id
  limit 1
$$;

create or replace function public.list_repository_evolution_records(
  input_tenant_id text,input_owner_id text,input_repository_id text
) returns table(record jsonb)
language sql stable security invoker set search_path=public as $$
  select evolution.state
  from public.repository_evolution_records evolution
  where evolution.tenant_id=input_tenant_id
    and evolution.owner_id=input_owner_id
    and evolution.repository_id=input_repository_id
    and evolution.lifecycle='published'
  order by evolution.comparison_timestamp desc,evolution.evolution_id
$$;

create or replace function public.save_repository_evolution_record(
  input_record jsonb,input_expected_version text
) returns table(record jsonb)
language plpgsql security invoker set search_path=public as $$
declare tenant_value text:=input_record->>'tenantId';
declare evolution_value text:=input_record->>'evolutionId';
declare existing public.repository_evolution_records%rowtype;
declare saved_state jsonb;
declare timeline_value jsonb;
declare trend_value jsonb;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
declare comparison_value jsonb:=input_record->'comparison';
begin
  if jsonb_typeof(input_record)<>'object'
    or input_record->>'schemaVersion'<>'repository-evolution-schema-v1'
    or input_record->>'analysisVersion'<>'repository-evolution-analysis-v1'
    or jsonb_typeof(input_record->'sourceVersions')<>'object'
    or jsonb_typeof(comparison_value)<>'object'
    or jsonb_typeof(input_record->'timelines')<>'array'
    or jsonb_typeof(input_record->'trends')<>'array'
    or jsonb_typeof(input_record->'diagnostics')<>'array' then
    raise check_violation using message='repository_evolution_record_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_record->>'repositoryId'
      and repository.owner_user_id=input_record->>'ownerId'
      and repository.current_revision=input_record->>'targetRevision'
      and repository.indexed_revision=input_record->>'targetRevision'
      and repository.deletion_state='active'
  ) or not exists(
    select 1
    from public.repository_snapshots base_snapshot
    join public.repository_snapshots target_snapshot
      on target_snapshot.repository_id=base_snapshot.repository_id
    where base_snapshot.repository_id=input_record->>'repositoryId'
      and base_snapshot.revision=input_record->>'baseRevision'
      and target_snapshot.revision=input_record->>'targetRevision'
      and base_snapshot.status in('published','superseded')
      and target_snapshot.status='published'
      and base_snapshot.created_at<=target_snapshot.indexed_at
  ) then
    raise check_violation using message='repository_evolution_lineage_invalid';
  end if;
  if not exists(
    select 1 from public.repository_intelligence_versions source
    where source.intelligence_version=
      input_record->'sourceVersions'->>'baseRepositoryIntelligence'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'baseRevision'
      and source.status in('published','superseded')
  ) or not exists(
    select 1 from public.repository_intelligence_versions source
    where source.intelligence_version=
      input_record->'sourceVersions'->>'targetRepositoryIntelligence'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'targetRevision'
      and source.status='published'
  ) or not exists(
    select 1 from public.repository_graph_versions source
    where source.graph_version=
      input_record->'sourceVersions'->>'baseRepositoryGraph'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'baseRevision'
      and source.status in('published','superseded')
  ) or not exists(
    select 1 from public.repository_graph_versions source
    where source.graph_version=
      input_record->'sourceVersions'->>'targetRepositoryGraph'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'targetRevision'
      and source.status='published'
  ) or not exists(
    select 1 from public.semantic_graph_versions source
    where source.tenant_id=tenant_value
      and source.graph_version=
        input_record->'sourceVersions'->>'baseSemanticGraph'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'baseRevision'
      and source.lifecycle in('published','superseded')
  ) or not exists(
    select 1 from public.semantic_graph_versions source
    where source.tenant_id=tenant_value
      and source.graph_version=
        input_record->'sourceVersions'->>'targetSemanticGraph'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'targetRevision'
      and source.lifecycle='published'
  ) or not exists(
    select 1 from public.feature_graph_versions source
    where source.tenant_id=tenant_value
      and source.graph_version=
        input_record->'sourceVersions'->>'baseFeatureGraph'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'baseRevision'
      and source.lifecycle in('published','superseded')
      and source.semantic_graph_version=
        input_record->'sourceVersions'->>'baseSemanticGraph'
      and source.repository_intelligence_version=
        input_record->'sourceVersions'->>'baseRepositoryIntelligence'
  ) or not exists(
    select 1 from public.feature_graph_versions source
    where source.tenant_id=tenant_value
      and source.graph_version=
        input_record->'sourceVersions'->>'targetFeatureGraph'
      and source.repository_id=input_record->>'repositoryId'
      and source.repository_revision=input_record->>'targetRevision'
      and source.lifecycle='published'
      and source.semantic_graph_version=
        input_record->'sourceVersions'->>'targetSemanticGraph'
      and source.repository_intelligence_version=
        input_record->'sourceVersions'->>'targetRepositoryIntelligence'
  ) then
    raise check_violation using message='repository_evolution_source_lineage_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||evolution_value,0
  ));
  select * into existing
  from public.repository_evolution_records evolution
  where evolution.tenant_id=tenant_value
    and evolution.evolution_id=evolution_value for update;
  if found and input_expected_version is not null
    and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure
      using message='repository_evolution_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure
      using message='repository_evolution_version_conflict';
  end if;
  if found and existing.owner_id<>input_record->>'ownerId' then
    raise insufficient_privilege
      using message='repository_evolution_access_denied';
  end if;
  saved_state:=jsonb_set(input_record,'{persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.repository_evolution_records(
    tenant_id,evolution_id,owner_id,repository_id,base_revision,
    target_revision,schema_version,analysis_version,persistence_version,
    source_fingerprint,source_versions,lifecycle,reused_count,
    comparison_latency_ms,recovery_count,comparison_timestamp,state,
    created_at,updated_at,published_at
  ) values(
    tenant_value,evolution_value,input_record->>'ownerId',
    input_record->>'repositoryId',input_record->>'baseRevision',
    input_record->>'targetRevision',input_record->>'schemaVersion',
    input_record->>'analysisVersion',
    coalesce(existing.persistence_version+1,1),
    input_record->>'sourceFingerprint',input_record->'sourceVersions',
    input_record->>'lifecycle',(input_record->>'reusedCount')::bigint,
    (input_record->>'comparisonLatencyMs')::double precision,
    (input_record->>'recoveryCount')::bigint,
    (input_record->>'comparisonTimestamp')::timestamptz,saved_state,
    (input_record->>'createdAt')::timestamptz,
    (input_record->>'updatedAt')::timestamptz,
    nullif(input_record->>'publishedAt','')::timestamptz
  ) on conflict(tenant_id,evolution_id) do update set
    persistence_version=excluded.persistence_version,
    source_fingerprint=excluded.source_fingerprint,
    source_versions=excluded.source_versions,lifecycle=excluded.lifecycle,
    reused_count=excluded.reused_count,
    comparison_latency_ms=excluded.comparison_latency_ms,
    recovery_count=excluded.recovery_count,
    comparison_timestamp=excluded.comparison_timestamp,state=excluded.state,
    updated_at=excluded.updated_at,published_at=excluded.published_at;

  insert into public.repository_revision_comparisons(
    tenant_id,evolution_id,comparison,feature_change_count,
    architecture_change_count,dependency_change_count,
    semantic_change_count,workflow_change_count,knowledge_change_count,
    created_at
  ) values(
    tenant_value,evolution_value,comparison_value,
    jsonb_array_length(comparison_value->'features'->'added')+
      jsonb_array_length(comparison_value->'features'->'removed')+
      jsonb_array_length(comparison_value->'features'->'modified'),
    jsonb_array_length(comparison_value->'architecture'->'newModules')+
      jsonb_array_length(comparison_value->'architecture'->'removedModules')+
      jsonb_array_length(comparison_value->'architecture'->'couplingChanges')+
      jsonb_array_length(comparison_value->'architecture'->'hotspotChanges'),
    jsonb_array_length(comparison_value->'dependencies'->'added')+
      jsonb_array_length(comparison_value->'dependencies'->'removed'),
    jsonb_array_length(comparison_value->'semantic'->'symbolAdditions')+
      jsonb_array_length(comparison_value->'semantic'->'symbolRemovals')+
      jsonb_array_length(comparison_value->'semantic'->'interfaceChanges')+
      jsonb_array_length(comparison_value->'semantic'->'inheritanceChanges')+
      jsonb_array_length(comparison_value->'semantic'->'implementationChanges')+
      jsonb_array_length(comparison_value->'semantic'->'apiEvolution'),
    jsonb_array_length(comparison_value->'workflows'->'added')+
      jsonb_array_length(comparison_value->'workflows'->'removed')+
      jsonb_array_length(comparison_value->'workflows'->'modified'),
    jsonb_array_length(comparison_value->'knowledge'->'added')+
      jsonb_array_length(comparison_value->'knowledge'->'removed')+
      jsonb_array_length(comparison_value->'knowledge'->'modified'),
    (input_record->>'comparisonTimestamp')::timestamptz
  ) on conflict(tenant_id,evolution_id) do update set
    comparison=excluded.comparison,
    feature_change_count=excluded.feature_change_count,
    architecture_change_count=excluded.architecture_change_count,
    dependency_change_count=excluded.dependency_change_count,
    semantic_change_count=excluded.semantic_change_count,
    workflow_change_count=excluded.workflow_change_count,
    knowledge_change_count=excluded.knowledge_change_count,
    created_at=excluded.created_at;

  delete from public.repository_evolution_timelines
    where tenant_id=tenant_value and evolution_id=evolution_value;
  for timeline_value in
    select value from jsonb_array_elements(input_record->'timelines')
  loop
    insert into public.repository_evolution_timelines(
      tenant_id,evolution_id,timeline_id,timeline_kind,entity_id,
      entity_name,change_kind,base_revision,target_revision,evidence,
      details,occurred_at
    ) values(
      tenant_value,evolution_value,timeline_value->>'timelineId',
      timeline_value->>'kind',timeline_value->>'entityId',
      timeline_value->>'entityName',timeline_value->>'change',
      timeline_value->>'baseRevision',timeline_value->>'targetRevision',
      timeline_value->'evidence',timeline_value->'details',
      (timeline_value->>'occurredAt')::timestamptz
    );
  end loop;

  delete from public.repository_evolution_trend_summaries
    where tenant_id=tenant_value and evolution_id=evolution_value;
  for trend_value in
    select value from jsonb_array_elements(input_record->'trends')
  loop
    insert into public.repository_evolution_trend_summaries(
      tenant_id,evolution_id,trend_id,trend_type,direction,magnitude,
      confidence,summary,evidence,trend,created_at
    ) values(
      tenant_value,evolution_value,trend_value->>'trendId',
      trend_value->>'type',trend_value->>'direction',
      (trend_value->>'magnitude')::double precision,
      (trend_value->>'confidence')::double precision,
      trend_value->>'summary',trend_value->'evidence',trend_value,
      (input_record->>'comparisonTimestamp')::timestamptz
    );
  end loop;

  delete from public.repository_evolution_diagnostics
    where tenant_id=tenant_value and evolution_id=evolution_value;
  for diagnostic_value in
    select value from jsonb_array_elements(input_record->'diagnostics')
  loop
    insert into public.repository_evolution_diagnostics(
      tenant_id,evolution_id,diagnostic_position,code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,evolution_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value,(input_record->>'comparisonTimestamp')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;
  return query select evolution.state
  from public.repository_evolution_records evolution
  where evolution.tenant_id=tenant_value
    and evolution.evolution_id=evolution_value;
end; $$;

create or replace function public.record_repository_evolution_reuse(
  input_tenant_id text,input_owner_id text,input_evolution_id text
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.repository_evolution_records set
    reused_count=reused_count+1,updated_at=now()
  where tenant_id=input_tenant_id and evolution_id=input_evolution_id
    and owner_id=input_owner_id and lifecycle='published';
  if not found then
    raise no_data_found using message='repository_evolution_not_found';
  end if;
end; $$;

create or replace function public.get_repository_evolution_revision_source(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_repository_revision text
) returns table(revision_source jsonb)
language sql stable security invoker set search_path=public as $$
  with intelligence as(
    select version.*,snapshot.snapshot,snapshot.publication_metadata
    from public.repository_intelligence_versions version
    join public.repository_intelligence_snapshots snapshot
      using(intelligence_version)
    where version.repository_id=input_repository_id
      and version.repository_revision=input_repository_revision
      and version.status in('published','superseded')
    order by version.updated_at desc,version.intelligence_version
    limit 1
  ), graph as(
    select version.*,
      diagnostic.parsed_file_count,diagnostic.parser_failure_count,
      diagnostic.unresolved_import_count,diagnostic.import_count,
      diagnostic.unresolved_file_ratio,diagnostic.parser_failure_ratio,
      diagnostic.orphan_symbol_count,diagnostic.duplicate_node_id_count,
      diagnostic.duplicate_edge_id_count,diagnostic.missing_endpoint_count,
      diagnostic.impossible_self_edge_count,diagnostic.graph_bytes,
      diagnostic.duration_ms,diagnostic.details
    from public.repository_graph_versions version
    join public.repository_graph_diagnostics diagnostic
      using(graph_version)
    where version.repository_id=input_repository_id
      and version.repository_revision=input_repository_revision
      and version.status in('published','superseded')
      and diagnostic.is_valid
    order by version.updated_at desc,version.graph_version
    limit 1
  ), semantic as(
    select version.*
    from public.semantic_graph_versions version
    where version.tenant_id=input_tenant_id
      and version.owner_id=input_owner_id
      and version.repository_id=input_repository_id
      and version.repository_revision=input_repository_revision
      and version.lifecycle in('published','superseded')
    order by version.updated_at desc,version.graph_version
    limit 1
  ), feature as(
    select version.*
    from public.feature_graph_versions version
    where version.tenant_id=input_tenant_id
      and version.owner_id=input_owner_id
      and version.repository_id=input_repository_id
      and version.repository_revision=input_repository_revision
      and version.lifecycle in('published','superseded')
    order by version.updated_at desc,version.graph_version
    limit 1
  )
  select jsonb_build_object(
    'repositoryIntelligence',
      intelligence.snapshot||jsonb_build_object(
        'status',intelligence.status,
        'createdAt',intelligence.created_at,
        'validatedAt',intelligence.validated_at,
        'publishedAt',intelligence.published_at,
        'publicationMetadata',intelligence.publication_metadata
      ),
    'repositoryGraph',jsonb_build_object(
      'graphVersion',graph.graph_version,
      'repositoryId',graph.repository_id,
      'repositoryRevision',graph.repository_revision,
      'repositoryVersion',graph.repository_revision,
      'parserVersion',graph.parser_version,
      'status',graph.status,
      'createdAt',graph.created_at,
      'publishedAt',graph.published_at,
      'nodes',coalesce((
        select jsonb_agg(jsonb_build_object(
          'nodeId',node.node_id,'symbolId',node.node_id,
          'graphVersion',node.graph_version,
          'repositoryId',node.repository_id,
          'repositoryRevision',node.repository_revision,
          'repositoryVersion',node.repository_revision,
          'parserVersion',node.parser_version,'name',node.name,
          'qualifiedName',node.qualified_name,'kind',node.kind,
          'language',node.language,'file',node.file_path,
          'line',node.start_line,'endLine',node.end_line,
          'column',node.start_column,'endColumn',node.end_column,
          'exported',node.exported,'defaultExport',node.default_export,
          'metadata',node.metadata
        ) order by node.node_id)
        from public.repository_graph_nodes node
        where node.graph_version=graph.graph_version
      ),'[]'::jsonb),
      'edges',coalesce((
        select jsonb_agg(jsonb_build_object(
          'edgeId',edge.edge_id,'graphVersion',edge.graph_version,
          'repositoryId',edge.repository_id,
          'repositoryRevision',edge.repository_revision,
          'parserVersion',edge.parser_version,
          'fromNodeId',edge.from_node_id,'toNodeId',edge.to_node_id,
          'fromSymbolId',edge.from_node_id,'toSymbolId',edge.to_node_id,
          'kind',edge.kind,'distance',edge.distance,
          'metadata',edge.metadata
        ) order by edge.edge_id)
        from public.repository_graph_edges edge
        where edge.graph_version=graph.graph_version
      ),'[]'::jsonb),
      'diagnostics',jsonb_build_object(
        'parsedFileCount',graph.parsed_file_count,
        'parserFailureCount',graph.parser_failure_count,
        'unresolvedImportCount',graph.unresolved_import_count,
        'importCount',graph.import_count,
        'unresolvedFileRatio',graph.unresolved_file_ratio,
        'parserFailureRatio',graph.parser_failure_ratio,
        'orphanSymbolCount',graph.orphan_symbol_count,
        'duplicateNodeIdCount',graph.duplicate_node_id_count,
        'duplicateEdgeIdCount',graph.duplicate_edge_id_count,
        'missingEndpointCount',graph.missing_endpoint_count,
        'impossibleSelfEdgeCount',graph.impossible_self_edge_count,
        'graphBytes',graph.graph_bytes,'durationMs',graph.duration_ms,
        'failures',coalesce(graph.details->'failures','[]'::jsonb)
      )
    ),
    'semanticGraph',semantic.state,
    'featureGraph',feature.state,
    'workflows',coalesce((
      select jsonb_agg(workflow.state order by workflow.workflow_id)
      from public.autonomous_workflows workflow
      where workflow.tenant_id=input_tenant_id
        and workflow.owner_id=input_owner_id
        and workflow.repository_id=input_repository_id
        and workflow.repository_revision=input_repository_revision
    ),'[]'::jsonb),
    'knowledge',coalesce((
      select jsonb_agg(jsonb_build_object(
        'knowledgeId',knowledge.knowledge_id,
        'namespace',knowledge.namespace,'subject',knowledge.subject,
        'repositoryRevision',knowledge.repository_revision,
        'version',knowledge.knowledge_version,
        'confidence',knowledge.confidence,'score',knowledge.confidence,
        'rank',1,'contentHash',knowledge.content_hash,
        'content',version.content,'executionId',version.execution_id
      ) order by knowledge.knowledge_id)
      from public.repository_knowledge knowledge
      join public.repository_knowledge_versions version
        on version.tenant_id=knowledge.tenant_id
        and version.knowledge_id=knowledge.knowledge_id
        and version.knowledge_version=knowledge.knowledge_version
      where knowledge.tenant_id=input_tenant_id
        and knowledge.owner_id=input_owner_id
        and knowledge.repository_id=input_repository_id
        and knowledge.repository_revision=input_repository_revision
        and knowledge.lifecycle in('active','superseded')
    ),'[]'::jsonb)
  )
  from intelligence,graph,semantic,feature
  where exists(
    select 1 from public.repositories repository
    join public.repository_snapshots snapshot
      on snapshot.repository_id=repository.repository_id
      and snapshot.revision=input_repository_revision
      and snapshot.status in('published','superseded')
    where repository.repository_id=input_repository_id
      and repository.owner_user_id=input_owner_id
      and repository.deletion_state='active'
  )
$$;

create or replace function public.get_repository_evolution_auxiliary_sources(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_base_revision text,input_target_revision text
) returns table(sources jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'baseWorkflows',coalesce((
      select jsonb_agg(workflow.state order by workflow.workflow_id)
      from public.autonomous_workflows workflow
      where workflow.tenant_id=input_tenant_id
        and workflow.owner_id=input_owner_id
        and workflow.repository_id=input_repository_id
        and workflow.repository_revision=input_base_revision
    ),'[]'::jsonb),
    'targetWorkflows',coalesce((
      select jsonb_agg(workflow.state order by workflow.workflow_id)
      from public.autonomous_workflows workflow
      where workflow.tenant_id=input_tenant_id
        and workflow.owner_id=input_owner_id
        and workflow.repository_id=input_repository_id
        and workflow.repository_revision=input_target_revision
    ),'[]'::jsonb),
    'baseKnowledge',coalesce((
      select jsonb_agg(jsonb_build_object(
        'knowledgeId',knowledge.knowledge_id,
        'namespace',knowledge.namespace,'subject',knowledge.subject,
        'repositoryRevision',knowledge.repository_revision,
        'version',knowledge.knowledge_version,
        'confidence',knowledge.confidence,'score',knowledge.confidence,
        'rank',1,'contentHash',knowledge.content_hash,
        'content',version.content,'executionId',version.execution_id
      ) order by knowledge.knowledge_id)
      from public.repository_knowledge knowledge
      join public.repository_knowledge_versions version
        on version.tenant_id=knowledge.tenant_id
        and version.knowledge_id=knowledge.knowledge_id
        and version.knowledge_version=knowledge.knowledge_version
      where knowledge.tenant_id=input_tenant_id
        and knowledge.owner_id=input_owner_id
        and knowledge.repository_id=input_repository_id
        and knowledge.repository_revision=input_base_revision
        and knowledge.lifecycle in('active','superseded')
    ),'[]'::jsonb),
    'targetKnowledge',coalesce((
      select jsonb_agg(jsonb_build_object(
        'knowledgeId',knowledge.knowledge_id,
        'namespace',knowledge.namespace,'subject',knowledge.subject,
        'repositoryRevision',knowledge.repository_revision,
        'version',knowledge.knowledge_version,
        'confidence',knowledge.confidence,'score',knowledge.confidence,
        'rank',1,'contentHash',knowledge.content_hash,
        'content',version.content,'executionId',version.execution_id
      ) order by knowledge.knowledge_id)
      from public.repository_knowledge knowledge
      join public.repository_knowledge_versions version
        on version.tenant_id=knowledge.tenant_id
        and version.knowledge_id=knowledge.knowledge_id
        and version.knowledge_version=knowledge.knowledge_version
      where knowledge.tenant_id=input_tenant_id
        and knowledge.owner_id=input_owner_id
        and knowledge.repository_id=input_repository_id
        and knowledge.repository_revision=input_target_revision
        and knowledge.lifecycle in('active','superseded')
    ),'[]'::jsonb)
  )
  where exists(
    select 1 from public.repositories repository
    join public.repository_snapshots base_snapshot
      on base_snapshot.repository_id=repository.repository_id
      and base_snapshot.revision=input_base_revision
      and base_snapshot.status in('published','superseded')
    join public.repository_snapshots target_snapshot
      on target_snapshot.repository_id=repository.repository_id
      and target_snapshot.revision=input_target_revision
      and target_snapshot.status='published'
    where repository.repository_id=input_repository_id
      and repository.owner_user_id=input_owner_id
      and repository.current_revision=input_target_revision
      and repository.indexed_revision=input_target_revision
      and repository.deletion_state='active'
      and base_snapshot.created_at<=target_snapshot.indexed_at
  )
$$;

create or replace function public.recover_repository_evolution_records()
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  with invalid as(
    select evolution.tenant_id,evolution.evolution_id
    from public.repository_evolution_records evolution
    left join public.repositories repository
      on repository.repository_id=evolution.repository_id
    where evolution.lifecycle='comparing'
      or repository.repository_id is null
      or evolution.owner_id<>repository.owner_user_id
      or exists(
        select 1 from public.repository_evolution_timelines timeline
        where timeline.tenant_id=evolution.tenant_id
          and timeline.evolution_id=evolution.evolution_id
          and (timeline.base_revision<>evolution.base_revision
            or timeline.target_revision<>evolution.target_revision)
      )
      or (
        evolution.lifecycle='published'
        and (
          select feature_change_count+architecture_change_count+
            dependency_change_count+semantic_change_count+
            workflow_change_count+knowledge_change_count
          from public.repository_revision_comparisons comparison
          where comparison.tenant_id=evolution.tenant_id
            and comparison.evolution_id=evolution.evolution_id
        )>0
        and not exists(
          select 1 from public.repository_evolution_timelines timeline
          where timeline.tenant_id=evolution.tenant_id
            and timeline.evolution_id=evolution.evolution_id
        )
      )
  )
  update public.repository_evolution_records evolution set
    lifecycle='failed',published_at=null,updated_at=now(),
    persistence_version=persistence_version+1,
    recovery_count=recovery_count+1,
    state=jsonb_set(jsonb_set(jsonb_set(
      state,'{lifecycle}','"failed"'::jsonb),
      '{publishedAt}','null'::jsonb),
      '{persistenceVersion}',to_jsonb(persistence_version+1))
  from invalid where evolution.tenant_id=invalid.tenant_id
    and evolution.evolution_id=invalid.evolution_id;
  get diagnostics affected=row_count;
  return query select affected;
end; $$;

create or replace function public.repository_evolution_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  with records as(
    select * from public.repository_evolution_records evolution
    where evolution.lifecycle='published'
      and (input_tenant_id is null or evolution.tenant_id=input_tenant_id)
  )
  select jsonb_build_object(
    'comparisons',(select count(*) from records),
    'timelines',(select count(*)
      from public.repository_evolution_timelines timeline
      join records using(tenant_id,evolution_id)),
    'trends',(select count(*)
      from public.repository_evolution_trend_summaries trend
      join records using(tenant_id,evolution_id)),
    'reuseRate',case
      when (select count(*)+coalesce(sum(reused_count),0) from records)=0 then 0
      else (
        select round(
          coalesce(sum(reused_count),0)::numeric/
          (count(*)+coalesce(sum(reused_count),0)),3
        ) from records
      ) end,
    'recoveryCount',coalesce((
      select sum(recovery_count)
      from public.repository_evolution_records evolution
      where input_tenant_id is null or evolution.tenant_id=input_tenant_id
    ),0),
    'averageComparisonLatencyMs',coalesce((
      select avg(comparison_latency_ms) from records
    ),0)
  )
$$;

create or replace function public.collect_repository_evolution_records(
  input_tenant_id text,input_retained_records integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_evolution_retention(
    tenant_id,retained_records
  ) values(input_tenant_id,greatest(1,input_retained_records))
  on conflict(tenant_id) do update set
    retained_records=excluded.retained_records,updated_at=now();
  with victims as(
    select evolution_id
    from public.repository_evolution_records
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,evolution_id desc
    offset greatest(1,input_retained_records)
  )
  delete from public.repository_evolution_records evolution
  using victims where evolution.tenant_id=input_tenant_id
    and evolution.evolution_id=victims.evolution_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_repository_evolution_source_contract()
returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  foreach object_name in array array[
    'repository_snapshots','repository_intelligence_versions',
    'repository_graph_versions','semantic_graph_versions',
    'feature_graph_versions','autonomous_workflows',
    'repository_knowledge','repository_knowledge_versions'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_source_missing');
    end if;
  end loop;
  if to_regprocedure(
      'public.get_repository_evolution_revision_source(text,text,text,text)')
      is null then
    issues:=issues||'"repository_evolution_revision_source_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

create or replace function public.verify_repository_evolution_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-evolution-intelligence-v1'
    or input_schema_version<>'repository-evolution-schema-v1' then
    issues:=issues||'"repository_evolution_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_evolution_records','repository_revision_comparisons',
    'repository_evolution_timelines',
    'repository_evolution_trend_summaries',
    'repository_evolution_diagnostics','repository_evolution_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_evolution_revision_pair_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_evolution_history_navigation_idx')
    or not exists(select 1 from pg_constraint
      where conname='repository_evolution_timeline_record_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_evolution_trend_record_fk'
        and confdeltype='c') then
    issues:=issues||
      '"repository_evolution_indexes_or_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_evolution_records','select')
    or has_table_privilege(
      'anon','public.repository_evolution_records','select')
    or not has_function_privilege(
      'service_role',
      'public.save_repository_evolution_record(jsonb,text)','execute')
    or has_function_privilege(
      'anon',
      'public.save_repository_evolution_record(jsonb,text)','execute') then
    issues:=issues||'"repository_evolution_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_evolution_records(text,integer)') is null
    or to_regprocedure(
      'public.recover_repository_evolution_records()') is null then
    issues:=issues||
      '"repository_evolution_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$ declare object_name text;
begin
  foreach object_name in array array[
    'repository_evolution_records','repository_revision_comparisons',
    'repository_evolution_timelines',
    'repository_evolution_trend_summaries',
    'repository_evolution_diagnostics','repository_evolution_retention'
  ] loop
    execute format('alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',object_name);
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name);
  end loop;
end $$;

revoke all on function public.get_repository_evolution_record(
  text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.list_repository_evolution_records(
  text,text,text) from public,anon,authenticated;
revoke all on function public.save_repository_evolution_record(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.record_repository_evolution_reuse(text,text,text)
  from public,anon,authenticated;
revoke all on function public.get_repository_evolution_auxiliary_sources(
  text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_repository_evolution_revision_source(
  text,text,text,text) from public,anon,authenticated;
revoke all on function public.recover_repository_evolution_records()
  from public,anon,authenticated;
revoke all on function public.repository_evolution_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_evolution_records(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_repository_evolution_source_contract()
  from public,anon,authenticated;
revoke all on function public.verify_repository_evolution_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_evolution_record(
  text,text,text,text,text) to service_role;
grant execute on function public.list_repository_evolution_records(
  text,text,text) to service_role;
grant execute on function public.save_repository_evolution_record(jsonb,text)
  to service_role;
grant execute on function public.record_repository_evolution_reuse(
  text,text,text) to service_role;
grant execute on function public.get_repository_evolution_auxiliary_sources(
  text,text,text,text,text) to service_role;
grant execute on function public.get_repository_evolution_revision_source(
  text,text,text,text) to service_role;
grant execute on function public.recover_repository_evolution_records()
  to service_role;
grant execute on function public.repository_evolution_metrics(text)
  to service_role;
grant execute on function public.collect_repository_evolution_records(
  text,integer) to service_role;
grant execute on function public.verify_repository_evolution_source_contract()
  to service_role;
grant execute on function public.verify_repository_evolution_contract(text,text)
  to service_role;

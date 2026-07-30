create table if not exists public.repository_insight_generation_metadata (
  tenant_id text not null,
  generation_id text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  schema_version text not null,
  persistence_version bigint not null,
  source_fingerprint text not null,
  source_versions jsonb not null,
  lifecycle text not null,
  generated_count integer not null,
  reused_count bigint not null default 0,
  generation_latency_ms double precision not null,
  recovery_count bigint not null default 0,
  state jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  primary key(tenant_id,generation_id),
  constraint repository_insight_generation_identity_non_empty check(
    tenant_id<>'' and generation_id<>'' and owner_id<>''
    and repository_id<>'' and source_fingerprint<>''
  ),
  constraint repository_insight_generation_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_insight_generation_schema_valid
    check(schema_version='repository-insight-schema-v1'),
  constraint repository_insight_generation_lifecycle_valid check(lifecycle in(
    'generating','published','partial','failed','superseded'
  )),
  constraint repository_insight_generation_metrics_valid check(
    generated_count>=0 and reused_count>=0 and generation_latency_ms>=0
    and recovery_count>=0
  ),
  constraint repository_insight_generation_json_valid check(
    jsonb_typeof(source_versions)='object' and jsonb_typeof(state)='object'
  )
);

create table if not exists public.repository_insights (
  tenant_id text not null,
  generation_id text not null,
  insight_id text not null,
  repository_id text not null,
  repository_revision text not null,
  insight_type text not null,
  title text not null,
  summary text not null,
  severity text not null,
  confidence double precision not null,
  insight jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,generation_id,insight_id),
  constraint repository_insight_generation_fk
    foreign key(tenant_id,generation_id)
    references public.repository_insight_generation_metadata(
      tenant_id,generation_id
    ) on delete cascade,
  constraint repository_insight_identity_non_empty check(
    insight_id<>'' and repository_id<>'' and title<>'' and summary<>''
  ),
  constraint repository_insight_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_insight_type_valid check(insight_type in(
    'architectural hotspot','highly coupled module','cyclic dependency',
    'oversized feature','dead code candidate','orphan module',
    'duplicated implementation','high-risk dependency','complex workflow',
    'feature ownership anomaly','stale knowledge','documentation gap'
  )),
  constraint repository_insight_severity_valid check(severity in(
    'info','low','medium','high','critical'
  )),
  constraint repository_insight_confidence_valid check(confidence between 0 and 1),
  constraint repository_insight_object check(jsonb_typeof(insight)='object')
);

create table if not exists public.repository_insight_evidence (
  tenant_id text not null,
  generation_id text not null,
  insight_id text not null,
  evidence_id text not null,
  evidence_kind text not null,
  reference text not null,
  source_engine text not null,
  source_version text not null,
  evidence jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,generation_id,insight_id,evidence_id),
  constraint repository_insight_evidence_insight_fk
    foreign key(tenant_id,generation_id,insight_id)
    references public.repository_insights(
      tenant_id,generation_id,insight_id
    ) on delete cascade,
  constraint repository_insight_evidence_identity_non_empty check(
    evidence_id<>'' and reference<>'' and source_engine<>'' and source_version<>''
  ),
  constraint repository_insight_evidence_kind_valid check(evidence_kind in(
    'file','symbol','module','feature','dependency_path','workflow'
  )),
  constraint repository_insight_evidence_object
    check(jsonb_typeof(evidence)='object')
);

create table if not exists public.repository_insight_scores (
  tenant_id text not null,
  generation_id text not null,
  insight_id text not null,
  total double precision not null,
  dependency_depth double precision not null,
  feature_impact double precision not null,
  coupling double precision not null,
  usage_frequency double precision not null,
  query_frequency double precision not null,
  architectural_centrality double precision not null,
  score jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,generation_id,insight_id),
  constraint repository_insight_score_insight_fk
    foreign key(tenant_id,generation_id,insight_id)
    references public.repository_insights(
      tenant_id,generation_id,insight_id
    ) on delete cascade,
  constraint repository_insight_score_total_valid check(total between 0 and 100),
  constraint repository_insight_score_factors_valid check(
    dependency_depth between 0 and 1 and feature_impact between 0 and 1
    and coupling between 0 and 1 and usage_frequency between 0 and 1
    and query_frequency between 0 and 1
    and architectural_centrality between 0 and 1
  ),
  constraint repository_insight_score_object check(jsonb_typeof(score)='object')
);

create table if not exists public.repository_insight_diagnostics (
  tenant_id text not null,
  generation_id text not null,
  diagnostic_position integer not null,
  code text not null,
  severity text not null,
  insight_id text,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,generation_id,diagnostic_position),
  constraint repository_insight_diagnostic_generation_fk
    foreign key(tenant_id,generation_id)
    references public.repository_insight_generation_metadata(
      tenant_id,generation_id
    ) on delete cascade,
  constraint repository_insight_diagnostic_position_valid
    check(diagnostic_position>=0),
  constraint repository_insight_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_insight_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_insight_retention (
  tenant_id text primary key,
  retained_generations integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_insight_retention_positive
    check(retained_generations>0)
);

create unique index if not exists repository_insight_current_generation_idx
  on public.repository_insight_generation_metadata(
    tenant_id,owner_id,repository_id,repository_revision
  ) where lifecycle='published';
create index if not exists repository_insight_generation_source_idx
  on public.repository_insight_generation_metadata(
    tenant_id,repository_id,repository_revision,source_fingerprint
  );
create index if not exists repository_insight_generation_recovery_idx
  on public.repository_insight_generation_metadata(lifecycle,updated_at)
  where lifecycle='generating';
create index if not exists repository_insight_priority_idx
  on public.repository_insight_scores(
    tenant_id,generation_id,total desc,insight_id
  );
create index if not exists repository_insight_type_severity_idx
  on public.repository_insights(
    tenant_id,generation_id,insight_type,severity,confidence desc
  );
create index if not exists repository_insight_evidence_reference_idx
  on public.repository_insight_evidence(
    tenant_id,evidence_kind,reference,generation_id
  );
create index if not exists repository_insight_diagnostic_code_idx
  on public.repository_insight_diagnostics(
    tenant_id,code,severity,created_at desc
  );

create or replace function public.get_repository_insight_generation(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_repository_revision text
) returns table(generation jsonb)
language sql stable security invoker set search_path=public as $$
  select metadata.state
  from public.repository_insight_generation_metadata metadata
  where metadata.tenant_id=input_tenant_id
    and metadata.owner_id=input_owner_id
    and metadata.repository_id=input_repository_id
    and metadata.repository_revision=input_repository_revision
    and metadata.lifecycle='published'
$$;

create or replace function public.save_repository_insight_generation(
  input_generation jsonb,input_expected_version text
) returns table(generation jsonb)
language plpgsql security invoker set search_path=public as $$
declare tenant_value text:=input_generation->>'tenantId';
declare generation_value text:=input_generation->>'generationId';
declare existing public.repository_insight_generation_metadata%rowtype;
declare saved_state jsonb;
declare insight_value jsonb;
declare evidence_value jsonb;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
begin
  if jsonb_typeof(input_generation)<>'object'
    or input_generation->>'schemaVersion'<>'repository-insight-schema-v1'
    or jsonb_typeof(input_generation->'sourceVersions')<>'object'
    or jsonb_typeof(input_generation->'insights')<>'array'
    or jsonb_typeof(input_generation->'diagnostics')<>'array' then
    raise check_violation using message='repository_insight_generation_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_generation->>'repositoryId'
      and repository.owner_user_id=input_generation->>'ownerId'
      and repository.current_revision=input_generation->>'repositoryRevision'
      and repository.indexed_revision=input_generation->>'repositoryRevision'
      and repository.deletion_state='active'
  ) or not exists(
    select 1 from public.repository_intelligence_versions intelligence
    where intelligence.intelligence_version=
      input_generation->'sourceVersions'->>'repositoryIntelligence'
      and intelligence.repository_id=input_generation->>'repositoryId'
      and intelligence.repository_revision=input_generation->>'repositoryRevision'
      and intelligence.status='published'
  ) or not exists(
    select 1 from public.repository_graph_versions graph
    where graph.graph_version=
      input_generation->'sourceVersions'->>'repositoryGraph'
      and graph.repository_id=input_generation->>'repositoryId'
      and graph.repository_revision=input_generation->>'repositoryRevision'
      and graph.status='published'
  ) or not exists(
    select 1 from public.semantic_graph_versions semantic
    where semantic.tenant_id=tenant_value
      and semantic.graph_version=
        input_generation->'sourceVersions'->>'semanticGraph'
      and semantic.repository_id=input_generation->>'repositoryId'
      and semantic.repository_revision=input_generation->>'repositoryRevision'
      and semantic.lifecycle='published'
  ) or not exists(
    select 1 from public.feature_graph_versions feature
    where feature.tenant_id=tenant_value
      and feature.graph_version=
        input_generation->'sourceVersions'->>'featureGraph'
      and feature.repository_id=input_generation->>'repositoryId'
      and feature.repository_revision=input_generation->>'repositoryRevision'
      and feature.semantic_graph_version=
        input_generation->'sourceVersions'->>'semanticGraph'
      and feature.repository_intelligence_version=
        input_generation->'sourceVersions'->>'repositoryIntelligence'
      and feature.lifecycle='published'
  ) then
    raise check_violation using message='repository_insight_source_lineage_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||generation_value,0
  ));
  select * into existing
  from public.repository_insight_generation_metadata metadata
  where metadata.tenant_id=tenant_value
    and metadata.generation_id=generation_value for update;
  if found and input_expected_version is not null
    and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure using message='repository_insight_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_insight_version_conflict';
  end if;
  if found and existing.owner_id<>input_generation->>'ownerId' then
    raise insufficient_privilege using message='repository_insight_access_denied';
  end if;

  update public.repository_insight_generation_metadata set
    lifecycle='superseded',updated_at=
      (input_generation->>'updatedAt')::timestamptz,
    persistence_version=persistence_version+1,
    state=jsonb_set(state,'{lifecycle}','"superseded"'::jsonb)
  where tenant_id=tenant_value
    and owner_id=input_generation->>'ownerId'
    and repository_id=input_generation->>'repositoryId'
    and input_generation->>'lifecycle'='published'
    and lifecycle='published' and generation_id<>generation_value;

  saved_state:=jsonb_set(input_generation,'{persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.repository_insight_generation_metadata(
    tenant_id,generation_id,owner_id,repository_id,repository_revision,
    schema_version,persistence_version,source_fingerprint,source_versions,
    lifecycle,generated_count,reused_count,generation_latency_ms,
    recovery_count,state,created_at,updated_at,published_at
  ) values(
    tenant_value,generation_value,input_generation->>'ownerId',
    input_generation->>'repositoryId',
    input_generation->>'repositoryRevision',
    input_generation->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),
    input_generation->>'sourceFingerprint',
    input_generation->'sourceVersions',input_generation->>'lifecycle',
    (input_generation->>'generatedCount')::integer,
    (input_generation->>'reusedCount')::bigint,
    (input_generation->>'generationLatencyMs')::double precision,
    (input_generation->>'recoveryCount')::bigint,saved_state,
    (input_generation->>'createdAt')::timestamptz,
    (input_generation->>'updatedAt')::timestamptz,
    nullif(input_generation->>'publishedAt','')::timestamptz
  ) on conflict(tenant_id,generation_id) do update set
    persistence_version=excluded.persistence_version,
    source_fingerprint=excluded.source_fingerprint,
    source_versions=excluded.source_versions,lifecycle=excluded.lifecycle,
    generated_count=excluded.generated_count,reused_count=excluded.reused_count,
    generation_latency_ms=excluded.generation_latency_ms,
    recovery_count=excluded.recovery_count,state=excluded.state,
    updated_at=excluded.updated_at,published_at=excluded.published_at;

  delete from public.repository_insights
    where tenant_id=tenant_value and generation_id=generation_value;
  for insight_value in
    select value from jsonb_array_elements(input_generation->'insights')
  loop
    if jsonb_array_length(insight_value->'supportingEvidence')=0
      or jsonb_typeof(insight_value->'score')<>'object' then
      raise check_violation using message='repository_insight_evidence_invalid';
    end if;
    insert into public.repository_insights(
      tenant_id,generation_id,insight_id,repository_id,repository_revision,
      insight_type,title,summary,severity,confidence,insight,created_at,updated_at
    ) values(
      tenant_value,generation_value,insight_value->>'insightId',
      insight_value->>'repositoryId',insight_value->>'repositoryRevision',
      insight_value->>'type',insight_value->>'title',insight_value->>'summary',
      insight_value->>'severity',
      (insight_value->>'confidence')::double precision,insight_value,
      (insight_value->>'createdAt')::timestamptz,
      (insight_value->>'updatedAt')::timestamptz
    );
    for evidence_value in
      select value from jsonb_array_elements(
        insight_value->'supportingEvidence'
      )
    loop
      insert into public.repository_insight_evidence(
        tenant_id,generation_id,insight_id,evidence_id,evidence_kind,
        reference,source_engine,source_version,evidence,created_at
      ) values(
        tenant_value,generation_value,insight_value->>'insightId',
        evidence_value->>'evidenceId',evidence_value->>'kind',
        evidence_value->>'reference',evidence_value->>'sourceEngine',
        evidence_value->>'sourceVersion',evidence_value,
        (insight_value->>'updatedAt')::timestamptz
      );
    end loop;
    insert into public.repository_insight_scores(
      tenant_id,generation_id,insight_id,total,dependency_depth,
      feature_impact,coupling,usage_frequency,query_frequency,
      architectural_centrality,score,created_at
    ) values(
      tenant_value,generation_value,insight_value->>'insightId',
      (insight_value->'score'->>'total')::double precision,
      (insight_value->'score'->>'dependencyDepth')::double precision,
      (insight_value->'score'->>'featureImpact')::double precision,
      (insight_value->'score'->>'coupling')::double precision,
      (insight_value->'score'->>'usageFrequency')::double precision,
      (insight_value->'score'->>'queryFrequency')::double precision,
      (insight_value->'score'->>'architecturalCentrality')::double precision,
      insight_value->'score',(insight_value->>'updatedAt')::timestamptz
    );
  end loop;

  delete from public.repository_insight_diagnostics
    where tenant_id=tenant_value and generation_id=generation_value;
  for diagnostic_value in
    select value from jsonb_array_elements(input_generation->'diagnostics')
  loop
    insert into public.repository_insight_diagnostics(
      tenant_id,generation_id,diagnostic_position,code,severity,insight_id,
      diagnostic,created_at
    ) values(
      tenant_value,generation_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value->>'insightId',diagnostic_value,
      (input_generation->>'updatedAt')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;
  return query select metadata.state
  from public.repository_insight_generation_metadata metadata
  where metadata.tenant_id=tenant_value
    and metadata.generation_id=generation_value;
end; $$;

create or replace function public.record_repository_insight_reuse(
  input_tenant_id text,input_owner_id text,input_generation_id text,
  input_reused_count integer
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.repository_insight_generation_metadata set
    reused_count=reused_count+greatest(0,input_reused_count),updated_at=now()
  where tenant_id=input_tenant_id and generation_id=input_generation_id
    and owner_id=input_owner_id and lifecycle='published';
  if not found then
    raise no_data_found using message='repository_insight_not_found';
  end if;
end; $$;

create or replace function public.get_repository_insight_auxiliary_sources(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_repository_revision text
) returns table(sources jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'changeAnalyses',coalesce((
      select jsonb_agg(analysis.state order by analysis.updated_at,analysis.analysis_id)
      from public.change_analyses analysis
      join public.change_requests request using(tenant_id,change_id)
      where analysis.tenant_id=input_tenant_id
        and request.owner_id=input_owner_id
        and request.repository_id=input_repository_id
        and request.repository_revision=input_repository_revision
        and analysis.lifecycle='published'
    ),'[]'::jsonb),
    'workflows',coalesce((
      select jsonb_agg(workflow.state order by workflow.updated_at,workflow.workflow_id)
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
      ) order by knowledge.updated_at,knowledge.knowledge_id)
      from public.repository_knowledge knowledge
      join public.repository_knowledge_versions version
        on version.tenant_id=knowledge.tenant_id
        and version.knowledge_id=knowledge.knowledge_id
        and version.knowledge_version=knowledge.knowledge_version
      where knowledge.tenant_id=input_tenant_id
        and knowledge.owner_id=input_owner_id
        and knowledge.repository_id=input_repository_id
        and knowledge.lifecycle='active'
    ),'[]'::jsonb),
    'queryHistory',coalesce((
      select jsonb_agg(query.execution order by query.updated_at,query.query_id)
      from public.repository_queries query
      where query.tenant_id=input_tenant_id
        and query.user_id=input_owner_id
        and query.repository_id=input_repository_id
        and query.repository_revision=input_repository_revision
        and query.lifecycle in('completed','partial')
    ),'[]'::jsonb)
  )
  where exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_repository_id
      and repository.owner_user_id=input_owner_id
      and repository.current_revision=input_repository_revision
      and repository.deletion_state='active'
  )
$$;

create or replace function public.recover_repository_insight_generations()
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  with invalid as(
    select metadata.tenant_id,metadata.generation_id
    from public.repository_insight_generation_metadata metadata
    left join public.repositories repository
      on repository.repository_id=metadata.repository_id
    where metadata.lifecycle='generating'
      or repository.repository_id is null
      or (metadata.lifecycle='published' and (
        repository.current_revision<>metadata.repository_revision
        or repository.owner_user_id<>metadata.owner_id
      ))
      or exists(
        select 1 from public.repository_insights insight
        where insight.tenant_id=metadata.tenant_id
          and insight.generation_id=metadata.generation_id
          and not exists(
            select 1 from public.repository_insight_evidence evidence
            where evidence.tenant_id=insight.tenant_id
              and evidence.generation_id=insight.generation_id
              and evidence.insight_id=insight.insight_id
          )
      )
  )
  update public.repository_insight_generation_metadata metadata set
    lifecycle='failed',published_at=null,updated_at=now(),
    persistence_version=persistence_version+1,
    recovery_count=recovery_count+1,
    state=jsonb_set(jsonb_set(jsonb_set(
      state,'{lifecycle}','"failed"'::jsonb),
      '{publishedAt}','null'::jsonb),
      '{persistenceVersion}',to_jsonb(persistence_version+1))
  from invalid where metadata.tenant_id=invalid.tenant_id
    and metadata.generation_id=invalid.generation_id;
  get diagnostics affected=row_count;
  return query select affected;
end; $$;

create or replace function public.repository_insight_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  with generations as(
    select * from public.repository_insight_generation_metadata metadata
    where metadata.lifecycle='published'
      and (input_tenant_id is null or metadata.tenant_id=input_tenant_id)
  ), insights as(
    select insight.* from public.repository_insights insight
    join generations using(tenant_id,generation_id)
  )
  select jsonb_build_object(
    'insightsGenerated',(select count(*) from insights),
    'insightCategories',jsonb_build_object(
      'architectural hotspot',(select count(*) from insights where insight_type='architectural hotspot'),
      'highly coupled module',(select count(*) from insights where insight_type='highly coupled module'),
      'cyclic dependency',(select count(*) from insights where insight_type='cyclic dependency'),
      'oversized feature',(select count(*) from insights where insight_type='oversized feature'),
      'dead code candidate',(select count(*) from insights where insight_type='dead code candidate'),
      'orphan module',(select count(*) from insights where insight_type='orphan module'),
      'duplicated implementation',(select count(*) from insights where insight_type='duplicated implementation'),
      'high-risk dependency',(select count(*) from insights where insight_type='high-risk dependency'),
      'complex workflow',(select count(*) from insights where insight_type='complex workflow'),
      'feature ownership anomaly',(select count(*) from insights where insight_type='feature ownership anomaly'),
      'stale knowledge',(select count(*) from insights where insight_type='stale knowledge'),
      'documentation gap',(select count(*) from insights where insight_type='documentation gap')
    ),
    'severityDistribution',jsonb_build_object(
      'info',(select count(*) from insights where severity='info'),
      'low',(select count(*) from insights where severity='low'),
      'medium',(select count(*) from insights where severity='medium'),
      'high',(select count(*) from insights where severity='high'),
      'critical',(select count(*) from insights where severity='critical')
    ),
    'averageGenerationLatencyMs',coalesce((
      select avg(generation_latency_ms) from generations
    ),0),
    'incrementalReuse',coalesce((select sum(reused_count) from generations),0),
    'recoveryCount',coalesce((
      select sum(recovery_count)
      from public.repository_insight_generation_metadata metadata
      where input_tenant_id is null or metadata.tenant_id=input_tenant_id
    ),0)
  )
$$;

create or replace function public.collect_repository_insight_generations(
  input_tenant_id text,input_retained_generations integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_insight_retention(
    tenant_id,retained_generations
  ) values(input_tenant_id,greatest(1,input_retained_generations))
  on conflict(tenant_id) do update set
    retained_generations=excluded.retained_generations,updated_at=now();
  with victims as(
    select generation_id
    from public.repository_insight_generation_metadata
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,generation_id desc
    offset greatest(1,input_retained_generations)
  )
  delete from public.repository_insight_generation_metadata metadata
  using victims where metadata.tenant_id=input_tenant_id
    and metadata.generation_id=victims.generation_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_repository_insight_source_contract()
returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  foreach object_name in array array[
    'repository_intelligence_versions','repository_graph_versions',
    'semantic_graph_versions','feature_graph_versions','change_analyses',
    'autonomous_workflows','repository_knowledge','repository_queries'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_source_missing');
    end if;
  end loop;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

create or replace function public.verify_repository_insight_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-insight-engine-v1'
    or input_schema_version<>'repository-insight-schema-v1' then
    issues:=issues||'"repository_insight_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_insight_generation_metadata','repository_insights',
    'repository_insight_evidence','repository_insight_scores',
    'repository_insight_diagnostics','repository_insight_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_insight_current_generation_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_insight_priority_idx')
    or not exists(select 1 from pg_constraint
      where conname='repository_insight_generation_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_insight_evidence_insight_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_insight_indexes_or_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_insights','select')
    or has_table_privilege('anon','public.repository_insights','select')
    or not has_function_privilege(
      'service_role',
      'public.save_repository_insight_generation(jsonb,text)','execute')
    or has_function_privilege(
      'anon',
      'public.save_repository_insight_generation(jsonb,text)','execute') then
    issues:=issues||'"repository_insight_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_insight_generations(text,integer)') is null
    or to_regprocedure(
      'public.recover_repository_insight_generations()') is null then
    issues:=issues||'"repository_insight_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$ declare object_name text;
begin
  foreach object_name in array array[
    'repository_insight_generation_metadata','repository_insights',
    'repository_insight_evidence','repository_insight_scores',
    'repository_insight_diagnostics','repository_insight_retention'
  ] loop
    execute format('alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',object_name);
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name);
  end loop;
end $$;

revoke all on function public.get_repository_insight_generation(text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_insight_generation(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.record_repository_insight_reuse(text,text,text,integer)
  from public,anon,authenticated;
revoke all on function public.get_repository_insight_auxiliary_sources(text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.recover_repository_insight_generations()
  from public,anon,authenticated;
revoke all on function public.repository_insight_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_insight_generations(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_repository_insight_source_contract()
  from public,anon,authenticated;
revoke all on function public.verify_repository_insight_contract(text,text)
  from public,anon,authenticated;
grant execute on function public.get_repository_insight_generation(text,text,text,text)
  to service_role;
grant execute on function public.save_repository_insight_generation(jsonb,text)
  to service_role;
grant execute on function public.record_repository_insight_reuse(text,text,text,integer)
  to service_role;
grant execute on function public.get_repository_insight_auxiliary_sources(text,text,text,text)
  to service_role;
grant execute on function public.recover_repository_insight_generations()
  to service_role;
grant execute on function public.repository_insight_metrics(text)
  to service_role;
grant execute on function public.collect_repository_insight_generations(text,integer)
  to service_role;
grant execute on function public.verify_repository_insight_source_contract()
  to service_role;
grant execute on function public.verify_repository_insight_contract(text,text)
  to service_role;

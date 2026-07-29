create table if not exists public.feature_graph_versions (
  tenant_id text not null,
  graph_version text not null,
  schema_version text not null,
  persistence_version bigint not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  repository_intelligence_version text not null,
  semantic_graph_version text not null,
  lifecycle text not null,
  state jsonb not null,
  features_discovered integer not null,
  average_feature_size double precision not null,
  dependency_density double precision not null,
  rebuild_duration_ms double precision not null,
  incremental_rebuild_count integer not null,
  recovery_count integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  primary key(tenant_id,graph_version),
  unique(tenant_id,repository_id,repository_revision),
  constraint feature_graph_schema_version_valid
    check(schema_version='feature-graph-v1'),
  constraint feature_graph_identity_non_empty check(
    tenant_id<>'' and graph_version<>'' and owner_id<>'' and repository_id<>''
    and repository_revision<>'' and repository_intelligence_version<>''
    and semantic_graph_version<>''
  ),
  constraint feature_graph_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint feature_graph_lifecycle_valid check(
    lifecycle in('building','validating','published','failed','superseded')
  ),
  constraint feature_graph_metrics_valid check(
    features_discovered>=0 and average_feature_size>=0
    and dependency_density>=0 and rebuild_duration_ms>=0
    and incremental_rebuild_count>=0 and recovery_count>=0
  ),
  constraint feature_graph_state_object check(jsonb_typeof(state)='object')
);

create table if not exists public.features (
  tenant_id text not null,
  graph_version text not null,
  feature_id text not null,
  repository_id text not null,
  repository_revision text not null,
  feature_name text not null,
  confidence double precision not null,
  primary_entry_point text not null,
  primary_exit_point text not null,
  lifecycle text not null,
  feature jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,graph_version,feature_id),
  unique(tenant_id,graph_version,feature_name),
  constraint feature_graph_fk foreign key(tenant_id,graph_version)
    references public.feature_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint feature_identity_non_empty check(
    feature_id<>'' and repository_id<>'' and repository_revision<>''
    and feature_name<>'' and primary_entry_point<>'' and primary_exit_point<>''
  ),
  constraint feature_confidence_valid check(confidence between 0 and 1),
  constraint feature_lifecycle_valid
    check(lifecycle in('active','partial','deprecated')),
  constraint feature_object check(jsonb_typeof(feature)='object')
);

create table if not exists public.feature_relationships (
  tenant_id text not null,
  graph_version text not null,
  relationship_id text not null,
  from_feature_id text not null,
  to_feature_id text,
  relationship_kind text not null,
  target text not null,
  relationship jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,graph_version,relationship_id),
  unique(tenant_id,graph_version,from_feature_id,to_feature_id,
    relationship_kind,target),
  constraint feature_relationship_graph_fk
    foreign key(tenant_id,graph_version)
    references public.feature_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint feature_relationship_from_fk
    foreign key(tenant_id,graph_version,from_feature_id)
    references public.features(tenant_id,graph_version,feature_id)
    on delete cascade,
  constraint feature_relationship_to_fk
    foreign key(tenant_id,graph_version,to_feature_id)
    references public.features(tenant_id,graph_version,feature_id)
    on delete cascade,
  constraint feature_relationship_kind_valid check(relationship_kind in(
    'depends_on_feature','owns_module','calls_feature','shares_components',
    'exposes_endpoint'
  )),
  constraint feature_relationship_target_non_empty check(target<>''),
  constraint feature_relationship_object
    check(jsonb_typeof(relationship)='object')
);

create table if not exists public.feature_flows (
  tenant_id text not null,
  graph_version text not null,
  flow_id text not null,
  feature_id text not null,
  entry_point text not null,
  exit_point text not null,
  step_count integer not null,
  flow jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,graph_version,flow_id),
  constraint feature_flow_graph_fk foreign key(tenant_id,graph_version)
    references public.feature_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint feature_flow_feature_fk
    foreign key(tenant_id,graph_version,feature_id)
    references public.features(tenant_id,graph_version,feature_id)
    on delete cascade,
  constraint feature_flow_identity_non_empty check(
    flow_id<>'' and feature_id<>'' and entry_point<>'' and exit_point<>''
  ),
  constraint feature_flow_steps_valid check(step_count>=2),
  constraint feature_flow_object check(jsonb_typeof(flow)='object')
);

create table if not exists public.feature_diagnostics (
  tenant_id text not null,
  graph_version text not null,
  diagnostic_position integer not null,
  diagnostic_code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,graph_version,diagnostic_position),
  constraint feature_diagnostic_graph_fk
    foreign key(tenant_id,graph_version)
    references public.feature_graph_versions(tenant_id,graph_version)
    on delete cascade,
  constraint feature_diagnostic_position_valid check(diagnostic_position>=0),
  constraint feature_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint feature_diagnostic_object check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.feature_graph_retention (
  tenant_id text primary key,
  retained_versions integer not null,
  updated_at timestamptz not null default now(),
  constraint feature_graph_retention_positive check(retained_versions>0)
);

create index if not exists feature_graph_owner_repository_idx
  on public.feature_graph_versions(
    tenant_id,owner_id,repository_id,lifecycle,updated_at desc
  );
create index if not exists feature_graph_recovery_idx
  on public.feature_graph_versions(lifecycle,updated_at)
  where lifecycle in('building','validating');
create index if not exists features_name_idx
  on public.features(
    tenant_id,repository_id,repository_revision,lower(feature_name)
  );
create index if not exists feature_relationships_from_kind_idx
  on public.feature_relationships(
    tenant_id,graph_version,from_feature_id,relationship_kind
  );
create index if not exists feature_relationships_to_kind_idx
  on public.feature_relationships(
    tenant_id,graph_version,to_feature_id,relationship_kind
  );
create index if not exists feature_flows_entry_idx
  on public.feature_flows(tenant_id,graph_version,entry_point);
create index if not exists feature_diagnostics_retention_idx
  on public.feature_diagnostics(tenant_id,graph_version,created_at desc);

create or replace function public.get_feature_intelligence_graph(
  input_tenant_id text,input_owner_id text,input_repository_id text,
  input_repository_revision text
) returns table(graph jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.feature_graph_versions
  where tenant_id=input_tenant_id and owner_id=input_owner_id
    and repository_id=input_repository_id
    and repository_revision=input_repository_revision
    and lifecycle='published'
$$;

create or replace function public.save_feature_intelligence_graph(
  input_graph jsonb,input_expected_version text
) returns table(graph jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.feature_graph_versions%rowtype;
declare feature_value jsonb;
declare relationship_value jsonb;
declare flow_value jsonb;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
declare tenant_value text:=input_graph->>'tenantId';
declare graph_value text:=input_graph->>'graphVersion';
declare saved_state jsonb;
begin
  if jsonb_typeof(input_graph)<>'object'
    or input_graph->>'schemaVersion'<>'feature-graph-v1'
    or jsonb_typeof(input_graph->'features')<>'array'
    or jsonb_typeof(input_graph->'relationships')<>'array'
    or jsonb_typeof(input_graph->'flows')<>'array'
    or jsonb_typeof(input_graph->'diagnostics')<>'array' then
    raise check_violation using message='feature_graph_state_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_graph->>'repositoryId'
      and repository.owner_user_id=input_graph->>'ownerId'
      and repository.current_revision=input_graph->>'repositoryRevision'
      and repository.deletion_state='active'
  ) or not exists(
    select 1 from public.semantic_graph_versions semantic
    where semantic.tenant_id=tenant_value
      and semantic.graph_version=input_graph->>'semanticGraphVersion'
      and semantic.repository_id=input_graph->>'repositoryId'
      and semantic.repository_revision=input_graph->>'repositoryRevision'
      and semantic.lifecycle='published'
  ) then
    raise check_violation using message='feature_repository_access_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||(input_graph->>'repositoryId'),0
  ));
  select * into existing from public.feature_graph_versions candidate
  where candidate.tenant_id=tenant_value
    and candidate.graph_version=graph_value for update;
  if found and input_expected_version is not null
    and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure using message='feature_graph_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='feature_graph_version_conflict';
  end if;

  update public.feature_graph_versions set
    lifecycle='superseded',updated_at=(input_graph->>'updatedAt')::timestamptz,
    state=jsonb_set(state,'{lifecycle}','"superseded"'::jsonb)
  where tenant_id=tenant_value
    and repository_id=input_graph->>'repositoryId'
    and graph_version<>graph_value and lifecycle='published';
  saved_state:=jsonb_set(input_graph,'{persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.feature_graph_versions(
    tenant_id,graph_version,schema_version,persistence_version,owner_id,
    repository_id,repository_revision,repository_intelligence_version,
    semantic_graph_version,lifecycle,state,features_discovered,
    average_feature_size,dependency_density,rebuild_duration_ms,
    incremental_rebuild_count,recovery_count,created_at,updated_at,published_at
  ) values(
    tenant_value,graph_value,input_graph->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),input_graph->>'ownerId',
    input_graph->>'repositoryId',input_graph->>'repositoryRevision',
    input_graph->>'repositoryIntelligenceVersion',
    input_graph->>'semanticGraphVersion',input_graph->>'lifecycle',saved_state,
    (input_graph->'metrics'->>'featuresDiscovered')::integer,
    (input_graph->'metrics'->>'averageFeatureSize')::double precision,
    (input_graph->'metrics'->>'dependencyDensity')::double precision,
    (input_graph->'metrics'->>'rebuildDurationMs')::double precision,
    (input_graph->'metrics'->>'incrementalRebuildCount')::integer,
    (input_graph->'metrics'->>'recoveryCount')::integer,
    (input_graph->>'createdAt')::timestamptz,
    (input_graph->>'updatedAt')::timestamptz,
    nullif(input_graph->>'publishedAt','')::timestamptz
  ) on conflict(tenant_id,graph_version) do update set
    persistence_version=excluded.persistence_version,
    lifecycle=excluded.lifecycle,state=excluded.state,
    features_discovered=excluded.features_discovered,
    average_feature_size=excluded.average_feature_size,
    dependency_density=excluded.dependency_density,
    rebuild_duration_ms=excluded.rebuild_duration_ms,
    incremental_rebuild_count=excluded.incremental_rebuild_count,
    recovery_count=excluded.recovery_count,
    updated_at=excluded.updated_at,published_at=excluded.published_at;

  delete from public.feature_relationships
    where tenant_id=tenant_value and graph_version=graph_value;
  delete from public.feature_flows
    where tenant_id=tenant_value and graph_version=graph_value;
  delete from public.features
    where tenant_id=tenant_value and graph_version=graph_value;
  delete from public.feature_diagnostics
    where tenant_id=tenant_value and graph_version=graph_value;
  for feature_value in select value
    from jsonb_array_elements(input_graph->'features')
  loop
    insert into public.features(
      tenant_id,graph_version,feature_id,repository_id,repository_revision,
      feature_name,confidence,primary_entry_point,primary_exit_point,lifecycle,
      feature,created_at,updated_at
    ) values(
      tenant_value,graph_value,feature_value->>'featureId',
      feature_value->>'repositoryId',feature_value->>'repositoryRevision',
      feature_value->>'name',(feature_value->>'confidence')::double precision,
      feature_value->>'primaryEntryPoint',feature_value->>'primaryExitPoint',
      feature_value->>'lifecycle',feature_value,
      (feature_value->>'createdAt')::timestamptz,
      (feature_value->>'updatedAt')::timestamptz
    );
  end loop;
  for relationship_value in select value
    from jsonb_array_elements(input_graph->'relationships')
  loop
    insert into public.feature_relationships(
      tenant_id,graph_version,relationship_id,from_feature_id,to_feature_id,
      relationship_kind,target,relationship,created_at
    ) values(
      tenant_value,graph_value,relationship_value->>'relationshipId',
      relationship_value->>'fromFeatureId',
      nullif(relationship_value->>'toFeatureId',''),
      relationship_value->>'kind',relationship_value->>'target',
      relationship_value,(relationship_value->>'createdAt')::timestamptz
    );
  end loop;
  for flow_value in select value
    from jsonb_array_elements(input_graph->'flows')
  loop
    insert into public.feature_flows(
      tenant_id,graph_version,flow_id,feature_id,entry_point,exit_point,
      step_count,flow,created_at
    ) values(
      tenant_value,graph_value,flow_value->>'flowId',
      flow_value->>'featureId',flow_value->>'entryPoint',
      flow_value->>'exitPoint',jsonb_array_length(flow_value->'steps'),
      flow_value,(flow_value->>'createdAt')::timestamptz
    );
  end loop;
  for diagnostic_value in select value
    from jsonb_array_elements(input_graph->'diagnostics')
  loop
    insert into public.feature_diagnostics(
      tenant_id,graph_version,diagnostic_position,diagnostic_code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,graph_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value,(input_graph->>'updatedAt')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;
  return query select state from public.feature_graph_versions
    where tenant_id=tenant_value and graph_version=graph_value;
end; $$;

create or replace function public.recover_feature_intelligence_graphs()
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  update public.feature_graph_versions set
    lifecycle='failed',published_at=null,updated_at=now(),
    recovery_count=recovery_count+1,
    state=jsonb_set(jsonb_set(jsonb_set(
      state,'{lifecycle}','"failed"'::jsonb),
      '{publishedAt}','null'::jsonb),
      '{metrics,recoveryCount}',to_jsonb(recovery_count+1),true)
  where lifecycle in('building','validating');
  get diagnostics affected=row_count;
  delete from public.feature_relationships relationship
  where not exists(select 1 from public.features feature
    where feature.tenant_id=relationship.tenant_id
      and feature.graph_version=relationship.graph_version
      and feature.feature_id=relationship.from_feature_id)
    or (relationship.to_feature_id is not null and not exists(
      select 1 from public.features feature
      where feature.tenant_id=relationship.tenant_id
        and feature.graph_version=relationship.graph_version
        and feature.feature_id=relationship.to_feature_id));
  delete from public.feature_flows flow
  where not exists(select 1 from public.features feature
    where feature.tenant_id=flow.tenant_id
      and feature.graph_version=flow.graph_version
      and feature.feature_id=flow.feature_id);
  return query select affected;
end; $$;

create or replace function public.feature_intelligence_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'featuresDiscovered',coalesce(sum(features_discovered),0),
    'averageFeatureSize',coalesce(
      sum(average_feature_size*features_discovered)/
        nullif(sum(features_discovered),0),0),
    'dependencyDensity',coalesce(avg(dependency_density),0),
    'rebuildDurationMs',coalesce(sum(rebuild_duration_ms),0),
    'incrementalRebuildCount',coalesce(sum(incremental_rebuild_count),0),
    'recoveryCount',coalesce(sum(recovery_count),0)
  ) from public.feature_graph_versions graph
  where input_tenant_id is null or graph.tenant_id=input_tenant_id
$$;

create or replace function public.collect_feature_intelligence_graphs(
  input_tenant_id text,input_retained_versions integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.feature_graph_retention(tenant_id,retained_versions)
  values(input_tenant_id,greatest(1,input_retained_versions))
  on conflict(tenant_id) do update set
    retained_versions=excluded.retained_versions,updated_at=now();
  with victims as(
    select graph_version from public.feature_graph_versions
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,graph_version desc
    offset greatest(1,input_retained_versions)
  )
  delete from public.feature_graph_versions graph using victims
  where graph.tenant_id=input_tenant_id
    and graph.graph_version=victims.graph_version;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_feature_intelligence_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'feature-intelligence-v1'
    or input_schema_version<>'feature-graph-v1' then
    issues:=issues||'"feature_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'feature_graph_versions','features','feature_relationships',
    'feature_flows','feature_diagnostics','feature_graph_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='features_name_idx')
    or not exists(select 1 from pg_indexes
      where indexname='feature_relationships_from_kind_idx')
    or not exists(select 1 from pg_constraint
      where conname='feature_relationship_from_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='feature_flow_feature_fk' and confdeltype='c') then
    issues:=issues||'"feature_indexes_or_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.feature_graph_versions','select')
    or has_table_privilege('anon','public.features','select')
    or not has_function_privilege(
      'service_role','public.save_feature_intelligence_graph(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_feature_intelligence_graph(jsonb,text)','execute') then
    issues:=issues||'"feature_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_feature_intelligence_graphs(text,integer)') is null
    or to_regprocedure(
      'public.recover_feature_intelligence_graphs()') is null then
    issues:=issues||'"feature_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'feature_graph_versions','features','feature_relationships',
    'feature_flows','feature_diagnostics','feature_graph_retention'
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

revoke all on function public.get_feature_intelligence_graph(text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.save_feature_intelligence_graph(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.recover_feature_intelligence_graphs()
  from public,anon,authenticated;
revoke all on function public.feature_intelligence_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_feature_intelligence_graphs(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_feature_intelligence_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_feature_intelligence_graph(text,text,text,text)
  to service_role;
grant execute on function public.save_feature_intelligence_graph(jsonb,text)
  to service_role;
grant execute on function public.recover_feature_intelligence_graphs()
  to service_role;
grant execute on function public.feature_intelligence_metrics(text)
  to service_role;
grant execute on function public.collect_feature_intelligence_graphs(text,integer)
  to service_role;
grant execute on function public.verify_feature_intelligence_contract(text,text)
  to service_role;

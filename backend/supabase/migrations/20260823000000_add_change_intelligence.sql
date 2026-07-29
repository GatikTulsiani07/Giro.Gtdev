create table if not exists public.change_requests (
  tenant_id text not null,
  change_id text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  workflow_id text not null,
  target_kind text not null,
  target_value text not null,
  change_type text not null,
  rationale text not null,
  request jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,change_id),
  constraint change_request_identity_non_empty check(
    tenant_id<>'' and change_id<>'' and owner_id<>'' and repository_id<>''
    and repository_revision<>'' and workflow_id<>'' and target_value<>''
    and rationale<>''
  ),
  constraint change_request_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint change_request_target_valid check(target_kind in(
    'feature','module','file','symbol','api_endpoint','route','service',
    'repository_component'
  )),
  constraint change_request_type_valid check(change_type in(
    'add','modify','remove','refactor','fix','migrate'
  )),
  constraint change_request_object check(jsonb_typeof(request)='object')
);

create table if not exists public.change_analyses (
  tenant_id text not null,
  analysis_id text not null,
  change_id text not null,
  schema_version text not null,
  persistence_version bigint not null,
  lifecycle text not null,
  repository_intelligence_version text not null,
  semantic_graph_version text not null,
  feature_graph_version text not null,
  state jsonb not null,
  reuse_count integer not null default 0,
  recovery_count integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  primary key(tenant_id,analysis_id),
  unique(tenant_id,change_id),
  constraint change_analysis_request_fk foreign key(tenant_id,change_id)
    references public.change_requests(tenant_id,change_id) on delete cascade,
  constraint change_analysis_schema_valid
    check(schema_version='change-analysis-v1'),
  constraint change_analysis_identity_non_empty check(
    analysis_id<>'' and repository_intelligence_version<>''
    and semantic_graph_version<>'' and feature_graph_version<>''
  ),
  constraint change_analysis_lifecycle_valid check(lifecycle in(
    'building','validating','published','failed','superseded'
  )),
  constraint change_analysis_counters_valid
    check(reuse_count>=0 and recovery_count>=0),
  constraint change_analysis_state_object check(jsonb_typeof(state)='object')
);

create table if not exists public.change_impact_graphs (
  tenant_id text not null,
  analysis_id text not null,
  impact_graph_id text not null,
  impact_size integer not null,
  maximum_dependency_depth integer not null,
  impact_graph jsonb not null,
  primary key(tenant_id,analysis_id,impact_graph_id),
  constraint change_impact_analysis_fk foreign key(tenant_id,analysis_id)
    references public.change_analyses(tenant_id,analysis_id) on delete cascade,
  constraint change_impact_values_valid
    check(impact_graph_id<>'' and impact_size>=0
      and maximum_dependency_depth>=0),
  constraint change_impact_object check(jsonb_typeof(impact_graph)='object')
);

create table if not exists public.change_risk_assessments (
  tenant_id text not null,
  analysis_id text not null,
  risk_assessment_id text not null,
  risk_level text not null,
  score integer not null,
  assessment jsonb not null,
  primary key(tenant_id,analysis_id,risk_assessment_id),
  constraint change_risk_analysis_fk foreign key(tenant_id,analysis_id)
    references public.change_analyses(tenant_id,analysis_id) on delete cascade,
  constraint change_risk_level_valid
    check(risk_level in('low','medium','high','critical')),
  constraint change_risk_score_valid check(score between 0 and 100),
  constraint change_risk_object check(jsonb_typeof(assessment)='object')
);

create table if not exists public.change_implementation_plans (
  tenant_id text not null,
  analysis_id text not null,
  implementation_plan_id text not null,
  step_count integer not null,
  plan jsonb not null,
  primary key(tenant_id,analysis_id,implementation_plan_id),
  constraint change_plan_analysis_fk foreign key(tenant_id,analysis_id)
    references public.change_analyses(tenant_id,analysis_id) on delete cascade,
  constraint change_plan_values_valid
    check(implementation_plan_id<>'' and step_count>=5),
  constraint change_plan_object check(jsonb_typeof(plan)='object')
);

create table if not exists public.change_diagnostics (
  tenant_id text not null,
  analysis_id text not null,
  diagnostic_position integer not null,
  diagnostic_code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,analysis_id,diagnostic_position),
  constraint change_diagnostic_analysis_fk foreign key(tenant_id,analysis_id)
    references public.change_analyses(tenant_id,analysis_id) on delete cascade,
  constraint change_diagnostic_position_valid check(diagnostic_position>=0),
  constraint change_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint change_diagnostic_object check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.change_intelligence_retention (
  tenant_id text primary key,
  retained_analyses integer not null,
  updated_at timestamptz not null default now(),
  constraint change_retention_positive check(retained_analyses>0)
);

create index if not exists change_requests_target_idx
  on public.change_requests(
    tenant_id,repository_id,repository_revision,target_kind,target_value
  );
create index if not exists change_requests_workflow_idx
  on public.change_requests(tenant_id,workflow_id,created_at desc);
create index if not exists change_analyses_lineage_idx
  on public.change_analyses(
    tenant_id,semantic_graph_version,feature_graph_version,lifecycle
  );
create index if not exists change_analyses_recovery_idx
  on public.change_analyses(lifecycle,updated_at)
  where lifecycle in('building','validating');
create index if not exists change_impact_depth_idx
  on public.change_impact_graphs(
    tenant_id,maximum_dependency_depth desc,impact_size desc
  );
create index if not exists change_risk_level_idx
  on public.change_risk_assessments(tenant_id,risk_level,score desc);
create index if not exists change_diagnostics_retention_idx
  on public.change_diagnostics(tenant_id,created_at desc);

create or replace function public.get_change_intelligence_analysis(
  input_tenant_id text,input_owner_id text,input_change_id text
) returns table(analysis jsonb)
language sql stable security invoker set search_path=public as $$
  select version.state from public.change_analyses version
  join public.change_requests request using(tenant_id,change_id)
  where version.tenant_id=input_tenant_id
    and request.owner_id=input_owner_id
    and version.change_id=input_change_id
    and version.lifecycle='published'
$$;

create or replace function public.save_change_intelligence_analysis(
  input_analysis jsonb,input_expected_version text
) returns table(analysis jsonb)
language plpgsql security invoker set search_path=public as $$
declare tenant_value text:=input_analysis->'request'->>'tenantId';
declare change_value text:=input_analysis->'request'->>'changeId';
declare analysis_value text:=input_analysis->>'analysisId';
declare existing public.change_analyses%rowtype;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
declare saved_state jsonb;
declare impact_size integer;
begin
  if jsonb_typeof(input_analysis)<>'object'
    or input_analysis->>'schemaVersion'<>'change-analysis-v1'
    or jsonb_typeof(input_analysis->'request')<>'object'
    or jsonb_typeof(input_analysis->'impact')<>'object'
    or jsonb_typeof(input_analysis->'risk')<>'object'
    or jsonb_typeof(input_analysis->'implementationPlan')<>'object'
    or jsonb_typeof(input_analysis->'diagnostics')<>'array' then
    raise check_violation using message='change_analysis_state_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_analysis->'request'->>'repositoryId'
      and repository.owner_user_id=input_analysis->'request'->>'ownerId'
      and repository.current_revision=
        input_analysis->'request'->>'repositoryRevision'
      and repository.deletion_state='active'
  ) or not exists(
    select 1 from public.semantic_graph_versions semantic
    where semantic.tenant_id=tenant_value
      and semantic.graph_version=input_analysis->>'semanticGraphVersion'
      and semantic.repository_id=
        input_analysis->'request'->>'repositoryId'
      and semantic.repository_revision=
        input_analysis->'request'->>'repositoryRevision'
      and semantic.lifecycle='published'
  ) or not exists(
    select 1 from public.feature_graph_versions feature
    where feature.tenant_id=tenant_value
      and feature.graph_version=input_analysis->>'featureGraphVersion'
      and feature.repository_id=
        input_analysis->'request'->>'repositoryId'
      and feature.repository_revision=
        input_analysis->'request'->>'repositoryRevision'
      and feature.repository_intelligence_version=
        input_analysis->>'repositoryIntelligenceVersion'
      and feature.semantic_graph_version=input_analysis->>'semanticGraphVersion'
      and feature.lifecycle='published'
  ) then
    raise check_violation using message='change_intelligence_lineage_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||change_value,0
  ));
  select * into existing from public.change_analyses candidate
  where candidate.tenant_id=tenant_value
    and candidate.change_id=change_value for update;
  if found and input_expected_version is not null
    and existing.persistence_version<>input_expected_version::bigint then
    raise serialization_failure using message='change_analysis_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='change_analysis_version_conflict';
  end if;

  insert into public.change_requests(
    tenant_id,change_id,owner_id,repository_id,repository_revision,workflow_id,
    target_kind,target_value,change_type,rationale,request,created_at,updated_at
  ) values(
    tenant_value,change_value,input_analysis->'request'->>'ownerId',
    input_analysis->'request'->>'repositoryId',
    input_analysis->'request'->>'repositoryRevision',
    input_analysis->'request'->>'workflowId',
    input_analysis->'request'->'requestedTarget'->>'kind',
    input_analysis->'request'->'requestedTarget'->>'value',
    input_analysis->'request'->>'changeType',
    input_analysis->'request'->>'rationale',input_analysis->'request',
    (input_analysis->'request'->>'createdAt')::timestamptz,
    (input_analysis->'request'->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,change_id) do update set
    updated_at=excluded.updated_at,request=excluded.request;

  if existing.analysis_id is not null
    and existing.analysis_id<>analysis_value then
    delete from public.change_analyses
    where tenant_id=tenant_value and change_id=change_value;
  end if;
  saved_state:=jsonb_set(input_analysis,'{persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.change_analyses(
    tenant_id,analysis_id,change_id,schema_version,persistence_version,
    lifecycle,repository_intelligence_version,semantic_graph_version,
    feature_graph_version,state,reuse_count,recovery_count,created_at,
    updated_at,published_at
  ) values(
    tenant_value,analysis_value,change_value,input_analysis->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),input_analysis->>'lifecycle',
    input_analysis->>'repositoryIntelligenceVersion',
    input_analysis->>'semanticGraphVersion',
    input_analysis->>'featureGraphVersion',saved_state,
    coalesce(existing.reuse_count,0),coalesce(existing.recovery_count,0),
    (input_analysis->>'createdAt')::timestamptz,
    (input_analysis->>'updatedAt')::timestamptz,
    nullif(input_analysis->>'publishedAt','')::timestamptz
  ) on conflict(tenant_id,change_id) do update set
    analysis_id=excluded.analysis_id,
    persistence_version=excluded.persistence_version,
    lifecycle=excluded.lifecycle,
    repository_intelligence_version=excluded.repository_intelligence_version,
    semantic_graph_version=excluded.semantic_graph_version,
    feature_graph_version=excluded.feature_graph_version,
    state=excluded.state,updated_at=excluded.updated_at,
    published_at=excluded.published_at;

  delete from public.change_impact_graphs
    where tenant_id=tenant_value and analysis_id=analysis_value;
  delete from public.change_risk_assessments
    where tenant_id=tenant_value and analysis_id=analysis_value;
  delete from public.change_implementation_plans
    where tenant_id=tenant_value and analysis_id=analysis_value;
  delete from public.change_diagnostics
    where tenant_id=tenant_value and analysis_id=analysis_value;
  impact_size:=
    jsonb_array_length(input_analysis->'impact'->'directlyAffectedFiles')+
    jsonb_array_length(input_analysis->'impact'->'indirectlyAffectedFiles')+
    jsonb_array_length(input_analysis->'impact'->'affectedSymbolIds')+
    jsonb_array_length(input_analysis->'impact'->'affectedFeatureIds');
  insert into public.change_impact_graphs(
    tenant_id,analysis_id,impact_graph_id,impact_size,
    maximum_dependency_depth,impact_graph
  ) values(
    tenant_value,analysis_value,input_analysis->'impact'->>'impactGraphId',
    impact_size,
    (input_analysis->'impact'->>'maximumDependencyDepth')::integer,
    input_analysis->'impact'
  );
  insert into public.change_risk_assessments(
    tenant_id,analysis_id,risk_assessment_id,risk_level,score,assessment
  ) values(
    tenant_value,analysis_value,
    input_analysis->'risk'->>'riskAssessmentId',
    input_analysis->'risk'->>'level',
    (input_analysis->'risk'->>'score')::integer,input_analysis->'risk'
  );
  insert into public.change_implementation_plans(
    tenant_id,analysis_id,implementation_plan_id,step_count,plan
  ) values(
    tenant_value,analysis_value,
    input_analysis->'implementationPlan'->>'implementationPlanId',
    jsonb_array_length(input_analysis->'implementationPlan'->'steps'),
    input_analysis->'implementationPlan'
  );
  for diagnostic_value in select value
    from jsonb_array_elements(input_analysis->'diagnostics')
  loop
    insert into public.change_diagnostics(
      tenant_id,analysis_id,diagnostic_position,diagnostic_code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,analysis_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value,(input_analysis->>'updatedAt')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;
  return query select state from public.change_analyses
    where tenant_id=tenant_value and change_id=change_value;
end; $$;

create or replace function public.record_change_intelligence_reuse(
  input_tenant_id text,input_owner_id text,input_change_id text
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.change_analyses version set reuse_count=reuse_count+1
  from public.change_requests request
  where version.tenant_id=input_tenant_id
    and version.change_id=input_change_id
    and request.tenant_id=version.tenant_id
    and request.change_id=version.change_id
    and request.owner_id=input_owner_id
    and version.lifecycle='published';
  if not found then
    raise no_data_found using message='change_analysis_not_found';
  end if;
end; $$;

create or replace function public.recover_change_intelligence_analyses()
returns table(recovered_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer;
begin
  update public.change_analyses set
    lifecycle='failed',published_at=null,updated_at=now(),
    recovery_count=recovery_count+1,
    state=jsonb_set(jsonb_set(
      state,'{lifecycle}','"failed"'::jsonb),
      '{publishedAt}','null'::jsonb)
  where lifecycle in('building','validating')
    or not exists(select 1 from public.change_impact_graphs impact
      where impact.tenant_id=change_analyses.tenant_id
        and impact.analysis_id=change_analyses.analysis_id)
    or not exists(select 1 from public.change_risk_assessments risk
      where risk.tenant_id=change_analyses.tenant_id
        and risk.analysis_id=change_analyses.analysis_id)
    or not exists(select 1 from public.change_implementation_plans plan
      where plan.tenant_id=change_analyses.tenant_id
        and plan.analysis_id=change_analyses.analysis_id);
  get diagnostics affected=row_count;
  delete from public.change_requests request
  where not exists(select 1 from public.change_analyses analysis
    where analysis.tenant_id=request.tenant_id
      and analysis.change_id=request.change_id);
  return query select affected;
end; $$;

create or replace function public.change_intelligence_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'analyses',count(*),
    'averageImpactSize',coalesce(avg(impact.impact_size),0),
    'averageDependencyDepth',
      coalesce(avg(impact.maximum_dependency_depth),0),
    'riskDistribution',jsonb_build_object(
      'low',count(*) filter(where risk.risk_level='low'),
      'medium',count(*) filter(where risk.risk_level='medium'),
      'high',count(*) filter(where risk.risk_level='high'),
      'critical',count(*) filter(where risk.risk_level='critical')
    ),
    'reuseRate',coalesce(sum(analysis.reuse_count)::double precision/
      nullif(count(*)+sum(analysis.reuse_count),0),0),
    'recoveryCount',coalesce(sum(analysis.recovery_count),0)
  )
  from public.change_analyses analysis
  join public.change_impact_graphs impact
    using(tenant_id,analysis_id)
  join public.change_risk_assessments risk
    using(tenant_id,analysis_id)
  where input_tenant_id is null or analysis.tenant_id=input_tenant_id
$$;

create or replace function public.collect_change_intelligence_analyses(
  input_tenant_id text,input_retained_analyses integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.change_intelligence_retention(
    tenant_id,retained_analyses
  ) values(input_tenant_id,greatest(1,input_retained_analyses))
  on conflict(tenant_id) do update set
    retained_analyses=excluded.retained_analyses,updated_at=now();
  with victims as(
    select analysis_id from public.change_analyses
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,analysis_id desc
    offset greatest(1,input_retained_analyses)
  )
  delete from public.change_analyses analysis using victims
  where analysis.tenant_id=input_tenant_id
    and analysis.analysis_id=victims.analysis_id;
  get diagnostics removed=row_count;
  return query select removed;
end; $$;

create or replace function public.verify_change_intelligence_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'change-intelligence-v1'
    or input_schema_version<>'change-analysis-v1' then
    issues:=issues||'"change_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'change_requests','change_analyses','change_impact_graphs',
    'change_risk_assessments','change_implementation_plans',
    'change_diagnostics','change_intelligence_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='change_requests_target_idx')
    or not exists(select 1 from pg_indexes
      where indexname='change_analyses_lineage_idx')
    or not exists(select 1 from pg_constraint
      where conname='change_analysis_request_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='change_impact_analysis_fk' and confdeltype='c') then
    issues:=issues||'"change_indexes_or_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.change_analyses','select')
    or has_table_privilege('anon','public.change_requests','select')
    or not has_function_privilege(
      'service_role',
      'public.save_change_intelligence_analysis(jsonb,text)','execute')
    or has_function_privilege(
      'anon',
      'public.save_change_intelligence_analysis(jsonb,text)','execute') then
    issues:=issues||'"change_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_change_intelligence_analyses(text,integer)') is null
    or to_regprocedure(
      'public.recover_change_intelligence_analyses()') is null then
    issues:=issues||'"change_retention_or_recovery_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'change_requests','change_analyses','change_impact_graphs',
    'change_risk_assessments','change_implementation_plans',
    'change_diagnostics','change_intelligence_retention'
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

revoke all on function public.get_change_intelligence_analysis(text,text,text)
  from public,anon,authenticated;
revoke all on function public.save_change_intelligence_analysis(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.record_change_intelligence_reuse(text,text,text)
  from public,anon,authenticated;
revoke all on function public.recover_change_intelligence_analyses()
  from public,anon,authenticated;
revoke all on function public.change_intelligence_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_change_intelligence_analyses(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_change_intelligence_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_change_intelligence_analysis(text,text,text)
  to service_role;
grant execute on function public.save_change_intelligence_analysis(jsonb,text)
  to service_role;
grant execute on function public.record_change_intelligence_reuse(text,text,text)
  to service_role;
grant execute on function public.recover_change_intelligence_analyses()
  to service_role;
grant execute on function public.change_intelligence_metrics(text)
  to service_role;
grant execute on function public.collect_change_intelligence_analyses(text,integer)
  to service_role;
grant execute on function public.verify_change_intelligence_contract(text,text)
  to service_role;

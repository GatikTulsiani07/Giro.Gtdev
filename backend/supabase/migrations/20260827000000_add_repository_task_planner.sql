create table if not exists public.repository_task_plans (
  tenant_id text not null,
  task_id text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  schema_version text not null,
  persistence_version bigint not null,
  category text not null,
  confidence double precision not null,
  lifecycle text not null,
  source_versions jsonb not null,
  orchestration_latency_ms double precision not null default 0,
  accuracy_input_count integer not null default 0,
  recovery_count integer not null default 0,
  plan jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,task_id),
  constraint repository_task_plan_snapshot_fk
    foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_task_plan_schema_valid
    check(schema_version='repository-task-plan-schema-v1'),
  constraint repository_task_plan_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_task_plan_category_valid check(category in(
    'bug fix','new feature','refactor','performance','security',
    'documentation','testing','dependency update','API change',
    'architecture improvement'
  )),
  constraint repository_task_plan_lifecycle_valid check(lifecycle in(
    'planning','published','partial','failed','superseded'
  )),
  constraint repository_task_plan_values_valid check(
    tenant_id<>'' and task_id<>'' and owner_id<>'' and repository_id<>''
    and confidence between 0 and 1 and orchestration_latency_ms>=0
    and accuracy_input_count>=0 and recovery_count>=0
    and jsonb_typeof(source_versions)='object'
    and jsonb_typeof(plan)='object'
  ),
  constraint repository_task_plan_completion_valid check(
    lifecycle not in('published','partial') or completed_at is not null
  )
);

create table if not exists public.repository_task_execution_phases (
  tenant_id text not null,
  task_id text not null,
  phase_id text not null,
  position integer not null,
  phase_kind text not null,
  phase jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,task_id,phase_id),
  unique(tenant_id,task_id,position),
  constraint repository_task_phase_plan_fk
    foreign key(tenant_id,task_id)
    references public.repository_task_plans(tenant_id,task_id)
    on delete cascade,
  constraint repository_task_phase_position_valid check(position>=0),
  constraint repository_task_phase_kind_valid check(phase_kind in(
    'preparation','investigation','implementation','validation',
    'testing','review','deployment readiness'
  )),
  constraint repository_task_phase_object_valid
    check(jsonb_typeof(phase)='object')
);

create table if not exists public.repository_task_planning_diagnostics (
  tenant_id text not null,
  task_id text not null,
  diagnostic_position integer not null,
  code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,task_id,diagnostic_position),
  constraint repository_task_diagnostic_plan_fk
    foreign key(tenant_id,task_id)
    references public.repository_task_plans(tenant_id,task_id)
    on delete cascade,
  constraint repository_task_diagnostic_position_valid
    check(diagnostic_position>=0),
  constraint repository_task_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_task_diagnostic_object_valid
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_task_plan_cache (
  tenant_id text not null,
  task_id text not null,
  owner_id text not null,
  repository_id text not null,
  repository_revision text not null,
  normalized_objective text not null,
  hit_count bigint not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null,
  primary key(tenant_id,task_id),
  constraint repository_task_cache_plan_fk
    foreign key(tenant_id,task_id)
    references public.repository_task_plans(tenant_id,task_id)
    on delete cascade,
  constraint repository_task_cache_values_valid check(
    owner_id<>'' and repository_id<>'' and normalized_objective<>''
    and hit_count>=0
  )
);

create table if not exists public.repository_task_planner_metrics (
  tenant_id text not null,
  task_id text not null,
  orchestration_latency_ms double precision not null,
  accuracy_input_count integer not null,
  recovery_count integer not null default 0,
  recorded_at timestamptz not null,
  primary key(tenant_id,task_id),
  constraint repository_task_metric_plan_fk
    foreign key(tenant_id,task_id)
    references public.repository_task_plans(tenant_id,task_id)
    on delete cascade,
  constraint repository_task_metric_values_valid check(
    orchestration_latency_ms>=0 and accuracy_input_count>=0
    and recovery_count>=0
  )
);

create table if not exists public.repository_task_planner_retention (
  tenant_id text primary key,
  retained_plans integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_task_retention_positive check(retained_plans>0)
);

create unique index if not exists repository_task_plan_cache_identity_idx
  on public.repository_task_plan_cache(
    tenant_id,owner_id,repository_id,repository_revision,normalized_objective
  );
create index if not exists repository_task_plan_repository_idx
  on public.repository_task_plans(
    tenant_id,owner_id,repository_id,repository_revision,updated_at desc
  );
create index if not exists repository_task_plan_recovery_idx
  on public.repository_task_plans(lifecycle,updated_at)
  where lifecycle in('planning','partial','failed');
create index if not exists repository_task_phase_order_idx
  on public.repository_task_execution_phases(
    tenant_id,task_id,position
  );
create index if not exists repository_task_diagnostic_code_idx
  on public.repository_task_planning_diagnostics(
    tenant_id,code,severity,created_at desc
  );
create index if not exists repository_task_metrics_time_idx
  on public.repository_task_planner_metrics(tenant_id,recorded_at desc);

create or replace function public.get_repository_task_plan(
  input_tenant_id text,input_owner_id text,input_task_id text
) returns table(plan jsonb)
language sql stable security invoker set search_path=public as $$
  select task.plan
  from public.repository_task_plans task
  where task.tenant_id=input_tenant_id
    and task.owner_id=input_owner_id
    and task.task_id=input_task_id
    and task.lifecycle in('published','partial')
  limit 1
$$;

create or replace function public.save_repository_task_plan(
  input_plan jsonb,input_expected_version text
) returns table(plan jsonb)
language plpgsql security invoker set search_path=public as $$
declare tenant_value text:=input_plan->'task'->>'tenantId';
declare task_value text:=input_plan->'task'->>'taskId';
declare existing public.repository_task_plans%rowtype;
declare saved jsonb;
declare phase_value jsonb;
declare diagnostic_value jsonb;
declare diagnostic_position integer:=0;
begin
  if jsonb_typeof(input_plan)<>'object'
    or input_plan->'task'->>'schemaVersion'
      <>'repository-task-plan-schema-v1'
    or jsonb_typeof(input_plan->'sourceVersions')<>'object'
    or jsonb_typeof(input_plan->'phases')<>'array'
    or jsonb_typeof(input_plan->'diagnostics')<>'array'
    or jsonb_typeof(input_plan->'orchestrationPlan')<>'array'
    or jsonb_typeof(input_plan->'risk')<>'object'
    or jsonb_typeof(input_plan->'validationChecklist')<>'object' then
    raise check_violation using message='repository_task_plan_invalid';
  end if;
  if input_plan->'task'->>'lifecycle' in('published','partial')
    and jsonb_array_length(input_plan->'phases')<>7 then
    raise check_violation using message='repository_task_phase_order_invalid';
  end if;
  if exists(
    select 1
    from jsonb_array_elements(input_plan->'phases')
      with ordinality item(value,ordinality)
    where (value->>'position')::integer<>ordinality-1
      or value->>'kind'<>(array[
        'preparation','investigation','implementation','validation',
        'testing','review','deployment readiness'
      ])[ordinality]
  ) then
    raise check_violation using message='repository_task_phase_order_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    join public.repository_snapshots snapshot
      on snapshot.repository_id=repository.repository_id
      and snapshot.revision=input_plan->'task'->>'repositoryRevision'
      and snapshot.status='published'
    where repository.repository_id=input_plan->'task'->>'repositoryId'
      and repository.owner_user_id=input_plan->'task'->>'ownerId'
      and repository.current_revision=
        input_plan->'task'->>'repositoryRevision'
      and repository.indexed_revision=
        input_plan->'task'->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation
      using message='repository_task_revision_or_ownership_invalid';
  end if;
  if not exists(
    select 1 from public.repository_intelligence_versions source
    where source.intelligence_version=
      input_plan->'sourceVersions'->>'repositoryIntelligence'
      and source.repository_id=input_plan->'task'->>'repositoryId'
      and source.repository_revision=
        input_plan->'task'->>'repositoryRevision'
      and source.status='published'
  ) or not exists(
    select 1 from public.repository_graph_versions source
    where source.graph_version=
      input_plan->'sourceVersions'->>'repositoryGraph'
      and source.repository_id=input_plan->'task'->>'repositoryId'
      and source.repository_revision=
        input_plan->'task'->>'repositoryRevision'
      and source.status='published'
  ) or not exists(
    select 1 from public.semantic_graph_versions source
    where source.tenant_id=tenant_value
      and source.owner_id=input_plan->'task'->>'ownerId'
      and source.graph_version=
        input_plan->'sourceVersions'->>'semanticGraph'
      and source.repository_id=input_plan->'task'->>'repositoryId'
      and source.repository_revision=
        input_plan->'task'->>'repositoryRevision'
      and source.lifecycle='published'
  ) or not exists(
    select 1 from public.feature_graph_versions source
    where source.tenant_id=tenant_value
      and source.owner_id=input_plan->'task'->>'ownerId'
      and source.graph_version=
        input_plan->'sourceVersions'->>'featureGraph'
      and source.repository_id=input_plan->'task'->>'repositoryId'
      and source.repository_revision=
        input_plan->'task'->>'repositoryRevision'
      and source.lifecycle='published'
      and source.semantic_graph_version=
        input_plan->'sourceVersions'->>'semanticGraph'
      and source.repository_intelligence_version=
        input_plan->'sourceVersions'->>'repositoryIntelligence'
  ) then
    raise check_violation
      using message='repository_task_source_lineage_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||task_value,0));
  select * into existing from public.repository_task_plans task
  where task.tenant_id=tenant_value and task.task_id=task_value for update;
  if (found and input_expected_version is not null
      and existing.persistence_version<>input_expected_version::bigint)
    or (not found and input_expected_version is not null) then
    raise serialization_failure
      using message='repository_task_plan_version_conflict';
  end if;
  if found and existing.owner_id<>input_plan->'task'->>'ownerId' then
    raise insufficient_privilege
      using message='repository_task_planner_access_denied';
  end if;
  saved:=jsonb_set(input_plan,'{task,persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.repository_task_plans(
    tenant_id,task_id,owner_id,repository_id,repository_revision,
    schema_version,persistence_version,category,confidence,lifecycle,
    source_versions,orchestration_latency_ms,accuracy_input_count,
    recovery_count,plan,created_at,updated_at,completed_at
  ) values(
    tenant_value,task_value,input_plan->'task'->>'ownerId',
    input_plan->'task'->>'repositoryId',
    input_plan->'task'->>'repositoryRevision',
    input_plan->'task'->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),
    input_plan->'task'->>'category',
    (input_plan->'task'->>'confidence')::double precision,
    input_plan->'task'->>'lifecycle',input_plan->'sourceVersions',
    (input_plan->>'orchestrationLatencyMs')::double precision,
    (input_plan->>'accuracyInputCount')::integer,
    (input_plan->>'recoveryCount')::integer,saved,
    (input_plan->'task'->>'createdAt')::timestamptz,
    (input_plan->'task'->>'updatedAt')::timestamptz,
    nullif(input_plan->'task'->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,task_id) do update set
    persistence_version=excluded.persistence_version,
    category=excluded.category,confidence=excluded.confidence,
    lifecycle=excluded.lifecycle,source_versions=excluded.source_versions,
    orchestration_latency_ms=excluded.orchestration_latency_ms,
    accuracy_input_count=excluded.accuracy_input_count,
    recovery_count=excluded.recovery_count,plan=excluded.plan,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at;

  delete from public.repository_task_execution_phases
    where tenant_id=tenant_value and task_id=task_value;
  for phase_value in
    select value from jsonb_array_elements(input_plan->'phases')
  loop
    insert into public.repository_task_execution_phases(
      tenant_id,task_id,phase_id,position,phase_kind,phase,created_at
    ) values(
      tenant_value,task_value,phase_value->>'phaseId',
      (phase_value->>'position')::integer,phase_value->>'kind',
      phase_value,(input_plan->'task'->>'createdAt')::timestamptz
    );
  end loop;
  delete from public.repository_task_planning_diagnostics
    where tenant_id=tenant_value and task_id=task_value;
  for diagnostic_value in
    select value from jsonb_array_elements(input_plan->'diagnostics')
  loop
    insert into public.repository_task_planning_diagnostics(
      tenant_id,task_id,diagnostic_position,code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,task_value,diagnostic_position,
      diagnostic_value->>'code',diagnostic_value->>'severity',
      diagnostic_value,(input_plan->'task'->>'updatedAt')::timestamptz
    );
    diagnostic_position:=diagnostic_position+1;
  end loop;
  insert into public.repository_task_plan_cache(
    tenant_id,task_id,owner_id,repository_id,repository_revision,
    normalized_objective,created_at
  ) values(
    tenant_value,task_value,input_plan->'task'->>'ownerId',
    input_plan->'task'->>'repositoryId',
    input_plan->'task'->>'repositoryRevision',
    input_plan->'task'->>'normalizedObjective',
    (input_plan->'task'->>'createdAt')::timestamptz
  ) on conflict(tenant_id,task_id) do update set
    repository_revision=excluded.repository_revision,
    normalized_objective=excluded.normalized_objective;
  insert into public.repository_task_planner_metrics(
    tenant_id,task_id,orchestration_latency_ms,accuracy_input_count,
    recovery_count,recorded_at
  ) values(
    tenant_value,task_value,
    (input_plan->>'orchestrationLatencyMs')::double precision,
    (input_plan->>'accuracyInputCount')::integer,
    (input_plan->>'recoveryCount')::integer,
    (input_plan->'task'->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,task_id) do update set
    orchestration_latency_ms=excluded.orchestration_latency_ms,
    accuracy_input_count=excluded.accuracy_input_count,
    recovery_count=excluded.recovery_count,
    recorded_at=excluded.recorded_at;
  return query select task.plan from public.repository_task_plans task
  where task.tenant_id=tenant_value and task.task_id=task_value;
end; $$;

create or replace function public.record_repository_task_plan_cache_hit(
  input_tenant_id text,input_owner_id text,input_task_id text
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.repository_task_plan_cache cache set
    hit_count=hit_count+1,last_hit_at=now()
  where cache.tenant_id=input_tenant_id and cache.task_id=input_task_id
    and cache.owner_id=input_owner_id
    and exists(select 1 from public.repository_task_plans task
      where task.tenant_id=cache.tenant_id and task.task_id=cache.task_id
        and task.lifecycle in('published','partial'));
  if not found then
    raise no_data_found using message='repository_task_plan_not_found';
  end if;
end; $$;

create or replace function public.recover_repository_task_plans()
returns integer
language plpgsql security invoker set search_path=public as $$
declare recovered integer;
begin
  with invalid as(
    select task.tenant_id,task.task_id,
      case when task.lifecycle='planning'
        then 'task_planning_interrupted_recovered'
        else 'task_plan_orphan_recovered' end code
    from public.repository_task_plans task
    where task.lifecycle='planning' or (
      task.lifecycle in('published','partial') and
      (select count(*) from public.repository_task_execution_phases phase
       where phase.tenant_id=task.tenant_id
         and phase.task_id=task.task_id)<>7
    )
  ), updated as(
    update public.repository_task_plans task set
      lifecycle='failed',recovery_count=recovery_count+1,
      updated_at=now(),completed_at=null,
      plan=jsonb_set(jsonb_set(task.plan,'{task,lifecycle}','"failed"'),
        '{recoveryCount}',to_jsonb(task.recovery_count+1))
    from invalid
    where task.tenant_id=invalid.tenant_id
      and task.task_id=invalid.task_id
    returning task.tenant_id,task.task_id,invalid.code
  )
  insert into public.repository_task_planning_diagnostics(
    tenant_id,task_id,diagnostic_position,code,severity,
    diagnostic,created_at
  ) select updated.tenant_id,updated.task_id,
    coalesce((select max(diagnostic_position)+1
      from public.repository_task_planning_diagnostics diagnostic
      where diagnostic.tenant_id=updated.tenant_id
        and diagnostic.task_id=updated.task_id),0),
    updated.code,'warning',jsonb_build_object(
      'code',updated.code,'message',
      'Invalid task planning state was fenced from reuse.',
      'severity','warning'),now()
  from updated;
  get diagnostics recovered=row_count;
  return recovered;
end; $$;

create or replace function public.repository_task_planner_metrics(
  input_tenant_id text
) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'plansCreated',count(*) filter(
      where task.lifecycle in('published','partial')),
    'cacheHits',coalesce(sum(cache.hit_count),0),
    'averageOrchestrationLatencyMs',coalesce(avg(
      task.orchestration_latency_ms) filter(
        where task.lifecycle in('published','partial')),0),
    'averageAccuracyInputs',coalesce(avg(task.accuracy_input_count)
      filter(where task.lifecycle in('published','partial')),0),
    'recoveryCount',coalesce(sum(task.recovery_count),0)
  )
  from public.repository_task_plans task
  left join public.repository_task_plan_cache cache
    on cache.tenant_id=task.tenant_id and cache.task_id=task.task_id
  where input_tenant_id is null or task.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_task_plans(
  input_tenant_id text,input_retained_plans integer
) returns integer
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_task_planner_retention(
    tenant_id,retained_plans
  ) values(input_tenant_id,greatest(1,input_retained_plans))
  on conflict(tenant_id) do update set
    retained_plans=excluded.retained_plans,updated_at=now();
  with victims as(
    select task_id from public.repository_task_plans
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,task_id desc
    offset greatest(1,input_retained_plans)
  )
  delete from public.repository_task_plans task using victims
  where task.tenant_id=input_tenant_id and task.task_id=victims.task_id;
  get diagnostics removed=row_count;
  return removed;
end; $$;

create or replace function public.verify_repository_task_planner_contract()
returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  foreach object_name in array array[
    'repository_task_plans','repository_task_execution_phases',
    'repository_task_planning_diagnostics','repository_task_plan_cache',
    'repository_task_planner_metrics','repository_task_planner_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_task_plan_cache_identity_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_task_phase_order_idx')
    or not exists(select 1 from pg_constraint
      where conname='repository_task_phase_plan_fk' and confdeltype='c')
    or to_regprocedure(
      'public.recover_repository_task_plans()') is null
    or to_regprocedure(
      'public.collect_repository_task_plans(text,integer)') is null then
    issues:=issues||
      '"repository_task_indexes_constraints_or_retention_invalid"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_task_plans','select')
    or has_table_privilege(
      'anon','public.repository_task_plans','select')
    or not has_function_privilege(
      'service_role',
      'public.save_repository_task_plan(jsonb,text)','execute')
    or has_function_privilege(
      'anon',
      'public.save_repository_task_plan(jsonb,text)','execute') then
    issues:=issues||'"repository_task_planner_grants_invalid"'::jsonb;
  end if;
  return jsonb_build_object(
    'valid',jsonb_array_length(issues)=0,
    'schemaVersion','repository-task-plan-schema-v1',
    'failures',issues
  );
end; $$;

do $$ declare object_name text;
begin
  foreach object_name in array array[
    'repository_task_plans','repository_task_execution_phases',
    'repository_task_planning_diagnostics','repository_task_plan_cache',
    'repository_task_planner_metrics','repository_task_planner_retention'
  ] loop
    execute format(
      'alter table public.%I enable row level security',object_name);
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',
      object_name);
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name);
  end loop;
end $$;

revoke all on function public.get_repository_task_plan(text,text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_task_plan(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.record_repository_task_plan_cache_hit(
  text,text,text) from public,anon,authenticated;
revoke all on function public.recover_repository_task_plans()
  from public,anon,authenticated;
revoke all on function public.repository_task_planner_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_task_plans(text,integer)
  from public,anon,authenticated;
revoke all on function public.verify_repository_task_planner_contract()
  from public,anon,authenticated;

grant execute on function public.get_repository_task_plan(text,text,text)
  to service_role;
grant execute on function public.save_repository_task_plan(jsonb,text)
  to service_role;
grant execute on function public.record_repository_task_plan_cache_hit(
  text,text,text) to service_role;
grant execute on function public.recover_repository_task_plans()
  to service_role;
grant execute on function public.repository_task_planner_metrics(text)
  to service_role;
grant execute on function public.collect_repository_task_plans(text,integer)
  to service_role;
grant execute on function public.verify_repository_task_planner_contract()
  to service_role;

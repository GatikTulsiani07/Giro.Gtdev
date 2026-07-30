create table if not exists public.repository_coordinated_executions (
  tenant_id text not null,
  execution_id text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  task_id text not null,
  specification_id text not null,
  workflow_id text not null,
  schema_version text not null,
  persistence_version bigint not null,
  ownership_fingerprint text not null,
  status text not null,
  orchestration_latency_ms double precision not null default 0,
  recovery_count integer not null default 0,
  execution jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,execution_id),
  constraint repository_coordinated_execution_snapshot_fk
    foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_coordinated_execution_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete cascade,
  constraint repository_coordinated_execution_schema_valid
    check(schema_version='repository-execution-coordinator-schema-v1'),
  constraint repository_coordinated_execution_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_coordinated_execution_status_valid check(status in(
    'coordinating','completed','partial','failed','stale'
  )),
  constraint repository_coordinated_execution_values_valid check(
    tenant_id<>'' and execution_id<>'' and owner_id<>''
    and repository_id<>'' and task_id<>'' and specification_id<>''
    and workflow_id<>'' and ownership_fingerprint<>''
    and orchestration_latency_ms>=0 and recovery_count>=0
    and jsonb_typeof(execution)='object'
  ),
  constraint repository_coordinated_execution_completion_valid check(
    status not in('completed','partial') or completed_at is not null
  )
);

create table if not exists public.repository_execution_stage_history (
  tenant_id text not null,
  execution_id text not null,
  transition_id text not null,
  position integer not null,
  from_stage text,
  stage text not null,
  outcome text not null,
  duration_ms double precision not null,
  transition jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  primary key(tenant_id,execution_id,transition_id),
  unique(tenant_id,execution_id,position),
  constraint repository_execution_stage_execution_fk
    foreign key(tenant_id,execution_id)
    references public.repository_coordinated_executions(
      tenant_id,execution_id) on delete cascade,
  constraint repository_execution_stage_position_valid check(position>=0),
  constraint repository_execution_stage_name_valid check(stage in(
    'query','task planning','specification generation',
    'impact verification','review preparation','execution readiness',
    'completion'
  )),
  constraint repository_execution_stage_from_valid check(
    from_stage is null or from_stage in(
      'query','task planning','specification generation',
      'impact verification','review preparation','execution readiness',
      'completion'
    )
  ),
  constraint repository_execution_stage_outcome_valid
    check(outcome in('completed','partial','failed')),
  constraint repository_execution_stage_values_valid check(
    duration_ms>=0 and jsonb_typeof(transition)='object'
  )
);

create table if not exists public.repository_execution_readiness_reports (
  tenant_id text not null,
  execution_id text not null,
  report_id text not null,
  readiness_status text not null,
  report jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,execution_id,report_id),
  constraint repository_execution_readiness_execution_fk
    foreign key(tenant_id,execution_id)
    references public.repository_coordinated_executions(
      tenant_id,execution_id) on delete cascade,
  constraint repository_execution_readiness_status_valid
    check(readiness_status in('ready','partial','not_ready')),
  constraint repository_execution_readiness_object_valid
    check(jsonb_typeof(report)='object')
);

create table if not exists public.repository_execution_coordinator_diagnostics (
  tenant_id text not null,
  execution_id text not null,
  diagnostic_position integer not null,
  code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,execution_id,diagnostic_position),
  constraint repository_execution_diagnostic_execution_fk
    foreign key(tenant_id,execution_id)
    references public.repository_coordinated_executions(
      tenant_id,execution_id) on delete cascade,
  constraint repository_execution_diagnostic_values_valid check(
    diagnostic_position>=0 and code<>'' and
    severity in('info','warning','error') and
    jsonb_typeof(diagnostic)='object'
  )
);

create table if not exists public.repository_execution_coordinator_cache (
  tenant_id text not null,
  execution_id text not null,
  owner_id text not null,
  repository_id text not null,
  repository_revision text not null,
  task_id text not null,
  specification_id text not null,
  workflow_id text not null,
  ownership_fingerprint text not null,
  hit_count bigint not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null,
  primary key(tenant_id,execution_id),
  constraint repository_execution_cache_execution_fk
    foreign key(tenant_id,execution_id)
    references public.repository_coordinated_executions(
      tenant_id,execution_id) on delete cascade,
  constraint repository_execution_cache_values_valid check(
    owner_id<>'' and repository_id<>'' and task_id<>''
    and specification_id<>'' and workflow_id<>''
    and ownership_fingerprint<>'' and hit_count>=0
  )
);

create table if not exists public.repository_execution_coordinator_metrics (
  tenant_id text not null,
  execution_id text not null,
  orchestration_latency_ms double precision not null,
  recovery_count integer not null default 0,
  readiness_status text,
  recorded_at timestamptz not null,
  primary key(tenant_id,execution_id),
  constraint repository_execution_metric_execution_fk
    foreign key(tenant_id,execution_id)
    references public.repository_coordinated_executions(
      tenant_id,execution_id) on delete cascade,
  constraint repository_execution_metric_values_valid check(
    orchestration_latency_ms>=0 and recovery_count>=0 and
    (readiness_status is null or
      readiness_status in('ready','partial','not_ready'))
  )
);

create table if not exists public.repository_execution_coordinator_retention (
  tenant_id text primary key,
  retained_executions integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_execution_retention_positive
    check(retained_executions>0)
);

create unique index if not exists
  repository_execution_coordinator_cache_identity_idx
  on public.repository_execution_coordinator_cache(
    tenant_id,owner_id,repository_id,repository_revision,task_id,
    specification_id,workflow_id,ownership_fingerprint
  );
create index if not exists repository_coordinated_execution_repository_idx
  on public.repository_coordinated_executions(
    tenant_id,owner_id,repository_id,repository_revision,updated_at desc
  );
create index if not exists repository_coordinated_execution_recovery_idx
  on public.repository_coordinated_executions(status,updated_at)
  where status in('coordinating','partial','failed','stale');
create index if not exists repository_execution_stage_order_idx
  on public.repository_execution_stage_history(
    tenant_id,execution_id,position
  );
create index if not exists repository_execution_stage_duration_idx
  on public.repository_execution_stage_history(
    tenant_id,stage,duration_ms
  );
create index if not exists repository_execution_readiness_status_idx
  on public.repository_execution_readiness_reports(
    tenant_id,readiness_status,created_at desc
  );
create index if not exists repository_execution_diagnostic_code_idx
  on public.repository_execution_coordinator_diagnostics(
    tenant_id,code,severity,created_at desc
  );
create index if not exists repository_execution_metrics_time_idx
  on public.repository_execution_coordinator_metrics(
    tenant_id,recorded_at desc
  );

create or replace function public.get_repository_coordinated_execution(
  input_tenant_id text,input_owner_id text,input_execution_id text
) returns table(execution jsonb)
language sql stable security invoker set search_path=public as $$
  select item.execution
  from public.repository_coordinated_executions item
  where item.tenant_id=input_tenant_id
    and item.owner_id=input_owner_id
    and item.execution_id=input_execution_id
    and item.status='completed'
  limit 1
$$;

create or replace function public.save_repository_coordinated_execution(
  input_execution jsonb,input_expected_version text
) returns table(execution jsonb)
language plpgsql security invoker set search_path=public as $$
declare tenant_value text:=input_execution->'execution'->>'tenantId';
declare execution_value text:=input_execution->'execution'->>'executionId';
declare existing public.repository_coordinated_executions%rowtype;
declare saved jsonb;
declare item jsonb;
declare item_position integer:=0;
declare execution_status text:=input_execution->'execution'->>'status';
begin
  if input_execution->'execution'->>'schemaVersion'
      <>'repository-execution-coordinator-schema-v1'
    or jsonb_typeof(input_execution->'stageHistory')<>'array'
    or jsonb_typeof(input_execution->'diagnostics')<>'array'
    or (input_execution->>'orchestrationLatencyMs')::double precision<0
    or (input_execution->>'recoveryCount')::integer<0 then
    raise check_violation
      using message='repository_execution_coordination_structure_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=
      input_execution->'execution'->>'repositoryId'
      and repository.owner_user_id=
        input_execution->'execution'->>'ownerId'
      and repository.current_revision=
        input_execution->'execution'->>'repositoryRevision'
      and repository.indexed_revision=
        input_execution->'execution'->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation
      using message='repository_execution_revision_or_ownership_invalid';
  end if;
  if not exists(
    select 1 from public.autonomous_workflows workflow
    where workflow.tenant_id=tenant_value
      and workflow.workflow_id=
        input_execution->'execution'->>'workflowId'
      and workflow.owner_id=input_execution->'execution'->>'ownerId'
      and workflow.repository_id=
        input_execution->'execution'->>'repositoryId'
      and workflow.repository_revision=
        input_execution->'execution'->>'repositoryRevision'
  ) then
    raise check_violation
      using message='repository_execution_workflow_lineage_invalid';
  end if;
  if execution_status in('completed','partial') and (
    not exists(
      select 1 from public.repository_task_plans task
      where task.tenant_id=tenant_value
        and task.task_id=input_execution->'execution'->>'taskId'
        and task.owner_id=input_execution->'execution'->>'ownerId'
        and task.repository_id=
          input_execution->'execution'->>'repositoryId'
        and task.repository_revision=
          input_execution->'execution'->>'repositoryRevision'
        and task.lifecycle in('published','partial')
    ) or not exists(
      select 1 from public.repository_engineering_specifications specification
      where specification.tenant_id=tenant_value
        and specification.specification_id=
          input_execution->'execution'->>'specificationId'
        and specification.owner_id=
          input_execution->'execution'->>'ownerId'
        and specification.repository_id=
          input_execution->'execution'->>'repositoryId'
        and specification.repository_revision=
          input_execution->'execution'->>'repositoryRevision'
        and specification.task_id=
          input_execution->'execution'->>'taskId'
        and specification.workflow_id=
          input_execution->'execution'->>'workflowId'
        and specification.ownership_fingerprint=
          input_execution->'execution'->>'ownershipFingerprint'
        and specification.lifecycle in('published','partial')
    )
  ) then
    raise check_violation
      using message='repository_execution_task_or_specification_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||execution_value,0));
  select * into existing
  from public.repository_coordinated_executions candidate
  where candidate.tenant_id=tenant_value
    and candidate.execution_id=execution_value for update;
  if (found and input_expected_version is not null and
      existing.persistence_version<>input_expected_version::bigint)
    or (not found and input_expected_version is not null) then
    raise serialization_failure
      using message='repository_execution_coordination_version_conflict';
  end if;
  if found and (
      existing.owner_id<>input_execution->'execution'->>'ownerId' or
      existing.repository_id<>
        input_execution->'execution'->>'repositoryId' or
      existing.task_id<>input_execution->'execution'->>'taskId' or
      existing.specification_id<>
        input_execution->'execution'->>'specificationId') then
    raise insufficient_privilege
      using message='repository_execution_coordination_identity_conflict';
  end if;
  saved:=jsonb_set(input_execution,
    '{execution,persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.repository_coordinated_executions(
    tenant_id,execution_id,owner_id,repository_id,repository_revision,
    task_id,specification_id,workflow_id,schema_version,persistence_version,
    ownership_fingerprint,status,orchestration_latency_ms,recovery_count,
    execution,created_at,updated_at,completed_at
  ) values(
    tenant_value,execution_value,
    input_execution->'execution'->>'ownerId',
    input_execution->'execution'->>'repositoryId',
    input_execution->'execution'->>'repositoryRevision',
    input_execution->'execution'->>'taskId',
    input_execution->'execution'->>'specificationId',
    input_execution->'execution'->>'workflowId',
    input_execution->'execution'->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),
    input_execution->'execution'->>'ownershipFingerprint',
    execution_status,
    (input_execution->>'orchestrationLatencyMs')::double precision,
    (input_execution->>'recoveryCount')::integer,saved,
    (input_execution->'execution'->>'createdAt')::timestamptz,
    (input_execution->'execution'->>'updatedAt')::timestamptz,
    nullif(input_execution->'execution'->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,execution_id) do update set
    persistence_version=excluded.persistence_version,
    ownership_fingerprint=excluded.ownership_fingerprint,
    status=excluded.status,
    orchestration_latency_ms=excluded.orchestration_latency_ms,
    recovery_count=excluded.recovery_count,execution=excluded.execution,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at;

  delete from public.repository_execution_stage_history stage
    where stage.tenant_id=tenant_value
      and stage.execution_id=execution_value;
  for item in select value from jsonb_array_elements(
    input_execution->'stageHistory')
  loop
    insert into public.repository_execution_stage_history(
      tenant_id,execution_id,transition_id,position,from_stage,stage,
      outcome,duration_ms,transition,started_at,completed_at
    ) values(
      tenant_value,execution_value,item->>'transitionId',
      (item->>'position')::integer,item->>'fromStage',item->>'stage',
      item->>'outcome',(item->>'durationMs')::double precision,item,
      (item->>'startedAt')::timestamptz,
      (item->>'completedAt')::timestamptz
    );
  end loop;
  delete from public.repository_execution_readiness_reports report
    where report.tenant_id=tenant_value
      and report.execution_id=execution_value;
  if jsonb_typeof(input_execution->'readiness')='object' then
    insert into public.repository_execution_readiness_reports(
      tenant_id,execution_id,report_id,readiness_status,report,created_at
    ) values(
      tenant_value,execution_value,
      input_execution->'readiness'->>'reportId',
      input_execution->'readiness'->>'status',
      input_execution->'readiness',
      (input_execution->'readiness'->>'createdAt')::timestamptz
    );
  end if;
  delete from public.repository_execution_coordinator_diagnostics diagnostic
    where diagnostic.tenant_id=tenant_value
      and diagnostic.execution_id=execution_value;
  for item in select value from jsonb_array_elements(
    input_execution->'diagnostics')
  loop
    insert into public.repository_execution_coordinator_diagnostics(
      tenant_id,execution_id,diagnostic_position,code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,execution_value,item_position,item->>'code',
      item->>'severity',item,
      (input_execution->'execution'->>'updatedAt')::timestamptz
    );
    item_position:=item_position+1;
  end loop;
  if execution_status='completed' then
    insert into public.repository_execution_coordinator_cache(
      tenant_id,execution_id,owner_id,repository_id,repository_revision,
      task_id,specification_id,workflow_id,ownership_fingerprint,created_at
    ) values(
      tenant_value,execution_value,
      input_execution->'execution'->>'ownerId',
      input_execution->'execution'->>'repositoryId',
      input_execution->'execution'->>'repositoryRevision',
      input_execution->'execution'->>'taskId',
      input_execution->'execution'->>'specificationId',
      input_execution->'execution'->>'workflowId',
      input_execution->'execution'->>'ownershipFingerprint',
      (input_execution->'execution'->>'createdAt')::timestamptz
    ) on conflict(tenant_id,execution_id) do update set
      ownership_fingerprint=excluded.ownership_fingerprint,
      repository_revision=excluded.repository_revision;
  else
    delete from public.repository_execution_coordinator_cache cache
      where cache.tenant_id=tenant_value
        and cache.execution_id=execution_value;
  end if;
  insert into public.repository_execution_coordinator_metrics(
    tenant_id,execution_id,orchestration_latency_ms,recovery_count,
    readiness_status,recorded_at
  ) values(
    tenant_value,execution_value,
    (input_execution->>'orchestrationLatencyMs')::double precision,
    (input_execution->>'recoveryCount')::integer,
    input_execution->'readiness'->>'status',
    (input_execution->'execution'->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,execution_id) do update set
    orchestration_latency_ms=excluded.orchestration_latency_ms,
    recovery_count=excluded.recovery_count,
    readiness_status=excluded.readiness_status,
    recorded_at=excluded.recorded_at;
  return query select candidate.execution
    from public.repository_coordinated_executions candidate
    where candidate.tenant_id=tenant_value
      and candidate.execution_id=execution_value;
end; $$;

create or replace function
  public.record_repository_execution_coordination_cache_hit(
    input_tenant_id text,input_owner_id text,input_execution_id text
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.repository_execution_coordinator_cache cache set
    hit_count=hit_count+1,last_hit_at=now()
  where cache.tenant_id=input_tenant_id
    and cache.execution_id=input_execution_id
    and cache.owner_id=input_owner_id
    and exists(
      select 1 from public.repository_coordinated_executions item
      where item.tenant_id=cache.tenant_id
        and item.execution_id=cache.execution_id
        and item.status='completed'
    );
  if not found then
    raise no_data_found
      using message='repository_coordinated_execution_not_found';
  end if;
end; $$;

create or replace function public.recover_repository_coordinated_executions()
returns integer
language plpgsql security invoker set search_path=public as $$
declare recovered integer;
begin
  with invalid as(
    select item.tenant_id,item.execution_id,
      case
        when not exists(
          select 1 from public.repositories repository
          where repository.repository_id=item.repository_id
            and repository.current_revision=item.repository_revision
            and repository.indexed_revision=item.repository_revision
            and repository.deletion_state='active'
        ) then 'execution_coordination_stale_recovered'
        when item.status='partial'
          then 'execution_coordination_partial_failure_recovered'
        else 'execution_coordination_interrupted_recovered'
      end code,
      case when not exists(
        select 1 from public.repositories repository
        where repository.repository_id=item.repository_id
          and repository.current_revision=item.repository_revision
          and repository.indexed_revision=item.repository_revision
          and repository.deletion_state='active'
      ) then 'stale' else 'failed' end recovered_status
    from public.repository_coordinated_executions item
    where item.status in('coordinating','partial') or not exists(
      select 1 from public.repositories repository
      where repository.repository_id=item.repository_id
        and repository.current_revision=item.repository_revision
        and repository.indexed_revision=item.repository_revision
        and repository.deletion_state='active'
    )
  ), updated as(
    update public.repository_coordinated_executions item set
      status=invalid.recovered_status,
      recovery_count=recovery_count+1,updated_at=now(),completed_at=null,
      execution=jsonb_set(
        jsonb_set(
          jsonb_set(item.execution,'{execution,status}',
            to_jsonb(invalid.recovered_status)),
          '{recoveryCount}',to_jsonb(item.recovery_count+1)),
        '{diagnostics}',
        coalesce(item.execution->'diagnostics','[]'::jsonb)||
          jsonb_build_array(jsonb_build_object(
            'code',invalid.code,
            'message',
              'Invalid execution coordination state was fenced from reuse.',
            'severity','warning')))
    from invalid
    where item.tenant_id=invalid.tenant_id
      and item.execution_id=invalid.execution_id
    returning item.tenant_id,item.execution_id,invalid.code
  )
  insert into public.repository_execution_coordinator_diagnostics(
    tenant_id,execution_id,diagnostic_position,code,severity,
    diagnostic,created_at
  ) select updated.tenant_id,updated.execution_id,
    coalesce((select max(diagnostic_position)+1
      from public.repository_execution_coordinator_diagnostics diagnostic
      where diagnostic.tenant_id=updated.tenant_id
        and diagnostic.execution_id=updated.execution_id),0),
    updated.code,'warning',jsonb_build_object(
      'code',updated.code,'message',
      'Invalid execution coordination state was fenced from reuse.',
      'severity','warning'),now()
  from updated;
  get diagnostics recovered=row_count;
  return recovered;
end; $$;

create or replace function public.repository_execution_coordinator_metrics(
  input_tenant_id text
) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'executions',(select count(*)
      from public.repository_coordinated_executions item
      where input_tenant_id is null or item.tenant_id=input_tenant_id),
    'stageDurations',(
      select coalesce(jsonb_object_agg(stage_name,average_duration),'{}'::jsonb)
      from (
        select names.stage_name,
          coalesce(avg(history.duration_ms),0) average_duration
        from unnest(array[
          'query','task planning','specification generation',
          'impact verification','review preparation','execution readiness',
          'completion'
        ]) names(stage_name)
        left join public.repository_execution_stage_history history
          on history.stage=names.stage_name and
          (input_tenant_id is null or history.tenant_id=input_tenant_id)
        group by names.stage_name
      ) durations
    ),
    'cacheHits',coalesce((select sum(cache.hit_count)
      from public.repository_execution_coordinator_cache cache
      where input_tenant_id is null or cache.tenant_id=input_tenant_id),0),
    'averageOrchestrationLatencyMs',coalesce((select avg(
      item.orchestration_latency_ms)
      from public.repository_coordinated_executions item
      where input_tenant_id is null or item.tenant_id=input_tenant_id),0),
    'recoveryCount',coalesce((select sum(item.recovery_count)
      from public.repository_coordinated_executions item
      where input_tenant_id is null or item.tenant_id=input_tenant_id),0),
    'readinessOutcomes',jsonb_build_object(
      'ready',(select count(*) from
        public.repository_execution_readiness_reports report
        where report.readiness_status='ready' and
          (input_tenant_id is null or report.tenant_id=input_tenant_id)),
      'partial',(select count(*) from
        public.repository_execution_readiness_reports report
        where report.readiness_status='partial' and
          (input_tenant_id is null or report.tenant_id=input_tenant_id)),
      'not_ready',(select count(*) from
        public.repository_execution_readiness_reports report
        where report.readiness_status='not_ready' and
          (input_tenant_id is null or report.tenant_id=input_tenant_id))
    )
  )
$$;

create or replace function public.collect_repository_coordinated_executions(
  input_tenant_id text,input_retained_executions integer
) returns integer
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_execution_coordinator_retention(
    tenant_id,retained_executions
  ) values(input_tenant_id,greatest(1,input_retained_executions))
  on conflict(tenant_id) do update set
    retained_executions=excluded.retained_executions,updated_at=now();
  with victims as(
    select execution_id from public.repository_coordinated_executions
    where tenant_id=input_tenant_id and status<>'completed'
    order by updated_at desc,execution_id desc
    offset greatest(1,input_retained_executions)
  )
  delete from public.repository_coordinated_executions item using victims
  where item.tenant_id=input_tenant_id
    and item.execution_id=victims.execution_id;
  get diagnostics removed=row_count;
  return removed;
end; $$;

create or replace function
  public.verify_repository_execution_coordinator_contract()
returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  foreach object_name in array array[
    'repository_coordinated_executions',
    'repository_execution_stage_history',
    'repository_execution_readiness_reports',
    'repository_execution_coordinator_diagnostics',
    'repository_execution_coordinator_cache',
    'repository_execution_coordinator_metrics',
    'repository_execution_coordinator_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname=
        'repository_execution_coordinator_cache_identity_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_execution_stage_order_idx')
    or not exists(select 1 from pg_constraint
      where conname='repository_execution_stage_execution_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_coordinated_execution_snapshot_fk')
    or to_regprocedure(
      'public.recover_repository_coordinated_executions()') is null
    or to_regprocedure(
      'public.collect_repository_coordinated_executions(text,integer)')
      is null then
    issues:=issues||
      '"repository_execution_coordinator_indexes_constraints_or_retention_invalid"'
        ::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_coordinated_executions','select')
    or has_table_privilege(
      'anon','public.repository_coordinated_executions','select')
    or not has_function_privilege(
      'service_role',
      'public.save_repository_coordinated_execution(jsonb,text)','execute')
    or has_function_privilege(
      'anon',
      'public.save_repository_coordinated_execution(jsonb,text)','execute')
    then
    issues:=issues||'"repository_execution_coordinator_grants_invalid"'::jsonb;
  end if;
  return jsonb_build_object(
    'valid',jsonb_array_length(issues)=0,
    'schemaVersion','repository-execution-coordinator-schema-v1',
    'coordinatorVersion','repository-execution-coordinator-v1',
    'registered',true,
    'failures',issues
  );
end; $$;

do $$ declare object_name text;
begin
  foreach object_name in array array[
    'repository_coordinated_executions',
    'repository_execution_stage_history',
    'repository_execution_readiness_reports',
    'repository_execution_coordinator_diagnostics',
    'repository_execution_coordinator_cache',
    'repository_execution_coordinator_metrics',
    'repository_execution_coordinator_retention'
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

revoke all on function
  public.get_repository_coordinated_execution(text,text,text)
  from public,anon,authenticated;
revoke all on function
  public.save_repository_coordinated_execution(jsonb,text)
  from public,anon,authenticated;
revoke all on function
  public.record_repository_execution_coordination_cache_hit(text,text,text)
  from public,anon,authenticated;
revoke all on function public.recover_repository_coordinated_executions()
  from public,anon,authenticated;
revoke all on function public.repository_execution_coordinator_metrics(text)
  from public,anon,authenticated;
revoke all on function
  public.collect_repository_coordinated_executions(text,integer)
  from public,anon,authenticated;
revoke all on function
  public.verify_repository_execution_coordinator_contract()
  from public,anon,authenticated;

grant execute on function
  public.get_repository_coordinated_execution(text,text,text)
  to service_role;
grant execute on function
  public.save_repository_coordinated_execution(jsonb,text)
  to service_role;
grant execute on function
  public.record_repository_execution_coordination_cache_hit(text,text,text)
  to service_role;
grant execute on function public.recover_repository_coordinated_executions()
  to service_role;
grant execute on function public.repository_execution_coordinator_metrics(text)
  to service_role;
grant execute on function
  public.collect_repository_coordinated_executions(text,integer)
  to service_role;
grant execute on function
  public.verify_repository_execution_coordinator_contract()
  to service_role;

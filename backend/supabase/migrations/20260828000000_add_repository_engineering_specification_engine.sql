create table if not exists public.repository_engineering_specifications (
  tenant_id text not null,
  specification_id text not null,
  owner_id text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  task_id text,
  workflow_id text,
  schema_version text not null,
  persistence_version bigint not null,
  specification_type text not null,
  confidence double precision not null,
  ownership_fingerprint text not null,
  lifecycle text not null,
  source_versions jsonb not null,
  orchestration_latency_ms double precision not null default 0,
  recovery_count integer not null default 0,
  specification jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,specification_id),
  constraint repository_specification_snapshot_fk
    foreign key(repository_id,repository_revision)
    references public.repository_snapshots(repository_id,revision)
    on delete cascade,
  constraint repository_specification_task_fk
    foreign key(tenant_id,task_id)
    references public.repository_task_plans(tenant_id,task_id)
    on delete set null (task_id),
  constraint repository_specification_workflow_fk
    foreign key(tenant_id,workflow_id)
    references public.autonomous_workflows(tenant_id,workflow_id)
    on delete set null (workflow_id),
  constraint repository_specification_schema_valid
    check(schema_version='repository-engineering-specification-v1'),
  constraint repository_specification_revision_valid
    check(repository_revision~'^[0-9a-f]{40}$'),
  constraint repository_specification_type_valid check(specification_type in(
    'feature','bug-fix','refactor','api','architecture','migration',
    'security','performance','testing'
  )),
  constraint repository_specification_lifecycle_valid check(lifecycle in(
    'generating','published','partial','failed','superseded'
  )),
  constraint repository_specification_values_valid check(
    tenant_id<>'' and specification_id<>'' and owner_id<>''
    and repository_id<>'' and ownership_fingerprint<>''
    and confidence between 0 and 1 and orchestration_latency_ms>=0
    and recovery_count>=0 and jsonb_typeof(source_versions)='object'
    and jsonb_typeof(specification)='object'
  ),
  constraint repository_specification_completion_valid check(
    lifecycle not in('published','partial') or completed_at is not null
  )
);

create table if not exists public.repository_specification_phases (
  tenant_id text not null,
  specification_id text not null,
  phase_id text not null,
  position integer not null,
  phase_kind text not null,
  phase jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,specification_id,phase_id),
  unique(tenant_id,specification_id,position),
  constraint repository_specification_phase_fk
    foreign key(tenant_id,specification_id)
    references public.repository_engineering_specifications(
      tenant_id,specification_id) on delete cascade,
  constraint repository_specification_phase_position_valid check(position>=0),
  constraint repository_specification_phase_kind_valid check(phase_kind in(
    'preparation','implementation','verification','testing','review',
    'rollout','post-deployment validation'
  )),
  constraint repository_specification_phase_object_valid
    check(jsonb_typeof(phase)='object')
);

create table if not exists public.repository_specification_acceptance_criteria (
  tenant_id text not null,
  specification_id text not null,
  criterion_kind text not null,
  criterion_position integer not null,
  criterion text not null,
  created_at timestamptz not null,
  primary key(
    tenant_id,specification_id,criterion_kind,criterion_position
  ),
  constraint repository_specification_criterion_fk
    foreign key(tenant_id,specification_id)
    references public.repository_engineering_specifications(
      tenant_id,specification_id) on delete cascade,
  constraint repository_specification_criterion_kind_valid
    check(criterion_kind in(
      'functionalRequirements','nonFunctionalRequirements',
      'validationChecklist','successCriteria'
    )),
  constraint repository_specification_criterion_values_valid
    check(criterion_position>=0 and criterion<>'')
);

create table if not exists public.repository_specification_diagnostics (
  tenant_id text not null,
  specification_id text not null,
  diagnostic_position integer not null,
  code text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,specification_id,diagnostic_position),
  constraint repository_specification_diagnostic_fk
    foreign key(tenant_id,specification_id)
    references public.repository_engineering_specifications(
      tenant_id,specification_id) on delete cascade,
  constraint repository_specification_diagnostic_values_valid check(
    diagnostic_position>=0 and code<>'' and
    severity in('info','warning','error') and
    jsonb_typeof(diagnostic)='object'
  )
);

create table if not exists public.repository_specification_cache (
  tenant_id text not null,
  specification_id text not null,
  owner_id text not null,
  repository_id text not null,
  repository_revision text not null,
  task_id text,
  workflow_id text,
  normalized_objective text not null,
  ownership_fingerprint text not null,
  hit_count bigint not null default 0,
  last_hit_at timestamptz,
  created_at timestamptz not null,
  primary key(tenant_id,specification_id),
  constraint repository_specification_cache_fk
    foreign key(tenant_id,specification_id)
    references public.repository_engineering_specifications(
      tenant_id,specification_id) on delete cascade,
  constraint repository_specification_cache_values_valid check(
    owner_id<>'' and repository_id<>'' and normalized_objective<>''
    and ownership_fingerprint<>'' and hit_count>=0
  )
);

create table if not exists public.repository_specification_metrics (
  tenant_id text not null,
  specification_id text not null,
  orchestration_latency_ms double precision not null,
  recovery_count integer not null default 0,
  recorded_at timestamptz not null,
  primary key(tenant_id,specification_id),
  constraint repository_specification_metric_fk
    foreign key(tenant_id,specification_id)
    references public.repository_engineering_specifications(
      tenant_id,specification_id) on delete cascade,
  constraint repository_specification_metric_values_valid check(
    orchestration_latency_ms>=0 and recovery_count>=0
  )
);

create table if not exists public.repository_specification_retention (
  tenant_id text primary key,
  retained_specifications integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_specification_retention_positive
    check(retained_specifications>0)
);

create unique index if not exists
  repository_specification_cache_identity_idx
  on public.repository_specification_cache(
    tenant_id,owner_id,repository_id,repository_revision,
    coalesce(task_id,''),coalesce(workflow_id,''),normalized_objective,
    ownership_fingerprint
  );
create index if not exists repository_specification_repository_idx
  on public.repository_engineering_specifications(
    tenant_id,owner_id,repository_id,repository_revision,updated_at desc
  );
create index if not exists repository_specification_recovery_idx
  on public.repository_engineering_specifications(lifecycle,updated_at)
  where lifecycle in('generating','partial','failed');
create index if not exists repository_specification_phase_order_idx
  on public.repository_specification_phases(
    tenant_id,specification_id,position
  );
create index if not exists repository_specification_diagnostic_code_idx
  on public.repository_specification_diagnostics(
    tenant_id,code,severity,created_at desc
  );
create index if not exists repository_specification_metrics_time_idx
  on public.repository_specification_metrics(tenant_id,recorded_at desc);

create or replace function public.get_repository_engineering_specification(
  input_tenant_id text,input_owner_id text,input_specification_id text
) returns table(specification jsonb)
language sql stable security invoker set search_path=public as $$
  select item.specification
  from public.repository_engineering_specifications item
  where item.tenant_id=input_tenant_id
    and item.owner_id=input_owner_id
    and item.specification_id=input_specification_id
    and item.lifecycle in('published','partial')
  limit 1
$$;

create or replace function public.save_repository_engineering_specification(
  input_specification jsonb,input_expected_version text
) returns table(specification jsonb)
language plpgsql security invoker set search_path=public as $$
declare tenant_value text:=
  input_specification->'specification'->>'tenantId';
declare specification_value text:=
  input_specification->'specification'->>'specificationId';
declare existing public.repository_engineering_specifications%rowtype;
declare saved jsonb;
declare item jsonb;
declare item_position integer;
declare item_kind text;
begin
  if input_specification->'specification'->>'schemaVersion'
      <>'repository-engineering-specification-v1'
    or jsonb_typeof(input_specification->'implementationPhases')<>'array'
    or jsonb_typeof(input_specification->'acceptanceCriteria')<>'object'
    or jsonb_typeof(input_specification->'testStrategy')<>'object'
    or jsonb_typeof(input_specification->'risks')<>'object'
    or (input_specification->'specification'->>'confidence')::double precision
      not between 0 and 1
    or (input_specification->>'orchestrationLatencyMs')::double precision<0
    or (input_specification->>'recoveryCount')::integer<0 then
    raise check_violation
      using message='repository_specification_structure_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=
      input_specification->'specification'->>'repositoryId'
      and repository.owner_user_id=
        input_specification->'specification'->>'ownerId'
      and repository.current_revision=
        input_specification->'specification'->>'repositoryRevision'
      and repository.indexed_revision=
        input_specification->'specification'->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation
      using message='repository_specification_revision_or_ownership_invalid';
  end if;
  if not exists(
    select 1 from public.repository_intelligence_versions source
    where source.intelligence_version=
      input_specification->'context'->'sourceVersions'
        ->>'repositoryIntelligence'
      and source.repository_id=
        input_specification->'specification'->>'repositoryId'
      and source.repository_revision=
        input_specification->'specification'->>'repositoryRevision'
      and source.status='published'
  ) or not exists(
    select 1 from public.repository_graph_versions source
    where source.graph_version=
      input_specification->'context'->'sourceVersions'->>'repositoryGraph'
      and source.repository_id=
        input_specification->'specification'->>'repositoryId'
      and source.repository_revision=
        input_specification->'specification'->>'repositoryRevision'
      and source.status='published'
  ) or not exists(
    select 1 from public.semantic_graph_versions source
    where source.tenant_id=tenant_value
      and source.owner_id=input_specification->'specification'->>'ownerId'
      and source.graph_version=
        input_specification->'context'->'sourceVersions'->>'semanticGraph'
      and source.repository_id=
        input_specification->'specification'->>'repositoryId'
      and source.repository_revision=
        input_specification->'specification'->>'repositoryRevision'
      and source.lifecycle='published'
  ) or not exists(
    select 1 from public.feature_graph_versions source
    where source.tenant_id=tenant_value
      and source.owner_id=input_specification->'specification'->>'ownerId'
      and source.graph_version=
        input_specification->'context'->'sourceVersions'->>'featureGraph'
      and source.repository_id=
        input_specification->'specification'->>'repositoryId'
      and source.repository_revision=
        input_specification->'specification'->>'repositoryRevision'
      and source.lifecycle='published'
      and source.semantic_graph_version=
        input_specification->'context'->'sourceVersions'->>'semanticGraph'
      and source.repository_intelligence_version=
        input_specification->'context'->'sourceVersions'
          ->>'repositoryIntelligence'
  ) then
    raise check_violation
      using message='repository_specification_source_lineage_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    tenant_value||'|'||specification_value,0));
  select * into existing
  from public.repository_engineering_specifications candidate
  where candidate.tenant_id=tenant_value
    and candidate.specification_id=specification_value for update;
  if (found and input_expected_version is not null and
      existing.persistence_version<>input_expected_version::bigint)
    or (not found and input_expected_version is not null) then
    raise serialization_failure
      using message='repository_specification_version_conflict';
  end if;
  if found and existing.owner_id<>
      input_specification->'specification'->>'ownerId' then
    raise insufficient_privilege
      using message='repository_specification_access_denied';
  end if;
  saved:=jsonb_set(input_specification,
    '{specification,persistenceVersion}',
    to_jsonb(coalesce(existing.persistence_version+1,1)));
  insert into public.repository_engineering_specifications(
    tenant_id,specification_id,owner_id,repository_id,
    repository_revision,task_id,workflow_id,schema_version,
    persistence_version,specification_type,confidence,
    ownership_fingerprint,lifecycle,source_versions,
    orchestration_latency_ms,recovery_count,specification,
    created_at,updated_at,completed_at
  ) values(
    tenant_value,specification_value,
    input_specification->'specification'->>'ownerId',
    input_specification->'specification'->>'repositoryId',
    input_specification->'specification'->>'repositoryRevision',
    nullif(input_specification->'specification'->>'taskId',''),
    nullif(input_specification->'specification'->>'workflowId',''),
    input_specification->'specification'->>'schemaVersion',
    coalesce(existing.persistence_version+1,1),
    input_specification->'specification'->>'type',
    (input_specification->'specification'->>'confidence')::double precision,
    input_specification->'specification'->>'ownershipFingerprint',
    input_specification->'specification'->>'lifecycle',
    input_specification->'context'->'sourceVersions',
    (input_specification->>'orchestrationLatencyMs')::double precision,
    (input_specification->>'recoveryCount')::integer,saved,
    (input_specification->'specification'->>'createdAt')::timestamptz,
    (input_specification->'specification'->>'updatedAt')::timestamptz,
    nullif(input_specification->'specification'->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,specification_id) do update set
    persistence_version=excluded.persistence_version,
    specification_type=excluded.specification_type,
    confidence=excluded.confidence,
    ownership_fingerprint=excluded.ownership_fingerprint,
    lifecycle=excluded.lifecycle,source_versions=excluded.source_versions,
    orchestration_latency_ms=excluded.orchestration_latency_ms,
    recovery_count=excluded.recovery_count,
    specification=excluded.specification,updated_at=excluded.updated_at,
    completed_at=excluded.completed_at;

  delete from public.repository_specification_phases phase
    where phase.tenant_id=tenant_value
      and phase.specification_id=specification_value;
  for item in select value from jsonb_array_elements(
    input_specification->'implementationPhases')
  loop
    insert into public.repository_specification_phases(
      tenant_id,specification_id,phase_id,position,phase_kind,phase,created_at
    ) values(
      tenant_value,specification_value,item->>'phaseId',
      (item->>'position')::integer,item->>'kind',item,
      (input_specification->'specification'->>'createdAt')::timestamptz
    );
  end loop;
  delete from public.repository_specification_acceptance_criteria criterion
    where criterion.tenant_id=tenant_value
      and criterion.specification_id=specification_value;
  foreach item_kind in array array[
    'functionalRequirements','nonFunctionalRequirements',
    'validationChecklist','successCriteria'
  ] loop
    item_position:=0;
    for item in select value from jsonb_array_elements(
      input_specification->'acceptanceCriteria'->item_kind)
    loop
      insert into public.repository_specification_acceptance_criteria(
        tenant_id,specification_id,criterion_kind,criterion_position,
        criterion,created_at
      ) values(
        tenant_value,specification_value,item_kind,item_position,
        item#>>'{}',
        (input_specification->'specification'->>'createdAt')::timestamptz
      );
      item_position:=item_position+1;
    end loop;
  end loop;
  delete from public.repository_specification_diagnostics diagnostic
    where diagnostic.tenant_id=tenant_value
      and diagnostic.specification_id=specification_value;
  item_position:=0;
  for item in select value from jsonb_array_elements(
    input_specification->'diagnostics')
  loop
    insert into public.repository_specification_diagnostics(
      tenant_id,specification_id,diagnostic_position,code,severity,
      diagnostic,created_at
    ) values(
      tenant_value,specification_value,item_position,item->>'code',
      item->>'severity',item,
      (input_specification->'specification'->>'updatedAt')::timestamptz
    );
    item_position:=item_position+1;
  end loop;
  insert into public.repository_specification_cache(
    tenant_id,specification_id,owner_id,repository_id,
    repository_revision,task_id,workflow_id,normalized_objective,
    ownership_fingerprint,created_at
  ) values(
    tenant_value,specification_value,
    input_specification->'specification'->>'ownerId',
    input_specification->'specification'->>'repositoryId',
    input_specification->'specification'->>'repositoryRevision',
    nullif(input_specification->'specification'->>'taskId',''),
    nullif(input_specification->'specification'->>'workflowId',''),
    lower(regexp_replace(
      btrim(input_specification->'specification'->>'objective'),
      '\s+',' ','g')),
    input_specification->'specification'->>'ownershipFingerprint',
    (input_specification->'specification'->>'createdAt')::timestamptz
  ) on conflict(tenant_id,specification_id) do update set
    ownership_fingerprint=excluded.ownership_fingerprint,
    repository_revision=excluded.repository_revision;
  insert into public.repository_specification_metrics(
    tenant_id,specification_id,orchestration_latency_ms,
    recovery_count,recorded_at
  ) values(
    tenant_value,specification_value,
    (input_specification->>'orchestrationLatencyMs')::double precision,
    (input_specification->>'recoveryCount')::integer,
    (input_specification->'specification'->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,specification_id) do update set
    orchestration_latency_ms=excluded.orchestration_latency_ms,
    recovery_count=excluded.recovery_count,
    recorded_at=excluded.recorded_at;
  return query select candidate.specification
    from public.repository_engineering_specifications candidate
    where candidate.tenant_id=tenant_value
      and candidate.specification_id=specification_value;
end; $$;

create or replace function public.record_repository_specification_cache_hit(
  input_tenant_id text,input_owner_id text,input_specification_id text
) returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.repository_specification_cache cache set
    hit_count=hit_count+1,last_hit_at=now()
  where cache.tenant_id=input_tenant_id
    and cache.specification_id=input_specification_id
    and cache.owner_id=input_owner_id
    and exists(
      select 1 from public.repository_engineering_specifications item
      where item.tenant_id=cache.tenant_id
        and item.specification_id=cache.specification_id
        and item.lifecycle in('published','partial')
    );
  if not found then
    raise no_data_found using message='repository_specification_not_found';
  end if;
end; $$;

create or replace function
  public.recover_repository_engineering_specifications()
returns integer
language plpgsql security invoker set search_path=public as $$
declare recovered integer;
begin
  with invalid as(
    select item.tenant_id,item.specification_id,
      case when item.lifecycle='generating'
        then 'specification_generation_interrupted_recovered'
        when not exists(
          select 1 from public.repositories repository
          where repository.repository_id=item.repository_id
            and repository.current_revision=item.repository_revision
            and repository.indexed_revision=item.repository_revision
            and repository.deletion_state='active'
        ) then 'stale_specification_recovered'
        else 'partial_specification_recovered' end code
    from public.repository_engineering_specifications item
    where item.lifecycle='generating' or not exists(
      select 1 from public.repositories repository
      where repository.repository_id=item.repository_id
        and repository.current_revision=item.repository_revision
        and repository.indexed_revision=item.repository_revision
        and repository.deletion_state='active'
    ) or (
      item.lifecycle in('published','partial') and
      (select count(*) from public.repository_specification_phases phase
       where phase.tenant_id=item.tenant_id
         and phase.specification_id=item.specification_id)<>7
    )
  ), updated as(
    update public.repository_engineering_specifications item set
      lifecycle='failed',recovery_count=recovery_count+1,
      updated_at=now(),completed_at=null,
      specification=jsonb_set(jsonb_set(item.specification,
        '{specification,lifecycle}','"failed"'),
        '{recoveryCount}',to_jsonb(item.recovery_count+1))
    from invalid
    where item.tenant_id=invalid.tenant_id
      and item.specification_id=invalid.specification_id
    returning item.tenant_id,item.specification_id,invalid.code
  )
  insert into public.repository_specification_diagnostics(
    tenant_id,specification_id,diagnostic_position,code,severity,
    diagnostic,created_at
  ) select updated.tenant_id,updated.specification_id,
    coalesce((select max(diagnostic_position)+1
      from public.repository_specification_diagnostics diagnostic
      where diagnostic.tenant_id=updated.tenant_id
        and diagnostic.specification_id=updated.specification_id),0),
    updated.code,'warning',jsonb_build_object(
      'code',updated.code,'message',
      'Invalid specification state was fenced from reuse.',
      'severity','warning'),now()
  from updated;
  get diagnostics recovered=row_count;
  return recovered;
end; $$;

create or replace function public.repository_specification_engine_metrics(
  input_tenant_id text
) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'specificationsCreated',count(*) filter(
      where item.lifecycle in('published','partial')),
    'cacheHits',coalesce(sum(cache.hit_count),0),
    'averageOrchestrationLatencyMs',coalesce(avg(
      item.orchestration_latency_ms) filter(
        where item.lifecycle in('published','partial')),0),
    'reuseRate',case when count(*) filter(
        where item.lifecycle in('published','partial'))+
        coalesce(sum(cache.hit_count),0)=0 then 0
      else coalesce(sum(cache.hit_count),0)::double precision/
        (count(*) filter(where item.lifecycle in('published','partial'))+
         coalesce(sum(cache.hit_count),0)) end,
    'recoveryCount',coalesce(sum(item.recovery_count),0)
  )
  from public.repository_engineering_specifications item
  left join public.repository_specification_cache cache
    on cache.tenant_id=item.tenant_id
      and cache.specification_id=item.specification_id
  where input_tenant_id is null or item.tenant_id=input_tenant_id
$$;

create or replace function
  public.collect_repository_engineering_specifications(
    input_tenant_id text,input_retained_specifications integer
) returns integer
language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  insert into public.repository_specification_retention(
    tenant_id,retained_specifications
  ) values(input_tenant_id,greatest(1,input_retained_specifications))
  on conflict(tenant_id) do update set
    retained_specifications=excluded.retained_specifications,
    updated_at=now();
  with victims as(
    select specification_id
    from public.repository_engineering_specifications
    where tenant_id=input_tenant_id and lifecycle<>'published'
    order by updated_at desc,specification_id desc
    offset greatest(1,input_retained_specifications)
  )
  delete from public.repository_engineering_specifications item
  using victims
  where item.tenant_id=input_tenant_id
    and item.specification_id=victims.specification_id;
  get diagnostics removed=row_count;
  return removed;
end; $$;

create or replace function
  public.verify_repository_specification_engine_contract()
returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  foreach object_name in array array[
    'repository_engineering_specifications',
    'repository_specification_phases',
    'repository_specification_acceptance_criteria',
    'repository_specification_diagnostics',
    'repository_specification_cache',
    'repository_specification_metrics',
    'repository_specification_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity) then
      issues:=issues||to_jsonb(object_name||'_rls_missing');
    end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_specification_cache_identity_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_specification_phase_order_idx')
    or not exists(select 1 from pg_constraint
      where conname='repository_specification_phase_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_specification_snapshot_fk')
    or to_regprocedure(
      'public.recover_repository_engineering_specifications()') is null
    or to_regprocedure(
      'public.collect_repository_engineering_specifications(text,integer)')
      is null then
    issues:=issues||
      '"repository_specification_indexes_constraints_or_retention_invalid"'
        ::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_engineering_specifications','select')
    or has_table_privilege(
      'anon','public.repository_engineering_specifications','select')
    or not has_function_privilege(
      'service_role',
      'public.save_repository_engineering_specification(jsonb,text)',
      'execute')
    or has_function_privilege(
      'anon',
      'public.save_repository_engineering_specification(jsonb,text)',
      'execute') then
    issues:=issues||'"repository_specification_grants_invalid"'::jsonb;
  end if;
  return jsonb_build_object(
    'valid',jsonb_array_length(issues)=0,
    'schemaVersion','repository-engineering-specification-v1',
    'failures',issues
  );
end; $$;

do $$ declare object_name text;
begin
  foreach object_name in array array[
    'repository_engineering_specifications',
    'repository_specification_phases',
    'repository_specification_acceptance_criteria',
    'repository_specification_diagnostics',
    'repository_specification_cache',
    'repository_specification_metrics',
    'repository_specification_retention'
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
  public.get_repository_engineering_specification(text,text,text)
  from public,anon,authenticated;
revoke all on function
  public.save_repository_engineering_specification(jsonb,text)
  from public,anon,authenticated;
revoke all on function
  public.record_repository_specification_cache_hit(text,text,text)
  from public,anon,authenticated;
revoke all on function
  public.recover_repository_engineering_specifications()
  from public,anon,authenticated;
revoke all on function public.repository_specification_engine_metrics(text)
  from public,anon,authenticated;
revoke all on function
  public.collect_repository_engineering_specifications(text,integer)
  from public,anon,authenticated;
revoke all on function
  public.verify_repository_specification_engine_contract()
  from public,anon,authenticated;

grant execute on function
  public.get_repository_engineering_specification(text,text,text)
  to service_role;
grant execute on function
  public.save_repository_engineering_specification(jsonb,text)
  to service_role;
grant execute on function
  public.record_repository_specification_cache_hit(text,text,text)
  to service_role;
grant execute on function
  public.recover_repository_engineering_specifications()
  to service_role;
grant execute on function public.repository_specification_engine_metrics(text)
  to service_role;
grant execute on function
  public.collect_repository_engineering_specifications(text,integer)
  to service_role;
grant execute on function
  public.verify_repository_specification_engine_contract()
  to service_role;

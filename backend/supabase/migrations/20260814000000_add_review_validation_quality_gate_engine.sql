create table if not exists public.repository_quality_reviews (
  tenant_id text not null,
  review_id text not null,
  schema_version text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  artifact_id text not null,
  workspace_id text not null,
  execution_id text not null,
  work_unit_id text not null,
  owner_id text not null,
  reviewer_type text not null,
  review_version integer not null,
  lifecycle text not null,
  state jsonb not null,
  validation_failure_count integer not null default 0,
  recovery_count integer not null default 0,
  review_lease_expires_at timestamptz,
  decision_requested_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,review_id),
  constraint repository_quality_reviews_artifact_fk
    foreign key(tenant_id,artifact_id)
    references public.repository_proposed_artifacts(tenant_id,artifact_id)
    on delete cascade,
  constraint repository_quality_reviews_workspace_fk
    foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id)
    on delete cascade,
  constraint repository_review_schema_version_valid
    check(schema_version='repository-review-schema-v1'),
  constraint repository_review_type_valid
    check(reviewer_type in('human','agent','system')),
  constraint repository_review_lifecycle_valid check(lifecycle in(
    'created','validating','awaiting_decision','approved','changes_requested',
    'rejected','archived','expired'
  )),
  constraint repository_review_version_positive check(review_version>0),
  constraint repository_review_counts_nonnegative
    check(validation_failure_count>=0 and recovery_count>=0),
  constraint repository_review_state_object check(jsonb_typeof(state)='object'),
  constraint repository_review_identity_fenced
    unique(tenant_id,artifact_id,workspace_id,execution_id,work_unit_id,reviewer_type)
);

create table if not exists public.repository_quality_review_versions (
  tenant_id text not null,
  review_id text not null,
  review_version integer not null,
  artifact_version integer not null,
  output_hash text not null,
  verdict text not null,
  confidence double precision not null,
  metrics jsonb not null,
  review_metadata jsonb not null,
  version jsonb not null,
  created_at timestamptz not null,
  validated_at timestamptz not null,
  primary key(tenant_id,review_id,review_version),
  constraint repository_quality_review_versions_review_fk
    foreign key(tenant_id,review_id)
    references public.repository_quality_reviews(tenant_id,review_id)
    on delete cascade,
  constraint repository_review_version_numbers_positive
    check(review_version>0 and artifact_version>0),
  constraint repository_review_verdict_valid
    check(verdict in('approved','changes_requested','rejected')),
  constraint repository_review_confidence_valid
    check(confidence>=0 and confidence<=1),
  constraint repository_review_version_objects check(
    jsonb_typeof(metrics)='object'
    and jsonb_typeof(review_metadata)='object'
    and jsonb_typeof(version)='object'
  ),
  constraint repository_review_output_hash_unique
    unique(tenant_id,review_id,output_hash)
);

create table if not exists public.repository_quality_review_findings (
  tenant_id text not null,
  review_id text not null,
  review_version integer not null,
  finding_id text not null,
  severity text not null,
  category text not null,
  affected_file text,
  affected_symbol text,
  explanation text not null,
  recommendation text not null,
  finding jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,review_id,finding_id),
  constraint repository_quality_review_findings_version_fk
    foreign key(tenant_id,review_id,review_version)
    references public.repository_quality_review_versions(
      tenant_id,review_id,review_version
    ) on delete cascade,
  constraint repository_review_finding_severity_valid
    check(severity in('info','warning','error','blocker')),
  constraint repository_review_finding_category_valid check(category in(
    'schema_correctness','ownership','lifecycle','version_fencing',
    'artifact_completeness','patch_consistency','dependency_consistency',
    'symbol_consistency','path_safety','quota_validation'
  )),
  constraint repository_review_finding_object
    check(jsonb_typeof(finding)='object')
);

create table if not exists public.repository_quality_review_diagnostics (
  tenant_id text not null,
  review_id text not null,
  review_version integer not null,
  diagnostic_id text not null,
  code text not null,
  message text not null,
  severity text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,review_id,diagnostic_id),
  constraint repository_quality_review_diagnostics_version_fk
    foreign key(tenant_id,review_id,review_version)
    references public.repository_quality_review_versions(
      tenant_id,review_id,review_version
    ) on delete cascade,
  constraint repository_review_diagnostic_severity_valid
    check(severity in('warning','error')),
  constraint repository_review_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_quality_review_decisions (
  tenant_id text not null,
  review_id text not null,
  review_version integer not null,
  decision_id text not null,
  owner_id text not null,
  reviewer_id text not null,
  verdict text not null,
  rationale_codes jsonb not null,
  idempotency_key text not null,
  decision jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,review_id,decision_id),
  constraint repository_quality_review_decisions_version_fk
    foreign key(tenant_id,review_id,review_version)
    references public.repository_quality_review_versions(
      tenant_id,review_id,review_version
    ) on delete cascade,
  constraint repository_review_decision_verdict_valid
    check(verdict in('approved','changes_requested','rejected')),
  constraint repository_review_decision_codes_array
    check(jsonb_typeof(rationale_codes)='array'),
  constraint repository_review_decision_object
    check(jsonb_typeof(decision)='object'),
  constraint repository_review_decision_idempotency_unique
    unique(tenant_id,review_id,idempotency_key)
);

create table if not exists public.repository_quality_review_archives (
  tenant_id text not null,
  review_id text not null,
  archived_at timestamptz not null,
  final_review_version integer not null,
  output_hash text not null,
  reason text not null,
  metadata jsonb not null,
  primary key(tenant_id,review_id),
  constraint repository_quality_review_archives_review_fk
    foreign key(tenant_id,review_id)
    references public.repository_quality_reviews(tenant_id,review_id)
    on delete cascade,
  constraint repository_review_archive_version_positive
    check(final_review_version>0),
  constraint repository_review_archive_reason_valid
    check(reason in('manual','retention','artifact_terminal')),
  constraint repository_review_archive_metadata_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_quality_review_retention (
  tenant_id text primary key,
  retained_reviews integer not null,
  retained_versions integer not null,
  retained_findings integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_review_retention_positive check(
    retained_reviews>0 and retained_versions>0 and retained_findings>0
  )
);

create index if not exists repository_quality_reviews_artifact_idx
  on public.repository_quality_reviews(
    tenant_id,artifact_id,reviewer_type,review_version desc
  );
create index if not exists repository_quality_reviews_workspace_idx
  on public.repository_quality_reviews(
    tenant_id,workspace_id,execution_id,work_unit_id
  );
create index if not exists repository_quality_reviews_lifecycle_idx
  on public.repository_quality_reviews(
    tenant_id,owner_id,lifecycle,updated_at
  );
create index if not exists repository_quality_reviews_recovery_idx
  on public.repository_quality_reviews(
    lifecycle,review_lease_expires_at,updated_at
  );
create index if not exists repository_quality_review_versions_history_idx
  on public.repository_quality_review_versions(
    tenant_id,review_id,review_version desc
  );
create index if not exists repository_quality_review_findings_category_idx
  on public.repository_quality_review_findings(
    tenant_id,review_id,severity,category,created_at
  );
create index if not exists repository_quality_review_findings_file_idx
  on public.repository_quality_review_findings(
    tenant_id,affected_file,affected_symbol
  );
create index if not exists repository_quality_review_diagnostics_created_idx
  on public.repository_quality_review_diagnostics(
    tenant_id,review_id,created_at desc
  );
create index if not exists repository_quality_review_archives_retention_idx
  on public.repository_quality_review_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_quality_review(
  input_tenant_id text,input_review_id text
) returns table(review jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_quality_reviews
  where tenant_id=input_tenant_id and review_id=input_review_id
$$;

create or replace function public.count_repository_artifact_reviews(
  input_tenant_id text,input_artifact_id text
) returns table(review_count bigint)
language sql stable security invoker set search_path=public as $$
  select count(*) from public.repository_quality_reviews
  where tenant_id=input_tenant_id and artifact_id=input_artifact_id
$$;

create or replace function public.save_repository_quality_review(
  input_review jsonb,input_expected_version text
) returns table(review jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_quality_reviews%rowtype;
declare version_value jsonb;
declare finding_value jsonb;
declare diagnostic_value jsonb;
declare decision_value jsonb;
declare archive_value jsonb:=input_review->'archiveMetadata';
declare tenant_value text:=input_review->>'tenantId';
declare review_value text:=input_review->>'reviewId';
begin
  if jsonb_typeof(input_review)<>'object'
    or jsonb_typeof(input_review->'versions')<>'array'
    or jsonb_typeof(input_review->'findings')<>'array'
    or jsonb_typeof(input_review->'diagnostics')<>'array'
    or jsonb_typeof(input_review->'decisions')<>'array'
    or jsonb_typeof(input_review->'lifecycleHistory')<>'array'
    or jsonb_typeof(input_review->'recoveryHistory')<>'array'
    or jsonb_array_length(input_review->'versions')<1 then
    raise check_violation using message='repository_review_schema_invalid';
  end if;
  if not exists(
    select 1 from public.repository_proposed_artifacts artifact
    join public.repository_workspaces workspace
      on workspace.tenant_id=artifact.tenant_id
      and workspace.workspace_id=artifact.workspace_id
    join public.repositories repository
      on repository.repository_id=artifact.repository_id
    where artifact.tenant_id=tenant_value
      and artifact.artifact_id=input_review->>'artifactId'
      and artifact.workspace_id=input_review->>'workspaceId'
      and artifact.execution_id=input_review->>'executionId'
      and artifact.work_unit_id=input_review->>'workUnitId'
      and artifact.owner_id=input_review->>'ownerId'
      and artifact.repository_revision=input_review->>'repositoryRevision'
      and (
        (
          artifact.lifecycle in('validated','awaiting_review')
          and workspace.lifecycle in('active','validating')
        )
        or (
          input_review->>'lifecycle' in('approved','changes_requested',
            'rejected','archived','expired')
          and exists(
            select 1 from public.repository_quality_reviews prior
            where prior.tenant_id=tenant_value
              and prior.review_id=review_value
          )
        )
      )
      and repository.owner_user_id=input_review->>'ownerId'
      and repository.current_revision=input_review->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_review_inputs_stale';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||review_value,0)
  );
  select * into existing from public.repository_quality_reviews candidate
  where candidate.tenant_id=tenant_value
    and candidate.review_id=review_value for update;
  if found and (input_expected_version is null or
      (existing.state->>'persistenceVersion')::bigint
        <>input_expected_version::bigint) then
    raise serialization_failure using message='repository_review_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_review_version_conflict';
  end if;

  insert into public.repository_quality_reviews(
    tenant_id,review_id,schema_version,repository_id,repository_revision,
    artifact_id,workspace_id,execution_id,work_unit_id,owner_id,reviewer_type,
    review_version,lifecycle,state,validation_failure_count,recovery_count,
    review_lease_expires_at,decision_requested_at,created_at,updated_at,
    completed_at
  ) values(
    tenant_value,review_value,input_review->>'schemaVersion',
    input_review->>'repositoryId',input_review->>'repositoryRevision',
    input_review->>'artifactId',input_review->>'workspaceId',
    input_review->>'executionId',input_review->>'workUnitId',
    input_review->>'ownerId',input_review->>'reviewerType',
    (input_review->>'reviewVersion')::integer,input_review->>'lifecycle',
    input_review,(input_review->>'validationFailureCount')::integer,
    (input_review->>'recoveryCount')::integer,
    nullif(input_review->>'reviewLeaseExpiresAt','')::timestamptz,
    nullif(input_review->>'decisionRequestedAt','')::timestamptz,
    (input_review->>'createdAt')::timestamptz,
    (input_review->>'updatedAt')::timestamptz,
    nullif(input_review->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,review_id) do update set
    review_version=excluded.review_version,lifecycle=excluded.lifecycle,
    state=excluded.state,
    validation_failure_count=excluded.validation_failure_count,
    recovery_count=excluded.recovery_count,
    review_lease_expires_at=excluded.review_lease_expires_at,
    decision_requested_at=excluded.decision_requested_at,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at
  where repository_quality_reviews.repository_id=excluded.repository_id
    and repository_quality_reviews.repository_revision=excluded.repository_revision
    and repository_quality_reviews.artifact_id=excluded.artifact_id
    and repository_quality_reviews.workspace_id=excluded.workspace_id
    and repository_quality_reviews.execution_id=excluded.execution_id
    and repository_quality_reviews.work_unit_id=excluded.work_unit_id
    and repository_quality_reviews.owner_id=excluded.owner_id
    and repository_quality_reviews.reviewer_type=excluded.reviewer_type;
  if not found then
    raise check_violation using message='repository_review_identity_conflict';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_review->'versions')
  loop
    if version_value->'reviewMetadata'->>'schemaVersion'
        <>'repository-review-output-v1'
      or jsonb_typeof(version_value->'findings')<>'array'
      or jsonb_typeof(version_value->'diagnostics')<>'array'
      or jsonb_typeof(version_value->'metrics')<>'object' then
      raise check_violation using message='repository_review_schema_invalid';
    end if;
    insert into public.repository_quality_review_versions(
      tenant_id,review_id,review_version,artifact_version,output_hash,
      verdict,confidence,metrics,review_metadata,version,created_at,validated_at
    ) values(
      tenant_value,review_value,(version_value->>'reviewVersion')::integer,
      (version_value->>'artifactVersion')::integer,
      version_value->>'outputHash',version_value->>'verdict',
      (version_value->>'confidence')::double precision,
      version_value->'metrics',version_value->'reviewMetadata',version_value,
      (version_value->>'createdAt')::timestamptz,
      (version_value->>'validatedAt')::timestamptz
    ) on conflict(tenant_id,review_id,review_version) do nothing;
    if not found and not exists(
      select 1 from public.repository_quality_review_versions candidate
      where candidate.tenant_id=tenant_value
        and candidate.review_id=review_value
        and candidate.review_version=(version_value->>'reviewVersion')::integer
        and candidate.output_hash=version_value->>'outputHash'
    ) then
      raise check_violation using message='repository_review_version_stale';
    end if;
  end loop;

  for finding_value in
    select * from jsonb_array_elements(input_review->'findings')
  loop
    insert into public.repository_quality_review_findings(
      tenant_id,review_id,review_version,finding_id,severity,category,
      affected_file,affected_symbol,explanation,recommendation,finding,created_at
    ) values(
      tenant_value,review_value,(finding_value->>'reviewVersion')::integer,
      finding_value->>'findingId',finding_value->>'severity',
      finding_value->>'category',nullif(finding_value->>'affectedFile',''),
      nullif(finding_value->>'affectedSymbol',''),
      finding_value->>'explanation',finding_value->>'recommendation',
      finding_value,(finding_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,review_id,finding_id) do nothing;
  end loop;

  for diagnostic_value in
    select * from jsonb_array_elements(input_review->'diagnostics')
  loop
    insert into public.repository_quality_review_diagnostics(
      tenant_id,review_id,review_version,diagnostic_id,code,message,severity,
      diagnostic,created_at
    ) values(
      tenant_value,review_value,(diagnostic_value->>'reviewVersion')::integer,
      diagnostic_value->>'diagnosticId',diagnostic_value->>'code',
      diagnostic_value->>'message',diagnostic_value->>'severity',
      diagnostic_value,(diagnostic_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,review_id,diagnostic_id) do nothing;
  end loop;

  for decision_value in
    select * from jsonb_array_elements(input_review->'decisions')
  loop
    insert into public.repository_quality_review_decisions(
      tenant_id,review_id,review_version,decision_id,owner_id,reviewer_id,
      verdict,rationale_codes,idempotency_key,decision,created_at
    ) values(
      tenant_value,review_value,(decision_value->>'reviewVersion')::integer,
      decision_value->>'decisionId',decision_value->>'ownerId',
      decision_value->>'reviewerId',decision_value->>'verdict',
      decision_value->'rationaleCodes',decision_value->>'idempotencyKey',
      decision_value,(decision_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,review_id,decision_id) do nothing;
  end loop;

  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_quality_review_archives(
      tenant_id,review_id,archived_at,final_review_version,
      output_hash,reason,metadata
    ) values(
      tenant_value,review_value,(archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'finalReviewVersion')::integer,
      archive_value->>'outputHash',archive_value->>'reason',archive_value
    ) on conflict(tenant_id,review_id) do nothing;
  end if;
  return query select input_review;
end; $$;

create or replace function public.list_recoverable_repository_quality_reviews()
returns table(reviews jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,review_id),'[]'::jsonb)
  from public.repository_quality_reviews
  where lifecycle not in('approved','rejected','archived','expired')
$$;

create or replace function public.repository_quality_review_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'reviewsCreated',coalesce(sum(jsonb_array_length(state->'versions')),0),
    'approvals',coalesce(sum((
      select count(*) from jsonb_array_elements(state->'decisions') decision
      where decision->>'verdict'='approved'
    )),0),
    'rejections',coalesce(sum((
      select count(*) from jsonb_array_elements(state->'decisions') decision
      where decision->>'verdict'='rejected'
    )),0),
    'validationFailures',coalesce(sum(validation_failure_count),0),
    'blockerCount',coalesce(sum((
      select count(*) from jsonb_array_elements(state->'findings') finding
      where finding->>'severity'='blocker'
    )),0),
    'warningCount',coalesce(sum((
      select count(*) from jsonb_array_elements(state->'findings') finding
      where finding->>'severity'='warning'
    )),0),
    'reviewLatencyMs',coalesce(sum((
      select sum(greatest(0,extract(epoch from(
        (decision->>'createdAt')::timestamptz-decision_requested_at
      ))*1000))
      from jsonb_array_elements(state->'decisions') decision
      where decision_requested_at is not null
    )),0),
    'recoveryCount',coalesce(sum(recovery_count),0)
  ) from public.repository_quality_reviews candidate
  where input_tenant_id is null or candidate.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_quality_reviews(
  input_tenant_id text,input_review_retention integer,
  input_version_retention integer,input_finding_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer:=0;
begin
  insert into public.repository_quality_review_retention(
    tenant_id,retained_reviews,retained_versions,retained_findings
  ) values(
    input_tenant_id,greatest(1,input_review_retention),
    greatest(1,input_version_retention),greatest(1,input_finding_retention)
  ) on conflict(tenant_id) do update set
    retained_reviews=excluded.retained_reviews,
    retained_versions=excluded.retained_versions,
    retained_findings=excluded.retained_findings,updated_at=now();
  with ranked as(
    select tenant_id,review_id,finding_id,
      row_number() over(
        partition by tenant_id,review_id order by created_at desc,finding_id desc
      ) as position
    from public.repository_quality_review_findings
    where tenant_id=input_tenant_id
  )
  delete from public.repository_quality_review_findings finding using ranked
  where finding.tenant_id=ranked.tenant_id
    and finding.review_id=ranked.review_id
    and finding.finding_id=ranked.finding_id
    and ranked.position>greatest(1,input_finding_retention);
  get diagnostics affected=row_count;
  removed:=removed+affected;
  with victims as(
    select review_id from public.repository_quality_reviews
    where tenant_id=input_tenant_id
      and lifecycle in('approved','rejected','archived','expired')
    order by completed_at desc nulls last,review_id desc
    offset greatest(1,input_review_retention)
  )
  delete from public.repository_quality_reviews candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.review_id=victims.review_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  return query select removed;
end; $$;

create or replace function public.verify_repository_quality_review_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-review-engine-v1'
    or input_schema_version<>'repository-review-schema-v1' then
    issues:=issues||'"repository_review_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_quality_reviews','repository_quality_review_versions',
    'repository_quality_review_findings','repository_quality_review_diagnostics',
    'repository_quality_review_decisions','repository_quality_review_archives',
    'repository_quality_review_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(
      select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity
    ) then issues:=issues||to_jsonb(object_name||'_rls_missing'); end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_quality_reviews_artifact_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_quality_review_versions_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_quality_review_findings_category_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_quality_review_archives_retention_idx') then
    issues:=issues||'"repository_review_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_review_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_review_identity_fenced')
    or not exists(select 1 from pg_constraint
      where conname='repository_review_finding_severity_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_quality_reviews_artifact_fk' and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_quality_review_findings_version_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_review_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_quality_reviews','select')
    or has_table_privilege(
      'anon','public.repository_quality_reviews','select')
    or not has_function_privilege(
      'service_role','public.save_repository_quality_review(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_repository_quality_review(jsonb,text)','execute') then
    issues:=issues||'"repository_review_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_quality_reviews(text,integer,integer,integer)'
    ) is null then
    issues:=issues||'"repository_review_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'repository_quality_reviews','repository_quality_review_versions',
    'repository_quality_review_findings','repository_quality_review_diagnostics',
    'repository_quality_review_decisions','repository_quality_review_archives',
    'repository_quality_review_retention'
  ] loop
    execute format(
      'alter table public.%I enable row level security',object_name
    );
    execute format(
      'revoke all on table public.%I from public,anon,authenticated',object_name
    );
    execute format(
      'grant select,insert,update,delete on table public.%I to service_role',
      object_name
    );
  end loop;
end $$;

revoke all on function public.get_repository_quality_review(text,text)
  from public,anon,authenticated;
revoke all on function public.count_repository_artifact_reviews(text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_quality_review(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_quality_reviews()
  from public,anon,authenticated;
revoke all on function public.repository_quality_review_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_quality_reviews(
  text,integer,integer,integer
) from public,anon,authenticated;
revoke all on function public.verify_repository_quality_review_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_quality_review(text,text)
  to service_role;
grant execute on function public.count_repository_artifact_reviews(text,text)
  to service_role;
grant execute on function public.save_repository_quality_review(jsonb,text)
  to service_role;
grant execute on function public.list_recoverable_repository_quality_reviews()
  to service_role;
grant execute on function public.repository_quality_review_metrics(text)
  to service_role;
grant execute on function public.collect_repository_quality_reviews(
  text,integer,integer,integer
) to service_role;
grant execute on function public.verify_repository_quality_review_contract(text,text)
  to service_role;

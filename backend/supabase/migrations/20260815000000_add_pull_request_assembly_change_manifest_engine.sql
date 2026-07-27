create table if not exists public.repository_change_proposals (
  tenant_id text not null,
  proposal_id text not null,
  schema_version text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  execution_id text not null,
  workspace_id text not null,
  owner_id text not null,
  proposal_version integer not null,
  lifecycle text not null,
  state jsonb not null,
  validation_failure_count integer not null default 0,
  recovery_count integer not null default 0,
  assembly_lease_expires_at timestamptz,
  review_requested_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key(tenant_id,proposal_id),
  constraint repository_change_proposals_workspace_fk
    foreign key(tenant_id,workspace_id)
    references public.repository_workspaces(tenant_id,workspace_id)
    on delete cascade,
  constraint repository_proposal_schema_version_valid
    check(schema_version='repository-proposal-schema-v1'),
  constraint repository_proposal_lifecycle_valid check(lifecycle in(
    'created','assembling','validating','awaiting_review','approved','rejected',
    'archived','expired'
  )),
  constraint repository_proposal_version_positive check(proposal_version>0),
  constraint repository_proposal_counts_nonnegative
    check(validation_failure_count>=0 and recovery_count>=0),
  constraint repository_proposal_state_object check(jsonb_typeof(state)='object'),
  constraint repository_proposal_identity_fenced
    unique(tenant_id,repository_id,repository_revision,execution_id,workspace_id)
);

create table if not exists public.repository_change_proposal_versions (
  tenant_id text not null,
  proposal_id text not null,
  proposal_version integer not null,
  output_hash text not null,
  title text not null,
  summary text not null,
  detailed_description text not null,
  metrics jsonb not null,
  assembly_metadata jsonb not null,
  version jsonb not null,
  created_at timestamptz not null,
  assembled_at timestamptz not null,
  validated_at timestamptz not null,
  primary key(tenant_id,proposal_id,proposal_version),
  constraint repository_change_proposal_versions_proposal_fk
    foreign key(tenant_id,proposal_id)
    references public.repository_change_proposals(tenant_id,proposal_id)
    on delete cascade,
  constraint repository_proposal_version_number_positive
    check(proposal_version>0),
  constraint repository_proposal_version_objects check(
    jsonb_typeof(metrics)='object'
    and jsonb_typeof(assembly_metadata)='object'
    and jsonb_typeof(version)='object'
  ),
  constraint repository_proposal_output_hash_unique
    unique(tenant_id,proposal_id,output_hash)
);

create table if not exists public.repository_change_manifests (
  tenant_id text not null,
  proposal_id text not null,
  proposal_version integer not null,
  schema_version text not null,
  confidence double precision not null,
  changed_file_count integer not null,
  changed_symbol_count integer not null,
  diagnostic_count integer not null,
  manifest_bytes integer not null,
  manifest jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,proposal_id,proposal_version),
  constraint repository_change_manifests_version_fk
    foreign key(tenant_id,proposal_id,proposal_version)
    references public.repository_change_proposal_versions(
      tenant_id,proposal_id,proposal_version
    ) on delete cascade,
  constraint repository_manifest_schema_version_valid
    check(schema_version='repository-proposal-output-v1'),
  constraint repository_manifest_confidence_valid
    check(confidence>=0 and confidence<=1),
  constraint repository_manifest_counts_nonnegative check(
    changed_file_count>=0 and changed_symbol_count>=0
    and diagnostic_count>=0 and manifest_bytes>=0
  ),
  constraint repository_manifest_object check(jsonb_typeof(manifest)='object')
);

create table if not exists public.repository_change_proposal_diagnostics (
  tenant_id text not null,
  proposal_id text not null,
  proposal_version integer not null,
  diagnostic_id text not null,
  code text not null,
  severity text not null,
  source_type text not null,
  source_id text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,proposal_id,diagnostic_id),
  constraint repository_change_proposal_diagnostics_version_fk
    foreign key(tenant_id,proposal_id,proposal_version)
    references public.repository_change_proposal_versions(
      tenant_id,proposal_id,proposal_version
    ) on delete cascade,
  constraint repository_proposal_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_proposal_diagnostic_source_valid
    check(source_type in('artifact','review','patch','assembly')),
  constraint repository_proposal_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_change_proposal_decisions (
  tenant_id text not null,
  proposal_id text not null,
  proposal_version integer not null,
  decision_id text not null,
  owner_id text not null,
  reviewer_id text not null,
  verdict text not null,
  rationale_codes jsonb not null,
  idempotency_key text not null,
  decision jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,proposal_id,decision_id),
  constraint repository_change_proposal_decisions_version_fk
    foreign key(tenant_id,proposal_id,proposal_version)
    references public.repository_change_proposal_versions(
      tenant_id,proposal_id,proposal_version
    ) on delete cascade,
  constraint repository_proposal_decision_verdict_valid
    check(verdict in('approved','rejected')),
  constraint repository_proposal_decision_codes_array
    check(jsonb_typeof(rationale_codes)='array'),
  constraint repository_proposal_decision_object
    check(jsonb_typeof(decision)='object'),
  constraint repository_proposal_decision_idempotency_unique
    unique(tenant_id,proposal_id,idempotency_key)
);

create table if not exists public.repository_change_proposal_archives (
  tenant_id text not null,
  proposal_id text not null,
  archived_at timestamptz not null,
  final_proposal_version integer not null,
  output_hash text not null,
  reason text not null,
  metadata jsonb not null,
  primary key(tenant_id,proposal_id),
  constraint repository_change_proposal_archives_proposal_fk
    foreign key(tenant_id,proposal_id)
    references public.repository_change_proposals(tenant_id,proposal_id)
    on delete cascade,
  constraint repository_proposal_archive_version_positive
    check(final_proposal_version>0),
  constraint repository_proposal_archive_reason_valid
    check(reason in('manual','retention','workspace_terminal')),
  constraint repository_proposal_archive_metadata_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_change_proposal_retention (
  tenant_id text primary key,
  retained_proposals integer not null,
  retained_versions integer not null,
  retained_diagnostics integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_proposal_retention_positive check(
    retained_proposals>0 and retained_versions>0 and retained_diagnostics>0
  )
);

create index if not exists repository_change_proposals_workspace_idx
  on public.repository_change_proposals(
    tenant_id,workspace_id,execution_id,proposal_version desc
  );
create index if not exists repository_change_proposals_lifecycle_idx
  on public.repository_change_proposals(
    tenant_id,owner_id,lifecycle,updated_at
  );
create index if not exists repository_change_proposals_recovery_idx
  on public.repository_change_proposals(
    lifecycle,assembly_lease_expires_at,updated_at
  );
create index if not exists repository_change_proposal_versions_history_idx
  on public.repository_change_proposal_versions(
    tenant_id,proposal_id,proposal_version desc
  );
create index if not exists repository_change_manifests_files_idx
  on public.repository_change_manifests(
    tenant_id,changed_file_count,changed_symbol_count
  );
create index if not exists repository_change_proposal_diagnostics_created_idx
  on public.repository_change_proposal_diagnostics(
    tenant_id,proposal_id,severity,created_at desc
  );
create index if not exists repository_change_proposal_archives_retention_idx
  on public.repository_change_proposal_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_change_proposal(
  input_tenant_id text,input_proposal_id text
) returns table(proposal jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_change_proposals
  where tenant_id=input_tenant_id and proposal_id=input_proposal_id
$$;

create or replace function public.count_repository_workspace_proposals(
  input_tenant_id text,input_workspace_id text
) returns table(proposal_count bigint)
language sql stable security invoker set search_path=public as $$
  select count(*) from public.repository_change_proposals
  where tenant_id=input_tenant_id and workspace_id=input_workspace_id
$$;

create or replace function public.save_repository_change_proposal(
  input_proposal jsonb,input_expected_version text
) returns table(proposal jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_change_proposals%rowtype;
declare version_value jsonb;
declare artifact_value jsonb;
declare review_value jsonb;
declare patch_value jsonb;
declare diagnostic_value jsonb;
declare decision_value jsonb;
declare archive_value jsonb:=input_proposal->'archiveMetadata';
declare tenant_value text:=input_proposal->>'tenantId';
declare proposal_value text:=input_proposal->>'proposalId';
begin
  if jsonb_typeof(input_proposal)<>'object'
    or jsonb_typeof(input_proposal->'versions')<>'array'
    or jsonb_typeof(input_proposal->'diagnostics')<>'array'
    or jsonb_typeof(input_proposal->'decisions')<>'array'
    or jsonb_typeof(input_proposal->'lifecycleHistory')<>'array'
    or jsonb_typeof(input_proposal->'recoveryHistory')<>'array'
    or jsonb_array_length(input_proposal->'versions')<1
    or jsonb_array_length(input_proposal->'versions')
      <>(input_proposal->>'proposalVersion')::integer then
    raise check_violation using message='repository_proposal_schema_invalid';
  end if;
  if not exists(
    select 1 from public.repository_workspaces workspace
    join public.repositories repository
      on repository.repository_id=workspace.repository_id
    where workspace.tenant_id=tenant_value
      and workspace.workspace_id=input_proposal->>'workspaceId'
      and workspace.execution_id=input_proposal->>'executionId'
      and workspace.owner_id=input_proposal->>'ownerId'
      and workspace.repository_revision=input_proposal->>'repositoryRevision'
      and (
        workspace.lifecycle in('active','validating')
        or (
          input_proposal->>'lifecycle' in(
            'approved','rejected','archived','expired'
          )
          and exists(
            select 1 from public.repository_change_proposals prior
            where prior.tenant_id=tenant_value
              and prior.proposal_id=proposal_value
          )
        )
      )
      and repository.owner_user_id=input_proposal->>'ownerId'
      and repository.current_revision=input_proposal->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message='repository_proposal_inputs_stale';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_proposal->'versions')
  loop
    if version_value->'assemblyMetadata'->>'schemaVersion'
        <>'repository-proposal-output-v1'
      or jsonb_typeof(version_value->'manifest')<>'object'
      or jsonb_typeof(version_value->'diagnostics')<>'array'
      or jsonb_typeof(version_value->'metrics')<>'object'
      or jsonb_typeof(
        version_value->'assemblyMetadata'->'artifactVersions'
      )<>'array'
      or jsonb_typeof(
        version_value->'assemblyMetadata'->'reviewVersions'
      )<>'array'
      or jsonb_typeof(
        version_value->'assemblyMetadata'->'patchVersions'
      )<>'array'
      or jsonb_array_length(
        version_value->'assemblyMetadata'->'artifactVersions'
      )<1
      or jsonb_array_length(
        version_value->'assemblyMetadata'->'reviewVersions'
      )<1
      or jsonb_array_length(
        version_value->'assemblyMetadata'->'patchVersions'
      )<1
      or jsonb_typeof(version_value->'artifactReferences')<>'array'
      or jsonb_typeof(version_value->'reviewReferences')<>'array'
      or jsonb_typeof(version_value->'manifest'->'changedFiles')<>'array'
      or jsonb_typeof(version_value->'manifest'->'changedSymbols')<>'array'
      or jsonb_typeof(
        version_value->'manifest'->'validationSummary'
      )<>'object'
      or version_value->'manifest'->'validationSummary'->>'valid'<>'true' then
      raise check_violation using message='repository_proposal_schema_invalid';
    end if;
    for artifact_value in select * from jsonb_array_elements(
      version_value->'assemblyMetadata'->'artifactVersions'
    ) loop
      if not exists(
        select 1 from public.repository_proposed_artifacts artifact
        where artifact.tenant_id=tenant_value
          and artifact.artifact_id=artifact_value->>'artifactId'
          and artifact.workspace_id=input_proposal->>'workspaceId'
          and artifact.execution_id=input_proposal->>'executionId'
          and artifact.owner_id=input_proposal->>'ownerId'
          and artifact.repository_revision=
            input_proposal->>'repositoryRevision'
          and artifact.lifecycle='approved'
          and artifact.artifact_version=
            (artifact_value->>'artifactVersion')::integer
          and artifact.state->'versions'->-1->>'contentHash'=
            artifact_value->>'contentHash'
      ) then
        raise check_violation using message='repository_proposal_artifact_stale';
      end if;
    end loop;
    for review_value in select * from jsonb_array_elements(
      version_value->'assemblyMetadata'->'reviewVersions'
    ) loop
      if not exists(
        select 1 from public.repository_quality_reviews review
        where review.tenant_id=tenant_value
          and review.review_id=review_value->>'reviewId'
          and review.workspace_id=input_proposal->>'workspaceId'
          and review.execution_id=input_proposal->>'executionId'
          and review.owner_id=input_proposal->>'ownerId'
          and review.repository_revision=input_proposal->>'repositoryRevision'
          and review.lifecycle='approved'
          and review.review_version=(review_value->>'reviewVersion')::integer
          and review.state->'versions'->-1->>'outputHash'=
            review_value->>'outputHash'
      ) then
        raise check_violation using message='repository_proposal_review_stale';
      end if;
    end loop;
    for patch_value in select * from jsonb_array_elements(
      version_value->'assemblyMetadata'->'patchVersions'
    ) loop
      if not exists(
        select 1 from public.repository_workspaces workspace,
          jsonb_array_elements(workspace.state->'patches') patch
        where workspace.tenant_id=tenant_value
          and workspace.workspace_id=input_proposal->>'workspaceId'
          and patch->>'patchId'=patch_value->>'patchId'
          and (patch->>'patchVersion')::integer=
            (patch_value->>'patchVersion')::integer
          and patch->>'contentHash'=patch_value->>'contentHash'
      ) then
        raise check_violation using message='repository_proposal_patch_stale';
      end if;
    end loop;
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||proposal_value,0)
  );
  select * into existing from public.repository_change_proposals candidate
  where candidate.tenant_id=tenant_value
    and candidate.proposal_id=proposal_value for update;
  if found and (input_expected_version is null or
      (existing.state->>'persistenceVersion')::bigint
        <>input_expected_version::bigint) then
    raise serialization_failure using message='repository_proposal_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message='repository_proposal_version_conflict';
  end if;

  insert into public.repository_change_proposals(
    tenant_id,proposal_id,schema_version,repository_id,repository_revision,
    execution_id,workspace_id,owner_id,proposal_version,lifecycle,state,
    validation_failure_count,recovery_count,assembly_lease_expires_at,
    review_requested_at,created_at,updated_at,completed_at
  ) values(
    tenant_value,proposal_value,input_proposal->>'schemaVersion',
    input_proposal->>'repositoryId',input_proposal->>'repositoryRevision',
    input_proposal->>'executionId',input_proposal->>'workspaceId',
    input_proposal->>'ownerId',
    (input_proposal->>'proposalVersion')::integer,
    input_proposal->>'lifecycle',input_proposal,
    (input_proposal->>'validationFailureCount')::integer,
    (input_proposal->>'recoveryCount')::integer,
    nullif(input_proposal->>'assemblyLeaseExpiresAt','')::timestamptz,
    nullif(input_proposal->>'reviewRequestedAt','')::timestamptz,
    (input_proposal->>'createdAt')::timestamptz,
    (input_proposal->>'updatedAt')::timestamptz,
    nullif(input_proposal->>'completedAt','')::timestamptz
  ) on conflict(tenant_id,proposal_id) do update set
    proposal_version=excluded.proposal_version,lifecycle=excluded.lifecycle,
    state=excluded.state,
    validation_failure_count=excluded.validation_failure_count,
    recovery_count=excluded.recovery_count,
    assembly_lease_expires_at=excluded.assembly_lease_expires_at,
    review_requested_at=excluded.review_requested_at,
    updated_at=excluded.updated_at,completed_at=excluded.completed_at
  where repository_change_proposals.repository_id=excluded.repository_id
    and repository_change_proposals.repository_revision=
      excluded.repository_revision
    and repository_change_proposals.execution_id=excluded.execution_id
    and repository_change_proposals.workspace_id=excluded.workspace_id
    and repository_change_proposals.owner_id=excluded.owner_id;
  if not found then
    raise check_violation using message='repository_proposal_identity_conflict';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_proposal->'versions')
  loop
    insert into public.repository_change_proposal_versions(
      tenant_id,proposal_id,proposal_version,output_hash,title,summary,
      detailed_description,metrics,assembly_metadata,version,created_at,
      assembled_at,validated_at
    ) values(
      tenant_value,proposal_value,
      (version_value->>'proposalVersion')::integer,
      version_value->>'outputHash',version_value->>'title',
      version_value->>'summary',version_value->>'detailedDescription',
      version_value->'metrics',version_value->'assemblyMetadata',version_value,
      (version_value->>'createdAt')::timestamptz,
      (version_value->>'assembledAt')::timestamptz,
      (version_value->>'validatedAt')::timestamptz
    ) on conflict(tenant_id,proposal_id,proposal_version) do nothing;
    if not found and not exists(
      select 1 from public.repository_change_proposal_versions candidate
      where candidate.tenant_id=tenant_value
        and candidate.proposal_id=proposal_value
        and candidate.proposal_version=
          (version_value->>'proposalVersion')::integer
        and candidate.output_hash=version_value->>'outputHash'
    ) then
      raise check_violation using message='repository_proposal_version_stale';
    end if;
    insert into public.repository_change_manifests(
      tenant_id,proposal_id,proposal_version,schema_version,confidence,
      changed_file_count,changed_symbol_count,diagnostic_count,manifest_bytes,
      manifest,created_at
    ) values(
      tenant_value,proposal_value,
      (version_value->>'proposalVersion')::integer,
      version_value->'manifest'->>'schemaVersion',
      (version_value->'manifest'->>'confidence')::double precision,
      (version_value->'metrics'->>'changedFileCount')::integer,
      (version_value->'metrics'->>'changedSymbolCount')::integer,
      (version_value->'metrics'->>'diagnosticCount')::integer,
      (version_value->'metrics'->>'manifestBytes')::integer,
      version_value->'manifest',
      (version_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,proposal_id,proposal_version) do nothing;
  end loop;

  for diagnostic_value in
    select * from jsonb_array_elements(input_proposal->'diagnostics')
  loop
    insert into public.repository_change_proposal_diagnostics(
      tenant_id,proposal_id,proposal_version,diagnostic_id,code,severity,
      source_type,source_id,diagnostic,created_at
    ) values(
      tenant_value,proposal_value,
      (diagnostic_value->>'proposalVersion')::integer,
      diagnostic_value->>'diagnosticId',diagnostic_value->>'code',
      diagnostic_value->>'severity',diagnostic_value->>'sourceType',
      diagnostic_value->>'sourceId',diagnostic_value,
      (diagnostic_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,proposal_id,diagnostic_id) do nothing;
  end loop;

  for decision_value in
    select * from jsonb_array_elements(input_proposal->'decisions')
  loop
    insert into public.repository_change_proposal_decisions(
      tenant_id,proposal_id,proposal_version,decision_id,owner_id,reviewer_id,
      verdict,rationale_codes,idempotency_key,decision,created_at
    ) values(
      tenant_value,proposal_value,
      (decision_value->>'proposalVersion')::integer,
      decision_value->>'decisionId',decision_value->>'ownerId',
      decision_value->>'reviewerId',decision_value->>'verdict',
      decision_value->'rationaleCodes',decision_value->>'idempotencyKey',
      decision_value,(decision_value->>'createdAt')::timestamptz
    ) on conflict(tenant_id,proposal_id,decision_id) do nothing;
  end loop;

  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_change_proposal_archives(
      tenant_id,proposal_id,archived_at,final_proposal_version,
      output_hash,reason,metadata
    ) values(
      tenant_value,proposal_value,
      (archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'finalProposalVersion')::integer,
      archive_value->>'outputHash',archive_value->>'reason',archive_value
    ) on conflict(tenant_id,proposal_id) do nothing;
  end if;
  return query select input_proposal;
end; $$;

create or replace function public.list_recoverable_repository_change_proposals()
returns table(proposals jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(jsonb_agg(state order by updated_at,proposal_id),'[]'::jsonb)
  from public.repository_change_proposals
  where lifecycle not in('approved','rejected','archived','expired')
$$;

create or replace function public.repository_change_proposal_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'proposalsAssembled',coalesce(sum(jsonb_array_length(state->'versions')),0),
    'validationFailures',coalesce(sum(validation_failure_count),0),
    'rejectedProposals',coalesce(sum((
      select count(*) from jsonb_array_elements(state->'decisions') decision
      where decision->>'verdict'='rejected'
    )),0),
    'manifestSize',coalesce(sum((
      select sum((version->'metrics'->>'manifestBytes')::bigint)
      from jsonb_array_elements(state->'versions') version
    )),0),
    'diagnosticsCount',coalesce(sum(jsonb_array_length(state->'diagnostics')),0),
    'assemblyLatencyMs',coalesce(sum((
      select sum(
        (version->'assemblyMetadata'->>'assemblyLatencyMs')::double precision
      ) from jsonb_array_elements(state->'versions') version
    )),0),
    'recoveryCount',coalesce(sum(recovery_count),0)
  ) from public.repository_change_proposals candidate
  where input_tenant_id is null or candidate.tenant_id=input_tenant_id
$$;

create or replace function public.collect_repository_change_proposals(
  input_tenant_id text,input_proposal_retention integer,
  input_version_retention integer,input_diagnostic_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer:=0;
begin
  insert into public.repository_change_proposal_retention(
    tenant_id,retained_proposals,retained_versions,retained_diagnostics
  ) values(
    input_tenant_id,greatest(1,input_proposal_retention),
    greatest(1,input_version_retention),
    greatest(1,input_diagnostic_retention)
  ) on conflict(tenant_id) do update set
    retained_proposals=excluded.retained_proposals,
    retained_versions=excluded.retained_versions,
    retained_diagnostics=excluded.retained_diagnostics,updated_at=now();
  with ranked as(
    select tenant_id,proposal_id,diagnostic_id,
      row_number() over(
        partition by tenant_id,proposal_id
        order by created_at desc,diagnostic_id desc
      ) as position
    from public.repository_change_proposal_diagnostics
    where tenant_id=input_tenant_id
  )
  delete from public.repository_change_proposal_diagnostics diagnostic
  using ranked
  where diagnostic.tenant_id=ranked.tenant_id
    and diagnostic.proposal_id=ranked.proposal_id
    and diagnostic.diagnostic_id=ranked.diagnostic_id
    and ranked.position>greatest(1,input_diagnostic_retention);
  get diagnostics affected=row_count;
  removed:=removed+affected;
  with victims as(
    select proposal_id from public.repository_change_proposals
    where tenant_id=input_tenant_id
      and lifecycle in('approved','rejected','archived','expired')
    order by completed_at desc nulls last,proposal_id desc
    offset greatest(1,input_proposal_retention)
  )
  delete from public.repository_change_proposals candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.proposal_id=victims.proposal_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  return query select removed;
end; $$;

create or replace function public.verify_repository_change_proposal_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-proposal-engine-v1'
    or input_schema_version<>'repository-proposal-schema-v1' then
    issues:=issues||'"repository_proposal_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_change_proposals','repository_change_proposal_versions',
    'repository_change_manifests','repository_change_proposal_diagnostics',
    'repository_change_proposal_decisions',
    'repository_change_proposal_archives',
    'repository_change_proposal_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(
      select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity
    ) then issues:=issues||to_jsonb(object_name||'_rls_missing'); end if;
  end loop;
  if not exists(select 1 from pg_indexes
      where indexname='repository_change_proposals_workspace_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_change_proposal_versions_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_change_manifests_files_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_change_proposal_archives_retention_idx') then
    issues:=issues||'"repository_proposal_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_proposal_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_proposal_identity_fenced')
    or not exists(select 1 from pg_constraint
      where conname='repository_manifest_schema_version_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_change_proposals_workspace_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_change_manifests_version_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_proposal_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_change_proposals','select')
    or has_table_privilege(
      'anon','public.repository_change_proposals','select')
    or not has_function_privilege(
      'service_role','public.save_repository_change_proposal(jsonb,text)',
      'execute')
    or has_function_privilege(
      'anon','public.save_repository_change_proposal(jsonb,text)','execute') then
    issues:=issues||'"repository_proposal_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_change_proposals(text,integer,integer,integer)'
    ) is null then
    issues:=issues||'"repository_proposal_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'repository_change_proposals','repository_change_proposal_versions',
    'repository_change_manifests','repository_change_proposal_diagnostics',
    'repository_change_proposal_decisions',
    'repository_change_proposal_archives',
    'repository_change_proposal_retention'
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

revoke all on function public.get_repository_change_proposal(text,text)
  from public,anon,authenticated;
revoke all on function public.count_repository_workspace_proposals(text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_change_proposal(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_change_proposals()
  from public,anon,authenticated;
revoke all on function public.repository_change_proposal_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_change_proposals(
  text,integer,integer,integer
) from public,anon,authenticated;
revoke all on function public.verify_repository_change_proposal_contract(
  text,text
) from public,anon,authenticated;

grant execute on function public.get_repository_change_proposal(text,text)
  to service_role;
grant execute on function public.count_repository_workspace_proposals(text,text)
  to service_role;
grant execute on function public.save_repository_change_proposal(jsonb,text)
  to service_role;
grant execute on function public.list_recoverable_repository_change_proposals()
  to service_role;
grant execute on function public.repository_change_proposal_metrics(text)
  to service_role;
grant execute on function public.collect_repository_change_proposals(
  text,integer,integer,integer
) to service_role;
grant execute on function public.verify_repository_change_proposal_contract(
  text,text
) to service_role;

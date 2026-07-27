create table if not exists public.repository_knowledge_namespaces (
  namespace text primary key,
  ordinal integer not null unique,
  created_at timestamptz not null default now(),
  constraint repository_knowledge_namespace_value_valid check(namespace in(
    'architecture','repository','implementation','patterns','conventions',
    'dependencies','testing','documentation','reviews','diagnostics'
  )),
  constraint repository_knowledge_namespace_ordinal_positive check(ordinal>0)
);

insert into public.repository_knowledge_namespaces(namespace,ordinal) values
  ('architecture',1),('repository',2),('implementation',3),('patterns',4),
  ('conventions',5),('dependencies',6),('testing',7),('documentation',8),
  ('reviews',9),('diagnostics',10)
on conflict(namespace) do update set ordinal=excluded.ordinal;

create table if not exists public.repository_knowledge (
  tenant_id text not null,
  knowledge_id text not null,
  schema_version text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  namespace text not null
    references public.repository_knowledge_namespaces(namespace),
  subject text not null,
  content_hash text not null,
  source_type text not null,
  confidence double precision not null,
  knowledge_version integer not null,
  lifecycle text not null,
  owner_id text not null,
  state jsonb not null,
  write_lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(tenant_id,knowledge_id),
  constraint repository_knowledge_schema_version_valid
    check(schema_version='repository-knowledge-schema-v1'),
  constraint repository_knowledge_source_type_valid check(source_type in(
    'repository_graph','intelligence','planning','execution','review',
    'proposal','diagnostics'
  )),
  constraint repository_knowledge_lifecycle_valid check(lifecycle in(
    'created','validated','active','superseded','archived','expired'
  )),
  constraint repository_knowledge_confidence_valid
    check(confidence>=0 and confidence<=1),
  constraint repository_knowledge_version_positive check(knowledge_version>0),
  constraint repository_knowledge_subject_nonempty check(length(subject)>0),
  constraint repository_knowledge_content_hash_valid
    check(content_hash~'^[a-f0-9]{64}$'),
  constraint repository_knowledge_state_object
    check(jsonb_typeof(state)='object'),
  constraint repository_knowledge_identity_fenced
    unique(tenant_id,repository_id,namespace,subject)
);

create table if not exists public.repository_knowledge_versions (
  tenant_id text not null,
  knowledge_id text not null,
  knowledge_version integer not null,
  content_hash text not null,
  confidence double precision not null,
  execution_id text,
  deterministic_seed text not null,
  content jsonb not null,
  version jsonb not null,
  created_at timestamptz not null,
  validated_at timestamptz not null,
  activated_at timestamptz not null,
  primary key(tenant_id,knowledge_id,knowledge_version),
  constraint repository_knowledge_versions_entry_fk
    foreign key(tenant_id,knowledge_id)
    references public.repository_knowledge(tenant_id,knowledge_id)
    on delete cascade,
  constraint repository_knowledge_versions_number_positive
    check(knowledge_version>0),
  constraint repository_knowledge_versions_confidence_valid
    check(confidence>=0 and confidence<=1),
  constraint repository_knowledge_versions_hash_valid
    check(content_hash~'^[a-f0-9]{64}$'),
  constraint repository_knowledge_versions_content_object
    check(jsonb_typeof(content)='object' and jsonb_typeof(version)='object'),
  constraint repository_knowledge_versions_hash_unique
    unique(tenant_id,knowledge_id,content_hash)
);

create table if not exists public.repository_knowledge_sources (
  tenant_id text not null,
  knowledge_id text not null,
  knowledge_version integer not null,
  source_id text not null,
  source_type text not null,
  source_version text not null,
  source_content_hash text not null,
  execution_id text,
  published_at timestamptz not null,
  source jsonb not null,
  primary key(
    tenant_id,knowledge_id,knowledge_version,source_type,source_id,source_version
  ),
  constraint repository_knowledge_sources_version_fk
    foreign key(tenant_id,knowledge_id,knowledge_version)
    references public.repository_knowledge_versions(
      tenant_id,knowledge_id,knowledge_version
    ) on delete cascade,
  constraint repository_knowledge_sources_type_valid check(source_type in(
    'repository_graph','intelligence','planning','execution','review',
    'proposal','diagnostics'
  )),
  constraint repository_knowledge_sources_hash_valid
    check(source_content_hash~'^[a-f0-9]{64}$'),
  constraint repository_knowledge_sources_object
    check(jsonb_typeof(source)='object')
);

create table if not exists public.repository_knowledge_diagnostics (
  tenant_id text not null,
  knowledge_id text not null,
  knowledge_version integer not null,
  diagnostic_id text not null,
  severity text not null,
  code text not null,
  diagnostic jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,knowledge_id,diagnostic_id),
  constraint repository_knowledge_diagnostics_version_fk
    foreign key(tenant_id,knowledge_id,knowledge_version)
    references public.repository_knowledge_versions(
      tenant_id,knowledge_id,knowledge_version
    ) on delete cascade,
  constraint repository_knowledge_diagnostic_severity_valid
    check(severity in('info','warning','error')),
  constraint repository_knowledge_diagnostic_object
    check(jsonb_typeof(diagnostic)='object')
);

create table if not exists public.repository_knowledge_supersessions (
  tenant_id text not null,
  knowledge_id text not null,
  supersession_id text not null,
  superseded_version integer not null,
  active_version integer not null,
  reason text not null,
  metadata jsonb not null,
  created_at timestamptz not null,
  primary key(tenant_id,knowledge_id,supersession_id),
  constraint repository_knowledge_supersessions_entry_fk
    foreign key(tenant_id,knowledge_id)
    references public.repository_knowledge(tenant_id,knowledge_id)
    on delete cascade,
  constraint repository_knowledge_supersession_order_valid
    check(active_version=superseded_version+1),
  constraint repository_knowledge_supersession_reason_valid
    check(reason in('evolved','deterministic_merge')),
  constraint repository_knowledge_supersession_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_agent_memory (
  tenant_id text not null,
  memory_id text not null,
  schema_version text not null,
  owner_id text not null,
  agent_id text not null,
  runtime_version text not null,
  repository_id text not null
    references public.repositories(repository_id) on delete cascade,
  repository_revision text not null,
  execution_id text not null,
  knowledge_id text not null,
  knowledge_version integer not null,
  memory_scope text not null,
  confidence double precision not null,
  retrieval_metadata jsonb not null,
  content_hash text not null,
  memory jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz,
  primary key(tenant_id,memory_id),
  constraint repository_agent_memory_knowledge_fk
    foreign key(tenant_id,knowledge_id,knowledge_version)
    references public.repository_knowledge_versions(
      tenant_id,knowledge_id,knowledge_version
    ) on delete cascade,
  constraint repository_agent_memory_schema_version_valid
    check(schema_version='repository-agent-memory-v1'),
  constraint repository_agent_memory_scope_valid
    check(memory_scope in('repository','execution','agent')),
  constraint repository_agent_memory_confidence_valid
    check(confidence>=0 and confidence<=1),
  constraint repository_agent_memory_hash_valid
    check(content_hash~'^[a-f0-9]{64}$'),
  constraint repository_agent_memory_objects check(
    jsonb_typeof(retrieval_metadata)='object'
    and jsonb_typeof(memory)='object'
  )
);

create table if not exists public.repository_knowledge_memory_expirations (
  tenant_id text not null,
  memory_id text not null,
  expiration_id text not null,
  reason text not null,
  created_at timestamptz not null,
  primary key(tenant_id,memory_id),
  constraint repository_knowledge_memory_expirations_memory_fk
    foreign key(tenant_id,memory_id)
    references public.repository_agent_memory(tenant_id,memory_id)
    on delete cascade,
  constraint repository_knowledge_memory_expiration_reason_valid
    check(reason='expired')
);

create table if not exists public.repository_knowledge_archives (
  tenant_id text not null,
  knowledge_id text not null,
  archived_at timestamptz not null,
  final_version integer not null,
  content_hash text not null,
  reason text not null,
  metadata jsonb not null,
  primary key(tenant_id,knowledge_id),
  constraint repository_knowledge_archives_entry_fk
    foreign key(tenant_id,knowledge_id)
    references public.repository_knowledge(tenant_id,knowledge_id)
    on delete cascade,
  constraint repository_knowledge_archive_version_positive
    check(final_version>0),
  constraint repository_knowledge_archive_reason_valid
    check(reason in('manual','retention','expired')),
  constraint repository_knowledge_archive_object
    check(jsonb_typeof(metadata)='object')
);

create table if not exists public.repository_knowledge_retention (
  tenant_id text primary key,
  retained_entries integer not null,
  retained_versions integer not null,
  retained_memories integer not null,
  updated_at timestamptz not null default now(),
  constraint repository_knowledge_retention_positive check(
    retained_entries>0 and retained_versions>0 and retained_memories>0
  )
);

create index if not exists repository_knowledge_retrieval_idx
  on public.repository_knowledge(
    tenant_id,repository_id,namespace,lifecycle,confidence desc,
    knowledge_version desc,subject,knowledge_id
  );
create index if not exists repository_knowledge_revision_idx
  on public.repository_knowledge(
    tenant_id,repository_id,repository_revision,owner_id,lifecycle
  );
create index if not exists repository_knowledge_recovery_idx
  on public.repository_knowledge(
    lifecycle,write_lease_expires_at,updated_at
  );
create index if not exists repository_knowledge_versions_history_idx
  on public.repository_knowledge_versions(
    tenant_id,knowledge_id,knowledge_version desc
  );
create index if not exists repository_knowledge_sources_publication_idx
  on public.repository_knowledge_sources(
    tenant_id,source_type,source_id,source_version,published_at
  );
create index if not exists repository_agent_memory_retrieval_idx
  on public.repository_agent_memory(
    tenant_id,repository_id,execution_id,agent_id,memory_scope,created_at desc
  );
create index if not exists repository_agent_memory_expiration_idx
  on public.repository_agent_memory(expires_at) where expires_at is not null;
create index if not exists repository_knowledge_archives_retention_idx
  on public.repository_knowledge_archives(tenant_id,archived_at desc);

create or replace function public.get_repository_knowledge_entry(
  input_tenant_id text,input_knowledge_id text
) returns table(entry jsonb)
language sql stable security invoker set search_path=public as $$
  select state from public.repository_knowledge
  where tenant_id=input_tenant_id and knowledge_id=input_knowledge_id
$$;

create or replace function public.list_repository_knowledge_entries(
  input_tenant_id text default null,input_repository_id text default null
) returns table(entries jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(
    jsonb_agg(state order by namespace,subject,knowledge_id),'[]'::jsonb
  ) from public.repository_knowledge candidate
  where (input_tenant_id is null or candidate.tenant_id=input_tenant_id)
    and (
      input_repository_id is null
      or candidate.repository_id=input_repository_id
    )
$$;

create or replace function public.save_repository_knowledge_entry(
  input_entry jsonb,input_expected_version text
) returns table(entry jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing public.repository_knowledge%rowtype;
declare version_value jsonb;
declare source_value jsonb;
declare diagnostic_value jsonb;
declare supersession_value jsonb;
declare archive_value jsonb:=input_entry->'archiveMetadata';
declare tenant_value text:=input_entry->>'tenantId';
declare knowledge_value text:=input_entry->>'knowledgeId';
begin
  if jsonb_typeof(input_entry)<>'object'
    or input_entry->>'schemaVersion'<>'repository-knowledge-schema-v1'
    or jsonb_typeof(input_entry->'versions')<>'array'
    or jsonb_typeof(input_entry->'supersessions')<>'array'
    or jsonb_typeof(input_entry->'lifecycleHistory')<>'array'
    or jsonb_typeof(input_entry->'recoveryHistory')<>'array'
    or jsonb_array_length(input_entry->'versions')<1
    or jsonb_array_length(input_entry->'versions')
      <>(input_entry->>'version')::integer then
    raise check_violation using message='repository_knowledge_schema_invalid';
  end if;
  if not exists(
    select 1 from public.repositories repository
    where repository.repository_id=input_entry->>'repositoryId'
      and repository.owner_user_id=input_entry->>'ownerId'
      and repository.current_revision=input_entry->>'repositoryRevision'
      and repository.deletion_state='active'
  ) then
    raise check_violation using message=
      'repository_knowledge_ownership_or_revision_conflict';
  end if;
  for version_value in
    select * from jsonb_array_elements(input_entry->'versions')
  loop
    if jsonb_typeof(version_value->'content')<>'object'
      or version_value->'content'->>'schemaVersion'
        <>'repository-knowledge-schema-v1'
      or jsonb_typeof(version_value->'content'->'facts')<>'array'
      or jsonb_typeof(version_value->'content'->'tags')<>'array'
      or jsonb_typeof(version_value->'sourceReferences')<>'array'
      or jsonb_array_length(version_value->'sourceReferences')<1
      or jsonb_typeof(version_value->'diagnostics')<>'array'
      or (version_value->>'version')::integer<1 then
      raise check_violation using message='repository_knowledge_schema_invalid';
    end if;
    for source_value in
      select * from jsonb_array_elements(version_value->'sourceReferences')
    loop
      if source_value->>'published'<>'true'
        or source_value->>'publishedAt' is null
        or source_value->>'repositoryId'<>input_entry->>'repositoryId'
        or source_value->>'repositoryRevision'
          <>input_entry->>'repositoryRevision'
        or source_value->>'sourceType' not in(
          'repository_graph','intelligence','planning','execution','review',
          'proposal','diagnostics'
        ) then
        raise check_violation using message=
          'repository_knowledge_source_unpublished';
      end if;
    end loop;
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_value||'|'||knowledge_value,0)
  );
  select * into existing from public.repository_knowledge candidate
  where candidate.tenant_id=tenant_value
    and candidate.knowledge_id=knowledge_value for update;
  if found and (
      input_expected_version is null
      or (existing.state->>'persistenceVersion')::bigint
        <>input_expected_version::bigint
    ) then
    raise serialization_failure using message=
      'repository_knowledge_version_conflict';
  elsif not found and input_expected_version is not null then
    raise serialization_failure using message=
      'repository_knowledge_version_conflict';
  end if;

  insert into public.repository_knowledge(
    tenant_id,knowledge_id,schema_version,repository_id,
    repository_revision,namespace,subject,content_hash,source_type,
    confidence,knowledge_version,lifecycle,owner_id,state,
    write_lease_expires_at,created_at,updated_at
  ) values(
    tenant_value,knowledge_value,input_entry->>'schemaVersion',
    input_entry->>'repositoryId',input_entry->>'repositoryRevision',
    input_entry->>'namespace',input_entry->>'subject',
    input_entry->>'contentHash',input_entry->>'sourceType',
    (input_entry->>'confidence')::double precision,
    (input_entry->>'version')::integer,input_entry->>'lifecycle',
    input_entry->>'ownerId',input_entry,
    nullif(input_entry->>'writeLeaseExpiresAt','')::timestamptz,
    (input_entry->>'createdAt')::timestamptz,
    (input_entry->>'updatedAt')::timestamptz
  ) on conflict(tenant_id,knowledge_id) do update set
    content_hash=excluded.content_hash,
    source_type=excluded.source_type,confidence=excluded.confidence,
    knowledge_version=excluded.knowledge_version,
    lifecycle=excluded.lifecycle,state=excluded.state,
    write_lease_expires_at=excluded.write_lease_expires_at,
    updated_at=excluded.updated_at
  where repository_knowledge.repository_id=excluded.repository_id
    and repository_knowledge.repository_revision=
      excluded.repository_revision
    and repository_knowledge.namespace=excluded.namespace
    and repository_knowledge.subject=excluded.subject
    and repository_knowledge.owner_id=excluded.owner_id;
  if not found then
    raise check_violation using message=
      'repository_knowledge_identity_conflict';
  end if;

  for version_value in
    select * from jsonb_array_elements(input_entry->'versions')
  loop
    insert into public.repository_knowledge_versions(
      tenant_id,knowledge_id,knowledge_version,content_hash,confidence,
      execution_id,deterministic_seed,content,version,created_at,
      validated_at,activated_at
    ) values(
      tenant_value,knowledge_value,(version_value->>'version')::integer,
      version_value->>'contentHash',
      (version_value->>'confidence')::double precision,
      nullif(version_value->>'executionId',''),
      version_value->>'deterministicSeed',version_value->'content',
      version_value,(version_value->>'createdAt')::timestamptz,
      (version_value->>'validatedAt')::timestamptz,
      (version_value->>'activatedAt')::timestamptz
    ) on conflict(tenant_id,knowledge_id,knowledge_version) do nothing;
    if not found and not exists(
      select 1 from public.repository_knowledge_versions candidate
      where candidate.tenant_id=tenant_value
        and candidate.knowledge_id=knowledge_value
        and candidate.knowledge_version=
          (version_value->>'version')::integer
        and candidate.content_hash=version_value->>'contentHash'
        and candidate.version=version_value
    ) then
      raise check_violation using message=
        'repository_knowledge_immutable_history_conflict';
    end if;
    for source_value in
      select * from jsonb_array_elements(version_value->'sourceReferences')
    loop
      insert into public.repository_knowledge_sources(
        tenant_id,knowledge_id,knowledge_version,source_id,source_type,
        source_version,source_content_hash,execution_id,published_at,source
      ) values(
        tenant_value,knowledge_value,(version_value->>'version')::integer,
        source_value->>'sourceId',source_value->>'sourceType',
        source_value->>'sourceVersion',source_value->>'contentHash',
        nullif(source_value->>'executionId',''),
        (source_value->>'publishedAt')::timestamptz,source_value
      ) on conflict do nothing;
    end loop;
    for diagnostic_value in
      select * from jsonb_array_elements(version_value->'diagnostics')
    loop
      insert into public.repository_knowledge_diagnostics(
        tenant_id,knowledge_id,knowledge_version,diagnostic_id,severity,
        code,diagnostic,created_at
      ) values(
        tenant_value,knowledge_value,(version_value->>'version')::integer,
        diagnostic_value->>'diagnosticId',
        diagnostic_value->>'severity',diagnostic_value->>'code',
        diagnostic_value,(diagnostic_value->>'createdAt')::timestamptz
      ) on conflict do nothing;
    end loop;
  end loop;
  for supersession_value in
    select * from jsonb_array_elements(input_entry->'supersessions')
  loop
    insert into public.repository_knowledge_supersessions(
      tenant_id,knowledge_id,supersession_id,superseded_version,
      active_version,reason,metadata,created_at
    ) values(
      tenant_value,knowledge_value,
      supersession_value->>'supersessionId',
      (supersession_value->>'supersededVersion')::integer,
      (supersession_value->>'activeVersion')::integer,
      supersession_value->>'reason',supersession_value,
      (supersession_value->>'createdAt')::timestamptz
    ) on conflict do nothing;
  end loop;
  if jsonb_typeof(archive_value)='object' then
    insert into public.repository_knowledge_archives(
      tenant_id,knowledge_id,archived_at,final_version,content_hash,
      reason,metadata
    ) values(
      tenant_value,knowledge_value,
      (archive_value->>'archivedAt')::timestamptz,
      (archive_value->>'finalVersion')::integer,
      archive_value->>'contentHash',archive_value->>'reason',archive_value
    ) on conflict(tenant_id,knowledge_id) do nothing;
  end if;
  return query select input_entry;
end; $$;

create or replace function public.save_repository_agent_memory(
  input_memory jsonb
) returns table(memory jsonb)
language plpgsql security invoker set search_path=public as $$
declare existing jsonb;
begin
  if jsonb_typeof(input_memory)<>'object'
    or input_memory->>'schemaVersion'<>'repository-agent-memory-v1'
    or jsonb_typeof(input_memory->'retrievalMetadata')<>'object'
    or not exists(
      select 1 from public.repository_knowledge_versions version
      join public.repository_knowledge knowledge
        on knowledge.tenant_id=version.tenant_id
        and knowledge.knowledge_id=version.knowledge_id
      where version.tenant_id=input_memory->>'tenantId'
        and version.knowledge_id=input_memory->>'knowledgeId'
        and version.knowledge_version=
          (input_memory->>'knowledgeVersion')::integer
        and knowledge.owner_id=input_memory->>'ownerId'
        and knowledge.repository_id=input_memory->>'repositoryId'
        and knowledge.repository_revision=
          input_memory->>'repositoryRevision'
        and knowledge.lifecycle='active'
        and knowledge.knowledge_version=version.knowledge_version
    ) then
    raise check_violation using message='repository_memory_stale_knowledge';
  end if;
  select candidate.memory into existing
  from public.repository_agent_memory candidate
  where candidate.tenant_id=input_memory->>'tenantId'
    and candidate.memory_id=input_memory->>'memoryId';
  if existing is not null then
    if existing<>input_memory then
      raise check_violation using message=
        'repository_memory_immutable_conflict';
    end if;
    return query select existing;
    return;
  end if;
  insert into public.repository_agent_memory(
    tenant_id,memory_id,schema_version,owner_id,agent_id,runtime_version,
    repository_id,repository_revision,execution_id,knowledge_id,
    knowledge_version,memory_scope,confidence,retrieval_metadata,
    content_hash,memory,created_at,expires_at
  ) values(
    input_memory->>'tenantId',input_memory->>'memoryId',
    input_memory->>'schemaVersion',input_memory->>'ownerId',
    input_memory->>'agentId',input_memory->>'runtimeVersion',
    input_memory->>'repositoryId',input_memory->>'repositoryRevision',
    input_memory->>'executionId',input_memory->>'knowledgeId',
    (input_memory->>'knowledgeVersion')::integer,
    input_memory->>'memoryScope',
    (input_memory->>'confidence')::double precision,
    input_memory->'retrievalMetadata',input_memory->>'contentHash',
    input_memory,(input_memory->>'createdAt')::timestamptz,
    nullif(input_memory->>'expiresAt','')::timestamptz
  );
  return query select input_memory;
end; $$;

create or replace function public.list_repository_agent_memories(
  input_tenant_id text,input_repository_id text
) returns table(memories jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(
    jsonb_agg(memory order by created_at,memory_id),'[]'::jsonb
  ) from public.repository_agent_memory candidate
  where candidate.tenant_id=input_tenant_id
    and candidate.repository_id=input_repository_id
    and not exists(
      select 1 from public.repository_knowledge_memory_expirations expiration
      where expiration.tenant_id=candidate.tenant_id
        and expiration.memory_id=candidate.memory_id
    )
$$;

create or replace function public.list_recoverable_repository_knowledge(
  input_now timestamptz
) returns table(entries jsonb)
language sql stable security invoker set search_path=public as $$
  select coalesce(
    jsonb_agg(state order by updated_at,knowledge_id),'[]'::jsonb
  ) from public.repository_knowledge
  where lifecycle not in('archived','expired')
    and (
      lifecycle in('created','validated')
      or write_lease_expires_at<=input_now
      or jsonb_array_length(state->'versions')<>knowledge_version
      or exists(
        select 1
        from jsonb_array_elements(state->'versions')
          with ordinality version(value,position)
        where (version.value->>'version')::integer<>version.position
      )
      or exists(
        select 1
        from jsonb_array_elements(state->'versions') version,
          jsonb_array_elements(version->'diagnostics') diagnostic
        where diagnostic->>'knowledgeId'<>knowledge_id
          or (diagnostic->>'knowledgeVersion')::integer
            <>(version->>'version')::integer
      )
    )
$$;

create or replace function public.expire_repository_agent_memories(
  input_now timestamptz
) returns table(expired_count integer)
language plpgsql security invoker set search_path=public as $$
declare affected integer:=0;
begin
  insert into public.repository_knowledge_memory_expirations(
    tenant_id,memory_id,expiration_id,reason,created_at
  )
  select tenant_id,memory_id,
    'memory_expiration_'||substr(md5(memory_id||'|expired'),1,24),
    'expired',input_now
  from public.repository_agent_memory memory
  where expires_at is not null and expires_at<=input_now
  on conflict(tenant_id,memory_id) do nothing;
  get diagnostics affected=row_count;
  return query select affected;
end; $$;

create or replace function public.repository_knowledge_metrics(
  input_tenant_id text default null
) returns table(metrics jsonb)
language sql stable security invoker set search_path=public as $$
  with filtered as(
    select * from public.repository_knowledge candidate
    where input_tenant_id is null or candidate.tenant_id=input_tenant_id
  ), memory_count as(
    select count(*)::integer value from public.repository_agent_memory memory
    where input_tenant_id is null or memory.tenant_id=input_tenant_id
  ), expiration_count as(
    select count(*)::integer value
    from public.repository_knowledge_memory_expirations expiration
    where input_tenant_id is null or expiration.tenant_id=input_tenant_id
  )
  select jsonb_build_object(
    'knowledgeEntries',(select count(*) from filtered),
    'retrievalLatencyMs',0,
    'supersessions',(
      select count(*) from public.repository_knowledge_supersessions value
      where input_tenant_id is null or value.tenant_id=input_tenant_id
    ),
    'namespaceUsage',(
      select jsonb_object_agg(
        namespace,coalesce((
          select count(*) from filtered
          where filtered.namespace=namespaces.namespace
        ),0) order by ordinal
      ) from public.repository_knowledge_namespaces namespaces
    ),
    'memoryGrowth',(select value from memory_count),
    'confidenceDistribution',jsonb_build_object(
      'low',(select count(*) from filtered where confidence<0.4),
      'medium',(select count(*) from filtered
        where confidence>=0.4 and confidence<0.75),
      'high',(select count(*) from filtered where confidence>=0.75)
    ),
    'recoveryCount',
      (select coalesce(sum(jsonb_array_length(state->'recoveryHistory')),0)
       from filtered)+(select value from expiration_count)
  )
$$;

create or replace function public.collect_repository_knowledge(
  input_tenant_id text,input_entry_retention integer,
  input_version_retention integer,input_memory_retention integer
) returns table(deleted_count integer)
language plpgsql security invoker set search_path=public as $$
declare removed integer:=0;
declare affected integer:=0;
begin
  insert into public.repository_knowledge_retention(
    tenant_id,retained_entries,retained_versions,retained_memories
  ) values(
    input_tenant_id,greatest(1,input_entry_retention),
    greatest(1,input_version_retention),greatest(1,input_memory_retention)
  ) on conflict(tenant_id) do update set
    retained_entries=excluded.retained_entries,
    retained_versions=excluded.retained_versions,
    retained_memories=excluded.retained_memories,updated_at=now();
  with victims as(
    select knowledge_id from public.repository_knowledge
    where tenant_id=input_tenant_id
      and lifecycle in('archived','expired')
    order by updated_at desc,knowledge_id desc
    offset greatest(1,input_entry_retention)
  )
  delete from public.repository_knowledge candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.knowledge_id=victims.knowledge_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  with victims as(
    select memory_id from public.repository_agent_memory
    where tenant_id=input_tenant_id
    order by created_at desc,memory_id desc
    offset greatest(1,input_memory_retention)
  )
  delete from public.repository_agent_memory candidate using victims
  where candidate.tenant_id=input_tenant_id
    and candidate.memory_id=victims.memory_id;
  get diagnostics affected=row_count;
  removed:=removed+affected;
  return query select removed;
end; $$;

create or replace function public.verify_repository_knowledge_contract(
  input_engine_version text,input_schema_version text
) returns table(valid boolean,problems jsonb)
language plpgsql stable security invoker set search_path=public as $$
declare issues jsonb:='[]'::jsonb;
declare object_name text;
begin
  if input_engine_version<>'repository-knowledge-engine-v1'
    or input_schema_version<>'repository-knowledge-schema-v1' then
    issues:=issues||'"repository_knowledge_version_incompatible"'::jsonb;
  end if;
  foreach object_name in array array[
    'repository_knowledge_namespaces','repository_knowledge',
    'repository_knowledge_versions','repository_knowledge_sources',
    'repository_knowledge_diagnostics','repository_knowledge_supersessions',
    'repository_agent_memory','repository_knowledge_memory_expirations',
    'repository_knowledge_archives','repository_knowledge_retention'
  ] loop
    if to_regclass('public.'||object_name) is null then
      issues:=issues||to_jsonb(object_name||'_missing');
    elsif not exists(
      select 1 from pg_class
      where oid=to_regclass('public.'||object_name) and relrowsecurity
    ) then issues:=issues||to_jsonb(object_name||'_rls_missing'); end if;
  end loop;
  if (select count(*) from public.repository_knowledge_namespaces)<>10 then
    issues:=issues||'"repository_knowledge_namespaces_invalid"'::jsonb;
  end if;
  if not exists(select 1 from pg_indexes
      where indexname='repository_knowledge_retrieval_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_knowledge_versions_history_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_agent_memory_retrieval_idx')
    or not exists(select 1 from pg_indexes
      where indexname='repository_knowledge_archives_retention_idx') then
    issues:=issues||'"repository_knowledge_indexes_missing"'::jsonb;
  end if;
  if not exists(select 1 from pg_constraint
      where conname='repository_knowledge_lifecycle_valid')
    or not exists(select 1 from pg_constraint
      where conname='repository_knowledge_identity_fenced')
    or not exists(select 1 from pg_constraint
      where conname='repository_agent_memory_knowledge_fk'
        and confdeltype='c')
    or not exists(select 1 from pg_constraint
      where conname='repository_knowledge_versions_entry_fk'
        and confdeltype='c') then
    issues:=issues||'"repository_knowledge_constraints_missing"'::jsonb;
  end if;
  if not has_table_privilege(
      'service_role','public.repository_knowledge','select')
    or has_table_privilege(
      'anon','public.repository_knowledge','select')
    or not has_function_privilege(
      'service_role',
      'public.save_repository_knowledge_entry(jsonb,text)','execute')
    or has_function_privilege(
      'anon','public.save_repository_knowledge_entry(jsonb,text)','execute')
  then
    issues:=issues||'"repository_knowledge_grants_invalid"'::jsonb;
  end if;
  if to_regprocedure(
      'public.collect_repository_knowledge(text,integer,integer,integer)'
    ) is null then
    issues:=issues||'"repository_knowledge_retention_missing"'::jsonb;
  end if;
  return query select jsonb_array_length(issues)=0,issues;
end; $$;

do $$
declare object_name text;
begin
  foreach object_name in array array[
    'repository_knowledge_namespaces','repository_knowledge',
    'repository_knowledge_versions','repository_knowledge_sources',
    'repository_knowledge_diagnostics','repository_knowledge_supersessions',
    'repository_agent_memory','repository_knowledge_memory_expirations',
    'repository_knowledge_archives','repository_knowledge_retention'
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

revoke all on function public.get_repository_knowledge_entry(text,text)
  from public,anon,authenticated;
revoke all on function public.list_repository_knowledge_entries(text,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_knowledge_entry(jsonb,text)
  from public,anon,authenticated;
revoke all on function public.save_repository_agent_memory(jsonb)
  from public,anon,authenticated;
revoke all on function public.list_repository_agent_memories(text,text)
  from public,anon,authenticated;
revoke all on function public.list_recoverable_repository_knowledge(timestamptz)
  from public,anon,authenticated;
revoke all on function public.expire_repository_agent_memories(timestamptz)
  from public,anon,authenticated;
revoke all on function public.repository_knowledge_metrics(text)
  from public,anon,authenticated;
revoke all on function public.collect_repository_knowledge(
  text,integer,integer,integer
) from public,anon,authenticated;
revoke all on function public.verify_repository_knowledge_contract(text,text)
  from public,anon,authenticated;

grant execute on function public.get_repository_knowledge_entry(text,text)
  to service_role;
grant execute on function public.list_repository_knowledge_entries(text,text)
  to service_role;
grant execute on function public.save_repository_knowledge_entry(jsonb,text)
  to service_role;
grant execute on function public.save_repository_agent_memory(jsonb)
  to service_role;
grant execute on function public.list_repository_agent_memories(text,text)
  to service_role;
grant execute on function public.list_recoverable_repository_knowledge(
  timestamptz
) to service_role;
grant execute on function public.expire_repository_agent_memories(timestamptz)
  to service_role;
grant execute on function public.repository_knowledge_metrics(text)
  to service_role;
grant execute on function public.collect_repository_knowledge(
  text,integer,integer,integer
) to service_role;
grant execute on function public.verify_repository_knowledge_contract(text,text)
  to service_role;

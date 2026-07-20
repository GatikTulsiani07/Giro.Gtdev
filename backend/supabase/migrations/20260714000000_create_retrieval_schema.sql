create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $migration$
declare
  vector_schema name;
begin
  select namespace.nspname
  into vector_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'vector';

  if vector_schema is null then
    raise exception 'vector extension is not installed' using errcode = '42704';
  end if;

  execute pg_catalog.format($table$
    create table if not exists public.repository_chunks (
      id text primary key,
      repository text not null references public.repositories(repository_id) on delete cascade,
      repository_revision text not null default 'unversioned',
      file_path text not null,
      language text not null,
      chunk_index integer not null,
      content text not null,
      summary text,
      start_line integer not null,
      end_line integer not null,
      content_hash text not null,
      token_count integer not null,
      character_count integer not null,
      embedding %I.vector(1536) not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $table$, vector_schema);
end;
$migration$;

alter table public.repository_chunks
  alter column id type text using id::text,
  add column if not exists repository_revision text not null default 'unversioned',
  add column if not exists content_hash text,
  add column if not exists token_count integer,
  add column if not exists character_count integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.repository_chunks
set content_hash = md5(content),
    token_count = greatest(1, ceil(length(content)::numeric / 4)::integer),
    character_count = length(content)
where content_hash is null or token_count is null or character_count is null;

alter table public.repository_chunks
  alter column content_hash set not null,
  alter column token_count set not null,
  alter column character_count set not null;

delete from public.repository_chunks as chunks
where not exists (
  select 1
  from public.repositories as repositories
  where repositories.repository_id = chunks.repository
);

alter table public.repository_chunks
  drop constraint if exists repository_chunks_repository_fkey,
  add constraint repository_chunks_repository_fkey
    foreign key (repository) references public.repositories(repository_id) on delete cascade,
  drop constraint if exists repository_chunks_repository_non_empty,
  add constraint repository_chunks_repository_non_empty check (btrim(repository) <> ''),
  drop constraint if exists repository_chunks_revision_non_empty,
  add constraint repository_chunks_revision_non_empty check (btrim(repository_revision) <> ''),
  drop constraint if exists repository_chunks_file_path_valid,
  add constraint repository_chunks_file_path_valid check (
    btrim(file_path) <> '' and file_path !~ '(^|/)\.\.(/|$)' and file_path !~ '^/'
  ),
  drop constraint if exists repository_chunks_chunk_index_non_negative,
  add constraint repository_chunks_chunk_index_non_negative check (chunk_index >= 0),
  drop constraint if exists repository_chunks_line_range_valid,
  add constraint repository_chunks_line_range_valid check (start_line >= 1 and end_line >= start_line),
  drop constraint if exists repository_chunks_content_non_empty,
  add constraint repository_chunks_content_non_empty check (length(content) > 0),
  drop constraint if exists repository_chunks_token_count_positive,
  add constraint repository_chunks_token_count_positive check (token_count > 0),
  drop constraint if exists repository_chunks_character_count_positive,
  add constraint repository_chunks_character_count_positive check (character_count > 0),
  drop constraint if exists repository_chunks_metadata_object,
  add constraint repository_chunks_metadata_object check (jsonb_typeof(metadata) = 'object');

create unique index if not exists repository_chunks_snapshot_position_uidx
  on public.repository_chunks (repository, repository_revision, file_path, chunk_index);
create unique index if not exists repository_chunks_snapshot_content_uidx
  on public.repository_chunks (repository, repository_revision, file_path, content_hash, start_line, end_line);
create index if not exists repository_chunks_repository_revision_idx
  on public.repository_chunks (repository, repository_revision);
create index if not exists repository_chunks_repository_file_idx
  on public.repository_chunks (repository, file_path, chunk_index);

do $migration$
declare
  vector_opclass_schema name;
  trigram_opclass_schema name;
begin
  select namespace.nspname
  into vector_opclass_schema
  from pg_catalog.pg_opclass operator_class
  join pg_catalog.pg_namespace namespace
    on namespace.oid = operator_class.opcnamespace
  join pg_catalog.pg_depend dependency
    on dependency.classid = 'pg_catalog.pg_opclass'::pg_catalog.regclass
   and dependency.objid = operator_class.oid
   and dependency.deptype = 'e'
  join pg_catalog.pg_extension extension
    on extension.oid = dependency.refobjid
   and dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
  where extension.extname = 'vector'
    and operator_class.opcname = 'vector_cosine_ops';

  select namespace.nspname
  into trigram_opclass_schema
  from pg_catalog.pg_opclass operator_class
  join pg_catalog.pg_namespace namespace
    on namespace.oid = operator_class.opcnamespace
  join pg_catalog.pg_depend dependency
    on dependency.classid = 'pg_catalog.pg_opclass'::pg_catalog.regclass
   and dependency.objid = operator_class.oid
   and dependency.deptype = 'e'
  join pg_catalog.pg_extension extension
    on extension.oid = dependency.refobjid
   and dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
  where extension.extname = 'pg_trgm'
    and operator_class.opcname = 'gin_trgm_ops';

  if vector_opclass_schema is null then
    raise exception 'vector_cosine_ops operator class was not found in the vector extension'
      using errcode = '42704';
  end if;
  if trigram_opclass_schema is null then
    raise exception 'gin_trgm_ops operator class was not found in the pg_trgm extension'
      using errcode = '42704';
  end if;

  execute pg_catalog.format(
    'create index if not exists repository_chunks_embedding_hnsw_idx on public.repository_chunks using hnsw (embedding %I.vector_cosine_ops)',
    vector_opclass_schema
  );
  execute pg_catalog.format(
    'create index if not exists repository_chunks_content_trgm_idx on public.repository_chunks using gin (content %I.gin_trgm_ops)',
    trigram_opclass_schema
  );
  execute pg_catalog.format(
    'create index if not exists repository_chunks_file_path_trgm_idx on public.repository_chunks using gin (file_path %I.gin_trgm_ops)',
    trigram_opclass_schema
  );
end;
$migration$;

create table if not exists public.repository_summaries (
  repository text not null references public.repositories(repository_id) on delete cascade,
  repository_revision text not null default 'unversioned',
  summary_kind text not null default 'intelligence',
  summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repository, repository_revision, summary_kind)
);

alter table public.repository_summaries
  add column if not exists repository_revision text not null default 'unversioned',
  add column if not exists summary_kind text not null default 'intelligence',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

delete from public.repository_summaries as summaries
where not exists (
  select 1
  from public.repositories as repositories
  where repositories.repository_id = summaries.repository
);

alter table public.repository_summaries
  drop constraint if exists repository_summaries_pkey,
  drop constraint if exists repository_summaries_repository_key,
  add constraint repository_summaries_pkey
    primary key (repository, repository_revision, summary_kind);

alter table public.repository_summaries
  drop constraint if exists repository_summaries_repository_fkey,
  add constraint repository_summaries_repository_fkey
    foreign key (repository) references public.repositories(repository_id) on delete cascade,
  drop constraint if exists repository_summaries_repository_non_empty,
  add constraint repository_summaries_repository_non_empty check (btrim(repository) <> ''),
  drop constraint if exists repository_summaries_revision_non_empty,
  add constraint repository_summaries_revision_non_empty check (btrim(repository_revision) <> ''),
  drop constraint if exists repository_summaries_kind_valid,
  add constraint repository_summaries_kind_valid check (summary_kind in ('intelligence', 'architecture')),
  drop constraint if exists repository_summaries_summary_object,
  add constraint repository_summaries_summary_object check (jsonb_typeof(summary) = 'object');

create unique index if not exists repository_summaries_scope_uidx
  on public.repository_summaries (repository, repository_revision, summary_kind);
create index if not exists repository_summaries_repository_updated_idx
  on public.repository_summaries (repository, updated_at desc);

do $migration$
declare
  existing_function record;
  vector_schema name;
  vector_type_oid oid;
begin
  select namespace.nspname, vector_type.oid
  into vector_schema, vector_type_oid
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_depend dependency
    on dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
   and dependency.refobjid = extension.oid
   and dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
   and dependency.deptype = 'e'
  join pg_catalog.pg_type vector_type
    on vector_type.oid = dependency.objid
   and vector_type.typname = 'vector'
  join pg_catalog.pg_namespace namespace
    on namespace.oid = vector_type.typnamespace
  where extension.extname = 'vector';

  if vector_type_oid is null then
    raise exception 'vector extension is not installed' using errcode = '42704';
  end if;

  for existing_function in
    select
      proc.oid,
      pg_catalog.pg_get_function_identity_arguments(proc.oid) as identity_arguments
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'match_repository_chunks'
      and proc.prokind = 'f'
      and proc.pronargs in (3, 4)
      and proc.proargtypes[0] = 'pg_catalog.text'::pg_catalog.regtype
      and proc.proargtypes[1] = vector_type_oid
      and proc.proargtypes[2] = 'pg_catalog.int4'::pg_catalog.regtype
      and (
        proc.pronargs = 3
        or proc.proargtypes[3] = 'pg_catalog.text'::pg_catalog.regtype
      )
  loop
    execute pg_catalog.format(
      'drop function %I.%I(%s)',
      'public',
      'match_repository_chunks',
      existing_function.identity_arguments
    );
  end loop;

  execute pg_catalog.format($function$
    create function public.match_repository_chunks(
      input_repository text,
      query_embedding %I.vector(1536),
      match_count integer,
      input_repository_revision text
    )
    returns table (
      id text,
      repository text,
      repository_revision text,
      file_path text,
      language text,
      content text,
      summary text,
      start_line integer,
      end_line integer,
      chunk_index integer,
      similarity double precision
    )
    language plpgsql
    stable
    security invoker
    set search_path = pg_catalog, public
    as $body$
    begin
      if input_repository is null or btrim(input_repository) = '' then
        raise exception 'input_repository is required' using errcode = '22023';
      end if;
      if match_count < 1 or match_count > 50 then
        raise exception 'match_count must be between 1 and 50' using errcode = '22023';
      end if;

      return query
      select
        chunks.id,
        chunks.repository,
        chunks.repository_revision,
        chunks.file_path,
        chunks.language,
        chunks.content,
        chunks.summary,
        chunks.start_line,
        chunks.end_line,
        chunks.chunk_index,
        (1 - (chunks.embedding OPERATOR(%I.<=>) query_embedding))::double precision as similarity
      from public.repository_chunks as chunks
      join public.repositories as repositories
        on repositories.repository_id = chunks.repository
      where chunks.repository = input_repository
        and (
          input_repository_revision is not null
            and chunks.repository_revision = input_repository_revision
          or input_repository_revision is null
            and (repositories.indexed_revision is null or chunks.repository_revision = repositories.indexed_revision)
        )
      order by
        chunks.embedding OPERATOR(%I.<=>) query_embedding asc,
        chunks.file_path asc,
        chunks.start_line asc,
        chunks.chunk_index asc,
        chunks.id asc
      limit match_count;
    end;
    $body$
  $function$, vector_schema, vector_schema, vector_schema);
end;
$migration$;

create or replace function public.delete_repository_retrieval_data(
  input_repository text,
  input_keep_revision text default null
)
returns table (deleted_chunks bigint, deleted_summaries bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  chunk_count bigint;
  summary_count bigint;
begin
  delete from public.repository_chunks
  where repository = input_repository
    and (input_keep_revision is null or repository_revision <> input_keep_revision);
  get diagnostics chunk_count = row_count;

  delete from public.repository_summaries
  where repository = input_repository
    and (input_keep_revision is null or repository_revision <> input_keep_revision);
  get diagnostics summary_count = row_count;

  return query select chunk_count, summary_count;
end;
$$;

alter table public.repository_chunks enable row level security;
alter table public.repository_summaries enable row level security;
revoke all on table public.repository_chunks from anon, authenticated;
revoke all on table public.repository_summaries from anon, authenticated;
revoke all on function public.delete_repository_retrieval_data(text, text) from public, anon, authenticated;
grant all on table public.repository_chunks to service_role;
grant all on table public.repository_summaries to service_role;
grant execute on function public.delete_repository_retrieval_data(text, text) to service_role;

do $migration$
declare
  vector_schema name;
begin
  select namespace.nspname
  into vector_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'vector';

  execute pg_catalog.format(
    'revoke all on function public.match_repository_chunks(text, %I.vector(1536), integer, text) from public, anon, authenticated',
    vector_schema
  );
  execute pg_catalog.format(
    'grant execute on function public.match_repository_chunks(text, %I.vector(1536), integer, text) to service_role',
    vector_schema
  );
end;
$migration$;

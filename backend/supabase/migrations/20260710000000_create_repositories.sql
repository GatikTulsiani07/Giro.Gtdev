create table if not exists public.repositories (
  repository_id text primary key,
  owner_user_id text,
  repository_owner text not null,
  repository_name text not null,
  status text not null,
  indexing_mode text,
  file_count integer not null default 0,
  symbol_count integer not null default 0,
  chunk_count integer not null default 0,
  graph_node_count integer not null default 0,
  graph_edge_count integer not null default 0,
  graph_available boolean generated always as (
    graph_node_count > 0 or graph_edge_count > 0
  ) stored,
  metadata_available boolean not null default false,
  total_indexed_files integer not null default 0,
  last_changed_file_count integer not null default 0,
  failed_file_count integer not null default 0,
  last_successful_file text,
  retry_count integer not null default 0,
  failure_message text,
  connected_at timestamptz not null,
  indexed_at timestamptz,
  first_indexed_at timestamptz,
  last_indexed_at timestamptz,
  failed_at timestamptz,
  last_retry_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,

  constraint repositories_owner_user_id_non_empty
    check (owner_user_id is null or btrim(owner_user_id) <> ''),
  constraint repositories_owner_non_empty
    check (btrim(repository_owner) <> ''),
  constraint repositories_name_non_empty
    check (btrim(repository_name) <> ''),
  constraint repositories_id_matches_owner_name
    check (repository_id = repository_owner || '/' || repository_name),
  constraint repositories_status_valid
    check (status in ('connected', 'indexing', 'indexed', 'failed', 'stale')),
  constraint repositories_indexing_mode_valid
    check (indexing_mode is null or indexing_mode in ('full', 'incremental')),
  constraint repositories_file_count_non_negative
    check (file_count >= 0),
  constraint repositories_symbol_count_non_negative
    check (symbol_count >= 0),
  constraint repositories_chunk_count_non_negative
    check (chunk_count >= 0),
  constraint repositories_graph_node_count_non_negative
    check (graph_node_count >= 0),
  constraint repositories_graph_edge_count_non_negative
    check (graph_edge_count >= 0),
  constraint repositories_total_indexed_files_non_negative
    check (total_indexed_files >= 0),
  constraint repositories_last_changed_file_count_non_negative
    check (last_changed_file_count >= 0),
  constraint repositories_failed_file_count_non_negative
    check (failed_file_count >= 0),
  constraint repositories_retry_count_non_negative
    check (retry_count >= 0),
  constraint repositories_owner_user_repository_unique
    unique (owner_user_id, repository_owner, repository_name)
);

create index if not exists repositories_owner_user_updated_idx
  on public.repositories (owner_user_id, updated_at desc)
  where owner_user_id is not null;

create index if not exists repositories_owner_name_idx
  on public.repositories (repository_owner, repository_name);

create index if not exists repositories_status_idx
  on public.repositories (status);

create index if not exists repositories_status_updated_idx
  on public.repositories (status, updated_at desc);

create index if not exists repositories_last_accessed_idx
  on public.repositories (last_accessed_at desc nulls last);

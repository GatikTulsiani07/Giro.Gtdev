alter table public.repositories
  add column if not exists indexed_revision text,
  add column if not exists last_lifecycle_severity text,
  add column if not exists last_reindex_mode text,
  add column if not exists last_reindex_reason text;

alter table public.repositories
  drop constraint if exists repositories_lifecycle_severity_valid,
  add constraint repositories_lifecycle_severity_valid
    check (last_lifecycle_severity is null or last_lifecycle_severity in ('none', 'low', 'medium', 'high')),
  drop constraint if exists repositories_reindex_mode_valid,
  add constraint repositories_reindex_mode_valid
    check (last_reindex_mode is null or last_reindex_mode in ('none', 'full', 'incremental'));

alter table public.repositories enable row level security;
revoke all on table public.repositories from anon, authenticated;
grant all on table public.repositories to service_role;

create table if not exists public.sessions (
  session_id text primary key,
  owner_user_id text not null,
  repository_id text not null references public.repositories(repository_id) on delete cascade,
  repository_owner text not null,
  repository_name text not null,
  title text not null,
  selected_context jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  constraint sessions_owner_user_id_non_empty check (btrim(owner_user_id) <> ''),
  constraint sessions_repository_matches check (repository_id = repository_owner || '/' || repository_name),
  constraint sessions_title_non_empty check (btrim(title) <> ''),
  constraint sessions_selected_context_array check (jsonb_typeof(selected_context) = 'array')
);

create index if not exists sessions_owner_updated_idx
  on public.sessions (owner_user_id, updated_at desc);
create index if not exists sessions_repository_updated_idx
  on public.sessions (repository_id, updated_at desc);

create sequence if not exists public.session_message_order_seq;

create table if not exists public.session_messages (
  message_id text primary key,
  session_id text not null references public.sessions(session_id) on delete cascade,
  role text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  evidence jsonb,
  retrieval_metadata jsonb,
  created_at timestamptz not null,
  message_order bigint not null default nextval('public.session_message_order_seq'),

  constraint session_messages_role_valid check (role in ('user', 'assistant')),
  constraint session_messages_content_non_empty check (btrim(content) <> ''),
  constraint session_messages_citations_array check (jsonb_typeof(citations) = 'array'),
  constraint session_messages_evidence_array check (evidence is null or jsonb_typeof(evidence) = 'array'),
  constraint session_messages_retrieval_metadata_object check (
    retrieval_metadata is null or jsonb_typeof(retrieval_metadata) = 'object'
  )
);

create index if not exists session_messages_session_order_idx
  on public.session_messages (session_id, message_order asc);

create or replace function public.touch_session_after_message()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sessions
  set updated_at = greatest(updated_at, new.created_at)
  where session_id = new.session_id;
  return new;
end;
$$;

drop trigger if exists session_messages_touch_session on public.session_messages;
create trigger session_messages_touch_session
after insert on public.session_messages
for each row execute function public.touch_session_after_message();

alter table public.sessions enable row level security;
alter table public.session_messages enable row level security;

revoke all on table public.sessions from anon, authenticated;
revoke all on table public.session_messages from anon, authenticated;
revoke all on sequence public.session_message_order_seq from anon, authenticated;
grant all on table public.sessions to service_role;
grant all on table public.session_messages to service_role;
grant usage, select on sequence public.session_message_order_seq to service_role;

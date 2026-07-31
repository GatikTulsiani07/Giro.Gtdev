import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrations,
  postgresAvailability,
  psql,
  scalar,
  seedRepositorySql,
  withDisposableDatabase,
} from "./postgresHarness.mjs";

const availability = await postgresAvailability();
const skip = availability.available ? false : availability.reason;
const revision = "a".repeat(40);
const nextRevision = "b".repeat(40);
const timestamp = "2026-07-31T00:00:00.000Z";

const metadataSql = `
  select jsonb_build_object(
    'repositoryId', repository_id,
    'owner', repository_owner,
    'repo', repository_name,
    'repository', repository_name,
    'displayName', repository_name,
    'status', case when status='connected' then 'queued' else status end,
    'currentRevision', current_revision,
    'indexedRevision', indexed_revision,
    'publishedRevision', case
      when current_revision is not null
        and current_revision=indexed_revision then current_revision
      else null end,
    'revisionConsistent', current_revision is not distinct from indexed_revision,
    'gatewayCompatible', current_revision is not null
      and current_revision=indexed_revision,
    'isStale', status='stale'
      or current_revision is distinct from indexed_revision,
    'lastIndexedAt', to_jsonb(to_char(last_indexed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'lastAccessedAt', to_jsonb(to_char(last_accessed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'createdAt', to_char(connected_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  from public.repositories where repository_id='acme/widgets'
`;

test("PostgreSQL repository metadata matches the public gateway DTO source",
  { skip }, async () => {
    await withDisposableDatabase(availability, async ({ url }) => {
      await applyMigrations(url);
      psql(url, seedRepositorySql("acme/widgets", "metadata-user"));
      psql(url, `
        update public.repositories set
          status='indexed',
          current_revision='${revision}',
          indexed_revision='${revision}',
          connected_at='${timestamp}',
          last_indexed_at='${timestamp}',
          last_accessed_at='${timestamp}',
          updated_at='${timestamp}'
        where repository_id='acme/widgets'
      `);
      const published = JSON.parse(scalar(url, metadataSql));
      assert.deepEqual(published, {
        repositoryId: "acme/widgets",
        owner: "acme",
        repo: "widgets",
        repository: "widgets",
        displayName: "widgets",
        status: "indexed",
        currentRevision: revision,
        indexedRevision: revision,
        publishedRevision: revision,
        revisionConsistent: true,
        gatewayCompatible: true,
        isStale: false,
        lastIndexedAt: timestamp,
        lastAccessedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      psql(url, `
        update public.repositories set current_revision='${nextRevision}'
        where repository_id='acme/widgets'
      `);
      const stale = JSON.parse(scalar(url, metadataSql));
      assert.equal(stale.currentRevision, nextRevision);
      assert.equal(stale.indexedRevision, revision);
      assert.equal(stale.publishedRevision, null);
      assert.equal(stale.revisionConsistent, false);
      assert.equal(stale.gatewayCompatible, false);
      assert.equal(stale.isStale, true);
      assert.equal(scalar(url, `
        select count(*) from public.repositories
        where owner_user_id='metadata-user'
      `), "1");
      assert.equal(scalar(url, `
        select count(*) from public.repositories
        where owner_user_id='other-user'
      `), "0");
    });
  });

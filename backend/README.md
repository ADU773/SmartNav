# Backend data integrity

Run the server from this directory with `node server.js`. Configure `MONGODB_URI`
and optionally `PORT` in `.env`. Install dependencies with `npm ci`.

## Database requirement

Writes that create or change entity relationships now use MongoDB transactions.
Use MongoDB Atlas or a replica set, including a single-node local replica set.
Standalone MongoDB receives HTTP 503 for these operations; there is deliberately
no non-atomic fallback. Existing response envelopes and route URLs are preserved.

For a new local development database, create a dedicated data directory, then:

```powershell
mongod --dbpath C:\data\smartnav --replSet rs0 --bind_ip 127.0.0.1
```

In another terminal, initialize that new replica set once:

```powershell
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Use `mongodb://127.0.0.1:27017/smartnav360?replicaSet=rs0` as `MONGODB_URI`.
Do not initialize an existing managed/production deployment with this example.

## Deletion and reference behavior

- Project deletion atomically removes its scenes, asset records, and analytics.
  It removes incoming hotspots and analytics references, including legacy
  references from other projects. Legacy image/floor-plan references to removed
  assets are cleared unless another surviving asset owns the same file.
- Scene deletion removes incoming hotspots and events whose `sceneId` or
  `metadata.fromSceneId` refers to it. It retains project-owned image assets,
  because other scenes and floor plans may reuse them.
- Replacing a scene image or removing a hotspot does not delete reusable assets.
  An unused project asset is valid library content, not an orphan.
- Scene creation, connection creation, updates, asset-record creation, and event
  creation serialize against deletion by touching their project in a transaction.
  Project creation remains a single-document insert. Scene project moves,
  duplicate/self/cross-project hotspots, invalid IDs, foreign local image paths,
  and arbitrary update operators are rejected. Local upload paths are normalized;
  external HTTP(S) images outside `/uploads/` remain supported but are not owned
  or deleted by this server.
- Project updates accept `name`, `description`, and `floorPlan`. Publication
  fields remain managed by the publish endpoint. Scene updates accept `name`,
  `image`, `hotspots`, `metadata`, `mapPosition`, and an unchanged `projectId`.
- Files are deleted only after database commit. `PendingFileDeletion` is a durable
  cleanup queue, not an orphaned asset record. File locks/permissions failures
  leave jobs queued and project deletion returns `cleanupPending: true`.
  The server retries after connecting and every minute, in batches of 100.
  Missing files count as successfully cleaned up. Shared files are retained while
  referenced; unsafe filenames are never passed to filesystem deletion.
- A process crash after commit leaves cleanup jobs available for the next server
  run. An ambiguous upload commit retains its file rather than risking deletion
  of an image whose database record may have committed.

No global sweep/migration is run against existing data. These safeguards apply
when entities are changed/deleted through the API; direct database edits bypass
application checks. Existing unrelated orphan records/files are not silently
removed. Authentication and the unconnected frontend delete controls are outside
this change.

## Tests

```powershell
# From backend; frontend dependencies are also needed by the upload regression.
npm test
```

`npm run test:integrity` starts a disposable MongoDB 8.0.17 single-node replica
set using mongodb-memory-server. It never reads `.env` or uses `MONGODB_URI`.
The first run downloads a MongoDB binary to the user's cache and needs network
access and permission to start a local process. Test image files use unique names
and are removed individually. The upload regression retains its stubbed database
checks, while integrity tests exercise real transactions, rollback, concurrent
writes/deletions, analytics validation, shared files, and durable cleanup retry.

---
name: concurrency-and-consistency
description: Use Harper's transactions, atomic operations, and record locks before adding optimistic concurrency, client coordination, or single-origin routing.
metadata:
  mode: synthesized
---

# Use Harper's Concurrency Controls

Start with Harper's native primitives. Do not build client write queues, JavaScript mutexes, version columns, compare-and-swap (CAS) retry loops, lock tables, external coordinators, or origin pinning merely because multiple requests can write concurrently. First identify the required invariant and the Harper primitive that covers it. Add application coordination only for a demonstrated requirement those primitives do not satisfy.

This guidance is checked against Harper **5.3.2**. Confirm the deployed version, storage engine, single-node or cluster topology, and Harper Pro configuration before choosing a lock scope. If those facts are unavailable, ask. The [5.3 release notes](https://docs.harperdb.io/release-notes/v5-lincoln/5.3#record-locks) introduce record locks; older advice to use an external lock or a single owning process must be checked against that capability.

This synthesized rule is maintained manually. When changing its version baseline or applying it to another version, recheck the linked Table, record-lock, and commit contracts; the docs-sync generator does not revalidate these claims.

## Choose the Primitive

| Requirement                                                                              | Start with                                                                                     | Boundary                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Several table writes succeed or fail together in one HTTP request                        | Harper's automatic request transaction; await the writes                                       | Atomicity is within one database, not across databases or separate requests.                               |
| A timer or background task needs a transaction                                           | `transaction(async () => { ... })` from `harper`                                               | Background work needs an explicit transaction scope.                                                       |
| Concurrent increments or decrements                                                      | `Table.update(id)` and the returned record's `addTo()` or `subtractFrom()`                     | Atomic deltas preserve concurrent increments. A preceding read/check is not part of that atomic operation. |
| Read a record, check a condition, then write while excluding other participating writers | Server-side `Table.lock(id, options?)`; read and update the returned record in the transaction | Every conflicting writer must use the lock. Scope and recovery limits below apply.                         |
| Resolve storage-level write conflicts                                                    | Harper's built-in conflict resolution and commit retries                                       | Harper does not rerun arbitrary application checks or external side effects.                               |
| Reject an edit because the form was loaded before someone else's change                  | An explicit server-enforced stale-edit precondition                                            | This is a product requirement, not a guarantee supplied by automatic storage conflict handling.            |

See [programmatic table requests](programmatic-table-requests.md) for transaction and atomic-update APIs. A stock decrement is safe as a delta; "stock must never go below zero" also needs protection for the check. Counters alone do not enforce balance floors, capacity limits, claim-once behavior, or an ordered ticket allocator.

## Native Record Locks

In 5.3.2, `await tables.Inventory.lock(id, options)` returns a record ready for updates and joins the ambient transaction. Acquire it before other writes and before reading the value used by the condition, then mutate that returned record and `await record.save()`. Use the HTTP request transaction, or an explicit `transaction()` for background work, subject to the timestamp boundary below. Keep the critical section short and within the lease; a transaction-scoped lock releases on commit or abort. Do not call `record.unlock()` before the transaction commits.

The options are `scope`, `lease`, `timeout`, and `hold`. `lease` and `timeout` are milliseconds, both defaulting to `30000`; `hold` defaults to `false`. `lock()` waits for contention up to `timeout`; choose a timeout within the request's latency budget. For a verified single-node deployment, `{ scope: 'node', lease: 30000, timeout: 1000 }` selects a one-second wait. Recheck that scope before adding nodes. When correctness requires coordination across nodes, use explicit `scope: 'cluster'` so unavailable coordination fails closed. Use `timeout`, not an invented `timeoutMs` option. See the [5.3.2 option definitions](https://github.com/HarperFast/harper/blob/v5.3.2/resources/recordLock.ts#L21-L43).

Writes through an expired lock and commits submitted after lease expiry reject with `error.statusCode === 409`. Keep external network calls outside the critical section: a Harper transaction cannot roll back a payment or another external side effect. Handle those operations' failures separately. This expiry check does not eliminate the late-settling native-commit limitation below.

Use this in an authenticated, authorized server Resource or Component. `lock()` is an in-process API with no authorization check of its own; it is not a REST `LOCK` method or a browser protocol. An application must explicitly call it. Ordinary requests do not automatically acquire a record lock. See the [5.3.2 Table implementation](https://github.com/HarperFast/harper/blob/v5.3.2/resources/Table.ts#L3968-L4029).

- Locks require RocksDB; LMDB rejects them with `501`. If the deployed engine lacks the required primitive, explain that gap and agree on a supported deployment or application design before implementing the guarded write. An unlocked read/check/write is not a fallback.
- `scope: 'node'` coordinates the node's worker threads. Cluster coordination requires Harper Pro's cluster-lock transport and home-map configuration. Replicated tables default to cluster scope when supported; `replicate: false` defaults to node scope. An explicit `scope: 'cluster'` fails closed if unavailable. A core-only deployment can fall back to node scope for an implicit default, so the existence of `lock()` does not establish cluster protection.
- Locks exclude other `lock()` callers on the same key. Plain `put`, `patch`, `delete`, and `create` calls are not blocked; neither are unlocked `update()` calls using `addTo()` or `subtractFrom()`. Route all writers involved in the invariant through the same locking path, including automatic REST writes and delta updates to guarded fields. Use [table extensions](extending-tables.md) to enforce the path or restrict endpoints that would bypass it.
- Prefer transaction-scoped locks. `{ hold: true }` outlives the transaction and needs explicit `unlock()` or lease expiry. A lock acquired outside a request or explicit transaction can also remain held until unlock or expiry.
- Rejections expose `error.statusCode`: `423` reports contention; `503` reports unavailable coordination. Propagate these errors or apply a bounded contention retry policy for an operation safe to repeat. This is separate from Harper's internal commit retries. Do not treat a coordination failure as permission to perform the write unlocked; account for repeated requests and external side effects. See [ClientError](https://github.com/HarperFast/harper/blob/v5.3.2/utility/errors/hdbError.ts#L76-L86).

Locks leave normal conflict resolution unchanged in both node and cluster scope. Earlier writes or another lock in the same transaction can fix its timestamp before a later locked update. That update can lose to an intervening commit even after reading its value, with every writer participating and no clock skew or crash. Do not infer serializable multi-record read/check/write from acquiring several locks in one request. If several records each need guarded checks, explain this gap and ask before designing coordination; use atomic deltas only where the invariant permits them. A predecessor's write can also outrank its successor's under last-write-wins because of clock skew or a deliberately future transaction timestamp. See the [5.3.2 transaction timestamp rules](https://github.com/HarperFast/harper/blob/v5.3.2/resources/record-locks.md#record-locks-the-native-key-lock-is-the-sole-authority-tabledatabasetransactionrecordlock).

Cluster locks provide exclusion, not global serializable transactions or quorum durability. Clean handoff freshness depends on the home retaining the release dependencies. Home restart, generation change, or eviction can lose those dependencies even after a clean release. On the recovery path, successor freshness is not guaranteed; an unreachable predecessor or a native commit that settles after the recovery barrier can leave the successor reading stale data. Do not invent client retries, replication headers, or origin pinning as a fix. If a requirement needs stronger guarantees, explain this gap and ask before designing additional coordination. The [5.3.2 lock contract](https://github.com/HarperFast/harper/blob/v5.3.2/resources/record-locks.md#10-cost-and-the-guarantee-decision) defines these limits.

## Optimistic Concurrency

Harper already handles storage-level optimistic transaction conflicts and retries commits. Do not add an application version field, browser CAS loop, or whole-request retry wrapper to duplicate that work. The [5.3.2 commit path](https://github.com/HarperFast/harper/blob/v5.3.2/resources/DatabaseTransaction.ts#L2049-L2190) handles native conflict retries; this does not mean it reruns the handler's business logic.

For a read/check/write invariant, consider native `lock()` first within its supported scope. A separate version comparison followed by `put()` or `patch()` is not atomic CAS. Do not invent `If-Match` write semantics from conditional GET/ETag documentation.

"Warn or reject if this form is stale" is a separate requirement. Confirm that behavior with the user and verify a supported server-side precondition mechanism for the deployed version and topology. A product-specific revision token may serve that policy, but still needs an atomic server-enforced comparison and write. Do not promise that Harper's automatic conflict resolution rejects stale forms, and do not add a general optimistic-concurrency framework without that requirement.

For a confirmed single-record stale-edit policy, evaluate this sequence: acquire the record lock first in the transaction, compare the client's token with the locked record's revision, reject a mismatch with `409`, otherwise advance the revision and save. Give the application's stale-edit response a distinguishable error code or body; a bare `409` can also mean lease expiry and must not cause the client to discard unsaved edits. Every conflicting writer must participate, and the lock's scope, timestamp, and recovery limits must satisfy the requirement. Verify the revision representation before implementation; conditional GET documentation alone does not define a write precondition.

## Request, Node, and Browser Origin Are Different Scopes

One browser origin does not imply one Harper worker, node, or transaction. Browser queues serialize only that client's work. Separate HTTP requests do not share a request snapshot, and using one URL does not create a cluster-wide snapshot or remove replication lag.

For a coherent unit of work, first put the related reads and writes in one server request transaction within one database. For counters, use atomic deltas. For participating conditional writers, evaluate native locks and their scope. Do not make sticky routing or a "single origin" architecture the default answer to concurrency. If the task needs stronger cross-request or cross-node freshness, state the precise requirement and verify Harper's deployment guarantees before adding machinery.

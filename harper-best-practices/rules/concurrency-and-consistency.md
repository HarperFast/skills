---
name: concurrency-and-consistency
description: Use Harper's transactions, atomic operations, and record locks before adding optimistic concurrency, client coordination, or single-origin routing.
metadata:
  mode: synthesized
---

# Use Harper's Concurrency Controls

Start with Harper's native primitives. Do not build client write queues, JavaScript mutexes, version columns, compare-and-swap (CAS) retry loops, lock tables, external coordinators, or origin pinning merely because multiple requests can write concurrently. First identify the required invariant and the Harper primitive that covers it. Add application coordination only for a demonstrated requirement those primitives do not satisfy.

This guidance is checked against Harper **5.3.2**. Confirm the deployed version, storage engine, single-node or cluster topology, and Harper Pro configuration before choosing a lock scope. If those facts are unavailable, ask. The [5.3 release notes](https://docs.harperdb.io/release-notes/v5-lincoln/5.3#record-locks) introduce record locks; older advice to use an external lock or a single owning process must be checked against that capability.

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

In 5.3.2, `await tables.Inventory.lock(id, options)` returns a record ready for updates. Acquire it before reading the value used by the condition, then mutate that returned record and `await record.save()`. Perform this inside the existing HTTP request transaction, or an explicit `transaction()` for background work. Keep the critical section short and within the lease; a transaction-scoped lock releases on commit or abort. Do not unlock before the transaction commits.

Use this in an authenticated, authorized server Resource or Component. `lock()` is an in-process API with no authorization check of its own; it is not a REST `LOCK` method or a browser protocol. An application must explicitly call it. Ordinary requests do not automatically acquire a record lock. See the [5.3.2 Table implementation](https://github.com/HarperFast/harper/blob/v5.3.2/resources/Table.ts#L3968-L4029).

- Locks require RocksDB; LMDB rejects them with `501`.
- `scope: 'node'` coordinates the node's worker threads. Cluster coordination requires Harper Pro's cluster-lock transport and home-map configuration. Replicated tables default to cluster scope when supported; `replicate: false` defaults to node scope. An explicit `scope: 'cluster'` fails closed if unavailable. A core-only deployment can fall back to node scope for an implicit default, so the existence of `lock()` does not establish cluster protection.
- Locks exclude other `lock()` callers on the same key. Plain `put`, `patch`, `delete`, and `create` calls are not blocked. Route all writers involved in the invariant through the same locking path.
- Prefer transaction-scoped locks. `{ hold: true }` outlives the transaction and needs explicit `unlock()` or lease expiry. A lock acquired outside a request or explicit transaction can also remain held until unlock or expiry.
- `423` reports contention; `503` reports unavailable coordination. Do not treat a coordination failure as permission to perform the write unlocked. Application retries must account for repeated requests and external side effects.

Cluster locks provide exclusion, not global serializable transactions or quorum durability. They leave normal conflict resolution unchanged: a predecessor's write can outrank its successor's under last-write-wins, including clock skew or a deliberately future transaction timestamp. Clean handoff freshness depends on the home retaining the release dependencies. Home restart, generation change, or eviction can lose those dependencies even after a clean release. On the recovery path, successor freshness is not guaranteed; an unreachable predecessor or a native commit that settles after the recovery barrier can leave the successor reading stale data. Do not invent client retries, replication headers, or origin pinning as a fix. If a requirement needs stronger guarantees, explain this gap and ask before designing additional coordination. The [5.3.2 lock contract](https://github.com/HarperFast/harper/blob/v5.3.2/resources/record-locks.md#10-cost-and-the-guarantee-decision) defines these limits.

## Optimistic Concurrency

Harper already handles storage-level optimistic transaction conflicts and retries commits. Do not add an application version field, browser CAS loop, or whole-request retry wrapper to duplicate that work. The [5.3.2 commit path](https://github.com/HarperFast/harper/blob/v5.3.2/resources/DatabaseTransaction.ts#L2049-L2190) handles native conflict retries; this does not mean it reruns the handler's business logic.

For a read/check/write invariant, consider native `lock()` first within its supported scope. A separate version comparison followed by `put()` or `patch()` is not atomic CAS. Do not invent `If-Match` write semantics from conditional GET/ETag documentation.

"Warn or reject if this form is stale" is a separate requirement. Confirm that behavior with the user and verify a supported server-side precondition mechanism for the deployed version and topology. Do not promise that Harper's automatic conflict resolution rejects stale forms, and do not add a general optimistic-concurrency framework without that requirement.

## Request, Node, and Browser Origin Are Different Scopes

One browser origin does not imply one Harper worker, node, or transaction. Browser queues serialize only that client's work. Separate HTTP requests do not share a request snapshot, and using one URL does not create a cluster-wide snapshot or remove replication lag.

For a coherent unit of work, first put the related reads and writes in one server request transaction within one database. For counters, use atomic deltas. For participating conditional writers, evaluate native locks and their scope. Do not make sticky routing or a "single origin" architecture the default answer to concurrency. If the task needs stronger cross-request or cross-node freshness, state the precise requirement and verify Harper's deployment guarantees before adding machinery.

# Prepify Deployment and Obsidian On-Demand Sync Design

**Date:** 2026-09-12

**Status:** Approved in conversation; pending written-spec review

## Goal

Deploy Prepify as a normal web application while keeping the owner's Obsidian
vault private on their Mac. PostgreSQL provides reliable structured application
state, while Obsidian remains the rich second-brain surface used for journals,
knowledge, theory, and daily context.

Sync is initiated explicitly from Prepify and delivered immediately through an
outbound connection held by a local HeheVault bridge. The bridge does not poll
the server every few seconds and the deployed server never opens, mounts, or
receives the vault directory.

## Decision

Use a hybrid ownership model with an on-demand local bridge:

- PostgreSQL owns the canonical structured operational state after validation:
  identities, authorization, sessions, quiz results, streaks, review schedules,
  task completion state, synchronization jobs, and audit records. An Obsidian
  checkbox edit is an input command that must be validated and committed to the
  database before it becomes canonical state.
- Obsidian owns narrative and knowledge content: journals, free-form Daily and
  Journey prose, theory, knowledge notes, and links between notes.
- Prepify may mutate only explicitly structured Daily and Journey fields. It
  cannot write arbitrary knowledge or theory Markdown.
- A HeheVault bridge runs as a macOS background service on the machine that has
  the vault. It keeps one authenticated outbound WebSocket connection to the
  deployed API but reads or writes the vault only after an explicit sync job.
- The Journey and Daily UI expose a **Sync Obsidian** action. Other Prepify
  surfaces such as Quiz and Library do not depend on vault availability.

## Options considered

### Local bridge with periodic polling

The bridge asks the server for work at a fixed interval. This is simple and
survives transient connection failures, but it creates needless requests and
makes an explicit sync action feel indirect.

### Cloud-hosted vault mirror

A cloud worker writes a Git, WebDAV, or object-storage copy of the vault and
Obsidian synchronizes with that copy. This removes dependence on the owner's Mac
being online, but creates another sensitive cloud copy, adds a second conflict
system, and broadens the security boundary.

### On-demand local bridge over an outbound WebSocket — chosen

The bridge maintains one low-cost outbound connection. A user action wakes it
immediately without exposing a listening port on the Mac. If the bridge is
offline, durable jobs remain in PostgreSQL until it reconnects.

This option preserves vault privacy, gives prompt feedback on phone or desktop,
and avoids polling. It also leaves a future cloud worker possible without
changing the application-facing synchronization contract.

## Components

### Prepify web client

The Journey and Daily entry points show:

- the last successful synchronization time;
- the current state: `synced`, `pending`, `syncing`, `conflict`, `failed`, or
  `bridge_offline`;
- a **Sync Obsidian** button;
- concise conflict or retry guidance.

Entering Journey or Daily does not silently scan the vault. The user explicitly
starts synchronization. When the bridge is offline, existing projected content
remains readable, but mutations that could conflict with Obsidian are disabled.
The database-owned Daily quiz remains usable; completing it creates a pending
summary for the next vault synchronization rather than blocking study.

### Deployed API

The API authenticates the user, authorizes the vault owner, creates durable sync
jobs, and reports their state. It never accepts a filesystem path from a remote
request and never accesses the vault.

The API owns the WebSocket endpoint used by the bridge. The connection is
outbound from the Mac, authenticated with a separate bridge credential, and
limited to one owner and one vault identity.

### PostgreSQL

Append-only migrations add three durable concepts:

- a projection of the allowlisted Daily and Journey structure used by the app;
- synchronization jobs with idempotency keys, expected revisions, state,
  leases, retry counters, and sanitized failure metadata;
- audit events recording who requested, claimed, applied, conflicted, retried,
  or cancelled a synchronization.

The database stores the minimum structured projection required by Prepify. It
does not become a general copy of the entire second brain.

### HeheVault bridge

The bridge is installed locally and started by macOS `launchd`. Configuration
contains the deployed API URL, vault path, vault identity, and bridge credential.
Secrets remain outside Git and should be stored in the macOS Keychain or an
owner-only local configuration file.

The bridge:

1. receives a sync notification over the existing WebSocket;
2. claims the corresponding job with a bounded lease;
3. reads only the allowlisted vault surface;
4. compares file and database revisions;
5. applies safe changes atomically or reports a conflict;
6. uploads the resulting structured projection;
7. marks the job successful using the same idempotency key.

Reconnection checks for pending jobs once. It does not start recurring
filesystem scans.

## Synchronization flow

### Database to Obsidian

1. A structured Journey or Daily mutation commits to PostgreSQL.
2. The same transaction creates an outbox job.
3. The API notifies the connected bridge.
4. The bridge applies the mutation to the allowlisted Markdown section using
   the expected revision.
5. The bridge returns the new revision and projection; the API marks the job
   `synced`.

The database mutation is not rolled back merely because the Mac is offline.
Its sync state remains visible and retryable.

### Obsidian to database

When the user presses **Sync Obsidian**, the bridge first reads the current
allowlisted Daily and Journey notes and submits their revision plus structured
projection. The API validates changed structured fields as commands, commits
accepted changes to canonical database records, and then sends pending
database-to-vault jobs. This pull-then-push order prevents an older database
projection from overwriting a newer local note.

Changes to narrative sections remain owned by Obsidian. The app stores only the
projection necessary to display them and does not treat that projection as an
independent editable copy.

## Implementation status (2026-09-13)

Implemented on `feat/overhaul-completion` (PR #11). Two points below ended up
different from this spec and are recorded here so the document is not misleading:

- **Field-level merge is not implemented.** The rule "Changes to different owned
  fields may be merged deterministically" did not ship. Conflicts are
  **whole-note**: one SHA-256 revision per note, and any concurrent change to the
  note becomes `conflict`. The bridge supplies the conflicting field names as an
  advisory, server-validated list; the server does not compute a field diff.
- **Conflict field names are pass-through, not server-derived.**
  "Conflict responses include field names and revisions" is satisfied because the
  bridge sends a validated `fields` array and the server echoes it beside both
  revisions. The server never reconstructs which fields collided.

Everything else — durable projection/outbox, on-demand user-triggered sync, one
outbound WebSocket, no background polling, bridge-only vault access, offline
gating, and revision compare-and-swap — shipped as designed and was verified by a
36/36 smoke matrix.

## Revision and conflict rules

- Every synchronized note has a stable logical identifier and SHA-256 revision.
- Every mutation has a unique idempotency key.
- A worker claim has an expiry so interrupted work can be retried.
- Repeating an already completed mutation returns the previous result.
- Changes to different owned fields may be merged deterministically.
- Concurrent changes to the same field become `conflict`; neither side is
  overwritten automatically.
- Conflict responses include field names and revisions, never full private note
  contents in logs.

## Availability and deployment

Prepify frontend, API, and PostgreSQL deploy independently of the vault. Quiz,
Library, authentication, and other database-backed features continue working
when the bridge is offline.

The bridge is not deployed publicly. It runs on the owner's always-on Mac and
needs only outbound HTTPS/WebSocket access. A phone can request synchronization
through the deployed app because the request is stored in PostgreSQL and pushed
over that outbound connection.

If the Mac or bridge is offline, the UI reports that state and retains the job.
Once the bridge reconnects, it checks pending work and can complete the same job
without duplication.

## Security boundaries

- Library and Journey authorization remains server-enforced.
- Bridge credentials are separate from browser sessions, narrowly scoped,
  revocable, and never returned to the web client.
- The server validates vault identity, job ownership, idempotency, revisions,
  payload size, and allowed operation types.
- Hosted requests cannot provide arbitrary paths or Markdown patches.
- The bridge resolves all target paths against its configured vault root and
  rejects traversal or symlink escapes.
- Writes use a temporary sibling file and atomic replacement.
- Logs and audit events contain identifiers and status, not personal vault text.

## Private Library corpus boundary

The tracked Vietnamese corpus under `content/` is migrated to an owner-controlled
local directory. `/content/` is ignored by Git, existing files are removed only
from the Git index, and no local corpus file is deleted. `CONTENT_ROOT` is
validated and injected at the composition root. Synthetic committed fixtures
under `server/test-fixtures/content/` cover tests without exposing the real
corpus.

## Learning-result integrity

Daily continues using a sealed server-issued challenge and server-side grading.
For ordinary quiz sessions, the server no longer accepts a client-asserted score
as trusted progress. Until server-issued quiz attempts are implemented, only
non-scored flashcard study activity is persisted. Scored MCQ completion requires
a sealed attempt containing the question identities and answer keys needed for
server-side grading.

## Auditability and delivery process

Previously implemented Admin, Library data-layer, and Library authoring plans are
reconciled against commits and current verification before their checkboxes are
updated. A checkbox is marked complete only when its outcome can still be
verified; historical RED execution is documented as historical evidence only
when a commit or saved record proves it.

Future implementation uses one isolated worktree and the current Superpowers
workflow. Review packages and task progress live in the ignored
`.superpowers/sdd/` workspace during execution. The final documentation records
fresh verification results without claiming retroactive proof that does not
exist.

## Testing and release evidence

The implementation must include:

- RED/GREEN unit tests for quiz attempt validation and server-side grading;
- repository tests for idempotency, leasing, retry, success, and conflict state;
- route tests proving hosted requests cannot access a vault path;
- bridge tests for allowlisting, traversal rejection, atomic writes, reconnect,
  and duplicate delivery;
- client tests for sync state and disabled mutations while offline/conflicted;
- repository privacy and production bundle scans;
- migration-ordering checks;
- full `npm run check` on the completed branch;
- a local HTTP/WebSocket smoke test covering authentication, authorization,
  bridge connection, phone-originated sync, conflict, reconnect, and logout.

## Rollout

1. Reconcile completed historical plans without inventing evidence.
2. Remove the private corpus from Git tracking while preserving local files.
3. Protect learning-result integrity.
4. Add projection, outbox, audit, and bridge authentication schema.
5. Implement the local bridge and on-demand WebSocket protocol.
6. Add the Journey/Daily sync UI and offline/conflict behavior.
7. Run release verification, update ADRs and plans, then merge locally without
   pushing.

## Consequences

Prepify can be deployed without exposing the vault and can receive sync requests
from a phone. Obsidian remains the second-brain surface used for rich personal
context, while PostgreSQL provides dependable application state.

The owner's Mac must be online for immediate vault synchronization. Operating a
future cloud mirror remains a separate decision and is not required by this
design.

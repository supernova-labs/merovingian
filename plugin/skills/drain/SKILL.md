---
name: drain
description: Review accumulated Merovingian journals, tracked frictions and authorized historical evidence with the human. Use for a governance review that turns agreed findings into graph changes, plugin improvements or issues.
---

# Governance review

Run when the human requests a governance pass. Establish the tenant and authorized
sources: the authenticated Journal MCP, the tenant's issue tracker, and an administrative
historical archive when the operator has access. Routine setup belongs to `tenant-admin`.

## Gather evidence

List journals within the authenticated person's access. An explicit journal administrator
can read all tenant journals; purpose ownership alone cannot. The motor provides a direct
paginated list, not a pending queue or processing status. Preserve IDs and references and
use the issue tracker to determine whether earlier work was already addressed.

Read old friction/decision material from the preserved administrative archive only when
relevant. Do not expose that restricted archive to members or restore it into the active
tenant. Missing access is a limitation to report, not a reason to change permissions.

## Discuss and act

Synthesize concrete tensions with evidence, existing destinations and decisions needed
from the human. Do not convert a tentative journal entry into binding policy.

For agreed changes, use the appropriate destination:

- Structure, assignments and general instructions: tenant `graph.yaml`, followed by
  provider plan/review/apply within the authorized scope.
- Behavior and approved operating rules: the tenant's plugin skills and instructions,
  reviewed and distributed through its marketplace workflow.
- Work needing execution or collective judgment: the tenant's issue/review workflow.
  The motor does not implement a shared judgment queue.

Record outcomes and links in the agreed issue or a new journal entry where appropriate.
Journals remain immutable: no edit, delete, drained stamp, resolution field or hidden
processed cursor is introduced. Corrections and continuity use references in new entries.
Avoid recreating issues already linked from previous reviews.

## Close the loop

Summarize the human's decisions, implemented changes, deferred items and remaining
questions. Preserve unrelated work and use reviewable commits. Publishing, merging and
provider mutations require the relevant authorization; never auto-merge merely because
no remote exists. Historical friction triage is post-major work and does not block release.

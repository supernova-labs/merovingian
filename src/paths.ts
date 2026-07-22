// Machine-level locations. Config lives in a dot-dir (hidden); the repo store
// is visible (you cd/branch/worktree into it). Per-machine = per-human.

import { homedir } from "node:os";
import { basename, join } from "node:path";

/** ~/.merovingian/<ns>/currentuser.json — who is logged into this tenant. */
export function sessionFile(namespace: string, home = homedir()): string {
  return join(home, ".merovingian", namespace, "currentuser.json");
}

/** ~/merovingian/<ns>/repos — central clone store for this tenant. */
export function repoStore(namespace: string, home = homedir()): string {
  return join(home, "merovingian", namespace, "repos");
}

/** Local store dir for an okf repo. `repo` may be a full slug (`org/name`) — the
 *  org gives multi-org KB for free; the local dir is flat, keyed by the bare name. */
export function repoDir(storeRoot: string, repo: string): string {
  return join(storeRoot, basename(repo));
}

/** ~/.merovingian/<ns>/namespace.json — ns → service endpoint (remote transport). */
export function namespaceFile(namespace: string, home = homedir()): string {
  return join(home, ".merovingian", namespace, "namespace.json");
}

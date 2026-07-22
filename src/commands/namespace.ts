// `merovingian namespace add <namespace> <url>` — register a namespace as served
// by a remote build/auth service. After this, login/build/graph go over HTTP.

import { writeNamespace } from "../transport.ts";

export async function namespaceAdd(namespace: string, url: string): Promise<void> {
  await writeNamespace(namespace, { transport: "remote", url: url.replace(/\/$/, "") });
  console.log(`namespace "${namespace}" → ${url} (remote). Now: merovingian login ${namespace}`);
}

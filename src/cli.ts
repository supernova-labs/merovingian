// Hand-rolled arg parsing + dispatch (harny house style — no arg-parser dep).
//
// Commands:
//   merovingian login <namespace> <user>
//   merovingian graph <namespace> [--backend stub|surreal]
//   merovingian build <namespace> [--purposes a,b,c] [--backend stub|surreal]
//   merovingian reset [--graph P]              (dev/test: wipe structure + reproject)

import { login } from "./commands/login.ts";
import { build } from "./commands/build.ts";
import { graph } from "./commands/graph.ts";
import { reset } from "./commands/reset.ts";
import { data } from "./commands/data.ts";
import { passwd } from "./commands/passwd.ts";
import { inbox } from "./commands/inbox.ts";
import { decisions } from "./commands/decisions.ts";
import { namespaceAdd } from "./commands/namespace.ts";
import { startConsole } from "./server/console.ts";
import { deployPlan, deployApply } from "./commands/deploy.ts";
import { init } from "./commands/init.ts";
import { libraryUpdate, renderLibraryUpdate } from "./commands/library.ts";
import { pluginsSync } from "./commands/plugins.ts";
import { planIsEmpty } from "./graph/plan.ts";
import { startUpdateCheck, notifyUpdate } from "./update-check.ts";
import type { Backend } from "./service/build-service.ts";

const USAGE = `merovingian — build CLI (stub + surreal)

Usage:
  merovingian init <tenant> --owner <id> --github <login>   scaffold a tenant repo (graph + seeded library, in ./<tenant>/)
  merovingian namespace add <namespace> <url>      register a namespace served by a remote service
  merovingian login <namespace> [user]             authenticate (gh if remote; <user> if local)
  merovingian graph <namespace>                    show your personal access graph
  merovingian build <namespace> [--purposes a,b]   project the workspace (in cwd)
  merovingian reset [--graph P]                    DEV/TEST: wipe structure + reproject (never on a live tenant — first run is just deploy apply)
  merovingian data <namespace> <table>             list rows the logged-in user CAN see (enforced by Surreal)
  merovingian passwd <namespace> <user>            set/rotate a person's SIGNIN password (operator; reads MEROVINGIAN_NEW_PASS or stdin)
  merovingian inbox <namespace> [--all] [--drain [--ids a,b]] [--rescope <id> --to <purpose|root>]   governance drain (root): list/stamp/triage the learning inbox
  merovingian mcp <inbox|decisions|surreal-data>            run a bundled system MCP server (stdio — what the emitted .mcp.json invokes)
  merovingian decisions <namespace> [--all] [--drain [--ids a,b]]   governance drain (root): the in-flight decision log (promotion candidates)
  merovingian console <namespace> [--port N]       serve the Architect console (read-only god-view, 127.0.0.1)
  merovingian deploy plan [--graph P]              audit: diff graph.yaml × Surreal (read-only; exit 1=drift 2=invalid)
  merovingian deploy apply [--graph P] [--yes]     converge Surreal to graph.yaml (structure only; --yes to allow deletes)
  merovingian library update [--graph P] [--yes]   refresh the seeded library from the Source templates (audit-first)
  merovingian plugins sync                         install the Codex plugins required by this built workspace

  --owner id · --github login   the founding owner for init
  --graph P            path to the graph.yaml (authoring commands; default ./graph.yaml in cwd)
  --purposes a,b       narrow the build to a subset of accessible purposes
  --backend stub|surreal   backend for login/graph/build/console (default: surreal; stub = the offline acme fixture)
  --all                also show already-drained entries (inbox/decisions)
  --drain · --ids a,b  stamp entries drained (all undrained, or only --ids)
  --port N             port for the console (default 8888; env CONSOLE_PORT)

Authoring commands (deploy, reset) read the graph from --graph / ./graph.yaml (a tenant repo).
Runtime commands (build/graph/console/…) take a namespace (selects the db / stub). Example tenant: acme
`;

export interface ParsedArgs {
  command: "namespace" | "login" | "graph" | "build" | "reset" | "data" | "passwd" | "inbox" | "decisions" | "console" | "deploy" | "init" | "library" | "plugins" | "mcp" | "help";
  namespace?: string;
  user?: string;
  url?: string;
  owner?: string;
  github?: string;
  purposes?: string[];
  backend?: Backend;
  port?: number;
  subcommand?: string;
  yes?: boolean;
  graph?: string;
  table?: string;
  all?: boolean;
  drain?: boolean;
  ids?: string[];
  rescope?: string;
  to?: string;
}

function splitList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Pull --purposes and --backend (space or = form) out of argv; keep positionals. */
function extractFlags(rest: string[]): { positionals: string[]; purposes?: string[]; backend?: Backend; port?: number; yes?: boolean; graph?: string; owner?: string; github?: string; all?: boolean; drain?: boolean; ids?: string[]; rescope?: string; to?: string } {
  const positionals: string[] = [];
  let purposes: string[] | undefined;
  let backend: Backend | undefined;
  let port: number | undefined;
  let yes: boolean | undefined;
  let graph: string | undefined;
  let owner: string | undefined;
  let github: string | undefined;
  let all: boolean | undefined;
  let drain: boolean | undefined;
  let ids: string[] | undefined;
  let rescope: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--purposes") purposes = splitList(rest[++i]);
    else if (a.startsWith("--purposes=")) purposes = splitList(a.slice("--purposes=".length));
    else if (a === "--backend") backend = asBackend(rest[++i]);
    else if (a.startsWith("--backend=")) backend = asBackend(a.slice("--backend=".length));
    else if (a === "--port") port = Number(rest[++i]);
    else if (a.startsWith("--port=")) port = Number(a.slice("--port=".length));
    else if (a === "--graph") graph = rest[++i];
    else if (a.startsWith("--graph=")) graph = a.slice("--graph=".length);
    else if (a === "--owner") owner = rest[++i];
    else if (a.startsWith("--owner=")) owner = a.slice("--owner=".length);
    else if (a === "--github") github = rest[++i];
    else if (a.startsWith("--github=")) github = a.slice("--github=".length);
    else if (a === "--ids") ids = splitList(rest[++i]);
    else if (a.startsWith("--ids=")) ids = splitList(a.slice("--ids=".length));
    else if (a === "--rescope") rescope = rest[++i];
    else if (a.startsWith("--rescope=")) rescope = a.slice("--rescope=".length);
    else if (a === "--to") to = rest[++i];
    else if (a.startsWith("--to=")) to = a.slice("--to=".length);
    else if (a === "--all") all = true;
    else if (a === "--drain") drain = true;
    else if (a === "--yes" || a === "-y") yes = true;
    else positionals.push(a);
  }
  return { positionals, purposes, backend, port, yes, graph, owner, github, all, drain, ids, rescope, to };
}

function asBackend(v: string | undefined): Backend {
  if (v === "stub" || v === "surreal") return v;
  throw new Error(`--backend must be "stub" or "surreal" (got "${v ?? ""}")`);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return { command: "help" };
  if (cmd === "namespace") {
    // namespace add <ns> <url>
    if (rest[0] !== "add") throw new Error(`usage: merovingian namespace add <namespace> <url>`);
    return { command: "namespace", namespace: rest[1], url: rest[2] };
  }
  if (cmd === "init") {
    const { positionals, owner, github } = extractFlags(rest);
    return { command: "init", namespace: positionals[0], owner, github };
  }
  if (cmd === "library") {
    // library update [--graph P] [--yes]
    const { graph, yes } = extractFlags(rest.slice(1));
    return { command: "library", subcommand: rest[0], graph, yes };
  }
  if (cmd === "plugins") {
    return { command: "plugins", subcommand: rest[0] };
  }
  if (cmd === "login") {
    const { positionals, backend } = extractFlags(rest);
    return { command: "login", namespace: positionals[0], user: positionals[1], backend };
  }
  if (cmd === "graph") {
    const { positionals, backend } = extractFlags(rest);
    return { command: "graph", namespace: positionals[0], backend };
  }
  if (cmd === "build") {
    const { positionals, purposes, backend } = extractFlags(rest);
    return { command: "build", namespace: positionals[0], purposes, backend };
  }
  if (cmd === "reset") {
    const { graph } = extractFlags(rest);
    return { command: "reset", graph };
  }
  if (cmd === "data") return { command: "data", namespace: rest[0], table: rest[1] };
  if (cmd === "passwd") return { command: "passwd", namespace: rest[0], user: rest[1] };
  if (cmd === "inbox" || cmd === "decisions") {
    const { positionals, all, drain, ids, rescope, to } = extractFlags(rest);
    return { command: cmd, namespace: positionals[0], all, drain, ids, rescope, to };
  }
  if (cmd === "console") {
    const { positionals, backend, port } = extractFlags(rest);
    return { command: "console", namespace: positionals[0], backend, port };
  }
  // system MCP servers (stdio) — what the emitted .mcp.json invokes. `namespace`
  // carries the server name (inbox | decisions | surreal-data).
  if (cmd === "mcp") return { command: "mcp", namespace: rest[0] };
  if (cmd === "deploy") {
    // deploy <plan|apply> [--graph P] [--yes]
    const { graph, yes } = extractFlags(rest.slice(1));
    return { command: "deploy", subcommand: rest[0], graph, yes };
  }
  throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  // overlaps the command's own work; prints (stderr) only after it finishes
  const update = startUpdateCheck(parsed.command);
  try {
    await run(parsed);
  } finally {
    await notifyUpdate(update);
  }
}

async function run(parsed: ParsedArgs): Promise<void> {
  if (parsed.command === "help") {
    console.log(USAGE);
    return;
  }

  if (parsed.command === "namespace") {
    if (!parsed.namespace || !parsed.url) throw new Error(`usage: merovingian namespace add <namespace> <url>`);
    await namespaceAdd(parsed.namespace, parsed.url);
    return;
  }

  if (parsed.command === "init") {
    if (!parsed.namespace) throw new Error(`init needs a tenant name\n\n${USAGE}`);
    if (!parsed.owner || !parsed.github) throw new Error(`init needs --owner <id> --github <login>\n\n${USAGE}`);
    await init(parsed.namespace, { owner: parsed.owner, github: parsed.github });
    return;
  }

  if (parsed.command === "login") {
    if (!parsed.namespace) throw new Error(`login needs a namespace\n\n${USAGE}`);
    await login(parsed.namespace, parsed.user, { backend: parsed.backend });
    return;
  }

  if (parsed.command === "graph") {
    if (!parsed.namespace) throw new Error(`graph needs a namespace\n\n${USAGE}`);
    await graph(parsed.namespace, { backend: parsed.backend });
    return;
  }

  if (parsed.command === "build") {
    if (!parsed.namespace) throw new Error(`build needs a namespace\n\n${USAGE}`);
    await build(parsed.namespace, { purposes: parsed.purposes, backend: parsed.backend });
    return;
  }

  if (parsed.command === "reset") {
    await reset({ graph: parsed.graph });
    return;
  }

  if (parsed.command === "data") {
    if (!parsed.namespace || !parsed.table) throw new Error(`usage: merovingian data <namespace> <table>\n\n${USAGE}`);
    await data(parsed.namespace, parsed.table);
    return;
  }

  if (parsed.command === "passwd") {
    if (!parsed.namespace || !parsed.user) throw new Error(`usage: merovingian passwd <namespace> <user>\n\n${USAGE}`);
    await passwd(parsed.namespace, parsed.user);
    return;
  }

  if (parsed.command === "inbox" || parsed.command === "decisions") {
    if (!parsed.namespace) throw new Error(`${parsed.command} needs a namespace\n\n${USAGE}`);
    if (parsed.ids && !parsed.drain) throw new Error(`--ids only narrows --drain\n\n${USAGE}`);
    if (parsed.rescope && parsed.command !== "inbox") throw new Error(`--rescope is an inbox flag (ADR 0014)\n\n${USAGE}`);
    if (parsed.command === "inbox") {
      await inbox(parsed.namespace, { all: parsed.all, drain: parsed.drain, ids: parsed.ids, rescope: parsed.rescope, to: parsed.to });
    } else {
      await decisions(parsed.namespace, { all: parsed.all, drain: parsed.drain, ids: parsed.ids });
    }
    return;
  }

  if (parsed.command === "mcp") {
    // stdio protocol lives on stdout — NEVER print here; the servers log to stderr.
    const name = parsed.namespace;
    if (name === "inbox") return (await import("./mcp/inbox.ts")).serveStdio();
    if (name === "decisions") return (await import("./mcp/decisions.ts")).serveStdio();
    if (name === "surreal-data") return (await import("./mcp/surreal-data.ts")).serveStdio();
    throw new Error(`unknown mcp server "${name ?? ""}" — inbox | decisions | surreal-data`);
  }

  if (parsed.command === "console") {
    if (!parsed.namespace) throw new Error(`console needs a namespace\n\n${USAGE}`);
    const { port, namespace, backend: be } = startConsole({ namespace: parsed.namespace, backend: parsed.backend, port: parsed.port });
    console.error(`architect console at http://127.0.0.1:${port}  (${namespace} · ${be} · read-only · no auth)`);
    return;
  }

  if (parsed.command === "library") {
    if (parsed.subcommand !== "update") throw new Error(`usage: merovingian library update [--graph P] [--yes]`);
    const result = await libraryUpdate({ graph: parsed.graph, yes: parsed.yes });
    renderLibraryUpdate(result);
    // exit: 1 = drift pending · 0 = in sync / applied
    process.exitCode = result.status === "drift" ? 1 : 0;
    return;
  }

  if (parsed.command === "plugins") {
    if (parsed.subcommand !== "sync") throw new Error(`usage: merovingian plugins sync`);
    const result = await pluginsSync();
    for (const name of result.addedMarketplaces) console.log(`added Codex marketplace ${name}`);
    for (const id of result.installedPlugins) console.log(`installed Codex plugin ${id}`);
    for (const id of result.alreadyPresent) console.log(`Codex plugin already present ${id}`);
    if (!result.installedPlugins.length && !result.addedMarketplaces.length) {
      console.log("Codex plugins are in sync");
    }
    return;
  }

  if (parsed.command === "deploy") {
    if (parsed.subcommand !== "plan" && parsed.subcommand !== "apply") {
      throw new Error(`usage: merovingian deploy <plan|apply> [--graph P] [--yes]`);
    }

    if (parsed.subcommand === "plan") {
      const result = await deployPlan({ graph: parsed.graph });
      // exit: 2 = invalid yaml · 1 = drift pending · 0 = in sync
      process.exitCode = result.validationErrors.length ? 2 : result.plan && !planIsEmpty(result.plan) ? 1 : 0;
      return;
    }

    // apply
    const result = await deployApply({ graph: parsed.graph, yes: parsed.yes });
    // exit: 2 = invalid · 1 = needs-confirm/blocked · 0 = applied
    process.exitCode = result.status === "invalid" ? 2 : result.status === "applied" ? 0 : 1;
    return;
  }
}

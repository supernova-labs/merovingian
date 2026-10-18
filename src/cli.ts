import { historyCommand } from "./commands/history.ts";
import { deployGithub } from "./commands/github.ts";
// Hand-rolled arg parsing + dispatch (harny house style — no arg-parser dep).
//
// Commands:
//   merovingian login <namespace> <user>
//   merovingian graph <namespace> [--backend stub|surreal]
//   merovingian reset [--graph P]              (dev/test: wipe structure + reproject)

import { login } from "./commands/login.ts";
import { graph } from "./commands/graph.ts";
import { reset } from "./commands/reset.ts";
import { data } from "./commands/data.ts";
import { passwd } from "./commands/passwd.ts";
import { startConsole } from "./server/console.ts";
import { deployPlan, deployApply } from "./commands/deploy.ts";
import { init } from "./commands/init.ts";
import { planIsEmpty } from "./graph/plan.ts";
import { startUpdateCheck, notifyUpdate } from "./update-check.ts";
import type { Backend } from "./service/access.ts";
import pkg from "../package.json";

const USAGE = `merovingian — purpose graph, catalog and journal

Usage:
  merovingian history export --graph P --output DIR   archive legacy history (admin, read-only)
  merovingian history verify --archive DIR           verify archive integrity
  merovingian --version                              print the installed CLI version
  merovingian init <tenant> --owner <id> --github <login>   scaffold a tenant repo (graph and connection, in ./<tenant>/)
  merovingian login <namespace> [user]             authenticate with your individual password
  merovingian graph <namespace>                    show your personal access graph
  merovingian reset [--graph P]                    DEV/TEST: wipe structure + reproject (never on a live tenant — first run is just deploy apply)
  merovingian data <namespace> <table>             list rows the logged-in user CAN see (enforced by Surreal)
  merovingian passwd <namespace> <user>            set/rotate a person's SIGNIN password (operator; reads MEROVINGIAN_NEW_PASS or stdin)
  merovingian mcp <catalog|journal|surreal-data>            run a bundled MCP server (stdio)
  merovingian console <namespace> [--port N]       serve the Architect console (read-only god-view, 127.0.0.1)
  merovingian deploy github-plan [--graph P]       audit GitHub ACLs and PR protections; emits an approval revision
  merovingian deploy github-apply --approve HASH   apply reviewed GitHub plan [--graph P] [--scope all|permissions|protections]
  merovingian deploy plan [--graph P]              audit: diff graph.yaml × Surreal (read-only; exit 1=drift 2=invalid)
  merovingian deploy apply [--graph P] [--yes]     converge Surreal to graph.yaml (structure only; --yes to allow deletes)

  --owner id · --github login   the founding owner for init
  --graph P            path to the graph.yaml (authoring commands; default ./graph.yaml in cwd)
  --backend stub|surreal   backend for login/graph/console (default: surreal; stub = the offline acme fixture)
  --port N             port for the console (default 8888; env CONSOLE_PORT)

Authoring commands (deploy, reset) read the graph from --graph / ./graph.yaml (a tenant repo).
Runtime commands (graph/console/…) take a namespace (selects the db / stub). Example tenant: acme
`;

export interface ParsedArgs {
  command: "login" | "graph" | "reset" | "data" | "passwd" | "console" | "deploy" | "init" | "mcp" | "help" | "version";
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
  if (cmd === "version" || cmd === "--version" || cmd === "-v") return { command: "version" };

  if (cmd === "init") {
    const { positionals, owner, github } = extractFlags(rest);
    return { command: "init", namespace: positionals[0], owner, github };
  }


  if (cmd === "login") {
    const { positionals, backend } = extractFlags(rest);
    return { command: "login", namespace: positionals[0], user: positionals[1], backend };
  }
  if (cmd === "graph") {
    const { positionals, backend } = extractFlags(rest);
    return { command: "graph", namespace: positionals[0], backend };
  }

  if (cmd === "reset") {
    const { graph } = extractFlags(rest);
    return { command: "reset", graph };
  }
  if (cmd === "data") return { command: "data", namespace: rest[0], table: rest[1] };
  if (cmd === "passwd") return { command: "passwd", namespace: rest[0], user: rest[1] };

  if (cmd === "console") {
    const { positionals, backend, port } = extractFlags(rest);
    return { command: "console", namespace: positionals[0], backend, port };
  }
  // Bundled runtime MCP servers (stdio).
  if (cmd === "mcp") return { command: "mcp", namespace: rest[0] };
  if (cmd === "deploy") {
    // deploy <plan|apply> [--graph P] [--yes]
    const { graph, yes } = extractFlags(rest.slice(1));
    return { command: "deploy", subcommand: rest[0], graph, yes };
  }
  throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "history") { await historyCommand(argv.slice(1)); return; }
  if (argv[0] === "deploy" && ["github-plan", "github-apply"].includes(argv[1] ?? "")) {
    await deployGithub(argv.slice(1));
    return;
  }
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

  if (parsed.command === "version") {
    console.log(`merovingian ${pkg.version}`);
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



  if (parsed.command === "mcp") {
    // stdio protocol lives on stdout — NEVER print here; the servers log to stderr.
    const name = parsed.namespace;
    if (name === "journal") return (await import("./mcp/journal.ts")).serveStdio();
    if (name === "catalog") return (await import("./mcp/catalog.ts")).serveStdio();
    if (name === "surreal-data") return (await import("./mcp/surreal-data.ts")).serveStdio();
    throw new Error(`unknown mcp server "${name ?? ""}" — catalog | journal | surreal-data`);
  }

  if (parsed.command === "console") {
    if (!parsed.namespace) throw new Error(`console needs a namespace\n\n${USAGE}`);
    const { port, namespace, backend: be } = startConsole({ namespace: parsed.namespace, backend: parsed.backend, port: parsed.port });
    console.error(`architect console at http://127.0.0.1:${port}  (${namespace} · ${be} · read-only · no auth)`);
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

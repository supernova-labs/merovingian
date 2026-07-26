# Guide — onboarding a member

The two-sided runbook for adding a person to a live tenant: what the **operator** runs, and
the copy-paste instructions the **member** follows. Under password SIGNIN (ADR 0015) with
structural reads by lineage (ADR 0016), the member's own password covers the entire cycle —
`login`, `graph`, `build`, `data`, and the workspace MCPs. **No system credential ever
lands on a member's machine.**

## Operator side (once per person)

Pre-conditions: the person exists in the graph (`users:` + an assignment in `graph.yaml`,
shipped by `deploy apply`), and their GitHub account can read the tenant's KB repos (see
[GitHub access](#github-access) — the graph does not automate this).

From the **tenant repo** (its gitignored `.env` holds your operator `SURREAL_USER`/`SURREAL_PASS`):

```bash
PW=$(openssl rand -base64 18)
echo "password for <uid> (hand over via a secure channel): $PW"
MEROVINGIAN_NEW_PASS="$PW" merovingian passwd <namespace> <uid>
unset PW
```

> Capture the password BEFORE hashing it — a bare
> `openssl rand | merovingian passwd ...` pipe sets a password nobody ever saw.
> Deliver it over a secure channel (password manager, Signal); the member stores it in
> their workspace `.env`, not in their head. Rotation is the same command again.

## Member side (copy-paste)

You need three things from the operator: your **uid**, your **password**, and the
tenant's **database URL**.

**1. Prerequisites**

```bash
curl -fsSL https://bun.sh/install | bash    # Bun >= 1.3 (reopen the terminal after)
gh auth login                               # a GitHub account with access to the tenant's KB repos
bun add -g @supernova-labs/merovingian
```

**2. Workspace + credentials**

```bash
mkdir -p ~/workspaces/<namespace> && cd ~/workspaces/<namespace>
cat > .env <<'EOF'
SURREAL_URL=<the tenant database url, e.g. wss://db.example.com/rpc>
MEROVINGIAN_USER=<your uid>
MEROVINGIAN_PASS=<your password>
EOF
chmod 600 .env
```

The `SURREAL_URL` line matters: the per-machine namespace registry is written by authoring
commands from the tenant repo — which a member does not have — so the env var is how your
machine finds the database. The `.env` is your personal credential file: never commit it,
never share it.

**3. Log in and project**

```bash
merovingian login <namespace> <your-uid>    # expect: logged in as <your name>
merovingian build <namespace>               # materializes YOUR slice into this folder
```

Open the folder in Claude Code or Codex. The native root instructions, skills, subagents,
`context/` mounts and scoped MCPs are exactly your slice of the graph, enforced by the database
(ADR 0016), not by convention. If build reports missing Codex plugins, run
`merovingian plugins sync`.

**Troubleshooting**

- `There was a problem with authentication` on login → wrong password, or the `.env` is not
  in the directory you ran the command from (it is loaded from the cwd).
- `⚠ context/<kb> not mounted` on build → your `gh auth login` account lacks access to that
  KB repo — ask the operator (below).
- `not logged in to "<ns>"` → run `login` before `build`/`graph`/`data`.

## GitHub access

The graph declares which KB repos a member's slice reads (`okf-repo` buckets), but
**granting the GitHub-side access is not automated** — the operator must invite the
person's GitHub account to those repos (or a team that carries them). Audit what a person
is missing by diffing their manifest's `okf` list against their actual GitHub access
(`gh api repos/<owner>/<repo>/collaborators/<login>`). Track: automating this from the
graph is a natural `deploy`-side feature (see issue #3 — apply reaching gh).

## See also

- [operating-a-tenant](operating-a-tenant.md) — the operator lifecycle this slots into (§6).
- [connection-and-secrets](connection-and-secrets.md) — where every credential lives.
- [going-to-production](going-to-production.md) — the SIGNIN rollout model and its
  private-network condition.

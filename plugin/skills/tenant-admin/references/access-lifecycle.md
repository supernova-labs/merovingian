# Member and access lifecycle

Use this reference for adding, changing, verifying, rotating, or removing a person's access.

## Add a member

1. In the tenant repo, add the person under `users:` and add at least one assignment in
   `graph.yaml`.
2. Choose `role: owner` or `role: member`. The workspace and data reach are role-blind; the role
   records accountability. An owner assignment cannot carry a scope.
3. Add an optional member `scope` only when the purpose's bucket declarations support the intended
   slice. If someone owns only a slice, model that slice as a child purpose instead.
4. Run `merovingian deploy plan`, review the access edges, then `merovingian deploy apply`.
5. Complete the authentication path:
   - Password SIGNIN: set a unique password with `merovingian passwd <ns> <user>` and transfer it
     through a secure channel.
   - Remote service: ensure `users.<id>.github` matches the person's authenticated GitHub login.
6. Grant the person's GitHub account access to each entitled OKF repository. The graph declares the
   mount but does not modify GitHub ACLs.
7. Have the member log in and build from their own separate workspace folder.

For password SIGNIN, the member stores only this in their workspace's gitignored, mode-restricted
`.env`:

```dotenv
SURREAL_URL=<tenant database url>
MEROVINGIAN_USER=<their user id>
MEROVINGIAN_PASS=<their password>
```

They then run:

```bash
merovingian login <namespace> <user-id>
merovingian graph <namespace>
merovingian build <namespace>
```

Never give a member `SURREAL_USER`, `SURREAL_PASS`, or `MEROVINGIAN_JWT_SECRET`.

## Verify access

Verification has three distinct layers:

1. `merovingian graph <ns>` shows the structural slice returned for the logged-in identity.
2. `merovingian build <ns>` materializes that slice on the machine.
3. `merovingian data <ns> <table>` proves what Surreal PERMISSIONS actually return for a domain
   table. Use this for sensitive or row-scoped buckets.

Also verify OKF access with the member's own GitHub identity. A graph entitlement cannot make a
private repository clone succeed if GitHub denies it.

## Change assignments, roles, or scope

Edit the desired state and use the normal plan/apply loop. Inspect all changed edges in the plan.
After apply, the affected person's current workspace is stale until they rebuild. A narrower build
must remove previously generated files and mounts from Merovingian-owned inventories, but backend
permissions remain the source of truth even before the rebuild.

## Set or rotate a password

Use the operator surface against Surreal:

```bash
merovingian passwd <namespace> <user-id>
```

The command reads the new value from `MEROVINGIAN_NEW_PASS` or stdin and stores only an argon2 hash.
Generate and capture the value before invoking the command, transfer it through a secure channel,
and erase temporary shell state afterwards. Rotation uses the same command. Do not paste the value
into chat, logs, issues, commits, or command output that will be retained.

## Offboard a member

Offboarding crosses multiple boundaries; removing one edge is not enough:

1. Remove assignments or the user from `graph.yaml` according to whether access is being narrowed
   or terminated.
2. Run `deploy plan` and inspect every deletion. A user with live engine references may be blocked;
   re-point or resolve those references instead of bypassing the check.
3. Run `deploy apply --yes` only after explicit review. Removing the user also removes their
   password credential, so a future user with the same id does not inherit it.
4. Revoke GitHub repository/team access and any external marketplace or service access separately.
5. Treat existing workspaces and cloned OKF content as copies already delivered to that machine.
   Backend access is revoked by the graph/apply, but deleting local files is a separate device
   management action outside Merovingian.
6. Verify absence in the deployed graph and test that the old authentication path no longer works.

Do not promise remote erasure: Merovingian can revoke future access, not retrieve information that
was already projected or cloned onto a member-controlled machine.

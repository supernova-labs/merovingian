# Runtime topology

| Component | Runs where | Authority |
|---|---|---|
| SurrealDB | Tenant's durable, controlled network endpoint | Stores graph, credentials, journal and domain data; enforces permissions |
| Administrative CLI | Trusted operator machine or authorized automation | Surreal admin credentials for deploy/password/history; gh credential for GitHub |
| Catalog/Journal stdio MCPs | Member's machine, launched by native client | Individual password only |
| Plugins and setup skill | Native client installation | Client permissions and human-approved setup actions |
| Knowledge repositories | GitHub and approved local clones | GitHub ACL and local filesystem access |
| Administrative console | Trusted operator localhost | Full graph view, no application authentication |

The Merovingian tenant name maps to a Surreal database, inside a configured Surreal
namespace. Never infer tenant selection from the working-directory name alone.
Personal MCPs require the endpoint, database namespace, tenant database, user and
password explicitly; they do not consult the operator's connection registry.

There is no hosted build/auth service. Authentication does not require GitHub OAuth
for the Merovingian identity. Infrastructure provisioning, network access, durability,
backups and service monitoring remain operator responsibilities.

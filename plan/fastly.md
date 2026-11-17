# yabus: Deploying to Fastly Compute

**Status: exploratory. Nothing here is decided or scheduled.** This records what would be
involved so the other plans can avoid closing doors. It builds on [mvp.md](mvp.md) and
[jwt.md](jwt.md).

## Short answer

Plausible, but not as a straight port.

- The **front end** deploys easily: it is a client-side SPA, so it is just static files.
- The **server side** needs its storage and runtime assumptions reworked. It currently depends on
  Node/Bun APIs and a filesystem, and Fastly Compute has neither.
- Do **not** try to run SvelteKit's server runtime on Compute. Build the front end as a static
  SPA and write the API as a small separate Compute service.

## What Fastly Compute is, for this app's purposes

(Facts from Fastly's documentation, checked when this was written. Limits change, so re-check
before relying on any number.)

- Code is compiled to **WebAssembly**. The JavaScript runtime follows web standards (Fetch,
  Streams, Web Crypto, and the WinterTC "Minimum Common Web APIs"). It is **not Node.js**; Node is
  only used for build tooling. Do not count on `node:` modules being available.
- **No filesystem.** Persistent state goes in Fastly's edge data stores.
- **Each request runs in a fresh instance.** Module-level variables are not shared between
  requests, so in-memory caches, counters and indexes do not work.
- **Per-request limits** (defaults): 50 ms CPU time, 128 MB heap, a 2-minute maximum runtime, and
  up to 32 backend requests. The compiled package may be up to 100 MB.
- **KV Store** (key-value storage):
  - **Eventually consistent**: a write may not be visible at every edge location right away.
    List operations can ask for strong or eventual consistency.
  - About **1 write per second per item**; concurrent writes from different locations to the
    same key can overwrite each other.
  - Item size limit is 25 MB by default (the SDK reference says 30 MB; assume 25).
  - Limited number of stores per account, and a **monthly write quota** (the docs found listed
    250,000). Check both against real usage.
  - Key names cannot contain `#`, `;`, `?`, `^`, `|` or line breaks.
- **Secret Store** for secrets and **Config Store** for read-only configuration. There are no
  environment variables at runtime.
- **Edge Rate Limiting** exists as a platform feature.

## How this app lines up

### Carries over unchanged

| Part | Why it works |
|---|---|
| The browser app (SvelteKit SPA, MapLibre, Svelte components) | `ssr = false`; it is already static files plus JavaScript. Swap the Bun adapter for `adapter-static` with an SPA fallback page. |
| OpenFreeMap tiles | A third-party service the browser calls directly. Only the future CSP needs to allow it. |
| `jose` (JWT) and `ulid` | Both use Web Crypto, which Compute provides. |
| `src/lib/geo/*`, `src/lib/sync/*`, `src/lib/map/*`, validation (`parseRoute`) | Pure TypeScript with no Node dependencies. The code was deliberately kept framework- and runtime-free so it could be tested with `bun test`. |
| The stateless JWT design ([jwt.md](jwt.md)) | No server-side session store is needed, which suits an edge platform. Dropping cookies and per-session directories removed the hardest part of the old design. |

### Needs replacing

| Today | Problem on Compute | Replacement |
|---|---|---|
| `data/{userName}/...` on the filesystem (`node:fs`, `node:path`) | No filesystem | **KV Store**: one key per route (`routes/{user}/{n}`), one per user record (`users/{user}`) |
| Atomic `mkdir` to claim a user name | No directories, and KV is eventually consistent | An **insert-only / conditional write** if the KV SDK offers one. **Unverified.** If not, name claims are racy and need another approach (see open questions) |
| `node:crypto` (`randomBytes`, `timingSafeEqual`) | Not Node | Web Crypto (`crypto.getRandomValues`, and an HMAC compare via `crypto.subtle`) |
| `process.env`, `process.cwd()`, `data/.jwt-secret` | No env vars, no files | **Secret Store** for the JWT secret; Config Store for settings (user cap, limits) |
| In-memory sign-up rate limiter | No shared memory between requests | **Edge Rate Limiting**, or counters in KV |
| `event.getClientAddress()` | SvelteKit-specific | The client address that Compute provides on the request |
| SvelteKit server endpoints (`+server.ts`) with the Bun adapter | No official SvelteKit adapter for Compute, and SvelteKit 3 is new | A small **separate Compute service** for the API (below) |
| `src/hooks.server.ts` | Same | Goes away with [jwt.md](jwt.md) (no sessions on page loads) |

## Proposed shape

```
Browser
  |
  |  https://yabus.example            (one Fastly domain, so no CORS)
  v
Fastly service
  |-- /api/*  ---> Compute service (the API)  ---> KV Store
  |                  - POST /api/users                 (sign-up)
  |                  - POST /api/session/renew
  |                  - GET    /api/users/{u}/routes[/{n}]
  |                  - PUT    /api/users/{u}/routes/{n}      (bearer token)
  |                  - DELETE /api/users/{u}/routes/{n}      (bearer token)
  |
  '-- everything else ---> static SPA files (built by adapter-static)
```

- **API service:** plain `Request`/`Response` handlers using `fastly:kv-store` and `jose`. It
  reuses the shared validation (`parseRoute`) and the same token rules as [jwt.md](jwt.md).
- **Static files:** served from Compute (published into KV or a static publisher), or from any
  origin placed behind Fastly. The SPA bundle (with MapLibre) is about a megabyte of JavaScript,
  well inside the package limit.
- **Valhalla** (deferred in [mvp.md](mvp.md)) **cannot run on Compute**. It is a native service
  with large tile data. Compute could sit in front of a Valhalla server hosted elsewhere and
  proxy `/api/valhalla/route` to it as a backend, but that server still has to live somewhere.

## What to do now so this stays possible

None of this requires deciding to use Fastly. It is cheap hygiene:

1. **Put storage behind an interface** (`RouteStore`: get, put, delete, list for a user; and
   `UserStore`: create, get). Ship the filesystem version first. A KV version could be added
   later without touching the endpoints.
2. **Avoid `node:` imports in new server code** where a Web API does the job. Keep Node-specific
   code inside the filesystem storage and the dev server glue.
3. **Keep request handling in plain functions of `Request` -> `Response`**, with SvelteKit
   endpoints as thin wrappers, so the same handlers could run in a Compute service.
4. **Do not rely on module-level state** in server code (indexes, caches, counters). The
   [jwt.md](jwt.md) design already avoids it.
5. **Keep the claim-a-name step isolated** in the user store, because it is the one piece that
   depends on filesystem atomicity.
6. **Do not add server-side rendering.** The SPA must stay static for this to work.

## Risks and unknowns

- **Atomic name claims on KV** are unverified (see above). This decides whether sign-up
  uniqueness is simple or needs a workaround.
- **Eventual consistency.** Likely fine: the sync rules already treat `localStorage` as the
  source of truth, reconcile only re-sends on a mismatch, and a user normally writes from one
  place. Worst cases are an extra `PUT`, or a read-only view showing a copy that is a few
  seconds old. Check how a freshly signed-up user's first reads behave at other locations.
- **Write quota.** Every debounced save is a KV write. Ten to twenty routes per user, edited
  often, across many users could approach a monthly cap. Needs real numbers.
- **The "list a user's routes" read** scans keys by prefix and then reads each route (the
  composite view already fetches the list, then each route). KV list and read cost and latency
  need measuring at 10 to 20 routes per user.
- **Community SvelteKit adapters for Compute** exist but their maturity is unclear, and none
  is official. This plan avoids needing one.
- **Cost and account limits** (number of KV stores, quotas) depend on the Fastly plan.

## Open questions

1. **Is Fastly actually the target?** If yes, how soon? This decides whether the interfaces in
   "What to do now" are worth doing before the [jwt.md](jwt.md) work.
2. **Name claims:** if KV has no conditional write, is a slightly racy claim acceptable at this
   scale (with a "taken" check after writing), or is a different store needed for users?
3. **Static hosting:** serve the SPA from the Compute service itself, or from a separate origin
   behind Fastly?
4. **Where does Valhalla live** once routing is built, given it cannot run on Compute?
5. **Local development:** run the API through Fastly's local Compute tooling, or keep the
   SvelteKit/Bun dev server and the filesystem store for development, with Compute as a
   deployment target only?

## Not decided, and not scheduled

No code changes follow from this document yet. If it moves forward, it would become a
milestone list here, probably: (1) storage interfaces, (2) a KV implementation, (3) a standalone
API service, (4) static build and deploy, (5) rate limiting and secrets.

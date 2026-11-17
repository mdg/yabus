# yabus: Sign-up and authentication with a session JWT

Replaces the session ID cookie and per-session directories described in
"Identity, sessions and storage" of [mvp.md](mvp.md) with:

- **sign-up**, so people can create an account when they need one,
- a **session JWT** that the client stores in `localStorage` and sends with every request that
  changes data, and
- **user records on the server** holding a user name and a user ID (a ULID).

People can look at everything signed out. They only need an account to **create or change**
something (edit a route, make a new one, duplicate one). Passwords and sign-in on another device
are *not* part of this plan (see "What an account is, and is not").

## Why change it

The current scheme has problems that come from a session being a *directory*:

- Every browser that loads a page without a cookie gets a **new session and a new directory**.
  Anyone who can reach the server can create unlimited directories.
- One user ends up with many session directories. Reads use the oldest one, writes go to the
  newest, so routes written by a newer session can be invisible to server reads.
- Losing the cookie means losing the identity that owned the files.
- The user name is hardcoded, so nobody else can have an account.
- Issuing a session on *page loads* (and telling pages from assets by looking at `Accept`
  headers) is a hack.

With a user ID and a real sign-up step, identity belongs to a **user**, not to a browser session.

## Goals

- Remove the session ID, the `sessionId` cookie, `session.json`, the hardcoded user name and
  the `data/{username}-{sessionId}/` directories.
- Let anyone **sign up** with a user name, in a **modal** that any page can open.
- Identify a user by a ULID **user ID**, saved on the server with the user name.
- Prove who is calling with a signed, expiring **JWT** (valid for **1 year**), stored by the
  client in `localStorage` and sent in an `Authorization` header.
- Check the token on every server write, in one shared place.
- Keep all views and all `GET`s usable **signed out**.

## Non-goals

- Passwords, e-mail, OAuth, passkeys, and **signing in on another device or after clearing
  browser data** (the later "login" plan).
- A **sign-out** button. Without credentials it would lock the user out for good, so it
  arrives with login.
- Roles, permissions, sharing routes between users.
- Changing how routes are stored as GeoJSON or how the sync rules work.

## What an account is, and is not

An account here is **a user name plus a token held in one browser.** There is no password.

- Whoever holds the token *is* the user, for as long as it is valid.
- **If the token is lost** (the user clears site data, uses another browser, the token expires
  unrenewed), they cannot get back into that account. The user name stays taken, and its routes
  stay on the server, readable by everyone, but nobody can edit them any more.
- That is acceptable for a first version only if people are **told so at sign-up**, and if
  tokens are **renewed automatically** so that expiry does not lock people out (see "Renewal").
- A stopgap that avoids most of the pain is an **account key** (copy the token out, paste it
  into another browser). See open question 1.

## Sign-up flow

The sign-up form is one modal, mounted once in the root layout and opened from anywhere with
`requireAuth()`. Pages never build their own sign-up UI.

### What the user sees

1. They land on any view **signed out**: the home map, a user's composite view, a single route.
   Nothing asks them to sign up.
2. They try something that needs an account: **Duplicate**, or **New route**.
3. If they are already signed in (a valid token is in `localStorage`), it just happens.
4. Otherwise the **sign-up modal** opens, with a line saying why ("Create an account to
   duplicate this route"):
   - a **User name** field, with the address it gives them shown underneath (`/u/hudson-fan`),
   - the rules, and what happens if they get it wrong, shown inline,
   - a note: *"Your account is stored in this browser. There is no password, so if you clear
     this browser's site data you will lose access to your routes."*,
   - **Sign up** and **Cancel** buttons.
5. On success the modal closes and the **action they started carries on**, now as the new user
   (the route is duplicated, the new route is created). They do not have to click again.
6. On Cancel, Esc, or a click on the backdrop, nothing changes and the action does not happen.

### User names

- 3 to 32 characters: lowercase letters, digits, `-` and `_`, starting with a letter or digit
  (`^[a-z0-9][a-z0-9_-]{2,31}$`). Input is lowercased as the user types, so a name is always
  already in its stored form. Lowercase-only means no case-collision problems on any file
  system, and the name is the same in the URL and on disk.
- A short list of **reserved names** is refused (`admin`, `root`, `system`, `support`, `yabus`,
  `api`, `null`, `undefined`, and similar).
- Names are unique. Existing routes in `localStorage` that were saved under a name keep working
  if that person signs up with the same name (so the existing `demo` data is claimed by signing
  up as `demo`).

### Server side

`POST /api/users` with `{ "username": "..." }`. No token needed (this is how you get one).

1. Validate the name (pattern, reserved list). `400` with a message if it is not valid.
2. Create the directory `data/{username}/` with a **non-recursive `mkdir`**. If it already
   exists the name is taken: `409`. This is atomic, so two people signing up with the same
   name at the same moment cannot both win.
3. Generate the user ID (a new ULID) and write `data/{username}/user.json` (write-once):
   `{ "userId", "username", "createdAt", "tokensValidAfter": null }`.
4. Sign a JWT for the user and return `201` with
   `{ "token", "expiresAt", "user": { "userId", "username" } }`.

Abuse limits (it is a public endpoint that creates directories):

- A per-address rate limit (for example 5 sign-ups per hour), kept in memory.
- A cap on the total number of users (`YABUS_MAX_USERS`, default 1000), then `503`.
- A small request size limit, JSON only.

The rate limit uses the client address, which is not reliable behind a reverse proxy; a proxy
setup needs its trusted-header configuration. Until there is more than a local deployment this
is enough.

### Client side

1. The modal validates the name with the same pattern and shows the problem before sending.
2. It calls `POST /api/users`, disabling the button while the request is pending.
3. `201`: store the token in `localStorage`, update the signed-in state, start the replicator,
   run the load-time reconcile, close the modal, and let `requireAuth()` resolve.
4. `409`: "That name is taken." `400`: the message from the server. `429`: "Too many sign-ups
   right now, try again later." Network failure: "Couldn't reach the server."
   The modal stays open on any error.
5. Accessibility: use the native `<dialog>` with `showModal()`, which gives a focus trap and
   Esc to close. Label it, focus the name field, and return focus to the button that opened
   it.

## Signed out, and signed in

| Action | Signed out | Signed in |
|---|---|---|
| Look at the home map, a composite view, a read-only route | Allowed | Allowed |
| **Duplicate** a route | Sign-up modal, then the duplicate proceeds | Proceeds |
| **New route** | Sign-up modal, then the route is created | Proceeds |
| Open an edit URL | Redirects to the read-only view | Edit view if the route is theirs and in this browser's `localStorage`, else the read-only view |
| Any server write (`PUT`/`DELETE`) | `401` | Allowed for their own routes |

- **The home page** signed out shows the map and a short prompt to sign up. Signed in it shows
  the user's name and their route list, as now.
- **Who counts as "signed in":** a token in `localStorage` that has not expired. This is
  checked locally and synchronously when the app starts, with no network call.
- **Whose `localStorage` routes:** local routes are keyed by user name
  (`yabus:route:v1:{username}:{routeNumber}`) and only the **signed-in user's** are read. A
  signed-out browser has none.
- **No hardcoded user name:** everything that used the constant now asks the auth state who the
  current user is (the home page, route list, edit guard, composite and read-only loaders, the
  replicator and the reconcile). Signed out there is simply no current user.
- **Assumption to confirm:** a signed-out visitor sees only **Duplicate** on someone else's
  route, not an Edit button (they do not own it). Open question 4.

## Can the client keep the JWT in `localStorage`? Is that secure?

**Yes, and this plan does it.** Whether it is *secure* depends on what you are protecting
against.

### What `localStorage` protects against, and what it does not

- **It does not protect against cross-site scripting (XSS).** Any JavaScript that runs on the
  app's page can read `localStorage`. That includes a script injected through an XSS bug, a
  compromised dependency (this app bundles `svelte`, `maplibre-gl` and others), and browser
  extensions that can read the site. A stolen token can be copied off the machine and used from
  anywhere until it expires. **With 1-year tokens that window is long**, which is why
  revocation and the hardening below matter.
- **It does avoid cross-site request forgery (CSRF).** The browser never attaches
  `localStorage` data to a request by itself, so another site cannot trick the browser into
  sending the token. Cookies have to be defended against this; `localStorage` tokens do not.
- **It is scoped to the origin** (scheme, host and port). Other sites cannot read it.
- **A JWT is signed, not encrypted.** Anyone holding the token can read its contents. Nothing
  secret goes in it.
- **It is only as private as the network.** Outside `localhost` the app must use HTTPS.

### Comparison

| | `localStorage` + `Authorization` header | `HttpOnly` cookie |
|---|---|---|
| Readable by page JavaScript (XSS can steal it) | **Yes** | No |
| Can XSS still act as the user while the page is open | Yes | Yes |
| CSRF risk | None | Needs `SameSite` plus other checks |
| Survives restarts, works across tabs | Yes | Yes |
| Server must issue it on page loads | No | Yes |
| Client can read its own user name | Yes (decode the token) | Needs a separate call |

An `HttpOnly` cookie is the more secure place against XSS. The usual best practice is a
short-lived token in memory plus a refresh token in an `HttpOnly` cookie, which is more
machinery than this app needs now.

### Decision

Store the token in `localStorage`, as requested. What the token can do is limited to editing
that user's bus routes, nothing sensitive sits behind it, and the routes themselves are already
in `localStorage`. The risk is accepted and reduced by "Hardening". If the app ever holds
anything sensitive, move the token to an `HttpOnly` cookie first (open question 3).

## Design

### Users and the data layout

```
data/                                   (git-ignored)
  .jwt-secret                           dev-only signing secret, mode 0600 (see "Secret")
  {userName}/
    user.json                           { "userId": "01J...", "username": "demo",
                                          "createdAt": "...", "tokensValidAfter": null }
    {routeNumber}.geojson               one file per route, as today
```

- The directory is named by the **user name**, so it mirrors the URL (`/u/{userName}`), as
  requested. Because names are lowercase-only and validated, they are safe to use as a path
  segment.
- The **user ID is stored inside `user.json`**. It is a ULID, generated by the server, never
  reused, and **not a secret** (it is in the token and the file). Never rely on it being hard
  to guess.
- Finding a user needs no index: the name is the directory. Lookups lowercase the name first,
  and validate it before it touches a path.
- A user name is unique, so the old "several directories for one name, use the first one" rule
  goes away. There is exactly one place to read from and write to.
- **Consequence of naming by user name:** renaming a user later means moving a directory and
  invalidating tokens (their `username` claim changes). That is acceptable because user names
  are not changeable in this plan.

### The token

A standard JWT, signed with **HS256** using a server-held secret.

```jsonc
// header
{ "alg": "HS256", "typ": "JWT" }
// payload
{
  "iss": "yabus",
  "aud": "yabus",
  "sub": "01J8ZQ...",        // the user ID (ULID)
  "username": "demo",        // names the directory to check; the record must agree with `sub`
  "iat": 1731900000,
  "exp": 1763436000,         // 365 days after iat
  "jti": "01J8ZR..."         // a ULID per token, for logs
}
```

Use the `jose` library to sign and verify. Do not hand-roll JWT handling.

**Verification rules** (all must pass, otherwise `401`):

1. Signature valid and the algorithm is **exactly `HS256`**. The `none` algorithm and anything
   else is rejected (this blocks algorithm-confusion attacks).
2. `exp` in the future; `iss` and `aud` equal `yabus` (clock tolerance about 30 s).
3. `username` matches the user-name pattern, `data/{username}/user.json` exists, and its
   `userId` **equals the token's `sub`**. The signature proves the server issued the token; this
   check ties it to the real record (so a token for a deleted-and-recreated name is not valid).
4. `iat` is not earlier than the user's `tokensValidAfter`, if set (revocation).

For a write, the user name in the URL path must be the token's user (`403` if not).

### Secret

- `YABUS_JWT_SECRET`: at least 32 random bytes, base64. Required in production; the server
  **refuses to start** in production without it.
- In development, if unset, generate a random secret once and keep it in `data/.jwt-secret`
  (mode `0600`, git-ignored) so tokens survive restarts.
- Changing the secret invalidates every token. With no way to sign back in, that means locking
  everyone out, so the secret must be **backed up and not rotated casually**.

### Endpoints

| Endpoint | Auth | What it does |
|---|---|---|
| `POST /api/users` | none | Sign up. See "Server side" above. `201` with the token. |
| `POST /api/session/renew` | valid token | Issue a fresh token (another 365 days) for the same user. `401` if the token is invalid or already expired. |
| `GET /api/users/{username}/routes`, `…/{n}` | none | Public reads. Look the user up by name and read `data/{username}/`. Unknown user: empty list / `404`. |
| `PUT`, `DELETE /api/users/{username}/routes/{n}` | **valid token** | Write the caller's own routes. |

- Writes need `Authorization: Bearer <jwt>`. One shared helper,
  `authorizeRequest(request, usernameFromPath)`, does the checks above and returns the user.
  Every write endpoint calls it first, before reading the body or touching a file, so a new
  write endpoint cannot skip it.
- The write directory is **always `data/{record.username}/`**, taken from the verified record,
  never from the URL or the body.
- `401` (with `WWW-Authenticate: Bearer`) for a missing, malformed, expired or otherwise invalid
  token. `403` for a valid token whose user does not own the path.
- No CORS headers are added; the API is same-origin only. Tokens are never logged.

### Renewal

Because there is no way to sign back in, an expired token would mean a lost account, even after a
year. So tokens **renew themselves**:

- On app start, if a token has less than about half its life left (180 days), the client calls
  `POST /api/session/renew` and stores the new token. Anyone who opens the app at least once in
  the last 6 months of a token's life keeps their account indefinitely.
- A failed renewal (offline) is ignored and retried at the next start.
- Renewal is a reason revocation matters: a stolen token can also be renewed, so it stays useful
  until the user's `tokensValidAfter` is moved past it.

### Client side

- **Storage:** `localStorage` key `yabus:token:v1` holds the raw token. Reads and writes are
  wrapped in try/catch (private windows, blocked storage). If storage is unavailable the app
  still works signed out, and signing up lasts only until the page is closed.
- **`src/lib/auth/token.ts`:** get, set, clear; decode the payload (no verification, the client
  cannot and need not verify) for the user name and expiry. Pure functions, unit-tested.
- **`src/lib/auth/…` reactive state:** `signedIn`, the current user, `requireAuth(reason)`
  (resolves with the user, or `null` if the user cancels), and `openSignUp(reason)`.
- **`authFetch(input, init)`:** adds the `Authorization` header. On a `401` it clears the token,
  marks the user signed out and shows the sign-up prompt next time they try to change something.
  It cannot silently get a new token any more, because there is no sign-in. Local data is not
  touched.
- **Replicator and reconcile** run only while signed in, and use `authFetch`. When the user
  signs up mid-session they are created then.
- **Page unload:** the `pagehide` flush is best effort. It reads the token synchronously and
  sends with `keepalive`; if there is no valid token it skips.
- **The root layout** reads the token synchronously on start (no network), then renews if
  needed, then mounts the sign-up modal once.

### Revocation

JWTs are stateless, so the server cannot "delete" one. Each user has a `tokensValidAfter` time in
`user.json`. Any token issued before it is rejected.

- This plan: the field, the check, and an admin script `bun run revoke <username>` that sets it
  to now. The user is then locked out until the login plan gives them a way back in, so the
  script prints a warning.

## Hardening

Because script on the page can read the token, the main defence is keeping untrusted script off
the page:

- **No raw HTML from data.** Svelte escapes text by default. Do not use `{@html}`, `innerHTML`
  or similar with anything that comes from a route or a user name. Add a check that fails on
  `{@html` in `src/`.
- **Content Security Policy** via SvelteKit's `csp` option: scripts from the app only (no inline
  script, no `eval`), `connect-src` limited to the app and `tiles.openfreemap.org`,
  `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. MapLibre needs
  `worker-src blob:` and `img-src data: blob:`. The exact list needs testing against the map,
  so treat it as a starting point and confirm the map still loads.
- **Dependency hygiene:** commit `bun.lock`, install with `--frozen-lockfile` in CI, review
  updates.
- **HTTPS** for anything beyond localhost.
- **Minimal claims**, no secrets in the token.
- **Sign-up abuse limits** (above).

## What changes in the code

Remove:

- `src/hooks.server.ts` session issuing; `SESSION_COOKIE`; `createSession`, `authorizeSession`,
  `isValidSession`, `findReadDir`; `locals.sessionId`.
- `session.json` and the `data/{username}-{sessionId}/` layout.
- The hardcoded user name (`src/lib/identity.ts`, `src/lib/server/identity.ts`).

Add:

- `src/lib/server/users.ts` (create and look up users), `src/lib/server/jwt.ts` (sign, verify,
  secret), `src/lib/server/auth.ts` (`authorizeRequest`), a small in-memory rate limiter.
- `src/routes/api/users/+server.ts` (sign-up), `src/routes/api/session/renew/+server.ts`.
- `src/lib/auth/token.ts`, `src/lib/auth/authFetch.ts`, the reactive auth state, and
  `src/components/SignUpModal.svelte`.
- `scripts/revoke.ts`.

Change:

- `src/lib/server/storage.ts`: directories keyed by user name; route-file functions stay.
- The route endpoints: bearer auth, `401`/`403` split, reads by user name.
- Everything that imported the hardcoded user name: home page, route list, edit guard,
  composite and read-only loaders, `localRoutes`, `takenNumbers`, the replicator and reconcile.
- The home page: signed-out prompt; gated **New route**. The read-only view: gated **Duplicate**.
- `plan/mvp.md`: the "Identity, sessions and storage", "Server filesystem" and "Views" parts,
  once this plan is done.

### Existing data

Nothing needs migrating. The routes in `localStorage` are the source of truth, and the
load-time reconcile copies them to the new `data/{userName}/` after the user signs up. To keep
existing local routes, sign up with the name they are saved under (currently `demo`). Old
`data/{username}-{sessionId}/` directories are ignored and can be deleted; only routes that exist
on the server alone (made in another browser) in the dev data are lost (open question 5).

The old `sessionId` cookie is cleared (`Max-Age=0`) the first time a page request carries it, and
then that code is deleted.

## Milestones

1. **Users and tokens (server, no endpoints yet):** user store with ULID IDs, the sign-up
   steps (validation, reserved names, atomic `mkdir`, `user.json`), secret handling, sign and
   verify with `jose`, `authorizeRequest`, rate limiter. Unit tests.
2. **Endpoints:** `POST /api/users`, `POST /api/session/renew`; switch `PUT`/`DELETE` to bearer
   auth with `401`/`403`; reads by user name from `data/{userName}/`; remove the session hook,
   cookie, session directories and `findReadDir`; clear the legacy cookie.
3. **Client auth state:** token store, signed-in state read at start, renewal, `authFetch`,
   replicator and reconcile only while signed in, no more hardcoded user name.
4. **Sign-up modal and gating:** `SignUpModal`, `requireAuth`, gated **New route** and
   **Duplicate**, signed-out home prompt, edit URL redirect for signed-out users.
5. **Hardening:** CSP, the `{@html}` check, `tokensValidAfter` and the revoke script, docs on
   HTTPS and the secret (including backing it up).
6. **Cleanup:** remove dead code and old tests, update `plan/mvp.md`.

## Tests

Server (unit):

- **Sign-up:** valid name creates the directory, `user.json` and a token; invalid pattern;
  reserved name; uppercase input is rejected or lowercased consistently; a taken name gives
  `409`; **two simultaneous sign-ups for one name: exactly one wins**; each new user gets a
  distinct ULID; rate limit gives `429`; user cap gives `503`.
- **Tokens:** round trip; expired; wrong secret; tampered payload; `alg: none`; a different
  algorithm; wrong `iss`/`aud`; `username` claim with path characters; `sub` that does not match
  the record's `userId`; unknown user; `iat` before `tokensValidAfter`.
- **`authorizeRequest`:** no header, wrong scheme, garbage token, valid token for another user's
  path (`403`), valid token for its own path.
- **Renewal:** a valid token renews with a later `exp`; an expired or invalid token gets `401`.
- Route files are only ever written under `data/{record.username}/`.

Client (unit):

- Expiry detection and payload decoding; storage that throws; renewal only when under half the
  life is left; `authFetch` clears the token and signs out on `401` and does not retry.
- `requireAuth`: resolves immediately when signed in; opens the modal when signed out; resolves
  with the user after a sign-up; resolves `null` on cancel.

End to end (browser):

- A signed-out visitor can open the home map, a composite view and a read-only route with no
  prompt.
- Signed out, **Duplicate** opens the modal; after signing up the duplicate happens without
  another click, and the copy is in the new user's list and on the server.
- Signed out, **New route** does the same.
- Taken name shows the error and keeps the modal open; a bad name shows the inline message;
  Esc and Cancel leave everything unchanged and return focus.
- A `PUT` without a token gets `401` and creates nothing.
- Reloading keeps the user signed in (token in `localStorage`); clearing it makes them signed
  out again.
- A token with under half its life left is renewed on start.
- Signing up as `demo` picks up the existing local `demo` routes and syncs them.
- The map still loads with the CSP on.

## Open questions

1. **Account recovery / second device:** with no password, losing the token loses the account.
   Add an **account key** (a "Copy account key" action, and "Use an account key" in the modal)
   as a stopgap, or accept the limitation until the login plan? Recommended: add the account key.
   It is the same bearer token, so it has to be treated like a password.
2. **Lifetime and renewal:** 1 year as requested, with automatic renewal as above. Is renewing
   at under 180 days left the right threshold?
3. **Storage after login exists:** is `localStorage` still the choice, or should the token move
   to an `HttpOnly` cookie when the login plan is written?
4. **Edit for signed-out visitors:** should a signed-out visitor see an **Edit** button on
   routes (which opens the sign-up modal), or only **Duplicate**? The plan assumes only
   Duplicate, because they do not own the route.
5. **Old server data:** drop it (proposed), or write a one-off script that merges the old
   session directories into `data/{userName}/`?
6. **Reserved names and limits:** is the reserved list, the 3 to 32 length, and the rate limit of
   5 sign-ups per hour per address right?

## Deferred

- **Login** (credentials, password hashing or passkeys, signing in on another device, sign-out,
  rate limiting a sign-in endpoint).
- **Changing a user name.**
- **Asymmetric signing** (for example EdDSA), only needed if something other than this server
  ever has to verify tokens.
- **Per-device sessions list** and "sign out this device".
- **Audit log** of sign-ups and renewals.

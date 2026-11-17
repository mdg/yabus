# yabus: Bus Route Drawing App

A web app for drawing numbered bus routes on a map. Initial target area: **Hudson County, NJ** and its neighbors, which have many one-way streets.

## Goals

- Display an interactive map of the target area.
- Let the user create a route by clicking to place waypoints on the map.
- Give each route a number, a name and a color.
- Snap routes to roads using bus-appropriate routing that respects one-way streets.
- Render routes with the route number labeled along the line and arrows showing direction of travel.
- Provide three views: edit, read-only single route, and a composite of all of one user's routes.
- Persist routes in `localStorage` and keep a copy of the GeoJSON on the server's filesystem.

## Non-goals (for now)

- **Login and accounts.** Username and session ID are hardcoded. Login will be a separate plan.
- **Import/export of GeoJSON files.** Not part of this plan.
- **Route selection / filtering** in the composite view. Will be added later in a separate plan.
- **Freehand line drawing.** Routes are only built from clicked waypoints.
- Schedules, timetables, or real transit feeds (GTFS).
- Trip planning or rider-facing features.

## Decisions

| Topic | Decision |
|---|---|
| Framework | **SvelteKit** (TypeScript). The server side is needed for the filesystem copy, so use a server adapter (`adapter-node`, or a Bun adapter) rather than `adapter-static`. |
| Package manager / runtime | **Bun** (`bun install`, `bun run dev`). Vite still does the dev server and build. |
| Map rendering | **MapLibre GL JS** |
| Drawing/editing | **Terra Draw** (MapLibre adapter) for interaction. Click to add waypoints only. |
| Road snapping | **Valhalla**, `bus` costing, run locally in Docker. Hidden behind a small `Router` interface. |
| Client persistence | **GeoJSON in `localStorage`** |
| Server persistence | **GeoJSON files on the server filesystem**, keyed by username and ULID session ID. |
| Target area | Hudson, Bergen and Essex Counties (NJ) and Manhattan (New York County, NY). |
| Route direction model | Each route represents **one direction of travel**. See "Route model". |
| Overlap within a route | A route's paths are drawn identically to a single route. Arrows show direction. |
| Identity (for now) | Hardcoded username and session ID in one config module. |

## Route model

A route is a **loop** or **point-to-point**. Every route has either one or two *paths*, where each path is a single line of travel in one direction.

| Kind | Paths | Description |
|---|---|---|
| **Loop** | 1 | Start and end are the same point. Always exactly one path. |
| **Point-to-point, one direction** | 1 | Runs from endpoint A to endpoint B only. This is the common case and the default. |
| **Point-to-point, bidirectional** | 2 | Path 0 runs A to B. Path 1 is the return trip, B to A, and may follow different streets. |

Rules:

- A route has **at most 2 endpoints**: A and B for point-to-point, or a single shared start/end point for a loop.
- A bidirectional route **always uses the same two endpoints** for both paths. Path 1 starts where path 0 ends and ends where path 0 starts.
- A route never has more than 2 paths.
- Most routes will start with a single path. The second path is added later for routes where the return trip should be illustrated.
- Paths are drawn independently, so the return path can use different streets. This matters because one-way streets often force a different return route.

### Invariants the app enforces

1. `loop` routes have exactly 1 path, and `waypoints[0]` equals `waypoints[last]`.
2. `point-to-point` routes have 1 or 2 paths.
3. If there are 2 paths, `path1.first == path0.last` and `path1.last == path0.first`.
4. Moving an endpoint in the UI moves it in the other path too. The user does not have to keep them in sync by hand.
5. Intermediate waypoints can differ freely between the two paths.

## Data model

Routes are stored as a GeoJSON `FeatureCollection`. **Each path is one `Feature`** with a `LineString` geometry. Features that belong to the same route share a `routeId`.

```jsonc
{
  "type": "Feature",
  "id": "uuid",                      // path id
  "geometry": { "type": "LineString", "coordinates": [[lng, lat], ...] },
  "properties": {
    "routeId": "uuid",               // shared by both paths of a route
    "kind": "loop",                  // "loop" | "point-to-point"
    "direction": 0,                  // 0 = primary (A to B), 1 = return (B to A); always 0 for loops
    "number": "42",                  // string, since routes can be "42X" or "N3"
    "name": "Downtown Loop",
    "color": "#e63946",
    "waypoints": [                   // user-placed points the line is built from
      { "id": "uuid", "coordinates": [lng, lat], "name": "optional" }
    ]
  }
}
```

Notes:

- `waypoints` are the source of truth. `geometry` is derived from them, either as a road-snapped path from Valhalla or as straight segments.
- Endpoints are derived: the first and last waypoint of the path. They are not stored separately.
- `number`, `name`, `color` and `kind` are route-level fields duplicated onto each path feature, because GeoJSON has no grouping. The app treats the `routeId` group as the unit and keeps these fields in sync when editing.
- Ownership comes from where the data is stored (the username in the storage key and server path), not from a property on the feature.

## Identity and storage

### Hardcoded identity

A single module (for example `src/lib/identity.ts`) exports the hardcoded `username` and `sessionId` (a ULID). Everything that needs identity reads it from there, so the future login plan only has to replace that module.

### localStorage

- Key: `yabus:routes:v1:{username}:{sessionId}`, holding the user's `FeatureCollection`.
- The version suffix leaves room for migrations.
- This is the client's working copy.

### Server filesystem

- Layout: `data/{username}/{sessionId}.geojson`. The `data/` directory is git-ignored.
- SvelteKit server endpoints:
  - `GET /api/routes/{username}/{sessionId}` returns the file.
  - `PUT /api/routes/{username}/{sessionId}` replaces the file. Only allowed when `{username}` matches the current user.
- The client saves to `localStorage` immediately and PUTs to the server on a debounce.
- Validate `username` and `sessionId` (character set, ULID format) before using them in paths, to prevent path traversal.
- Writes are atomic (write to a temp file, then rename).

## Views

All three views share the same map component and layer styling. They differ in interaction and in what data they load.

| View | Who can use it | What it shows | Interaction |
|---|---|---|---|
| **Edit** | Only the creating user | One route | Full editing. |
| **Read-only route** | Any user | One route | None. A **Duplicate** button creates a new route owned by the current user. |
| **Composite** | Any user viewing a given user's routes | All of one user's routes | None for now (selection comes later). |

Proposed URLs:

- `/u/{username}/{sessionId}` is the composite view.
- `/u/{username}/{sessionId}/{routeId}` is the read-only route view.
- `/u/{username}/{sessionId}/{routeId}/edit` is the edit view. It redirects to the read-only view if the current user is not the owner.

Notes:

- **Ownership check:** compared on the server (PUT is refused for non-owners) and on the client (to hide edit controls). With a hardcoded identity this is always satisfied for now, but the logic is built in from the start.
- **Duplicate:** copies the route's path features with a new `routeId` and new path and waypoint ids, adds them to the current user's collection, and opens the new route in the edit view.
- The edit view is where the Terra Draw interactions are attached. The other two views are read-only and never attach it.

## Drawing and editing UX

Click to add waypoints only. There is no freehand drawing.

- Click the map to append a waypoint to the active path. After each click the path is re-snapped to roads through the `Router`.
- Drag a waypoint to move it. The affected segments re-snap.
- Click on the line to insert a waypoint at that position.
- Select a waypoint and delete it.
- For a loop, the closing point is the first waypoint. The app adds the matching last waypoint automatically.
- For point-to-point routes, the first and last waypoint are the endpoints. Moving an endpoint also moves it on the other path (invariant 4).
- "Snapping" here means snapping the line to roads through Valhalla. Waypoints themselves are also snapped to the nearest routable road location by Valhalla.
- A straight-line `Router` is available as a fallback when Valhalla is not running.

## Rendering

- **Route lines:** `line` layer, `line-color` from `["get", "color"]`.
- **Route labels:** `symbol` layer with `symbol-placement: "line"` and `text-field: ["get", "number"]`.
- **Direction arrows:** `symbol` layer along each path. Each path has its own arrows, so the two paths of a bidirectional route show arrows in both directions where they share a street.
- **Endpoints and waypoints:** `circle` layer for markers (waypoints shown only in the edit view).
- **Overlap within a route:** no `line-offset`. The two paths of a bidirectional route, or a loop that overlaps itself, are drawn on top of each other and look like a single route. Only the arrows indicate direction.
- **Overlap between different routes:** not decided. See open questions.

## Routing (Valhalla)

- Use the `/route` endpoint with `"costing": "bus"`. Valhalla respects one-way streets, turn restrictions and bus-accessible roads.
- Send the path's waypoints as `locations`. For a loop, the first and last location are the same point.
- Valhalla returns the shape as an encoded polyline with 6 digits of precision. Decode it into the path's `LineString`.
- Each path is routed on its own. The return path of a bidirectional route is a separate request with its own waypoints, so it naturally follows one-way streets in the opposite direction.
- Use `"type": "through"` for intermediate waypoints so the route passes through them without treating them as stops that split the trip. Revisit this choice during implementation.
- The SvelteKit server proxies Valhalla (`/api/route`), so the browser does not need CORS access to the Docker container.

### Local Docker setup

- Run Valhalla locally in Docker (for example the `gis-ops/docker-valhalla` image, which builds tiles from `.pbf` files in a mounted folder).
- **Optimized for the target region.** Do not build tiles for the whole US.
  1. Download the Geofabrik extracts for New Jersey and New York State.
  2. Clip each to the target area with `osmium extract`. The area covers Hudson, Bergen and Essex Counties and Manhattan, plus a buffer so routes near the edges are not cut off.
  3. Merge the clipped files into one `.pbf` and mount it into the container.
- Check in the scripts and a `docker-compose.yml` for this, but not the data or tiles. Keep those in a git-ignored folder.
- Note that "Manhattan County" is New York County, NY, which is the name to use when looking up boundaries.

### Router interface

```ts
interface Router {
  route(waypoints: [number, number][]): Promise<[number, number][]>; // snapped path
}
```

The Valhalla implementation sits behind this. A straight-lines implementation is the fallback.

## Architecture

```
src/
  lib/
    identity.ts   hardcoded username and sessionId
    map/          MapLibre setup, layers, styles
    draw/         Terra Draw integration (edit view only)
    routing/      Router interface + Valhalla and straight-line implementations
    store/        Svelte stores for routes; localStorage sync and server sync
    geo/          GeoJSON types, route invariants, duplicate helper
    server/       Filesystem storage helpers (server only), input validation
  routes/
    u/[username]/[sessionId]/+page.svelte                  composite view
    u/[username]/[sessionId]/[routeId]/+page.svelte        read-only route view
    u/[username]/[sessionId]/[routeId]/edit/+page.svelte   edit view
    api/routes/[username]/[sessionId]/+server.ts           GET / PUT geojson
    api/route/+server.ts                                   Valhalla proxy
  components/
    Map.svelte
    RouteList.svelte
    RouteEditor.svelte    number / name / color / kind form
infra/
  valhalla/       docker-compose.yml and extract scripts
data/             server-side GeoJSON files (git-ignored)
```

## Milestones

1. **Scaffold:** SvelteKit + TypeScript managed with Bun and a server adapter, with MapLibre showing a basemap of the target area.
2. **Identity and storage:** hardcoded identity module, `localStorage` store, and server GET/PUT endpoints writing to `data/{username}/{sessionId}.geojson`.
3. **Edit view, straight lines:** click to add waypoints, derive a `LineString` using the straight-line `Router`, and render it with a color.
4. **Route metadata:** number, name, color and kind (loop / point-to-point). Route list with select and delete.
5. **Labels and arrows:** route number and direction arrows rendered along each path.
6. **Waypoint editing:** drag, insert and delete waypoints. Enforce loop and endpoint invariants.
7. **Valhalla:** local Docker setup for the target region, `/api/route` proxy, and the Valhalla `Router` with `bus` costing.
8. **Return paths:** add an optional second path to a point-to-point route, with endpoints locked to the first path's.
9. **Read-only route view and Duplicate.**
10. **Composite view** of all of a user's routes.
11. **Polish:** undo/redo, keyboard shortcuts.

## Open questions

- **Server file granularity:** one `{sessionId}.geojson` per user and session holding all routes (as written above), or one file per route?
- **What a session is:** the plan treats a session as a named collection of a user's routes. Is that right, or should routes persist across sessions for a user?
- **Sync conflicts:** on load, which copy wins when `localStorage` and the server differ? A simple default is to use `localStorage` for the owner and fall back to the server when it is empty. Other users always read from the server.
- **Server adapter:** `adapter-node` or a Bun-specific adapter.
- **Valhalla region:** exact bounding box or boundary polygon, and how large a buffer around the four counties.
- **Intermediate waypoint type:** `through` vs. `break` for Valhalla locations.
- **Basemap provider:** MapTiler, Stadia, or self-hosted Protomaps for the target area?
- **Overlap between different routes:** drawn on top of each other, offset side by side, or something else?
- **Return-path UX:** how does the user add the second path? For example, a button that seeds it with the reversed waypoints of path 0 for them to adjust.
- **Scale:** how many routes are expected? This matters for `localStorage` limits (about 5 MB).

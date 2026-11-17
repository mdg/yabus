# yabus: Bus Route Drawing App

A web app for drawing numbered bus routes on a map. Initial target area: **Hudson County, NJ**, which has many one-way streets.

## Goals

- Display an interactive map of Hudson County.
- Let the user create a route by placing stops/waypoints on the map.
- Give each route a number, a name and a color.
- Snap routes to roads using bus-appropriate routing that respects one-way streets.
- Render routes on the map with the route number labeled along the line.
- Persist routes locally and allow GeoJSON import/export.

## Non-goals (for now)

- Accounts, backend, or multi-user sync.
- Schedules, timetables, or real transit feeds (GTFS).
- Trip planning or rider-facing features.

## Decisions

| Topic | Decision |
|---|---|
| Framework | **SvelteKit** (TypeScript). Start client-side only, using `adapter-static` with SSR disabled. |
| Package manager / runtime | **Bun** (`bun install`, `bun run dev`). Vite still does the dev server and build. |
| Map rendering | **MapLibre GL JS** |
| Drawing/editing | **Terra Draw** (MapLibre adapter) |
| Road snapping | **Valhalla**, using the `bus` costing model. Hidden behind a small `Router` interface. |
| Persistence | **GeoJSON in `localStorage`**. Backend later. |
| Target area | Hudson County, NJ (many one-way streets). |
| Route direction model | Each route represents **one direction of travel**. See "Route model". |

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
- Paths are drawn independently, so the return path can use different streets. This matters in Hudson County because one-way streets often force a different return route.

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
- The whole collection lives under a single `localStorage` key (for example `yabus:routes:v1`). The version suffix leaves room for migrations.
- Export and import are plain `.geojson` files.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | SvelteKit + TypeScript | `adapter-static`, SSR off for now. A backend can be added in the same project later. |
| Runtime / packages | Bun | |
| Map rendering | MapLibre GL JS | Open source, WebGL vector rendering, data-driven styling for colors and labels. No token required. |
| Drawing/editing | Terra Draw | Line drawing, vertex editing, snapping and selection. |
| Routing | Valhalla (`bus` costing) | See "Routing". |
| Basemap tiles | TBD (MapTiler, Stadia Maps or self-hosted Protomaps/PMTiles) | Avoid the public OSM tile servers in production. |
| Persistence | `localStorage` GeoJSON | |

## Routing (Valhalla)

- Use the `/route` endpoint with `"costing": "bus"`. Valhalla respects one-way streets, turn restrictions and bus-accessible roads.
- Send the path's waypoints as `locations`. For a loop, the first and last location are the same point.
- Valhalla returns the shape as an encoded polyline with 6 digits of precision. Decode it into the path's `LineString`.
- Each path is routed on its own. The return path of a bidirectional route is a separate request with its own waypoints, so it naturally follows one-way streets in the opposite direction.
- Use `"type": "through"` for intermediate waypoints so the route passes through them without treating them as stops that split the trip. Revisit this choice during implementation.
- Hosting: run Valhalla in Docker with an OSM extract. The New Jersey extract from Geofabrik can be clipped to Hudson County plus a buffer to keep the tile build small.
- The browser will call Valhalla directly during development, which requires CORS to be enabled or a dev proxy through Vite/SvelteKit. A SvelteKit server endpoint can proxy it later.

### Router interface

```ts
interface Router {
  route(waypoints: [number, number][]): Promise<[number, number][]>; // snapped path
}
```

The Valhalla implementation sits behind this. A "straight lines" implementation is also useful as a fallback and for development without a running Valhalla server.

## Architecture

```
src/
  lib/
    map/          MapLibre setup, layers, styles
    draw/         Terra Draw integration
    routing/      Router interface + Valhalla and straight-line implementations
    store/        Svelte stores for routes and selection; localStorage sync
    geo/          GeoJSON types, route invariants, helpers
  routes/         SvelteKit routes
    +layout.ts    ssr = false
    +page.svelte
  components/
    Map.svelte
    RouteList.svelte
    RouteEditor.svelte    number / name / color / kind form
```

### Map layers

- **Route lines:** `line` layer, `line-color` from `["get", "color"]`.
- **Route labels:** `symbol` layer with `symbol-placement: "line"` and `text-field: ["get", "number"]`.
- **Direction arrows:** symbol layer along the line, since each path represents one direction of travel.
- **Endpoints and waypoints:** `circle` layer for markers.
- **Overlap handling:** use `line-offset` so routes sharing a street do not hide each other. This also helps when a route's two directions share a street. Details to be worked out.

## Milestones

1. **Scaffold:** SvelteKit + TypeScript managed with Bun, with MapLibre showing a basemap centered on Hudson County.
2. **Draw straight routes:** click to add waypoints, produce a `LineString`, and render it with a color.
3. **Route metadata:** number, name, color and kind (loop / point-to-point). Route list with select and delete.
4. **Labels and arrows:** route number and direction rendered along the line.
5. **Persistence:** sync to `localStorage`, GeoJSON import/export.
6. **Editing:** drag waypoints, insert and remove them, and re-derive the geometry. Enforce loop and endpoint invariants.
7. **Valhalla snapping:** stand up Valhalla for Hudson County and implement the `Router` interface with `bus` costing.
8. **Return paths:** add an optional second path to a point-to-point route, with endpoints locked to the first path's.
9. **Polish:** overlapping-route offsets, undo/redo, keyboard shortcuts.

## Open questions

- **Valhalla hosting:** self-hosted Docker (local only, or deployed somewhere) vs. a hosted Valhalla service? Extract region and buffer around Hudson County?
- **Intermediate waypoint type:** `through` vs. `break` for Valhalla locations.
- **Basemap provider:** MapTiler, Stadia, or self-hosted Protomaps?
- **Drawing UX:** click-to-add-waypoints with snapping, or freehand line drawing, or both?
- **Multiple routes on the same street:** how should overlaps be displayed?
- **Return-path UX:** how does the user add the second path? For example, a button that seeds it with the reversed waypoints of path 0 for them to adjust.
- **Scale:** how many routes are expected? This matters for `localStorage` limits (about 5 MB).

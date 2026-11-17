# yabus: Bus Route Drawing App

A web app for drawing numbered bus routes on a map.

## Goals

- Display an interactive map.
- Let the user create a route by placing stops/waypoints on the map.
- Give each route a number, a name and a color.
- Render routes on the map with the route number labeled along the line.
- Persist routes locally and allow GeoJSON import/export.

## Non-goals (for now)

- Accounts, backend, or multi-user sync.
- Schedules, timetables, or real transit feeds (GTFS).
- Trip planning or rider-facing features.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Svelte** (with Vite, TypeScript) | Decide later: plain Svelte SPA vs. SvelteKit. A plain SPA is enough while everything is client-side. |
| Map rendering | **MapLibre GL JS** | Open source, WebGL vector rendering, data-driven styling for colors and labels. No token required. |
| Drawing/editing | **Terra Draw** (MapLibre adapter) | Line drawing, vertex editing, snapping and selection. Library-agnostic. |
| Road snapping | **Undecided: OSRM or Valhalla** | See "Open questions". Hide behind a small interface so either can be swapped in. |
| Basemap tiles | TBD (MapTiler, Stadia Maps or self-hosted Protomaps/PMTiles) | Avoid the public OSM tile servers in production. |
| Persistence | **GeoJSON in `localStorage`** | Backend can come later. |

## Data model

Routes are stored as a GeoJSON `FeatureCollection`.

Each route is a `Feature` with a `LineString` geometry and these properties:

```jsonc
{
  "type": "Feature",
  "id": "uuid",
  "geometry": { "type": "LineString", "coordinates": [[lng, lat], ...] },
  "properties": {
    "number": "42",          // string, since routes can be "42X" or "N3"
    "name": "Downtown Loop",
    "color": "#e63946",
    "stops": [               // user-placed waypoints the line is built from
      { "id": "uuid", "coordinates": [lng, lat], "name": "optional" }
    ]
  }
}
```

Notes:

- `stops` are the source of truth. `geometry` is derived from them, either as straight segments or as a road-snapped path from the routing engine.
- The whole collection lives under a single `localStorage` key (for example `yabus:routes:v1`). The version suffix leaves room for migrations.
- Export and import are plain `.geojson` files.

## Architecture

```
src/
  lib/
    map/          MapLibre setup, layers, styles
    draw/         Terra Draw integration
    routing/      Router interface + implementations (OSRM/Valhalla)
    store/        Svelte stores for routes and selection; localStorage sync
    geo/          GeoJSON types and helpers
  components/
    Map.svelte
    RouteList.svelte
    RouteEditor.svelte    number / name / color form
  App.svelte
```

### Routing interface

```ts
interface Router {
  route(waypoints: [number, number][]): Promise<[number, number][]>; // snapped path
}
```

Both OSRM and Valhalla can be wrapped behind this. A no-op "straight lines" implementation is also useful as a fallback and for development.

### Map layers

- **Route lines:** `line` layer, `line-color` from `["get", "color"]`.
- **Route labels:** `symbol` layer with `symbol-placement: "line"` and `text-field: ["get", "number"]`.
- **Stops:** `circle` layer for stop markers.
- **Overlap handling:** use `line-offset` so routes sharing a street do not hide each other. Details to be worked out.

## Milestones

1. **Scaffold:** Vite + Svelte + TypeScript, with MapLibre showing a basemap.
2. **Draw straight routes:** click to add stops, produce a `LineString`, and render it with a color.
3. **Route metadata:** number, name and color editing. Route list with select and delete.
4. **Labels:** route number rendered along the line.
5. **Persistence:** sync to `localStorage`, GeoJSON import/export.
6. **Editing:** drag stops, insert and remove stops, and re-derive the geometry.
7. **Road snapping:** implement the `Router` interface once the engine is chosen.
8. **Polish:** overlapping-route offsets, undo/redo, keyboard shortcuts.

## Open questions

- **Routing engine: OSRM or Valhalla?** Undecided.
  - Hosted vs. self-hosted?
  - Which coverage area is needed?
  - Do we need a bus-specific profile? OSRM's default is `car`, and Valhalla has a `bus` costing model.
- **Basemap provider:** MapTiler, Stadia, or self-hosted Protomaps?
- **Svelte flavor:** plain SPA or SvelteKit?
- **Drawing UX:** click-to-add-stops with snapping, or freehand line drawing, or both?
- **Directionality:** are routes one-way loops, out-and-back, or bidirectional with distinct paths?
- **Multiple routes on the same street:** how should overlaps be displayed?
- **Scale:** how many routes and stops are expected? This matters for `localStorage` limits (about 5 MB).

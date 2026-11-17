<script lang="ts">
	import { goto } from '$app/navigation';
	import { LngLatBounds, type Map, type MapLayerMouseEvent, type MapLayerTouchEvent } from 'maplibre-gl';
	import MapView from '#components/Map.svelte';
	import RouteEditor from '#components/RouteEditor.svelte';
	import {
		appendWaypoint,
		deriveGeometry,
		mergeGeometry,
		moveWaypoint,
		straightGeometry
	} from '#lib/geo/edit.ts';
	import { newRoute } from '#lib/geo/factory.ts';
	import { applyMetadata, type MetadataPatch } from '#lib/geo/meta.ts';
	import { validateRouteNumber } from '#lib/geo/numbering.ts';
	import type { Position, RouteCollection, RouteKind } from '#lib/geo/types.ts';
	import { username } from '#lib/identity.ts';
	import { addRouteLayers, setRouteData, WAYPOINT_LAYER } from '#lib/map/routeLayers.ts';
	import { getRouter } from '#lib/routing/index.ts';
	import { getLocalRoutes } from '#lib/store/localRoutes.ts';
	import { takenRouteNumbers } from '#lib/store/takenNumbers.ts';

	let { routeNumber }: { routeNumber: string } = $props();

	const router = getRouter();
	const store = getLocalRoutes();

	// The route is replaced, never mutated, so a raw (non-proxied) state is enough. It also keeps
	// proxies away from MapLibre. The page load guarantees the route exists in localStorage.
	// svelte-ignore state_referenced_locally
	let route = $state.raw<RouteCollection>(store.get(routeNumber) ?? newRoute(routeNumber));
	let map = $state.raw<Map>();
	let message = $state<string | null>(null);
	let numberError = $state<string | null>(null);

	const meta = $derived(route.features[0].properties);
	const waypointCount = $derived(meta.waypoints.length);

	// Keep the map in step with the route.
	$effect(() => {
		if (map) setRouteData(map, route);
	});

	function persist(r: RouteCollection) {
		try {
			store.save(r);
			message = null;
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not save the route.';
		}
	}

	let latest = 0;
	let inflight: Promise<void> = Promise.resolve();

	/** Applies a change: shows it and saves it now, then rebuilds the line if asked. */
	function update(next: RouteCollection, rebuildLine: boolean) {
		route = next;
		persist(next);
		if (!rebuildLine) return;

		const seq = ++latest;
		inflight = (async () => {
			let derived: RouteCollection;
			let routingFailed = false;
			try {
				derived = await deriveGeometry(next, router);
			} catch {
				derived = straightGeometry(next);
				routingFailed = true;
			}
			if (seq !== latest) return; // a newer waypoint change replaced this one

			// Apply only the line, so edits made while this ran (a new name, say) are kept.
			route = mergeGeometry(route, derived);
			persist(route);
			if (routingFailed) message = 'Routing failed, so straight lines are shown.';
		})();
	}

	const addWaypoint = (position: Position) => update(appendWaypoint(route, position), true);
	const setName = (name: string) => update(applyMetadata(route, { name }), false);
	const setColor = (color: string) => update(applyMetadata(route, { color }), false);

	function setKind(kind: RouteKind) {
		const patch: MetadataPatch = { kind };
		// Changing kind adds or removes the closing waypoint, so the line is rebuilt.
		update(applyMetadata(route, patch), true);
	}

	async function rename(candidate: string) {
		const current = meta.number;
		numberError = null;
		if (candidate === current) return;

		// Cheap format check first, then check against local and server routes.
		let error = validateRouteNumber(candidate, current, []);
		if (!error) error = validateRouteNumber(candidate, current, await takenRouteNumbers());
		if (error) {
			numberError = error;
			return;
		}

		await inflight; // let a pending line rebuild land under the old number first
		const next = applyMetadata(route, { number: candidate });
		try {
			store.save(next);
		} catch (e) {
			numberError = e instanceof Error ? e.message : 'Could not save the route.';
			return;
		}
		store.remove(current);
		latest++; // drop anything still in flight for the old number
		await goto(`/u/${username}/${candidate}/edit`, { replaceState: true });
	}

	// Dragging a waypoint. While dragging, the markers and a straight-line preview follow the
	// pointer. Nothing is saved or routed until the pointer is released.
	interface Drag {
		path: number;
		id: string;
		start: RouteCollection; // the route as it was when the drag began, for cancelling
		moved: boolean;
		origin: { x: number; y: number };
	}
	let drag: Drag | null = null;
	let ignoreClickUntil = 0;

	type PointerEventLike = { point: { x: number; y: number }; lngLat: { lng: number; lat: number } };

	function wireInteractions(m: Map) {
		const canvas = m.getCanvas();

		const onMove = (e: PointerEventLike) => {
			if (!drag) return;
			if (!drag.moved) {
				// Ignore tiny movements, so a plain click on a waypoint is not a drag.
				if (Math.hypot(e.point.x - drag.origin.x, e.point.y - drag.origin.y) < 4) return;
				drag.moved = true;
			}
			route = straightGeometry(
				moveWaypoint(drag.start, drag.path, drag.id, [e.lngLat.lng, e.lngLat.lat])
			);
		};

		const finish = () => {
			m.off('mousemove', onMove);
			m.off('touchmove', onMove);
			window.removeEventListener('mouseup', onUp);
			window.removeEventListener('touchend', onUp);
			window.removeEventListener('keydown', onKey);
			// The release produces a click; do not let it add a waypoint.
			ignoreClickUntil = performance.now() + 300;
			canvas.style.cursor = 'grab'; // the pointer is still over the marker
		};

		function onUp() {
			if (!drag) return;
			const d = drag;
			drag = null;
			finish();
			if (d.moved) update(route, true); // save, and rebuild the line with the router
		}

		function onKey(e: KeyboardEvent) {
			if (e.key !== 'Escape' || !drag) return;
			const d = drag;
			drag = null;
			finish();
			route = d.start; // cancel: put everything back
		}

		const begin = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
			const feature = e.features?.[0];
			if (!feature) return;
			e.preventDefault(); // stops the map from panning
			latest++; // a line rebuild still in flight must not fight the drag
			drag = {
				path: Number(feature.properties.path),
				id: String(feature.properties.id),
				start: route,
				moved: false,
				origin: { x: e.point.x, y: e.point.y }
			};
			canvas.style.cursor = 'grabbing';
			m.on('mousemove', onMove);
			m.on('touchmove', onMove);
			window.addEventListener('mouseup', onUp);
			window.addEventListener('touchend', onUp);
			window.addEventListener('keydown', onKey);
		};

		m.on('mousedown', WAYPOINT_LAYER, begin);
		m.on('touchstart', WAYPOINT_LAYER, (e) => {
			if (e.points.length === 1) begin(e);
		});
		m.on('mouseenter', WAYPOINT_LAYER, () => {
			if (!drag) canvas.style.cursor = 'grab';
		});
		m.on('mouseleave', WAYPOINT_LAYER, () => {
			if (!drag) canvas.style.cursor = 'crosshair';
		});

		m.on('click', (e) => {
			if (performance.now() < ignoreClickUntil) return;
			// A click on an existing waypoint does not add another one on top of it.
			const { x, y } = e.point;
			const hits = m.queryRenderedFeatures(
				[
					[x - 8, y - 8],
					[x + 8, y + 8]
				],
				{ layers: [WAYPOINT_LAYER] }
			);
			if (hits.length > 0) return;
			addWaypoint([e.lngLat.lng, e.lngLat.lat]);
		});
	}

	function onready(m: Map) {
		addRouteLayers(m);
		m.doubleClickZoom.disable(); // two quick clicks should add two waypoints, not zoom
		m.getCanvas().style.cursor = 'crosshair';
		wireInteractions(m);

		const waypoints = route.features.flatMap((f) => f.properties.waypoints);
		if (waypoints.length > 0) {
			const bounds = new LngLatBounds();
			for (const w of waypoints) bounds.extend(w.coordinates);
			// Left padding keeps the route clear of the info panel.
			m.fitBounds(bounds, {
				padding: { top: 80, bottom: 80, left: 320, right: 80 },
				maxZoom: 16,
				duration: 0
			});
		}
		map = m;
	}
</script>

<div class="wrap">
	<MapView {onready} />
	<aside>
		<a href="/">&larr; Routes</a>
		<h1>Route {meta.number}</h1>
		<RouteEditor
			{route}
			{numberError}
			onname={setName}
			oncolor={setColor}
			onkind={setKind}
			onrename={rename}
		/>
		<p class="count">{waypointCount} {waypointCount === 1 ? 'waypoint' : 'waypoints'}</p>
		<p class="hint">
			Click the map to add waypoints{meta.kind === 'loop' ? '. The loop closes automatically' : ''}.
			Drag a waypoint to move it (Esc cancels).
		</p>
		{#if message}<p class="error" role="alert">{message}</p>{/if}
	</aside>
</div>

<style>
	.wrap {
		position: fixed;
		inset: 0;
	}
	aside {
		position: absolute;
		top: 12px;
		left: 12px;
		width: 240px;
		max-height: calc(100% - 24px);
		overflow: auto;
		padding: 12px 14px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 8px;
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
		font: 14px/1.4 system-ui, sans-serif;
	}
	h1 {
		margin: 6px 0 0;
		font-size: 18px;
	}
	p {
		margin: 2px 0;
	}
	.count {
		font-weight: 600;
	}
	.hint {
		color: #555;
	}
	.error {
		color: #b00020;
	}
</style>

<script lang="ts">
	import { LngLatBounds, type Map } from 'maplibre-gl';
	import MapView from '#components/Map.svelte';
	import { appendWaypoint, deriveGeometry, straightGeometry } from '#lib/geo/edit.ts';
	import { newRoute } from '#lib/geo/factory.ts';
	import type { Position, RouteCollection } from '#lib/geo/types.ts';
	import { addRouteLayers, setRouteData } from '#lib/map/routeLayers.ts';
	import { getRouter } from '#lib/routing/index.ts';
	import { getLocalRoutes } from '#lib/store/localRoutes.ts';

	let { routeNumber }: { routeNumber: string } = $props();

	const router = getRouter();
	const store = getLocalRoutes();

	// The route is replaced, never mutated, so a raw (non-proxied) state is enough. It also keeps
	// proxies away from MapLibre.
	// svelte-ignore state_referenced_locally
	let route = $state.raw<RouteCollection>(store.get(routeNumber) ?? newRoute(routeNumber));
	let map = $state.raw<Map>();
	let message = $state<string | null>(null);

	const waypointCount = $derived(route.features[0].properties.waypoints.length);

	// Keep the map in step with the route.
	$effect(() => {
		if (map) setRouteData(map, route);
	});

	function persist(r: RouteCollection) {
		// A route is only stored once it has something in it, so merely visiting the page
		// does not create entries.
		if (r.features[0].properties.waypoints.length === 0) return;
		try {
			store.save(r);
			message = null;
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not save the route.';
		}
	}

	let latest = 0;

	async function addWaypoint(position: Position) {
		// Show the new waypoint straight away, then rebuild the line from the router.
		route = appendWaypoint(route, position);
		const seq = ++latest;
		const snapshot = route;

		let derived: RouteCollection;
		let routingFailed = false;
		try {
			derived = await deriveGeometry(snapshot, router);
		} catch {
			derived = straightGeometry(snapshot);
			routingFailed = true;
		}
		if (seq !== latest) return; // a newer click replaced this one

		route = derived;
		persist(derived);
		if (routingFailed) message = 'Routing failed, so straight lines are shown.';
	}

	function onready(m: Map) {
		addRouteLayers(m);
		m.doubleClickZoom.disable(); // two quick clicks should add two waypoints, not zoom
		m.getCanvas().style.cursor = 'crosshair';
		m.on('click', (e) => addWaypoint([e.lngLat.lng, e.lngLat.lat]));

		const waypoints = route.features.flatMap((f) => f.properties.waypoints);
		if (waypoints.length > 0) {
			const bounds = new LngLatBounds();
			for (const w of waypoints) bounds.extend(w.coordinates);
			// Left padding keeps the route clear of the info panel.
			m.fitBounds(bounds, {
				padding: { top: 80, bottom: 80, left: 280, right: 80 },
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
		<a href="/">&larr; Home</a>
		<h1>Route {routeNumber}</h1>
		<p class="count">{waypointCount} {waypointCount === 1 ? 'waypoint' : 'waypoints'}</p>
		<p class="hint">Click the map to add waypoints.</p>
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
		width: 220px;
		padding: 12px 14px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 8px;
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
		font: 14px/1.4 system-ui, sans-serif;
	}
	h1 {
		margin: 6px 0 2px;
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

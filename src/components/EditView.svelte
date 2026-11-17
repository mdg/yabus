<script lang="ts">
	import { goto } from '$app/navigation';
	import { LngLatBounds, type Map } from 'maplibre-gl';
	import MapView from '#components/Map.svelte';
	import RouteEditor from '#components/RouteEditor.svelte';
	import {
		appendWaypoint,
		deriveGeometry,
		mergeGeometry,
		straightGeometry
	} from '#lib/geo/edit.ts';
	import { newRoute } from '#lib/geo/factory.ts';
	import { applyMetadata, type MetadataPatch } from '#lib/geo/meta.ts';
	import { validateRouteNumber } from '#lib/geo/numbering.ts';
	import type { Position, RouteCollection, RouteKind } from '#lib/geo/types.ts';
	import { username } from '#lib/identity.ts';
	import { addRouteLayers, setRouteData } from '#lib/map/routeLayers.ts';
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

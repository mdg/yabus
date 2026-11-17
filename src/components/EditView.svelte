<script lang="ts">
	import { goto } from '$app/navigation';
	import { LngLatBounds, type Map, type MapLayerMouseEvent, type MapLayerTouchEvent } from 'maplibre-gl';
	import MapView from '#components/Map.svelte';
	import RouteEditor from '#components/RouteEditor.svelte';
	import {
		appendWaypoint,
		canDeleteWaypoint,
		deleteWaypoint,
		deriveGeometry,
		insertWaypointOnRoute,
		mergeGeometry,
		moveWaypoint,
		straightGeometry
	} from '#lib/geo/edit.ts';
	import { newRoute } from '#lib/geo/factory.ts';
	import { isClosed } from '#lib/geo/loop.ts';
	import { applyMetadata, type MetadataPatch } from '#lib/geo/meta.ts';
	import { validateRouteNumber } from '#lib/geo/numbering.ts';
	import type { Position, RouteCollection, RouteKind, WaypointRef } from '#lib/geo/types.ts';
	import { username } from '#lib/identity.ts';
	import {
		addRouteLayers,
		LINE_LAYER,
		setRouteData,
		WAYPOINT_LAYER
	} from '#lib/map/routeLayers.ts';
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

	// The selected waypoint, if any. It is dropped automatically once it no longer exists (after
	// a delete, a cancelled drag, or a kind change).
	let selected = $state.raw<WaypointRef | null>(null);
	const selection = $derived.by(() => {
		if (!selected) return null;
		const exists = route.features[selected.path]?.properties.waypoints.some(
			(w) => w.id === selected!.id
		);
		if (!exists) return null;
		return { ref: selected, canDelete: canDeleteWaypoint(route, selected.path, selected.id) };
	});

	// Keep the map in step with the route and the selection.
	$effect(() => {
		if (map) setRouteData(map, route, selection?.ref ?? null);
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

	/** On a closed loop the closing waypoint is the start's twin, so selecting either selects the start. */
	function select(path: number, id: string) {
		const waypoints = route.features[path]?.properties.waypoints ?? [];
		const isLoop = route.features[path]?.properties.kind === 'loop';
		if (isLoop && isClosed(waypoints) && waypoints[waypoints.length - 1].id === id) {
			id = waypoints[0].id;
		}
		selected = { path, id };
	}

	function deleteSelected() {
		if (!selection?.canDelete) return;
		const { path, id } = selection.ref;
		selected = null;
		update(deleteWaypoint(route, path, id), true);
	}

	function onKeydown(e: KeyboardEvent) {
		if (drag) return; // Esc during a drag is handled by the drag itself
		// Do not steal Delete/Backspace/Esc from the text fields in the panel.
		const target = e.target;
		if (target instanceof Element && target.closest('input[type=text], textarea, select, [contenteditable=true]')) {
			return;
		}
		if (e.key === 'Escape') {
			selected = null;
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
			e.preventDefault();
			deleteSelected();
		}
	}
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
			select(Number(feature.properties.path), String(feature.properties.id));
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
			const { x, y } = e.point;
			const around = (r: number): [[number, number], [number, number]] => [
				[x - r, y - r],
				[x + r, y + r]
			];

			// 1. On a waypoint: select it (never add a second one on top of it).
			const onWaypoint = m.queryRenderedFeatures(around(8), { layers: [WAYPOINT_LAYER] })[0];
			if (onWaypoint) {
				select(Number(onWaypoint.properties.path), String(onWaypoint.properties.id));
				return;
			}

			// 2. On the line: insert a waypoint there, between its neighbours.
			const lines = m.queryRenderedFeatures(around(6), { layers: [LINE_LAYER] });
			if (lines.length > 0) {
				const paths = [...new Set(lines.map((f) => Number(f.properties.path)))];
				const inserted = insertWaypointOnRoute(route, [e.lngLat.lng, e.lngLat.lat], paths);
				if (inserted) {
					selected = { path: inserted.path, id: inserted.waypointId };
					update(inserted.route, true);
					return;
				}
			}

			// 3. Anywhere else: add a waypoint at the end.
			selected = null;
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

<svelte:window onkeydown={onKeydown} />

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
		{#if selection}
			<div class="selection">
				<strong>Waypoint selected</strong>
				<button type="button" onclick={deleteSelected} disabled={!selection.canDelete}>
					Delete waypoint
				</button>
				{#if !selection.canDelete}
					<small>Endpoints can't be deleted while the route has a return path.</small>
				{/if}
			</div>
		{/if}
		<p class="hint">
			Click the map to add a waypoint{meta.kind === 'loop' ? ' (the loop closes automatically)' : ''}.
			Click the line to insert one. Click a waypoint to select it; Delete removes it. Drag a
			waypoint to move it (Esc cancels).
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
		font-size: 13px;
	}
	.selection {
		display: grid;
		gap: 4px;
		margin: 6px 0;
		padding: 8px;
		border-radius: 6px;
		background: #fff8d6;
		justify-items: start;
	}
	.selection button {
		font: inherit;
		font-size: 13px;
		padding: 4px 10px;
		border: 1px solid #c7a600;
		border-radius: 5px;
		background: #fff;
		color: #b00020;
		cursor: pointer;
	}
	.selection button:disabled {
		color: #888;
		border-color: #ccc;
		cursor: default;
	}
	.selection small {
		color: #666;
	}
	.error {
		color: #b00020;
	}
</style>

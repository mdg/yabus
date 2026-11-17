<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Map } from 'maplibre-gl';
	import MapView from '#components/Map.svelte';
	import { compositeBounds } from '#lib/geo/composite.ts';
	import { duplicateRoute } from '#lib/geo/duplicate.ts';
	import { nextRouteNumber } from '#lib/geo/numbering.ts';
	import type { RouteCollection } from '#lib/geo/types.ts';
	import { username as me } from '#lib/identity.ts';
	import { addRouteLayers, setCompositeData } from '#lib/map/routeLayers.ts';
	import { getLocalRoutes } from '#lib/store/localRoutes.ts';
	import { takenRouteNumbers } from '#lib/store/takenNumbers.ts';
	import { getReplicator } from '#lib/sync/index.ts';

	let {
		username,
		route,
		source
	}: { username: string; route: RouteCollection; source: 'local' | 'server' } = $props();

	const meta = $derived(route.features[0].properties);

	let busy = $state(false);
	let error = $state<string | null>(null);

	function onready(map: Map) {
		addRouteLayers(map);
		setCompositeData(map, [route]); // the line, arrows and number, with markers at the ends
		const b = compositeBounds([route]);
		if (b) {
			// Left padding keeps the route clear of the info panel.
			map.fitBounds(
				[
					[b.west, b.south],
					[b.east, b.north]
				],
				{ padding: { top: 80, bottom: 80, left: 340, right: 80 }, maxZoom: 16, duration: 0 }
			);
		}
	}

	/** Anyone can duplicate a route. The copy is a new route of the current user, which they can edit. */
	async function duplicate() {
		busy = true;
		error = null;
		try {
			// Checked against local AND server routes, so the copy can never overwrite anything.
			const number = nextRouteNumber(await takenRouteNumbers());
			const copy = duplicateRoute(route, number);
			getLocalRoutes().save(copy);
			void getReplicator().push(copy);
			await goto(`/u/${me}/${number}/edit`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not duplicate the route.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="wrap">
	<MapView {onready} />
	<aside>
		<a href="/u/{username}">&larr; {username}'s routes</a>
		<h1>
			<span class="swatch" style:background={meta.color}></span>
			{meta.number}
			<span class="name">{meta.name}</span>
		</h1>
		<p class="kind">
			{meta.kind === 'loop' ? 'Loop' : 'Point to point'}
			{#if route.features.length > 1}· 2 directions{/if}
		</p>
		<p class="note">
			{source === 'local' ? 'This is your route.' : 'Read-only.'}
		</p>
		<div class="actions">
			{#if source === 'local'}
				<a class="button" href="/u/{username}/{meta.number}/edit">Edit</a>
			{/if}
			<button type="button" onclick={duplicate} disabled={busy}>Duplicate</button>
		</div>
		<p class="hint">Duplicate makes your own editable copy of this route.</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
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
		width: 280px;
		max-height: calc(100% - 24px);
		overflow: auto;
		padding: 12px 14px;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 8px;
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
		font: 14px/1.4 system-ui, sans-serif;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 6px 0 2px;
		font-size: 18px;
	}
	.name {
		font-weight: 400;
	}
	.swatch {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	p {
		margin: 2px 0;
	}
	.kind {
		color: #555;
	}
	.note {
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin: 10px 0 4px;
	}
	.button,
	button {
		font: inherit;
		padding: 6px 12px;
		border: 1px solid #1d70b8;
		border-radius: 6px;
		background: #fff;
		color: #1d70b8;
		text-decoration: none;
		cursor: pointer;
	}
	button {
		background: #1d70b8;
		color: #fff;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.hint {
		color: #666;
		font-size: 12px;
	}
	.error {
		color: #b00020;
	}
</style>

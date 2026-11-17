<script lang="ts">
	import type { Map } from 'maplibre-gl';
	import MapView from '#components/Map.svelte';
	import { compositeBounds, type CompositeEntry } from '#lib/geo/composite.ts';
	import { routeSummary } from '#lib/geo/route.ts';
	import { addRouteLayers, setCompositeData } from '#lib/map/routeLayers.ts';

	let { username, entries }: { username: string; entries: CompositeEntry[] } = $props();

	const items = $derived(
		entries.map((e) => ({
			...routeSummary(e.route),
			source: e.source,
			waypoints: e.route.features[0].properties.waypoints.length
		}))
	);

	function onready(map: Map) {
		addRouteLayers(map);
		const routes = entries.map((e) => e.route);
		setCompositeData(map, routes);

		const b = compositeBounds(routes);
		if (b) {
			// Left padding keeps the routes clear of the list panel.
			map.fitBounds(
				[
					[b.west, b.south],
					[b.east, b.north]
				],
				{ padding: { top: 80, bottom: 80, left: 340, right: 80 }, maxZoom: 16, duration: 0 }
			);
		}
	}
</script>

<div class="wrap">
	<MapView {onready} />
	<aside>
		<a href="/">&larr; Home</a>
		<h1>{username}'s routes</h1>
		{#if items.length === 0}
			<p class="empty">No routes yet.</p>
		{:else}
			<p class="count">{items.length} {items.length === 1 ? 'route' : 'routes'}</p>
			<ul>
				{#each items as r (r.number)}
					<li>
						<span class="swatch" style:background={r.color}></span>
						<span class="text">
							{#if r.source === 'local'}
								<a href="/u/{username}/{r.number}/edit"><strong>{r.number}</strong> {r.name}</a>
							{:else}
								<a href="/u/{username}/{r.number}"><strong>{r.number}</strong> {r.name}</a>
							{/if}
							<small>
								{r.kind === 'loop' ? 'Loop' : 'Point to point'}
								{#if r.paths > 1}· 2 directions{/if}
								{#if r.source === 'server'}<span class="tag">read-only</span>{/if}
							</small>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
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
		margin: 6px 0 2px;
		font-size: 18px;
	}
	.count {
		margin: 0 0 6px;
		color: #555;
	}
	.empty {
		color: #666;
	}
	ul {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.swatch {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	.text {
		display: grid;
		min-width: 0;
	}
	li a {
		color: inherit;
		text-decoration: none;
	}
	li a:hover {
		text-decoration: underline;
	}
	small {
		color: #666;
	}
	.tag {
		margin-left: 4px;
		padding: 0 6px;
		border-radius: 8px;
		background: #eee;
		color: #444;
	}
</style>

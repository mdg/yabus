<script lang="ts">
	import { routeSummary } from '#lib/geo/route.ts';
	import { username } from '#lib/identity.ts';
	import { getLocalRoutes } from '#lib/store/localRoutes.ts';

	const store = getLocalRoutes();

	function load() {
		return store.list().flatMap((number) => {
			const route = store.get(number);
			return route
				? [{ ...routeSummary(route), waypoints: route.features[0].properties.waypoints.length }]
				: [];
		});
	}

	let routes = $state(load());

	function remove(number: string, name: string) {
		const label = name && name !== `Route ${number}` ? `route ${number} (${name})` : `route ${number}`;
		if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
		store.remove(number);
		routes = load();
	}
</script>

{#if routes.length === 0}
	<p class="empty">No routes yet.</p>
{:else}
	<ul>
		{#each routes as r (r.number)}
			<li>
				<a href="/u/{username}/{r.number}/edit">
					<span class="swatch" style:background={r.color}></span>
					<span class="text">
						<strong>{r.number}</strong>
						{r.name}
						<small>
							{r.kind === 'loop' ? 'Loop' : 'Point to point'} · {r.waypoints}
							{r.waypoints === 1 ? 'waypoint' : 'waypoints'}
						</small>
					</span>
				</a>
				<button type="button" onclick={() => remove(r.number, r.name)} aria-label="Delete route {r.number}">
					Delete
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	a {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		color: inherit;
		text-decoration: none;
	}
	a:hover {
		background: #eef3fb;
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
	small {
		color: #666;
	}
	button {
		font: inherit;
		font-size: 12px;
		padding: 3px 8px;
		border: 1px solid #c7c7c7;
		border-radius: 5px;
		background: #fff;
		color: #b00020;
		cursor: pointer;
	}
	button:hover {
		background: #fdecee;
	}
	.empty {
		margin: 8px 0 0;
		color: #666;
	}
</style>

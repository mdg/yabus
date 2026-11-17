<script lang="ts">
	import { goto } from '$app/navigation';
	import MapView from '#components/Map.svelte';
	import RouteList from '#components/RouteList.svelte';
	import { newRoute, ROUTE_COLORS } from '#lib/geo/factory.ts';
	import { nextRouteNumber } from '#lib/geo/numbering.ts';
	import { username } from '#lib/identity.ts';
	import { getLocalRoutes } from '#lib/store/localRoutes.ts';
	import { takenRouteNumbers } from '#lib/store/takenNumbers.ts';
	import { getReplicator } from '#lib/sync/index.ts';

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function createRoute() {
		busy = true;
		error = null;
		try {
			const store = getLocalRoutes();
			// The number is checked against local AND server routes, so the replicating PUT can
			// never overwrite a route that only exists on the server.
			const number = nextRouteNumber(await takenRouteNumbers());
			const color = ROUTE_COLORS[store.list().length % ROUTE_COLORS.length];
			const route = newRoute(number, color);
			store.save(route);
			void getReplicator().push(route); // claims the number on the server too
			await goto(`/u/${username}/${number}/edit`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not create the route.';
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<MapView />
	<aside>
		<h1>yabus</h1>
		<div class="actions">
			<button type="button" class="new" onclick={createRoute} disabled={busy}>New route</button>
			<a href="/u/{username}">All routes on the map</a>
		</div>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<RouteList />
	</aside>
</main>

<style>
	main {
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
		margin: 0 0 8px;
		font-size: 18px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.actions a {
		color: #0b57d0;
		font-size: 13px;
	}
	.new {
		font: inherit;
		padding: 6px 12px;
		border: 0;
		border-radius: 6px;
		background: #1d70b8;
		color: #fff;
		cursor: pointer;
	}
	.new:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.error {
		color: #b00020;
	}
</style>

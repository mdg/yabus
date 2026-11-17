<script lang="ts">
	import { onMount } from 'svelte';
	import favicon from '#lib/assets/favicon.svg';
	import { username } from '#lib/identity.ts';
	import { getLocalRoutes } from '#lib/store/localRoutes.ts';
	import { getReplicator } from '#lib/sync/index.ts';
	import { reconcile } from '#lib/sync/reconcile.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		const replicator = getReplicator();

		// Once per page load, make the server match this browser. localStorage wins: local routes
		// the server lacks, or has a different copy of, are sent and overwrite it.
		void reconcile({ username, local: getLocalRoutes().all(), replicator });

		// Do not lose an edit that is still waiting to be sent when the page is closed or hidden.
		const flush = () => void replicator.flush({ keepalive: true });
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') flush();
		};
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});
</script>

<svelte:head>
	<title>yabus</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
	}
</style>

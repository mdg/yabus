<script lang="ts">
	import MapView from '#components/Map.svelte';
	import { username } from '#lib/identity.ts';
</script>

<main>
	<MapView />
	<!-- Temporary entry point. The route list and "new route" flow replace this. -->
	<a class="draw" href="/u/{username}/1/edit">Draw route 1</a>
</main>

<style>
	main {
		position: fixed;
		inset: 0;
	}
	.draw {
		position: absolute;
		top: 12px;
		left: 12px;
		padding: 8px 12px;
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
		font: 14px system-ui, sans-serif;
		color: #0b57d0;
		text-decoration: none;
	}
</style>

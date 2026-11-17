<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { onMount } from 'svelte';
	import { BASEMAP_STYLE_URL, INITIAL_CENTER, INITIAL_ZOOM } from '#lib/map/config.ts';

	// MapLibre 6 loads its worker from a separate file. Bundlers rename and move files, so point
	// it at the emitted asset explicitly.
	setWorkerUrl(workerUrl);

	let { onready }: { onready?: (map: Map) => void } = $props();

	let container: HTMLDivElement;

	onMount(() => {
		const map = new Map({
			container,
			style: BASEMAP_STYLE_URL,
			center: INITIAL_CENTER,
			zoom: INITIAL_ZOOM
		});
		map.addControl(new NavigationControl(), 'top-right');
		// Sources and layers can only be added once the style has loaded.
		map.on('load', () => onready?.(map));

		return () => map.remove();
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
</style>

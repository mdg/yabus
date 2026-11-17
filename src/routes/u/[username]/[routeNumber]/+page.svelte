<script lang="ts">
	import ReadOnlyView from '#components/ReadOnlyView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<!-- Re-create the view when navigating from one route to another. -->
{#key `${data.username}/${data.route.features[0].properties.number}`}
	<ReadOnlyView username={data.username} route={data.route} source={data.source} />
{/key}

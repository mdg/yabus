<script lang="ts">
	import EditView from '#components/EditView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<!-- Re-create the editor when navigating from one route to another. -->
{#key data.routeNumber}
	<EditView routeNumber={data.routeNumber} />
{/key}

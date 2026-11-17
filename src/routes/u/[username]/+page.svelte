<script lang="ts">
	import CompositeView from '#components/CompositeView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<!-- Re-create the view when navigating from one user's routes to another's. -->
{#key data.username}
	<CompositeView username={data.username} entries={data.entries} />
{/key}

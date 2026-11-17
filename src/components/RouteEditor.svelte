<script lang="ts">
	import type { RouteCollection, RouteKind } from '#lib/geo/types.ts';

	let {
		route,
		numberError = null,
		onname,
		oncolor,
		onkind,
		onrename
	}: {
		route: RouteCollection;
		numberError?: string | null;
		onname: (name: string) => void;
		oncolor: (color: string) => void;
		onkind: (kind: RouteKind) => void;
		onrename: (number: string) => void;
	} = $props();

	const meta = $derived(route.features[0].properties);
	// Typing in the number field changes this copy only; the rename happens on commit.
	let numberText = $derived(meta.number);
	const hasReturnPath = $derived(route.features.length > 1);
</script>

<form onsubmit={(e) => e.preventDefault()}>
	<label>
		Number
		<input
			type="text"
			bind:value={numberText}
			maxlength="32"
			autocomplete="off"
			aria-invalid={numberError ? 'true' : undefined}
			onchange={() => onrename(numberText.trim())}
		/>
	</label>
	{#if numberError}<p class="error" role="alert">{numberError}</p>{/if}

	<label>
		Name
		<input
			type="text"
			value={meta.name}
			maxlength="200"
			autocomplete="off"
			oninput={(e) => onname(e.currentTarget.value)}
		/>
	</label>

	<label class="color">
		Color
		<input type="color" value={meta.color} oninput={(e) => oncolor(e.currentTarget.value)} />
	</label>

	<fieldset>
		<legend>Kind</legend>
		<label class="radio">
			<input
				type="radio"
				name="kind"
				checked={meta.kind === 'point-to-point'}
				onchange={() => onkind('point-to-point')}
			/>
			Point to point
		</label>
		<label class="radio" title={hasReturnPath ? 'A loop has a single path.' : undefined}>
			<input
				type="radio"
				name="kind"
				checked={meta.kind === 'loop'}
				disabled={hasReturnPath}
				onchange={() => onkind('loop')}
			/>
			Loop
		</label>
	</fieldset>
</form>

<style>
	form {
		display: grid;
		gap: 8px;
		margin: 8px 0;
	}
	label {
		display: grid;
		gap: 2px;
		font-size: 12px;
		color: #444;
	}
	input[type='text'] {
		font: inherit;
		font-size: 14px;
		padding: 5px 7px;
		border: 1px solid #aaa;
		border-radius: 5px;
	}
	input[aria-invalid='true'] {
		border-color: #b00020;
	}
	.color input {
		width: 56px;
		height: 30px;
		padding: 0;
		border: 1px solid #aaa;
		border-radius: 5px;
		background: none;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: grid;
		gap: 2px;
	}
	legend {
		padding: 0;
		font-size: 12px;
		color: #444;
	}
	.radio {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		color: inherit;
	}
	.error {
		margin: 0;
		font-size: 12px;
		color: #b00020;
	}
</style>

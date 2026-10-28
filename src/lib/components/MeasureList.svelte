<script lang="ts">
	import { details, labelText, primaryValue, type Measurement } from '#lib/measurements.ts';
	import type { Units } from '#lib/units.ts';

	let {
		items,
		units,
		selected = $bindable(),
		onremove,
		onclear
	}: {
		items: Measurement[];
		units: Units;
		selected: string | null;
		onremove: (id: string) => void;
		onclear: () => void;
	} = $props();

	let copied = $state(false);

	function copyAll() {
		const lines = items.map((m) => {
			const rows = details(m, units)
				.map(([k, v]) => `    ${k}: ${v}`)
				.join('\n');
			return `${m.name}: ${labelText(m, units)}${rows ? '\n' + rows : ''}`;
		});
		navigator.clipboard?.writeText(lines.join('\n')).then(() => {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		});
	}
</script>

<section>
	<header>
		<h2>Measurements</h2>
		{#if items.length}
			<div class="actions">
				<button class="link" onclick={copyAll}>{copied ? 'Copied' : 'Copy'}</button>
				<button class="link" onclick={onclear}>Clear all</button>
			</div>
		{/if}
	</header>

	{#if !items.length}
		<p class="empty">No measurements yet. Pick a tool above the model and click on it.</p>
	{:else}
		<ul>
			{#each items as m (m.id)}
				<li class:selected={selected === m.id} class="k-{m.kind}">
					<div
						class="row"
						role="button"
						tabindex="0"
						onclick={() => (selected = selected === m.id ? null : m.id)}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (selected = selected === m.id ? null : m.id)}
					>
						<span class="swatch"></span>
						<span class="name">{m.name}</span>
						<span class="value num">{m.kind === 'diameter' ? labelText(m, units) : units.fmtLen(primaryValue(m))}</span>
						<button
							class="x"
							aria-label="Delete {m.name}"
							onclick={(e) => {
								e.stopPropagation();
								onremove(m.id);
							}}>×</button
						>
					</div>
					{#if selected === m.id}
						<dl>
							{#each details(m, units) as [k, v] (k)}
								<dt class:coord={v.length > 18}>{k}</dt>
								<dd class="num" class:coord={v.length > 18}>{v}</dd>
							{/each}
						</dl>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	h2 {
		margin: 0;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 10px;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--muted);
		font-size: 12px;
	}
	.link:hover {
		color: var(--text);
	}
	.empty {
		color: var(--muted);
		font-size: 13px;
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	li {
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--panel-2);
		--c: var(--accent);
	}
	li.k-diameter {
		--c: var(--blue);
	}
	li.k-thickness {
		--c: var(--violet);
	}
	li.selected {
		border-color: var(--c);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 8px 7px 10px;
		cursor: pointer;
	}
	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--c);
		flex: none;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
	}
	.value {
		font-weight: 600;
		color: var(--c);
	}
	.x {
		background: none;
		border: 0;
		color: var(--muted);
		font-size: 16px;
		line-height: 1;
		padding: 0 2px;
	}
	.x:hover {
		color: var(--danger);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 3px 10px;
		margin: 0;
		padding: 0 10px 8px 26px;
		font-size: 12px;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		text-align: right;
		word-break: break-word;
	}
	.coord {
		grid-column: 1 / -1;
	}
	dd.coord {
		margin-top: -2px;
	}
</style>

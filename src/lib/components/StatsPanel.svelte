<script lang="ts">
	import type { MeshStats } from '#lib/geometry/mesh.ts';
	import type { Units } from '#lib/units.ts';

	let { stats, units, showCom = $bindable() }: { stats: MeshStats; units: Units; showCom: boolean } = $props();

	const axes = ['X', 'Y', 'Z'];
</script>

<section>
	<h2>Model</h2>
	<div class="dims">
		{#each axes as a, i (a)}
			<div class="dim">
				<span class="axis axis-{a.toLowerCase()}">{a}</span>
				<span class="num">{units.fmtLen(stats.size[i], false)}</span>
			</div>
		{/each}
	</div>
	<p class="unit-note">Bounding box in {units.display}</p>

	<dl>
		<dt>Volume</dt>
		<dd class="num">{units.fmtVolume(stats.volume)}</dd>
		<dt>Surface area</dt>
		<dd class="num">{units.fmtArea(stats.area)}</dd>
		<dt>Triangles</dt>
		<dd class="num">{stats.triangles.toLocaleString()}</dd>
		<dt>Vertices</dt>
		<dd class="num">{stats.vertices.toLocaleString()}</dd>
		<dt class="coord">Min corner (X, Y, Z)</dt>
		<dd class="num small coord">{stats.min.map((v) => units.fmtLen(v, false)).join(', ')}</dd>
		<dt class="coord">Max corner (X, Y, Z)</dt>
		<dd class="num small coord">{stats.max.map((v) => units.fmtLen(v, false)).join(', ')}</dd>
	</dl>

	<div class="com">
		<label class="toggle">
			<input type="checkbox" bind:checked={showCom} />
			<span>Center of mass</span>
		</label>
		<div class="num small">{stats.centerOfMass.map((v) => units.fmtLen(v, false)).join(', ')}</div>
	</div>

	{#if stats.openEdges > 0}
		<p class="warn">
			The mesh isn't watertight ({stats.openEdges.toLocaleString()} open edges), so volume, weight and center of
			mass are approximate.
		</p>
	{/if}
</section>

<style>
	h2 {
		margin: 0 0 10px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.dims {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.dim {
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.dim .num {
		font-size: 15px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.axis {
		font-size: 10px;
		font-weight: 700;
	}
	.axis-x {
		color: #ff6b6b;
	}
	.axis-y {
		color: #7cf29c;
	}
	.axis-z {
		color: #5fb3ff;
	}
	.unit-note {
		margin: 4px 0 12px;
		font-size: 11px;
		color: var(--muted);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 5px 12px;
		margin: 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		text-align: right;
	}
	.small {
		font-size: 12px;
	}
	.coord {
		grid-column: 1 / -1;
	}
	dd.coord {
		margin-top: -3px;
	}
	.com {
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}
	.toggle input {
		accent-color: #ff5c7a;
	}
	.warn {
		margin: 12px 0 0;
		padding: 8px 10px;
		border-radius: 6px;
		background: rgba(245, 165, 36, 0.1);
		border: 1px solid rgba(245, 165, 36, 0.35);
		color: #f8c46b;
		font-size: 12px;
	}
</style>

<script lang="ts">
	import type { MeshStats } from '#lib/geometry/mesh.ts';
	import { MATERIALS, estimatePrint, type PrintSettings } from '#lib/print.ts';
	import { fmtNum, type Units } from '#lib/units.ts';

	let { stats, units }: { stats: MeshStats; units: Units } = $props();

	const STORAGE_KEY = 'stl-measure:print';
	const defaults: PrintSettings & { material: string; currency: string } = {
		material: 'PLA',
		density: 1.24,
		price: 20,
		infill: 20,
		walls: 3,
		lineWidth: 0.45,
		filamentDiameter: 1.75,
		currency: '$'
	};

	function load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) return { ...defaults, ...JSON.parse(raw) };
		} catch {
			/* storage unavailable */
		}
		return { ...defaults };
	}

	let s = $state(load());

	$effect(() => {
		const snapshot = JSON.stringify(s);
		try {
			localStorage.setItem(STORAGE_KEY, snapshot);
		} catch {
			/* storage unavailable */
		}
	});

	function pickMaterial(name: string) {
		const m = MATERIALS.find((m) => m.name === name);
		if (m) {
			s.density = m.density;
			s.price = m.price;
		}
	}

	const k = $derived(units.toMM(1));
	const est = $derived(estimatePrint(stats.volume * k ** 3, stats.area * k ** 2, s));
	const solidGrams = $derived(((stats.volume * k ** 3) / 1000) * s.density);
</script>

<section>
	<h2>Print estimate</h2>

	<div class="grid">
		<label class="full">
			<span>Material</span>
			<select bind:value={s.material} onchange={() => pickMaterial(s.material)}>
				{#each MATERIALS as m (m.name)}
					<option value={m.name}>{m.name}</option>
				{/each}
				<option value="Custom">Custom</option>
			</select>
		</label>
		<label>
			<span>Density g/cm³</span>
			<input type="number" step="0.01" min="0.1" bind:value={s.density} oninput={() => (s.material = 'Custom')} />
		</label>
		<label>
			<span>Price / kg</span>
			<div class="with-prefix">
				<input class="prefix" type="text" maxlength="3" bind:value={s.currency} aria-label="Currency symbol" />
				<input type="number" step="0.5" min="0" bind:value={s.price} />
			</div>
		</label>
		<label class="full">
			<span>Infill <b class="num">{s.infill}%</b></span>
			<input type="range" min="0" max="100" step="5" bind:value={s.infill} />
		</label>
		<label>
			<span>Walls</span>
			<input type="number" min="0" max="20" step="1" bind:value={s.walls} />
		</label>
		<label>
			<span>Line width mm</span>
			<input type="number" min="0.1" max="2" step="0.05" bind:value={s.lineWidth} />
		</label>
	</div>

	<div class="result">
		<div class="big">
			<span class="num">{fmtNum(est.grams, 1)}</span><small>g</small>
		</div>
		<div class="big">
			<small>{s.currency}</small><span class="num">{fmtNum(est.cost, 2)}</span>
		</div>
	</div>
	<dl>
		<dt>Filament ({s.filamentDiameter} mm)</dt>
		<dd class="num">{fmtNum(est.filamentMeters, 2)} m</dd>
		<dt>Solid part weight</dt>
		<dd class="num">{fmtNum(solidGrams, 1)} g</dd>
	</dl>
	<p class="note">Rough estimate: solid walls plus infill. Doesn't include supports, brim, or top/bottom layers.</p>
</section>

<style>
	h2 {
		margin: 0 0 10px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
		color: var(--muted);
		min-width: 0;
	}
	label b {
		color: var(--text);
		font-weight: 600;
	}
	.full {
		grid-column: 1 / -1;
	}
	input[type='range'] {
		accent-color: var(--accent);
		width: 100%;
	}
	.with-prefix {
		display: flex;
		gap: 4px;
	}
	.with-prefix input {
		flex: 1;
		width: 100%;
	}
	.with-prefix .prefix {
		flex: 0 0 34px;
		text-align: center;
		padding: 5px 2px;
	}
	.result {
		display: flex;
		gap: 8px;
		margin: 14px 0 8px;
	}
	.big {
		flex: 1;
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 8px 10px;
		font-size: 20px;
		font-weight: 650;
		display: flex;
		align-items: baseline;
		gap: 3px;
	}
	.big small {
		font-size: 12px;
		color: var(--muted);
		font-weight: 500;
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
	.note {
		margin: 10px 0 0;
		font-size: 11px;
		color: var(--muted);
	}
</style>

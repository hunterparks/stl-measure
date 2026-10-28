<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
	import { Viewer, type PickHit, type ViewName } from '#lib/viewer/Viewer.ts';
	import { buildMesh, triNormal, type MeshData, type MeshStats } from '#lib/geometry/mesh.ts';
	import { detectCylinder } from '#lib/geometry/features.ts';
	import { circleFrom3Points, dot, scale, type Vec3 } from '#lib/geometry/math.ts';
	import { TOOLS, labelText, type Measurement, type Tool } from '#lib/measurements.ts';
	import { DISPLAY_UNITS, FILE_UNITS, Units, type DisplayUnit, type FileUnit } from '#lib/units.ts';
	import { samplePart } from '#lib/sample.ts';
	import StatsPanel from '#lib/components/StatsPanel.svelte';
	import PrintPanel from '#lib/components/PrintPanel.svelte';
	import MeasureList from '#lib/components/MeasureList.svelte';

	let viewportEl: HTMLDivElement;
	let fileInput: HTMLInputElement;
	let viewer: Viewer | null = $state.raw(null);

	let mesh: MeshData | null = $state.raw(null);
	let stats: MeshStats | null = $state.raw(null);
	let fileName = $state('');
	let loading = $state('');
	let dragging = $state(false);

	let fileUnit: FileUnit = $state('mm');
	let displayUnit: DisplayUnit = $state('mm');
	const units = $derived(new Units(fileUnit, displayUnit));

	let tool: Tool = $state('orbit');
	let pending: Vec3[] = $state([]);
	let measurements: Measurement[] = $state([]);
	let selected: string | null = $state(null);
	let counters: Record<string, number> = {};

	let snap = $state(true);
	let showEdges = $state(true);
	let wireframe = $state(false);
	let showCom = $state(false);

	let toast = $state<{ text: string; kind: 'error' | 'info' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout>;
	function notify(text: string, kind: 'error' | 'info' = 'error') {
		toast = { text, kind };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 4500);
	}

	onMount(() => {
		const v = new Viewer(viewportEl);
		v.onPick = handlePick;
		viewer = v;
		return () => v.dispose();
	});

	// ---------- loading ----------

	async function openFile(file: File) {
		if (!/\.stl$/i.test(file.name)) {
			notify('Please choose an .stl file.');
			return;
		}
		loading = `Reading ${file.name}…`;
		try {
			const buf = await file.arrayBuffer();
			loading = 'Analyzing mesh…';
			await new Promise((r) => setTimeout(r, 30)); // let the overlay paint
			const geometry = new STLLoader().parse(buf);
			loadGeometry(geometry, file.name);
		} catch (err) {
			console.error(err);
			notify('Couldn’t read that file. Is it a valid STL?');
		} finally {
			loading = '';
		}
	}

	async function openSample() {
		loading = 'Building sample…';
		await new Promise((r) => setTimeout(r, 30));
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(samplePart(), 3));
		fileUnit = 'mm';
		loadGeometry(geometry, 'sample-plate.stl');
		loading = '';
	}

	function loadGeometry(geometry: THREE.BufferGeometry, name: string) {
		const pos = geometry.getAttribute('position');
		if (!pos || pos.count < 3) throw new Error('No triangles found');
		geometry.deleteAttribute('normal');
		const built = buildMesh(pos.array as Float32Array);
		measurements = [];
		selected = null;
		pending = [];
		counters = {};
		mesh = built.mesh;
		stats = built.stats;
		fileName = name;
		viewer?.setModel(geometry, built.mesh, built.stats, showEdges);
		viewer?.setWireframe(wireframe);
		viewer?.setCenterOfMass(showCom ? built.stats.centerOfMass : null);
		if (tool === 'orbit') tool = 'distance';
	}

	// ---------- measuring ----------

	function nextName(base: string) {
		counters[base] = (counters[base] ?? 0) + 1;
		return `${base} ${counters[base]}`;
	}

	function draw(m: Measurement, highlight?: number[]) {
		if (!viewer) return;
		const text = labelText(m, units);
		if (m.kind === 'diameter') viewer.drawCircle(m.id, m.center, m.axis, m.radius, text, m.depth ?? 0, highlight);
		else viewer.drawSegment(m.id, m.kind, m.a, m.b, text);
	}

	function add(m: Measurement, highlight?: number[]) {
		measurements.push(m);
		draw(m, highlight);
		selected = m.id;
	}

	function handlePick(hit: PickHit) {
		if (!mesh || !viewer) return;
		const id = crypto.randomUUID();
		switch (tool) {
			case 'distance': {
				pending = [...pending, hit.point];
				if (pending.length === 2) {
					add({ id, kind: 'distance', name: nextName('Distance'), a: pending[0], b: pending[1] });
					pending = [];
				}
				break;
			}
			case 'circle3': {
				pending = [...pending, hit.point];
				if (pending.length === 3) {
					const c = circleFrom3Points(pending[0], pending[1], pending[2]);
					if (!c) notify('Those points are in a straight line. Try again.');
					else
						add({
							id,
							kind: 'diameter',
							method: '3pt',
							name: nextName('Circle'),
							center: c.center,
							axis: c.normal,
							radius: c.radius
						});
					pending = [];
				}
				break;
			}
			case 'diameter': {
				const r = detectCylinder(mesh, hit.tri);
				if ('error' in r) {
					notify(r.error);
					break;
				}
				if (r.rms > r.radius * 0.05) notify('Fit is loose. This surface may not be a true cylinder.', 'info');
				add(
					{
						id,
						kind: 'diameter',
						method: 'auto',
						name: nextName(r.isHole ? 'Hole' : 'Pin'),
						center: r.center,
						axis: r.axis,
						radius: r.radius,
						depth: r.depth,
						isHole: r.isHole,
						rms: r.rms,
						coverage: r.coverage
					},
					r.triangles
				);
				break;
			}
			case 'thickness': {
				const n = hit.normal;
				const eps = viewer.modelDiagonal * 1e-5;
				// Shoot into the material (against the outward normal); fall back to the other side for open meshes.
				const r = viewer.castRay(hit.point, scale(n, -1), eps) ?? viewer.castRay(hit.point, n, eps);
				if (!r) {
					notify('No opposite surface found from that point.');
					break;
				}
				const n2 = triNormal(mesh, r.tri);
				const angle = (Math.acos(Math.min(1, Math.abs(dot(n, n2)))) * 180) / Math.PI;
				add({ id, kind: 'thickness', name: nextName('Thickness'), a: hit.point, b: r.point, angle });
				break;
			}
		}
	}

	function remove(id: string) {
		measurements = measurements.filter((m) => m.id !== id);
		viewer?.removeOverlay(id);
		if (selected === id) selected = null;
	}

	function clearAll() {
		measurements = [];
		selected = null;
		viewer?.clearOverlays();
	}

	// ---------- sync state → viewer ----------

	$effect(() => viewer?.setPending($state.snapshot(pending) as Vec3[]));
	$effect(() => viewer?.setPicking(tool !== 'orbit' && !!mesh));
	$effect(() => {
		if (viewer) viewer.snap = snap;
	});
	$effect(() => viewer?.setEdges(showEdges));
	$effect(() => viewer?.setWireframe(wireframe));
	$effect(() => viewer?.setCenterOfMass(showCom && stats ? stats.centerOfMass : null));
	$effect(() => viewer?.setSelected(selected));
	$effect(() => {
		const u = units;
		for (const m of measurements) viewer?.setLabel(m.id, labelText(m, u));
	});

	function setTool(t: Tool) {
		tool = t;
		pending = [];
	}

	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (el.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
		if (t) setTool(t.id);
		else if (e.key === 'Escape') {
			if (pending.length) pending = [];
			else if (selected) selected = null;
			else tool = 'orbit';
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove(selected);
		else if (e.key === 's') snap = !snap;
	}

	const hint = $derived.by(() => {
		if (tool === 'distance' && pending.length === 1) return 'Click the second point. Esc to cancel.';
		if (tool === 'circle3' && pending.length) return `Click point ${pending.length + 1} of 3. Esc to cancel.`;
		return TOOLS.find((t) => t.id === tool)?.hint ?? '';
	});

	const views: { id: ViewName; label: string }[] = [
		{ id: 'iso', label: 'Iso' },
		{ id: 'top', label: 'Top' },
		{ id: 'front', label: 'Front' },
		{ id: 'right', label: 'Right' },
		{ id: 'left', label: 'Left' },
		{ id: 'back', label: 'Back' },
		{ id: 'bottom', label: 'Bottom' }
	];

	// Window-level drag & drop
	let dragDepth = 0;
	function onDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		dragDepth++;
		dragging = true;
	}
	function onDragLeave() {
		dragDepth = Math.max(0, dragDepth - 1);
		if (!dragDepth) dragging = false;
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragDepth = 0;
		dragging = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) openFile(f);
	}
</script>

<svelte:window
	onkeydown={onKey}
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={(e) => e.preventDefault()}
	ondrop={onDrop}
/>

<svelte:head>
	<title>{fileName ? `${fileName} · STL Measure` : 'STL Measure'}</title>
</svelte:head>

<input
	bind:this={fileInput}
	type="file"
	accept=".stl,model/stl,application/sla"
	hidden
	onchange={(e) => {
		const f = e.currentTarget.files?.[0];
		if (f) openFile(f);
		e.currentTarget.value = '';
	}}
/>

<div class="app">
	<header class="top">
		<div class="brand">
			<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"
				><path d="M8 22 16 7l8 15z" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round" /><path
					d="M6 26h20"
					stroke="var(--blue)"
					stroke-width="2.4"
					stroke-linecap="round"
				/></svg
			>
			<span>STL Measure</span>
		</div>
		{#if fileName}<div class="file" title={fileName}>{fileName}</div>{/if}
		<div class="spacer"></div>
		<label class="unit">
			<span>File units</span>
			<select bind:value={fileUnit} title="Units the STL was exported in">
				{#each FILE_UNITS as u (u.value)}<option value={u.value}>{u.label}</option>{/each}
			</select>
		</label>
		<label class="unit">
			<span>Show in</span>
			<select bind:value={displayUnit}>
				{#each DISPLAY_UNITS as u (u.value)}<option value={u.value}>{u.label}</option>{/each}
			</select>
		</label>
		<button class="btn primary" onclick={() => fileInput.click()}>Open STL</button>
	</header>

	<aside class="left">
		{#if stats}
			<div class="card"><StatsPanel {stats} {units} bind:showCom /></div>
			<div class="card"><PrintPanel {stats} {units} /></div>
		{:else}
			<div class="card muted-card">Open an STL to see its size, volume, and a print estimate.</div>
		{/if}
	</aside>

	<main class="stage">
		<div class="viewport" bind:this={viewportEl}></div>

		{#if mesh}
			<div class="toolbar" role="toolbar" aria-label="Measurement tools">
				{#each TOOLS as t (t.id)}
					<button class="tool" class:active={tool === t.id} onclick={() => setTool(t.id)} title="{t.label} ({t.key})">
						<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
							{#if t.id === 'orbit'}
								<path d="M12 4a8 8 0 1 0 8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><path
									d="m17 3 3.5 1.5L19 8"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else if t.id === 'distance'}
								<circle cx="5" cy="18" r="2.2" fill="currentColor" /><circle cx="19" cy="6" r="2.2" fill="currentColor" /><path
									d="M6.5 16.5 17.5 7.5"
									stroke="currentColor"
									stroke-width="1.8"
								/>
							{:else if t.id === 'diameter'}
								<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" /><path
									d="M6.3 17.7 17.7 6.3"
									stroke="currentColor"
									stroke-width="1.8"
								/>
							{:else if t.id === 'circle3'}
								<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2.5" /><circle
									cx="12"
									cy="4"
									r="2"
									fill="currentColor"
								/><circle cx="5" cy="16" r="2" fill="currentColor" /><circle cx="19" cy="16" r="2" fill="currentColor" />
							{:else}
								<path d="M4 5h16M4 19h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><path
									d="M12 8v8m-2.5-5.5L12 8l2.5 2.5m-5 3L12 16l2.5-2.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{/if}
						</svg>
						<span>{t.label}</span>
					</button>
				{/each}
				<div class="sep"></div>
				<label class="chip" title="Snap clicks to nearby triangle corners (S)">
					<input type="checkbox" bind:checked={snap} /> Snap
				</label>
			</div>

			<div class="views">
				{#each views as v (v.id)}
					<button class="chip-btn" onclick={() => viewer?.setView(v.id)}>{v.label}</button>
				{/each}
				<div class="sep"></div>
				<label class="chip"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
				<label class="chip"><input type="checkbox" bind:checked={wireframe} /> Wireframe</label>
			</div>

			<div class="hint">{hint}</div>
		{:else if !loading}
			<div class="empty">
				<button class="drop" onclick={() => fileInput.click()}>
					<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"
						><path
							d="M24 6 40 15v18L24 42 8 33V15z"
							fill="none"
							stroke="var(--accent)"
							stroke-width="2"
							stroke-linejoin="round"
						/><path d="M8 15l16 9 16-9M24 24v18" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" /></svg
					>
					<strong>Drop an STL here</strong>
					<span>or click to browse. Files stay on your computer.</span>
				</button>
				<button class="link" onclick={openSample}>Or try a sample part</button>
			</div>
		{/if}

		{#if loading}
			<div class="overlay"><div class="spinner"></div>{loading}</div>
		{/if}
		{#if dragging}
			<div class="overlay drag">Drop to open</div>
		{/if}
		{#if toast}
			<div class="toast" class:info={toast.kind === 'info'} role="status">{toast.text}</div>
		{/if}
	</main>

	<aside class="right">
		<div class="card">
			<MeasureList items={measurements} {units} bind:selected onremove={remove} onclear={clearAll} />
		</div>
		{#if mesh}
			<div class="card keys">
				<h2>Shortcuts</h2>
				<ul>
					{#each TOOLS as t (t.id)}<li><kbd>{t.key}</kbd> {t.label}</li>{/each}
					<li><kbd>S</kbd> Toggle snap</li>
					<li><kbd>Esc</kbd> Cancel / deselect</li>
					<li><kbd>Del</kbd> Delete selected</li>
				</ul>
			</div>
		{/if}
	</aside>
</div>

<style>
	.app {
		height: 100vh;
		height: 100dvh;
		display: grid;
		grid-template-columns: 300px 1fr 300px;
		grid-template-rows: auto 1fr;
		grid-template-areas:
			'top top top'
			'left stage right';
	}
	.top {
		grid-area: top;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 8px 16px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
		min-width: 0;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 700;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}
	.file {
		color: var(--muted);
		font-family: var(--mono);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		padding-left: 14px;
		border-left: 1px solid var(--line);
	}
	.spacer {
		flex: 1;
	}
	.unit {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
	}
	.btn {
		border-radius: 6px;
		padding: 6px 14px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		font-weight: 600;
		white-space: nowrap;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #1a1205;
	}
	.btn.primary:hover {
		filter: brightness(1.08);
	}

	aside {
		background: var(--panel);
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
	}
	.left {
		grid-area: left;
		border-right: 1px solid var(--line);
	}
	.right {
		grid-area: right;
		border-left: 1px solid var(--line);
	}
	.card {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 12px;
	}
	.muted-card {
		color: var(--muted);
		font-size: 13px;
	}
	.keys h2 {
		margin: 0 0 8px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.keys ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
		font-size: 12px;
		color: var(--muted);
	}
	kbd {
		display: inline-block;
		min-width: 30px;
		text-align: center;
		font: 600 11px var(--mono);
		padding: 1px 5px;
		border: 1px solid var(--line);
		border-bottom-width: 2px;
		border-radius: 4px;
		color: var(--text);
		margin-right: 6px;
	}

	.stage {
		grid-area: stage;
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: radial-gradient(ellipse at 50% 40%, #18202b 0%, var(--bg) 75%);
	}
	.viewport {
		position: absolute;
		inset: 0;
	}
	.viewport :global(canvas) {
		display: block;
		touch-action: none;
	}

	.toolbar {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: rgba(19, 25, 34, 0.92);
		border: 1px solid var(--line);
		border-radius: 10px;
		backdrop-filter: blur(6px);
		max-width: calc(100% - 24px);
		overflow-x: auto;
	}
	.tool {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--muted);
		white-space: nowrap;
		font-size: 13px;
	}
	.tool:hover {
		color: var(--text);
		background: var(--panel-2);
	}
	.tool.active {
		color: #1a1205;
		background: var(--accent);
	}
	.sep {
		width: 1px;
		align-self: stretch;
		background: var(--line);
		margin: 2px 4px;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		font-size: 12px;
		color: var(--muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.chip input {
		accent-color: var(--accent);
		margin: 0;
	}
	.views {
		position: absolute;
		left: 12px;
		bottom: 12px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		padding: 4px;
		background: rgba(19, 25, 34, 0.92);
		border: 1px solid var(--line);
		border-radius: 10px;
		max-width: calc(100% - 24px);
	}
	.chip-btn {
		border: 0;
		background: none;
		color: var(--muted);
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 12px;
	}
	.chip-btn:hover {
		background: var(--panel-2);
		color: var(--text);
	}
	.hint {
		position: absolute;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 12px;
		color: var(--muted);
		background: rgba(13, 17, 23, 0.7);
		padding: 3px 10px;
		border-radius: 999px;
		pointer-events: none;
		white-space: nowrap;
		max-width: calc(100% - 24px);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 16px;
	}
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 40px 48px;
		max-width: 100%;
		border: 1.5px dashed #3a4658;
		border-radius: 14px;
		background: rgba(19, 25, 34, 0.6);
		color: var(--muted);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.drop:hover {
		border-color: var(--accent);
		background: rgba(245, 165, 36, 0.05);
	}
	.drop strong {
		color: var(--text);
		font-size: 17px;
	}
	.link {
		background: none;
		border: 0;
		color: var(--blue);
		font-size: 13px;
	}
	.link:hover {
		text-decoration: underline;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: rgba(13, 17, 23, 0.75);
		font-weight: 600;
		z-index: 5;
	}
	.overlay.drag {
		border: 2px dashed var(--accent);
		margin: 8px;
		border-radius: 12px;
		color: var(--accent);
		font-size: 18px;
	}
	.spinner {
		width: 20px;
		height: 20px;
		border: 2.5px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.toast {
		position: absolute;
		bottom: 64px;
		left: 50%;
		transform: translateX(-50%);
		background: #2a1416;
		border: 1px solid rgba(255, 107, 107, 0.5);
		color: #ffb3b3;
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 13px;
		z-index: 6;
		max-width: calc(100% - 32px);
	}
	.toast.info {
		background: #13202b;
		border-color: rgba(79, 195, 247, 0.5);
		color: #bfe7fb;
	}

	@media (max-width: 1100px) {
		.app {
			grid-template-columns: 260px 1fr 260px;
		}
		.tool span {
			display: none;
		}
	}
	@media (max-width: 820px) {
		.app {
			height: auto;
			grid-template-columns: 1fr;
			grid-template-rows: auto 65vh auto auto;
			grid-template-areas: 'top' 'stage' 'right' 'left';
		}
		.top {
			flex-wrap: wrap;
			gap: 8px 12px;
		}
		.file {
			order: 10;
			flex-basis: 100%;
			border: 0;
			padding: 0;
		}
		.unit span {
			display: none;
		}
		aside {
			border: 0;
			overflow: visible;
		}
		.keys {
			display: none;
		}
		.hint {
			top: 60px;
		}
	}
</style>

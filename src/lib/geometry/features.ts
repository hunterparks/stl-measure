import type { MeshData } from './mesh';
import { triNormal, vertex } from './mesh';
import { basisFor, dot, eigenSym3, fitCircle2D, normalize, type Vec3 } from './math';

export interface CylinderFit {
	center: Vec3; // on the axis, at the middle of the detected wall
	axis: Vec3;
	radius: number;
	/** Length of the wall along the axis. */
	depth: number;
	/** Normals face the axis: a hole rather than a boss/pin. */
	isHole: boolean;
	/** RMS deviation of wall points from the fitted circle (file units). */
	rms: number;
	/** Fraction of 360° covered by the wall (1 = full circle). */
	coverage: number;
	triangles: number[];
}

const SMOOTH_COS = Math.cos((40 * Math.PI) / 180);

function normalCovariance(mesh: MeshData, tris: Iterable<number>): number[][] {
	const m = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0]
	];
	for (const t of tris) {
		const w = mesh.areas[t];
		const n = triNormal(mesh, t);
		for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += w * n[i] * n[j];
	}
	return m;
}

/**
 * Breadth-first growth over smoothly connected triangles.
 * `accept` filters candidates; `stop` can end growth early.
 */
function grow(
	mesh: MeshData,
	seed: number,
	accept: (t: number) => boolean,
	stop?: (region: number[]) => boolean,
	limit = 400_000
): number[] {
	const seen = new Uint8Array(mesh.triCount);
	const region: number[] = [seed];
	seen[seed] = 1;
	for (let head = 0; head < region.length && region.length < limit; head++) {
		const t = region[head];
		const nt = triNormal(mesh, t);
		for (let e = 0; e < 3; e++) {
			const nb = mesh.neighbors[t * 3 + e];
			if (nb < 0 || seen[nb]) continue;
			seen[nb] = 1;
			if (dot(nt, triNormal(mesh, nb)) < SMOOTH_COS) continue;
			if (!accept(nb)) continue;
			region.push(nb);
		}
		if (stop && (head & 15) === 0 && stop(region)) break;
	}
	return region;
}

/** Fraction of the in-plane normal spread: ~0 for flat, ~0.18 at a 90° arc, 0.5 for a full circle. */
function spread(values: Vec3) {
	const tr = values[0] + values[1] + values[2];
	return tr > 0 ? values[1] / tr : 0;
}

/**
 * Detect a cylindrical surface (hole or boss) around a clicked triangle and
 * fit its axis and radius.
 */
export function detectCylinder(mesh: MeshData, seed: number): CylinderFit | { error: string } {
	// 1. Grow a local patch until the normals cover a decent arc.
	const patch = grow(
		mesh,
		seed,
		() => true,
		(r) => r.length > 24 && spread(eigenSym3(normalCovariance(mesh, r)).values) > 0.15,
		50_000
	);
	let eig = eigenSym3(normalCovariance(mesh, patch));
	if (spread(eig.values) < 0.004) {
		return { error: 'That surface looks flat. Click on the curved wall of a hole or pin.' };
	}
	let axis = eig.vectors[0];

	// 2. Regrow only triangles whose normal is perpendicular to the axis; refine twice.
	let region = patch;
	for (let pass = 0; pass < 3; pass++) {
		const ax = axis;
		region = grow(mesh, seed, (t) => Math.abs(dot(triNormal(mesh, t), ax)) < 0.2);
		eig = eigenSym3(normalCovariance(mesh, region));
		axis = eig.vectors[0];
	}
	if (eig.values[0] / Math.max(eig.values[1], 1e-30) > 0.15) {
		return { error: 'That surface doesn’t look cylindrical (it may be a sphere or freeform shape).' };
	}

	// 3. Project the wall's vertices onto the plane perpendicular to the axis and fit a circle.
	const [u, v] = basisFor(axis);
	const used = new Set<number>();
	for (const t of region) for (let k = 0; k < 3; k++) used.add(mesh.indices[t * 3 + k]);
	const xs: number[] = [], ys: number[] = [];
	let hMin = Infinity, hMax = -Infinity;
	for (const vi of used) {
		const p = vertex(mesh, vi);
		xs.push(dot(p, u));
		ys.push(dot(p, v));
		const h = dot(p, axis);
		if (h < hMin) hMin = h;
		if (h > hMax) hMax = h;
	}
	const fit = fitCircle2D(xs, ys);
	if (!fit || !isFinite(fit.r)) return { error: 'Couldn’t fit a circle to that surface.' };

	// 4. Hole vs boss: do the normals point toward the axis? And how much of the circle is covered?
	let inward = 0;
	const bins = new Uint8Array(72);
	for (const t of region) {
		const a = vertex(mesh, mesh.indices[t * 3]);
		const px = dot(a, u) - fit.cx, py = dot(a, v) - fit.cy;
		const n = triNormal(mesh, t);
		inward += (dot(n, u) * px + dot(n, v) * py) * mesh.areas[t];
	}
	const angleOf = (p: Vec3) => Math.atan2(dot(p, v) - fit.cy, dot(p, u) - fit.cx);
	const binOf = (a: number) => Math.min(71, Math.floor(((a + Math.PI) / (2 * Math.PI)) * 72));
	for (const t of region) {
		const angs = [0, 1, 2].map((k) => angleOf(vertex(mesh, mesh.indices[t * 3 + k]))).sort((a, b) => a - b);
		let lo = angs[0], hi = angs[2];
		// Find the shortest arc containing all three angles (handles the ±π wrap).
		const gaps = [angs[1] - angs[0], angs[2] - angs[1], angs[0] + 2 * Math.PI - angs[2]];
		const big = gaps.indexOf(Math.max(...gaps));
		if (big === 0) { lo = angs[1]; hi = angs[0] + 2 * Math.PI; }
		else if (big === 1) { lo = angs[2]; hi = angs[1] + 2 * Math.PI; }
		for (let a = lo; a <= hi + 1e-9; a += Math.PI / 72) bins[binOf(((a + Math.PI) % (2 * Math.PI)) - Math.PI)] = 1;
		bins[binOf(((hi + Math.PI) % (2 * Math.PI)) - Math.PI)] = 1;
	}
	const coverage = bins.reduce((s, b) => s + b, 0) / 72;

	const hMid = (hMin + hMax) / 2;
	const center: Vec3 = [
		u[0] * fit.cx + v[0] * fit.cy + axis[0] * hMid,
		u[1] * fit.cx + v[1] * fit.cy + axis[1] * hMid,
		u[2] * fit.cx + v[2] * fit.cy + axis[2] * hMid
	];

	return {
		center,
		axis: normalize(axis),
		radius: fit.r,
		depth: hMax - hMin,
		isHole: inward < 0,
		rms: fit.rms,
		coverage,
		triangles: region
	};
}

/** Area-weighted normal of the flat (coplanar) region around a triangle. */
export function planarNormal(mesh: MeshData, seed: number): { normal: Vec3; triangles: number[] } {
	const n0 = triNormal(mesh, seed);
	const cos = Math.cos((2 * Math.PI) / 180);
	const region = grow(mesh, seed, (t) => dot(triNormal(mesh, t), n0) > cos, undefined, 200_000);
	let n: Vec3 = [0, 0, 0];
	for (const t of region) {
		const w = mesh.areas[t];
		n = [n[0] + mesh.normals[t * 3] * w, n[1] + mesh.normals[t * 3 + 1] * w, n[2] + mesh.normals[t * 3 + 2] * w];
	}
	return { normal: normalize(n), triangles: region };
}

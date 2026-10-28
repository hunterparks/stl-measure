import type { Vec3 } from './math';

/**
 * Indexed mesh built from an STL triangle soup. Triangle `i` here is the same
 * triangle as triangle `i` in the rendered (non-indexed) geometry.
 */
export interface MeshData {
	triCount: number;
	vertCount: number;
	/** Welded vertex positions, xyz per vertex. */
	positions: Float32Array;
	/** 3 vertex indices per triangle. */
	indices: Uint32Array;
	/** Outward unit normal per triangle (from winding, flipped if the mesh is inside-out). */
	normals: Float32Array;
	areas: Float32Array;
	/** Neighbor triangle across each edge (v0-v1, v1-v2, v2-v0), or -1. */
	neighbors: Int32Array;
}

export interface MeshStats {
	triangles: number;
	vertices: number;
	min: Vec3;
	max: Vec3;
	size: Vec3;
	/** Absolute enclosed volume (file units³). */
	volume: number;
	/** File units². */
	area: number;
	/** Center of mass assuming uniform density (or area-weighted center if the mesh isn't closed). */
	centerOfMass: Vec3;
	/** Edges that don't have exactly two triangles. 0 means the mesh is watertight. */
	openEdges: number;
	/** True if the triangle winding pointed inward and was flipped for analysis. */
	inverted: boolean;
}

/** Merge vertices with identical coordinates using a hash on the float bits. */
function weld(soup: Float32Array): { positions: Float32Array; indices: Uint32Array } {
	const n = soup.length / 3;
	const bits = new Uint32Array(soup.buffer, soup.byteOffset, soup.length);
	// Normalize -0 to 0 so they hash the same.
	for (let i = 0; i < soup.length; i++) if (soup[i] === 0) soup[i] = 0;

	let size = 1;
	while (size < n * 2) size <<= 1;
	const mask = size - 1;
	const table = new Int32Array(size).fill(-1);
	const indices = new Uint32Array(n);
	const out = new Float32Array(soup.length);
	const outBits = new Uint32Array(out.buffer);
	let count = 0;

	for (let i = 0; i < n; i++) {
		const x = bits[i * 3], y = bits[i * 3 + 1], z = bits[i * 3 + 2];
		let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
		for (;;) {
			const slot = table[h];
			if (slot === -1) {
				table[h] = count;
				out[count * 3] = soup[i * 3];
				out[count * 3 + 1] = soup[i * 3 + 1];
				out[count * 3 + 2] = soup[i * 3 + 2];
				indices[i] = count++;
				break;
			}
			if (outBits[slot * 3] === x && outBits[slot * 3 + 1] === y && outBits[slot * 3 + 2] === z) {
				indices[i] = slot;
				break;
			}
			h = (h + 1) & mask;
		}
	}
	return { positions: out.slice(0, count * 3), indices };
}

export function buildMesh(soup: Float32Array): { mesh: MeshData; stats: MeshStats } {
	const triCount = soup.length / 9;
	const { positions: P, indices: I } = weld(new Float32Array(soup));
	const vertCount = P.length / 3;

	const normals = new Float32Array(triCount * 3);
	const areas = new Float32Array(triCount);
	let vol = 0, area = 0;
	let cx = 0, cy = 0, cz = 0; // volume-weighted
	let ax = 0, ay = 0, az = 0; // area-weighted fallback
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < vertCount; i++) {
		for (let k = 0; k < 3; k++) {
			const v = P[i * 3 + k];
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
		}
	}
	// Use a reference point near the model to keep volume sums precise.
	const ox = (min[0] + max[0]) / 2, oy = (min[1] + max[1]) / 2, oz = (min[2] + max[2]) / 2;

	for (let t = 0; t < triCount; t++) {
		const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
		const x0 = P[a] - ox, y0 = P[a + 1] - oy, z0 = P[a + 2] - oz;
		const x1 = P[b] - ox, y1 = P[b + 1] - oy, z1 = P[b + 2] - oz;
		const x2 = P[c] - ox, y2 = P[c + 1] - oy, z2 = P[c + 2] - oz;
		const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
		const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const nl = Math.hypot(nx, ny, nz);
		const ar = nl / 2;
		areas[t] = ar;
		area += ar;
		if (nl > 0) {
			normals[t * 3] = nx / nl;
			normals[t * 3 + 1] = ny / nl;
			normals[t * 3 + 2] = nz / nl;
		}
		const v6 = x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2);
		vol += v6;
		cx += v6 * (x0 + x1 + x2);
		cy += v6 * (y0 + y1 + y2);
		cz += v6 * (z0 + z1 + z2);
		ax += ar * (x0 + x1 + x2);
		ay += ar * (y0 + y1 + y2);
		az += ar * (z0 + z1 + z2);
	}

	// Edge adjacency.
	const neighbors = new Int32Array(triCount * 3).fill(-1);
	const edgeMap = new Map<number, number>();
	const edgeUse = new Map<number, number>();
	for (let t = 0; t < triCount; t++) {
		for (let e = 0; e < 3; e++) {
			const v0 = I[t * 3 + e], v1 = I[t * 3 + ((e + 1) % 3)];
			if (v0 === v1) continue;
			const key = v0 < v1 ? v0 * vertCount + v1 : v1 * vertCount + v0;
			const other = edgeMap.get(key);
			edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
			if (other === undefined) {
				edgeMap.set(key, t * 3 + e);
			} else if (other >= 0) {
				neighbors[t * 3 + e] = Math.floor(other / 3);
				neighbors[other] = t;
				edgeMap.set(key, -1); // paired; further uses are non-manifold
			}
		}
	}
	let openEdges = 0;
	for (const c of edgeUse.values()) if (c !== 2) openEdges++;

	const inverted = vol < 0;
	if (inverted) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];

	const closed = openEdges === 0 && Math.abs(vol) > 0;
	const centerOfMass: Vec3 = closed
		? [cx / (4 * vol) + ox, cy / (4 * vol) + oy, cz / (4 * vol) + oz]
		: [ax / (3 * area) + ox, ay / (3 * area) + oy, az / (3 * area) + oz];

	return {
		mesh: { triCount, vertCount, positions: P, indices: I, normals, areas, neighbors },
		stats: {
			triangles: triCount,
			vertices: vertCount,
			min,
			max,
			size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
			volume: Math.abs(vol) / 6,
			area,
			centerOfMass,
			openEdges,
			inverted
		}
	};
}

export function triNormal(mesh: MeshData, t: number): Vec3 {
	return [mesh.normals[t * 3], mesh.normals[t * 3 + 1], mesh.normals[t * 3 + 2]];
}

export function vertex(mesh: MeshData, v: number): Vec3 {
	return [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
}

export function triVertices(mesh: MeshData, t: number): [Vec3, Vec3, Vec3] {
	return [vertex(mesh, mesh.indices[t * 3]), vertex(mesh, mesh.indices[t * 3 + 1]), vertex(mesh, mesh.indices[t * 3 + 2])];
}

export type Vec3 = [number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
export const normalize = (a: Vec3): Vec3 => {
	const l = len(a);
	return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Two unit vectors perpendicular to `n` and to each other. */
export function basisFor(n: Vec3): [Vec3, Vec3] {
	const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = normalize(cross(n, helper));
	const v = cross(n, u);
	return [u, v];
}

/**
 * Eigen-decomposition of a symmetric 3x3 matrix (Jacobi rotations).
 * Returns eigenvalues ascending with matching unit eigenvectors.
 */
export function eigenSym3(m: number[][]): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
	const a = m.map((r) => r.slice());
	const v = [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1]
	];
	for (let sweep = 0; sweep < 50; sweep++) {
		const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
		if (off < 1e-15) break;
		for (const [p, q] of [
			[0, 1],
			[0, 2],
			[1, 2]
		]) {
			if (Math.abs(a[p][q]) < 1e-18) continue;
			const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
			const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
			const c = 1 / Math.sqrt(t * t + 1);
			const s = t * c;
			for (let k = 0; k < 3; k++) {
				const akp = a[k][p];
				const akq = a[k][q];
				a[k][p] = c * akp - s * akq;
				a[k][q] = s * akp + c * akq;
			}
			for (let k = 0; k < 3; k++) {
				const apk = a[p][k];
				const aqk = a[q][k];
				a[p][k] = c * apk - s * aqk;
				a[q][k] = s * apk + c * aqk;
			}
			for (let k = 0; k < 3; k++) {
				const vkp = v[k][p];
				const vkq = v[k][q];
				v[k][p] = c * vkp - s * vkq;
				v[k][q] = s * vkp + c * vkq;
			}
		}
	}
	const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
	return {
		values: order.map((i) => a[i][i]) as Vec3,
		vectors: order.map((i) => normalize([v[0][i], v[1][i], v[2][i]])) as [Vec3, Vec3, Vec3]
	};
}

/** Least-squares circle fit (Kåsa) on 2D points. */
export function fitCircle2D(xs: number[], ys: number[]): { cx: number; cy: number; r: number; rms: number } | null {
	const n = xs.length;
	if (n < 3) return null;
	// Center the data for numerical stability.
	let mx = 0,
		my = 0;
	for (let i = 0; i < n; i++) {
		mx += xs[i];
		my += ys[i];
	}
	mx /= n;
	my /= n;
	let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
	for (let i = 0; i < n; i++) {
		const u = xs[i] - mx;
		const v = ys[i] - my;
		suu += u * u;
		suv += u * v;
		svv += v * v;
		suuu += u * u * u;
		svvv += v * v * v;
		suvv += u * v * v;
		svuu += v * u * u;
	}
	const det = suu * svv - suv * suv;
	if (Math.abs(det) < 1e-20) return null;
	const b1 = 0.5 * (suuu + suvv);
	const b2 = 0.5 * (svvv + svuu);
	const uc = (b1 * svv - b2 * suv) / det;
	const vc = (suu * b2 - suv * b1) / det;
	const cx = uc + mx;
	const cy = vc + my;
	let rSum = 0;
	const rs: number[] = new Array(n);
	for (let i = 0; i < n; i++) {
		rs[i] = Math.hypot(xs[i] - cx, ys[i] - cy);
		rSum += rs[i];
	}
	const r = rSum / n;
	let e = 0;
	for (let i = 0; i < n; i++) e += (rs[i] - r) ** 2;
	return { cx, cy, r, rms: Math.sqrt(e / n) };
}

/** Circle through three 3D points. */
export function circleFrom3Points(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number; normal: Vec3 } | null {
	const ab = sub(b, a);
	const ac = sub(c, a);
	const n = cross(ab, ac);
	const n2 = dot(n, n);
	if (n2 < 1e-24) return null; // collinear
	const t1 = scale(cross(n, ab), dot(ac, ac));
	const t2 = scale(cross(ac, n), dot(ab, ab));
	const offset = scale(add(t1, t2), 1 / (2 * n2));
	return { center: add(a, offset), radius: len(offset), normal: normalize(n) };
}

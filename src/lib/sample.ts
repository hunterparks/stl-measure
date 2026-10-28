/**
 * Procedural sample part: a 60×60×8 mm plate with a Ø20 through-hole,
 * plus a separate Ø10×20 mm pin beside it. Returns an STL-style triangle soup.
 */
export function samplePart(segments = 64): Float32Array {
	const out: number[] = [];
	const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);

	const half = 30, r = 10, h = 8;
	for (let i = 0; i < segments; i++) {
		const t0 = (2 * Math.PI * i) / segments;
		const t1 = (2 * Math.PI * ((i + 1) % segments)) / segments;
		const c0 = [r * Math.cos(t0), r * Math.sin(t0)];
		const c1 = [r * Math.cos(t1), r * Math.sin(t1)];
		const sq = (t: number) => {
			const k = half / Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t)));
			return [k * Math.cos(t), k * Math.sin(t)];
		};
		const s0 = sq(t0), s1 = sq(t1);
		const at = (p: number[], z: number) => [p[0], p[1], z];
		// top
		tri(at(c0, h), at(s0, h), at(s1, h));
		tri(at(c0, h), at(s1, h), at(c1, h));
		// bottom
		tri(at(c0, 0), at(s1, 0), at(s0, 0));
		tri(at(c0, 0), at(c1, 0), at(s1, 0));
		// outer wall
		tri(at(s0, 0), at(s1, 0), at(s1, h));
		tri(at(s0, 0), at(s1, h), at(s0, h));
		// hole wall (faces the axis)
		tri(at(c0, 0), at(c1, h), at(c1, 0));
		tri(at(c0, 0), at(c0, h), at(c1, h));
	}

	// Pin beside the plate.
	const px = 48, py = 0, pr = 5, ph = 20;
	for (let i = 0; i < segments; i++) {
		const t0 = (2 * Math.PI * i) / segments;
		const t1 = (2 * Math.PI * ((i + 1) % segments)) / segments;
		const p0 = [px + pr * Math.cos(t0), py + pr * Math.sin(t0)];
		const p1 = [px + pr * Math.cos(t1), py + pr * Math.sin(t1)];
		tri([px, py, ph], [p0[0], p0[1], ph], [p1[0], p1[1], ph]);
		tri([px, py, 0], [p1[0], p1[1], 0], [p0[0], p0[1], 0]);
		tri([p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], ph]);
		tri([p0[0], p0[1], 0], [p1[0], p1[1], ph], [p0[0], p0[1], ph]);
	}
	return new Float32Array(out);
}

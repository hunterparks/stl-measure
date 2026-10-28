import type { Vec3 } from './geometry/math';
import { dist, sub } from './geometry/math';
import type { Units } from './units';

export type Tool = 'orbit' | 'distance' | 'diameter' | 'circle3' | 'thickness';

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
	{ id: 'orbit', label: 'Orbit', key: 'Q', hint: 'Drag to rotate, right-drag to pan, scroll to zoom.' },
	{ id: 'distance', label: 'Distance', key: 'D', hint: 'Click two points. Points snap to nearby corners (green).' },
	{ id: 'diameter', label: 'Hole / Pin', key: 'H', hint: 'Click the curved wall of a hole or pin to fit its diameter.' },
	{ id: 'circle3', label: '3-Point Circle', key: 'C', hint: 'Click three points on a circular edge.' },
	{ id: 'thickness', label: 'Thickness', key: 'T', hint: 'Click a face to measure through to the opposite side.' }
];

interface Base {
	id: string;
	name: string;
}

export interface DistanceM extends Base {
	kind: 'distance';
	a: Vec3;
	b: Vec3;
}

export interface DiameterM extends Base {
	kind: 'diameter';
	method: 'auto' | '3pt';
	center: Vec3;
	axis: Vec3;
	radius: number;
	depth?: number;
	isHole?: boolean;
	rms?: number;
	coverage?: number;
}

export interface ThicknessM extends Base {
	kind: 'thickness';
	a: Vec3;
	b: Vec3;
	/** Angle between the clicked face and the opposite face, in degrees (0 = parallel). */
	angle: number;
}

export type Measurement = DistanceM | DiameterM | ThicknessM;

export function primaryValue(m: Measurement): number {
	switch (m.kind) {
		case 'distance':
		case 'thickness':
			return dist(m.a, m.b);
		case 'diameter':
			return m.radius * 2;
	}
}

export function labelText(m: Measurement, u: Units): string {
	switch (m.kind) {
		case 'distance':
			return u.fmtLen(dist(m.a, m.b));
		case 'thickness':
			return `t ${u.fmtLen(dist(m.a, m.b))}`;
		case 'diameter':
			return m.coverage !== undefined && m.coverage < 0.75 ? `R ${u.fmtLen(m.radius)}` : `Ø ${u.fmtLen(m.radius * 2)}`;
	}
}

/** Extra rows shown in the measurement list. */
export function details(m: Measurement, u: Units): [string, string][] {
	switch (m.kind) {
		case 'distance': {
			const d = sub(m.b, m.a);
			return [
				['ΔX', u.fmtLen(Math.abs(d[0]))],
				['ΔY', u.fmtLen(Math.abs(d[1]))],
				['ΔZ', u.fmtLen(Math.abs(d[2]))]
			];
		}
		case 'thickness':
			return [['Opposite face', m.angle < 0.5 ? 'parallel' : `${m.angle.toFixed(1)}° off parallel`]];
		case 'diameter': {
			const rows: [string, string][] = [
				['Diameter', u.fmtLen(m.radius * 2)],
				['Radius', u.fmtLen(m.radius)],
				['Center', m.center.map((c) => u.fmtLen(c, false)).join(', ')]
			];
			if (m.method === 'auto') {
				rows.push(['Type', m.isHole ? 'Hole (internal)' : 'Pin / boss (external)']);
				if (m.depth) rows.push(['Depth', u.fmtLen(m.depth)]);
				rows.push(['Axis', m.axis.map((c) => c.toFixed(3)).join(', ')]);
				if (m.coverage !== undefined) rows.push(['Arc', `${Math.round(m.coverage * 360)}°`]);
				if (m.rms !== undefined) rows.push(['Fit error (RMS)', u.fmtLen(m.rms)]);
			}
			return rows;
		}
	}
}

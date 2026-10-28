export interface Material {
	name: string;
	density: number; // g/cm³
	price: number; // per kg
}

export const MATERIALS: Material[] = [
	{ name: 'PLA', density: 1.24, price: 20 },
	{ name: 'PETG', density: 1.27, price: 22 },
	{ name: 'ABS', density: 1.04, price: 20 },
	{ name: 'ASA', density: 1.07, price: 25 },
	{ name: 'TPU', density: 1.21, price: 30 },
	{ name: 'Nylon (PA)', density: 1.14, price: 40 },
	{ name: 'PC', density: 1.2, price: 35 },
	{ name: 'Resin (SLA)', density: 1.12, price: 35 }
];

export interface PrintSettings {
	density: number; // g/cm³
	price: number; // per kg
	infill: number; // 0–100 %
	walls: number; // perimeter count
	lineWidth: number; // mm
	filamentDiameter: number; // mm
}

export interface PrintEstimate {
	shellVolume: number; // mm³
	infillVolume: number; // mm³
	plasticVolume: number; // mm³
	grams: number;
	cost: number;
	filamentMeters: number;
}

/**
 * Rough FDM estimate: the outer skin (surface area × wall thickness) is solid,
 * the rest is filled at the infill percentage. Ignores supports and top/bottom layers.
 */
export function estimatePrint(volumeMM3: number, areaMM2: number, input: PrintSettings): PrintEstimate {
	// Empty number inputs come through as null; treat them as 0.
	const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
	const s = {
		density: n(input.density),
		price: n(input.price),
		infill: n(input.infill),
		walls: n(input.walls),
		lineWidth: n(input.lineWidth),
		filamentDiameter: n(input.filamentDiameter) || 1.75
	};
	const wall = s.walls * s.lineWidth;
	const shellVolume = Math.min(volumeMM3, areaMM2 * wall);
	const infillVolume = Math.max(0, volumeMM3 - shellVolume) * (s.infill / 100);
	const plasticVolume = shellVolume + infillVolume;
	const grams = (plasticVolume / 1000) * s.density;
	const filamentArea = Math.PI * (s.filamentDiameter / 2) ** 2;
	return {
		shellVolume,
		infillVolume,
		plasticVolume,
		grams,
		cost: (grams / 1000) * s.price,
		filamentMeters: plasticVolume / filamentArea / 1000
	};
}

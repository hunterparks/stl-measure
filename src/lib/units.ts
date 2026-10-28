export type FileUnit = 'mm' | 'cm' | 'm' | 'in';
export type DisplayUnit = 'mm' | 'cm' | 'in';

/** Millimeters per unit. */
export const MM_PER: Record<FileUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export const FILE_UNITS: { value: FileUnit; label: string }[] = [
	{ value: 'mm', label: 'Millimeters' },
	{ value: 'cm', label: 'Centimeters' },
	{ value: 'm', label: 'Meters' },
	{ value: 'in', label: 'Inches' }
];

export const DISPLAY_UNITS: { value: DisplayUnit; label: string }[] = [
	{ value: 'mm', label: 'mm' },
	{ value: 'cm', label: 'cm' },
	{ value: 'in', label: 'in' }
];

export class Units {
	constructor(
		public file: FileUnit,
		public display: DisplayUnit
	) {}

	/** File units → millimeters. */
	toMM(v: number) {
		return v * MM_PER[this.file];
	}

	/** File units → display units. */
	len(v: number) {
		return (v * MM_PER[this.file]) / MM_PER[this.display];
	}

	private digits(v: number) {
		const d = this.display === 'in' ? 4 : this.display === 'cm' ? 3 : 2;
		return Math.abs(v) >= 1000 ? Math.max(0, d - 2) : d;
	}

	fmtLen(v: number, withUnit = true) {
		let x = this.len(v);
		const d = this.digits(x);
		if (Number(x.toFixed(d)) === 0) x = 0; // avoid "-0.00"
		return x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + (withUnit ? ` ${this.display}` : '');
	}

	fmtArea(v: number) {
		const k = MM_PER[this.file] / MM_PER[this.display];
		return fmtNum(v * k * k, 2) + ` ${this.display}²`;
	}

	fmtVolume(v: number) {
		const k = MM_PER[this.file] / MM_PER[this.display];
		return fmtNum(v * k * k * k, 2) + ` ${this.display}³`;
	}
}

export function fmtNum(v: number, digits = 2) {
	return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

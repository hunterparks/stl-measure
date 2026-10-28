import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { MeshData, MeshStats } from '#lib/geometry/mesh.ts';
import { triNormal, triVertices } from '#lib/geometry/mesh.ts';
import { basisFor, type Vec3 } from '#lib/geometry/math.ts';

export interface PickHit {
	point: Vec3;
	tri: number;
	normal: Vec3;
	snapped: boolean;
}

export type ViewName = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

const COLORS = {
	model: 0xc9ced6,
	edges: 0x39414d,
	distance: 0xf5a524,
	diameter: 0x4fc3f7,
	thickness: 0xb388ff,
	pending: 0xffffff,
	com: 0xff5c7a
};
export type OverlayKind = 'distance' | 'diameter' | 'thickness';

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

export class Viewer {
	private renderer: THREE.WebGLRenderer;
	private labels: CSS2DRenderer;
	private scene = new THREE.Scene();
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private raycaster = new THREE.Raycaster();
	private resizeObs: ResizeObserver;
	private frame = 0;

	private model: THREE.Mesh | null = null;
	private edges: THREE.LineSegments | null = null;
	private grid: THREE.Object3D | null = null;
	private axes: THREE.AxesHelper | null = null;
	private com: THREE.Object3D | null = null;
	private hoverDot: THREE.Mesh;
	private pendingGroup = new THREE.Group();
	private overlays = new Map<string, { group: THREE.Group; label: HTMLDivElement }>();

	private mesh: MeshData | null = null;
	private stats: MeshStats | null = null;
	private diag = 1;
	private down: { x: number; y: number } | null = null;
	private hoverQueued: PointerEvent | null = null;

	picking = false;
	snap = true;
	onPick: ((hit: PickHit) => void) | null = null;

	constructor(private container: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		container.appendChild(this.renderer.domElement);

		this.labels = new CSS2DRenderer();
		this.labels.domElement.className = 'label-layer';
		container.appendChild(this.labels.domElement);

		this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1e6);
		this.camera.up.set(0, 0, 1);
		this.camera.position.set(1, -1, 1);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.15;
		this.controls.addEventListener('change', () => this.requestRender());

		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.6));
		const key = new THREE.DirectionalLight(0xffffff, 1.6);
		key.position.set(0.5, -0.3, 1);
		this.camera.add(key);
		this.scene.add(this.camera);
		this.scene.add(this.pendingGroup);

		this.hoverDot = new THREE.Mesh(
			new THREE.SphereGeometry(1, 16, 12),
			new THREE.MeshBasicMaterial({ color: COLORS.pending, depthTest: false, transparent: true, opacity: 0.9 })
		);
		this.hoverDot.renderOrder = 10;
		this.hoverDot.visible = false;
		this.scene.add(this.hoverDot);

		const el = this.renderer.domElement;
		el.addEventListener('pointerdown', this.onDown);
		el.addEventListener('pointerup', this.onUp);
		el.addEventListener('pointermove', this.onMove);
		el.addEventListener('pointerleave', this.onLeave);

		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(container);
		this.resize();
	}

	dispose() {
		cancelAnimationFrame(this.frame);
		this.resizeObs.disconnect();
		this.clearModel();
		this.controls.dispose();
		this.renderer.dispose();
		this.renderer.domElement.remove();
		this.labels.domElement.remove();
	}

	// ---------- model ----------

	setModel(geometry: THREE.BufferGeometry, mesh: MeshData, stats: MeshStats, showEdges: boolean) {
		this.clearModel();
		this.mesh = mesh;
		this.stats = stats;
		geometry.computeVertexNormals();
		geometry.boundsTree = new MeshBVH(geometry);

		const material = new THREE.MeshStandardMaterial({
			color: COLORS.model,
			metalness: 0.05,
			roughness: 0.65,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1
		});
		this.model = new THREE.Mesh(geometry, material);
		this.model.raycast = acceleratedRaycast;
		this.scene.add(this.model);

		const [min, max] = [v3(stats.min), v3(stats.max)];
		this.diag = Math.max(min.distanceTo(max), 1e-6);
		this.hoverDot.scale.setScalar(this.diag * 0.005);

		// Ground grid in the XY plane under the model.
		const span = Math.max(stats.size[0], stats.size[1]) * 1.6 || 1;
		const step = 10 ** Math.floor(Math.log10(span / 4));
		const size = Math.ceil(span / step) * step;
		const grid = new THREE.GridHelper(size, Math.round(size / step), 0x56606e, 0x2a313b);
		grid.rotation.x = Math.PI / 2;
		grid.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, min.z);
		(grid.material as THREE.Material).transparent = true;
		(grid.material as THREE.Material).opacity = 0.6;
		this.grid = grid;
		this.scene.add(grid);

		this.axes = new THREE.AxesHelper(this.diag * 0.12);
		(this.axes.material as THREE.Material).depthTest = false;
		this.axes.renderOrder = 5;
		this.scene.add(this.axes);

		this.setEdges(showEdges);
		this.camera.near = this.diag / 1000;
		this.camera.far = this.diag * 100;
		this.setView('iso');
	}

	private clearModel() {
		this.clearOverlays();
		this.setPending([]);
		for (const o of [this.model, this.edges, this.grid, this.axes, this.com]) {
			if (!o) continue;
			this.scene.remove(o);
			o.traverse((c) => {
				const m = c as THREE.Mesh;
				if (m.geometry) m.geometry.dispose();
			});
		}
		this.model = this.edges = this.grid = this.axes = this.com = null;
		this.mesh = null;
	}

	setEdges(on: boolean) {
		if (this.edges) {
			this.scene.remove(this.edges);
			this.edges.geometry.dispose();
			this.edges = null;
		}
		if (on && this.model && this.mesh && this.mesh.triCount < 600_000) {
			this.edges = new THREE.LineSegments(
				new THREE.EdgesGeometry(this.model.geometry, 30),
				new THREE.LineBasicMaterial({ color: COLORS.edges })
			);
			this.scene.add(this.edges);
		}
		this.requestRender();
	}

	setWireframe(on: boolean) {
		if (this.model) (this.model.material as THREE.MeshStandardMaterial).wireframe = on;
		this.requestRender();
	}

	setCenterOfMass(p: Vec3 | null) {
		if (this.com) {
			this.scene.remove(this.com);
			this.com = null;
		}
		if (p) {
			const g = new THREE.Group();
			const r = this.diag * 0.012;
			const mat = new THREE.MeshBasicMaterial({ color: COLORS.com, depthTest: false });
			const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
			ball.renderOrder = 8;
			g.add(ball);
			const lineMat = new THREE.LineBasicMaterial({ color: COLORS.com, depthTest: false });
			for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
				const line = new THREE.Line(
					new THREE.BufferGeometry().setFromPoints([axis.clone().multiplyScalar(-r * 3), axis.clone().multiplyScalar(r * 3)]),
					lineMat
				);
				line.renderOrder = 8;
				g.add(line);
			}
			g.position.copy(v3(p));
			this.com = g;
			this.scene.add(g);
		}
		this.requestRender();
	}

	setView(view: ViewName) {
		if (!this.stats) return;
		const c = v3(this.stats.min).add(v3(this.stats.max)).multiplyScalar(0.5);
		const dirs: Record<ViewName, THREE.Vector3> = {
			iso: new THREE.Vector3(1, -1.2, 0.9),
			top: new THREE.Vector3(0, -0.0001, 1),
			bottom: new THREE.Vector3(0, 0.0001, -1),
			front: new THREE.Vector3(0, -1, 0),
			back: new THREE.Vector3(0, 1, 0),
			left: new THREE.Vector3(-1, 0, 0),
			right: new THREE.Vector3(1, 0, 0)
		};
		const fov = (this.camera.fov * Math.PI) / 180;
		const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
		const distance = (this.diag / 2 / Math.sin(fit / 2)) * 1.05;
		this.camera.position.copy(c).add(dirs[view].normalize().multiplyScalar(distance));
		this.controls.target.copy(c);
		this.controls.update();
		this.requestRender();
	}

	// ---------- picking ----------

	private onDown = (e: PointerEvent) => {
		if (e.button === 0) this.down = { x: e.clientX, y: e.clientY };
	};

	private onUp = (e: PointerEvent) => {
		const d = this.down;
		this.down = null;
		if (!d || !this.picking || e.button !== 0) return;
		if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // it was a drag
		const hit = this.pick(e);
		if (hit) this.onPick?.(hit);
	};

	private onMove = (e: PointerEvent) => {
		if (!this.picking) return;
		if (!this.hoverQueued) requestAnimationFrame(() => this.updateHover());
		this.hoverQueued = e;
	};

	private onLeave = () => {
		this.hoverDot.visible = false;
		this.requestRender();
	};

	private updateHover() {
		const e = this.hoverQueued;
		this.hoverQueued = null;
		if (!e) return;
		const hit = this.picking ? this.pick(e) : null;
		this.hoverDot.visible = !!hit;
		if (hit) {
			this.hoverDot.position.copy(v3(hit.point));
			(this.hoverDot.material as THREE.MeshBasicMaterial).color.set(hit.snapped ? 0x7cf29c : COLORS.pending);
		}
		this.renderer.domElement.style.cursor = hit ? 'crosshair' : '';
		this.requestRender();
	}

	setPicking(on: boolean) {
		this.picking = on;
		if (!on) {
			this.hoverDot.visible = false;
			this.renderer.domElement.style.cursor = '';
		}
		this.requestRender();
	}

	private ndc(e: { clientX: number; clientY: number }) {
		const r = this.renderer.domElement.getBoundingClientRect();
		return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
	}

	private pick(e: PointerEvent): PickHit | null {
		if (!this.model || !this.mesh) return null;
		this.raycaster.setFromCamera(this.ndc(e), this.camera);
		this.raycaster.firstHitOnly = true;
		const hit = this.raycaster.intersectObject(this.model, false)[0];
		if (!hit || !hit.face) return null;
		const tri = Math.floor(hit.face.a / 3);
		let point: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
		let snapped = false;
		if (this.snap) {
			// Snap to the nearest triangle corner if it's within ~12px on screen.
			const r = this.renderer.domElement.getBoundingClientRect();
			let best = 12;
			for (const v of triVertices(this.mesh, tri)) {
				const s = v3(v).project(this.camera);
				const px = ((s.x + 1) / 2) * r.width + r.left;
				const py = ((1 - s.y) / 2) * r.height + r.top;
				const d = Math.hypot(px - e.clientX, py - e.clientY);
				if (d < best) {
					best = d;
					point = v;
					snapped = true;
				}
			}
		}
		return { point, tri, normal: triNormal(this.mesh, tri), snapped };
	}

	/** Cast a ray against the model, ignoring hits closer than `minDist`. */
	castRay(origin: Vec3, dir: Vec3, minDist: number): { point: Vec3; tri: number; distance: number } | null {
		if (!this.model) return null;
		this.raycaster.set(v3(origin), v3(dir).normalize());
		this.raycaster.firstHitOnly = false;
		const hits = this.raycaster.intersectObject(this.model, false);
		const hit = hits.find((h) => h.distance > minDist);
		if (!hit || !hit.face) return null;
		return { point: [hit.point.x, hit.point.y, hit.point.z], tri: Math.floor(hit.face.a / 3), distance: hit.distance };
	}

	get modelDiagonal() {
		return this.diag;
	}

	// ---------- overlays ----------

	private dot(p: Vec3, color: number, size = 0.006) {
		const m = new THREE.Mesh(
			new THREE.SphereGeometry(this.diag * size, 16, 12),
			new THREE.MeshBasicMaterial({ color, depthTest: false })
		);
		m.position.copy(v3(p));
		m.renderOrder = 9;
		return m;
	}

	private line(points: Vec3[], color: number, dashed = false) {
		const geo = new THREE.BufferGeometry().setFromPoints(points.map(v3));
		const mat = dashed
			? new THREE.LineDashedMaterial({ color, depthTest: false, dashSize: this.diag * 0.015, gapSize: this.diag * 0.01 })
			: new THREE.LineBasicMaterial({ color, depthTest: false });
		const l = new THREE.Line(geo, mat);
		if (dashed) l.computeLineDistances();
		l.renderOrder = 9;
		return l;
	}

	private makeLabel(text: string, kind: OverlayKind) {
		const div = document.createElement('div');
		div.className = `m-label m-${kind}`;
		div.textContent = text;
		return div;
	}

	private addOverlay(id: string, group: THREE.Group, labelAt: Vec3, text: string, kind: OverlayKind) {
		this.removeOverlay(id);
		const label = this.makeLabel(text, kind);
		const obj = new CSS2DObject(label);
		obj.position.copy(v3(labelAt));
		group.add(obj);
		this.scene.add(group);
		this.overlays.set(id, { group, label });
		this.requestRender();
	}

	drawSegment(id: string, kind: OverlayKind, a: Vec3, b: Vec3, text: string) {
		const color = COLORS[kind];
		const g = new THREE.Group();
		g.add(this.dot(a, color), this.dot(b, color), this.line([a, b], color));
		const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
		this.addOverlay(id, g, mid, text, kind);
	}

	drawCircle(id: string, center: Vec3, axis: Vec3, radius: number, text: string, depth = 0, highlight?: number[]) {
		const color = COLORS.diameter;
		const g = new THREE.Group();
		const [u, v] = basisFor(axis);
		const ring = (offset: number, dashed: boolean) => {
			const pts: Vec3[] = [];
			for (let i = 0; i <= 96; i++) {
				const t = (i / 96) * Math.PI * 2;
				const c = Math.cos(t) * radius, s = Math.sin(t) * radius;
				pts.push([
					center[0] + u[0] * c + v[0] * s + axis[0] * offset,
					center[1] + u[1] * c + v[1] * s + axis[1] * offset,
					center[2] + u[2] * c + v[2] * s + axis[2] * offset
				]);
			}
			return this.line(pts, color, dashed);
		};
		g.add(ring(0, false));
		if (depth > 0) g.add(ring(depth / 2, true), ring(-depth / 2, true));
		// Diameter line across the circle.
		const p1: Vec3 = [center[0] - u[0] * radius, center[1] - u[1] * radius, center[2] - u[2] * radius];
		const p2: Vec3 = [center[0] + u[0] * radius, center[1] + u[1] * radius, center[2] + u[2] * radius];
		g.add(this.line([p1, p2], color), this.dot(center, color, 0.004));
		if (depth > 0) {
			const e = depth / 2 + this.diag * 0.04;
			g.add(this.line([[center[0] - axis[0] * e, center[1] - axis[1] * e, center[2] - axis[2] * e], [center[0] + axis[0] * e, center[1] + axis[1] * e, center[2] + axis[2] * e]], color, true));
		}
		if (highlight && this.model) {
			const src = this.model.geometry.getAttribute('position') as THREE.BufferAttribute;
			const arr = new Float32Array(highlight.length * 9);
			highlight.forEach((t, i) => {
				for (let k = 0; k < 9; k++) arr[i * 9 + k] = (src.array as Float32Array)[t * 9 + k];
			});
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
			const m = new THREE.Mesh(
				geo,
				new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
			);
			m.renderOrder = 2;
			g.add(m);
		}
		this.addOverlay(id, g, p2, text, 'diameter');
	}

	setLabel(id: string, text: string) {
		const o = this.overlays.get(id);
		if (o) o.label.textContent = text;
		this.requestRender();
	}

	setSelected(id: string | null) {
		for (const [k, o] of this.overlays) o.label.classList.toggle('selected', k === id);
	}

	removeOverlay(id: string) {
		const o = this.overlays.get(id);
		if (!o) return;
		this.disposeGroup(o.group);
		this.overlays.delete(id);
		this.requestRender();
	}

	clearOverlays() {
		for (const id of [...this.overlays.keys()]) this.removeOverlay(id);
	}

	setPending(points: Vec3[]) {
		this.disposeGroup(this.pendingGroup, false);
		for (const p of points) this.pendingGroup.add(this.dot(p, COLORS.pending, 0.005));
		if (points.length > 1) this.pendingGroup.add(this.line(points, COLORS.pending, true));
		this.requestRender();
	}

	private disposeGroup(g: THREE.Group, removeFromScene = true) {
		for (const c of [...g.children]) {
			g.remove(c);
			if (c instanceof CSS2DObject) c.element.remove();
			const m = c as THREE.Mesh;
			m.geometry?.dispose();
			(m.material as THREE.Material | undefined)?.dispose?.();
		}
		if (removeFromScene) this.scene.remove(g);
	}

	// ---------- rendering ----------

	private resize() {
		const { clientWidth: w, clientHeight: h } = this.container;
		if (!w || !h) return;
		this.renderer.setSize(w, h);
		this.labels.setSize(w, h);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.requestRender();
	}

	requestRender() {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			const moving = this.controls.update();
			this.renderer.render(this.scene, this.camera);
			this.labels.render(this.scene, this.camera);
			if (moving) this.requestRender();
		});
	}
}

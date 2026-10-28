# STL Measure

Open an STL in your browser, see its size, volume and a print estimate, and measure distances, hole diameters and wall thickness. Files are processed in the browser and are never uploaded.

## Run

The app is a static site: everything happens in the browser, so any static host works.

Live at **https://stl.stup.dev**.

**GitHub Pages**: every push to `main` builds and deploys the site via `.github/workflows/deploy.yml`. One-time repo setup: *Settings → Pages → Source: GitHub Actions*, and *Custom domain: `stl.stup.dev`* (with a DNS `CNAME` record pointing `stl` to `hunterparks.github.io`).

**Docker** (served by nginx):

```sh
docker compose up -d --build
```

Then open http://localhost:3000. To use a different port: `PORT=8080 docker compose up -d --build`.

**Other static hosts**: run `npm run build` and upload the `build/` folder. If the site lives under a subpath, build with `BASE_PATH=/your-path npm run build`.

For development: `npm install && npm run dev`.

## Features

**Analysis (after opening a file)**
- Bounding box size, volume, surface area, triangle and vertex counts
- Center of mass (assumes uniform density), which can be shown on the model
- Print estimate: weight, cost and filament length from material, infill, wall count and line width (settings are remembered)
- A warning if the mesh isn't watertight, since volume and weight are then approximate

**Measuring tools** (keyboard shortcut in brackets)
- **Distance [D]**: click two points. Shows the distance and its X/Y/Z components. Clicks snap to nearby triangle corners (toggle with **S**).
- **Hole / Pin [H]**: click once on the curved wall of a hole or pin. It finds the whole cylindrical surface, fits its axis and diameter, and reports depth, whether it's a hole or a pin, and the fit error. Partial arcs, such as fillets, show a radius.
- **3-Point Circle [C]**: click three points on a circular edge.
- **Thickness [T]**: click a face to measure straight through to the opposite surface. It also reports whether that surface is parallel.

**Units**: *File units* sets how the STL's numbers are read (STL files don't store units; mm is the norm). *Show in* switches every reading between mm, cm and inches.

## Layout

| Path | What |
| --- | --- |
| `src/lib/geometry/mesh.ts` | Vertex welding, adjacency, volume, area, center of mass |
| `src/lib/geometry/features.ts` | Cylinder detection and fitting for holes and pins |
| `src/lib/geometry/math.ts` | Vector math, eigen solver, circle fits |
| `src/lib/viewer/Viewer.ts` | three.js scene, picking (BVH-accelerated), overlays |
| `src/lib/print.ts` | Print weight and cost estimate |
| `src/routes/+page.svelte` | App UI |

Built with SvelteKit 3 (`adapter-static`), Svelte 5 and three.js.

# Starship Flight 15 orbit visualizer

three.js globe showing Ship 42 from the telemetry fix (14 Nov 2026, 00:37 UTC)
to the planned tower catch at 21:20:10 UTC (T+22:32:34).

- `src/orbit.js` – fitted state vector, J2 propagator, deorbit/entry model, Sun direction
- `src/observer.js` – closest approach, passes and naked-eye visibility for a place on the ground
- `src/main.js` – scene, camera modes, HUD and timeline
- `dist/` – ready-to-serve page (`index.html`, bundled `app.js`, Earth textures)

## Run

    npm install
    npm run build
    npm run serve      # then open http://localhost:8080

`dist/` must be served over HTTP; opening `index.html` from disk blocks the textures.

Orbit data: fitted to the stardash.live public feed. Earth textures: NASA Blue Marble / Black Marble (via the three-globe package).

## Deploy to GitHub Pages

In the repository: Settings → Pages → Source: **GitHub Actions**. Every push to `main`
then builds and publishes `dist/` via `.github/workflows/pages.yml`.

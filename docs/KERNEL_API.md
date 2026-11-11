# Kernel API

`public/lib/educad-kernel.js` is the aggregate kernel namespace. Browser code
reads `window.EduCADKernel`; Node reads `require('./public/lib/educad-kernel.js')`.
Deep module imports remain internal.

## Identity

```js
EduCADKernel.apiVersion   // '1.0.0'
EduCADKernel.version      // package.json version
EduCADKernel.contracts    // named data-contract IDs
EduCADKernel.capabilities // surface kinds and operations
```

`public/lib/educad-api.json` is the machine-readable manifest.
`npm run check:api` verifies the manifest against the actual exports and the
package version; CI runs it after the corpus.

## Contracts

| Key | Value |
|---|---|
| `surface` | `analytic-surface-v1` |
| `certificate` | `analytic-surface-certificate-v1` |
| `topology` | `analytic-topology-v1` |
| `bounded` | `bounded-intersection-v1` |
| `planar` | `educad-planar-v1` |
| `planarBoolean` | `planar-boolean-v1` |
| `silhouette` | `analytic-silhouette-v1` |
| `silhouetteHlr` | `silhouette-hlr-v1` |
| `torusSection` | `torus-section-v1` |
| `torusQuadric` | `torus-quadric-v1` |
| `featureGraph` | `feature-graph-v1` |
| `correspondence` | `correspondence-audit-v1` |
| `constraint` | `constraint-report-v1` |
| `viewState` | `view-state-v1` |

## Modules

- `Surfaces` — bounded analytic surfaces, intersections, clipping, topology,
  features, silhouettes, planar Boolean.
- `Predicates` — exact decimal orientation/coplanarity/point-on-plane.
- `Planar` — straight-loop arrangement and region Boolean.
- `Correspondence` — read-only point correspondence audit.
- `Constraints` — exact DOF/conflict report and view state.
- `Ref3d` — preview build/validation.

## Capability boundaries

Supported surface kinds: plane, cylinder, cone, sphere, torus. Torus plane
sections and silhouettes include axis-aligned and oblique orthographic views;
oblique plane sections return analytic `torus-section-v1` branches. Bounded
torus patches support explicit u/v parameter domains, and a closed torus splits
on perpendicular or axis-containing planes. Torus–plane, torus–sphere and
coaxial torus–cylinder/cone intersections return analytic curves. General
oblique torus splits, offset/skew torus–cylinder/cone and torus–torus
intersections, loop-bounded torus patches without a domain, variable-radius
fillets and general solid Booleans are outside this API version.

Kernel modules are deterministic and DOM-free. The app shell owns rendering,
input, saves and passwords.

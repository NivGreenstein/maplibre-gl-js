# The world CRS (tile matrix set)

Upstream MapLibre GL JS speaks Web Mercator everywhere. The "mercator coordinates" that
transforms, tile IDs, terrain and every source work in are [EPSG:3857](https://epsg.io/3857)
normalised to the unit square, and tile requests address the `WebMercatorQuad` tile matrix
set - the familiar `{z}/{x}/{y}` of OpenStreetMap and friends.

**This fork makes the world CRS pluggable and defaults it to the OGC
[`WorldCRS84Quad`](https://docs.ogc.org/is/17-083r4/17-083r4.html) tile matrix set**, so tiles
are requested and drawn natively in [EPSG:4326](https://epsg.io/4326) with no reprojection to
mercator anywhere in the pipeline.

## Choosing a CRS

```ts
import maplibregl from 'maplibre-gl';

// The default. Requests EPSG:4326 / WorldCRS84Quad tiles.
maplibregl.setWorldCRS('WorldCRS84Quad');

// Upstream MapLibre's behaviour.
maplibregl.setWorldCRS('WebMercatorQuad');
```

This is a **global, process-wide setting**, not a per-map option, and not the style's
`projection` property. The CRS is baked into tile coordinates, which are shared between maps
and copied into the web workers when a `Style` is created. Set it once, before creating any
`Map`, and do not change it while a map is alive.

`getWorldCRS()` returns the active `WorldCRS` descriptor if you need to reason about it.

## How `WorldCRS84Quad` fits into MapLibre's world

MapLibre's world coordinates are the unit square: `x` runs `[0, 1]` across 360° of longitude,
`y` grows southwards, and the same unit is used on both axes so that rendering stays
isotropic. `WorldCRS84Quad` maps longitude *and* latitude linearly (plate carrée), so its
world is twice as wide as it is tall. It therefore occupies

```
x in [0, 1]     -180° .. 180°
y in [0, 0.5]      90° .. -90°
```

and the bottom half of the unit square is simply empty. The quad-tree tile grid is unchanged -
a tile at internal zoom `z` is still `2^-z` on a side - but only the northern `2^(z-1)` rows
hold tiles.

### Tile matrix levels are one below the internal tile zoom

`WorldCRS84Quad` level `L` spans the full 360° in `2^(L+1)` columns, so it lines up with the
internal grid one level down:

| internal tile zoom | columns | rows | CRS84 tile matrix level |
| ------------------ | ------- | ---- | ----------------------- |
| 1                  | 2       | 1    | 0                       |
| 2                  | 4       | 2    | 1                       |
| 3                  | 8       | 4    | 2                       |
| `z`                | `2^z`   | `2^(z-1)` | `z - 1`            |

`CanonicalTileID.url()` does that conversion, so `{z}` in a tile URL template is always the
tile matrix level the server publishes. In the other direction, a source's `minzoom` and
`maxzoom` - in the style and in TileJSON - name tile matrix levels too, and are converted to
internal tile zooms when the source loads. Internal tile zoom 0 has no matching level, so
tiles are never requested there.

Because a `WorldCRS84Quad` tile is 256 px, a raster source should declare `tileSize: 256`, as
it would for any 256 px scheme; MapLibre then requests one internal zoom deeper, which is
exactly the level whose tiles are pixel-for-pixel with the screen.

### Scale and distortion

Plate carrée is true to scale along the meridians and the equator and stretches east-west by
`1 / cos(latitude)` towards the poles. Altitudes - extrusion heights, terrain, symbol
elevation - are therefore converted with the constant meridian scale rather than mercator's
latitude-dependent one, and `mercatorScale()` reports `1` everywhere.

The world reaches the poles, so the transform's default latitude range is ±90° rather than
mercator's ±85.051129°. One consequence is that a viewport taller than half its width cannot
show the whole world at zoom 0; the transform zooms in to keep the view inside the world,
which is the same rule that already applied to mercator.

## URL tokens

`{z}`, `{x}`, `{y}`, `{ratio}` and `{prefix}` behave as before, with `{z}` carrying the tile
matrix level and the `tms` scheme flipping `{y}` over the CRS's row count. In addition:

- `{bbox-epsg-4326}` - the tile's bounds in degrees as `minLng,minLat,maxLng,maxLat`
  (longitude/latitude, i.e. CRS:84 axis order), for WMS servers.
- `{bbox-epsg-3857}` - unchanged in meaning: the tile's bounds in mercator metres. Under
  `WorldCRS84Quad` the tile is projected into mercator and clamped to the mercator latitude
  limit, since a CRS84 tile can reach the poles.
- `{quadkey}` is a Bing scheme and only meaningful under `WebMercatorQuad`.

## GeoJSON sources

`geojson-vt` and `supercluster` project with a hardcoded spherical mercator. Rather than fork
them, `src/source/geojson_lat_warp.ts` pre-warps every latitude to the one whose *mercator* Y
equals its Y in the active CRS. The tiler's own projection then reproduces the active CRS'
world exactly and its tile coordinates line up with MapLibre's. The warp is reversed on
features handed back out, such as `getClusterChildren` and `getClusterLeaves`.

## What is not supported

The `globe` and `vertical-perspective` projections wrap a *square* mercator tile pyramid
around a sphere - their subdivision, pole geometry and tile culling all assume
`WebMercatorQuad`. Selecting them under another CRS logs a warning; call
`setWorldCRS('WebMercatorQuad')` if you need them.

## Testing

The test suites inherited from upstream assert Web Mercator numbers throughout - tile
coordinates, projected positions, screen geometry, reference images. They are pinned to
`WebMercatorQuad`, which keeps them meaningful (that CRS is still supported) and is what
proves the CRS abstraction left the mercator path alone:

- unit tests: `test/unit/lib/world_crs_default.ts`, a setup file
- render tests: `render.test.ts`, overridable per fixture with `metadata.test.worldCRS`
- query and browser tests: their own harnesses

`WorldCRS84Quad` behaviour has its own coverage: `src/geo/world_crs.test.ts`,
`src/tile/tile_id_crs84.test.ts`, `src/geo/projection/covering_tiles_crs84.test.ts`,
`src/source/tile_source_crs84.test.ts`, `src/source/geojson_lat_warp.test.ts`,
`src/ui/map_tests/map_world_crs.test.ts`, and the render fixtures under
`test/integration/render/tests/world-crs/`.

import {setWorldCRS} from '../../src/geo/world_crs.ts';

/**
 * The micro benchmarks build mercator tile pyramids and camera setups by hand, so they run
 * on `WebMercatorQuad` rather than this fork's `WorldCRS84Quad` default - which also keeps a
 * before/after comparison measuring the same workload. See `test/unit/lib/world_crs_default.ts`.
 */
setWorldCRS('WebMercatorQuad');

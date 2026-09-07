import {beforeEach} from 'vitest';

import {setWorldCRS} from '../../../src/geo/world_crs.ts';

/**
 * This fork ships `WorldCRS84Quad` as the default world CRS, but the test suite inherited
 * from upstream MapLibre asserts Web Mercator tile coordinates, projected positions and
 * screen geometry throughout. Those tests still earn their keep: `WebMercatorQuad` remains
 * a supported mode, and keeping them green is what proves the CRS abstraction did not
 * change the mercator path.
 *
 * So the suite runs on `WebMercatorQuad` unless a test opts in to another CRS. Tests for
 * `WorldCRS84Quad` behaviour call `setWorldCRS('WorldCRS84Quad')` in their own `beforeEach`,
 * which runs after this one; this hook then resets the global back for the next test.
 */
// Applied at import time as well as per test, because setup files run before the test
// module is imported and several suites build tile IDs at module scope.
setWorldCRS('WebMercatorQuad');

beforeEach(() => {
    setWorldCRS('WebMercatorQuad');
});

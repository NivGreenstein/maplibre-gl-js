import {earthRadius} from './lng_lat.ts';
import {MAX_VALID_LATITUDE} from '../util/util.ts';

/**
 * The average circumference of the world in meters.
 */
export const earthCircumference: number = 2 * Math.PI * earthRadius; // meters

/**
 * The circumference at a line of latitude in meters.
 */
function circumferenceAtLatitude(latitude: number): number {
    return earthCircumference * Math.cos(latitude * Math.PI / 180);
}

/**
 * The greatest latitude that can be represented by the Web Mercator projection,
 * i.e. the latitude whose projected Y coordinate is exactly one world width away
 * from the equator.
 */
export const MAX_MERCATOR_LATITUDE: number = MAX_VALID_LATITUDE;

/**
 * The name of a tile matrix set (a "world CRS"): the projection MapLibre works in
 * internally *and* the tiling scheme it requests tiles for.
 *
 * - `WebMercatorQuad` - [EPSG:3857](https://epsg.io/3857), the tiling scheme used by
 *   OpenStreetMap, Google, Mapbox and upstream MapLibre. Square world, `2^z` by `2^z`
 *   tiles at tile matrix level `z`.
 * - `WorldCRS84Quad` - [EPSG:4326](https://epsg.io/4326) plate carrée, the OGC
 *   `WorldCRS84Quad` tile matrix set. `2^(L+1)` by `2^L` tiles at tile matrix level `L`.
 */
export type WorldCRSName = 'WebMercatorQuad' | 'WorldCRS84Quad';

/**
 * Describes the projection MapLibre uses for its internal "world coordinates" and the
 * tiling scheme that goes with it.
 *
 * World coordinates are normalized so that `x` spans `[0, 1]` over the full 360° of
 * longitude, with `x = 0` at the antimeridian. `y` grows southwards from `0` at the
 * northern edge of the world down to {@link WorldCRS.worldSouthEdge}. The unit of `y`
 * is the same as the unit of `x`, which is what keeps rendering isotropic; for
 * projections that do not cover a square world (such as `WorldCRS84Quad`, which is
 * twice as wide as it is tall) the remaining part of the unit square is simply empty.
 */
export interface WorldCRS {
    /**
     * The tile matrix set name, e.g. `'WorldCRS84Quad'`.
     */
    readonly name: WorldCRSName;
    /**
     * The EPSG code of the CRS tiles are served in, e.g. `'EPSG:4326'`.
     */
    readonly epsg: string;
    /**
     * The greatest latitude (in degrees) this projection can represent.
     */
    readonly maxLatitude: number;
    /**
     * World `y` coordinate of the southern edge of the world. `1` for a square world
     * such as `WebMercatorQuad`, `0.5` for the 2:1 world of `WorldCRS84Quad`.
     */
    readonly worldSouthEdge: number;
    /**
     * The lowest internal tile zoom that maps onto a real tile matrix level.
     */
    readonly minTileZoom: number;
    /**
     * Added to an internal tile zoom to get the tile matrix level that is requested
     * over the network. `0` for `WebMercatorQuad`; `-1` for `WorldCRS84Quad`, whose
     * level `L` has `2^(L+1)` columns and therefore matches internal tile zoom `L + 1`.
     */
    readonly tileMatrixZoomOffset: number;
    /**
     * Projects a longitude to a world `x` coordinate in the range `[0, 1]`.
     */
    xFromLng(lng: number): number;
    /**
     * Unprojects a world `x` coordinate back to a longitude.
     */
    lngFromX(x: number): number;
    /**
     * Projects a latitude to a world `y` coordinate in the range `[0, worldSouthEdge]`.
     */
    yFromLat(lat: number): number;
    /**
     * Unprojects a world `y` coordinate back to a latitude.
     */
    latFromY(y: number): number;
    /**
     * Converts an altitude in meters to a world `z` coordinate.
     */
    zFromAltitude(altitude: number, lat: number): number;
    /**
     * Converts a world `z` coordinate back to an altitude in meters.
     */
    altitudeFromZ(z: number, y: number): number;
    /**
     * The factor by which the projection stretches ground distances at the given
     * latitude, relative to its true-scale line. `1` means no distortion.
     */
    scaleFactor(lat: number): number;
}

/**
 * The `WebMercatorQuad` tile matrix set - EPSG:3857, `{z}/{x}/{y}` as served by
 * OpenStreetMap and friends. This is upstream MapLibre's one and only projection.
 */
export const WebMercatorQuad: WorldCRS = {
    name: 'WebMercatorQuad',
    epsg: 'EPSG:3857',
    maxLatitude: MAX_MERCATOR_LATITUDE,
    worldSouthEdge: 1,
    minTileZoom: 0,
    tileMatrixZoomOffset: 0,
    xFromLng(lng: number): number {
        return (180 + lng) / 360;
    },
    lngFromX(x: number): number {
        return x * 360 - 180;
    },
    yFromLat(lat: number): number {
        return (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360;
    },
    latFromY(y: number): number {
        const y2 = 180 - y * 360;
        return 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90;
    },
    zFromAltitude(altitude: number, lat: number): number {
        return altitude / circumferenceAtLatitude(lat);
    },
    altitudeFromZ(z: number, y: number): number {
        return z * circumferenceAtLatitude(WebMercatorQuad.latFromY(y));
    },
    scaleFactor(lat: number): number {
        // https://en.wikipedia.org/wiki/Mercator_projection#Scale_factor
        return 1 / Math.cos(lat * Math.PI / 180);
    }
};

/**
 * The OGC `WorldCRS84Quad` tile matrix set - EPSG:4326 (WGS 84 geographic /
 * plate carrée), `{z}/{x}/{y}` where tile matrix level `L` holds `2^(L+1)` columns
 * and `2^L` rows of 256 px tiles, level 0 being the two 180°×180° hemisphere tiles.
 *
 * Longitude and latitude both map linearly to world coordinates, so the projected
 * world is twice as wide as it is tall. MapLibre's world coordinates are the unit
 * square, so the world occupies `y` in `[0, 0.5]` and the internal quad-tree tile
 * grid is one level finer than the CRS84 tile matrix - internal tile zoom `z`
 * corresponds to tile matrix level `z - 1`, which is exactly the level whose
 * `2^z` columns span the same 360°.
 *
 * True scale is along the meridians and the equator, so altitudes (extrusion
 * heights, terrain, symbol elevation) are converted with the constant meridian
 * scale rather than a latitude-dependent one.
 */
export const WorldCRS84Quad: WorldCRS = {
    name: 'WorldCRS84Quad',
    epsg: 'EPSG:4326',
    maxLatitude: 90,
    worldSouthEdge: 0.5,
    minTileZoom: 1,
    tileMatrixZoomOffset: -1,
    xFromLng(lng: number): number {
        return (180 + lng) / 360;
    },
    lngFromX(x: number): number {
        return x * 360 - 180;
    },
    yFromLat(lat: number): number {
        return (90 - lat) / 360;
    },
    latFromY(y: number): number {
        // Unlike mercator's asymptotic inverse, this one is linear and would run past the
        // poles for world coordinates outside the world - which do occur, e.g. when
        // unprojecting a screen point below the south edge of the map.
        return Math.min(90, Math.max(-90, 90 - y * 360));
    },
    zFromAltitude(altitude: number, _lat: number): number {
        return altitude / earthCircumference;
    },
    altitudeFromZ(z: number, _y: number): number {
        return z * earthCircumference;
    },
    scaleFactor(_lat: number): number {
        return 1;
    }
};

const worldCRSByName: Record<WorldCRSName, WorldCRS> = {
    WebMercatorQuad,
    WorldCRS84Quad
};

let currentWorldCRS: WorldCRS = WorldCRS84Quad;

/**
 * Returns the world CRS / tile matrix set MapLibre currently projects and requests tiles in.
 */
export function getWorldCRS(): WorldCRS {
    return currentWorldCRS;
}

/**
 * Sets the world CRS / tile matrix set MapLibre projects and requests tiles in.
 * Defaults to `'WorldCRS84Quad'`.
 *
 * This is a global, process-wide setting rather than a per-map one: the projection is
 * baked into tile coordinates, which are shared between maps and web workers. Set it
 * once, before creating any {@link Map}, and do not change it while a map is alive -
 * the value is copied to the workers when a {@link Style} is created.
 *
 * @param name - The name of the tile matrix set.
 * @example
 * ```ts
 * // opt back into upstream MapLibre's Web Mercator behaviour
 * maplibregl.setWorldCRS('WebMercatorQuad');
 * ```
 */
export function setWorldCRS(name: WorldCRSName): void {
    const resolved = worldCRSByName[name];
    if (!resolved) {
        throw new Error(`Unknown world CRS: ${name}`);
    }
    currentWorldCRS = resolved;
}

/**
 * Converts an internal tile zoom to the tile matrix level of the active CRS, i.e. the
 * `{z}` that goes into a tile request.
 */
export function tileMatrixLevelFromZoom(z: number): number {
    return z + currentWorldCRS.tileMatrixZoomOffset;
}

/**
 * Converts a tile matrix level of the active CRS - the `{z}` of a tile request, and the
 * unit `minzoom`/`maxzoom` are expressed in - to the internal tile zoom MapLibre uses.
 */
export function zoomFromTileMatrixLevel(level: number): number {
    return level - currentWorldCRS.tileMatrixZoomOffset;
}

/**
 * The number of tile rows in the world at the given internal tile zoom. Equal to the
 * column count `2^z` for a square world, half that for `WorldCRS84Quad`.
 */
export function tileRowsAtZoom(z: number): number {
    return Math.max(1, Math.round(Math.pow(2, z) * currentWorldCRS.worldSouthEdge));
}

import {LngLat} from '../geo/lng_lat.ts';
import {earthCircumference, getWorldCRS} from './world_crs.ts';
import type {LngLatLike} from '../geo/lng_lat.ts';
import {type IMercatorCoordinate} from '@maplibre/maplibre-gl-style-spec';

export {earthCircumference};

/**
 * Projects a longitude to a world `x` coordinate in the active world CRS, in the range [0, 1].
 */
export function mercatorXfromLng(lng: number): number {
    return getWorldCRS().xFromLng(lng);
}

/**
 * Projects a latitude to a world `y` coordinate in the active world CRS. The range is
 * [0, 1] for a square world and [0, 0.5] for `WorldCRS84Quad`.
 */
export function mercatorYfromLat(lat: number): number {
    return getWorldCRS().yFromLat(lat);
}

/**
 * Converts an altitude in meters to a world `z` coordinate in the active world CRS.
 */
export function mercatorZfromAltitude(altitude: number, lat: number): number {
    return getWorldCRS().zFromAltitude(altitude, lat);
}

/**
 * Unprojects a world `x` coordinate of the active world CRS back to a longitude.
 */
export function lngFromMercatorX(x: number): number {
    return getWorldCRS().lngFromX(x);
}

/**
 * Unprojects a world `y` coordinate of the active world CRS back to a latitude.
 */
export function latFromMercatorY(y: number): number {
    return getWorldCRS().latFromY(y);
}

/**
 * Converts a world `z` coordinate of the active world CRS back to an altitude in meters.
 */
export function altitudeFromMercatorZ(z: number, y: number): number {
    return getWorldCRS().altitudeFromZ(z, y);
}

/**
 * Determine the scale factor the active world CRS applies to ground distances at a given
 * latitude, relative to its true-scale line. For Web Mercator this is
 * [the familiar `1 / cos(lat)`](https://en.wikipedia.org/wiki/Mercator_projection#Scale_factor);
 * for the equirectangular `WorldCRS84Quad` it is 1 everywhere, since the meridians are true to scale.
 *
 * @param lat - Latitude
 * @returns scale factor
 */
export function mercatorScale(lat: number): number {
    return getWorldCRS().scaleFactor(lat);
}

/**
 * A `MercatorCoordinate` object represents a projected three dimensional position.
 *
 * `MercatorCoordinate` uses whichever world CRS is active - see {@link setWorldCRS} - with
 * slightly different units:
 *
 * - the size of 1 unit is the width of the projected world instead of the CRS's own unit
 * - the origin of the coordinate space is at the north-west corner instead of the middle
 *
 * By default the active CRS is `WorldCRS84Quad` ([EPSG:4326](https://epsg.io/4326)), where
 * `MercatorCoordinate(0, 0, 0)` is the north-west corner of the world (180°W, 90°N) and
 * `MercatorCoordinate(1, 0.5, 0)` is its south-east corner (180°E, 90°S) - the world is
 * twice as wide as it is tall, so `y` only reaches `0.5`. Under `WebMercatorQuad`
 * ([EPSG:3857](https://epsg.io/3857)) the world is the full unit square instead, and
 * `MercatorCoordinate(1, 1, 0)` is its south-east corner.
 *
 * The `z` dimension of `MercatorCoordinate` is an altitude scaled by the CRS's true-scale
 * line: the equator for `WebMercatorQuad`, the meridians for `WorldCRS84Quad`.
 *
 * @group Geography and Geometry
 *
 * @example
 * ```ts
 * let nullIsland = new MercatorCoordinate(0.5, 0.5, 0);
 * ```
 * @see [Add a custom style layer](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-custom-style-layer/)
 * @see [Add a 3D model using three.js](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-using-threejs/)
 * @see [Add a simple custom layer on a globe](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-simple-custom-layer-on-a-globe/)
 */
export class MercatorCoordinate implements IMercatorCoordinate {
    x: number;
    y: number;
    z: number;

    /**
     * @param x - The x component of the position.
     * @param y - The y component of the position.
     * @param z - The z component of the position.
     */
    constructor(x: number, y: number, z: number = 0) {
        this.x = +x;
        this.y = +y;
        this.z = +z;
    }

    /**
     * Project a `LngLat` to a `MercatorCoordinate`.
     *
     * @param lngLatLike - The location to project.
     * @param altitude - The altitude in meters of the position.
     * @returns The projected mercator coordinate.
     * @example
     * ```ts
     * let coord = MercatorCoordinate.fromLngLat({ lng: 0, lat: 0}, 0);
     * coord; // MercatorCoordinate(0.5, 0.25, 0) under the default WorldCRS84Quad
     * ```
     */
    static fromLngLat(lngLatLike: LngLatLike, altitude: number = 0): MercatorCoordinate {
        const lngLat = LngLat.convert(lngLatLike);

        return new MercatorCoordinate(
            mercatorXfromLng(lngLat.lng),
            mercatorYfromLat(lngLat.lat),
            mercatorZfromAltitude(altitude, lngLat.lat));
    }

    /**
     * Returns the `LngLat` for the coordinate.
     *
     * @returns The `LngLat` object.
     * @example
     * ```ts
     * let coord = new MercatorCoordinate(0.5, 0.25, 0);
     * let lngLat = coord.toLngLat(); // LngLat(0, 0) under the default WorldCRS84Quad
     * ```
     */
    toLngLat(): LngLat {
        return new LngLat(
            lngFromMercatorX(this.x),
            latFromMercatorY(this.y));
    }

    /**
     * Returns the altitude in meters of the coordinate.
     *
     * @returns The altitude in meters.
     * @example
     * ```ts
     * let coord = new MercatorCoordinate(0, 0, 0.02);
     * coord.toAltitude(); // 800604.577681437 under the default WorldCRS84Quad
     * ```
     */
    toAltitude(): number {
        return altitudeFromMercatorZ(this.z, this.y);
    }

    /**
     * Returns the distance of 1 meter in `MercatorCoordinate` units at this latitude.
     *
     * For coordinates in real world units using meters, this naturally provides the scale
     * to transform into `MercatorCoordinate`s.
     *
     * @returns Distance of 1 meter in `MercatorCoordinate` units.
     */
    meterInMercatorCoordinateUnits(): number {
        // 1 meter / circumference at the equator in meters * the projection's scale factor at this latitude
        return 1 / earthCircumference * mercatorScale(latFromMercatorY(this.y));
    }
}

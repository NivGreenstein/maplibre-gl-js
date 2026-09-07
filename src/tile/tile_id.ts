import {EXTENT} from '../data/extent.ts';
import Point from '@mapbox/point-geometry';
import {latFromMercatorY, lngFromMercatorX, MercatorCoordinate} from '../geo/mercator_coordinate.ts';
import {getWorldCRS, MAX_MERCATOR_LATITUDE, tileMatrixLevelFromZoom, tileRowsAtZoom, WebMercatorQuad} from '../geo/world_crs.ts';
import {register} from '../util/web_worker_transfer.ts';
import {clamp, degreesToRadians, type Mat4f32, MAX_TILE_ZOOM, MIN_TILE_ZOOM} from '../util/util.ts';
import {type ICanonicalTileID, type IMercatorCoordinate} from '@maplibre/maplibre-gl-style-spec';
import {isInBoundsForTileZoomXY} from '../util/world_bounds.ts';

/**
 * A canonical way to define a tile ID
 */
export class CanonicalTileID implements ICanonicalTileID {
    z: number;
    x: number;
    y: number;
    key: string;

    constructor(z: number, x: number, y: number) {

        if (!isInBoundsForTileZoomXY(z, x, y)) {
            throw new Error(`x=${x}, y=${y}, z=${z} outside of bounds. 0<=x<${Math.pow(2, z)}, 0<=y<${tileRowsAtZoom(z)} ${MIN_TILE_ZOOM}<=z<=${MAX_TILE_ZOOM} `);
        }

        this.z = z;
        this.x = x;
        this.y = y;
        this.key = calculateTileKey(0, z, z, x, y);
    }

    equals(id: ICanonicalTileID): boolean {
        return this.z === id.z && this.x === id.x && this.y === id.y;
    }

    /**
     * given a list of urls, choose a url template and return a tile URL
     *
     * `{z}` is the tile matrix level of the active world CRS, which is not necessarily this
     * tile's internal zoom: under `WorldCRS84Quad` internal zoom `z` addresses tile matrix
     * level `z - 1`, the level whose `2^z` columns span the same 360°.
     */
    url(urls: string[], pixelRatio: number, scheme?: string | null): string {
        const level = tileMatrixLevelFromZoom(this.z);
        const quadkey = getQuadkey(this.z, this.x, this.y);
        const bounds = tileWorldBounds(this.x, this.y, this.z);

        return urls[(this.x + this.y) % urls.length]
            .replace(/{prefix}/g, (this.x % 16).toString(16) + (this.y % 16).toString(16))
            .replace(/{z}/g, String(level))
            .replace(/{x}/g, String(this.x))
            .replace(/{y}/g, String(scheme === 'tms' ? (tileRowsAtZoom(this.z) - this.y - 1) : this.y))
            .replace(/{ratio}/g, pixelRatio > 1 ? '@2x' : '')
            .replace(/{quadkey}/g, quadkey)
            .replace(/{bbox-epsg-3857}/g, getTileBBox3857(bounds))
            .replace(/{bbox-epsg-4326}/g, getTileBBox4326(bounds));
    }

    isChildOf(parent: ICanonicalTileID): boolean {
        const dz = this.z - parent.z;
        return  dz > 0 && parent.x === (this.x >> dz) && parent.y === (this.y >> dz);
    }

    getTilePoint(coord: IMercatorCoordinate): Point {
        const tilesAtZoom = Math.pow(2, this.z);
        return new Point(
            (coord.x * tilesAtZoom - this.x) * EXTENT,
            (coord.y * tilesAtZoom - this.y) * EXTENT);
    }

    toString(): string {
        return `${this.z}/${this.x}/${this.y}`;
    }
}

/**
 * @internal
 * An unwrapped tile identifier
 */
export class UnwrappedTileID {
    wrap: number;
    canonical: CanonicalTileID;
    key: string;

    constructor(wrap: number, canonical: CanonicalTileID) {
        this.wrap = wrap;
        this.canonical = canonical;
        this.key = calculateTileKey(wrap, canonical.z, canonical.z, canonical.x, canonical.y);
    }
}

/**
 * An overscaled tile identifier
 */
export class OverscaledTileID {
    overscaledZ: number;
    wrap: number;
    canonical: CanonicalTileID;
    key: string;
    /**
     * This matrix is used during terrain's render-to-texture stage only.
     * If the render-to-texture stage is active, this matrix will be present
     * and should be used, otherwise this matrix will be null.
     * The matrix should be float32 in order to avoid slow WebGL calls in Chrome.
     */
    terrainRttPosMatrix32f: Mat4f32 | null = null;

    constructor(overscaledZ: number, wrap: number, z: number, x: number, y: number) {
        if (overscaledZ < z) throw new Error(`overscaledZ should be >= z; overscaledZ = ${overscaledZ}; z = ${z}`);
        this.overscaledZ = overscaledZ;
        this.wrap = wrap;
        this.canonical = new CanonicalTileID(z, +x, +y);
        this.key = calculateTileKey(wrap, overscaledZ, z, x, y);
    }

    clone(): OverscaledTileID {
        return new OverscaledTileID(this.overscaledZ, this.wrap, this.canonical.z, this.canonical.x, this.canonical.y);
    }

    equals(id: OverscaledTileID): boolean {
        return this.overscaledZ === id.overscaledZ && this.wrap === id.wrap && this.canonical.equals(id.canonical);
    }

    /**
     * Returns a new `OverscaledTileID` representing the tile at the target zoom level.
     * When targetZ is greater than the current canonical z, the canonical coordinates are unchanged.
     * When targetZ is less than the current canonical z, the canonical coordinates are updated.
     * @param targetZ - the zoom level to scale to. Must be less than or equal to this.overscaledZ
     * @returns a new OverscaledTileID representing the tile at the target zoom level
     * @throws if targetZ is greater than this.overscaledZ
     */
    scaledTo(targetZ: number): OverscaledTileID {
        if (targetZ > this.overscaledZ) throw new Error(`targetZ > this.overscaledZ; targetZ = ${targetZ}; overscaledZ = ${this.overscaledZ}`);
        const zDifference = this.canonical.z - targetZ;
        if (targetZ > this.canonical.z) {
            return new OverscaledTileID(targetZ, this.wrap, this.canonical.z, this.canonical.x, this.canonical.y);
        } else {
            return new OverscaledTileID(targetZ, this.wrap, targetZ, this.canonical.x >> zDifference, this.canonical.y >> zDifference);
        }
    }

    isOverscaled(): boolean {
        return (this.overscaledZ > this.canonical.z);
    }

    /*
     * calculateScaledKey is an optimization:
     * when withWrap == true, implements the same as this.scaledTo(z).key,
     * when withWrap == false, implements the same as this.scaledTo(z).wrapped().key.
     */
    calculateScaledKey(targetZ: number, withWrap: boolean): string {
        if (targetZ > this.overscaledZ) throw new Error(`targetZ > this.overscaledZ; targetZ = ${targetZ}; overscaledZ = ${this.overscaledZ}`);
        const zDifference = this.canonical.z - targetZ;
        if (targetZ > this.canonical.z) {
            return calculateTileKey(this.wrap * +withWrap, targetZ, this.canonical.z, this.canonical.x, this.canonical.y);
        } else {
            return calculateTileKey(this.wrap * +withWrap, targetZ, targetZ, this.canonical.x >> zDifference, this.canonical.y >> zDifference);
        }
    }

    isChildOf(parent: OverscaledTileID): boolean {
        if (parent.wrap !== this.wrap) return false; // different world copy

        const zDifference = this.overscaledZ - parent.overscaledZ;
        if (zDifference <= 0) return false; // must be deeper zoom

        //special case for root tile (bitwise math doesn't work for root)
        if (parent.overscaledZ === 0) return this.overscaledZ > 0;

        const dz = this.canonical.z - parent.canonical.z;
        if (dz < 0) return false; // parent can't be deeper canonically

        return (
            parent.canonical.x === (this.canonical.x >> dz) &&
            parent.canonical.y === (this.canonical.y >> dz)
        );
    }

    children(sourceMaxZoom: number): OverscaledTileID[] {
        if (this.overscaledZ >= sourceMaxZoom) {
            // return a single tile coord representing a an overscaled tile
            return [new OverscaledTileID(this.overscaledZ + 1, this.wrap, this.canonical.z, this.canonical.x, this.canonical.y)];
        }

        const z = this.canonical.z + 1;
        const x = this.canonical.x * 2;
        const y = this.canonical.y * 2;
        return [
            new OverscaledTileID(z, this.wrap, z, x, y),
            new OverscaledTileID(z, this.wrap, z, x + 1, y),
            new OverscaledTileID(z, this.wrap, z, x, y + 1),
            new OverscaledTileID(z, this.wrap, z, x + 1, y + 1)
        ];
    }

    isLessThan(rhs: OverscaledTileID): boolean {
        if (this.wrap < rhs.wrap) return true;
        if (this.wrap > rhs.wrap) return false;

        if (this.overscaledZ < rhs.overscaledZ) return true;
        if (this.overscaledZ > rhs.overscaledZ) return false;

        if (this.canonical.x < rhs.canonical.x) return true;
        if (this.canonical.x > rhs.canonical.x) return false;

        return this.canonical.y < rhs.canonical.y;

    }

    wrapped(): OverscaledTileID {
        return new OverscaledTileID(this.overscaledZ, 0, this.canonical.z, this.canonical.x, this.canonical.y);
    }

    unwrapTo(wrap: number): OverscaledTileID {
        return new OverscaledTileID(this.overscaledZ, wrap, this.canonical.z, this.canonical.x, this.canonical.y);
    }

    overscaleFactor(): number {
        return Math.pow(2, this.overscaledZ - this.canonical.z);
    }

    toUnwrapped(): UnwrappedTileID {
        return new UnwrappedTileID(this.wrap, this.canonical);
    }

    toString(): string {
        return `${this.overscaledZ}/${this.canonical.x}/${this.canonical.y}`;
    }

    getTilePoint(coord: MercatorCoordinate): Point {
        return this.canonical.getTilePoint(new MercatorCoordinate(coord.x - this.wrap, coord.y));
    }

    /**
     * Maps tile-local coordinates that may fall outside the `[0, extent)` range
     * to the correct neighbor tile and the corresponding in-tile position.
     *
     * Coordinates can exceed tile bounds when geometry (e.g. symbol labels along
     * lines) extends across tile edges. This method resolves such coordinates to
     * the appropriate adjacent tile, wrapping horizontally across world boundaries
     * and returning `null` when the target falls beyond the polar tile-grid limits.
     *
     * When the coordinates are already in bounds, the original tile ID is returned.
     *
     * @param x - x coordinate relative to this tile, may be outside `[0, extent)`
     * @param y - y coordinate relative to this tile, may be outside `[0, extent)`
     * @param extent - tile coordinate extent, default {@link EXTENT}
     * @returns the resolved tile ID and in-tile coordinates, or `null` if the
     *          target is beyond the tile grid (e.g. past the poles)
     */
    normalizeCoordinates(x: number, y: number, extent: number = EXTENT): {tileID: OverscaledTileID; x: number; y: number} | null {
        if (x >= 0 && x < extent && y >= 0 && y < extent) {
            return {tileID: this, x, y};
        }

        const tileOffsetX = Math.floor(x / extent);
        const tileOffsetY = Math.floor(y / extent);
        const newX = x - tileOffsetX * extent;
        const newY = y - tileOffsetY * extent;

        const z = this.canonical.z;
        const dim = 1 << z;
        const newCanonicalY = this.canonical.y + tileOffsetY;

        if (newCanonicalY < 0 || newCanonicalY >= tileRowsAtZoom(z)) return null;

        let newCanonicalX = this.canonical.x + tileOffsetX;
        let newWrap = this.wrap;
        if (newCanonicalX < 0) {
            newWrap -= Math.ceil(-newCanonicalX / dim);
            newCanonicalX = ((newCanonicalX % dim) + dim) % dim;
        } else if (newCanonicalX >= dim) {
            newWrap += Math.floor(newCanonicalX / dim);
            newCanonicalX = newCanonicalX % dim;
        }

        return {
            tileID: new OverscaledTileID(this.overscaledZ, newWrap, z, newCanonicalX, newCanonicalY),
            x: newX,
            y: newY,
        };
    }
}

export function calculateTileKey(wrap: number, overscaledZ: number, z: number, x: number, y: number): string {
    wrap *= 2;
    if (wrap < 0) wrap = wrap * -1 - 1;
    const dim = 1 << z;
    return (dim * dim * wrap + dim * y + x).toString(36) + z.toString(36) + overscaledZ.toString(36);
}

/** WGS84 spherical radius used by EPSG:3857, distinct from the mean earth radius MercatorCoordinate is built on. */
const EPSG3857_RADIUS = 6378137;
const EPSG3857_HALF_CIRCUMFERENCE = Math.PI * EPSG3857_RADIUS;

/** A tile's extent in world coordinates of the active CRS: `[0, 1]` across, `y` growing southwards. */
type TileWorldBounds = {west: number; south: number; east: number; north: number};

/**
 * The extent of a tile in world coordinates of the active CRS.
 */
function tileWorldBounds(x: number, y: number, z: number): TileWorldBounds {
    const scale = Math.pow(2, z);
    return {
        west: x / scale,
        south: (y + 1) / scale,
        east: (x + 1) / scale,
        north: y / scale
    };
}

/**
 * Builds the `{bbox-epsg-4326}` token used in WMS tile URLs: the tile's bounding box in
 * EPSG:4326 degrees as a `minLng,minLat,maxLng,maxLat` string, i.e. in longitude/latitude
 * (CRS:84) axis order, to match `{bbox-epsg-3857}`.
 */
function getTileBBox4326(bounds: TileWorldBounds): string {
    return `${lngFromMercatorX(bounds.west)},${latFromMercatorY(bounds.south)},${lngFromMercatorX(bounds.east)},${latFromMercatorY(bounds.north)}`;
}

/**
 * Builds the `{bbox-epsg-3857}` token used in WMS tile URLs: the tile's bounding
 * box in EPSG:3857 meters as a `minX,minY,maxX,maxY` string.
 *
 * Under `WebMercatorQuad` the tile grid is EPSG:3857's own, so the conversion is the exact
 * linear one inlined from the archived \@mapbox/whoots-js (ISC, Copyright (c) 2017 Mapbox).
 * Under any other CRS the tile's latitudes are projected into mercator, clamped to the
 * mercator limit since a `WorldCRS84Quad` tile can reach the poles.
 */
function getTileBBox3857(bounds: TileWorldBounds): string {
    return [
        epsg3857X(bounds.west),
        epsg3857Y(bounds.south),
        epsg3857X(bounds.east),
        epsg3857Y(bounds.north)
    ].join(',');
}

/** Projects a world X coordinate of the active CRS to EPSG:3857 meters. */
function epsg3857X(worldX: number): number {
    return EPSG3857_RADIUS * degreesToRadians(lngFromMercatorX(worldX));
}

/** Projects a world Y coordinate of the active CRS to EPSG:3857 meters. */
function epsg3857Y(worldY: number): number {
    if (getWorldCRS() === WebMercatorQuad) {
        // The world grid already is EPSG:3857's, so stay linear rather than round-tripping
        // through a latitude, which would cost several digits of precision.
        return EPSG3857_HALF_CIRCUMFERENCE * (1 - 2 * worldY);
    }
    const lat = clamp(latFromMercatorY(worldY), -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
    return EPSG3857_RADIUS * Math.log(Math.tan(Math.PI / 4 + degreesToRadians(lat) / 2));
}

function getQuadkey(z:number, x:number, y:number): string {
    let quadkey = '';
    for (let i = z; i > 0; i--) {
        const mask = 1 << (i - 1);
        quadkey += ((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
    }
    return quadkey;
}

export function compareTileId(a: OverscaledTileID, b: OverscaledTileID): number {
    // Different copies of the world are sorted based on their distance to the center.
    // Wrap values are converted to unsigned distances by reserving odd number for copies
    // with negative wrap and even numbers for copies with positive wrap.
    const aWrap = Math.abs(a.wrap * 2) - +(a.wrap < 0);
    const bWrap = Math.abs(b.wrap * 2) - +(b.wrap < 0);
    return a.overscaledZ - b.overscaledZ || bWrap - aWrap || b.canonical.y - a.canonical.y || b.canonical.x - a.canonical.x;
}

register('CanonicalTileID', CanonicalTileID);
register('OverscaledTileID', OverscaledTileID, {omit: ['terrainRttPosMatrix32f']});

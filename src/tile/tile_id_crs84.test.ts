import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {CanonicalTileID, OverscaledTileID} from './tile_id.ts';
import {setWorldCRS} from '../geo/world_crs.ts';

describe('tile IDs under WorldCRS84Quad', () => {
    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
    });

    describe('bounds', () => {
        test('accepts the full column range but only the northern half of the rows', () => {
            expect(() => new CanonicalTileID(2, 3, 1)).not.toThrow();
            expect(() => new CanonicalTileID(2, 3, 2)).toThrow(/outside of bounds/);
            expect(() => new CanonicalTileID(2, 4, 1)).toThrow(/outside of bounds/);
        });

        test('has a single row at internal zoom 1, i.e. CRS84 level 0', () => {
            expect(() => new CanonicalTileID(1, 1, 0)).not.toThrow();
            expect(() => new CanonicalTileID(1, 0, 1)).toThrow(/outside of bounds/);
        });
    });

    describe('.url', () => {
        test('emits the tile matrix level, one below the internal tile zoom', () => {
            expect(new CanonicalTileID(3, 5, 2).url(['{z}/{x}/{y}.pbf'], 1))
                .toBe('2/5/2.pbf');
            expect(new CanonicalTileID(1, 1, 0).url(['{z}/{x}/{y}.pbf'], 1))
                .toBe('0/1/0.pbf');
        });

        test('flips y for the tms scheme over the CRS84 row count', () => {
            // 4 rows at internal zoom 3, so row 2 counted from the north is row 1 from the south.
            expect(new CanonicalTileID(3, 5, 2).url(['{z}/{x}/{y}.pbf'], 1, 'tms'))
                .toBe('2/5/1.pbf');
        });

        test('replaces {bbox-epsg-4326} with the tile in degrees', () => {
            // CRS84 level 2 tiles are 45 degrees square.
            expect(new CanonicalTileID(3, 5, 2).url(['bbox={bbox-epsg-4326}'], 1))
                .toBe('bbox=45,-45,90,0');
            expect(new CanonicalTileID(1, 0, 0).url(['bbox={bbox-epsg-4326}'], 1))
                .toBe('bbox=-180,-90,0,90');
        });

        test('replaces {bbox-epsg-3857} by projecting the tile into mercator', () => {
            const bbox = new CanonicalTileID(3, 5, 2).url(['{bbox-epsg-3857}'], 1).split(',').map(Number);
            const halfCircumference = Math.PI * 6378137;
            expect(bbox[0]).toBeCloseTo(halfCircumference / 4, 6); // 45E
            expect(bbox[2]).toBeCloseTo(halfCircumference / 2, 6); // 90E
            expect(bbox[3]).toBeCloseTo(0, 6); // the equator
            expect(bbox[1]).toBeLessThan(0); // 45S
        });

        test('clamps a polar tile to the mercator limit in {bbox-epsg-3857}', () => {
            const bbox = new CanonicalTileID(1, 0, 0).url(['{bbox-epsg-3857}'], 1).split(',').map(Number);
            const halfCircumference = Math.PI * 6378137;
            expect(bbox[1]).toBeCloseTo(-halfCircumference, 0);
            expect(bbox[3]).toBeCloseTo(halfCircumference, 0);
            expect(Number.isFinite(bbox[1])).toBe(true);
            expect(Number.isFinite(bbox[3])).toBe(true);
        });
    });

    describe('normalizeCoordinates', () => {
        test('resolves past the south edge of the world to null', () => {
            // Internal zoom 2 has 2 rows, so there is nothing below row 1.
            const tileID = new OverscaledTileID(2, 0, 2, 1, 1);
            expect(tileID.normalizeCoordinates(10, 8192 + 10, 8192)).toBeNull();
            expect(tileID.normalizeCoordinates(10, -10, 8192).tileID.canonical.y).toBe(0);
        });

        test('still wraps across the antimeridian', () => {
            const tileID = new OverscaledTileID(2, 0, 2, 3, 0);
            const normalized = tileID.normalizeCoordinates(8192 + 10, 10, 8192);
            expect(normalized.tileID.canonical.x).toBe(0);
            expect(normalized.tileID.wrap).toBe(1);
        });
    });
});

describe('tile IDs under WebMercatorQuad', () => {
    test('keep the square grid and pass the tile zoom through unchanged', () => {
        setWorldCRS('WebMercatorQuad');
        expect(() => new CanonicalTileID(2, 3, 3)).not.toThrow();
        expect(new CanonicalTileID(3, 5, 2).url(['{z}/{x}/{y}.pbf'], 1)).toBe('3/5/2.pbf');
        expect(new CanonicalTileID(3, 5, 2).url(['{z}/{x}/{y}.pbf'], 1, 'tms')).toBe('3/5/5.pbf');
    });
});

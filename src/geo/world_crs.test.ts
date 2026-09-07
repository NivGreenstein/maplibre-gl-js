import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {
    earthCircumference,
    getWorldCRS,
    setWorldCRS,
    tileMatrixLevelFromZoom,
    tileRowsAtZoom,
    WebMercatorQuad,
    WorldCRS84Quad,
    zoomFromTileMatrixLevel
} from './world_crs.ts';
import {
    altitudeFromMercatorZ,
    latFromMercatorY,
    lngFromMercatorX,
    MercatorCoordinate,
    mercatorScale,
    mercatorXfromLng,
    mercatorYfromLat,
    mercatorZfromAltitude
} from './mercator_coordinate.ts';

describe('setWorldCRS', () => {
    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
    });

    test('defaults to WorldCRS84Quad', async () => {
        // The test setup pins the suite to WebMercatorQuad, so load a fresh copy of the
        // module to observe the default the library actually ships with.
        vi.resetModules();
        const freshModule = await import('./world_crs.ts');
        expect(freshModule.getWorldCRS().name).toBe('WorldCRS84Quad');
        vi.resetModules();
    });

    test('selects a CRS by name', () => {
        setWorldCRS('WorldCRS84Quad');
        expect(getWorldCRS()).toBe(WorldCRS84Quad);
        setWorldCRS('WebMercatorQuad');
        expect(getWorldCRS()).toBe(WebMercatorQuad);
    });

    test('rejects an unknown CRS', () => {
        expect(() => setWorldCRS('EPSG:2039' as any)).toThrow(/Unknown world CRS/);
    });
});

describe('WorldCRS84Quad', () => {
    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
    });

    test('spans 360 degrees of longitude over x in [0, 1]', () => {
        expect(mercatorXfromLng(-180)).toBe(0);
        expect(mercatorXfromLng(0)).toBe(0.5);
        expect(mercatorXfromLng(180)).toBe(1);
    });

    test('spans 180 degrees of latitude over y in [0, 0.5]', () => {
        expect(mercatorYfromLat(90)).toBe(0);
        expect(mercatorYfromLat(0)).toBe(0.25);
        expect(mercatorYfromLat(-90)).toBe(0.5);
        expect(getWorldCRS().worldSouthEdge).toBe(0.5);
    });

    test('is linear in latitude, unlike mercator', () => {
        // Half the northern hemisphere by angle is half of it by projected distance.
        expect(mercatorYfromLat(45)).toBeCloseTo(0.125, 12);
        setWorldCRS('WebMercatorQuad');
        expect(mercatorYfromLat(45)).not.toBeCloseTo(0.25, 3);
    });

    test('round-trips lng/lat through world coordinates', () => {
        for (const [lng, lat] of [[0, 0], [-180, 90], [180, -90], [13.377, 52.516], [-122.42, 37.78]]) {
            expect(lngFromMercatorX(mercatorXfromLng(lng))).toBeCloseTo(lng, 10);
            expect(latFromMercatorY(mercatorYfromLat(lat))).toBeCloseTo(lat, 10);
        }
    });

    test('clamps the inverse latitude outside the world', () => {
        // World coordinates below the south edge occur when unprojecting a screen point
        // under the map; a linear inverse would run past the pole and LngLat would throw.
        expect(latFromMercatorY(0.75)).toBe(-90);
        expect(latFromMercatorY(-0.25)).toBe(90);
    });

    test('scales altitude by the meridian, which is true to scale everywhere', () => {
        expect(mercatorZfromAltitude(earthCircumference, 0)).toBe(1);
        expect(mercatorZfromAltitude(earthCircumference, 60)).toBe(1);
        expect(altitudeFromMercatorZ(1, 0.25)).toBeCloseTo(earthCircumference, 6);
        expect(mercatorScale(0)).toBe(1);
        expect(mercatorScale(60)).toBe(1);
    });

    test('projects a MercatorCoordinate to the CRS84 world', () => {
        const coord = MercatorCoordinate.fromLngLat({lng: 0, lat: 0}, 0);
        expect(coord.x).toBe(0.5);
        expect(coord.y).toBe(0.25);
        expect(coord.toLngLat().lng).toBeCloseTo(0, 10);
        expect(coord.toLngLat().lat).toBeCloseTo(0, 10);
    });

    test('has half as many tile rows as columns', () => {
        expect(tileRowsAtZoom(1)).toBe(1);
        expect(tileRowsAtZoom(2)).toBe(2);
        expect(tileRowsAtZoom(3)).toBe(4);
        expect(tileRowsAtZoom(10)).toBe(512);
    });

    test('keeps a single root tile at zoom 0 so quad-tree traversal has somewhere to start', () => {
        expect(tileRowsAtZoom(0)).toBe(1);
    });

    test('addresses tile matrix level z - 1', () => {
        expect(getWorldCRS().minTileZoom).toBe(1);
        expect(tileMatrixLevelFromZoom(1)).toBe(0);
        expect(tileMatrixLevelFromZoom(15)).toBe(14);
        expect(zoomFromTileMatrixLevel(0)).toBe(1);
        expect(zoomFromTileMatrixLevel(14)).toBe(15);
    });

    test('matches the OGC tile matrix set: level L has 2^(L+1) columns of 180/2^L degrees', () => {
        for (const level of [0, 1, 5, 14]) {
            const zoom = zoomFromTileMatrixLevel(level);
            const columns = Math.pow(2, zoom);
            expect(columns).toBe(Math.pow(2, level + 1));
            expect(tileRowsAtZoom(zoom)).toBe(Math.pow(2, level));
            // The tile is square in degrees, as WorldCRS84Quad requires.
            const tileWidthDegrees = 360 / columns;
            const tileHeightDegrees = 180 / tileRowsAtZoom(zoom);
            expect(tileWidthDegrees).toBeCloseTo(tileHeightDegrees, 12);
            expect(tileWidthDegrees).toBeCloseTo(180 / Math.pow(2, level), 12);
        }
    });
});

describe('WebMercatorQuad', () => {
    test('keeps upstream mercator behaviour', () => {
        setWorldCRS('WebMercatorQuad');
        expect(mercatorXfromLng(0)).toBe(0.5);
        expect(mercatorYfromLat(0)).toBe(0.5);
        expect(getWorldCRS().worldSouthEdge).toBe(1);
        expect(getWorldCRS().minTileZoom).toBe(0);
        expect(tileRowsAtZoom(4)).toBe(16);
        expect(tileMatrixLevelFromZoom(7)).toBe(7);
        expect(mercatorScale(60)).toBeCloseTo(2, 6);
    });
});

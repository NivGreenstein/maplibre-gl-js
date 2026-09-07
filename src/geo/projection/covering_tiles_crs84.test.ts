import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {coveringTiles, coveringZoomLevel} from './covering_tiles.ts';
import {MercatorTransform} from './mercator_transform.ts';
import {LngLat} from '../lng_lat.ts';
import {setWorldCRS, tileRowsAtZoom} from '../world_crs.ts';

function createTransform(zoom: number, center: LngLat = new LngLat(0, 0)): MercatorTransform {
    const transform = new MercatorTransform();
    transform.resize(512, 512);
    // Zoom first: the CRS84 world is only half as tall as it is wide, so at low zoom a
    // square viewport is taller than the world and `constrain` would recentre and zoom in.
    transform.setZoom(zoom);
    transform.setCenter(center);
    return transform;
}

describe('coveringTiles under WorldCRS84Quad', () => {
    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
    });

    test('never descends below the shallowest real tile matrix level', () => {
        expect(coveringZoomLevel(createTransform(-3), {tileSize: 512})).toBe(1);
        expect(coveringZoomLevel(createTransform(0), {tileSize: 512})).toBe(1);
        expect(coveringZoomLevel(createTransform(4), {tileSize: 512})).toBe(4);

        const tiles = coveringTiles(createTransform(0), {tileSize: 512});
        expect(tiles).not.toHaveLength(0);
        for (const tile of tiles) {
            expect(tile.canonical.z).toBeGreaterThanOrEqual(1);
        }
    });

    test('the two CRS84 level 0 tiles cover the whole world', () => {
        const tiles = coveringTiles(createTransform(0), {tileSize: 512})
            .filter(tile => tile.wrap === 0)
            .map(tile => tile.canonical.toString())
            .sort();
        expect(tiles).toEqual(['1/0/0', '1/1/0']);
    });

    test('only returns rows that exist in the world', () => {
        for (const zoom of [1, 2, 3, 6, 10]) {
            for (const lat of [0, 60, -60, 85, -85]) {
                const tiles = coveringTiles(createTransform(zoom, new LngLat(0, lat)), {tileSize: 512});
                expect(tiles.length).toBeGreaterThan(0);
                for (const tile of tiles) {
                    expect(tile.canonical.y).toBeLessThan(tileRowsAtZoom(tile.canonical.z));
                    expect(tile.canonical.y).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    test('covers the pole without asking for tiles beyond it', () => {
        const tiles = coveringTiles(createTransform(4, new LngLat(0, 89.9)), {tileSize: 512});
        expect(tiles.length).toBeGreaterThan(0);
        // Internal zoom 4 has 8 rows spanning 22.5 degrees each, so a view pinned to the
        // north pole may only reach into the top few of them - and never past row 7.
        expect(Math.min(...tiles.map(tile => tile.canonical.y))).toBe(0);
        expect(Math.max(...tiles.map(tile => tile.canonical.y))).toBeLessThan(tileRowsAtZoom(4));
    });

    test('fits the world vertically rather than showing space beyond the poles', () => {
        // The plate carree world is 2:1, so a square viewport at zoom 0 cannot show all of
        // it; the transform zooms in to keep the view inside the world.
        const transform = new MercatorTransform();
        transform.resize(512, 512);
        transform.setZoom(0);
        transform.setCenter(new LngLat(0, 89.9));
        expect(transform.zoom).toBe(1);
        expect(transform.center.lat).toBe(0);
    });

    test('the tiles it picks contain the map centre', () => {
        for (const [lng, lat] of [[0, 0], [13.4, 52.5], [-122.4, 37.8], [151.2, -33.9]]) {
            const zoom = 8;
            const tiles = coveringTiles(createTransform(zoom, new LngLat(lng, lat)), {tileSize: 512});
            const columns = Math.pow(2, zoom);
            const centreX = Math.floor((lng + 180) / 360 * columns);
            const centreY = Math.floor((90 - lat) / 360 * columns);
            expect(tiles.some(tile =>
                tile.wrap === 0 &&
                tile.canonical.z === zoom &&
                tile.canonical.x === centreX &&
                tile.canonical.y === centreY)).toBe(true);
        }
    });

    test('respects a source zoom range given in tile matrix levels', () => {
        // A source that publishes CRS84 levels 0..4 is stored as internal zooms 1..5.
        const tiles = coveringTiles(createTransform(9), {tileSize: 512, minzoom: 1, maxzoom: 5});
        expect(tiles.length).toBeGreaterThan(0);
        for (const tile of tiles) {
            expect(tile.canonical.z).toBe(5);
        }
    });
});

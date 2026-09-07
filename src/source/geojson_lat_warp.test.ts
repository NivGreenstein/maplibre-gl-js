import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {
    unwarpFeaturesFromWorldCRS,
    unwarpLatitude,
    warpGeoJSONDiffToWorldCRS,
    warpGeoJSONToWorldCRS,
    warpLatitude
} from './geojson_lat_warp.ts';
import {setWorldCRS, WebMercatorQuad} from '../geo/world_crs.ts';
import {mercatorYfromLat} from '../geo/mercator_coordinate.ts';
import {createGeoJSONIndex} from './geojson_worker_source.ts';

describe('GeoJSON latitude warping under WorldCRS84Quad', () => {
    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
    });

    test('warps a latitude to the one whose mercator Y is its CRS84 Y', () => {
        for (const lat of [0, 45, -45, 89, -89, 12.3456]) {
            expect(WebMercatorQuad.yFromLat(warpLatitude(lat))).toBeCloseTo(mercatorYfromLat(lat), 12);
        }
    });

    test('round-trips through unwarpLatitude', () => {
        for (const lat of [0, 45, -45, 89.9, -89.9]) {
            expect(unwarpLatitude(warpLatitude(lat))).toBeCloseTo(lat, 9);
        }
    });

    test('maps the CRS84 world into the northern half of the mercator world', () => {
        // Which is what makes geojson-vt's own mercator reproduce the CRS84 world.
        expect(WebMercatorQuad.yFromLat(warpLatitude(90))).toBeCloseTo(0, 9);
        expect(WebMercatorQuad.yFromLat(warpLatitude(0))).toBeCloseTo(0.25, 9);
        expect(WebMercatorQuad.yFromLat(warpLatitude(-90))).toBeCloseTo(0.5, 9);
    });

    test('warps every geometry type and leaves longitude and altitude alone', () => {
        const warped = warpGeoJSONToWorldCRS({
            type: 'FeatureCollection',
            features: [
                {type: 'Feature', properties: {a: 1}, geometry: {type: 'Point', coordinates: [10, 45, 123]}},
                {type: 'Feature', properties: null, geometry: {type: 'LineString', coordinates: [[0, 0], [1, 10]]}},
                {type: 'Feature', properties: null, geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]}},
                {type: 'Feature', properties: null, geometry: {type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]]}},
                {type: 'Feature', properties: null, geometry: {
                    type: 'GeometryCollection',
                    geometries: [{type: 'Point', coordinates: [5, 20]}]
                }}
            ]
        }) as GeoJSON.FeatureCollection;

        const point = warped.features[0].geometry as GeoJSON.Point;
        expect(point.coordinates[0]).toBe(10);
        expect(point.coordinates[1]).toBeCloseTo(warpLatitude(45), 12);
        expect(point.coordinates[2]).toBe(123);
        expect(warped.features[0].properties).toEqual({a: 1});

        const line = warped.features[1].geometry as GeoJSON.LineString;
        expect(line.coordinates[1][1]).toBeCloseTo(warpLatitude(10), 12);

        const polygon = warped.features[2].geometry as GeoJSON.Polygon;
        expect(polygon.coordinates[0][2][1]).toBeCloseTo(warpLatitude(1), 12);

        const multi = warped.features[3].geometry as GeoJSON.MultiPolygon;
        expect(multi.coordinates[0][0][2][1]).toBeCloseTo(warpLatitude(1), 12);

        const collection = warped.features[4].geometry as GeoJSON.GeometryCollection;
        expect((collection.geometries[0] as GeoJSON.Point).coordinates[1]).toBeCloseTo(warpLatitude(20), 12);
    });

    test('does not mutate the input', () => {
        const input: GeoJSON.Feature = {
            type: 'Feature', properties: null, geometry: {type: 'Point', coordinates: [10, 45]}
        };
        warpGeoJSONToWorldCRS(input);
        expect((input.geometry as GeoJSON.Point).coordinates).toEqual([10, 45]);
    });

    test('warps the added features and replaced geometries of a diff', () => {
        const diff = warpGeoJSONDiffToWorldCRS({
            remove: ['a'],
            add: [{type: 'Feature', id: 'b', properties: null, geometry: {type: 'Point', coordinates: [0, 30]}}],
            update: [
                {id: 'c', newGeometry: {type: 'Point', coordinates: [0, 60]}},
                {id: 'd', addOrUpdateProperties: [{key: 'k', value: 1}]}
            ]
        });

        expect(diff.remove).toEqual(['a']);
        expect((diff.add[0].geometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(warpLatitude(30), 12);
        expect((diff.update[0].newGeometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(warpLatitude(60), 12);
        expect(diff.update[1].addOrUpdateProperties).toEqual([{key: 'k', value: 1}]);
    });

    test('unwarps features on their way back out, as the cluster APIs need', () => {
        const features = unwarpFeaturesFromWorldCRS([
            {type: 'Feature', properties: null, geometry: {type: 'Point', coordinates: [7, warpLatitude(-12.5)]}}
        ]);
        expect((features[0].geometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(-12.5, 9);
    });
});

describe('GeoJSON latitude warping under WebMercatorQuad', () => {
    test('is a no-op that hands back the very same object', () => {
        setWorldCRS('WebMercatorQuad');
        const input: GeoJSON.Feature = {
            type: 'Feature', properties: null, geometry: {type: 'Point', coordinates: [10, 45]}
        };
        expect(warpGeoJSONToWorldCRS(input)).toBe(input);
        expect(warpLatitude(45)).toBeCloseTo(45, 9);
    });
});

describe('GeoJSON tiling through geojson-vt under WorldCRS84Quad', () => {
    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
    });

    test('a point lands in the tile its CRS84 coordinates belong to', () => {
        const lng = 13.4;
        const lat = 52.5;
        const index = createGeoJSONIndex({
            type: 'Feature',
            properties: null,
            geometry: {type: 'Point', coordinates: [lng, lat]}
        }, {geojsonVtOptions: {maxZoom: 14}} as any);

        // Internal zoom 6 is CRS84 level 5: 64 columns and 32 rows of 5.625 degrees.
        const z = 6;
        const columns = Math.pow(2, z);
        const x = Math.floor((lng + 180) / 360 * columns);
        const y = Math.floor((90 - lat) / 360 * columns);

        expect(index.getTile(z, x, y)?.features).toHaveLength(1);
        expect(index.getTile(z, x, y + 1)?.features ?? []).toHaveLength(0);
        expect(index.getTile(z, x + 1, y)?.features ?? []).toHaveLength(0);

        // ...and at the right position inside it: geojson-vt tile coordinates are integers
        // over 0..extent, so the expected position is the rounded fraction of the tile.
        const extent = 4096;
        const feature = index.getTile(z, x, y).features[0];
        const [tileX, tileY] = feature.geometry[0] as unknown as [number, number];
        expect(tileX).toBe(Math.round(((lng + 180) / 360 * columns - x) * extent));
        expect(tileY).toBe(Math.round(((90 - lat) / 360 * columns - y) * extent));
    });
});

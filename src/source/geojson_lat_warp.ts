import {getWorldCRS, WebMercatorQuad} from '../geo/world_crs.ts';

import type {GeoJSONSourceDiff} from './geojson_source_diff.ts';

/**
 * `geojson-vt` and `supercluster` project coordinates with a hardcoded spherical mercator,
 * so a GeoJSON source would land in the wrong place whenever the active world CRS is not
 * `WebMercatorQuad`.
 *
 * Rather than fork the tiler, we pre-warp latitudes: every latitude is replaced by the
 * latitude whose *mercator* Y equals the latitude's Y in the active CRS. The tiler's own
 * mercator projection then reproduces the active CRS' world exactly, and its quad-tree
 * tile coordinates line up with MapLibre's. Longitudes are unaffected, since every world
 * CRS MapLibre supports maps them linearly onto the same `[0, 1]` range.
 *
 * The warp is a pure function of latitude and is its own inverse via {@link unwarpLatitude},
 * which is needed for the cluster APIs, whose features travel back out to the caller.
 */
export function warpLatitude(lat: number): number {
    return WebMercatorQuad.latFromY(getWorldCRS().yFromLat(lat));
}

/**
 * Reverses {@link warpLatitude}.
 */
export function unwarpLatitude(lat: number): number {
    return getWorldCRS().latFromY(WebMercatorQuad.yFromLat(lat));
}

/**
 * True when latitudes need no warping, i.e. the tiler's own projection is already the
 * active world CRS.
 */
function warpIsIdentity(): boolean {
    return getWorldCRS() === WebMercatorQuad;
}

function warpPosition(position: GeoJSON.Position, warp: (lat: number) => number): GeoJSON.Position {
    // Positions may carry an altitude (and, in the wild, extra values); keep them all.
    const warped = position.slice();
    warped[1] = warp(position[1]);
    return warped;
}

function warpPositions(coordinates: any, depth: number, warp: (lat: number) => number): any {
    if (depth === 0) {
        return warpPosition(coordinates as GeoJSON.Position, warp);
    }
    return (coordinates as any[]).map((child) => warpPositions(child, depth - 1, warp));
}

const COORDINATE_DEPTH: Record<string, number> = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3
};

function warpGeometry(geometry: GeoJSON.Geometry, warp: (lat: number) => number): GeoJSON.Geometry {
    if (!geometry) return geometry;
    if (geometry.type === 'GeometryCollection') {
        return {
            ...geometry,
            geometries: geometry.geometries.map((child) => warpGeometry(child, warp))
        };
    }
    const depth = COORDINATE_DEPTH[geometry.type];
    if (depth === undefined) return geometry;
    return {
        ...geometry,
        coordinates: warpPositions((geometry as any).coordinates, depth, warp)
    };
}

function warpFeature(feature: GeoJSON.Feature, warp: (lat: number) => number): GeoJSON.Feature {
    return {...feature, geometry: warpGeometry(feature.geometry, warp)};
}

function warpGeoJSON(data: GeoJSON.GeoJSON, warp: (lat: number) => number): GeoJSON.GeoJSON {
    switch (data.type) {
        case 'FeatureCollection':
            return {...data, features: data.features.map((feature) => warpFeature(feature, warp))};
        case 'Feature':
            return warpFeature(data, warp);
        default:
            return warpGeometry(data, warp);
    }
}

/**
 * Returns `data` with every latitude warped into the tiler's mercator space, or `data`
 * itself when the active world CRS already is `WebMercatorQuad`.
 */
export function warpGeoJSONToWorldCRS(data: GeoJSON.GeoJSON): GeoJSON.GeoJSON {
    if (!data || warpIsIdentity()) return data;
    return warpGeoJSON(data, warpLatitude);
}

/**
 * The {@link warpGeoJSONToWorldCRS} equivalent for a source diff: warps the features it
 * adds and the geometries it replaces.
 */
export function warpGeoJSONDiffToWorldCRS(diff: GeoJSONSourceDiff): GeoJSONSourceDiff {
    if (!diff || warpIsIdentity()) return diff;
    const warped: GeoJSONSourceDiff = {...diff};
    if (diff.add) {
        warped.add = diff.add.map((feature) => warpFeature(feature, warpLatitude));
    }
    if (diff.update) {
        warped.update = diff.update.map((update) => update.newGeometry ?
            {...update, newGeometry: warpGeometry(update.newGeometry, warpLatitude)} :
            update);
    }
    return warped;
}

/**
 * Undoes {@link warpGeoJSONToWorldCRS} on features handed back to the caller, such as the
 * cluster children and leaves returned by {@link GeoJSONSource.getClusterChildren}.
 */
export function unwarpFeaturesFromWorldCRS(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
    if (!features || warpIsIdentity()) return features;
    return features.map((feature) => warpFeature(feature, unwarpLatitude));
}

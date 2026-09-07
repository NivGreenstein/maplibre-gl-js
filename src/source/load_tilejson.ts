import {pick, extend, type TileJSON} from '../util/util.ts';
import {zoomFromTileMatrixLevel} from '../geo/world_crs.ts';
import {getJSON} from '../util/ajax.ts';
import {ResourceType} from '../util/request_manager.ts';
import {browser} from '../util/browser.ts';

import type {RequestManager} from '../util/request_manager.ts';
import type {RasterDEMSourceSpecification, RasterSourceSpecification, VectorSourceSpecification} from '@maplibre/maplibre-gl-style-spec';

export type LoadTileJsonResponse = {
    tiles: string[];
    minzoom: number;
    maxzoom: number;
    attribution: string;
    bounds: RasterSourceSpecification['bounds'];
    scheme: RasterSourceSpecification['scheme'];
    tileSize: number;
    encoding: RasterDEMSourceSpecification['encoding'];
    vectorLayerIds?: string[];
};

export async function loadTileJson(
    options: RasterSourceSpecification | RasterDEMSourceSpecification | VectorSourceSpecification,
    requestManager: RequestManager,
    abortController: AbortController,
    targetWindow?: Window,
): Promise<LoadTileJsonResponse | null> {
    let tileJSON: TileJSON | typeof options = options;
    if (options.url) {
        const response = await getJSON<TileJSON>(await requestManager.transformRequest(options.url, ResourceType.Source), abortController);
        tileJSON = response.data;
    } else {
        await browser.frameAsync(abortController, targetWindow);
    }
    if (!tileJSON) {
        return null;
    }
    const result = pick(
        // explicit source options take precedence over TileJSON
        extend(tileJSON, options),
        ['tiles', 'minzoom', 'maxzoom', 'attribution', 'bounds', 'scheme', 'tileSize', 'encoding']
    ) as LoadTileJsonResponse;

    // `minzoom`/`maxzoom` name tile matrix levels of the active world CRS - the `{z}` the
    // server is asked for - while the rest of MapLibre works in internal tile zooms. These
    // are the same thing for `WebMercatorQuad` and one level apart for `WorldCRS84Quad`.
    if (result.minzoom !== undefined && result.minzoom !== null) {
        result.minzoom = zoomFromTileMatrixLevel(result.minzoom);
    }
    if (result.maxzoom !== undefined && result.maxzoom !== null) {
        result.maxzoom = zoomFromTileMatrixLevel(result.maxzoom);
    }

    if ('vector_layers' in tileJSON && tileJSON.vector_layers) {
        result.vectorLayerIds = tileJSON.vector_layers.map((layer) => layer.id);
    }

    return result;
}

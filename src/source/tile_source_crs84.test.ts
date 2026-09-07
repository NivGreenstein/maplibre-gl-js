import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {fakeServer, type FakeServer} from 'nise';
import {RasterTileSource} from './raster_tile_source.ts';
import {VectorTileSource} from './vector_tile_source.ts';
import {OverscaledTileID} from '../tile/tile_id.ts';
import {RequestManager} from '../util/request_manager.ts';
import {setWorldCRS} from '../geo/world_crs.ts';
import {ImageRequest} from '../util/image_request.ts';
import {type Dispatcher} from '../util/dispatcher.ts';
import {type Tile} from '../tile/tile.ts';
import {sleep, waitForEvent} from '../util/test/util.ts';
import {type MapSourceDataEvent} from '../ui/events.ts';

function fakeMap() {
    return {
        transform: {angle: 0, pitch: 0, showCollisionBoxes: false},
        _getMapId: () => 1,
        _requestManager: new RequestManager(),
        _refreshExpiredTiles: false,
        getPixelRatio: () => 1,
        showCollisionBoxes: false,
        style: {projection: {subdivisionGranularity: null}},
        painter: {context: {gl: {}}}
    } as any;
}

describe('tile sources under WorldCRS84Quad', () => {
    let server: FakeServer;

    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
        global.fetch = null;
        server = fakeServer.create();
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
        vi.restoreAllMocks();
        server.restore();
    });

    test('a raster tile is requested at the CRS84 tile matrix level', async () => {
        const source = new RasterTileSource('id', {
            type: 'raster',
            tiles: ['http://example.com/{z}/{x}/{y}.png'],
            tileSize: 256
        }, {send() {}} as any as Dispatcher, undefined);
        source.onAdd(fakeMap());
        await waitForEvent(source, 'data', (e: MapSourceDataEvent) => e.sourceDataType === 'metadata');

        const getImage = vi.spyOn(ImageRequest, 'transformAndGetImage')
            .mockResolvedValue(null);

        // Internal zoom 6 is CRS84 level 5, which has 64 columns and 32 rows.
        const tile = {tileID: new OverscaledTileID(6, 0, 6, 40, 20), state: 'loading'} as any as Tile;
        await source.loadTile(tile);

        expect(getImage.mock.calls[0][1]).toBe('http://example.com/5/40/20.png');
    });

    test('a vector tile is requested at the CRS84 tile matrix level', async () => {
        const actorSend = vi.fn().mockResolvedValue({});
        const source = new VectorTileSource('id', {
            type: 'vector',
            tiles: ['http://example.com/{z}/{x}/{y}.pbf']
        }, {
            waitForInitComplete: () => Promise.resolve(),
            getReadyActor: () => ({sendAsync: actorSend})
        } as any as Dispatcher, undefined);
        source.onAdd(fakeMap());
        await waitForEvent(source, 'data', (e: MapSourceDataEvent) => e.sourceDataType === 'metadata');

        const tile = {
            tileID: new OverscaledTileID(6, 0, 6, 40, 20),
            uid: 1,
            loadVectorData: () => {}
        } as any as Tile;
        await source.loadTile(tile);

        expect(actorSend.mock.calls[0][0].data.request.url).toBe('http://example.com/5/40/20.pbf');
    });

    test('TileJSON zoom levels are read as tile matrix levels', async () => {
        server.respondWith('/source.json', JSON.stringify({
            minzoom: 2,
            maxzoom: 14,
            tiles: ['http://example.com/{z}/{x}/{y}.png']
        }));
        const source = new RasterTileSource('id', {type: 'raster', url: '/source.json'},
            {send() {}} as any as Dispatcher, undefined);
        source.onAdd(fakeMap());
        const loaded = waitForEvent(source, 'data', (e: MapSourceDataEvent) => e.sourceDataType === 'metadata');
        await sleep(0);
        server.respond();
        await loaded;

        // Internally one level deeper, so the deepest tile still requests level 14.
        expect(source.minzoom).toBe(3);
        expect(source.maxzoom).toBe(15);
        expect(new OverscaledTileID(source.maxzoom, 0, source.maxzoom, 0, 0)
            .canonical.url(source.tiles, 1)).toBe('http://example.com/14/0/0.png');
    });

    test('default zoom levels leave room for the whole pyramid', () => {
        const source = new RasterTileSource('id', {type: 'raster', tiles: ['a/{z}/{x}/{y}.png']},
            {send() {}} as any as Dispatcher, undefined);
        expect(source.minzoom).toBe(1);
        expect(source.maxzoom).toBe(23);
    });

    test('a source bound to a bbox only claims tiles inside it', async () => {
        const source = new RasterTileSource('id', {
            type: 'raster',
            tiles: ['a/{z}/{x}/{y}.png'],
            bounds: [-10, -10, 10, 10]
        }, {send() {}} as any as Dispatcher, undefined);
        source.onAdd(fakeMap());
        await waitForEvent(source, 'data', (e: MapSourceDataEvent) => e.sourceDataType === 'metadata');

        // Internal zoom 3 is CRS84 level 2: 8 columns and 4 rows of 45 degrees each, so the
        // bbox straddling 0/0 falls in columns 3-4 and rows 1-2.
        expect(source.hasTile(new OverscaledTileID(3, 0, 3, 4, 2))).toBe(true);
        expect(source.hasTile(new OverscaledTileID(3, 0, 3, 0, 0))).toBe(false);
    });
});

describe('tile sources under WebMercatorQuad', () => {
    test('request the tile zoom unchanged', () => {
        setWorldCRS('WebMercatorQuad');
        const source = new RasterTileSource('id', {type: 'raster', tiles: ['a/{z}/{x}/{y}.png']},
            {send() {}} as any as Dispatcher, undefined);
        expect(source.minzoom).toBe(0);
        expect(source.maxzoom).toBe(22);
        expect(new OverscaledTileID(6, 0, 6, 40, 20).canonical.url(['{z}/{x}/{y}.png'], 1))
            .toBe('6/40/20.png');
    });
});

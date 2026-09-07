import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {beforeMapTest, createMap, sleep} from '../../util/test/util.ts';
import {setWorldCRS} from '../../geo/world_crs.ts';
import {Dispatcher} from '../../util/dispatcher.ts';
import {MessageType} from '../../util/actor_messages.ts';
import {ImageRequest} from '../../util/image_request.ts';
import {RequestManager} from '../../util/request_manager.ts';
import {TileManager} from '../../tile/tile_manager.ts';
import {MercatorTransform} from '../../geo/projection/mercator_transform.ts';
import {LngLat} from '../../geo/lng_lat.ts';
import {waitForEvent} from '../../util/test/util.ts';
import {type MapSourceDataEvent} from '../events.ts';

describe('Map under WorldCRS84Quad', () => {
    beforeEach(() => {
        setWorldCRS('WorldCRS84Quad');
        beforeMapTest();
        global.fetch = null;
    });

    afterEach(() => {
        setWorldCRS('WebMercatorQuad');
        vi.restoreAllMocks();
    });

    test('tells the workers which CRS to use', async () => {
        const broadcast = vi.spyOn(Dispatcher.prototype, 'broadcast').mockResolvedValue([]);
        createMap();
        await sleep(0);
        expect(broadcast).toHaveBeenCalledWith(MessageType.setWorldCRS, 'WorldCRS84Quad');
    });

    test('map.coveringTiles returns CRS84 tiles', () => {
        const map = createMap({zoom: 3, center: [13.4, 52.5]});
        const tiles = map.coveringTiles({tileSize: 512});
        expect(tiles.length).toBeGreaterThan(0);
        for (const tile of tiles) {
            expect(tile.canonical.z).toBe(3);
            // Internal zoom 3 is CRS84 level 2, which has 4 rows.
            expect(tile.canonical.y).toBeLessThan(4);
        }
        expect(tiles.some(tile => tile.canonical.toString() === '3/4/0')).toBe(true);
    });

    test('requests raster tiles at the EPSG:4326 tile matrix level covering the view', async () => {
        const requested: string[] = [];
        vi.spyOn(ImageRequest, 'transformAndGetImage').mockImplementation((_manager, url) => {
            requested.push(url);
            return Promise.resolve(null) as any;
        });

        const tileManager = new TileManager('satellite', {
            type: 'raster',
            tiles: ['http://example.com/wmts/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 10
        }, {send() {}} as any as Dispatcher);
        tileManager.used = true;
        tileManager.onAdd({
            transform: {angle: 0, pitch: 0, showCollisionBoxes: false},
            _getMapId: () => 1,
            _requestManager: new RequestManager(),
            _refreshExpiredTiles: false,
            getPixelRatio: () => 1,
            painter: {context: {gl: {}}}
        } as any);
        await waitForEvent(tileManager, 'data',
            (e: MapSourceDataEvent) => e.sourceDataType === 'metadata');

        const transform = new MercatorTransform();
        transform.resize(512, 512);
        transform.setZoom(2);
        transform.setCenter(new LngLat(0, 0));
        tileManager.update(transform);
        await sleep(0);

        expect(requested.length).toBeGreaterThan(0);
        for (const url of requested) {
            const [, z, x, y] = url.match(/wmts\/(\d+)\/(\d+)\/(\d+)\.png$/).map(Number);
            // A 256 px source is requested one internal zoom deeper than the map, which for
            // CRS84 is level 2 - the level whose 256 px tiles are 1:1 with the screen.
            expect(z).toBe(2);
            expect(x).toBeLessThan(Math.pow(2, z + 1));
            expect(y).toBeLessThan(Math.pow(2, z));
        }
        // Level 2 tiles are 45 degrees square, so null island is the corner of four of them.
        expect(requested).toContain('http://example.com/wmts/2/3/1.png');
        expect(requested).toContain('http://example.com/wmts/2/4/2.png');
    });
});

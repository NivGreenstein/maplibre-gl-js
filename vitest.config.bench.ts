import {defineConfig, type ViteUserConfig} from 'vitest/config';

const config: ViteUserConfig = defineConfig({
    test: {
        name: 'bench',
        environment: 'node',
        setupFiles: [
            './test/bench/world_crs_default.ts'
        ],
        benchmark: {
            include: ['src/**/*.bench.ts'],
        },
    }
});

export default config;

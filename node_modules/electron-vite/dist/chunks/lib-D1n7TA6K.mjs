import { build as build$1 } from 'vite';
import { r as resolveConfig } from './lib-BmEkZIgk.mjs';
import 'node:path';
import 'node:fs';
import 'node:url';
import 'node:module';
import 'picocolors';
import 'esbuild';
import 'node:child_process';
import 'node:crypto';
import 'node:fs/promises';
import 'magic-string';

/**
 * Bundles the electron app for production.
 */
async function build(inlineConfig = {}) {
    process.env.NODE_ENV_ELECTRON_VITE = 'production';
    const config = await resolveConfig(inlineConfig, 'build', 'production');
    if (config.config) {
        const mainViteConfig = config.config?.main;
        if (mainViteConfig) {
            if (mainViteConfig.build?.watch) {
                mainViteConfig.build.watch = null;
            }
            await build$1(mainViteConfig);
        }
        const preloadViteConfig = config.config?.preload;
        if (preloadViteConfig) {
            if (preloadViteConfig.build?.watch) {
                preloadViteConfig.build.watch = null;
            }
            await build$1(preloadViteConfig);
        }
        const rendererViteConfig = config.config?.renderer;
        if (rendererViteConfig) {
            if (rendererViteConfig.build?.watch) {
                rendererViteConfig.build.watch = null;
            }
            await build$1(rendererViteConfig);
        }
    }
}

export { build };

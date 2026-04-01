'use strict';

var vite = require('vite');
var config = require('./lib-CMs-qhOt.cjs');
require('node:path');
require('node:fs');
require('node:url');
require('node:module');
require('picocolors');
require('esbuild');
require('node:child_process');
require('node:crypto');
require('node:fs/promises');
require('magic-string');

/**
 * Bundles the electron app for production.
 */
async function build(inlineConfig = {}) {
    process.env.NODE_ENV_ELECTRON_VITE = 'production';
    const config$1 = await config.resolveConfig(inlineConfig, 'build', 'production');
    if (config$1.config) {
        const mainViteConfig = config$1.config?.main;
        if (mainViteConfig) {
            if (mainViteConfig.build?.watch) {
                mainViteConfig.build.watch = null;
            }
            await vite.build(mainViteConfig);
        }
        const preloadViteConfig = config$1.config?.preload;
        if (preloadViteConfig) {
            if (preloadViteConfig.build?.watch) {
                preloadViteConfig.build.watch = null;
            }
            await vite.build(preloadViteConfig);
        }
        const rendererViteConfig = config$1.config?.renderer;
        if (rendererViteConfig) {
            if (rendererViteConfig.build?.watch) {
                rendererViteConfig.build.watch = null;
            }
            await vite.build(rendererViteConfig);
        }
    }
}

exports.build = build;

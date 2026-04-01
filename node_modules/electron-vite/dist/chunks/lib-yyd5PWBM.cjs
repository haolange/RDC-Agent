'use strict';

var colors = require('picocolors');
var vite = require('vite');
var config = require('./lib-CMs-qhOt.cjs');
var build = require('./lib-BVIIv3aq.cjs');
require('node:path');
require('node:fs');
require('node:url');
require('node:module');
require('esbuild');
require('node:child_process');
require('node:crypto');
require('node:fs/promises');
require('magic-string');

async function preview(inlineConfig = {}, options) {
    if (!options.skipBuild) {
        await build.build(inlineConfig);
    }
    const logger = vite.createLogger(inlineConfig.logLevel);
    config.startElectron(inlineConfig.root);
    logger.info(colors.green(`\nstart electron app...\n`));
}

exports.preview = preview;

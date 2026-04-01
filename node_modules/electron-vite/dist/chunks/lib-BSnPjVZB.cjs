'use strict';

var vite = require('vite');
var colors = require('picocolors');
var config = require('./lib-CMs-qhOt.cjs');
require('node:path');
require('node:fs');
require('node:url');
require('node:module');
require('esbuild');
require('node:child_process');
require('node:crypto');
require('node:fs/promises');
require('magic-string');

async function createServer(inlineConfig = {}, options) {
    process.env.NODE_ENV_ELECTRON_VITE = 'development';
    const config$1 = await config.resolveConfig(inlineConfig, 'serve', 'development');
    if (config$1.config) {
        const logger = vite.createLogger(inlineConfig.logLevel);
        let server;
        let ps;
        const errorHook = (e) => {
            logger.error(`${colors.bgRed(colors.white(' ERROR '))} ${colors.red(e.message)}`);
        };
        const mainViteConfig = config$1.config?.main;
        if (mainViteConfig && !options.rendererOnly) {
            const watchHook = () => {
                logger.info(colors.green(`\nrebuild the electron main process successfully`));
                if (ps) {
                    logger.info(colors.cyan(`\n  waiting for electron to exit...`));
                    ps.removeAllListeners();
                    ps.kill();
                    ps = config.startElectron(inlineConfig.root);
                    logger.info(colors.green(`\nrestart electron app...`));
                }
            };
            await doBuild(mainViteConfig, watchHook, errorHook);
            logger.info(colors.green(`\nbuild the electron main process successfully`));
        }
        const preloadViteConfig = config$1.config?.preload;
        if (preloadViteConfig && !options.rendererOnly) {
            logger.info(colors.gray(`\n-----\n`));
            const watchHook = () => {
                logger.info(colors.green(`\nrebuild the electron preload files successfully`));
                if (server) {
                    logger.info(colors.cyan(`\n  trigger renderer reload`));
                    server.ws.send({ type: 'full-reload' });
                }
            };
            await doBuild(preloadViteConfig, watchHook, errorHook);
            logger.info(colors.green(`\nbuild the electron preload files successfully`));
        }
        if (options.rendererOnly) {
            logger.warn(`\n${colors.yellow(colors.bold('warn'))}:${colors.yellow(' you have skipped the main process and preload scripts building')}`);
        }
        const rendererViteConfig = config$1.config?.renderer;
        if (rendererViteConfig) {
            logger.info(colors.gray(`\n-----\n`));
            server = await vite.createServer(rendererViteConfig);
            if (!server.httpServer) {
                throw new Error('HTTP server not available');
            }
            await server.listen();
            const conf = server.config.server;
            const protocol = conf.https ? 'https:' : 'http:';
            const host = config.resolveHostname(conf.host);
            const port = conf.port;
            process.env.ELECTRON_RENDERER_URL = `${protocol}//${host}:${port}`;
            const slogger = server.config.logger;
            slogger.info(colors.green(`dev server running for the electron renderer process at:\n`), {
                clear: !slogger.hasWarned && !options.rendererOnly
            });
            server.printUrls();
        }
        ps = config.startElectron(inlineConfig.root);
        logger.info(colors.green(`\nstart electron app...\n`));
    }
}
async function doBuild(config, watchHook, errorHook) {
    return new Promise(resolve => {
        if (config.build?.watch) {
            let firstBundle = true;
            const closeBundle = () => {
                if (firstBundle) {
                    firstBundle = false;
                    resolve();
                }
                else {
                    watchHook();
                }
            };
            config = vite.mergeConfig(config, {
                plugins: [
                    {
                        name: 'vite:electron-watcher',
                        closeBundle
                    }
                ]
            });
        }
        vite.build(config)
            .then(() => {
            if (!config.build?.watch) {
                resolve();
            }
        })
            .catch(e => errorHook(e));
    });
}

exports.createServer = createServer;

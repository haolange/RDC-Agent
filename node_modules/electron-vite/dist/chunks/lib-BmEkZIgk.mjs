import path from 'node:path';
import fs from 'node:fs';
import { URL, URLSearchParams, pathToFileURL } from 'node:url';
import { createRequire, builtinModules } from 'node:module';
import colors from 'picocolors';
import { loadEnv as loadEnv$1, mergeConfig, normalizePath, createLogger } from 'vite';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs$1 from 'node:fs/promises';
import MagicString from 'magic-string';

function isObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}
const wildcardHosts = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000']);
function resolveHostname(optionsHost) {
    return typeof optionsHost === 'string' && !wildcardHosts.has(optionsHost) ? optionsHost : 'localhost';
}
const queryRE = /\?.*$/s;
const hashRE = /#.*$/s;
const cleanUrl = (url) => url.replace(hashRE, '').replace(queryRE, '');
function parseRequest(id) {
    const { search } = new URL(id, 'file:');
    if (!search) {
        return null;
    }
    return Object.fromEntries(new URLSearchParams(search));
}
function getHash(text) {
    return createHash('sha256').update(text).digest('hex').substring(0, 8);
}
function toRelativePath(filename, importer) {
    const relPath = path.posix.relative(path.dirname(importer), filename);
    return relPath.startsWith('.') ? relPath : `./${relPath}`;
}
/**
 * Load `.env` files within the `envDir` (default: `process.cwd()`) .
 * By default, only env variables prefixed with `VITE_`, `MAIN_VITE_`, `PRELOAD_VITE_` and
 * `RENDERER_VITE_` are loaded, unless `prefixes` is changed.
 */
function loadEnv(mode, envDir = process.cwd(), prefixes = ['VITE_', 'MAIN_VITE_', 'PRELOAD_VITE_', 'RENDERER_VITE_']) {
    return loadEnv$1(mode, envDir, prefixes);
}
let packageCached = null;
function loadPackageData(root = process.cwd()) {
    if (packageCached)
        return packageCached;
    const pkg = path.join(root, 'package.json');
    if (fs.existsSync(pkg)) {
        const _require = createRequire(import.meta.url);
        const data = _require(pkg);
        packageCached = {
            main: data.main,
            type: data.type,
            dependencies: data.dependencies
        };
        return packageCached;
    }
    return null;
}
function isFilePathESM(filePath) {
    if (/\.m[jt]s$/.test(filePath) || filePath.endsWith('.ts')) {
        return true;
    }
    else if (/\.c[jt]s$/.test(filePath)) {
        return false;
    }
    else {
        const pkg = loadPackageData();
        return pkg?.type === 'module';
    }
}

const _require$1 = createRequire(import.meta.url);
const ensureElectronEntryFile = (root = process.cwd()) => {
    if (process.env.ELECTRON_ENTRY)
        return;
    const pkg = loadPackageData();
    if (pkg) {
        if (!pkg.main) {
            throw new Error('No entry point found for electron app, please add a "main" field to package.json');
        }
        else {
            const entryPath = path.resolve(root, pkg.main);
            if (!fs.existsSync(entryPath)) {
                throw new Error(`No electron app entry file found: ${entryPath}`);
            }
        }
    }
    else {
        throw new Error('Not found: package.json');
    }
};
const getElectronMajorVer = () => {
    let majorVer = process.env.ELECTRON_MAJOR_VER || '';
    if (!majorVer) {
        const pkg = _require$1.resolve('electron/package.json');
        if (fs.existsSync(pkg)) {
            const version = _require$1(pkg).version;
            majorVer = version.split('.')[0];
            process.env.ELECTRON_MAJOR_VER = majorVer;
        }
    }
    return majorVer;
};
function supportESM() {
    const majorVer = getElectronMajorVer();
    return parseInt(majorVer) >= 28;
}
function getElectronMajorVersion() {
    const majorVer = getElectronMajorVer();
    return parseInt(majorVer);
}
function getElectronPath() {
    let electronExecPath = process.env.ELECTRON_EXEC_PATH || '';
    if (!electronExecPath) {
        const electronModulePath = path.dirname(_require$1.resolve('electron'));
        const pathFile = path.join(electronModulePath, 'path.txt');
        let executablePath;
        if (fs.existsSync(pathFile)) {
            executablePath = fs.readFileSync(pathFile, 'utf-8');
        }
        if (executablePath) {
            electronExecPath = path.join(electronModulePath, 'dist', executablePath);
            process.env.ELECTRON_EXEC_PATH = electronExecPath;
        }
        else {
            throw new Error('Electron uninstall');
        }
    }
    return electronExecPath;
}
function getElectronNodeTarget() {
    const electronVer = getElectronMajorVer();
    const nodeVer = {
        '31': '20.14',
        '30': '20.11',
        '29': '20.9',
        '28': '18.18',
        '27': '18.17',
        '26': '18.16',
        '25': '18.15',
        '24': '18.14',
        '23': '18.12',
        '22': '16.17',
        '21': '16.16',
        '20': '16.15',
        '19': '16.14',
        '18': '16.13',
        '17': '16.13',
        '16': '16.9',
        '15': '16.5',
        '14': '14.17',
        '13': '14.17'
    };
    if (electronVer && parseInt(electronVer) > 10) {
        let target = nodeVer[electronVer];
        if (!target)
            target = Object.values(nodeVer).reverse()[0];
        return 'node' + target;
    }
    return '';
}
function getElectronChromeTarget() {
    const electronVer = getElectronMajorVer();
    const chromeVer = {
        '31': '126',
        '30': '124',
        '29': '122',
        '28': '120',
        '27': '118',
        '26': '116',
        '25': '114',
        '24': '112',
        '23': '110',
        '22': '108',
        '21': '106',
        '20': '104',
        '19': '102',
        '18': '100',
        '17': '98',
        '16': '96',
        '15': '94',
        '14': '93',
        '13': '91'
    };
    if (electronVer && parseInt(electronVer) > 10) {
        let target = chromeVer[electronVer];
        if (!target)
            target = Object.values(chromeVer).reverse()[0];
        return 'chrome' + target;
    }
    return '';
}
function startElectron(root) {
    ensureElectronEntryFile(root);
    const electronPath = getElectronPath();
    const isDev = process.env.NODE_ENV_ELECTRON_VITE === 'development';
    const args = process.env.ELECTRON_CLI_ARGS ? JSON.parse(process.env.ELECTRON_CLI_ARGS) : [];
    if (!!process.env.REMOTE_DEBUGGING_PORT && isDev) {
        args.push(`--remote-debugging-port=${process.env.REMOTE_DEBUGGING_PORT}`);
    }
    if (!!process.env.V8_INSPECTOR_PORT && isDev) {
        args.push(`--inspect=${process.env.V8_INSPECTOR_PORT}`);
    }
    if (!!process.env.V8_INSPECTOR_BRK_PORT && isDev) {
        args.push(`--inspect-brk=${process.env.V8_INSPECTOR_BRK_PORT}`);
    }
    if (process.env.NO_SANDBOX === '1') {
        args.push('--no-sandbox');
    }
    const entry = process.env.ELECTRON_ENTRY || '.';
    const ps = spawn(electronPath, [entry].concat(args), { stdio: 'inherit' });
    ps.on('close', process.exit);
    return ps;
}

function findLibEntry(root, scope) {
    for (const name of ['index', scope]) {
        for (const ext of ['js', 'ts', 'mjs', 'cjs']) {
            const entryFile = path.resolve(root, 'src', scope, `${name}.${ext}`);
            if (fs.existsSync(entryFile)) {
                return entryFile;
            }
        }
    }
    return undefined;
}
function findInput(root, scope = 'renderer') {
    const rendererDir = path.resolve(root, 'src', scope, 'index.html');
    if (fs.existsSync(rendererDir)) {
        return rendererDir;
    }
    return '';
}
function processEnvDefine() {
    return {
        'process.env': `process.env`,
        'global.process.env': `global.process.env`,
        'globalThis.process.env': `globalThis.process.env`
    };
}
function resolveBuildOutputs(outputs, libOptions) {
    if (libOptions && !Array.isArray(outputs)) {
        const libFormats = libOptions.formats || [];
        return libFormats.map(format => ({ ...outputs, format }));
    }
    return outputs;
}
function electronMainVitePlugin(options) {
    return [
        {
            name: 'vite:electron-main-preset-config',
            apply: 'build',
            enforce: 'pre',
            config(config) {
                const root = options?.root || process.cwd();
                const nodeTarget = getElectronNodeTarget();
                const pkg = loadPackageData() || { type: 'commonjs' };
                const format = pkg.type && pkg.type === 'module' && supportESM() ? 'es' : 'cjs';
                const defaultConfig = {
                    resolve: {
                        browserField: false,
                        mainFields: ['module', 'jsnext:main', 'jsnext'],
                        conditions: ['node']
                    },
                    build: {
                        outDir: path.resolve(root, 'out', 'main'),
                        target: nodeTarget,
                        assetsDir: 'chunks',
                        rollupOptions: {
                            external: ['electron', /^electron\/.+/, ...builtinModules.flatMap(m => [m, `node:${m}`])],
                            output: {}
                        },
                        reportCompressedSize: false,
                        minify: false
                    }
                };
                const build = config.build || {};
                const rollupOptions = build.rollupOptions || {};
                if (!rollupOptions.input) {
                    const libOptions = build.lib;
                    const outputOptions = rollupOptions.output;
                    defaultConfig.build['lib'] = {
                        entry: findLibEntry(root, 'main'),
                        formats: libOptions && libOptions.formats && libOptions.formats.length > 0
                            ? []
                            : [
                                outputOptions && !Array.isArray(outputOptions) && outputOptions.format
                                    ? outputOptions.format
                                    : format
                            ]
                    };
                }
                else {
                    defaultConfig.build.rollupOptions.output['format'] = format;
                }
                defaultConfig.build.rollupOptions.output['assetFileNames'] = path.posix.join(build.assetsDir || defaultConfig.build.assetsDir, '[name]-[hash].[ext]');
                const buildConfig = mergeConfig(defaultConfig.build, build);
                config.build = buildConfig;
                config.resolve = mergeConfig(defaultConfig.resolve, config.resolve || {});
                config.define = config.define || {};
                config.define = { ...processEnvDefine(), ...config.define };
                config.envPrefix = config.envPrefix || ['MAIN_VITE_', 'VITE_'];
                config.publicDir = config.publicDir || 'resources';
                // do not copy public dir
                config.build.copyPublicDir = false;
                // module preload polyfill does not apply to nodejs (main process)
                config.build.modulePreload = false;
                // enable ssr build
                config.build.ssr = true;
                config.build.ssrEmitAssets = true;
                config.ssr = { ...config.ssr, ...{ noExternal: true } };
            }
        },
        {
            name: 'vite:electron-main-resolved-config',
            apply: 'build',
            enforce: 'post',
            configResolved(config) {
                const build = config.build;
                if (!build.target) {
                    throw new Error('build.target option is required in the electron vite main config.');
                }
                else {
                    const targets = Array.isArray(build.target) ? build.target : [build.target];
                    if (targets.some(t => !t.startsWith('node'))) {
                        throw new Error('The electron vite main config build.target option must be "node?".');
                    }
                }
                const libOptions = build.lib;
                const rollupOptions = build.rollupOptions;
                if (!(libOptions && libOptions.entry) && !rollupOptions?.input) {
                    throw new Error('An entry point is required in the electron vite main config, ' +
                        'which can be specified using "build.lib.entry" or "build.rollupOptions.input".');
                }
                const resolvedOutputs = resolveBuildOutputs(rollupOptions.output, libOptions);
                if (resolvedOutputs) {
                    const outputs = Array.isArray(resolvedOutputs) ? resolvedOutputs : [resolvedOutputs];
                    if (outputs.length > 1) {
                        throw new Error('The electron vite main config does not support multiple outputs.');
                    }
                    else {
                        const outpout = outputs[0];
                        if (['es', 'cjs'].includes(outpout.format || '')) {
                            if (outpout.format === 'es' && !supportESM()) {
                                throw new Error('The electron vite main config output format does not support "es", ' +
                                    'you can upgrade electron to the latest version or switch to "cjs" format.');
                            }
                        }
                        else {
                            throw new Error(`The electron vite main config output format must be "cjs"${supportESM() ? ' or "es"' : ''}.`);
                        }
                    }
                }
            }
        }
    ];
}
function electronPreloadVitePlugin(options) {
    return [
        {
            name: 'vite:electron-preload-preset-config',
            apply: 'build',
            enforce: 'pre',
            config(config) {
                const root = options?.root || process.cwd();
                const nodeTarget = getElectronNodeTarget();
                const pkg = loadPackageData() || { type: 'commonjs' };
                const format = pkg.type && pkg.type === 'module' && supportESM() ? 'es' : 'cjs';
                const defaultConfig = {
                    build: {
                        outDir: path.resolve(root, 'out', 'preload'),
                        target: nodeTarget,
                        assetsDir: 'chunks',
                        rollupOptions: {
                            external: ['electron', /^electron\/.+/, ...builtinModules.flatMap(m => [m, `node:${m}`])],
                            output: {}
                        },
                        reportCompressedSize: false,
                        minify: false
                    }
                };
                const build = config.build || {};
                const rollupOptions = build.rollupOptions || {};
                if (!rollupOptions.input) {
                    const libOptions = build.lib;
                    const outputOptions = rollupOptions.output;
                    defaultConfig.build['lib'] = {
                        entry: findLibEntry(root, 'preload'),
                        formats: libOptions && libOptions.formats && libOptions.formats.length > 0
                            ? []
                            : [
                                outputOptions && !Array.isArray(outputOptions) && outputOptions.format
                                    ? outputOptions.format
                                    : format
                            ]
                    };
                }
                else {
                    defaultConfig.build.rollupOptions.output['format'] = format;
                }
                defaultConfig.build.rollupOptions.output['assetFileNames'] = path.posix.join(build.assetsDir || defaultConfig.build.assetsDir, '[name]-[hash].[ext]');
                const buildConfig = mergeConfig(defaultConfig.build, build);
                config.build = buildConfig;
                const resolvedOutputs = resolveBuildOutputs(config.build.rollupOptions.output, config.build.lib || false);
                if (resolvedOutputs) {
                    const outputs = Array.isArray(resolvedOutputs) ? resolvedOutputs : [resolvedOutputs];
                    if (outputs.find(({ format }) => format === 'es')) {
                        if (Array.isArray(config.build.rollupOptions.output)) {
                            config.build.rollupOptions.output.forEach(output => {
                                if (output.format === 'es') {
                                    output['entryFileNames'] = '[name].mjs';
                                    output['chunkFileNames'] = '[name]-[hash].mjs';
                                }
                            });
                        }
                        else {
                            config.build.rollupOptions.output['entryFileNames'] = '[name].mjs';
                            config.build.rollupOptions.output['chunkFileNames'] = '[name]-[hash].mjs';
                        }
                    }
                }
                config.define = config.define || {};
                config.define = { ...processEnvDefine(), ...config.define };
                config.envPrefix = config.envPrefix || ['PRELOAD_VITE_', 'VITE_'];
                config.publicDir = config.publicDir || 'resources';
                // do not copy public dir
                config.build.copyPublicDir = false;
                // module preload polyfill does not apply to nodejs (preload scripts)
                config.build.modulePreload = false;
                // enable ssr build
                config.build.ssr = true;
                config.build.ssrEmitAssets = true;
                config.ssr = { ...config.ssr, ...{ noExternal: true } };
            }
        },
        {
            name: 'vite:electron-preload-resolved-config',
            apply: 'build',
            enforce: 'post',
            configResolved(config) {
                const build = config.build;
                if (!build.target) {
                    throw new Error('build.target option is required in the electron vite preload config.');
                }
                else {
                    const targets = Array.isArray(build.target) ? build.target : [build.target];
                    if (targets.some(t => !t.startsWith('node'))) {
                        throw new Error('The electron vite preload config build.target must be "node?".');
                    }
                }
                const libOptions = build.lib;
                const rollupOptions = build.rollupOptions;
                if (!(libOptions && libOptions.entry) && !rollupOptions?.input) {
                    throw new Error('An entry point is required in the electron vite preload config, ' +
                        'which can be specified using "build.lib.entry" or "build.rollupOptions.input".');
                }
                const resolvedOutputs = resolveBuildOutputs(rollupOptions.output, libOptions);
                if (resolvedOutputs) {
                    const outputs = Array.isArray(resolvedOutputs) ? resolvedOutputs : [resolvedOutputs];
                    if (outputs.length > 1) {
                        throw new Error('The electron vite preload config does not support multiple outputs.');
                    }
                    else {
                        const outpout = outputs[0];
                        if (['es', 'cjs'].includes(outpout.format || '')) {
                            if (outpout.format === 'es' && !supportESM()) {
                                throw new Error('The electron vite preload config output format does not support "es", ' +
                                    'you can upgrade electron to the latest version or switch to "cjs" format.');
                            }
                        }
                        else {
                            throw new Error(`The electron vite preload config output format must be "cjs"${supportESM() ? ' or "es"' : ''}.`);
                        }
                    }
                }
            }
        }
    ];
}
function electronRendererVitePlugin(options) {
    return [
        {
            name: 'vite:electron-renderer-preset-config',
            enforce: 'pre',
            config(config) {
                const root = options?.root || process.cwd();
                config.base =
                    config.mode === 'production' || process.env.NODE_ENV_ELECTRON_VITE === 'production' ? './' : config.base;
                config.root = config.root || './src/renderer';
                const chromeTarget = getElectronChromeTarget();
                const emptyOutDir = () => {
                    let outDir = config.build?.outDir;
                    if (outDir) {
                        if (!path.isAbsolute(outDir)) {
                            outDir = path.resolve(root, outDir);
                        }
                        const resolvedRoot = normalizePath(path.resolve(root));
                        return normalizePath(outDir).startsWith(resolvedRoot + '/');
                    }
                    return true;
                };
                const defaultConfig = {
                    build: {
                        outDir: path.resolve(root, 'out', 'renderer'),
                        target: chromeTarget,
                        modulePreload: { polyfill: false },
                        rollupOptions: {
                            input: findInput(root)
                        },
                        reportCompressedSize: false,
                        minify: false,
                        emptyOutDir: emptyOutDir()
                    }
                };
                if (config.build?.outDir) {
                    config.build.outDir = path.resolve(root, config.build.outDir);
                }
                const buildConfig = mergeConfig(defaultConfig.build, config.build || {});
                config.build = buildConfig;
                config.envDir = config.envDir || path.resolve(root);
                config.envPrefix = config.envPrefix || ['RENDERER_VITE_', 'VITE_'];
            }
        },
        {
            name: 'vite:electron-renderer-resolved-config',
            enforce: 'post',
            configResolved(config) {
                if (config.base !== './' && config.base !== '/') {
                    config.logger.warn(colors.yellow('(!) Should not set "base" option for the electron vite renderer config.'));
                }
                const build = config.build;
                if (!build.target) {
                    throw new Error('build.target option is required in the electron vite renderer config.');
                }
                else {
                    const targets = Array.isArray(build.target) ? build.target : [build.target];
                    if (targets.some(t => !t.startsWith('chrome') && !/^es((202\d{1})|next)$/.test(t))) {
                        config.logger.warn('The electron vite renderer config build.target is not "chrome?" or "es?". This could be a mistake.');
                    }
                }
                const rollupOptions = build.rollupOptions;
                if (!rollupOptions.input) {
                    config.logger.warn(colors.yellow(`index.html file is not found in ${colors.dim('/src/renderer')} directory.`));
                    throw new Error('build.rollupOptions.input option is required in the electron vite renderer config.');
                }
            }
        }
    ];
}

function resolveAsset(id) {
    const file = cleanUrl(id);
    const query = parseRequest(id);
    if (query && typeof query.asset === 'string') {
        return {
            type: 'asset',
            file,
            query
        };
    }
    if (file.endsWith('.node')) {
        return {
            type: 'native',
            file,
            query
        };
    }
    if (id.endsWith('.wasm?loader')) {
        return {
            type: 'wasm',
            file,
            query
        };
    }
    return null;
}
const nodeAssetRE = /__VITE_NODE_ASSET__([\w$]+)__/g;
const nodePublicAssetRE = /__VITE_NODE_PUBLIC_ASSET__([a-z\d]{8})__/g;
const wasmHelperId = '\0__electron-vite-wasm-helper';
const wasmHelperCode = `
import { join } from 'path'
import { readFile } from 'fs/promises'

export default async function loadWasm(file, importObject = {}) {
  const wasmBuffer = await readFile(join(__dirname, file))
  const result = await WebAssembly.instantiate(wasmBuffer, importObject)
  return result.instance
}
`;
function assetPlugin() {
    let sourcemap = false;
    let publicDir = '';
    let outDir = '';
    const publicAssetPathCache = new Map();
    const assetCache = new Map();
    return {
        name: 'vite:node-asset',
        apply: 'build',
        enforce: 'pre',
        buildStart() {
            publicAssetPathCache.clear();
            assetCache.clear();
        },
        configResolved(config) {
            sourcemap = config.build.sourcemap;
            publicDir = normalizePath(config.publicDir);
            outDir = normalizePath(path.resolve(config.root, config.build.outDir));
        },
        resolveId(id) {
            if (id === wasmHelperId) {
                return id;
            }
        },
        async load(id) {
            if (id === wasmHelperId) {
                return wasmHelperCode;
            }
            if (id.startsWith('\0')) {
                // Rollup convention, this id should be handled by the
                // plugin that marked it with \0
                return;
            }
            const assetResolved = resolveAsset(id);
            if (!assetResolved) {
                return;
            }
            let referenceId;
            const file = assetResolved.file;
            if (publicDir && file.startsWith(publicDir)) {
                const hash = getHash(file);
                if (!publicAssetPathCache.get(hash)) {
                    publicAssetPathCache.set(hash, file);
                }
                referenceId = `__VITE_NODE_PUBLIC_ASSET__${hash}__`;
            }
            else {
                const cached = assetCache.get(file);
                if (cached) {
                    referenceId = cached;
                }
                else {
                    const source = await fs$1.readFile(file);
                    const hash = this.emitFile({
                        type: 'asset',
                        name: path.basename(file),
                        source
                    });
                    referenceId = `__VITE_NODE_ASSET__${hash}__`;
                    assetCache.set(file, referenceId);
                }
            }
            if (assetResolved.type === 'asset') {
                if (assetResolved.query && typeof assetResolved.query.asarUnpack === 'string') {
                    return `
          import { join } from 'path'
          export default join(__dirname, ${referenceId}).replace('app.asar', 'app.asar.unpacked')`;
                }
                else {
                    return `
          import { join } from 'path'
          export default join(__dirname, ${referenceId})`;
                }
            }
            if (assetResolved.type === 'native') {
                return `export default require(${referenceId})`;
            }
            if (assetResolved.type === 'wasm') {
                return `
        import loadWasm from ${JSON.stringify(wasmHelperId)}
        export default importObject => loadWasm(${referenceId}, importObject)`;
            }
        },
        renderChunk(code, chunk) {
            let match;
            let s;
            nodeAssetRE.lastIndex = 0;
            if (code.match(nodeAssetRE)) {
                while ((match = nodeAssetRE.exec(code))) {
                    s ||= new MagicString(code);
                    const [full, hash] = match;
                    const filename = this.getFileName(hash);
                    const outputFilepath = toRelativePath(filename, chunk.fileName);
                    const replacement = JSON.stringify(outputFilepath);
                    s.overwrite(match.index, match.index + full.length, replacement, {
                        contentOnly: true
                    });
                }
            }
            nodePublicAssetRE.lastIndex = 0;
            if (code.match(nodePublicAssetRE)) {
                while ((match = nodePublicAssetRE.exec(code))) {
                    s ||= new MagicString(code);
                    const [full, hash] = match;
                    const filename = publicAssetPathCache.get(hash);
                    const outputFilepath = toRelativePath(filename, normalizePath(path.join(outDir, chunk.fileName)));
                    const replacement = JSON.stringify(outputFilepath);
                    s.overwrite(match.index, match.index + full.length, replacement, {
                        contentOnly: true
                    });
                }
            }
            if (s) {
                return {
                    code: s.toString(),
                    map: sourcemap ? s.generateMap({ hires: 'boundary' }) : null
                };
            }
            else {
                return null;
            }
        }
    };
}

const nodeWorkerAssetUrlRE = /__VITE_NODE_WORKER_ASSET__([\w$]+)__/g;
/**
 * Resolve `?nodeWorker` import and automatically generate `Worker` wrapper.
 */
function workerPlugin() {
    let sourcemap = false;
    return {
        name: 'vite:node-worker',
        apply: 'build',
        enforce: 'pre',
        configResolved(config) {
            sourcemap = config.build.sourcemap;
        },
        resolveId(id, importer) {
            const query = parseRequest(id);
            if (query && typeof query.nodeWorker === 'string') {
                return id + `&importer=${importer}`;
            }
        },
        load(id) {
            const query = parseRequest(id);
            if (query && typeof query.nodeWorker === 'string' && typeof query.importer === 'string') {
                const cleanPath = cleanUrl(id);
                const hash = this.emitFile({
                    type: 'chunk',
                    id: cleanPath,
                    importer: query.importer
                });
                const assetRefId = `__VITE_NODE_WORKER_ASSET__${hash}__`;
                return `
        import { Worker } from 'node:worker_threads';
        export default function (options) { return new Worker(new URL(${assetRefId}, import.meta.url), options); }`;
            }
        },
        renderChunk(code, chunk) {
            if (code.match(nodeWorkerAssetUrlRE)) {
                let match;
                const s = new MagicString(code);
                while ((match = nodeWorkerAssetUrlRE.exec(code))) {
                    const [full, hash] = match;
                    const filename = this.getFileName(hash);
                    const outputFilepath = toRelativePath(filename, chunk.fileName);
                    const replacement = JSON.stringify(outputFilepath);
                    s.overwrite(match.index, match.index + full.length, replacement, {
                        contentOnly: true
                    });
                }
                return {
                    code: s.toString(),
                    map: sourcemap ? s.generateMap({ hires: 'boundary' }) : null
                };
            }
            return null;
        }
    };
}

function importMetaPlugin() {
    return {
        name: 'vite:import-meta',
        apply: 'build',
        enforce: 'pre',
        resolveImportMeta(property, { format }) {
            if (property === 'url' && format === 'cjs') {
                return `require("url").pathToFileURL(__filename).href`;
            }
            if (property === 'filename' && format === 'cjs') {
                return `__filename`;
            }
            if (property === 'dirname' && format === 'cjs') {
                return `__dirname`;
            }
            return null;
        }
    };
}

/*
 * The core of this plugin was conceived by pi0 and is taken from the following repository:
 * https://github.com/unjs/unbuild/blob/main/src/builder/plugins/cjs.ts
 * license: https://github.com/unjs/unbuild/blob/main/LICENSE
 */
const CJSyntaxRe = /__filename|__dirname|require\(|require\.resolve\(/;
const CJSShim_normal = `
// -- CommonJS Shims --
import __cjs_url__ from 'node:url';
import __cjs_path__ from 'node:path';
import __cjs_mod__ from 'node:module';
const __filename = __cjs_url__.fileURLToPath(import.meta.url);
const __dirname = __cjs_path__.dirname(__filename);
const require = __cjs_mod__.createRequire(import.meta.url);
`;
const CJSShim_node_20_11 = `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`;
const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\s'](?=\s*'))\s*["'][\s;]*/gmu;
function findStaticImports(code) {
    const matches = [];
    for (const match of code.matchAll(ESMStaticImportRe)) {
        matches.push({ end: (match.index || 0) + match[0].length });
    }
    return matches;
}
function esmShimPlugin() {
    let sourcemap = false;
    const CJSShim = getElectronMajorVersion() >= 30 ? CJSShim_node_20_11 : CJSShim_normal;
    return {
        name: 'vite:esm-shim',
        apply: 'build',
        enforce: 'post',
        configResolved(config) {
            sourcemap = config.build.sourcemap;
        },
        renderChunk(code, _chunk, options) {
            if (options.format === 'es') {
                if (code.includes(CJSShim) || !CJSyntaxRe.test(code)) {
                    return null;
                }
                const lastESMImport = findStaticImports(code).pop();
                const indexToAppend = lastESMImport ? lastESMImport.end : 0;
                const s = new MagicString(code);
                s.appendRight(indexToAppend, CJSShim);
                return {
                    code: s.toString(),
                    map: sourcemap ? s.generateMap({ hires: 'boundary' }) : null
                };
            }
            return null;
        }
    };
}

const modulePathRE = /__VITE_MODULE_PATH__([\w$]+)__/g;
/**
 * Resolve `?modulePath` import and return the module bundle path.
 */
function modulePathPlugin() {
    let sourcemap = false;
    return {
        name: 'vite:module-path',
        apply: 'build',
        enforce: 'pre',
        configResolved(config) {
            sourcemap = config.build.sourcemap;
        },
        resolveId(id, importer) {
            const query = parseRequest(id);
            if (query && typeof query.modulePath === 'string') {
                return id + `&importer=${importer}`;
            }
        },
        load(id) {
            const query = parseRequest(id);
            if (query && typeof query.modulePath === 'string' && typeof query.importer === 'string') {
                const cleanPath = cleanUrl(id);
                const hash = this.emitFile({
                    type: 'chunk',
                    id: cleanPath,
                    importer: query.importer
                });
                const refId = `__VITE_MODULE_PATH__${hash}__`;
                return `
        import { join } from 'path'
        export default join(__dirname, ${refId})`;
            }
        },
        renderChunk(code, chunk) {
            if (code.match(modulePathRE)) {
                let match;
                const s = new MagicString(code);
                while ((match = modulePathRE.exec(code))) {
                    const [full, hash] = match;
                    const filename = this.getFileName(hash);
                    const outputFilepath = toRelativePath(filename, chunk.fileName);
                    const replacement = JSON.stringify(outputFilepath);
                    s.overwrite(match.index, match.index + full.length, replacement, {
                        contentOnly: true
                    });
                }
                return {
                    code: s.toString(),
                    map: sourcemap ? s.generateMap({ hires: 'boundary' }) : null
                };
            }
            return null;
        }
    };
}

function defineConfig(config) {
    return config;
}
async function resolveConfig(inlineConfig, command, defaultMode = 'development') {
    const config = inlineConfig;
    const mode = inlineConfig.mode || defaultMode;
    process.env.NODE_ENV = defaultMode;
    let userConfig;
    let configFileDependencies = [];
    let { configFile } = config;
    if (configFile !== false) {
        const configEnv = {
            mode,
            command
        };
        const loadResult = await loadConfigFromFile(configEnv, configFile, config.root, config.logLevel, config.ignoreConfigWarning);
        if (loadResult) {
            const root = config.root;
            delete config.root;
            delete config.configFile;
            const outDir = config.build?.outDir;
            if (loadResult.config.main) {
                const mainViteConfig = mergeConfig(loadResult.config.main, deepClone(config));
                mainViteConfig.mode = inlineConfig.mode || mainViteConfig.mode || defaultMode;
                if (outDir) {
                    resetOutDir(mainViteConfig, outDir, 'main');
                }
                mergePlugins(mainViteConfig, [
                    ...electronMainVitePlugin({ root }),
                    assetPlugin(),
                    workerPlugin(),
                    modulePathPlugin(),
                    importMetaPlugin(),
                    esmShimPlugin()
                ]);
                loadResult.config.main = mainViteConfig;
                loadResult.config.main.configFile = false;
            }
            if (loadResult.config.preload) {
                const preloadViteConfig = mergeConfig(loadResult.config.preload, deepClone(config));
                preloadViteConfig.mode = inlineConfig.mode || preloadViteConfig.mode || defaultMode;
                if (outDir) {
                    resetOutDir(preloadViteConfig, outDir, 'preload');
                }
                mergePlugins(preloadViteConfig, [
                    ...electronPreloadVitePlugin({ root }),
                    assetPlugin(),
                    importMetaPlugin(),
                    esmShimPlugin()
                ]);
                loadResult.config.preload = preloadViteConfig;
                loadResult.config.preload.configFile = false;
            }
            if (loadResult.config.renderer) {
                const rendererViteConfig = mergeConfig(loadResult.config.renderer, deepClone(config));
                rendererViteConfig.mode = inlineConfig.mode || rendererViteConfig.mode || defaultMode;
                if (outDir) {
                    resetOutDir(rendererViteConfig, outDir, 'renderer');
                }
                mergePlugins(rendererViteConfig, electronRendererVitePlugin({ root }));
                loadResult.config.renderer = rendererViteConfig;
                loadResult.config.renderer.configFile = false;
            }
            userConfig = loadResult.config;
            configFile = loadResult.path;
            configFileDependencies = loadResult.dependencies;
        }
    }
    const resolved = {
        config: userConfig,
        configFile: configFile ? normalizePath(configFile) : undefined,
        configFileDependencies
    };
    return resolved;
}
function deepClone(data) {
    return JSON.parse(JSON.stringify(data));
}
function resetOutDir(config, outDir, subOutDir) {
    let userOutDir = config.build?.outDir;
    if (outDir === userOutDir) {
        userOutDir = path.resolve(config.root || process.cwd(), outDir, subOutDir);
        if (config.build) {
            config.build.outDir = userOutDir;
        }
        else {
            config.build = { outDir: userOutDir };
        }
    }
}
function mergePlugins(config, plugins) {
    const userPlugins = config.plugins || [];
    config.plugins = userPlugins.concat(plugins);
}
const CONFIG_FILE_NAME = 'electron.vite.config';
async function loadConfigFromFile(configEnv, configFile, configRoot = process.cwd(), logLevel, ignoreConfigWarning = false) {
    if (configFile && /^vite.config.(js|ts|mjs|cjs|mts|cts)$/.test(configFile)) {
        throw new Error(`config file cannot be named ${configFile}.`);
    }
    const resolvedPath = configFile
        ? path.resolve(configFile)
        : findConfigFile(configRoot, ['js', 'ts', 'mjs', 'cjs', 'mts', 'cts']);
    if (!resolvedPath) {
        return {
            path: '',
            config: { main: {}, preload: {}, renderer: {} },
            dependencies: []
        };
    }
    const isESM = isFilePathESM(resolvedPath);
    try {
        const bundled = await bundleConfigFile(resolvedPath, isESM);
        const userConfig = await loadConfigFormBundledFile(configRoot, resolvedPath, bundled.code, isESM);
        const config = await (typeof userConfig === 'function' ? userConfig(configEnv) : userConfig);
        if (!isObject(config)) {
            throw new Error(`config must export or return an object`);
        }
        const configRequired = [];
        let mainConfig;
        if (config.main) {
            const mainViteConfig = config.main;
            mainConfig = await (typeof mainViteConfig === 'function' ? mainViteConfig(configEnv) : mainViteConfig);
            if (!isObject(mainConfig)) {
                throw new Error(`main config must export or return an object`);
            }
        }
        else {
            configRequired.push('main');
        }
        let rendererConfig;
        if (config.renderer) {
            const rendererViteConfig = config.renderer;
            rendererConfig = await (typeof rendererViteConfig === 'function'
                ? rendererViteConfig(configEnv)
                : rendererViteConfig);
            if (!isObject(rendererConfig)) {
                throw new Error(`renderer config must export or return an object`);
            }
        }
        else {
            configRequired.push('renderer');
        }
        let preloadConfig;
        if (config.preload) {
            const preloadViteConfig = config.preload;
            preloadConfig = await (typeof preloadViteConfig === 'function' ? preloadViteConfig(configEnv) : preloadViteConfig);
            if (!isObject(preloadConfig)) {
                throw new Error(`preload config must export or return an object`);
            }
        }
        else {
            configRequired.push('preload');
        }
        if (!ignoreConfigWarning && configRequired.length > 0) {
            createLogger(logLevel).warn(colors.yellow(`${configRequired.join(' and ')} config is missing`));
        }
        return {
            path: normalizePath(resolvedPath),
            config: {
                main: mainConfig,
                renderer: rendererConfig,
                preload: preloadConfig
            },
            dependencies: bundled.dependencies
        };
    }
    catch (e) {
        createLogger(logLevel).error(colors.red(`failed to load config from ${resolvedPath}`), { error: e });
        throw e;
    }
}
function findConfigFile(configRoot, extensions) {
    for (const ext of extensions) {
        const configFile = path.resolve(configRoot, `${CONFIG_FILE_NAME}.${ext}`);
        if (fs.existsSync(configFile)) {
            return configFile;
        }
    }
    return '';
}
async function bundleConfigFile(fileName, isESM) {
    const dirnameVarName = '__electron_vite_injected_dirname';
    const filenameVarName = '__electron_vite_injected_filename';
    const importMetaUrlVarName = '__electron_vite_injected_import_meta_url';
    const result = await build({
        absWorkingDir: process.cwd(),
        entryPoints: [fileName],
        write: false,
        target: ['node18'],
        platform: 'node',
        bundle: true,
        format: isESM ? 'esm' : 'cjs',
        sourcemap: false,
        metafile: true,
        define: {
            __dirname: dirnameVarName,
            __filename: filenameVarName,
            'import.meta.url': importMetaUrlVarName
        },
        plugins: [
            {
                name: 'externalize-deps',
                setup(build) {
                    build.onResolve({ filter: /.*/ }, args => {
                        const id = args.path;
                        if (id[0] !== '.' && !path.isAbsolute(id)) {
                            return {
                                external: true
                            };
                        }
                        return null;
                    });
                }
            },
            {
                name: 'replace-import-meta',
                setup(build) {
                    build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
                        const contents = await fs.promises.readFile(args.path, 'utf8');
                        const injectValues = `const ${dirnameVarName} = ${JSON.stringify(path.dirname(args.path))};` +
                            `const ${filenameVarName} = ${JSON.stringify(args.path)};` +
                            `const ${importMetaUrlVarName} = ${JSON.stringify(pathToFileURL(args.path).href)};`;
                        return {
                            loader: args.path.endsWith('ts') ? 'ts' : 'js',
                            contents: injectValues + contents
                        };
                    });
                }
            }
        ]
    });
    const { text } = result.outputFiles[0];
    return {
        code: text,
        dependencies: result.metafile ? Object.keys(result.metafile.inputs) : []
    };
}
const _require = createRequire(import.meta.url);
async function loadConfigFormBundledFile(configRoot, configFile, bundledCode, isESM) {
    if (isESM) {
        const fileNameTmp = path.resolve(configRoot, `${CONFIG_FILE_NAME}.${Date.now()}.mjs`);
        fs.writeFileSync(fileNameTmp, bundledCode);
        const fileUrl = pathToFileURL(fileNameTmp);
        try {
            return (await import(fileUrl.href)).default;
        }
        finally {
            try {
                fs.unlinkSync(fileNameTmp);
            }
            catch { }
        }
    }
    else {
        const extension = path.extname(configFile);
        const realFileName = fs.realpathSync(configFile);
        const loaderExt = extension in _require.extensions ? extension : '.js';
        const defaultLoader = _require.extensions[loaderExt];
        _require.extensions[loaderExt] = (module, filename) => {
            if (filename === realFileName) {
                module._compile(bundledCode, filename);
            }
            else {
                defaultLoader(module, filename);
            }
        };
        delete _require.cache[_require.resolve(configFile)];
        const raw = _require(configFile);
        _require.extensions[loaderExt] = defaultLoader;
        return raw.__esModule ? raw.default : raw;
    }
}

export { loadEnv as a, loadConfigFromFile as b, resolveHostname as c, defineConfig as d, getElectronPath as g, loadPackageData as l, resolveConfig as r, startElectron as s, toRelativePath as t };

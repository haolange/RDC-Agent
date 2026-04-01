import { createFilter, normalizePath, mergeConfig } from 'vite';
export { createLogger, defineConfig as defineViteConfig, mergeConfig, splitVendorChunk, splitVendorChunkPlugin } from 'vite';
import { g as getElectronPath, t as toRelativePath, l as loadPackageData } from './chunks/lib-BmEkZIgk.mjs';
export { d as defineConfig, b as loadConfigFromFile, a as loadEnv, r as resolveConfig } from './chunks/lib-BmEkZIgk.mjs';
export { createServer } from './chunks/lib-t2ExBjL5.mjs';
export { build } from './chunks/lib-D1n7TA6K.mjs';
export { preview } from './chunks/lib-AgEz08--.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import colors from 'picocolors';
import * as babel from '@babel/core';
import MagicString from 'magic-string';
import 'node:url';
import 'esbuild';
import 'node:crypto';
import 'node:fs/promises';

// Inspired by https://github.com/bytenode/bytenode
const _require = createRequire(import.meta.url);
function getBytecodeCompilerPath() {
    return path.join(path.dirname(_require.resolve('electron-vite/package.json')), 'bin', 'electron-bytecode.cjs');
}
function compileToBytecode(code) {
    return new Promise((resolve, reject) => {
        let data = Buffer.from([]);
        const electronPath = getElectronPath();
        const bytecodePath = getBytecodeCompilerPath();
        const proc = spawn(electronPath, [bytecodePath], {
            env: { ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });
        if (proc.stdin) {
            proc.stdin.write(code);
            proc.stdin.end();
        }
        if (proc.stdout) {
            proc.stdout.on('data', chunk => {
                data = Buffer.concat([data, chunk]);
            });
            proc.stdout.on('error', err => {
                console.error(err);
            });
            proc.stdout.on('end', () => {
                resolve(data);
            });
        }
        if (proc.stderr) {
            proc.stderr.on('data', chunk => {
                console.error('Error: ', chunk.toString());
            });
            proc.stderr.on('error', err => {
                console.error('Error: ', err);
            });
        }
        proc.addListener('message', message => console.log(message));
        proc.addListener('error', err => console.error(err));
        proc.on('error', err => reject(err));
        proc.on('exit', () => {
            resolve(data);
        });
    });
}
const bytecodeModuleLoaderCode = [
    `"use strict";`,
    `const fs = require("fs");`,
    `const path = require("path");`,
    `const vm = require("vm");`,
    `const v8 = require("v8");`,
    `const Module = require("module");`,
    `v8.setFlagsFromString("--no-lazy");`,
    `v8.setFlagsFromString("--no-flush-bytecode");`,
    `const FLAG_HASH_OFFSET = 12;`,
    `const SOURCE_HASH_OFFSET = 8;`,
    `let dummyBytecode;`,
    `function setFlagHashHeader(bytecodeBuffer) {`,
    `  if (!dummyBytecode) {`,
    `    const script = new vm.Script("", {`,
    `      produceCachedData: true`,
    `    });`,
    `    dummyBytecode = script.createCachedData();`,
    `  }`,
    `  dummyBytecode.slice(FLAG_HASH_OFFSET, FLAG_HASH_OFFSET + 4).copy(bytecodeBuffer, FLAG_HASH_OFFSET);`,
    `};`,
    `function getSourceHashHeader(bytecodeBuffer) {`,
    `  return bytecodeBuffer.slice(SOURCE_HASH_OFFSET, SOURCE_HASH_OFFSET + 4);`,
    `};`,
    `function buffer2Number(buffer) {`,
    `  let ret = 0;`,
    `  ret |= buffer[3] << 24;`,
    `  ret |= buffer[2] << 16;`,
    `  ret |= buffer[1] << 8;`,
    `  ret |= buffer[0];`,
    `  return ret;`,
    `};`,
    `Module._extensions[".jsc"] = Module._extensions[".cjsc"] = function (module, filename) {`,
    `  const bytecodeBuffer = fs.readFileSync(filename);`,
    `  if (!Buffer.isBuffer(bytecodeBuffer)) {`,
    `    throw new Error("BytecodeBuffer must be a buffer object.");`,
    `  }`,
    `  setFlagHashHeader(bytecodeBuffer);`,
    `  const length = buffer2Number(getSourceHashHeader(bytecodeBuffer));`,
    `  let dummyCode = "";`,
    `  if (length > 1) {`,
    `    dummyCode = "\\"" + "\\u200b".repeat(length - 2) + "\\"";`,
    `  }`,
    `  const script = new vm.Script(dummyCode, {`,
    `    filename: filename,`,
    `    lineOffset: 0,`,
    `    displayErrors: true,`,
    `    cachedData: bytecodeBuffer`,
    `  });`,
    `  if (script.cachedDataRejected) {`,
    `    throw new Error("Invalid or incompatible cached data (cachedDataRejected)");`,
    `  }`,
    `  const require = function (id) {`,
    `    return module.require(id);`,
    `  };`,
    `  require.resolve = function (request, options) {`,
    `    return Module._resolveFilename(request, module, false, options);`,
    `  };`,
    `  if (process.mainModule) {`,
    `    require.main = process.mainModule;`,
    `  }`,
    `  require.extensions = Module._extensions;`,
    `  require.cache = Module._cache;`,
    `  const compiledWrapper = script.runInThisContext({`,
    `    filename: filename,`,
    `    lineOffset: 0,`,
    `    columnOffset: 0,`,
    `    displayErrors: true`,
    `  });`,
    `  const dirname = path.dirname(filename);`,
    `  const args = [module.exports, require, module, filename, dirname, process, global];`,
    `  return compiledWrapper.apply(module.exports, args);`,
    `};`
];
/**
 * Compile to v8 bytecode to protect source code.
 */
function bytecodePlugin(options = {}) {
    if (process.env.NODE_ENV_ELECTRON_VITE !== 'production') {
        return null;
    }
    const { chunkAlias = [], transformArrowFunctions = true, removeBundleJS = true, protectedStrings = [] } = options;
    const _chunkAlias = Array.isArray(chunkAlias) ? chunkAlias : [chunkAlias];
    const filter = createFilter(/\.(m?[jt]s|[jt]sx)$/);
    const escapeRegExpString = (str) => {
        return str
            .replace(/\\/g, '\\\\\\\\')
            .replace(/[|{}()[\]^$+*?.]/g, '\\$&')
            .replace(/-/g, '\\u002d');
    };
    const transformAllChunks = _chunkAlias.length === 0;
    const isBytecodeChunk = (chunkName) => {
        return transformAllChunks || _chunkAlias.some(alias => alias === chunkName);
    };
    const _transform = (code) => {
        const re = babel.transform(code, {
            plugins: ['@babel/plugin-transform-arrow-functions']
        });
        return re.code || '';
    };
    const useStrict = '"use strict";';
    const bytecodeModuleLoader = 'bytecode-loader.cjs';
    let config;
    let useInRenderer = false;
    let bytecodeRequired = false;
    let bytecodeFiles = [];
    return {
        name: 'vite:bytecode',
        apply: 'build',
        enforce: 'post',
        configResolved(resolvedConfig) {
            config = resolvedConfig;
            useInRenderer = config.plugins.some(p => p.name === 'vite:electron-renderer-preset-config');
            if (useInRenderer) {
                config.logger.warn(colors.yellow('bytecodePlugin does not support renderer.'));
            }
            if (resolvedConfig.build.minify && protectedStrings.length > 0) {
                config.logger.warn(colors.yellow('Strings cannot be protected when minification is enabled.'));
            }
        },
        transform(code, id) {
            if (config.build.minify || protectedStrings.length === 0 || !filter(id))
                return;
            let match;
            let s;
            protectedStrings.forEach(str => {
                const escapedStr = escapeRegExpString(str);
                const re = new RegExp(`\\u0027${escapedStr}\\u0027|\\u0022${escapedStr}\\u0022`, 'g');
                const charCodes = Array.from(str).map(s => s.charCodeAt(0));
                const replacement = `String.fromCharCode(${charCodes.toString()})`;
                while ((match = re.exec(code))) {
                    s ||= new MagicString(code);
                    const [full] = match;
                    s.overwrite(match.index, match.index + full.length, replacement, {
                        contentOnly: true
                    });
                }
            });
            if (s) {
                return {
                    code: s.toString(),
                    map: config.build.sourcemap ? s.generateMap({ hires: 'boundary' }) : null
                };
            }
        },
        renderChunk(code, chunk, options) {
            if (options.format === 'es') {
                config.logger.warn(colors.yellow('bytecodePlugin does not support ES module, please remove "type": "module" ' +
                    'in package.json or set the "build.rollupOptions.output.format" option to "cjs".'));
                return null;
            }
            if (useInRenderer) {
                return null;
            }
            if (chunk.type === 'chunk' && isBytecodeChunk(chunk.name)) {
                bytecodeRequired = true;
                if (transformArrowFunctions) {
                    return {
                        code: _transform(code)
                    };
                }
            }
            return null;
        },
        generateBundle(options) {
            if (options.format !== 'es' && !useInRenderer && bytecodeRequired) {
                this.emitFile({
                    type: 'asset',
                    source: bytecodeModuleLoaderCode.join('\n') + '\n',
                    name: 'Bytecode Loader File',
                    fileName: bytecodeModuleLoader
                });
            }
        },
        async writeBundle(options, output) {
            if (options.format === 'es' || useInRenderer || !bytecodeRequired) {
                return;
            }
            const outDir = options.dir;
            bytecodeFiles = [];
            const bundles = Object.keys(output);
            const chunks = Object.values(output).filter(chunk => chunk.type === 'chunk' && isBytecodeChunk(chunk.name) && chunk.fileName !== bytecodeModuleLoader);
            const bytecodeChunks = chunks.map(chunk => chunk.fileName);
            const nonEntryChunks = chunks.filter(chunk => !chunk.isEntry).map(chunk => path.basename(chunk.fileName));
            const pattern = nonEntryChunks.map(chunk => `(${chunk})`).join('|');
            const bytecodeRE = pattern ? new RegExp(`require\\(\\S*(?=(${pattern})\\S*\\))`, 'g') : null;
            const keepBundle = (chunkFileName) => {
                const newFileName = path.resolve(path.dirname(chunkFileName), `_${path.basename(chunkFileName)}`);
                fs.renameSync(chunkFileName, newFileName);
            };
            const getBytecodeLoaderBlock = (chunkFileName) => {
                return `require("${toRelativePath(bytecodeModuleLoader, normalizePath(chunkFileName))}");`;
            };
            await Promise.all(bundles.map(async (name) => {
                const chunk = output[name];
                if (chunk.type === 'chunk') {
                    let _code = chunk.code;
                    if (bytecodeRE && _code.match(bytecodeRE)) {
                        let match;
                        const s = new MagicString(_code);
                        while ((match = bytecodeRE.exec(_code))) {
                            const [prefix, chunkName] = match;
                            const len = prefix.length + chunkName.length;
                            s.overwrite(match.index, match.index + len, prefix + chunkName + 'c', {
                                contentOnly: true
                            });
                        }
                        _code = s.toString();
                    }
                    const chunkFileName = path.resolve(outDir, name);
                    if (bytecodeChunks.includes(name)) {
                        const bytecodeBuffer = await compileToBytecode(_code);
                        fs.writeFileSync(path.resolve(outDir, name + 'c'), bytecodeBuffer);
                        if (chunk.isEntry) {
                            if (!removeBundleJS) {
                                keepBundle(chunkFileName);
                            }
                            const bytecodeLoaderBlock = getBytecodeLoaderBlock(chunk.fileName);
                            const bytecodeModuleBlock = `require("./${path.basename(name) + 'c'}");`;
                            const code = `${useStrict}\n${bytecodeLoaderBlock}\n${bytecodeModuleBlock}\n`;
                            fs.writeFileSync(chunkFileName, code);
                        }
                        else {
                            if (removeBundleJS) {
                                fs.unlinkSync(chunkFileName);
                            }
                            else {
                                keepBundle(chunkFileName);
                            }
                        }
                        bytecodeFiles.push({ name: name + 'c', size: bytecodeBuffer.length });
                    }
                    else {
                        if (chunk.isEntry) {
                            let hasBytecodeMoudle = false;
                            const idsToHandle = new Set([...chunk.imports, ...chunk.dynamicImports]);
                            for (const moduleId of idsToHandle) {
                                if (bytecodeChunks.includes(moduleId)) {
                                    hasBytecodeMoudle = true;
                                    break;
                                }
                                const moduleInfo = this.getModuleInfo(moduleId);
                                if (moduleInfo && !moduleInfo.isExternal) {
                                    const { importers, dynamicImporters } = moduleInfo;
                                    for (const importerId of importers)
                                        idsToHandle.add(importerId);
                                    for (const importerId of dynamicImporters)
                                        idsToHandle.add(importerId);
                                }
                            }
                            const bytecodeLoaderBlock = getBytecodeLoaderBlock(chunk.fileName);
                            _code = hasBytecodeMoudle ? _code.replace(useStrict, `${useStrict}\n${bytecodeLoaderBlock}`) : _code;
                        }
                        fs.writeFileSync(chunkFileName, _code);
                    }
                }
            }));
        },
        closeBundle() {
            if (!useInRenderer) {
                const chunkLimit = config.build.chunkSizeWarningLimit;
                const outDir = normalizePath(path.relative(config.root, path.resolve(config.root, config.build.outDir))) + '/';
                config.logger.info(`${colors.green(`✓`)} ${bytecodeFiles.length} bundles compiled into bytecode.`);
                let longest = 0;
                bytecodeFiles.forEach(file => {
                    const len = file.name.length;
                    if (len > longest)
                        longest = len;
                });
                bytecodeFiles.forEach(file => {
                    const kbs = file.size / 1000;
                    config.logger.info(`${colors.gray(colors.white(colors.dim(outDir)))}${colors.green(file.name.padEnd(longest + 2))} ${kbs > chunkLimit ? colors.yellow(`${kbs.toFixed(2)} kB`) : colors.dim(`${kbs.toFixed(2)} kB`)}`);
                });
                bytecodeFiles = [];
            }
        }
    };
}

/**
 * Automatically externalize dependencies
 */
function externalizeDepsPlugin(options = {}) {
    const { exclude = [], include = [] } = options;
    const pkg = loadPackageData() || {};
    let deps = Object.keys(pkg.dependencies || {});
    if (include.length) {
        deps = deps.concat(include.filter(dep => dep.trim() !== ''));
    }
    if (exclude.length) {
        deps = deps.filter(dep => !exclude.includes(dep));
    }
    deps = [...new Set(deps)];
    return {
        name: 'vite:externalize-deps',
        enforce: 'pre',
        config(config) {
            const defaultConfig = {
                build: {
                    rollupOptions: {
                        external: deps.length > 0 ? [...deps, new RegExp(`^(${deps.join('|')})/.+`)] : []
                    }
                }
            };
            const buildConfig = mergeConfig(defaultConfig.build, config.build || {});
            config.build = buildConfig;
        }
    };
}

async function transformWithSWC(code, id, options) {
    const { sourcemap = false, minify = false } = options;
    delete options.sourcemap;
    delete options.minify;
    const isTs = /\.tsx?$/.test(id);
    const require = createRequire(import.meta.url);
    let swc;
    try {
        swc = require('@swc/core');
    }
    catch {
        throw new Error('swc plugin require @swc/core, you need to install it.');
    }
    const jsc = {
        parser: {
            syntax: isTs ? 'typescript' : 'ecmascript',
            decorators: true
        },
        transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
            ...options
        },
        keepClassNames: true,
        target: 'es2022',
        minify: {
            format: {
                comments: false
            }
        }
    };
    const result = await swc.transform(code, {
        jsc,
        sourceMaps: sourcemap,
        minify,
        configFile: false,
        swcrc: false
    });
    const map = sourcemap && result.map ? JSON.parse(result.map) : { mappings: '' };
    return {
        code: result.code,
        map
    };
}
/**
 * Use SWC to support for emitting type metadata for decorators.
 * When using `swcPlugin`, you need to install `@swc/core`.
 */
function swcPlugin(options = {}) {
    const filter = createFilter(options.include || /\.(m?ts|[jt]sx)$/, options.exclude || /\.js$/);
    let sourcemap = false;
    let minify = false;
    return {
        name: 'vite:swc',
        config() {
            return {
                esbuild: false
            };
        },
        async configResolved(resolvedConfig) {
            sourcemap = resolvedConfig.build?.sourcemap === 'inline' ? 'inline' : !!resolvedConfig.build?.sourcemap;
            minify = resolvedConfig.build?.minify;
        },
        async transform(code, id) {
            if (filter(id)) {
                const result = await transformWithSWC(code, id, { sourcemap, ...(options.transformOptions || {}) });
                return {
                    code: result.code,
                    map: result.map
                };
            }
        },
        async renderChunk(code, chunk) {
            if (!minify || minify === 'terser') {
                return null;
            }
            const result = await transformWithSWC(code, chunk.fileName, {
                sourcemap,
                minify: true,
                ...(options.transformOptions || {})
            });
            return {
                code: result.code,
                map: result.map
            };
        }
    };
}

export { bytecodePlugin, externalizeDepsPlugin, swcPlugin };

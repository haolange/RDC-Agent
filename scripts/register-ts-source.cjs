const fs = require('fs');
const Module = require('module');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const originalResolveFilename = Module._resolveFilename;

function resolveSourcePath(request, parent) {
  if (request.startsWith('@shared/')) {
    return resolveFile(path.join(repoRoot, 'src', 'shared', request.slice('@shared/'.length)));
  }

  if (request === '@shared') {
    return resolveFile(path.join(repoRoot, 'src', 'shared'));
  }

  if (request.startsWith('.') && parent?.filename) {
    return resolveFile(path.resolve(path.dirname(parent.filename), request));
  }

  return null;
}

function resolveFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  const sourcePath = resolveSourcePath(request, parent);
  if (sourcePath) {
    return sourcePath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2020,
    },
  });
  module._compile(compiled.outputText, filename);
}

require.extensions['.ts'] = compileTypeScript;
require.extensions['.tsx'] = compileTypeScript;


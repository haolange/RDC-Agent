import type { LanguageFn } from 'highlight.js';

const KEYWORDS = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'discard', 'struct',
  'cbuffer', 'tbuffer', 'namespace', 'typedef', 'static', 'const', 'uniform', 'extern', 'inline', 'in', 'out', 'inout',
  'groupshared', 'precise', 'shared', 'volatile', 'nointerpolation', 'linear', 'centroid', 'noperspective', 'sample',
  'row_major', 'column_major', 'register', 'packoffset', 'technique', 'pass', 'template', 'typename',
];

const SCALARS = ['void', 'bool', 'int', 'uint', 'dword', 'half', 'float', 'double', 'min16float', 'min10float', 'min16int', 'min12int', 'min16uint', 'int64_t', 'uint64_t', 'float16_t'];
const VECTOR_BASES = ['bool', 'int', 'uint', 'half', 'float', 'double', 'min16float', 'min16int', 'min16uint'];
const RESOURCES = [
  'matrix', 'vector', 'Texture1D', 'Texture1DArray', 'Texture2D', 'Texture2DArray', 'Texture2DMS', 'Texture2DMSArray',
  'Texture3D', 'TextureCube', 'TextureCubeArray', 'RWTexture1D', 'RWTexture1DArray', 'RWTexture2D', 'RWTexture2DArray',
  'RWTexture3D', 'Buffer', 'RWBuffer', 'StructuredBuffer', 'RWStructuredBuffer', 'ByteAddressBuffer',
  'RWByteAddressBuffer', 'AppendStructuredBuffer', 'ConsumeStructuredBuffer', 'ConstantBuffer', 'SamplerState',
  'SamplerComparisonState', 'RaytracingAccelerationStructure',
];

const BUILT_INS = [
  'abs', 'acos', 'all', 'any', 'asfloat', 'asint', 'asuint', 'atan', 'atan2', 'ceil', 'clamp', 'clip', 'cos', 'cross',
  'ddx', 'ddy', 'ddx_fine', 'ddy_fine', 'degrees', 'determinant', 'distance', 'dot', 'exp', 'exp2', 'faceforward',
  'f16tof32', 'f32tof16', 'floor', 'fmod', 'frac', 'frexp', 'fwidth', 'isinf', 'isnan', 'ldexp', 'length', 'lerp', 'log',
  'log2', 'mad', 'max', 'min', 'modf', 'mul', 'normalize', 'pow', 'radians', 'rcp', 'reflect', 'refract', 'reversebits',
  'round', 'rsqrt', 'saturate', 'sign', 'sin', 'sincos', 'smoothstep', 'sqrt', 'step', 'tan', 'transpose', 'trunc',
  'Sample', 'SampleLevel', 'SampleGrad', 'SampleBias', 'SampleCmp', 'SampleCmpLevelZero', 'Load', 'Store', 'Gather',
  'GatherRed', 'GatherGreen', 'GatherBlue', 'GatherAlpha', 'GetDimensions', 'InterlockedAdd', 'InterlockedMin',
  'InterlockedMax', 'InterlockedOr', 'InterlockedAnd', 'InterlockedXor', 'InterlockedExchange',
  'InterlockedCompareExchange', 'GroupMemoryBarrier', 'GroupMemoryBarrierWithGroupSync', 'DeviceMemoryBarrier',
  'AllMemoryBarrier', 'AllMemoryBarrierWithGroupSync', 'WaveGetLaneIndex', 'WaveGetLaneCount', 'WaveIsFirstLane',
  'WaveActiveSum', 'WaveActiveProduct', 'WaveActiveMin', 'WaveActiveMax', 'WaveActiveBallot', 'WaveActiveCountBits',
  'WaveReadLaneAt', 'WaveReadLaneFirst', 'WavePrefixSum', 'WavePrefixCountBits', 'QuadReadAcrossX', 'QuadReadAcrossY',
];

const vectorTypes = VECTOR_BASES.flatMap((base) => [1, 2, 3, 4].flatMap((rows) => [
  `${base}${rows}`,
  ...[1, 2, 3, 4].map((columns) => `${base}${rows}x${columns}`),
]));

/** HLSL for shader snippets in answers: keywords, scalar/vector/matrix and resource types, intrinsics, semantics, attributes. */
export const hlsl: LanguageFn = (hljs) => ({
  name: 'HLSL',
  aliases: ['fx', 'fxh', 'hlsli'],
  keywords: {
    keyword: KEYWORDS,
    type: [...SCALARS, ...vectorTypes, ...RESOURCES],
    literal: ['true', 'false'],
    built_in: BUILT_INS,
  },
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.C_NUMBER_MODE,
    hljs.QUOTE_STRING_MODE,
    { scope: 'meta', begin: /^\s*#\s*[a-z]+/, end: /$/ },
    { scope: 'meta', begin: /\[(?=\s*(?:numthreads|unroll|loop|branch|flatten|earlydepthstencil|RootSignature|shader|outputtopology|domain|partitioning|maxvertexcount)\b)/, end: /\]/ },
    { scope: 'symbol', match: /\b(?:SV_[A-Za-z]+\d*|TEXCOORD\d*|POSITION\d*|NORMAL\d*|COLOR\d*|TANGENT\d*|BINORMAL\d*|BLENDWEIGHT\d*|BLENDINDICES\d*)\b/ },
  ],
});

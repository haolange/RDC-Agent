/**
 * Host identification. This is the only module in src/main that reads
 * process.platform or process.arch; every host-specific decision takes a
 * HostDescriptor from here. Tests inject another host with describeHost().
 */

/** Runtime target in the RDC-Tool naming, for example `windows-x64` or `linux-x64`. */
export type HostTarget = 'windows-x64' | 'linux-x64' | (string & {});

export interface HostDescriptor {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly target: HostTarget;
  readonly isWindows: boolean;
  readonly isLinux: boolean;
  readonly isMac: boolean;
}

const ARCH_NAMES: Readonly<Record<string, string>> = { x64: 'x64', arm64: 'arm64', ia32: 'x86' };

export function describeHost(platform: NodeJS.Platform, arch: string): HostDescriptor {
  const system = platform === 'win32' ? 'windows' : platform;
  return Object.freeze({
    platform,
    arch,
    target: `${system}-${ARCH_NAMES[arch] ?? arch}`,
    isWindows: platform === 'win32',
    isLinux: platform === 'linux',
    isMac: platform === 'darwin',
  });
}

const RUNNING_HOST = describeHost(process.platform, process.arch);

export function currentHost(): HostDescriptor {
  return RUNNING_HOST;
}

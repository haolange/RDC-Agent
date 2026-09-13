export interface ReplayHistoryScope {
  projectRoot: string;
  sessionId: string;
  captureSha256: string;
}

export interface ReplayObservation {
  eventId: number | null;
  resourceId?: string;
  operationId: string;
  toolCallId?: string;
  summary: string;
  modificationState?: string;
  timestamp?: number;
  nativeRevision?: number;
  bindingGeneration?: number;
  displayParameters?: { mip?: number; slice?: number; sample?: number; rangeMin?: number; rangeMax?: number };
  sourceWidth?: number;
  sourceHeight?: number;
  failure?: string;
}

export interface ReplayHistoryEntry extends ReplayObservation {
  sequence: number;
  timestamp: number;
  imageSha256?: string;
  width?: number;
  height?: number;
  saved: true;
}

export interface ReplayManifest {
  captureSha256: string;
  sessionId: string;
  entries: ReplayHistoryEntry[];
}

export interface ReplayPngCodec {
  encode(bytes: Buffer): { png: Buffer; width: number; height: number };
}

export interface ReplayHistoryOptions {
  codec?: ReplayPngCodec;
  sessionQuotaBytes?: number;
  projectQuotaBytes?: number;
}

export interface ReplaySelection {
  inputId: string;
  captureSha256?: string;
  deviceId?: string;
}

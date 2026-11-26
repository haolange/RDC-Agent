import { AppError } from '../errors/appError';
import { isRendererInvokeChannel, RENDERER_INVOKE_CHANNEL_TABLE, type BridgeChannelCapability } from './channels';

/** The capability of a declared channel; an undeclared channel fails closed. */
export function resolveBridgeChannelCapability(channel: string): BridgeChannelCapability {
  if (!isRendererInvokeChannel(channel)) throw new AppError('BRIDGE_CAPABILITY_MISSING', channel);
  return RENDERER_INVOKE_CHANNEL_TABLE[channel];
}

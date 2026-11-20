import { registerConversationRdcHost } from '../conversation/conversationRdcHost';
import { rdcSessionService } from '../sessions';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { acquireRdcPreparationLock, setRdcInteractionLock } from './RdcOperationCoordinator';

registerConversationRdcHost({
  acquirePreparationLock: acquireRdcPreparationLock,
  setInteractionLock: setRdcInteractionLock,
  snapshotOpenedCapture: (scope) => rdcSessionService.snapshotOpenedCaptureForSession(scope),
  replayDevice: (deviceId) => replayDeviceService.getDeviceById(deviceId),
});

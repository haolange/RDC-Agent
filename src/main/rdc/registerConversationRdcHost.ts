import { registerConversationRdcHost } from '../conversation/conversationRdcHost';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { acquireRdcPreparationLock, setRdcInteractionLock } from './RdcOperationCoordinator';
import { rdcSessionService } from '../sessions';

registerConversationRdcHost({
  acquirePreparationLock: acquireRdcPreparationLock,
  setInteractionLock: setRdcInteractionLock,
  snapshotOpenedCapture: (scope) => rdcSessionService.snapshotOpenedCaptureForSession(scope),
  replayDevice: (deviceId) => replayDeviceService.getDeviceById(deviceId),
});

import { z } from 'zod';
import { ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const AppGetAvatarDataUrlArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'avatarPath'),
]);

export const AppOpenPathArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'targetPath'),
]);

export const AppCopyTextArgsSchema = z.tuple([
  ipcString(2_000_000, 'text'),
]);

/**
 * Electron Preload Script
 *
 * Sandbox-compatible: only contextBridge + ipcRenderer (+ process.platform).
 * Do not import Node builtins (fs/path/child_process) here.
 */

import { contextBridge } from 'electron';
import type { ElectronAPI } from '@shared/types/electron';
import { createRendererApi } from '@shared/renderer-api';
import { createIpcRendererTransport } from './rendererTransport';

const electronAPI: ElectronAPI = createRendererApi(process.platform, createIpcRendererTransport());

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

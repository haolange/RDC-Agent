import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({app:{getPath:()=>os.tmpdir(),getAppPath:()=>process.cwd()}}));
import { StorageIo } from '../sessions/StorageIo';
import { SEED_MIGRATION_MARKER_NAME } from './seed-migration/AgentSeedMigrationService';
import { AgentManifestService } from './AgentManifestService';
const roots: string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it('preserves an explicit builtin General model-only user override through save and fresh service reload', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rdc-agent-model-cow-'));roots.push(root);
 const paths={agentsPath:path.join(root,'agents'),instructionsPath:path.join(root,'RDX.md')};
 const service=new AgentManifestService();
 const builtin=service.resolveEffectiveSnapshot(paths).profiles.find(profile=>profile.id==='general')!;
 expect(builtin.builtin).toBe(true);
 const saved=await service.saveDefinition(paths,{...builtin,models:['openai-codex:gpt-5.6-luna']},{scope:'user'});
 expect(saved.definition?.models).toEqual(['openai-codex:gpt-5.6-luna']);
 expect(fs.existsSync(path.join(paths.agentsPath,'general.agent.md'))).toBe(true);
 const reloaded=new AgentManifestService().resolveEffectiveSnapshot(paths);
 const general=reloaded.profiles.find(profile=>profile.id==='general')!;
 expect(general.models).toEqual(['openai-codex:gpt-5.6-luna']);
 expect(general.compiledRoute).toEqual({agentId:'general',providerId:'openai-codex',modelId:'gpt-5.6-luna'});
 expect(general.provenance.scope).toBe('user');
 expect(general.instructions).toBe(builtin.instructions);
 expect(reloaded.diagnostics.some(message=>message.includes('purged-shadow'))).toBe(false);
});

it('rejects marker persistence failure and preserves the previously committed user model bytes', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rdc-agent-model-failure-'));roots.push(root);
 const paths={agentsPath:path.join(root,'agents'),instructionsPath:path.join(root,'RDX.md')};
 const service=new AgentManifestService();
 const builtin=service.resolveEffectiveSnapshot(paths).profiles.find(profile=>profile.id==='general')!;
 const initial=await service.saveDefinition(paths,{...builtin,models:['openai-codex:gpt-5.6-luna']},{scope:'user'});
 const filename=path.join(paths.agentsPath,'general.agent.md');
 const before=fs.readFileSync(filename);
 const original=StorageIo.prototype.writeJsonAtomic;
 const spy=vi.spyOn(StorageIo.prototype,'writeJsonAtomic').mockImplementation(function(this: StorageIo,file,...args){
  if(path.basename(file)===SEED_MIGRATION_MARKER_NAME) throw new Error('injected marker write failure');
  return original.call(this,file,...args);
 });
 await expect(service.saveDefinition(paths,{...builtin,models:['openai-codex:gpt-5.6-sol'],sourceHash:initial.definition!.provenance!.sourceHash},{scope:'user',sourceHash:initial.definition!.provenance!.sourceHash})).rejects.toThrow('injected marker write failure');
 spy.mockRestore();
 expect(fs.readFileSync(filename)).toEqual(before);
 const general=new AgentManifestService().resolveEffectiveSnapshot(paths).profiles.find(profile=>profile.id==='general')!;
 expect(general.models).toEqual(['openai-codex:gpt-5.6-luna']);
});

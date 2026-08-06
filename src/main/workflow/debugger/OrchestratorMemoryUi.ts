import { MemoryStore } from '../../agent-runtime/memory/MemoryStore';

export class OrchestratorMemoryUi {
  constructor(private readonly getUserMemoryStore: () => MemoryStore) {}

  async listMemories(): Promise<Array<{ name: string; description: string; type: string; updatedAt: number }>> {
    try {
      const all = await this.getUserMemoryStore().listMemories();
      return all.map((m) => ({ name: m.name, description: m.description, type: m.type, updatedAt: m.updatedAt }));
    } catch {
      return [];
    }
  }

  async getMemory(name: string): Promise<{
    name: string;
    description: string;
    type: string;
    content: string;
    tags?: string[];
    createdAt: number;
    updatedAt: number;
  } | null> {
    try {
      const record = await this.getUserMemoryStore().getMemory(name);
      if (!record) return null;
      return {
        name: record.displayName,
        description: record.description,
        type: record.type,
        content: record.content,
        tags: record.tags,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    } catch {
      return null;
    }
  }

  async writeMemory(request: {
    name: string;
    description: string;
    type: 'user' | 'feedback' | 'project' | 'reference';
    content: string;
    tags?: string[];
  }): Promise<{ success: boolean; name: string; error?: string }> {
    try {
      const record = await this.getUserMemoryStore().writeMemory(request);
      return { success: true, name: record.displayName };
    } catch (error) {
      return { success: false, name: request.name, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async deleteMemory(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const deleted = await this.getUserMemoryStore().deleteMemory(name);
      return { success: deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

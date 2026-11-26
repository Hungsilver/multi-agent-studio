import { create } from 'zustand'
import type { McpServerInfo, PromptTemplate, RuleFile, SkillItem } from '@shared/types/governance'

interface GovernanceState {
  skills: SkillItem[]
  rules: RuleFile[]
  mcpServers: McpServerInfo[]
  templates: PromptTemplate[]
  loadedForPath: string

  loadAll: (workspacePath?: string) => Promise<void>
}

export const useGovernanceStore = create<GovernanceState>((set) => ({
  skills: [],
  rules: [],
  mcpServers: [],
  templates: [],
  loadedForPath: '',

  loadAll: async (workspacePath) => {
    const [skills, rules, mcpServers, templates] = await Promise.all([
      window.workspaceApi.listSkills(workspacePath),
      window.workspaceApi.listRuleFiles(workspacePath),
      window.workspaceApi.listMcpServers(workspacePath),
      window.workspaceApi.listPromptTemplates()
    ])
    set({ skills, rules, mcpServers, templates, loadedForPath: workspacePath || '' })
  }
}))

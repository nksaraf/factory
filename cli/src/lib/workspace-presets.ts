export interface WorkspacePreset {
  label: string;
  cpu: string;
  memory: string;
  storageGb: number;
  description: string;
}

export const WORKSPACE_PRESETS: Record<string, WorkspacePreset> = {
  small:  { label: "Small",   cpu: "1",  memory: "2Gi",  storageGb: 10,  description: "1 CPU · 2 GB RAM · 10 GB disk" },
  medium: { label: "Medium",  cpu: "2",  memory: "4Gi",  storageGb: 20,  description: "2 CPU · 4 GB RAM · 20 GB disk" },
  large:  { label: "Large",   cpu: "4",  memory: "8Gi",  storageGb: 50,  description: "4 CPU · 8 GB RAM · 50 GB disk" },
  xlarge: { label: "X-Large", cpu: "8",  memory: "16Gi", storageGb: 100, description: "8 CPU · 16 GB RAM · 100 GB disk" },
};

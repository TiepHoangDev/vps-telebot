export interface Project {
  path: string;
  deploy_secret?: string;
  commands: Record<string, string>; // command name → shell command string
}

export interface BotData {
  allowed_users: number[];
  projects: Record<string, Project>; // project name → Project
}

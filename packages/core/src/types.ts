export type TipCategory = "pattern" | "api" | "tooling" | "architecture" | "security" | "other";
export type TipDepth = "beginner" | "intermediate" | "advanced";

export interface Tip {
  concept: string;
  summary: string;
  category: TipCategory;
  whyNow: string;
  learnMore: string[];
  depth: TipDepth;
}

export interface TipTurn {
  sessionId: string;
  turnId: string;
  timestamp: string;
  platform: "cursor" | "claude" | "vscode";
  tips: Tip[];
}

export interface FileEdit {
  filePath: string;
  edits?: Array<{ oldText?: string; newText?: string }>;
}

export interface ToolUse {
  name: string;
  input?: Record<string, unknown>;
}

export interface TurnContext {
  sessionId: string;
  turnId: string;
  platform: "cursor" | "claude" | "vscode";
  userPrompt?: string;
  agentResponse?: string;
  fileEdits: FileEdit[];
  toolsUsed: ToolUse[];
  transcriptPath?: string | null;
}

export type LLMProvider = "hosted" | "anthropic" | "openai" | "openrouter" | "groq";

export interface LearnWhileConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  maxTipsPerTurn: number;
  enabled: boolean;
  showNotifications: boolean;
  /** Hosted API URL when provider is "hosted" */
  hostedApiUrl?: string;
  /** Optional client key for hosted API abuse protection */
  clientKey?: string;
}

export const DEFAULT_CONFIG: LearnWhileConfig = {
  provider: "hosted",
  apiKey: "",
  model: "llama-3.3-70b-versatile",
  maxTipsPerTurn: 3,
  enabled: true,
  showNotifications: true,
  hostedApiUrl: "https://ai-learning-ten-rose.vercel.app/api/tips",
  clientKey: "learnwhile-v1",
};

export const PROVIDER_DEFAULT_MODELS: Record<LLMProvider, string> = {
  hosted: "llama-3.3-70b-versatile",
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  openrouter: "anthropic/claude-haiku-4.5",
  groq: "llama-3.3-70b-versatile",
};

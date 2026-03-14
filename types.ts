
export type GeminiModel = 'nano-banana' | 'nano-banana-2' | 'pro-image';

export interface UsageStats {
  count: number;
  limit: number;
  lastReset: number; // timestamp
}

export interface PersonProfile {
  id: string;
  name: string;
  referenceImages: string[]; // Base64 strings
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
}

export interface AppState {
  inspirationImage: string | null;
  extractedJson: string;
  profiles: PersonProfile[];
  selectedProfileId: string | null;
  isExtracting: boolean;
  isGenerating: boolean;
  generatedImages: GeneratedImage[];
}

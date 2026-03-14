import { GoogleGenAI, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import { JSON_PROMPT } from "../constants";
import { GeminiModel } from "../types";

const MODEL_MAP: Record<GeminiModel, string> = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-2': 'gemini-3.1-flash-image-preview',
  'pro-image': 'gemini-3-pro-image-preview'
};

export const extractStyleJson = async (imageB64: string): Promise<string> => {
  let timeoutId: any;
  const requestId = Math.random().toString(36).substring(7);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      console.warn(`[Gemini][${requestId}] Timeout reached (25s)`);
      reject(new Error("TIMEOUT"));
    }, 25000);
  });

  try {
    console.log(`[Gemini][${requestId}] Starting extraction...`);
    const key = (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;
    if (!key) {
      console.error(`[Gemini][${requestId}] No API key found!`);
      throw new Error("MISSING_API_KEY");
    }
    const ai = new GoogleGenAI({ apiKey: key });
    
    const data = imageB64.split(',')[1] || imageB64;
    
    if (!data || data.length < 100) {
      console.error(`[Gemini][${requestId}] Invalid image data provided (length: ${data?.length})`);
      throw new Error("INVALID_IMAGE_DATA");
    }

    console.log(`[Gemini][${requestId}] Payload size: ${Math.round(data.length / 1024)}KB`);

    const extractionPromise = ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data } },
            { text: JSON_PROMPT }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
      }
    });

    const response = await Promise.race([extractionPromise, timeoutPromise]) as GenerateContentResponse;
    
    if (timeoutId) clearTimeout(timeoutId);
    
    if (!response.text) {
      console.error(`[Gemini][${requestId}] Empty response text`);
      throw new Error("EMPTY_RESPONSE");
    }

    console.log(`[Gemini][${requestId}] Extraction successful`);
    return response.text;
  } catch (error: any) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error(`[Gemini][${requestId}] Extraction error:`, error);
    if (error.message === "TIMEOUT") {
      throw new Error("The analysis timed out (25s limit). Please try again with a simpler image or check your connection.");
    }
    if (error.message === "EMPTY_RESPONSE") {
      throw new Error("The AI returned an empty analysis. Please try a different image.");
    }
    if (error.message === "INVALID_IMAGE_DATA") {
      throw new Error("The image data is invalid or too small. Please try a different photo.");
    }
    if (error.message === "MISSING_API_KEY") {
      throw new Error("API Key is missing. Please check your environment configuration.");
    }
    throw new Error("Analysis failed. Please check your internet connection and try again.");
  }
};

export const generateSwappedImage = async (styleJson: string, referenceImages: string[], model: GeminiModel = 'nano-banana'): Promise<string | null> => {
  try {
    const key = (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;
    const ai = new GoogleGenAI({ apiKey: key });
    const limitedRefs = referenceImages.slice(-5);
    const modelId = MODEL_MAP[model] || MODEL_MAP['nano-banana'];

    const imageParts = limitedRefs.map(img => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: img.split(',')[1] || img
      }
    }));

    const textPart = {
      text: `TASK: Generate a high-quality professional photograph.
STYLE CONFIGURATION (JSON): ${styleJson}
SUBJECT REFERENCE: Use the attached images to replicate the face, skin texture, and body type exactly.
INSTRUCTION: Maintain the pose and lighting described in the JSON while swapping the character for the one in the references.`
    };

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: modelId,
      contents: { parts: [...imageParts, textPart] },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    const candidate = response.candidates?.[0];
    
    // Check for image data FIRST. If the model produced an image, we want to show it, 
    // even if a safety flag was triggered at the end of the turn (which can be a false positive).
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    // Only throw safety error if NO image data was returned
    if (candidate?.finishReason === 'SAFETY') {
      throw new Error("SAFETY_BLOCK");
    }

    return null;
  } catch (error: any) {
    console.error("Generation service failed:", error);
    throw error;
  }
};

export const editGeneratedImage = async (imageB64: string, editPrompt: string, model: GeminiModel = 'nano-banana'): Promise<string | null> => {
  try {
    const key = (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;
    const ai = new GoogleGenAI({ apiKey: key });
    const modelId = MODEL_MAP[model] || MODEL_MAP['nano-banana'];
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              data: imageB64.split(',')[1] || imageB64,
              mimeType: 'image/png',
            },
          },
          {
            text: editPrompt,
          },
        ],
      },
    });

    const candidate = response.candidates?.[0];
    
    // Prioritize returning the edited image data
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    if (candidate?.finishReason === 'SAFETY') {
      throw new Error("SAFETY_BLOCK");
    }

    return null;
  } catch (error: any) {
    console.error("Edit service failed:", error);
    throw error;
  }
};
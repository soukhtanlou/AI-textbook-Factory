
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { decodeBase64, pcmToWav } from "../utils/audioUtils";

// Internal variable to store the key at runtime
let runtimeApiKey = '';

export const setApiKey = (key: string) => {
  // Sanitize key: remove non-printable characters and whitespace
  runtimeApiKey = key.replace(/[^\x20-\x7E]/g, '').trim();
};

const getAiClient = () => {
  if (!runtimeApiKey) throw new Error("API Key وارد نشده است. لطفا وارد شوید.");
  // Ensure key is clean before use
  const cleanKey = runtimeApiKey.replace(/[^\x20-\x7E]/g, '').trim();
  return new GoogleGenAI({ apiKey: cleanKey });
};

// Helper: Execute with Retry for Rate Limits (429)
const executeWithRetry = async <T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error.message || '';
    const isQuotaError = msg.includes('429') || 
                         msg.includes('RESOURCE_EXHAUSTED') || 
                         msg.includes('Quota exceeded') ||
                         error.status === 429;
    
    if (retries > 0 && isQuotaError) {
      console.warn(`Quota limit hit. Retrying in ${baseDelay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, baseDelay));
      return executeWithRetry(fn, retries - 1, baseDelay * 2); // Exponential backoff
    }
    throw error;
  }
};

// Helper to translate text to English (internal use)
const translateToEnglish = async (text: string): Promise<string> => {
    const ai = getAiClient();
    return executeWithRetry(async () => {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: `Translate the following text to English for a video generation prompt. Keep it concise and visual.\n\nText: ${text}` }] }
        });
        return response.text || text;
    });
};

// --- 0. SINGLE PAGE ANALYSIS ---

export const analyzeSinglePage = async (imageBase64: string): Promise<{analysis: string, text: string, description: string}> => {
  const ai = getAiClient();
  const prompt = `
    تصویر این صفحه کتاب درسی را با دقت بسیار بالا تحلیل کن.
    
    خروجی‌ها باید دقیقاً به زبان فارسی باشند:
    1. **تحلیل آموزشی:** هدف آموزشی این صفحه چیست؟ نکات کلیدی را لیست کن.
    2. **متن:** تمام متن‌های موجود در تصویر را کلمه به کلمه استخراج کن. دقت در اعداد و تیترها حیاتی است.
    3. **شرح تصویر:** با جزئیات کامل بصری تصویر را توصیف کن (رنگ‌ها، اشیاء، شخصیت‌ها، محیط). فرض کن مخاطب تصویر را نمی‌بیند.
    
    فرمت خروجی JSON:
    {
      "analysis": "...",
      "text": "...",
      "description": "..."
    }
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
             analysis: { type: Type.STRING },
             text: { type: Type.STRING },
             description: { type: Type.STRING }
          }
        }
      }
    });

    try {
        const json = JSON.parse(response.text || "{}");
        return {
            analysis: json.analysis || "",
            text: json.text || "",
            description: json.description || ""
        };
    } catch (e) {
        return { analysis: "خطا در پردازش", text: "", description: "" };
    }
  });
};


// --- 1. GLOBAL ANALYSIS (THE BRAIN) ---

export const analyzeCourseMap = async (context: string, pages: {pageNumber: number, imageBase64: string}[]): Promise<string> => {
  const ai = getAiClient();
  
  const contentParts: any[] = [];
  contentParts.push({ 
    text: `
    نقش: شما یک برنامه‌ریز آموزشی ارشد هستید.
    وظیفه: تحلیل تصاویر یک فصل از کتاب درسی و ارائه "نقشه راه تدریس".
    
    زمینه معلم: "${context}"
    تعداد صفحات: ${pages.length}
    
    دستورالعمل:
    1. تمام تصاویر زیر را به ترتیب بررسی کنید.
    2. ارتباط معنایی بین صفحات را پیدا کنید.
    3. برای **هر صفحه** یک استراتژی مشخص کنید.
    
    خروجی باید دقیقاً به زبان **فارسی** و با فرمت زیر باشد:
    
    --- استراتژی فصل ---
    (یک پاراگراف توضیح کلی)
    
    --- تحلیل صفحه به صفحه ---
    صفحه 1: [عنوان] - [نقش صفحه] - [پیشنهاد رسانه‌ای]
    ...
    ` 
  });

  pages.forEach((page) => {
    contentParts.push({ text: `\n--- تصویر صفحه ${page.pageNumber} ---` });
    contentParts.push({ 
      inlineData: { 
        mimeType: 'image/jpeg', 
        data: page.imageBase64 
      } 
    });
  });

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: contentParts },
      config: { temperature: 0.2 }
    });
    return response.text || "تحلیل انجام نشد.";
  });
};

// --- 2. TEACHER STUDIO ---

export const generateTeacherScript = async (
    imageBase64: string, 
    globalContext: string, 
    pageAnalysis: string,
    verifiedText: string,
    verifiedDescription: string
): Promise<string> => {
  const ai = getAiClient();
  
  // Strong instruction to use verified text
  const prompt = `
    زمینه کلی درس: ${globalContext}
    تحلیل این صفحه: ${pageAnalysis}
    
    *** اطلاعات حیاتی و تایید شده توسط اپراتور (منبع حقیقت): ***
    - متن دقیق صفحه: "${verifiedText}"
    - توصیف دقیق تصویر: "${verifiedDescription}"
    
    هشدار: فقط و فقط بر اساس "اطلاعات حیاتی" بالا تدریس کن. اگر چیزی در متن تایید شده نیست، آن را از خودت نساز.
    اگر شماره صفحه یا تیتری در متن تایید شده آمده، همان درست است.
    
    وظیفه: شما یک معلم دبستان هستید. یک متن تدریس جذاب بنویسید.
    
    قوانین:
    1. لحن: پرانرژی و صمیمی.
    2. اعراب‌گذاری: کلمات را برای تبدیل متن به صدا کاملاً اعراب‌گذاری کن.
    3. بر اساس متن و تصویر تایید شده درس بده.
    
    خروجی: فقط متن فارسی تدریس.
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, // Keeping image as secondary reference context
          { text: prompt }
        ]
      }
    });
    return response.text || "خطا در تولید متن معلم.";
  });
};

export const generateSpeech = async (text: string, voiceName: string, speed: number): Promise<Blob> => {
  const ai = getAiClient();
  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("داده صوتی دریافت نشد");

    const pcmData = decodeBase64(base64Audio);
    return pcmToWav(pcmData, 24000, 1);
  });
};

// --- 3. STORYBOARD STUDIO ---

export const generateStoryboardPrompt = async (
    imageBase64: string, 
    verifiedDescription: string
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    منبع حقیقت (توصیف تصویر تایید شده): "${verifiedDescription}"
    
    نقش: کارگردان هنری.
    وظیفه: نوشتن پرامپت استوری‌بورد برای یک تصویرسازی آموزشی بر اساس توصیف بالا.
    
    قوانین:
    1. از توصیف تایید شده استفاده کن تا مطمئن شوی موضوع درست است.
    2. برای جذابیت بصری، استعاره یا سبک وکتور آرت پیشنهاد بده.
    3. خروجی فارسی باشد.
    4. تاکید کن که تصویر بدون متن (Text-Free) باشد.
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      },
      config: { temperature: 0.7 }
    });
    return response.text || "خطا در تولید پرامپت.";
  });
};

export const generateStoryboardImage = async (promptText: string): Promise<string> => {
  const ai = getAiClient();
  const finalPrompt = promptText + " . (Create a clean educational vector illustration. Important: NO TEXT, NO LETTERS, NO NUMBERS inside the image. Visuals only.)";

  return executeWithRetry(async () => {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: finalPrompt }] },
          config: {
              imageConfig: {
                  aspectRatio: "1:1"
              }
          }
        });
        
        let imageUrl = "";
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }
        if (!imageUrl) throw new Error("تصویر تولید نشد.");
        return imageUrl;
      } catch (error: any) {
          throw new Error(error.message || "خطا در سرویس تصویر");
      }
  });
};

// --- 4. VIDEO STUDIO (VEO) ---

export const generateVideoPrompt = async (
    imageBase64: string,
    verifiedDescription: string
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    منبع حقیقت (توصیف تایید شده): "${verifiedDescription}"
    
    نقش: کارگردان انیمیشن.
    وظیفه: نوشتن پرامپت ویدیو بر اساس توصیف بالا.
    
    مفهوم اصلی را از توصیف بالا بگیر و آن را متحرک کن.
    خروجی: متن توصیف صحنه به فارسی.
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      }
    });
    return response.text || "";
  });
};

export const generateVideo = async (userPrompt: string, imageBase64: string, resolution: '720p' | '1080p' = '720p'): Promise<Blob> => {
  const ai = getAiClient();
  const englishPrompt = await translateToEnglish(userPrompt);
  
  return executeWithRetry(async () => {
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: englishPrompt,
        image: {
          imageBytes: imageBase64,
          mimeType: 'image/jpeg',
        },
        config: {
          numberOfVideos: 1,
          resolution: resolution,
          aspectRatio: '16:9'
        }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({operation: operation});
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!videoUri) throw new Error("تولید ویدیو ناموفق بود.");

      const response = await fetch(`${videoUri}&key=${runtimeApiKey}`);
      return await response.blob();
  }, 1);
};

// --- 5. DIALOGUE STUDIO ---

export const generateDialogue = async (
    imageBase64: string, 
    teacherScript: string,
    verifiedText: string
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    اطلاعات تایید شده صفحه: "${verifiedText}"
    متن تدریس معلم: "${teacherScript}"
    
    وظیفه: نوشتن گفتگوی دو دانش‌آموز (علی و رضا) درباره موضوع درس.
    از اطلاعات تایید شده استفاده کن تا بحث آن‌ها دقیق باشد.
    
    فرمت:
    علی: ...
    رضا: ...
  `;
  
  return executeWithRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }] },
        config: { temperature: 0.7 }
      });
      return response.text || "";
  });
};

export const generateMultiSpeakerAudio = async (script: string): Promise<Blob> => {
  const ai = getAiClient();
  const prompt = `TTS the following conversation:\n${script}`;
  
  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
            multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
                { speaker: 'علی', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }, 
                { speaker: 'رضا', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
            ]
            }
        }
        }
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("صدا تولید نشد");
    return pcmToWav(decodeBase64(base64Audio!), 24000, 1);
  });
};

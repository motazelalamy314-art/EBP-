import type {
  AppSettings,
  QuizQuestion,
  ScheduleDay,
  SourceAnalysisReport,
  StudyModeId,
  SubjectId,
} from '../types/study';
import type { OcrImagePayload } from './pdfExtractor';
import {
  OFFICIAL_SUBJECTS,
  STUDY_MODES,
  isEnglishStemSubject,
  sanitizeSpokenScript,
} from './studyLogic';
import {
  buildDeepCurriculumPrompt,
  extractTableOfContentsSnippet,
  mergeBranchExtractions,
  safeParseAiJson,
  splitSourceIntoChunks,
  type ExtractedBranch,
} from './sourceAnalysis';
import {
  DEFAULT_GEMINI_MODEL,
  buildGeminiGenerateUrl,
  callGeminiWithFallback,
  normalizeGeminiModelId,
  parseSafeJsonResponse,
  parseUpstreamAiError,
  withRetryBackoff,
} from './aiResilience';

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

interface GeminiRestResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
      }>;
    };
  }>;
  [key: string]: unknown;
}

function resolveEffectiveModel(settings: AppSettings): string {
  const rawModel = settings.customModelId.trim() || settings.modelId;
  if (settings.provider === 'gemini') {
    return normalizeGeminiModelId(rawModel);
  }
  return rawModel || 'gpt-4o-mini';
}

function getRequiredGeminiKey(settings: AppSettings): string {
  const key = (settings.customGeminiApiKey || '').trim();
  if (!key) {
    throw new Error('يرجى إدخال مفتاح Gemini API في صفحة الإعدادات أولاً.');
  }
  return key;
}

async function callGeminiDirect(params: {
  apiKey: string;
  model: string;
  parts: GeminiPart[];
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<string> {
  const {
    apiKey,
    model,
    parts,
    systemInstruction,
    responseMimeType,
    responseSchema,
    thinkingLevel,
  } = params;

  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('يرجى إدخال مفتاح Gemini API في صفحة الإعدادات أولاً.');
  }

  const url = buildGeminiGenerateUrl(model, cleanKey);
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
  };

  if (systemInstruction && systemInstruction.trim()) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const generationConfig: Record<string, unknown> = {};
  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }
  if (
    thinkingLevel &&
    (model.startsWith('gemini-4') || model.startsWith('gemini-3'))
  ) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const rawText = await resp.text();
  if (!resp.ok) {
    const upstreamErr = new Error(rawText || resp.statusText);
    (upstreamErr as { status?: number }).status = resp.status;
    throw upstreamErr;
  }

  const data = await parseSafeJsonResponse<GeminiRestResponse>(
    {
      ok: true,
      status: resp.status,
      statusText: resp.statusText,
      text: async () => rawText,
    },
    'تعذر قراءة استجابة Gemini API'
  );

  const candidateParts = data?.candidates?.[0]?.content?.parts || [];
  const text = candidateParts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text || '')
    .join('')
    .trim();

  return text;
}

async function callGeminiWithDirectFallback(params: {
  primaryModel: string;
  fallbackModel?: string;
  operation: (model: string) => Promise<string>;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}): Promise<{ result: string; usedModel: string; fallbackUsed: boolean }> {
  try {
    return await callGeminiWithFallback({
      primaryModel: params.primaryModel,
      fallbackModel: params.fallbackModel ?? DEFAULT_GEMINI_MODEL,
      maxAttempts: params.maxAttempts ?? 2,
      baseDelayMs: params.baseDelayMs ?? 600,
      timeoutMs: params.timeoutMs ?? 22000,
      operation: params.operation,
    });
  } catch (err) {
    const parsed = parseUpstreamAiError(err);
    throw new Error(parsed.message);
  }
}

function validateExternalOpenAiUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('رابط الـ API غير صالح.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('يجب أن يبدأ رابط مزود OpenAI-Compatible بـ https:// أو http://.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

async function callOpenAiCompatible(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  userContent: string | Array<Record<string, unknown>>;
  jsonMode?: boolean;
}): Promise<string> {
  const cleanUrl = validateExternalOpenAiUrl(params.baseUrl);
  const key = params.apiKey.trim();
  if (!key) {
    throw new Error('يرجى إدخال مفتاح الـ API الخاص بالمزود في صفحة الإعدادات.');
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: 'system', content: params.systemInstruction },
      { role: 'user', content: params.userContent },
    ],
  };
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const resp = await fetch(`${cleanUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const data = await parseSafeJsonResponse<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(resp, 'خطأ في قراءة استجابة المزود الخارجي');

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('لم يُرجع المزود أي محتوى.');
  }
  return content.trim();
}

async function callOllamaChat(
  settings: AppSettings,
  systemInstruction: string,
  userPrompt: string,
  jsonMode = false,
  imagesBase64?: string[]
): Promise<string> {
  const base = (settings.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const model = settings.customModelId.trim() || settings.modelId || 'llama3.2';

  const userMsg: Record<string, unknown> = {
    role: 'user',
    content: userPrompt,
  };
  if (imagesBase64 && imagesBase64.length > 0) {
    userMsg.images = imagesBase64;
  }

  const resp = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: jsonMode ? 'json' : undefined,
      messages: [
        { role: 'system', content: systemInstruction },
        userMsg,
      ],
    }),
  });

  const data = await parseSafeJsonResponse<{ message?: { content?: string }; error?: string }>(
    resp,
    'تعذر الاتصال بـ Ollama. تأكد من تشغيل Ollama محلياً وتفعيل CORS'
  );
  return (data?.message?.content || '').trim();
}

export async function testAiConnection(
  settings: AppSettings
): Promise<{ ok: boolean; message: string }> {
  const started = Date.now();

  if (settings.provider === 'ollama') {
    const base = (settings.ollamaBaseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    try {
      const resp = await fetch(`${base}/api/tags`);
      const data = await parseSafeJsonResponse<{ models?: Array<{ name: string }> }>(
        resp,
        'تعذر قراءة قائمة النماذج من خادم Ollama'
      );
      const names = (data.models || []).map((m) => m.name).slice(0, 4).join('، ');
      return {
        ok: true,
        message: names
          ? `تم الاتصال بخادم Ollama المحلي بنجاح. النماذج المتاحة: ${names}`
          : 'تم الاتصال بخادم Ollama المحلي بنجاح.',
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'تعذر الوصول إلى Ollama على http://localhost:11434. تأكد من تشغيله محلياً.',
      };
    }
  }

  const model = resolveEffectiveModel(settings);

  if (settings.provider === 'openai_compatible') {
    try {
      const text = await callOpenAiCompatible({
        baseUrl: settings.openAiBaseUrl || '',
        apiKey: settings.openAiApiKey || '',
        model,
        systemInstruction: 'أجب بكلمة واحدة: جاهز',
        userContent: 'اختبار اتصال',
      });
      return {
        ok: true,
        message: `تم الاتصال بنجاح (${model}): ${text.slice(0, 60)}`,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error ? err.message : 'فشل اختبار الاتصال بالمزود الخارجي.',
      };
    }
  }

  // Gemini direct browser fetch
  const apiKey = (settings.customGeminiApiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      message: 'يرجى إدخال مفتاح Gemini API في الحقل المخصص أولاً ثم الضغط على اختبار الاتصال.',
    };
  }

  try {
    const text = await withRetryBackoff(
      () =>
        callGeminiDirect({
          apiKey,
          model,
          parts: [{ text: 'قل "تم الاتصال بنجاح" باللغة العربية فقط.' }],
          thinkingLevel:
            model.startsWith('gemini-4') || model.startsWith('gemini-3') ? 'LOW' : undefined,
        }),
      { maxAttempts: 2, baseDelayMs: 600, timeoutMs: 12000 }
    );

    return {
      ok: true,
      message: `تم الاتصال بنجاح بالنموذج ${model} (${Date.now() - started}ms): ${text.slice(0, 80)}`,
    };
  } catch (err) {
    const parsed = parseUpstreamAiError(err);
    return {
      ok: false,
      message: parsed.message,
    };
  }
}

export async function performOcrOnImages(params: {
  settings: AppSettings;
  subjectNameAr: string;
  images: OcrImagePayload[];
}): Promise<string> {
  const { settings, subjectNameAr, images } = params;
  if (images.length === 0) return '';

  const ocrSystemPrompt = `أنت محرك OCR أكاديمي فائق الدقة متخصص في مناهج الصف الأول الثانوي (البكالوريا المصرية - مادة ${subjectNameAr}).
قواعد الاستخراج:
1. استخرج كل النصوص المكتوبة في الصور بدقة كاملة باللغة العربية والإنجليزية والألمانية كما تظهر في الصفحة دون تلخيص أو حذف أو اختصار.
2. حافظ على العناوين الرئيسية والفرعية وعناوين الوحدات والدروس بعلامات Markdown (# و ##) لتسهيل تحليل المنهج لاحقاً.
3. انقل الجداول بتنسيق Markdown المنظم، وحوّل المعادلات الرياضية والعلمية والرموز الكيميائية إلى صيغة LaTeX دقيقة ($...$ أو $$...$$).
4. افصل بين كل صفحة أو صورة بعنوان واضح مثل: --- [اسم الصفحة/الصورة] ---.`;

  const labelsList = images.map((i) => i.label).join('، ');

  if (settings.provider === 'ollama') {
    return callOllamaChat(
      settings,
      ocrSystemPrompt,
      `استخرج النص الكامل من الصور المرفقة (${labelsList}).`,
      false,
      images.map((i) => i.base64Data)
    );
  }

  const model = resolveEffectiveModel(settings);

  if (settings.provider === 'openai_compatible') {
    const contentParts: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `استخرج النص الكامل بدقة من الصور التالية (${labelsList}):`,
      },
      ...images.map((img) => ({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64Data}`,
        },
      })),
    ];

    return callOpenAiCompatible({
      baseUrl: settings.openAiBaseUrl || '',
      apiKey: settings.openAiApiKey || '',
      model,
      systemInstruction: ocrSystemPrompt,
      userContent: contentParts,
    });
  }

  const apiKey = getRequiredGeminiKey(settings);
  const imageParts: GeminiPart[] = images.map((img) => ({
    inlineData: {
      mimeType: img.mimeType || 'image/jpeg',
      data: img.base64Data,
    },
  }));

  const { result } = await callGeminiWithDirectFallback({
    primaryModel: model,
    fallbackModel: DEFAULT_GEMINI_MODEL,
    maxAttempts: 2,
    timeoutMs: 18000,
    operation: (activeModel) =>
      callGeminiDirect({
        apiKey,
        model: activeModel,
        systemInstruction: ocrSystemPrompt,
        parts: [
          ...imageParts,
          {
            text: `استخرج النص الكامل من هذه الصور بالترتيب (${labelsList}) بدقة تامة دون حذف أي فقرة أو درس أو مسألة.`,
          },
        ],
        thinkingLevel:
          activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
            ? 'LOW'
            : undefined,
      }),
  });

  return result;
}

export async function generateStudyContent(params: {
  settings: AppSettings;
  modeId: StudyModeId;
  systemInstruction: string;
  userPrompt: string;
}): Promise<{ text: string; questions?: QuizQuestion[] }> {
  const { settings, modeId, systemInstruction, userPrompt } = params;

  if (settings.provider === 'ollama') {
    if (modeId === 'question_bank') {
      const raw = await callOllamaChat(
        settings,
        systemInstruction,
        `${userPrompt}\n\nأعد JSON فقط على الشكل: {"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"difficulty":"easy","explanation":"..."}]} يحتوي على 100 سؤال.`,
        true
      );
      const parsed = safeParseAiJson<{ questions?: Omit<QuizQuestion, 'id'>[] }>(raw, {
        questions: [],
      });
      if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error('لم يتمكن النموذج من إرجاع بنك أسئلة صالح بصيغة JSON.');
      }
      const questions: QuizQuestion[] = parsed.questions.map((q, idx) => ({
        id: idx + 1,
        question: q.question,
        options: Array.isArray(q.options) ? q.options.slice(0, 4) : [],
        correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
        difficulty: q.difficulty === 'medium' || q.difficulty === 'hard' ? q.difficulty : 'easy',
        explanation: q.explanation || '',
      }));
      return { text: '', questions };
    }

    let text = await callOllamaChat(settings, systemInstruction, userPrompt, false);
    if (modeId === 'script') {
      text = sanitizeSpokenScript(text);
    }
    return { text };
  }

  const model = resolveEffectiveModel(settings);

  if (settings.provider === 'openai_compatible') {
    if (modeId === 'question_bank') {
      const jsonPrompt = `${userPrompt}\n\nأعد JSON فقط على الشكل التالي يحتوي على 100 سؤال بالضبط (35 سهل، 40 متوسط، 25 مستويات عليا):
{"questions":[{"question":"نص السؤال","options":["أ","ب","ج","د"],"correctIndex":0,"difficulty":"easy","explanation":"تفسير قصير"}]}`;
      const raw = await callOpenAiCompatible({
        baseUrl: settings.openAiBaseUrl || '',
        apiKey: settings.openAiApiKey || '',
        model,
        systemInstruction,
        userContent: jsonPrompt,
        jsonMode: true,
      });
      const parsed = safeParseAiJson<{ questions?: Omit<QuizQuestion, 'id'>[] }>(raw, {
        questions: [],
      });
      const questions: QuizQuestion[] = (parsed.questions || []).map((q, idx) => ({
        id: idx + 1,
        question: q.question,
        options: Array.isArray(q.options) ? q.options.slice(0, 4) : [],
        correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
        difficulty: q.difficulty === 'medium' || q.difficulty === 'hard' ? q.difficulty : 'easy',
        explanation: q.explanation || '',
      }));
      return { text: '', questions };
    }

    let text = await callOpenAiCompatible({
      baseUrl: settings.openAiBaseUrl || '',
      apiKey: settings.openAiApiKey || '',
      model,
      systemInstruction,
      userContent: userPrompt,
    });
    if (modeId === 'script') {
      text = sanitizeSpokenScript(text);
    }
    return { text };
  }

  // Gemini direct browser fetch
  const apiKey = getRequiredGeminiKey(settings);

  if (modeId === 'question_bank') {
    const questionBankSchema = {
      type: 'OBJECT',
      properties: {
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              correctIndex: { type: 'INTEGER' },
              difficulty: { type: 'STRING' },
              explanation: { type: 'STRING' },
            },
            required: ['question', 'options', 'correctIndex', 'difficulty', 'explanation'],
          },
        },
      },
      required: ['questions'],
    };

    const batchPrompts = [
      `${userPrompt}\n\nأنشئ الدفعة الأولى: 50 سؤال اختيار من متعدد بالضبط (35 سؤال difficulty="easy" و 15 سؤال difficulty="medium"). كل سؤال به 4 اختيارات دقيقة وcorrectIndex من 0 إلى 3 وتفسير مختصر بالعامية المصرية.`,
      `${userPrompt}\n\nأنشئ الدفعة الثانية (أسئلة جديدة تماماً ومختلفة عن الأسئلة البديهية): 50 سؤال اختيار من متعدد بالضبط (25 سؤال difficulty="medium" و 25 سؤال difficulty="hard" مستويات تفكير عليا وتطبيق وتحليل). كل سؤال به 4 اختيارات دقيقة وcorrectIndex من 0 إلى 3 وتفسير مختصر بالعامية المصرية.`,
    ];

    const batchResults = await Promise.all(
      batchPrompts.map(async (instruction) => {
        const { result: raw } = await callGeminiWithDirectFallback({
          primaryModel: model,
          fallbackModel: DEFAULT_GEMINI_MODEL,
          maxAttempts: 2,
          timeoutMs: 30000,
          operation: (activeModel) =>
            callGeminiDirect({
              apiKey,
              model: activeModel,
              systemInstruction,
              parts: [{ text: instruction }],
              responseMimeType: 'application/json',
              responseSchema: questionBankSchema,
              thinkingLevel:
                activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
                  ? 'LOW'
                  : undefined,
            }),
        });

        const parsed = safeParseAiJson<{
          questions?: Array<{
            question: string;
            options: string[];
            correctIndex: number;
            difficulty: string;
            explanation: string;
          }>;
        }>(raw || '{"questions":[]}', { questions: [] });

        return parsed.questions || [];
      })
    );

    const combined = [...batchResults[0], ...batchResults[1]].slice(0, 100);
    const questions: QuizQuestion[] = combined.map((q, idx) => ({
      id: idx + 1,
      question: q.question,
      options:
        Array.isArray(q.options) && q.options.length >= 2
          ? q.options.slice(0, 4)
          : ['أ', 'ب', 'ج', 'د'],
      correctIndex:
        typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= 3
          ? q.correctIndex
          : 0,
      difficulty:
        q.difficulty === 'hard'
          ? 'hard'
          : q.difficulty === 'medium'
            ? 'medium'
            : 'easy',
      explanation: q.explanation || '',
    }));

    return { text: '', questions };
  }

  const { result: rawText } = await callGeminiWithDirectFallback({
    primaryModel: model,
    fallbackModel: DEFAULT_GEMINI_MODEL,
    maxAttempts: 2,
    timeoutMs: 30000,
    operation: (activeModel) =>
      callGeminiDirect({
        apiKey,
        model: activeModel,
        systemInstruction,
        parts: [{ text: userPrompt }],
        thinkingLevel:
          activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
            ? 'LOW'
            : undefined,
      }),
  });

  const text = modeId === 'script' ? sanitizeSpokenScript(rawText) : rawText;
  return { text };
}

export async function extractCurriculumFromSources(params: {
  settings: AppSettings;
  subjectId?: SubjectId;
  subjectNameAr: string;
  languageSchoolMode?: boolean;
  sourcesText: string;
}): Promise<{
  branches: Array<{ title: string; lessons: string[] }>;
  analysisSummary: string;
  analysisReport?: SourceAnalysisReport;
}> {
  const {
    settings,
    subjectId,
    subjectNameAr,
    languageSchoolMode = true,
    sourcesText,
  } = params;

  if (!sourcesText || !sourcesText.trim()) {
    throw new Error('لا توجد نصوص مصادر نشطة لتحليلها.');
  }

  const requireEnglishTitles = Boolean(
    subjectId && isEnglishStemSubject(subjectId, languageSchoolMode)
  );
  const tocOutline = extractTableOfContentsSnippet(sourcesText);

  if (settings.provider === 'ollama') {
    const prompt = buildDeepCurriculumPrompt({
      subjectNameAr,
      subjectId,
      languageSchoolMode,
      chunkText: sourcesText.slice(0, 28000),
      chunkIndex: 0,
      totalChunks: 1,
      tocOutline,
    });
    const raw = await callOllamaChat(
      settings,
      `أعد JSON فقط بهذا الشكل: {"summary":"ملخص تحليلي موجز للمصدر","coverageAssessment":"تقييم التغطية","keyConcepts":["مفهوم 1"],"studyRecommendations":["توصية 1"],"branches":[{"title":"اسم الفرع","lessons":["درس 1","درس 2"]}]}. ${requireEnglishTitles ? 'All branch titles and lesson names MUST be in academic English only.' : ''}`,
      prompt,
      true
    );
    const parsed = safeParseAiJson<{
      summary?: string;
      coverageAssessment?: string;
      keyConcepts?: string[];
      studyRecommendations?: string[];
      branches?: Array<{ title: string; lessons: string[] }>;
    }>(raw, { branches: [] });
    const cleanedBranches = mergeBranchExtractions([parsed.branches || []]);
    const totalLessons = cleanedBranches.reduce((sum, b) => sum + b.lessons.length, 0);
    return {
      branches: cleanedBranches,
      analysisSummary: parsed.summary || '',
      analysisReport: {
        overview: parsed.summary || '',
        coverageAssessment: parsed.coverageAssessment || '',
        keyConcepts: parsed.keyConcepts || [],
        studyRecommendations: parsed.studyRecommendations || [],
        branchesCount: cleanedBranches.length,
        lessonsCount: totalLessons,
        chunksAnalyzed: 1,
      },
    };
  }

  const model = resolveEffectiveModel(settings);
  const chunks = splitSourceIntoChunks(sourcesText, 26000, 1200);

  interface RawChunkAnalysis {
    summary?: string;
    coverageAssessment?: string;
    keyConcepts?: string[];
    studyRecommendations?: string[];
    branches?: ExtractedBranch[];
  }

  const chunkOutputs: RawChunkAnalysis[] = [];

  if (settings.provider === 'openai_compatible') {
    const englishRule = requireEnglishTitles
      ? 'CRITICAL: All branches[].title and branches[].lessons[] MUST be strictly in English (academic Language Schools terminology, never Arabic).'
      : '';
    for (let i = 0; i < chunks.length; i += 1) {
      const prompt = buildDeepCurriculumPrompt({
        subjectNameAr,
        subjectId,
        languageSchoolMode,
        chunkText: chunks[i],
        chunkIndex: i,
        totalChunks: chunks.length,
        tocOutline,
      });
      const raw = await callOpenAiCompatible({
        baseUrl: settings.openAiBaseUrl || '',
        apiKey: settings.openAiApiKey || '',
        model,
        systemInstruction: `أنت محلل مناهج تعليمية خبير لنظام البكالوريا المصرية. ${englishRule} أعد JSON فقط بهذا الشكل: {"summary":"ملخص تحليلي دقيق","coverageAssessment":"تقييم تغطية المصدر","keyConcepts":["مفهوم 1"],"studyRecommendations":["توصية 1"],"branches":[{"title":"اسم الفرع","lessons":["اسم الدرس 1","اسم الدرس 2"]}]}`,
        userContent: prompt,
        jsonMode: true,
      });
      chunkOutputs.push(
        safeParseAiJson<RawChunkAnalysis>(raw, {
          summary: '',
          coverageAssessment: '',
          keyConcepts: [],
          studyRecommendations: [],
          branches: [],
        })
      );
    }
  } else {
    const apiKey = getRequiredGeminiKey(settings);
    const branchTitleDesc = requireEnglishTitles
      ? 'Academic branch or unit title strictly in English (e.g., "Unit 1: Algebra & Equations", "Trigonometry", "Aquatic Ecosystem", "Python Fundamentals"). Never use Arabic.'
      : 'اسم الفرع الأكاديمي أو الوحدة الرئيسية المستخرجة من المصدر بدون أرقام صفحات';
    const lessonDesc = requireEnglishTitles
      ? 'Exact list of lessons/topics inside this branch strictly in English (e.g., "Complex Numbers", "Quadratic Equations"). Never use Arabic or page numbers.'
      : 'قائمة الدروس الفعلية داخل هذا الفرع كما وردت في المصدر بدون أرقام صفحات';

    const schema = {
      type: 'OBJECT',
      properties: {
        summary: {
          type: 'STRING',
          description: 'ملخص تحليلي دقيق وموجز يوضح الفروع والمحاور الأساسية التي غطاها هذا الجزء',
        },
        coverageAssessment: {
          type: 'STRING',
          description: 'تقييم تغطية المصدر (مثلاً: كتاب منهج شامل / ملزمة وحدة / فهرس موضوعات)',
        },
        keyConcepts: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'أهم المفاهيم والقوانين والمهارات المحورية المستخرجة من هذا الجزء',
        },
        studyRecommendations: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'توصيات عملية للطالب حول كيفية مذاكرة وفهم موضوعات هذا الجزء بكفاءة',
        },
        branches: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: {
                type: 'STRING',
                description: branchTitleDesc,
              },
              lessons: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: lessonDesc,
              },
            },
            required: ['title', 'lessons'],
          },
        },
      },
      required: ['summary', 'coverageAssessment', 'keyConcepts', 'studyRecommendations', 'branches'],
    };

    const systemInstruction = requireEnglishTitles
      ? `أنت خبير تحليل مناهج البكالوريا المصرية (مدارس اللغات - Language Schools). التزم حصرياً بالمصادر المقدمة، وافحص الفهرس والوحدات والدروس بعمق لاستخراج البنية الكاملة للمنهج والمفاهيم الأساسية. قاعدة صارمة: يجب كتابة جميع قيم branches[].title و branches[].lessons[] باللغة الإنجليزية الأكاديمية فقط (ترجم أي عناوين عربية إلى مصطلحها الإنجليزي العلمي المعتمد في مدارس اللغات المصرية).`
      : `أنت خبير تحليل مناهج البكالوريا المصرية. التزم حصرياً بالمصادر المقدمة، وافحص الفهرس والوحدات والدروس بعمق لاستخراج البنية الكاملة للمنهج والمفاهيم الأساسية والتوصيات التعليمية دون اختراع أو إسقاط.`;

    const concurrency = 3;
    const resultsArray: RawChunkAnalysis[] = new Array(chunks.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < chunks.length) {
        const currentIdx = nextIndex;
        nextIndex += 1;

        const prompt = buildDeepCurriculumPrompt({
          subjectNameAr,
          subjectId,
          languageSchoolMode,
          chunkText: chunks[currentIdx],
          chunkIndex: currentIdx,
          totalChunks: chunks.length,
          tocOutline,
        });

        const { result: raw } = await callGeminiWithDirectFallback({
          primaryModel: model,
          fallbackModel: DEFAULT_GEMINI_MODEL,
          maxAttempts: 2,
          timeoutMs: 30000,
          operation: (activeModel) =>
            callGeminiDirect({
              apiKey,
              model: activeModel,
              systemInstruction,
              parts: [{ text: prompt }],
              responseMimeType: 'application/json',
              responseSchema: schema,
              thinkingLevel:
                activeModel.startsWith('gemini-4')
                  ? 'MEDIUM'
                  : activeModel.startsWith('gemini-3')
                    ? 'LOW'
                    : undefined,
            }),
        });

        resultsArray[currentIdx] = safeParseAiJson<RawChunkAnalysis>(raw || '', {
          summary: '',
          coverageAssessment: '',
          keyConcepts: [],
          studyRecommendations: [],
          branches: [],
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker())
    );
    chunkOutputs.push(...resultsArray);
  }

  const mergedBranches = mergeBranchExtractions(
    chunkOutputs.map((r) => r.branches || [])
  );
  const totalLessons = mergedBranches.reduce((sum, b) => sum + b.lessons.length, 0);

  const dedupeList = (items: string[], maxCount: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const clean = (raw || '').trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        out.push(clean);
        if (out.length >= maxCount) break;
      }
    }
    return out;
  };

  const uniqueSummaries = dedupeList(
    chunkOutputs.map((r) => r.summary || ''),
    4
  );
  const overview = uniqueSummaries.join(' ').trim();
  const coverageAssessment =
    chunkOutputs.find((r) => (r.coverageAssessment || '').trim())?.coverageAssessment?.trim() ||
    `تم فحص ${chunks.length} ${chunks.length === 1 ? 'جزء' : 'أجزاء'} واستخراج ${mergedBranches.length} فروع و ${totalLessons} درس.`;

  const keyConcepts = dedupeList(
    chunkOutputs.flatMap((r) => r.keyConcepts || []),
    10
  );
  const studyRecommendations = dedupeList(
    chunkOutputs.flatMap((r) => r.studyRecommendations || []),
    4
  );

  const analysisReport: SourceAnalysisReport = {
    overview,
    coverageAssessment,
    keyConcepts,
    studyRecommendations,
    branchesCount: mergedBranches.length,
    lessonsCount: totalLessons,
    chunksAnalyzed: chunks.length,
  };

  return {
    branches: mergedBranches,
    analysisSummary: overview,
    analysisReport,
  };
}

export async function generateSmartSchedule(params: {
  settings: AppSettings;
  examDate: string;
  dailyHours: number;
  languageSchoolMode?: boolean;
  subjectsSummary: Array<{
    id: SubjectId;
    nameAr: string;
    branches: Array<{ title: string; lessons: string[] }>;
  }>;
}): Promise<ScheduleDay[]> {
  const {
    settings,
    examDate,
    dailyHours,
    languageSchoolMode = true,
    subjectsSummary,
  } = params;

  let rawDays: Array<{
    dayIndex?: number;
    dateLabel?: string;
    focusTheme?: string;
    tasks?: Array<{
      subjectId?: string;
      branchTitle?: string;
      lessonTitle?: string;
      modeId?: string;
      durationMinutes?: number;
      notes?: string;
    }>;
  }> = [];

  const validSubs = OFFICIAL_SUBJECTS.map((s) => s.id).join(', ');
  const validModesList = STUDY_MODES.map((m) => m.id).join(', ');

  if (settings.provider === 'ollama') {
    const stemNote = languageSchoolMode
      ? 'For math, science, and programming subjects, write branchTitle and lessonTitle strictly in English.'
      : '';
    const raw = await callOllamaChat(
      settings,
      `أعد JSON فقط: {"days":[{"dayIndex":1,"dateLabel":"اليوم 1","focusTheme":"...","tasks":[{"subjectId":"...","branchTitle":"...","lessonTitle":"...","modeId":"...","durationMinutes":45,"notes":"..."}]}]}. subjectId من: ${validSubs}. modeId من: ${validModesList}. ${stemNote}`,
      `تاريخ الامتحان: ${examDate} | الساعات اليومية: ${dailyHours}\nالمواد: ${JSON.stringify(subjectsSummary)}`,
      true
    );
    const parsed = safeParseAiJson<{ days?: typeof rawDays }>(raw, { days: [] });
    rawDays = parsed.days || [];
  } else {
    const model = resolveEffectiveModel(settings);
    const validModeLabels = STUDY_MODES.map((m) => `${m.id} (${m.label})`).join('، ');
    const englishStemNote = languageSchoolMode
      ? '- لمواد (math, science, programming): اكتب branchTitle و lessonTitle باللغة الإنجليزية الأكاديمية فقط (نظام مدارس اللغات).'
      : '';

    const prompt = `أنشئ جدول مذاكرة يومي ذكي وواقعي لنظام البكالوريا المصرية (أولى ثانوي).
تاريخ الامتحان المستهدف: ${examDate}
ساعات المذاكرة المتاحة يومياً: ${dailyHours} ساعات (${dailyHours * 60} دقيقة يومياً).
أنشئ خطة من 7 أيام (أو حسب القرب من الامتحان، بحد أقصى 10 أيام متوازنة) تغطي المواد المختارة ودروسها المستخرجة.
المواد المختارة ودروسها:
${JSON.stringify(subjectsSummary, null, 2)}

القواعد:
- استخدم معرفات المواد التالية فقط في subjectId: ${validSubs}
- استخدم معرفات الأوضاع التالية فقط في modeId: ${validModeLabels}
${englishStemNote}
- وزع المهام بين أوضاع الشرح ("detailed")، المراجعة السريعة ("quick_review")، المراجعة الشاملة ("comprehensive_review")، وبنك الأسئلة ("question_bank") أو الاسكريبت ("script").
- لا تتجاوز مدة المهام اليومية الإجمالية (${dailyHours * 60} دقيقة) في اليوم الواحد.`;

    if (settings.provider === 'openai_compatible') {
      const raw = await callOpenAiCompatible({
        baseUrl: settings.openAiBaseUrl || '',
        apiKey: settings.openAiApiKey || '',
        model,
        systemInstruction:
          'أعد JSON فقط بهذا الشكل: {"days":[{"dayIndex":1,"dateLabel":"اليوم 1","focusTheme":"عنوان اليوم","tasks":[{"subjectId":"arabic","branchTitle":"النحو","lessonTitle":"الدرس","modeId":"detailed","durationMinutes":45,"notes":"ملاحظة"}]}]}',
        userContent: prompt,
        jsonMode: true,
      });
      const parsed = safeParseAiJson<{ days?: typeof rawDays }>(raw, { days: [] });
      rawDays = parsed.days || [];
    } else {
      const apiKey = getRequiredGeminiKey(settings);
      const scheduleSchema = {
        type: 'OBJECT',
        properties: {
          days: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                dayIndex: { type: 'INTEGER' },
                dateLabel: { type: 'STRING' },
                focusTheme: { type: 'STRING' },
                tasks: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      subjectId: { type: 'STRING' },
                      branchTitle: { type: 'STRING' },
                      lessonTitle: { type: 'STRING' },
                      modeId: { type: 'STRING' },
                      durationMinutes: { type: 'INTEGER' },
                      notes: { type: 'STRING' },
                    },
                    required: [
                      'subjectId',
                      'branchTitle',
                      'lessonTitle',
                      'modeId',
                      'durationMinutes',
                    ],
                  },
                },
              },
              required: ['dayIndex', 'dateLabel', 'focusTheme', 'tasks'],
            },
          },
        },
        required: ['days'],
      };

      const { result: raw } = await callGeminiWithDirectFallback({
        primaryModel: model,
        fallbackModel: DEFAULT_GEMINI_MODEL,
        maxAttempts: 2,
        timeoutMs: 25000,
        operation: (activeModel) =>
          callGeminiDirect({
            apiKey,
            model: activeModel,
            systemInstruction:
              'أنت مخطط دراسي خبير لطلاب البكالوريا المصرية. أنشئ جدولاً عملياً منظماً وموزوناً بالأوقات والأوضاع السبعة.',
            parts: [{ text: prompt }],
            responseMimeType: 'application/json',
            responseSchema: scheduleSchema,
            thinkingLevel:
              activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
                ? 'LOW'
                : undefined,
          }),
      });

      const parsed = safeParseAiJson<{ days?: typeof rawDays }>(raw || '', { days: [] });
      rawDays = parsed.days || [];
    }
  }

  const validSubjectIds = new Set<string>(OFFICIAL_SUBJECTS.map((s) => s.id));
  const validModeIds = new Set<string>(STUDY_MODES.map((m) => m.id));

  return rawDays.map((day, dIdx) => ({
    dayIndex: day.dayIndex || dIdx + 1,
    dateLabel: day.dateLabel || `اليوم ${dIdx + 1}`,
    focusTheme: day.focusTheme || 'مذاكرة وتطبيق',
    tasks: (day.tasks || []).map((task, tIdx) => ({
      id: `task_${Date.now()}_${dIdx}_${tIdx}`,
      subjectId: (validSubjectIds.has(task.subjectId || '')
        ? task.subjectId
        : subjectsSummary[0]?.id || 'arabic') as SubjectId,
      branchTitle: task.branchTitle || 'عام',
      lessonTitle: task.lessonTitle || 'مراجعة عامة',
      modeId: (validModeIds.has(task.modeId || '') ? task.modeId : 'detailed') as StudyModeId,
      durationMinutes: typeof task.durationMinutes === 'number' ? task.durationMinutes : 45,
      completed: false,
      notes: task.notes || '',
    })),
  }));
}

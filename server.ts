import dotenv from 'dotenv';
dotenv.config();

import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import {
  isEnglishStemSubject,
  sanitizeSpokenScript,
  STUDY_MODES,
  OFFICIAL_SUBJECTS,
} from './src/utils/studyLogic.ts';
import {
  DEFAULT_GEMINI_MODEL,
  callGeminiWithFallback,
  normalizeGeminiModelId,
  parseSafeJsonResponse,
  parseUpstreamAiError,
  withRetryBackoff,
} from './src/utils/aiResilience.ts';
import {
  buildDeepCurriculumPrompt,
  extractTableOfContentsSnippet,
  mergeBranchExtractions,
  safeParseAiJson,
  splitSourceIntoChunks,
  type ExtractedBranch,
} from './src/utils/sourceAnalysis.ts';
import type {
  QuizQuestion,
  SourceAnalysisReport,
  StudyModeId,
  SubjectId,
} from './src/types/study.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface ProviderConfig {
  provider: 'gemini' | 'openai_compatible' | 'ollama';
  modelId: string;
  openAiBaseUrl?: string;
  openAiApiKey?: string;
}

function resolveModelName(modelId?: string, provider?: ProviderConfig['provider']): string {
  if (provider === 'openai_compatible' || provider === 'ollama') {
    const trimmed = (modelId || '').trim();
    return trimmed || 'gpt-4o-mini';
  }
  return normalizeGeminiModelId(modelId);
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'مفتاح GEMINI_API_KEY غير مضبوط في متغيرات بيئة الخادم.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function validateExternalOpenAiUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('رابط الـ API غير صالح.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('يجب أن يبدأ رابط مزود OpenAI-Compatible بـ https:// لأغراض الأمان.');
  }

  const host = parsed.hostname.toLowerCase();
  const blockedPrefixes = ['127.', '10.', '192.168.', '169.254.', '0.'];
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    blockedPrefixes.some((prefix) => host.startsWith(prefix)) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('لا يُسمح بالاتصال بعناوين الشبكة المحلية من الخادم. استخدم خيار Ollama المحلي للاتصال بجهازك.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

async function callOpenAiCompatible(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
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
      { role: 'user', content: params.userPrompt },
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
  return content;
}

function getErrorStatusMessage(err: unknown): { status: number; message: string } {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error('[Bacc-AI Upstream Error]', errMsg.slice(0, 400));
  const { status, message } = parseUpstreamAiError(err);
  return { status, message };
}

const app = express();
app.use(express.json({ limit: '25mb' }));

// 1. Test AI connection endpoint
  app.post('/api/ai/test', async (req: Request, res: Response) => {
    const started = Date.now();
    try {
      const config = (req.body?.config || {}) as ProviderConfig;
      const model = resolveModelName(config.modelId, config.provider);

      if (config.provider === 'openai_compatible') {
        const text = await callOpenAiCompatible({
          baseUrl: config.openAiBaseUrl || '',
          apiKey: config.openAiApiKey || '',
          model,
          systemInstruction: 'أجب بكلمة واحدة: جاهز',
          userPrompt: 'اختبار اتصال',
        });
        res.json({
          ok: true,
          latencyMs: Date.now() - started,
          model,
          message: `تم الاتصال بنجاح (${model}): ${text.slice(0, 60)}`,
        });
        return;
      }

      const ai = createGeminiClient();
      const response = await withRetryBackoff(
        () =>
          ai.models.generateContent({
            model,
            contents: 'قل "تم الاتصال بنجاح" باللغة العربية فقط.',
            config: {
              thinkingConfig:
                model.startsWith('gemini-4') || model.startsWith('gemini-3')
                  ? { thinkingLevel: ThinkingLevel.LOW }
                  : undefined,
            },
          }),
        { maxAttempts: 2, baseDelayMs: 600, timeoutMs: 12000 }
      );

      res.json({
        ok: true,
        latencyMs: Date.now() - started,
        model,
        message: `تم الاتصال بنجاح بالنموذج ${model} (${Date.now() - started}ms): ${(response.text || '').trim().slice(0, 80)}`,
      });
    } catch (err) {
      const { status, message } = getErrorStatusMessage(err);
      res.status(status).json({ ok: false, message });
    }
  });

  // 2. Study Room tutoring generation (all 7 modes)
  app.post('/api/ai/generate', async (req: Request, res: Response) => {
    try {
      const {
        config,
        modeId,
        systemInstruction,
        userPrompt,
      }: {
        config: ProviderConfig;
        modeId: StudyModeId;
        systemInstruction: string;
        userPrompt: string;
      } = req.body;

      if (!userPrompt || !systemInstruction) {
        res.status(400).json({ error: 'بيانات الطلب غير مكتملة.' });
        return;
      }

      const model = resolveModelName(config?.modelId, config?.provider);

      // Mode 7: 100-question bank
      if (modeId === 'question_bank') {
        if (config?.provider === 'openai_compatible') {
          const jsonPrompt = `${userPrompt}\n\nأعد JSON فقط على الشكل التالي يحتوي على 100 سؤال بالضبط (35 سهل، 40 متوسط، 25 مستويات عليا):
{"questions":[{"question":"نص السؤال","options":["أ","ب","ج","د"],"correctIndex":0,"difficulty":"easy","explanation":"تفسير قصير"}]}`;
          const raw = await callOpenAiCompatible({
            baseUrl: config.openAiBaseUrl || '',
            apiKey: config.openAiApiKey || '',
            model,
            systemInstruction,
            userPrompt: jsonPrompt,
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
            difficulty:
              q.difficulty === 'medium' || q.difficulty === 'hard' ? q.difficulty : 'easy',
            explanation: q.explanation || '',
          }));
          res.json({ questions, text: '' });
          return;
        }

        const ai = createGeminiClient();
        const questionBankSchema = {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  correctIndex: { type: Type.INTEGER },
                  difficulty: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['question', 'options', 'correctIndex', 'difficulty', 'explanation'],
              },
            },
          },
          required: ['questions'],
        };

        // Run 2 parallel 50-question batches to reliably deliver all 100 questions quickly
        const batchPrompts = [
          {
            label: 'الدفعة الأولى (50 سؤال: 35 مستوى سهل easy + 15 مستوى متوسط medium)',
            instruction: `${userPrompt}\n\nأنشئ الدفعة الأولى: 50 سؤال اختيار من متعدد بالضبط (35 سؤال difficulty="easy" و 15 سؤال difficulty="medium"). كل سؤال به 4 اختيارات دقيقة وcorrectIndex من 0 إلى 3 وتفسير مختصر بالعامية المصرية.`,
          },
          {
            label: 'الدفعة الثانية (50 سؤال: 25 مستوى متوسط medium + 25 مستويات عليا hard)',
            instruction: `${userPrompt}\n\nأنشئ الدفعة الثانية (أسئلة جديدة تماماً ومختلفة عن الأسئلة البديهية): 50 سؤال اختيار من متعدد بالضبط (25 سؤال difficulty="medium" و 25 سؤال difficulty="hard" مستويات تفكير عليا وتطبيق وتحليل). كل سؤال به 4 اختيارات دقيقة وcorrectIndex من 0 إلى 3 وتفسير مختصر بالعامية المصرية.`,
          },
        ];

        const batchResults = await Promise.all(
          batchPrompts.map(async (batch) => {
            const { result: resp } = await callGeminiWithFallback({
              primaryModel: model,
              fallbackModel: DEFAULT_GEMINI_MODEL,
              maxAttempts: 2,
              timeoutMs: 22000,
              operation: (activeModel) =>
                ai.models.generateContent({
                  model: activeModel,
                  contents: batch.instruction,
                  config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: questionBankSchema,
                    thinkingConfig:
                      activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
                        ? { thinkingLevel: ThinkingLevel.LOW }
                        : undefined,
                  },
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
            }>((resp.text || '{"questions":[]}').trim(), { questions: [] });
            return parsed.questions || [];
          })
        );

        const combined = [...batchResults[0], ...batchResults[1]].slice(0, 100);
        const questions: QuizQuestion[] = combined.map((q, idx) => ({
          id: idx + 1,
          question: q.question,
          options: Array.isArray(q.options) && q.options.length >= 2 ? q.options.slice(0, 4) : ['أ', 'ب', 'ج', 'د'],
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

        res.json({ questions, text: '' });
        return;
      }

      // Modes 1-6: Text/Markdown or Spoken Script generation
      let outputText = '';
      if (config?.provider === 'openai_compatible') {
        outputText = await callOpenAiCompatible({
          baseUrl: config.openAiBaseUrl || '',
          apiKey: config.openAiApiKey || '',
          model,
          systemInstruction,
          userPrompt,
        });
      } else {
        const ai = createGeminiClient();
        const { result: response } = await callGeminiWithFallback({
          primaryModel: model,
          fallbackModel: DEFAULT_GEMINI_MODEL,
          maxAttempts: 2,
          timeoutMs: 22000,
          operation: (activeModel) =>
            ai.models.generateContent({
              model: activeModel,
              contents: userPrompt,
              config: {
                systemInstruction,
                thinkingConfig:
                  activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
                    ? { thinkingLevel: ThinkingLevel.LOW }
                    : undefined,
              },
            }),
        });
        outputText = (response.text || '').trim();
      }

      if (modeId === 'script') {
        outputText = sanitizeSpokenScript(outputText);
      }

      res.json({ text: outputText });
    } catch (err) {
      const { status, message } = getErrorStatusMessage(err);
      res.status(status).json({ error: message });
    }
  });

  // 3A. Multimodal OCR for images and scanned PDF pages
  app.post('/api/ai/ocr', async (req: Request, res: Response) => {
    try {
      const {
        config,
        subjectNameAr,
        images,
      }: {
        config: ProviderConfig;
        subjectNameAr: string;
        images: Array<{ label: string; mimeType: string; base64Data: string }>;
      } = req.body;

      if (!Array.isArray(images) || images.length === 0) {
        res.status(400).json({ error: 'لا توجد صور مرفقة لقراءتها عبر OCR.' });
        return;
      }

      const model = resolveModelName(config?.modelId, config?.provider);
      const ocrSystemPrompt = `أنت محرك OCR أكاديمي فائق الدقة متخصص في مناهج الصف الأول الثانوي (البكالوريا المصرية - مادة ${subjectNameAr}).
قواعد الاستخراج:
1. استخرج كل النصوص المكتوبة في الصور بدقة كاملة باللغة العربية والإنجليزية والألمانية كما تظهر في الصفحة دون تلخيص أو حذف أو اختصار.
2. حافظ على العناوين الرئيسية والفرعية وعناوين الوحدات والدروس بعلامات Markdown (# و ##) لتسهيل تحليل المنهج لاحقاً.
3. انقل الجداول بتنسيق Markdown المنظم، وحوّل المعادلات الرياضية والعلمية والرموز الكيميائية إلى صيغة LaTeX دقيقة ($...$ أو $$...$$).
4. افصل بين كل صفحة أو صورة بعنوان واضح مثل: --- [اسم الصفحة/الصورة] ---.`;

      const labelsList = images.map((img) => img.label).join('، ');

      if (config?.provider === 'openai_compatible') {
        const cleanUrl = validateExternalOpenAiUrl(config.openAiBaseUrl || '');
        const key = (config.openAiApiKey || '').trim();
        if (!key) {
          throw new Error('يرجى إدخال مفتاح الـ API الخاص بالمزود في صفحة الإعدادات.');
        }

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

        const resp = await fetch(`${cleanUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: ocrSystemPrompt },
              { role: 'user', content: contentParts },
            ],
          }),
        });

        const data = await parseSafeJsonResponse<{
          choices?: Array<{ message?: { content?: string } }>;
        }>(resp, 'خطأ في قراءة استجابة خدمة OCR الخارجية');
        res.json({ text: (data?.choices?.[0]?.message?.content || '').trim() });
        return;
      }

      const ai = createGeminiClient();
      const imageParts = images.map((img) => ({
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: img.base64Data,
        },
      }));

      const { result: response } = await callGeminiWithFallback({
        primaryModel: model,
        fallbackModel: DEFAULT_GEMINI_MODEL,
        maxAttempts: 2,
        timeoutMs: 14000,
        operation: (activeModel) =>
          ai.models.generateContent({
            model: activeModel,
            contents: {
              parts: [
                ...imageParts,
                {
                  text: `استخرج النص الكامل من هذه الصور بالترتيب (${labelsList}) بدقة تامة دون حذف أي فقرة أو درس أو مسألة.`,
                },
              ],
            },
            config: {
              systemInstruction: ocrSystemPrompt,
              thinkingConfig:
                activeModel === 'gemini-3.1-flash-lite'
                  ? { thinkingLevel: ThinkingLevel.MINIMAL }
                  : activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
                    ? { thinkingLevel: ThinkingLevel.LOW }
                    : undefined,
            },
          }),
      });

      res.json({ text: (response.text || '').trim() });
    } catch (err) {
      const { status, message } = getErrorStatusMessage(err);
      res.status(status).json({ error: message });
    }
  });

  // 3B. Deep AI Curriculum Extraction from active sources (Chunked TOC-Aware Deep Analysis)
  app.post('/api/ai/extract-curriculum', async (req: Request, res: Response) => {
    try {
      const {
        config,
        subjectId,
        subjectNameAr,
        languageSchoolMode = true,
        sourcesText,
      }: {
        config: ProviderConfig;
        subjectId?: SubjectId;
        subjectNameAr: string;
        languageSchoolMode?: boolean;
        sourcesText: string;
      } = req.body;

      if (!sourcesText || !sourcesText.trim()) {
        res.status(400).json({ error: 'لا توجد نصوص مصادر نشطة لتحليلها.' });
        return;
      }

      const requireEnglishTitles = Boolean(
        subjectId && isEnglishStemSubject(subjectId, languageSchoolMode)
      );
      const model = resolveModelName(config?.modelId, config?.provider);
      const tocOutline = extractTableOfContentsSnippet(sourcesText);
      const chunks = splitSourceIntoChunks(sourcesText, 26000, 1200);

      interface RawChunkAnalysis {
        summary?: string;
        coverageAssessment?: string;
        keyConcepts?: string[];
        studyRecommendations?: string[];
        branches?: ExtractedBranch[];
      }

      const chunkOutputs: RawChunkAnalysis[] = [];

      if (config?.provider === 'openai_compatible') {
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
            baseUrl: config.openAiBaseUrl || '',
            apiKey: config.openAiApiKey || '',
            model,
            systemInstruction: `أنت محلل مناهج تعليمية خبير لنظام البكالوريا المصرية. ${englishRule} أعد JSON فقط بهذا الشكل: {"summary":"ملخص تحليلي دقيق","coverageAssessment":"تقييم تغطية المصدر","keyConcepts":["مفهوم 1"],"studyRecommendations":["توصية 1"],"branches":[{"title":"اسم الفرع","lessons":["اسم الدرس 1","اسم الدرس 2"]}]}`,
            userPrompt: prompt,
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
        const ai = createGeminiClient();
        const branchTitleDesc = requireEnglishTitles
          ? 'Academic branch or unit title strictly in English (e.g., "Unit 1: Algebra & Equations", "Trigonometry", "Aquatic Ecosystem", "Python Fundamentals"). Never use Arabic.'
          : 'اسم الفرع الأكاديمي أو الوحدة الرئيسية المستخرجة من المصدر بدون أرقام صفحات';
        const lessonDesc = requireEnglishTitles
          ? 'Exact list of lessons/topics inside this branch strictly in English (e.g., "Complex Numbers", "Quadratic Equations"). Never use Arabic or page numbers.'
          : 'قائمة الدروس الفعلية داخل هذا الفرع كما وردت في المصدر بدون أرقام صفحات';

        const schema = {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'ملخص تحليلي دقيق وموجز يوضح الفروع والمحاور الأساسية التي غطاها هذا الجزء',
            },
            coverageAssessment: {
              type: Type.STRING,
              description: 'تقييم تغطية المصدر (مثلاً: كتاب منهج شامل / ملزمة وحدة / فهرس موضوعات)',
            },
            keyConcepts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'أهم المفاهيم والقوانين والمهارات المحورية المستخرجة من هذا الجزء',
            },
            studyRecommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'توصيات عملية للطالب حول كيفية مذاكرة وفهم موضوعات هذا الجزء بكفاءة',
            },
            branches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: branchTitleDesc,
                  },
                  lessons: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
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

        // Controlled concurrency pool (up to 3 chunks at a time) for reliability
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

            const { result: response } = await callGeminiWithFallback({
              primaryModel: model,
              fallbackModel: DEFAULT_GEMINI_MODEL,
              maxAttempts: 2,
              timeoutMs: 28000,
              operation: (activeModel) =>
                ai.models.generateContent({
                  model: activeModel,
                  contents: prompt,
                  config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: schema,
                    thinkingConfig:
                      activeModel === 'gemini-3.1-flash-lite'
                        ? undefined
                        : activeModel.startsWith('gemini-4')
                          ? { thinkingLevel: ThinkingLevel.MEDIUM }
                          : activeModel.startsWith('gemini-3')
                            ? { thinkingLevel: ThinkingLevel.LOW }
                            : undefined,
                  },
                }),
            });

            resultsArray[currentIdx] = safeParseAiJson<RawChunkAnalysis>(
              response.text || '',
              {
                summary: '',
                coverageAssessment: '',
                keyConcepts: [],
                studyRecommendations: [],
                branches: [],
              }
            );
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

      res.json({
        branches: mergedBranches,
        analysisSummary: overview,
        analysisReport,
      });
    } catch (err) {
      const { status, message } = getErrorStatusMessage(err);
      res.status(status).json({ error: message });
    }
  });

  // 4. Smart Study Scheduler (Structured JSON Output mapped to 7 study modes)
  app.post('/api/ai/generate-schedule', async (req: Request, res: Response) => {
    try {
      const {
        config,
        examDate,
        dailyHours,
        languageSchoolMode = true,
        subjectsSummary,
      }: {
        config: ProviderConfig;
        examDate: string;
        dailyHours: number;
        languageSchoolMode?: boolean;
        subjectsSummary: Array<{
          id: SubjectId;
          nameAr: string;
          branches: Array<{ title: string; lessons: string[] }>;
        }>;
      } = req.body;

      const validSubjectIds = OFFICIAL_SUBJECTS.map((s) => s.id).join(', ');
      const validModeIds = STUDY_MODES.map((m) => `${m.id} (${m.label})`).join('، ');
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
- استخدم معرفات المواد التالية فقط في subjectId: ${validSubjectIds}
- استخدم معرفات الأوضاع التالية فقط في modeId: ${validModeIds}
${englishStemNote}
- وزع المهام بين أوضاع الشرح ("detailed")، المراجعة السريعة ("quick_review")، المراجعة الشاملة ("comprehensive_review")، وبنك الأسئلة ("question_bank") أو الاسكريبت ("script").
- لا تتجاوز مدة المهام اليومية الإجمالية (${dailyHours * 60} دقيقة) في اليوم الواحد.`;

      const model = resolveModelName(config?.modelId, config?.provider);

      if (config?.provider === 'openai_compatible') {
        const raw = await callOpenAiCompatible({
          baseUrl: config.openAiBaseUrl || '',
          apiKey: config.openAiApiKey || '',
          model,
          systemInstruction:
            'أعد JSON فقط بهذا الشكل: {"days":[{"dayIndex":1,"dateLabel":"اليوم 1","focusTheme":"عنوان اليوم","tasks":[{"subjectId":"arabic","branchTitle":"النحو","lessonTitle":"الدرس","modeId":"detailed","durationMinutes":45,"notes":"ملاحظة"}]}]}',
          userPrompt: prompt,
          jsonMode: true,
        });
        const parsed = safeParseAiJson<{ days?: unknown[] }>(raw, { days: [] });
        res.json({ days: parsed.days || [] });
        return;
      }

      const ai = createGeminiClient();
      const { result: response } = await callGeminiWithFallback({
        primaryModel: model,
        fallbackModel: DEFAULT_GEMINI_MODEL,
        maxAttempts: 2,
        timeoutMs: 20000,
        operation: (activeModel) =>
          ai.models.generateContent({
            model: activeModel,
            contents: prompt,
            config: {
              systemInstruction:
                'أنت مخطط دراسي خبير لطلاب البكالوريا المصرية. أنشئ جدولاً عملياً منظماً وموزوناً بالأوقات والأوضاع السبعة.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  days: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        dayIndex: { type: Type.INTEGER },
                        dateLabel: { type: Type.STRING },
                        focusTheme: { type: Type.STRING },
                        tasks: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              subjectId: { type: Type.STRING },
                              branchTitle: { type: Type.STRING },
                              lessonTitle: { type: Type.STRING },
                              modeId: { type: Type.STRING },
                              durationMinutes: { type: Type.INTEGER },
                              notes: { type: Type.STRING },
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
              },
              thinkingConfig:
                activeModel === 'gemini-3.1-flash-lite'
                  ? undefined
                  : activeModel.startsWith('gemini-4') || activeModel.startsWith('gemini-3')
                    ? { thinkingLevel: ThinkingLevel.LOW }
                    : undefined,
            },
          }),
      });

      const parsed = safeParseAiJson<{ days?: unknown[] }>(response.text || '', { days: [] });
      res.json({ days: parsed.days || [] });
    } catch (err) {
      const { status, message } = getErrorStatusMessage(err);
      res.status(status).json({ error: message });
    }
  });

// Ensure unmatched /api/* routes and Express errors always return valid JSON (never HTML/text)
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'مسار الـ API المطلوب غير موجود (404).' });
});

app.use(
  (
    err: { status?: number; message?: string },
    req: Request,
    res: Response,
    next: (err?: unknown) => void
  ) => {
    if (req.path.startsWith('/api/')) {
      const status = typeof err?.status === 'number' ? err.status : 500;
      res.status(status).json({
        ok: false,
        error: err?.message || 'حدث خطأ غير متوقع في الخادم.',
      });
      return;
    }
    next(err);
  }
);

async function startServer() {
  // Vite dev middleware vs static production dist (standalone Node mode)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bacc-AI Study Hub server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;

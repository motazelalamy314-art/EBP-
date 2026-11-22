import type { SubjectId } from '../types/study.ts';
import { isEnglishStemSubject } from './studyLogic.ts';

export interface ExtractedBranch {
  title: string;
  lessons: string[];
}

const NOISE_TITLES = new Set([
  'table of contents',
  'contents',
  'index',
  'preface',
  'cover',
  'introduction to book',
  'الفهرس',
  'فهرس الكتاب',
  'المحتويات',
  'قائمه المحتويات',
  'الغلاف',
  'المقدمه',
]);

/**
 * Normalizes Arabic and Latin text for smart branch/lesson deduplication across chunks.
 */
export function normalizeArabicKey(input: string): string {
  return input
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '') // Strip Arabic tashkeel diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Strips TOC dot leaders, trailing page numbers, and stray bullet prefixes from extracted branch/lesson titles.
 */
export function cleanCurriculumTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/^[\u2022\-*•]+\s*/, '')
    .replace(/\.{2,}\s*\d*\s*$/g, '')
    .replace(/[\s\-–—|]*(?:ص|صفحة|p\.?|page)\s*\d+\s*$/i, '')
    .replace(/\s+\(\s*\d+\s*\)\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isNonCurriculumNoise(title: string): boolean {
  const key = normalizeArabicKey(cleanCurriculumTitle(title));
  if (!key || key.length < 2) return true;
  if (/^\d+$/.test(key)) return true;
  return NOISE_TITLES.has(key);
}

/**
 * Splits long source text into chunks with smart boundary selection and small overlap
 * so unit headers near chunk borders remain linked to their lessons.
 */
export function splitSourceIntoChunks(
  text: string,
  maxChunkChars = 26000,
  overlapChars = 1200
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChunkChars) return [clean];

  const safeOverlap = Math.max(0, Math.min(overlapChars, Math.floor(maxChunkChars * 0.2)));
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length) {
    let end = Math.min(cursor + maxChunkChars, clean.length);
    if (end < clean.length) {
      const doubleNewline = clean.lastIndexOf('\n\n', end);
      if (doubleNewline > cursor + maxChunkChars * 0.5) {
        end = doubleNewline;
      } else {
        const singleNewline = clean.lastIndexOf('\n', end);
        if (singleNewline > cursor + maxChunkChars * 0.5) {
          end = singleNewline;
        } else {
          const spaceIdx = clean.lastIndexOf(' ', end);
          if (spaceIdx > cursor + maxChunkChars * 0.5) {
            end = spaceIdx;
          }
        }
      }
    }

    const slice = clean.slice(cursor, end).trim();
    if (slice) {
      chunks.push(slice);
    }

    if (end >= clean.length) break;

    const nextStart = Math.max(cursor + 1, end - safeOverlap);
    // Align overlap start cleanly to a newline or space if nearby
    const nextNewline = clean.indexOf('\n', nextStart);
    cursor =
      nextNewline !== -1 && nextNewline < end - 50
        ? nextNewline + 1
        : nextStart;
  }

  return chunks;
}

/**
 * Extracts Table of Contents / structural heading lines from the source text so every
 * chunk knows the overall curriculum skeleton while analyzing detailed pages.
 */
export function extractTableOfContentsSnippet(text: string, maxChars = 3500): string {
  const lines = text.split(/\r?\n/);
  const headingPattern =
    /^(?:#{1,4}\s+|unit\s+\d+|chapter\s+\d+|module\s+\d+|lesson\s+\d+|topic\s+\d+|section\s+\d+|الوحدة|الفصل|الباب|الدرس|الموضوع|المحور|contents|table of contents|فهرس|المحتويات)/i;

  const picked: string[] = [];
  let total = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const isEarlyToc = i < 160 && (headingPattern.test(trimmed) || /\.{3,}\s*\d+/.test(trimmed));
    const isClearHeading = headingPattern.test(trimmed) && trimmed.length <= 140;

    if (isEarlyToc || isClearHeading) {
      if (total + trimmed.length + 1 > maxChars) break;
      picked.push(trimmed);
      total += trimmed.length + 1;
    }
  }

  return picked.join('\n').trim();
}

/**
 * Merges extracted branches from multiple source chunks, cleaning titles and deduplicating
 * branches and lessons using Arabic- and Latin-aware normalization.
 */
export function mergeBranchExtractions(chunkResults: ExtractedBranch[][]): ExtractedBranch[] {
  const branchOrder: string[] = [];
  const branchMap = new Map<
    string,
    {
      title: string;
      lessonKeys: Set<string>;
      lessons: string[];
    }
  >();

  for (const chunkBranches of chunkResults) {
    for (const branch of chunkBranches) {
      const rawTitle = cleanCurriculumTitle(branch.title || '');
      if (!rawTitle || isNonCurriculumNoise(rawTitle)) continue;
      const bKey = normalizeArabicKey(rawTitle);

      let entry = branchMap.get(bKey);
      if (!entry) {
        entry = {
          title: rawTitle,
          lessonKeys: new Set<string>(),
          lessons: [],
        };
        branchMap.set(bKey, entry);
        branchOrder.push(bKey);
      }

      for (const rawLesson of branch.lessons || []) {
        const cleanLesson = cleanCurriculumTitle(rawLesson || '');
        if (!cleanLesson || isNonCurriculumNoise(cleanLesson)) continue;
        const lKey = normalizeArabicKey(cleanLesson);
        if (!entry.lessonKeys.has(lKey)) {
          entry.lessonKeys.add(lKey);
          entry.lessons.push(cleanLesson);
        }
      }
    }
  }

  return branchOrder
    .map((key) => {
      const entry = branchMap.get(key)!;
      return {
        title: entry.title,
        lessons: entry.lessons,
      };
    })
    .filter((b) => b.lessons.length > 0);
}

/**
 * Safely parses JSON returned from an LLM even if wrapped in markdown code fences.
 */
export function safeParseAiJson<T>(rawText: string, fallback: T): T {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export function buildDeepCurriculumPrompt(params: {
  subjectNameAr: string;
  subjectId?: SubjectId;
  languageSchoolMode?: boolean;
  chunkText: string;
  chunkIndex: number;
  totalChunks: number;
  tocOutline?: string;
  preserveOriginalLanguage?: boolean;
}): string {
  const {
    subjectNameAr,
    subjectId,
    languageSchoolMode = true,
    chunkText,
    chunkIndex,
    totalChunks,
    tocOutline,
    preserveOriginalLanguage = true,
  } = params;

  const requireEnglishTitles = Boolean(
    subjectId && isEnglishStemSubject(subjectId, languageSchoolMode)
  );

  const languageDirective = requireEnglishTitles
    ? `قاعدة اللغة الإلزامية (مدارس اللغات - Language Schools):
   - هذه المادة (${subjectNameAr}) يدرسها الطالب باللغة الإنجليزية.
   - يجب أن تكون **جميع أسماء الفروع/الوحدات (branches[].title) وجميع أسماء الدروس (branches[].lessons[]) باللغة الإنجليزية الأكاديمية فقط** بدون أي كلمات عربية (مثلاً: "Unit 1: Algebra & Equations", "Quadratic Equations", "Aquatic Ecosystem", "Python Variables & Data Types").
   - إذا وردت عناوين عربية أو ثنائية اللغة في المصدر، قم بترجمتها بدقة إلى المصطلح العلمي الإنجليزي المعتمد في منهج مدارس اللغات المصرية.
   - أما حقول "summary" و"coverageAssessment" و"studyRecommendations" فاكتبها بالعربية الواضحة مع ذكر أسماء الدروس والمفاهيم بالإنجليزية.`
    : preserveOriginalLanguage
      ? 'حافظ على عناوين الفروع والدروس بلغتها الأكاديمية الأصلية كما وردت في المصدر دون اختصار مخل ودون اختراع أي درس غير موجود.'
      : 'استخرج كل درس أو موضوع رئيسي موجود فعلياً في النص تحت فرعه الصحيح.';

  const tocSection =
    tocOutline && totalChunks > 1
      ? `\nخريطة العناوين والفهرس المستخلصة من كامل الملف (للاستدلال بالوحدات الرئيسية فقط — استخرج الدروس التفصيلية من نص هذا الجزء):\n${tocOutline}\n`
      : '';

  return `قم بتحليل الجزء (${chunkIndex + 1} من ${totalChunks}) من نصوص المصادر التعليمية الخاصة بمادة "${subjectNameAr}" للصف الأول الثانوي (البكالوريا المصرية) تحليلاً معمقاً ودقيقاً جداً.

المطلوب بدقة:
1. افحص الفهرس، عناوين الوحدات (Units / Chapters)، العناوين الفرعية، الأهداف، والمفاهيم الفعلية داخل النص.
2. نظم المحتوى إلى الفروع الأكاديمية أو الوحدات الحقيقية الواردة في النص دون تكرار، مع إزالة أرقام الصفحات والنقاط الزائدة (.... 12) من عناوين الدروس.
3. لا تضع عناوين عامة مثل "الفهرس" أو "الغلاف" أو "المحتويات" كفروع أو دروس.
4. ${languageDirective}
5. استخرج قائمة بأهم المفاهيم والقوانين والأفكار المحورية (keyConcepts - من 4 إلى 8 عناصر) وتوصيات عملية لمذاكرة هذا الجزء (studyRecommendations - من 2 إلى 4 توصيات).
6. حدد تقييم التغطية (coverageAssessment) واكتب ملخصاً تحليلياً دقيقاً في حقل "summary".
${tocSection}
نص المصدر (الجزء ${chunkIndex + 1}/${totalChunks}):
${chunkText}`;
}

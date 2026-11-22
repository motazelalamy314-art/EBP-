import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeepCurriculumPrompt,
  cleanCurriculumTitle,
  extractTableOfContentsSnippet,
  mergeBranchExtractions,
  normalizeArabicKey,
  safeParseAiJson,
  splitSourceIntoChunks,
} from './sourceAnalysis';

test('normalizeArabicKey normalizes diacritics, alef forms, teh marbuta, and spaces', () => {
  assert.equal(normalizeArabicKey('  النَّحْوُ  '), normalizeArabicKey('النحو'));
  assert.equal(normalizeArabicKey('إعراب الأسماء'), normalizeArabicKey('اعراب الاسماء'));
  assert.equal(normalizeArabicKey('البلاغة'), normalizeArabicKey('البلاغه'));
});

test('cleanCurriculumTitle strips TOC dot leaders, trailing page numbers, and bullets', () => {
  assert.equal(
    cleanCurriculumTitle('• Lesson 1: Complex Numbers ...... 14'),
    'Lesson 1: Complex Numbers'
  );
  assert.equal(
    cleanCurriculumTitle('التشبيه البليغ ص 25'),
    'التشبيه البليغ'
  );
});

test('splitSourceIntoChunks preserves full coverage across overlapping chunks', () => {
  const paragraphA = 'الدرس الأول: كان وأخواتها.\n'.repeat(80);
  const paragraphB = 'الدرس الثاني: كاد وأخواتها.\n'.repeat(80);
  const fullText = `${paragraphA}\n\n${paragraphB}`;

  const chunks = splitSourceIntoChunks(fullText, 1200, 150);
  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].includes('كان وأخواتها'));
  assert.ok(chunks[chunks.length - 1].includes('كاد وأخواتها'));
});

test('mergeBranchExtractions combines matching branches, filters noise, and removes duplicate lessons', () => {
  const chunk1 = [
    { title: 'النحو', lessons: ['كان وأخواتها ... 12', 'كاد وأخواتها', 'الفهرس'] },
    { title: 'البلاغة', lessons: ['التشبيه البليغ'] },
    { title: 'Table of Contents', lessons: ['1'] },
  ];
  const chunk2 = [
    { title: 'النَّحْو', lessons: ['كان وأخواتها', 'إن وأخواتها'] },
    { title: 'الأدب', lessons: ['الأدب في العصر الجاهلي'] },
  ];

  const merged = mergeBranchExtractions([chunk1, chunk2]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].title, 'النحو');
  assert.deepEqual(merged[0].lessons, ['كان وأخواتها', 'كاد وأخواتها', 'إن وأخواتها']);
  assert.deepEqual(merged[1].lessons, ['التشبيه البليغ']);
  assert.deepEqual(merged[2].lessons, ['الأدب في العصر الجاهلي']);
});

test('extractTableOfContentsSnippet captures unit and lesson headings cleanly', () => {
  const text = [
    'Unit 1: Algebra & Relations',
    'Lesson 1: Complex Numbers ..... 5',
    'Some body text describing imaginary unit i.',
    'Unit 2: Trigonometry',
  ].join('\n');

  const toc = extractTableOfContentsSnippet(text);
  assert.ok(toc.includes('Unit 1: Algebra & Relations'));
  assert.ok(toc.includes('Lesson 1: Complex Numbers'));
  assert.ok(toc.includes('Unit 2: Trigonometry'));
});

test('buildDeepCurriculumPrompt enforces strict English branch/lesson names for Language School STEM subjects', () => {
  const prompt = buildDeepCurriculumPrompt({
    subjectNameAr: 'Mathematics',
    subjectId: 'math',
    languageSchoolMode: true,
    chunkText: 'الوحدة الأولى: الأعداد المركبة',
    chunkIndex: 0,
    totalChunks: 2,
    tocOutline: 'Unit 1: Complex Numbers',
  });

  assert.ok(prompt.includes('1 من 2'));
  assert.ok(prompt.includes('باللغة الإنجليزية الأكاديمية فقط'));
  assert.ok(prompt.includes('Unit 1: Complex Numbers'));
});

test('safeParseAiJson parses markdown-fenced JSON responses cleanly', () => {
  const parsed = safeParseAiJson<{ branches: Array<{ title: string; lessons: string[] }> }>(
    '```json\n{"branches":[{"title":"Algebra","lessons":["Complex Numbers"]}]}\n```',
    { branches: [] }
  );
  assert.equal(parsed.branches.length, 1);
  assert.equal(parsed.branches[0].title, 'Algebra');
});

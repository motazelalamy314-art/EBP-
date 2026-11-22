import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfExtractionProgress {
  currentPage: number;
  totalPages: number;
  charCount: number;
}

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  charCount: number;
  isLikelyScanned: boolean;
}

export interface OcrImagePayload {
  label: string;
  mimeType: string;
  base64Data: string;
}

export async function extractTextFromPdfFile(
  file: File,
  onProgress?: (progress: PdfExtractionProgress) => void
): Promise<PdfExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pageTexts: string[] = [];
  let charCount = 0;

  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const lines: string[] = [];
    let currentLineTokens: string[] = [];
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const text = item.str;
      const y = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
      const yChanged =
        lastY !== null && y !== null && Math.abs(y - lastY) > 3.5;

      if (yChanged && currentLineTokens.length > 0) {
        const built = currentLineTokens.join(' ').replace(/[ \t]+/g, ' ').trim();
        if (built) lines.push(built);
        currentLineTokens = [];
      }

      if (text.trim()) {
        currentLineTokens.push(text.trim());
      }

      if ('hasEOL' in item && item.hasEOL && currentLineTokens.length > 0) {
        const built = currentLineTokens.join(' ').replace(/[ \t]+/g, ' ').trim();
        if (built) lines.push(built);
        currentLineTokens = [];
        lastY = null;
      } else if (y !== null) {
        lastY = y;
      }
    }

    if (currentLineTokens.length > 0) {
      const built = currentLineTokens.join(' ').replace(/[ \t]+/g, ' ').trim();
      if (built) lines.push(built);
    }

    const pageText = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (pageText) {
      pageTexts.push(`--- صفحة ${pageNum} ---\n${pageText}`);
      charCount += pageText.length;
    }

    onProgress?.({
      currentPage: pageNum,
      totalPages,
      charCount,
    });
  }

  const fullText = pageTexts.join('\n\n').trim();
  // Detect image-only / scanned PDFs with practically no selectable text
  const avgCharsPerPage = totalPages > 0 ? charCount / totalPages : 0;
  const isLikelyScanned = totalPages > 0 && (charCount < 35 || avgCharsPerPage < 15);

  return {
    text: fullText,
    pageCount: totalPages,
    charCount,
    isLikelyScanned,
  };
}

/**
 * Renders a range of PDF pages into compressed JPEG base64 images for multimodal AI OCR.
 */
export async function renderPdfPageRangeToImages(
  file: File,
  options: {
    startPage: number;
    endPage: number;
    scale?: number;
    onRendered?: (pageNumber: number) => void;
  }
): Promise<OcrImagePayload[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const start = Math.max(1, options.startPage);
  const end = Math.min(pdf.numPages, Math.max(start, options.endPage));
  const scale = options.scale ?? 1.6;

  const results: OcrImagePayload[] = [];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('تعذر تهيئة Canvas لقراءة صفحات الـ PDF.');
  }

  for (let pageNum = start; pageNum <= end; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // Fill white background before rendering PDF page
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64Data = dataUrl.split(',')[1] || '';
    results.push({
      label: `صفحة ${pageNum}`,
      mimeType: 'image/jpeg',
      base64Data,
    });
    options.onRendered?.(pageNum);
  }

  canvas.width = 0;
  canvas.height = 0;
  return results;
}

/**
 * Converts an uploaded image file (.png/.jpg/.jpeg/.webp) into a resized JPEG base64 payload for OCR.
 */
export async function fileToOcrImage(file: File): Promise<OcrImagePayload> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`تعذر تحميل الصورة: ${file.name}`));
      image.src = objectUrl;
    });

    const maxDim = 2000;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('تعذر معالجة الصورة في المتصفح.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const base64Data = dataUrl.split(',')[1] || '';

    return {
      label: file.name,
      mimeType: 'image/jpeg',
      base64Data,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

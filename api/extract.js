import path from 'path';

function cleanText(input = '') {
  return String(input || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getTopLines(text = '', maxLines = 12) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function detectTitleFromTopLines(lines = []) {
  if (!lines.length) return null;

  const blocked = new Set([
    'name',
    'student id',
    'student no',
    'id no',
    'date',
    'signature',
    'programme',
    'faculty'
  ]);

  for (const line of lines) {
    const normalized = line.toLowerCase().trim();
    if (!normalized) continue;
    if (normalized.length < 6) continue;
    if (blocked.has(normalized)) continue;

    const looksLikeTitle =
      normalized.includes('form') ||
      normalized.includes('appeal') ||
      normalized.includes('withdrawal') ||
      normalized.includes('postponement') ||
      normalized.includes('deferment') ||
      normalized.includes('application') ||
      normalized.includes('request') ||
      normalized.includes('review');

    if (looksLikeTitle) {
      return line.trim();
    }
  }

  return lines[0] || null;
}

async function extractPdfTextFromBase64(base64String = '') {
  const pdfModule = await import('pdf-parse');
  const pdfParse = pdfModule.default || pdfModule;

  const buffer = Buffer.from(base64String, 'base64');
  const result = await pdfParse(buffer);
  return cleanText(result?.text || '');
}

export async function extractDocumentText({
  filename = '',
  rawText = '',
  fileUpload = null
}) {
  try {
    const ext = path.extname(String(filename || '')).toLowerCase();
    let text = '';

    if (rawText) {
      text = cleanText(rawText);
    }

    if (!text && fileUpload?.base64 && ext === '.pdf') {
      text = await extractPdfTextFromBase64(fileUpload.base64);
    }

    if (!text) {
      return {
        success: false,
        text: '',
        title: null,
        topLines: [],
        reason: `No readable document text extracted from ${filename || 'uploaded file'}.`
      };
    }

    const topLines = getTopLines(text, 12);
    const title = detectTitleFromTopLines(topLines);

    return {
      success: true,
      text,
      title,
      topLines,
      reason: null
    };
  } catch (error) {
    return {
      success: false,
      text: '',
      title: null,
      topLines: [],
      reason: `Document extraction failed: ${error.message}`
    };
  }
}
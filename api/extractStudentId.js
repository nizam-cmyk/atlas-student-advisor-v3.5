export function extractStudentId(text = '') {
  const source = String(text || '');

  const labeledPatterns = [
    /(?:student\s*id|student\s*no|id\s*no|id)\s*[:\-]?\s*((?:\d[\s-]*){6,12})/i,
    /(?:student\s*id|student\s*no|id\s*no|id)\s*[^\d]{0,10}((?:\d[\s-]*){6,12})/i
  ];

  for (const pattern of labeledPatterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      const cleaned = match[1].replace(/\D/g, '');
      if (cleaned.length >= 6 && cleaned.length <= 12) {
        return cleaned;
      }
    }
  }

  const spacedMatch = source.match(/\b(?:\d[\s-]*){8,12}\b/);
  if (spacedMatch) {
    const cleaned = spacedMatch[0].replace(/\D/g, '');
    if (cleaned.length >= 6 && cleaned.length <= 12) {
      return cleaned;
    }
  }

  const directMatch = source.match(/\b\d{6,12}\b/);
  return directMatch ? directMatch[0] : null;
}

export function extractStudentThirdDigit(studentId = '') {
  const value = String(studentId || '').replace(/\D/g, '').trim();
  return value.length >= 3 ? value.charAt(2) : null;
}
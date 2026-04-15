export function normaliseText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function countMatches(text, keywords = []) {
  return keywords.reduce((count, keyword) => {
    return count + (text.includes(keyword) ? 1 : 0);
  }, 0);
}

function buildCombinedText({ filename = '', documentText = '', extractedTitle = '', topLines = [] } = {}) {
  return normaliseText([
    filename,
    extractedTitle,
    ...(topLines || []),
    documentText
  ].filter(Boolean).join(' '));
}

export function detectFormType({
  filename = '',
  documentText = '',
  extractedTitle = '',
  topLines = []
} = {}) {
  const combined = buildCombinedText({
    filename,
    documentText,
    extractedTitle,
    topLines
  });

  const titleOnly = normaliseText(extractedTitle || '');
  const topOnly = normaliseText((topLines || []).join(' '));

  const dismissalTitleKeywords = [
    'academic dismissal appeal form',
    'dismissal appeal form',
    'appeal after academic dismissal'
  ];

  const dismissalCodeKeywords = [
    'rof-05',
    'rof 05'
  ];

  const dismissalFieldKeywords = [
    'reason for appeal',
    'academic advisor',
    'semester results',
    'supporting documents',
    'supporting evidence',
    'academic plan',
    'dismissal',
    'appeal',
    'faculty academic office'
  ];

  const withdrawalTitleKeywords = [
    'course withdrawal form',
    'withdrawal from course',
    'withdrawal from course or courses'
  ];

  const withdrawalFieldKeywords = [
    'reason for withdrawal',
    'course code',
    'course title',
    'w grade',
    'withdrawal',
    'subject withdrawal'
  ];

  const postponementTitleKeywords = [
    'application for postponement of studies',
    'postponement of studies',
    'deferment of studies',
    'application for deferment'
  ];

  const postponementFieldKeywords = [
    'reason for postponement',
    'reason for deferment',
    'semester to postpone',
    'semester to defer',
    'postponement',
    'deferment',
    'dean approval',
    'vice president academic'
  ];

  const feeReviewTitleKeywords = [
    'fee review request form',
    'fee review form',
    'bursary fee review request form'
  ];

  const feeReviewFieldKeywords = [
    'bursary department',
    'fees to be reviewed',
    'tuition fee',
    'semester fee',
    'fee review request',
    'charged in my account'
  ];

  const genericFormKeywords = [
    'student id',
    'student no',
    'id no',
    'signature',
    'date',
    'programme',
    'faculty',
    'form'
  ];

  if (containsAny(titleOnly, dismissalTitleKeywords) || containsAny(topOnly, dismissalTitleKeywords)) {
    return {
      formType: 'academic_dismissal_appeal',
      confidence: 0.97,
      signals: ['title matched academic dismissal appeal form']
    };
  }

  if (containsAny(titleOnly, withdrawalTitleKeywords) || containsAny(topOnly, withdrawalTitleKeywords)) {
    return {
      formType: 'course_withdrawal',
      confidence: 0.96,
      signals: ['title matched course withdrawal form']
    };
  }

  if (containsAny(titleOnly, postponementTitleKeywords) || containsAny(topOnly, postponementTitleKeywords)) {
    return {
      formType: 'postponement_of_studies',
      confidence: 0.96,
      signals: ['title matched postponement/deferment form']
    };
  }

  if (containsAny(titleOnly, feeReviewTitleKeywords) || containsAny(topOnly, feeReviewTitleKeywords)) {
    return {
      formType: 'fee_review_request',
      confidence: 0.97,
      signals: ['title matched fee review request form']
    };
  }

  const dismissalScore =
    countMatches(combined, dismissalTitleKeywords) * 4 +
    countMatches(combined, dismissalCodeKeywords) * 5 +
    countMatches(combined, dismissalFieldKeywords) * 2;

  const withdrawalScore =
    countMatches(combined, withdrawalTitleKeywords) * 4 +
    countMatches(combined, withdrawalFieldKeywords) * 2;

  const postponementScore =
    countMatches(combined, postponementTitleKeywords) * 4 +
    countMatches(combined, postponementFieldKeywords) * 2;

  const feeReviewScore =
    countMatches(combined, feeReviewTitleKeywords) * 4 +
    countMatches(combined, feeReviewFieldKeywords) * 2;

  const genericFormScore = countMatches(combined, genericFormKeywords);

  if (dismissalScore >= 5 && dismissalScore >= withdrawalScore && dismissalScore >= postponementScore && dismissalScore >= feeReviewScore) {
    return {
      formType: 'academic_dismissal_appeal',
      confidence: dismissalScore >= 9 ? 0.92 : 0.78,
      signals: dismissalFieldKeywords
        .filter((keyword) => combined.includes(keyword))
        .map((keyword) => `${keyword} detected`)
    };
  }

  if (withdrawalScore >= 5 && withdrawalScore >= postponementScore && withdrawalScore >= feeReviewScore) {
    return {
      formType: 'course_withdrawal',
      confidence: withdrawalScore >= 8 ? 0.9 : 0.74,
      signals: withdrawalFieldKeywords
        .filter((keyword) => combined.includes(keyword))
        .map((keyword) => `${keyword} detected`)
    };
  }

  if (postponementScore >= 5 && postponementScore >= feeReviewScore) {
    return {
      formType: 'postponement_of_studies',
      confidence: postponementScore >= 8 ? 0.9 : 0.74,
      signals: postponementFieldKeywords
        .filter((keyword) => combined.includes(keyword))
        .map((keyword) => `${keyword} detected`)
    };
  }

  if (feeReviewScore >= 5) {
    return {
      formType: 'fee_review_request',
      confidence: feeReviewScore >= 8 ? 0.92 : 0.78,
      signals: feeReviewFieldKeywords
        .filter((keyword) => combined.includes(keyword))
        .map((keyword) => `${keyword} detected`)
    };
  }

  if (genericFormScore >= 3) {
    return {
      formType: 'unknown_form',
      confidence: 0.52,
      signals: genericFormKeywords
        .filter((keyword) => combined.includes(keyword))
        .map((keyword) => `${keyword} detected`)
    };
  }

  return {
    formType: 'unknown_form',
    confidence: 0.35,
    signals: []
  };
}
import { classifyDocument, normaliseText as classifyNormaliseText } from './classify.js';
import { extractDocumentText } from './extract.js';
import { detectFormType } from './detectFormType.js';
import { buildSessionContext } from './buildSessionContext.js';
import { mergeContext } from './mergeContext.js';
import { extractStudentId, extractStudentThirdDigit } from './extractStudentId.js';
import {
  loadPrefixMap,
  loadRegistry,
  resolveIntakeFromStudentId,
  resolveHandbookMeta
} from './resolveIntake.js';
import { loadHandbookPack } from './loadHandbookPack.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'Method not allowed.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = body?.message || '';
    const fileMeta = body?.fileMeta || null;
    const rawText = body?.documentText || '';
    const fileUpload = body?.fileUpload || null;
    const previousContext = body?.sessionContext || null;

    const text = normaliseText(message);

    const extracted = await extractDocumentText({
    filename: fileMeta?.filename || previousContext?.last_uploaded_filename || '',
    rawText,
    fileUpload
  });

    const documentText = normaliseText(extracted?.text || '');
    const combined = [
      text,
      documentText,
      previousContext?.last_document_excerpt || ''
    ].filter(Boolean).join(' ').trim();

    const prefixMap = loadPrefixMap();
    const registry = loadRegistry();

    const combinedForIdentity = [
      message,
      extracted?.text || '',
      previousContext?.last_document_excerpt || '',
      previousContext?.current_student_id || ''
    ].filter(Boolean).join(' ');

    const studentId =
      extractStudentId(combinedForIdentity) ||
      previousContext?.current_student_id ||
      null;

    const studentThirdDigit =
      extractStudentThirdDigit(studentId) ||
      previousContext?.current_student_third_digit ||
      null;

    const intakeMatch =
      resolveIntakeFromStudentId(studentId, prefixMap) ||
      (previousContext?.current_intake
        ? {
            intake: previousContext.current_intake,
            label: previousContext.current_handbook_label,
            version: previousContext.current_handbook_version
          }
        : null);

    const resolvedIntake = intakeMatch?.intake || null;
    const handbookMeta = resolvedIntake
      ? resolveHandbookMeta(resolvedIntake, registry)
      : null;

    let handbookPack = null;
    if (resolvedIntake) {
      handbookPack = loadHandbookPack(resolvedIntake);
    }

    const formsData = handbookPack?.formsData || null;
    const standingRulesRaw = handbookPack?.standingRules || null;
    const handbookSections = handbookPack?.handbookSections || null;
    const handbookChunks = handbookPack?.handbookChunks || null;

    const programmesRaw = handbookPack?.programmesData || null;
    const graduationRaw = handbookPack?.graduationData || null;

    const programmesData = programmesRaw
      ? { ...programmesRaw, programmes: dedupeProgrammes(programmesRaw?.programmes || []) }
      : null;

    const graduationData = graduationRaw
      ? { ...graduationRaw, graduation_rules: dedupeGraduationRules(graduationRaw?.graduation_rules || []) }
      : null;

    const baseClassification = classifyDocument({
      message,
      filename: fileMeta?.filename || '',
      documentText
    });

    const formDetection = detectFormType({
      filename: fileMeta?.filename || '',
      documentText,
      extractedTitle: extracted?.title || '',
      topLines: extracted?.topLines || []
    });

    const classification = {
      ...baseClassification,
      formType: formDetection?.formType || null,
      formConfidence: formDetection?.confidence ?? null,
      formSignals: formDetection?.signals || []
    };

    if (classification.formType && classification.formType !== 'unknown_form') {
      classification.documentType = 'form';
      classification.confidence = Math.max(
        classification.confidence || 0,
        classification.formConfidence || 0
      );
    }

    const cgpa = extractCgpa(combined) ?? previousContext?.last_cgpa ?? null;
    const credits = extractCredits(combined) ?? previousContext?.last_credits ?? null;

    const programme =
      detectProgramme(combined, programmesData) ||
      findProgrammeByContext(previousContext, programmesData);

    const mode = detectMode({
      text,
      combined,
      fileMeta,
      classification,
      previousContext
    });

    const intakeRequiredModes = ['standing', 'graduation', 'transcript', 'programme', 'form'];

    if (!resolvedIntake && intakeRequiredModes.includes(mode)) {
      const result = getIntakeRequiredResponse();

      const nextContext = buildSessionContext({
        previousContext,
        mode,
        fileMeta,
        classification,
        extracted,
        studentId,
        studentThirdDigit,
        reference: result.reference
      });

      const sessionContext = mergeContext(previousContext, nextContext);

      return res.status(200).json({
        app: 'ATLAS',
        mode,
        classification,
        sessionContext,
        reply: result.reply
      });
    }

    const handbookContext = {
      intake: resolvedIntake,
      label: handbookMeta?.label || intakeMatch?.label || null,
      version: handbookMeta?.version || intakeMatch?.version || null,
      studentId,
      studentThirdDigit
    };

    let result;
    switch (mode) {
      case 'form':
        result = getFormResponse({
          messageText: text,
          documentText,
          formsData,
          handbookSections,
          classification,
          handbookContext
        });
        break;

      case 'standing':
        result = getStandingResponse({
          messageText: text,
          documentText,
          standingRules: standingRulesRaw,
          handbookSections,
          cgpa,
          handbookContext
        });
        break;

      case 'graduation':
        result = getGraduationResponse({
          messageText: text,
          documentText,
          graduationData,
          programmesData,
          handbookSections,
          programme,
          credits,
          cgpa,
          handbookContext
        });
        break;

      case 'transcript':
        result = getTranscriptResponse({
          messageText: text,
          documentText,
          standingRules: standingRulesRaw,
          graduationData,
          programmesData,
          handbookSections,
          programme,
          cgpa,
          credits,
          handbookContext
        });
        break;

      case 'programme':
        result = getProgrammeResponse({
          messageText: text,
          documentText,
          programmesData,
          handbookSections,
          programme,
          handbookContext
        });
        break;

      case 'unknown_upload':
        result = getUnknownUploadResponse(fileMeta, extracted, classification, handbookContext);
        break;

      default:
        result = getFallbackResponse(handbookSections, handbookChunks, handbookContext);
        break;
    }

    const nextContext = buildSessionContext({
      previousContext,
      mode,
      fileMeta,
      classification,
      extracted,
      programme,
      cgpa,
      credits,
      reference: result.reference,
      studentId,
      studentThirdDigit,
      intake: resolvedIntake,
      handbookLabel: handbookMeta?.label || intakeMatch?.label || null,
      handbookVersion: handbookMeta?.version || intakeMatch?.version || null
    });

    const sessionContext = mergeContext(previousContext, nextContext);

    return res.status(200).json({
      app: 'ATLAS',
      mode,
      classification,
      extracted: {
        success: Boolean(extracted?.success),
        reason: extracted?.reason || null
      },
      sessionContext,
      reply: result.reply
    });
  } catch (error) {
    console.error('ATLAS intake-aware error:', error);
    return res.status(200).json({
      app: 'ATLAS',
      mode: 'error',
      reply: 'ATLAS encountered an internal error while processing your request. Please try again.'
    });
  }
}

function normaliseText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(text, keywords) {
  return (keywords || []).some((keyword) => text.includes(keyword));
}

function detectMode({ text, combined, fileMeta, classification, previousContext }) {
  const filename = normaliseText(fileMeta?.filename || '');
  const priorMode = previousContext?.current_mode || 'general';

  const standingKeywords = [
    'probation', 'dismissal', 'dismissed', 'academic standing', 'good standing',
    'am i on probation', 'will i be dismissed', 'cgpa'
  ];

  const graduationKeywords = [
    'graduate', 'graduation', 'eligible to graduate', 'can i graduate',
    'credits remaining', 'completed credits', 'total credits', 'can i finish'
  ];

  const programmeKeywords = [
    'entry requirement', 'entry requirements', 'duration', 'programme structure',
    'total credit hours', 'programme info', 'what programmes are offered',
    'civil engineering', 'software engineering', 'computer science',
    'information technology', 'agricultural science', 'automotive',
    'mechanical engineering', 'electronics engineering'
  ];

  const transcriptKeywords = [
    'transcript', 'statement of results', 'semester results',
    'result slip', 'results slip', 'semester', 'gpa', 'credit hours'
  ];

  const formKeywords = [
    'form', 'appeal', 'dismissal appeal', 'application',
    'withdrawal form', 'deferment', 'postponement', 'rof-'
  ];

  if (fileMeta?.filename) {
    if (classification?.documentType === 'form') return 'form';
    if (classification?.documentType === 'transcript') {
      if (containsAny(text, graduationKeywords)) return 'graduation';
      return 'transcript';
    }
    if (classification?.documentType === 'graduation_document') return 'graduation';
    return 'unknown_upload';
  }

  if (containsAny(combined, formKeywords) || containsAny(filename, formKeywords)) return 'form';
  if (containsAny(combined, standingKeywords) && !containsAny(combined, transcriptKeywords)) return 'standing';
  if (containsAny(combined, graduationKeywords)) return 'graduation';
  if (containsAny(combined, transcriptKeywords)) return 'transcript';
  if (containsAny(combined, programmeKeywords)) return 'programme';
  if (priorMode && priorMode !== 'general') return priorMode;

  return 'general';
}

function extractCgpa(text) {
  const patterns = [
    /cgpa\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i,
    /cumulative gpa\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match) return parseFloat(match[1]);
  }

  return null;
}

function extractCredits(text) {
  const patterns = [
    /(\d+)\s*credits?/i,
    /total credits earned\s*(?:is|=|:)?\s*(\d+)/i,
    /completed credit hours\s*(?:is|=|:)?\s*(\d+)/i,
    /credit hours completed\s*(?:is|=|:)?\s*(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match) return parseInt(match[1], 10);
  }

  return null;
}

function dedupeProgrammes(items = []) {
  const byCode = new Map();

  for (const item of items) {
    if (!item?.code) continue;

    const current = byCode.get(item.code);
    if (!current) {
      byCode.set(item.code, item);
      continue;
    }

    const currentScore = completenessScore(current);
    const nextScore = completenessScore(item);

    byCode.set(
      item.code,
      nextScore >= currentScore
        ? mergeProgrammeRecords(current, item)
        : mergeProgrammeRecords(item, current)
    );
  }

  return Array.from(byCode.values());
}

function mergeProgrammeRecords(primary, secondary) {
  return {
    ...secondary,
    ...primary,
    aliases: uniq([...(secondary.aliases || []), ...(primary.aliases || [])]),
    programme_notes: uniq([...(secondary.programme_notes || []), ...(primary.programme_notes || [])]),
    entry_requirements: uniq([...(secondary.entry_requirements || []), ...(primary.entry_requirements || [])]),
    total_credit_hours: primary.total_credit_hours ?? secondary.total_credit_hours ?? null,
    duration: primary.duration || secondary.duration || null,
    mode_of_study: primary.mode_of_study || secondary.mode_of_study || null,
    handbook_reference: primary.handbook_reference || secondary.handbook_reference || null
  };
}

function dedupeGraduationRules(items = []) {
  const byCode = new Map();

  for (const item of items) {
    if (!item?.programme_code) continue;

    const current = byCode.get(item.programme_code);
    if (!current) {
      byCode.set(item.programme_code, item);
      continue;
    }

    const currentScore = completenessScore(current);
    const nextScore = completenessScore(item);

    const merged =
      nextScore >= currentScore
        ? mergeGraduationRecords(item, current)
        : mergeGraduationRecords(current, item);

    byCode.set(item.programme_code, merged);
  }

  return Array.from(byCode.values());
}

function mergeGraduationRecords(primary, secondary) {
  return {
    ...secondary,
    ...primary,
    required_total_credits: primary.required_total_credits ?? secondary.required_total_credits ?? null,
    required_components: uniq([...(secondary.required_components || []), ...(primary.required_components || [])]),
    graduation_logic_notes: uniq([...(secondary.graduation_logic_notes || []), ...(primary.graduation_logic_notes || [])]),
    credit_breakdown: {
      ...(secondary.credit_breakdown || {}),
      ...(primary.credit_breakdown || {})
    },
    handbook_reference: primary.handbook_reference || secondary.handbook_reference || null
  };
}

function completenessScore(item = {}) {
  let score = 0;

  Object.values(item).forEach((value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      score += value.length;
      return;
    }
    if (typeof value === 'object') {
      score += Object.keys(value).length;
      return;
    }
    if (String(value).trim()) score += 1;
  });

  return score;
}

function uniq(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function detectProgramme(text, programmesData) {
  const items = programmesData?.programmes || [];
  const normalized = normaliseText(text);
  let best = null;
  let bestScore = 0;

  for (const programme of items) {
    const aliases = uniq([programme.name, programme.code, ...(programme.aliases || [])])
      .map((alias) => normaliseText(alias));

    const score = aliases.reduce((acc, alias) => {
      return acc + (normalized.includes(alias) ? alias.length : 0);
    }, 0);

    if (score > bestScore) {
      best = programme;
      bestScore = score;
    }
  }

  return best;
}

function findProgrammeByContext(previousContext, programmesData) {
  if (!previousContext || !programmesData) return null;
  const items = programmesData?.programmes || [];

  if (previousContext.last_programme_code) {
    const byCode = items.find((item) => item.code === previousContext.last_programme_code);
    if (byCode) return byCode;
  }

  if (previousContext.last_programme) {
    const name = normaliseText(previousContext.last_programme);
    const byName = items.find((item) => normaliseText(item.name) === name);
    if (byName) return byName;
  }

  return null;
}

function findSection(text, handbookSections, fallbackId = null) {
  const sections = handbookSections?.sections || [];
  const normalized = classifyNormaliseText(text);
  let best = null;
  let bestScore = 0;

  for (const section of sections) {
    const score = (section.keywords || []).reduce((acc, keyword) => {
      return acc + (normalized.includes(classifyNormaliseText(keyword)) ? 1 : 0);
    }, 0);

    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }

  if (!best && fallbackId) {
    best = sections.find((section) => section.id === fallbackId) || null;
  }

  return best;
}

function handbookHeader(handbookContext) {
  if (!handbookContext?.intake) return '';

  const lines = [
    'Handbook in Use:',
    `- Intake: ${handbookContext.intake}`,
    `- Handbook: ${handbookContext.label || 'Intake handbook'}`,
    `- Version: ${handbookContext.version || 'Not specified'}`
  ];

  if (handbookContext.studentId) {
    lines.push(`- Student ID Intake Digit: ${handbookContext.studentThirdDigit || 'Unknown'}`);
  }

  return `${lines.join('\n')}\n\n`;
}

function formatFormType(formType) {
  if (!formType) return 'Unknown Academic Form';

  const map = {
    academic_dismissal_appeal: 'Academic Dismissal Appeal Form',
    course_withdrawal: 'Course Withdrawal Form',
    postponement_of_studies: 'Application for Postponement of Studies',
    fee_review_request: 'Fee Review Request Form',
    unknown_form: 'Unknown Academic Form'
  };

  return map[formType] || String(formType).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function findMatchedForm(formsData, classification, combined) {
  const forms = formsData?.forms || [];

  if (classification?.formType && classification.formType !== 'unknown_form') {
    const exact = forms.find((form) => {
      const name = normaliseText(form.form_name || '');

      if (classification.formType === 'academic_dismissal_appeal') {
        return name.includes('dismissal');
      }
      if (classification.formType === 'course_withdrawal') {
        return name.includes('withdrawal') && !name.includes('university');
      }
      if (classification.formType === 'postponement_of_studies') {
        return name.includes('postponement') || name.includes('deferment');
      }
      if (classification.formType === 'fee_review_request') {
        return name.includes('fee review');
      }
      return false;
    });

    if (exact) return exact;
  }

  return (
    forms.find((form) => normaliseText(combined).includes(normaliseText(form.form_name || ''))) ||
    forms.find((form) => (form.form_name || '').toLowerCase().includes('dismissal') && combined.includes('dismiss')) ||
    forms.find((form) => (form.form_name || '').toLowerCase().includes('withdrawal') && combined.includes('withdraw')) ||
    forms.find((form) => (form.form_name || '').toLowerCase().includes('postponement') && (combined.includes('postpone') || combined.includes('defer'))) ||
    forms.find((form) => (form.form_name || '').toLowerCase().includes('fee review') && combined.includes('fee'))
  );
}

function getIntakeRequiredResponse() {
  return {
    reference: 'Handbook Routing',
    reply: `ATLAS

I need your student ID to determine which intake handbook applies to you.

Please provide your student ID so I can identify whether your handbook is:
- March intake
- June/July intake
- November intake

Important Note:
ATLAS only gives handbook-grounded advice after loading the correct intake handbook.`
  };
}

function getStandingResponse({ messageText, documentText, standingRules, handbookSections, cgpa, handbookContext }) {
  const combined = `${messageText} ${documentText}`.trim();
  const resolvedCgpa = Number.isFinite(cgpa) ? cgpa : extractCgpa(combined);
  const rules = standingRules?.rules || {};
  const section = findSection(combined, handbookSections, 'academic_standing');
  const reference = section?.reference || 'Grading Systems and Academic Standing';
  const header = handbookHeader(handbookContext);

  if (resolvedCgpa === null) {
    return {
      reference,
      reply: `${header}ATLAS · standing

Issue Summary:
You are asking about academic standing, probation, or dismissal.

Handbook Basis:
- Good Status: CGPA 2.00 and above
- Academic Probation: CGPA below 2.00
- Academic Dismissal: may apply if CGPA remains below 2.00 for three consecutive semesters

Assessment:
ATLAS can explain the standing rules, but your exact status cannot be interpreted unless your CGPA or official semester record is known.

Recommended Action:
1. Provide your CGPA if you want a preliminary interpretation.
2. Check whether this is your first, second, or third consecutive semester below 2.00.
3. Refer to the Faculty Academic Office for final confirmation.

Important Note:
Academic Dismissal cannot be concluded from one CGPA figure alone; the consecutive semester pattern must also be considered.

Reference:
${reference}`
    };
  }

  let status = 'Academic risk';
  let explanation = `A CGPA of ${resolvedCgpa.toFixed(2)} is below the handbook threshold of 2.00, which places the student in academic risk territory and may result in Academic Probation, subject to the official semester record.`;

  if (resolvedCgpa >= (rules.good_status?.cgpa_min || 2.0)) {
    status = rules.good_status?.label || 'Good Status';
    explanation = `A CGPA of ${resolvedCgpa.toFixed(2)} is at or above the handbook threshold of 2.00 and is generally consistent with Good Status.`;
  }

  return {
    reference,
    reply: `${header}ATLAS · standing

Issue Summary:
You are asking whether a CGPA of ${resolvedCgpa.toFixed(2)} affects your academic standing.

Handbook Basis:
- Good Status: CGPA 2.00 and above
- Probation: CGPA below 2.00 for any semester
- Dismissal: may apply after three consecutive semesters below 2.00

Assessment:
${explanation}

Preliminary Interpretation:
${status}

Recommended Action:
1. Check whether this is your first, second, or third consecutive semester below 2.00.
2. Review your official academic result notification.
3. Meet your academic advisor or Faculty Academic Office for confirmation.

Important Note:
${section?.safety_note || 'ATLAS provides a handbook-based preliminary interpretation only.'}

Reference:
${reference}`
  };
}

function getFormResponse({ messageText, documentText, formsData, handbookSections, classification, handbookContext }) {
  const combined = `${messageText} ${documentText}`.trim();
  const matchedForm = findMatchedForm(formsData, classification, combined);
  const section = findSection(combined, handbookSections, 'dismissal_appeal');
  const inferredType = classification?.formType || 'unknown_form';
  const reference = matchedForm?.reference || section?.reference || formatFormType(inferredType);
  const header = handbookHeader(handbookContext);

  if (!matchedForm) {
    return {
      reference,
      reply: `${header}ATLAS · form

Issue Summary:
You are asking about an academic form, application, or appeal document.

Detected Form Type:
${formatFormType(inferredType)}

Recommended Action:
1. State the exact form name, or upload a file with the form title clearly shown.
2. ATLAS can then provide the form purpose, required fields, attachments, and submission steps.

Examples:
- Academic Dismissal Appeal Form
- Course Withdrawal Form
- Application for Postponement of Studies

Reference:
${reference}`
    };
  }

  const fields = (matchedForm.required_fields || matchedForm.required_signatures || matchedForm.required_clearances || [])
    .map((item) => `- ${item}`)
    .join('\n');

  const attachments = (matchedForm.required_attachments || []).length
    ? matchedForm.required_attachments.map((item) => `- ${item}`).join('\n')
    : '- Please confirm from the official form or Faculty Academic Office.';

  const submitTo = (matchedForm.submit_to || []).length
    ? matchedForm.submit_to.join(', ')
    : 'Please refer to the official form instructions.';

  return {
    reference,
    reply: `${header}ATLAS · form

Form Identified:
${matchedForm.form_name}${matchedForm.form_code ? ` (${matchedForm.form_code})` : ''}

Purpose:
${matchedForm.purpose || 'Not specified.'}

Fields / Information to Prepare:
${fields || '- Please refer to the official form.'}

Attachments Required:
${attachments}

Submission Guidance:
1. Complete all required fields accurately.
2. Attach all supporting documents.
3. Submit to: ${submitTo}
4. Follow the official deadline stated in the form or handbook.

Deadline:
${matchedForm.submission_deadline || matchedForm.submission_window || matchedForm.deadline_limit || 'Please confirm from the official document.'}

Detection Signals:
${(classification?.formSignals || []).length ? classification.formSignals.map((s) => `- ${s}`).join('\n') : '- No additional form signals recorded.'}

Important Caution:
Late or incomplete submission may affect processing.

Additional Note:
${matchedForm.post_approval_note || section?.safety_note || 'Final processing must follow the official Faculty / Registrar workflow.'}

Reference:
${reference}`
  };
}

function getGraduationResponse({ messageText, documentText, graduationData, programmesData, handbookSections, programme, credits, cgpa, handbookContext }) {
  const combined = `${messageText} ${documentText}`.trim();
  const resolvedProgramme = programme || detectProgramme(combined, programmesData);
  const resolvedCredits = Number.isFinite(credits) ? credits : extractCredits(combined);
  const resolvedCgpa = Number.isFinite(cgpa) ? cgpa : extractCgpa(combined);
  const section = findSection(combined, handbookSections, 'programme_bse');
  const header = handbookHeader(handbookContext);

  if (!resolvedProgramme) {
    return {
      reference: 'Programme Graduation Rules',
      reply: `${header}ATLAS · graduation

Issue Summary:
You are asking about graduation eligibility.

Recommended Action:
1. Please state your programme name.
2. If available, also state your completed credits and CGPA.

Example:
“I am in Software Engineering and I have completed 109 credits.”

Important Note:
A graduation check is more reliable when programme name, credits, and CGPA are provided.

Reference:
Programme Graduation Rules`
    };
  }

  const rule = (graduationData?.graduation_rules || []).find((item) => item.programme_code === resolvedProgramme.code);
  const reference = rule?.handbook_reference || resolvedProgramme.handbook_reference || section?.reference || resolvedProgramme.name;

  if (!rule || rule.required_total_credits == null) {
    return {
      reference,
      reply: `${header}ATLAS · graduation

Programme:
${resolvedProgramme.name}

Issue Summary:
A preliminary graduation check is possible, but final eligibility cannot yet be fully confirmed for this programme in the current ATLAS knowledge map.

Reason:
The exact total graduating credits or full compulsory component structure is not yet fully mapped for this programme.

Known Student Data:
- Credits: ${resolvedCredits != null ? resolvedCredits : 'Not provided'}
- CGPA: ${resolvedCgpa != null ? resolvedCgpa.toFixed(2) : 'Not provided'}

Recommended Action:
1. Confirm your completed credits and CGPA.
2. Refer to the official programme structure and Faculty Academic Office for final confirmation.

Important Note:
ATLAS does not declare final graduation eligibility where the rule mapping is incomplete.

Reference:
${reference}`
    };
  }

  if (resolvedCredits == null) {
    return {
      reference,
      reply: `${header}ATLAS · graduation

Programme:
${resolvedProgramme.name}

Handbook Basis:
- Required total credits: ${rule.required_total_credits}
- Graduation still depends on compulsory component completion and faculty confirmation.

Assessment:
ATLAS has identified your programme, but your completed credits were not provided, so a graduation gap cannot yet be computed.

Recommended Action:
1. State your completed credits.
2. If known, also state your CGPA.
3. Confirm whether compulsory components such as Industrial Training or Final Year Project have been completed.

Reference:
${reference}`
    };
  }

  const remaining = Math.max(rule.required_total_credits - resolvedCredits, 0);
  const components = (rule.required_components || []).map((item) => `- ${item}`).join('\n') || '- Compulsory components not fully listed.';
  const notes = (rule.graduation_logic_notes || []).map((item) => `- ${item}`).join('\n') || '- No additional logic notes listed.';
  const cgpaNote = resolvedCgpa == null
    ? 'CGPA was not provided.'
    : resolvedCgpa >= (rule.cgpa_min_for_good_status || 2.0)
      ? `CGPA ${resolvedCgpa.toFixed(2)} is consistent with the minimum good-status threshold of ${(rule.cgpa_min_for_good_status || 2.0).toFixed(2)}.`
      : `CGPA ${resolvedCgpa.toFixed(2)} is below the minimum good-status threshold of ${(rule.cgpa_min_for_good_status || 2.0).toFixed(2)}.`;

  const status = remaining === 0
    ? 'Credit requirement appears satisfied, pending compulsory component completion and official confirmation.'
    : `You appear to need ${remaining} more credit(s) to reach the mapped total of ${rule.required_total_credits}.`;

  return {
    reference,
    reply: `${header}ATLAS · graduation

Programme:
${resolvedProgramme.name}

Handbook Basis:
- Required total credits: ${rule.required_total_credits}
- Minimum CGPA for good status: ${rule.cgpa_min_for_good_status ?? 2.0}

Your Data:
- Completed credits: ${resolvedCredits}
- CGPA: ${resolvedCgpa != null ? resolvedCgpa.toFixed(2) : 'Not provided'}

Assessment:
${status}
${cgpaNote}

Compulsory Components to Verify:
${components}

Additional Notes:
${notes}

Important Note:
ATLAS provides a handbook-grounded preliminary graduation check only. Final official confirmation should come from the Faculty Academic Office / Registrar.

Reference:
${reference}`
  };
}

function getProgrammeResponse({ messageText, documentText, programmesData, handbookSections, programme, handbookContext }) {
  const combined = `${messageText} ${documentText}`.trim();
  const resolvedProgramme = programme || detectProgramme(combined, programmesData);
  const section = findSection(combined, handbookSections, 'programme_bse');
  const header = handbookHeader(handbookContext);

  if (!resolvedProgramme) {
    return {
      reference: 'FEST Programme Information',
      reply: `${header}ATLAS · programme

Issue Summary:
You are asking about a FEST programme.

Recommended Action:
1. State the exact programme name.
2. Example:
   - Civil Engineering
   - Software Engineering
   - Computer Science
   - Diploma in Information Technology

Reference:
FEST Programme Information`
    };
  }

  const entryReqs = resolvedProgramme.entry_requirements?.length
    ? resolvedProgramme.entry_requirements.map((item) => `- ${item}`).join('\n')
    : '- Entry requirements for this programme are not yet fully structured in the current ATLAS dataset.';

  const notes = resolvedProgramme.programme_notes?.length
    ? resolvedProgramme.programme_notes.map((item) => `- ${item}`).join('\n')
    : '- No additional programme notes available.';

  const reference = resolvedProgramme.handbook_reference || section?.reference || 'FEST Academic Handbook';

  return {
    reference,
    reply: `${header}ATLAS · programme

Programme:
${resolvedProgramme.name}

Faculty / Department:
${resolvedProgramme.faculty || 'FEST'}${resolvedProgramme.department ? ` / ${resolvedProgramme.department}` : ''}

Duration:
${resolvedProgramme.duration || 'Not yet fully mapped in the current handbook dataset.'}

Mode of Study:
${resolvedProgramme.mode_of_study || 'Not yet fully mapped in the current handbook dataset.'}

Total Credit Hours:
${resolvedProgramme.total_credit_hours != null ? resolvedProgramme.total_credit_hours : 'Not yet fully mapped in the current handbook dataset.'}

Entry Requirements:
${entryReqs}

Programme Notes:
${notes}

Important Note:
Some programme fields may still be under expansion in ATLAS.

Reference:
${reference}`
  };
}

function getTranscriptResponse({ messageText, documentText, standingRules, graduationData, programmesData, handbookSections, programme, cgpa, credits, handbookContext }) {
  const combined = `${messageText} ${documentText}`.trim();
  const resolvedCgpa = Number.isFinite(cgpa) ? cgpa : extractCgpa(combined);
  const resolvedCredits = Number.isFinite(credits) ? credits : extractCredits(combined);
  const resolvedProgramme = programme || detectProgramme(combined, programmesData);
  const standingSection = findSection(combined, handbookSections, 'academic_standing');
  const programmeSection = findSection(combined, handbookSections, 'programme_bse');
  const rule = resolvedProgramme
    ? (graduationData?.graduation_rules || []).find((item) => item.programme_code === resolvedProgramme.code)
    : null;
  const header = handbookHeader(handbookContext);

  const standingHint = resolvedCgpa == null
    ? 'CGPA not identified, so standing cannot be interpreted yet.'
    : resolvedCgpa >= ((standingRules?.rules?.good_status?.cgpa_min) || 2.0)
      ? `CGPA ${resolvedCgpa.toFixed(2)} is generally consistent with Good Status.`
      : `CGPA ${resolvedCgpa.toFixed(2)} is below 2.00 and may indicate Academic Probation, depending on the official semester pattern.`;

  const graduationHint =
    (!resolvedProgramme || resolvedCredits == null || !rule?.required_total_credits)
      ? 'Graduation cannot be checked fully yet from the available transcript data.'
      : resolvedCredits >= rule.required_total_credits
        ? `Credits meet or exceed the mapped total of ${rule.required_total_credits}, but compulsory components still need official confirmation.`
        : `Credits are below the mapped total of ${rule.required_total_credits}.`;

  const reference = standingSection?.reference || programmeSection?.reference || 'Transcript Bridge Mode';

  return {
    reference,
    reply: `${header}ATLAS · transcript

Transcript Extract (Preliminary):
- Programme: ${resolvedProgramme ? resolvedProgramme.name : 'Not identified'}
- CGPA: ${resolvedCgpa != null ? resolvedCgpa.toFixed(2) : 'Not identified'}
- Credits: ${resolvedCredits != null ? resolvedCredits : 'Not identified'}

Standing Hint:
${standingHint}

Graduation Hint:
${graduationHint}

Assessment:
This transcript mode can use detected values to support handbook-based standing or graduation interpretation, but it is not yet a full transcript parser.

Recommended Action:
1. State your programme clearly if it was not detected.
2. Provide CGPA and completed credits if known.
3. Ask one focused question such as:
   - “Am I on probation?”
   - “Can I graduate?”

Important Note:
Full transcript extraction and validation are planned for a later ATLAS version.

Reference:
${reference}`
  };
}

function getUnknownUploadResponse(fileMeta, extracted, classification, handbookContext) {
  const reference = 'Document Upload Routing';
  const header = handbookHeader(handbookContext);

  return {
    reference,
    reply: `${header}ATLAS · upload

Issue Summary:
I received a file upload${fileMeta?.filename ? ` (${fileMeta.filename})` : ''}, but I cannot yet determine whether it is a transcript, academic form, or graduation-related document.

Recommended Action:
1. Tell me what this uploaded file is.
2. For example, say:
   - "This is my transcript."
   - "This is a dismissal appeal form."
   - "This is for graduation checking."

Processing Note:
${extracted?.success ? 'The document extraction layer is available, but no clear academic document type was matched.' : extracted?.reason || 'No document text was available for classification.'}

Classification:
- documentType: ${classification?.documentType || 'unknown_upload'}
- confidence: ${classification?.confidence != null ? classification.confidence : 'N/A'}
- formType: ${classification?.formType || 'unknown_form'}

Important Note:
ATLAS can use the uploaded filename, your prompt, and extracted text when available, but full file-content reading is still being expanded.

Reference:
${reference}`
  };
}

function getFallbackResponse(handbookSections, handbookChunks, handbookContext) {
  const standing = handbookSections?.sections?.find((section) => section.id === 'academic_standing');
  const chunkHint = handbookChunks?.chunks?.[0]?.topic || 'academic handbook topics';
  const reference = standing?.reference || 'FEST Academic Handbook';
  const header = handbookHeader(handbookContext);

  return {
    reference,
    reply: `${header}ATLAS

I can currently help with:
- programme information
- entry requirements
- academic standing
- graduation eligibility
- academic forms and appeals
- uploaded academic documents (beta)

Try asking:
- “My student ID is 24112345 and my CGPA is 1.95. Am I on probation?”
- “My student ID is 24212345. I am in Software Engineering and I have 109 credits. Can I graduate?”
- “I uploaded a dismissal appeal form. What should I do?”

Reference:
${reference}

Version:
ATLAS V2 — Intake-Aware Handbook Beta (${chunkHint})`
  };
}
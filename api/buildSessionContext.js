export function buildSessionContext({
  previousContext = null,
  mode = 'general',
  fileMeta = null,
  classification = null,
  extracted = null,
  programme = null,
  cgpa = null,
  credits = null,
  reference = null,
  studentId = null,
  studentThirdDigit = null,
  intake = null,
  handbookLabel = null,
  handbookVersion = null
}) {
  const prev = previousContext || {};

  return {
    current_mode: mode || prev.current_mode || 'general',

    current_student_id: studentId || prev.current_student_id || null,
    current_student_third_digit: studentThirdDigit || prev.current_student_third_digit || null,
    current_intake: intake || prev.current_intake || null,
    current_handbook_label: handbookLabel || prev.current_handbook_label || null,
    current_handbook_version: handbookVersion || prev.current_handbook_version || null,

    last_uploaded_filename: fileMeta?.filename || prev.last_uploaded_filename || null,
    last_document_type: classification?.documentType || prev.last_document_type || null,
    last_form_type: classification?.formType || prev.last_form_type || null,
    last_programme: programme?.name || prev.last_programme || null,
    last_programme_code: programme?.code || prev.last_programme_code || null,
    last_cgpa: Number.isFinite(cgpa) ? cgpa : (prev.last_cgpa ?? null),
    last_credits: Number.isFinite(credits) ? credits : (prev.last_credits ?? null),
    last_reference: reference || prev.last_reference || null,
    last_document_excerpt: extracted?.text
      ? String(extracted.text).slice(0, 500)
      : (prev.last_document_excerpt || null),

    last_updated: new Date().toISOString()
  };
}
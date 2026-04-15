export function mergeContext(previousContext = null, nextContext = null) {
  const prev = previousContext || {};
  const next = nextContext || {};

  return {
    current_mode: next.current_mode || prev.current_mode || 'general',

    current_student_id: next.current_student_id || prev.current_student_id || null,
    current_student_third_digit: next.current_student_third_digit || prev.current_student_third_digit || null,
    current_intake: next.current_intake || prev.current_intake || null,
    current_handbook_label: next.current_handbook_label || prev.current_handbook_label || null,
    current_handbook_version: next.current_handbook_version || prev.current_handbook_version || null,

    last_uploaded_filename: next.last_uploaded_filename || prev.last_uploaded_filename || null,
    last_document_type: next.last_document_type || prev.last_document_type || null,
    last_form_type: next.last_form_type || prev.last_form_type || null,
    last_programme: next.last_programme || prev.last_programme || null,
    last_programme_code: next.last_programme_code || prev.last_programme_code || null,
    last_cgpa: next.last_cgpa ?? prev.last_cgpa ?? null,
    last_credits: next.last_credits ?? prev.last_credits ?? null,
    last_reference: next.last_reference || prev.last_reference || null,
    last_document_excerpt: next.last_document_excerpt || prev.last_document_excerpt || null,
    last_updated: next.last_updated || new Date().toISOString()
  };
}
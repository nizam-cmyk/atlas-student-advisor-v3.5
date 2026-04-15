import fs from 'fs';
import path from 'path';
import { extractStudentThirdDigit } from './extractStudentId.js';

function readJson(filename) {
  const filePath = path.join(process.cwd(), 'data', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadPrefixMap() {
  return readJson('prefix_map.json');
}

export function loadRegistry() {
  return readJson('registry.json');
}

export function resolveIntakeFromStudentId(studentId, rulesData = null) {
  const data = rulesData || loadPrefixMap();
  const thirdDigit = extractStudentThirdDigit(studentId);

  if (!thirdDigit) return null;

  return (
    (data?.student_id_intake_rules || []).find(
      (item) => item.third_digit === thirdDigit
    ) || null
  );
}

export function resolveHandbookMeta(intake, registry = null) {
  const registryData = registry || loadRegistry();
  return (
    (registryData?.handbooks || []).find((item) => item.intake === intake) || null
  );
}
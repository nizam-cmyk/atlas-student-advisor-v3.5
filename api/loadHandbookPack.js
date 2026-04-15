import fs from 'fs';
import path from 'path';

function readJson(folder, filename) {
  const filePath = path.join(process.cwd(), 'data', folder, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadHandbookPack(intake) {
  if (!intake) {
    throw new Error('Handbook intake is required.');
  }

  return {
    intake,
    formsData: readJson(intake, 'forms.json'),
    programmesData: readJson(intake, 'programmes.json'),
    standingRules: readJson(intake, 'standing_rules.json'),
    graduationData: readJson(intake, 'graduation_rules.json'),
    handbookSections: readJson(intake, 'handbook_sections.json'),
    handbookChunks: readJson(intake, 'handbook_chunks.json')
  };
}
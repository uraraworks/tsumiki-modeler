import { PALETTE_CHARS, validateDoc } from './model.js';

function duplicateNames(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
}

function missingNamePairs(items) {
  const names = new Set(items.map(item => item.name));
  const missing = [];
  for (const name of names) {
    let counterpart = null;
    if (name.includes('左')) counterpart = name.replaceAll('左', '右');
    else if (name.includes('右')) counterpart = name.replaceAll('右', '左');
    else if (/_l$/i.test(name)) counterpart = name.replace(/_l$/i, suffix => suffix === '_L' ? '_R' : '_r');
    else if (/_r$/i.test(name)) counterpart = name.replace(/_r$/i, suffix => suffix === '_R' ? '_L' : '_l');
    if (counterpart && !names.has(counterpart)) missing.push({ name, expected: counterpart });
  }
  return missing;
}

export function validateModelReport(doc) {
  try { validateDoc(doc); }
  catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [] };
  }

  const warnings = [];
  const unassigned = doc.parts.filter(part => part.bone === null).map(part => ({ id: part.id, name: part.name }));
  if (unassigned.length) warnings.push({ code: 'unassigned_parts', message: 'ボーンに割り当てられていないパーツがあります。', items: unassigned });

  const usedPaletteIndexes = new Set();
  for (const part of doc.parts) {
    const solidIndex = doc.palette.indexOf(part.color);
    if (solidIndex >= 0) usedPaletteIndexes.add(solidIndex);
    for (const row of part.texture?.rows ?? []) for (const character of row) {
      const index = PALETTE_CHARS.indexOf(character);
      if (index >= 0) usedPaletteIndexes.add(index);
    }
  }
  const unusedColors = doc.palette.flatMap((color, index) => usedPaletteIndexes.has(index) ? [] : [{ index, color }]);
  if (unusedColors.length) warnings.push({ code: 'unused_palette_colors', message: '使われていないパレット色があります。', items: unusedColors });

  for (const [kind, items] of [['parts', doc.parts], ['bones', doc.bones]]) {
    const duplicates = duplicateNames(items);
    if (duplicates.length) warnings.push({ code: `duplicate_${kind}_names`, message: `${kind === 'parts' ? 'パーツ' : 'ボーン'}名が重複しています。`, items: duplicates });
    const missingPairs = missingNamePairs(items);
    if (missingPairs.length) warnings.push({ code: `unpaired_${kind}_names`, message: `${kind === 'parts' ? 'パーツ' : 'ボーン'}の左右名（左/右、_l/_r）が揃っていません。`, items: missingPairs });
  }
  return { valid: true, errors: [], warnings };
}

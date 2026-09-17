export const CHARACTER_VARIANTS = Object.freeze(['male', 'female']);

export function normalizeCharacter(value) {
  return value === 'female' ? 'female' : 'male';
}

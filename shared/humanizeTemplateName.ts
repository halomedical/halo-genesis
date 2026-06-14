/** Turn file stems like CL07_Accident_or_Illness into readable titles. */
export function humanizeTemplateName(raw: string): string {
  let s = raw.replace(/\.pdf$/i, '').trim();
  if (!s) return 'Untitled form';

  s = s.replace(/[_]+/g, ' ').replace(/-+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const words = s.split(' ').filter(Boolean);
  const titled = words.map((word) => {
    if (/^[A-Z]{2}\d+$/i.test(word)) return word.toUpperCase();
    if (word.length <= 3 && /^[a-z]+$/i.test(word)) return word.toUpperCase();
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  return titled.join(' ');
}

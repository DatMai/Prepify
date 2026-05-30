export interface StrengthResult {
  score: number;
  passed: boolean[];
  labels: string[];
}

const RULES = [
  { re: /.{8,}/,         label: '8+ ký tự' },
  { re: /[A-Z]/,         label: 'Chữ hoa' },
  { re: /[a-z]/,         label: 'Chữ thường' },
  { re: /[0-9]/,         label: 'Chữ số' },
  { re: /[@$!%*?&^#]/,   label: 'Ký tự đặc biệt' },
];

export function checkStrength(password: string): StrengthResult {
  const passed = RULES.map(r => r.re.test(password));
  return { score: passed.filter(Boolean).length, passed, labels: RULES.map(r => r.label) };
}

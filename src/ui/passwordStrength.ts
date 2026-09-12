export interface StrengthResult {
  score: number;
  passed: boolean[];
}

const RULES = [/.{8,}/, /[A-Z]/, /[a-z]/, /[0-9]/, /[@$!%*?&^#]/];

export function checkStrength(password: string): StrengthResult {
  const passed = RULES.map((rule) => rule.test(password));
  return { score: passed.filter(Boolean).length, passed };
}

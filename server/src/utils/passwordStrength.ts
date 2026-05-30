export interface PasswordStrength {
  valid: boolean;
  errors: string[];
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const errors: string[] = [];
  if (password.length < 8)           errors.push('Ít nhất 8 ký tự');
  if (!/[A-Z]/.test(password))       errors.push('Ít nhất 1 chữ hoa (A-Z)');
  if (!/[a-z]/.test(password))       errors.push('Ít nhất 1 chữ thường (a-z)');
  if (!/[0-9]/.test(password))       errors.push('Ít nhất 1 chữ số (0-9)');
  if (!/[@$!%*?&^#]/.test(password)) errors.push('Ít nhất 1 ký tự đặc biệt (@$!%*?&#)');
  return { valid: errors.length === 0, errors };
}

export const THEMES = ['light', 'dark', 'system'];

export const SIZES = ['default', 'large'];

export const THEME_COLORS = {
  light: '#f4f5f7',
  dark: '#0e1014',
};

export function resolveTheme(stored) {
  return THEMES.includes(stored) ? stored : 'system';
}

export function resolveSize(stored) {
  return stored === 'large' ? 'large' : 'default';
}

export function resolvedScheme(theme, prefersDark) {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }
  return prefersDark ? 'dark' : 'light';
}

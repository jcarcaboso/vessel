// Ten visual treatments of the same locked workspace. No theme owns layout or play data.
export const defaultTheme = 'graphite';
export const themes = [
  { id: 'graphite', name: 'Graphite', description: 'Neutral charcoal, silver actions, recessed fields and underlined tabs.',
    canvas: '#0f1114', surface: '#171a1f', alt: '#1e2229', raised: '#242932', input: '#111419', text: '#e9edf2', muted: '#abb3c0', accent: '#b9c9e4', border: '#394350',
    primary: '#c5cfdd', primaryText: '#11161d', primaryBorder: '#c5cfdd', radius: 7, buttonRadius: 5, inputRadius: 4, controls: 'recessed', tabs: 'line', buttons: 'solid' },
  { id: 'carbon', name: 'Carbon', description: 'Near-black, restrained white outlines, crisp controls and almost-square corners.',
    canvas: '#090b0d', surface: '#111519', alt: '#181d22', raised: '#20272e', input: '#0c1014', text: '#e8edef', muted: '#aab5bf', accent: '#d5dce2', border: '#404a54',
    primary: '#111519', primaryText: '#e8edef', primaryBorder: '#b7c1ca', radius: 4, buttonRadius: 3, inputRadius: 2, controls: 'hairline', tabs: 'outline', buttons: 'outline' },
  { id: 'midnight', name: 'Midnight', description: 'Ink-blue panels, a cool blue primary action and filled selection states.',
    canvas: '#0b1019', surface: '#131d2c', alt: '#1b283b', raised: '#24324a', input: '#0c1624', text: '#edf2fa', muted: '#adbbcf', accent: '#96b7ff', border: '#3b5271',
    primary: '#96b7ff', primaryText: '#10182a', primaryBorder: '#96b7ff', radius: 8, buttonRadius: 6, inputRadius: 5, controls: 'recessed', tabs: 'filled', buttons: 'solid' },
  { id: 'slate', name: 'Slate', description: 'Steel-gray surfaces, tonal buttons, framed fields and quiet boxed tabs.',
    canvas: '#131921', surface: '#1c2530', alt: '#25313e', raised: '#303f50', input: '#151e28', text: '#f0f4f8', muted: '#becbd8', accent: '#abc7df', border: '#52677b',
    primary: '#30445b', primaryText: '#e4eef9', primaryBorder: '#829bb5', radius: 6, buttonRadius: 4, inputRadius: 3, controls: 'framed', tabs: 'filled', buttons: 'tonal' },
  { id: 'forest', name: 'Forest', description: 'Deep green-black, pale sage actions, soft fields and gently rounded controls.',
    canvas: '#0d1513', surface: '#16221e', alt: '#213029', raised: '#2b3d34', input: '#101b17', text: '#e7f0e9', muted: '#afc3b4', accent: '#a8d6b9', border: '#4c6758',
    primary: '#a8d6b9', primaryText: '#102418', primaryBorder: '#a8d6b9', radius: 9, buttonRadius: 8, inputRadius: 6, controls: 'soft', tabs: 'line', buttons: 'solid' },
  { id: 'petrol', name: 'Petrol', description: 'Dark blue-green, cyan outlines, flat fields and narrow selection rules.',
    canvas: '#0c1518', surface: '#14242a', alt: '#1d3238', raised: '#29434b', input: '#0d1c21', text: '#e6f2f4', muted: '#adc9cc', accent: '#a1dfe2', border: '#496b72',
    primary: '#14242a', primaryText: '#a1dfe2', primaryBorder: '#7bc0c6', radius: 6, buttonRadius: 4, inputRadius: 3, controls: 'underline', tabs: 'line', buttons: 'outline' },
  { id: 'olive', name: 'Olive', description: 'Warm dark olive, muted chartreuse actions and compact filled components.',
    canvas: '#151712', surface: '#20241b', alt: '#2c3225', raised: '#39422e', input: '#181d14', text: '#edf0e4', muted: '#bfc8ac', accent: '#c4d29a', border: '#606d4b',
    primary: '#c4d29a', primaryText: '#202516', primaryBorder: '#c4d29a', radius: 7, buttonRadius: 4, inputRadius: 3, controls: 'soft', tabs: 'filled', buttons: 'solid' },
  { id: 'espresso', name: 'Espresso', description: 'Brown-black panels, warm copper outlines and understated underlined inputs.',
    canvas: '#171310', surface: '#241e19', alt: '#322820', raised: '#40342a', input: '#1b1612', text: '#f4eee7', muted: '#cdbfb1', accent: '#efd4bf', border: '#75614f',
    primary: '#241e19', primaryText: '#efd4bf', primaryBorder: '#b89c87', radius: 7, buttonRadius: 5, inputRadius: 2, controls: 'underline', tabs: 'line', buttons: 'outline' },
  { id: 'aubergine', name: 'Aubergine', description: 'Muted plum-charcoal, tonal lavender actions and soft boxed selections.',
    canvas: '#17121a', surface: '#231c29', alt: '#302638', raised: '#3e3348', input: '#1c1622', text: '#f1eaf5', muted: '#c9b8d3', accent: '#d1b6e8', border: '#705c82',
    primary: '#49385d', primaryText: '#f1e7fb', primaryBorder: '#9b80b6', radius: 9, buttonRadius: 7, inputRadius: 5, controls: 'framed', tabs: 'filled', buttons: 'tonal' },
  { id: 'stone', name: 'Stone', description: 'Warm neutral gray, ivory primary buttons, flat panels and precise corners.',
    canvas: '#181817', surface: '#232322', alt: '#2e2f2c', raised: '#3b3d38', input: '#1c1d1a', text: '#f3f3eb', muted: '#c3c6b8', accent: '#dddcca', border: '#696d60',
    primary: '#dddcca', primaryText: '#21231c', primaryBorder: '#dddcca', radius: 5, buttonRadius: 3, inputRadius: 2, controls: 'hairline', tabs: 'outline', buttons: 'paper' },
];

export const semanticColors = { positive: '#a9d6b6', negative: '#f2b3ac', warning: '#edd49e', labelInk: '#151c20' };

export function themeVariables(theme) {
  return {
    '--canvas': theme.canvas, '--surface': theme.surface, '--surface-alt': theme.alt,
    '--raised': theme.raised, '--field': theme.input, '--fg': theme.text,
    '--muted-fg': theme.muted, '--accent': theme.accent, '--line': theme.border,
    '--primary-fill': theme.primary, '--primary-text': theme.primaryText, '--primary-line': theme.primaryBorder,
    '--positive': semanticColors.positive, '--negative': semanticColors.negative, '--warning': semanticColors.warning,
    '--panel-radius': `${theme.radius}px`, '--button-radius': `${theme.buttonRadius}px`, '--input-radius': `${theme.inputRadius}px`,
  };
}

export function applyTheme(id, root = document.documentElement) {
  const theme = themes.find(theme => theme.id === id) || themes.find(theme => theme.id === defaultTheme);
  root.dataset.theme = theme.id; root.dataset.controls = theme.controls;
  root.dataset.tabs = theme.tabs; root.dataset.buttons = theme.buttons;
  for (const [key, value] of Object.entries(themeVariables(theme))) root.style.setProperty(key, value);
  return theme;
}

export function contrastRatio(a, b) {
  const luminance = hex => {
    const rgb = hex.replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

export function themeContrastChecks(theme) {
  const checks = [];
  for (const [surfaceName, color] of Object.entries({ canvas: theme.canvas, panel: theme.surface, inset: theme.alt, raised: theme.raised, input: theme.input })) {
    for (const [name, foreground] of Object.entries({ text: theme.text, secondary: theme.muted, accent: theme.accent, positive: semanticColors.positive, negative: semanticColors.negative, warning: semanticColors.warning })) {
      checks.push({ name: `${name} on ${surfaceName}`, ratio: contrastRatio(foreground, color) });
    }
  }
  checks.push({ name: 'primary button', ratio: contrastRatio(theme.primaryText, theme.primary) });
  return checks;
}

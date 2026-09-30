import { themes, applyTheme, themeContrastChecks } from './themes.mjs';

const grid = document.getElementById('design-grid');
themes.forEach((theme, index) => {
  const card = document.createElement('article');
  card.className = 'design-card';
  applyTheme(theme.id, card);
  const number = String(index + 1).padStart(2, '0');
  const minimum = Math.min(...themeContrastChecks(theme).map(check => check.ratio)).toFixed(2);
  card.innerHTML = `
    <a class="design-image-link" href="./?theme=${theme.id}" target="_blank" rel="noopener" aria-label="Open ${theme.name} in a new tab"><img src="assets/previews/${theme.id}.jpg" alt="${theme.name} design applied to the Vessel play workspace" loading="${index < 2 ? 'eager' : 'lazy'}" width="1200" height="880"></a>
    <div class="design-card-content">
      <div class="design-card-title"><span>${number}</span><h2>${theme.name}</h2><div class="design-swatches" aria-hidden="true">${[theme.canvas, theme.surface, theme.raised, theme.accent].map(color => `<i style="background:${color}"></i>`).join('')}</div></div>
      <p>${theme.description}</p>
      <div class="gallery-components" aria-label="Component appearance sample"><span class="gallery-sample-primary">Apply position ↗</span><span class="gallery-sample-secondary">Save draft</span><span class="gallery-sample-input">$2,500.00</span></div>
      <div class="design-card-bottom"><span>Palette text min. ${minimum}:1</span><a class="button primary" href="./?theme=${theme.id}" target="_blank" rel="noopener">Try ${theme.name} ↗</a></div>
    </div>`;
  grid.append(card);
});

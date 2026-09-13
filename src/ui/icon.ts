import { createElement, type IconNode } from 'lucide';

interface IconOptions {
  className?: string;
  label?: string;
}

export function icon(iconNode: IconNode, options: IconOptions = {}): SVGElement {
  const svg = createElement(iconNode, {
    class: ['app-icon', options.className].filter(Boolean).join(' '),
    'aria-hidden': options.label ? undefined : 'true',
    role: options.label ? 'img' : undefined,
    focusable: 'false',
  });

  if (options.label) svg.setAttribute('aria-label', options.label);
  return svg;
}

export function iconMarkup(iconNode: IconNode, options: IconOptions = {}): string {
  return icon(iconNode, options).outerHTML;
}

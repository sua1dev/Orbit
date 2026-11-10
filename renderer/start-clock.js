'use strict';

// Rounded, tabular numerals drawn for the start page clock.
const clockDigits = {
  '0': 'M30 12C18 12 12 21 12 33V67C12 80 18 88 30 88S48 80 48 67V33C48 21 42 12 30 12Z',
  '1': 'M12 28L35 12V88',
  '2': 'M12 30C14 18 23 12 32 12C45 12 50 20 50 30C50 54 12 54 12 88H50',
  '3': 'M13 21C19 14 25 12 32 12C42 12 49 20 49 30C49 42 40 49 29 49C41 49 51 56 51 68C51 81 42 88 31 88C22 88 16 84 11 78',
  '4': 'M44 88V12L9 64H52',
  '5': 'M48 12H16L12 47C17 43 24 41 31 41C43 41 51 50 51 64C51 79 43 88 30 88C22 88 16 85 11 78',
  '6': 'M49 22C44 15 37 12 30 12C17 12 12 23 12 36V66C12 80 19 88 31 88C43 88 50 80 50 67C50 54 43 47 31 47C24 47 17 50 12 56',
  '7': 'M11 12H50L25 88',
  '8': 'M30 49C19 49 13 42 13 31C13 20 19 12 30 12S47 20 47 31C47 42 41 49 30 49ZM30 49C18 49 10 56 10 68C10 80 18 88 30 88S50 80 50 68C50 56 42 49 30 49Z',
  '9': 'M12 78C17 85 24 88 31 88C44 88 49 77 49 64V34C49 20 42 12 30 12C18 12 11 20 11 33C11 46 18 53 30 53C37 53 44 50 49 44',
};
const clockSvgNamespace = 'http://www.w3.org/2000/svg';
let clockId = 0;

function clockElement(tag, attributes) {
  const element = document.createElementNS(clockSvgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function createStartClock() {
  const time = el('time', 'start-clock');
  const id = 'orbit-clock-' + ++clockId;
  const svg = clockElement('svg', { viewBox: '0 0 278 100', 'aria-hidden': 'true', focusable: 'false' });
  const defs = clockElement('defs', {});
  const gradient = clockElement('linearGradient', { id: id + '-color', x2: '100%', y2: '38%' });
  for (const [offset, color] of [['0%', '#ff8ad5'], ['24%', '#d84aee'], ['49%', '#9274fa'], ['73%', '#47a6f0'], ['100%', '#59efdc']]) {
    gradient.append(clockElement('stop', { offset, 'stop-color': color }));
  }
  const mask = clockElement('mask', { id: id + '-mask', x: '0', y: '0', width: '278', height: '100', maskUnits: 'userSpaceOnUse' });
  const digits = [0, 62, 155, 217].map(x => {
    const path = clockElement('path', { transform: 'translate(' + x + ')', fill: 'none',
      stroke: 'white', 'stroke-width': '18', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    mask.append(path);
    return path;
  });
  for (const cy of [37, 72]) mask.append(clockElement('circle', { cx: '138', cy, r: '9', fill: 'white' }));
  defs.append(gradient, mask);
  svg.append(defs, clockElement('rect', { width: '278', height: '100', fill: 'url(#' + id + '-color)', mask: 'url(#' + id + '-mask)' }));
  time.append(svg);
  time.setDigits = value => {
    if (time.dataset.time === value) return;
    const symbols = value.replace(':', '');
    digits.forEach((path, index) => path.setAttribute('d', clockDigits[symbols[index]] || ''));
    time.dataset.time = value;
    time.setAttribute('aria-label', '서울 시각 ' + value);
  };
  return time;
}

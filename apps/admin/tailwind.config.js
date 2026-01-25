const baseConfig = require('../../libs/ui-kit/util/tailwind.config');
const { join } = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    join(__dirname, '{src,pages,components,app}/**/*.{ts,tsx,js,jsx,html}'),
    join(__dirname, '!{src,pages,components,app}/**/*.{stories,spec}.{ts,tsx,js,jsx,html}'),
    join(__dirname, '../../libs/ui-kit/ui/src/**/*.{ts,tsx,js,jsx}'),
    join(__dirname, '../../libs/ui-kit/util/src/**/*.{ts,tsx,js,jsx}'),
  ],
};

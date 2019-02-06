/*
  Eliminates SCSS variable interpolation, percentages from keyframes and non-class selectors
*/
module.exports = function isIgnoredSelector(selector) {
  return selector.includes('#{') || /^\d+(\.\d+)?/.test(selector) || !selector.includes('.');
};

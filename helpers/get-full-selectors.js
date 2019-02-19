const cartesianProduct = require('cartesian-product');

/*
  Return fully qualified selectors starting from the root of the stylesheet.
*/
module.exports = function getFullSelectors(selectorRule) {
  let selectors = [];
  let curRule = selectorRule;

  do {
    selectors.push(curRule.selectors);
    curRule = curRule.parent;
  } while (curRule && curRule.selectors);

  // Need Cartesian product in case selectors are nested and involve commas.
  selectors = cartesianProduct(selectors.reverse()).map(selArr => selArr.join(' ').trim());

  return selectors;
};

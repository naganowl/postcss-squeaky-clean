const CssSelectorParser = require('css-selector-parser').CssSelectorParser;
const isIgnoredSelector = require('./is-ignored-selector');

const parser = new CssSelectorParser();
parser.registerSelectorPseudos('has', 'not', 'global');
parser.registerNestingOperators('>', '+', '~', '&');
parser.registerAttrEqualityMods('^', 'apos;', '*', '~', '&', '$');
parser.enableSubstitutes();

/*
  Since the parser structure can be dynamic, stringify to pluck out the class
  selectors that can be scattered across pseudo-selectors or chained classes.
*/
module.exports = function collectClasses(styleSelector) {
  // `&` is SCSS, `~` can cause problems when used with the former (e.g. & ~ .foo)
  const selector = styleSelector.replace(/[&~>$+]/g, '').trim();
  if (isIgnoredSelector(selector)) {
    return [];
  }
  const classStr = JSON.stringify(parser.parse(selector)).match(/"classNames.*?\[(.*?)\]/g);
  const selectors = classStr.reduce((memo, classSelector) => {
    return memo.concat(JSON.parse(classSelector.split(':').pop()));
  }, []);
  return selectors;
};

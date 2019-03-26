const { calculate } = require('specificity');
const postcss = require('postcss');
const compact = require('lodash.compact');
const uniq = require('lodash.uniq');
const getFullSelectors = require('../helpers/get-full-selectors');

function makePropsImportant(cssRule) {
  cssRule.walkDecls((decl) => {
    decl.important = true; // eslint-disable-line no-param-reassign
  });
}

/*
  Given a stylesheet, detect the squeaky selectors and trim the declaration to just
  a single, most specific squeaky selector.

  This selector is usually the right most selector with a squeaky namespace. However,
  with non-class selectors and adjacency combinators (e.g. `+` and `~`) it groups
  squeaky selectors together or finds the closest ancestor squeaky selector and
  trims the declaration to that.

  For instance, `.foo-sqkd-dead + .bar-sqkd-beef` would stay unchanged, however
  `h1 .baz-sqkd-1337 div a` would be trimmed to `.baz-sqkd-1337 div a`
*/
module.exports = postcss.plugin('squeakyFlattenPlugin', () => {
  const flattenedSqkdSels = [];

  return function main(css) {
    css.walkRules((rule) => {
      const specificityList = calculate(getFullSelectors(rule).join(',')).map(result => result.specificity);
      const sameSelectorSpecificity = specificityList.every(el => el === specificityList[0]);
      let specificityCount;
      let selectorSpecificity;
      // Add comments to retain original specificity of each selector
      if (sameSelectorSpecificity) {
        specificityCount = `(${specificityList.length}) `;
        ([selectorSpecificity] = specificityList);
      } else {
        // Handle multiple (comma) selectors in a single rule
        specificityCount = '';
        selectorSpecificity = specificityList.join('; ');
      }
      rule.prepend({ text: `Specificity: ${selectorSpecificity} ${specificityCount}` });
      // eslint-disable-next-line no-param-reassign
      rule.selectors = uniq(rule.selectors.map((selector) => {
        const lastSelectorArr = selector.split(' ');
        const lastSelector = lastSelectorArr.slice(-1)[0];

        // Handle placeholder selectors
        if (selector.includes('%')) {
          return selector;
        }
        const sqkdSelectors = lastSelector.match(/\.[\w-]+/g);
        if (sqkdSelectors && lastSelector.includes('-sqkd-') && !/~+/.test(selector)) {
          // Allow these styles to be most important
          makePropsImportant(rule);
          if (sqkdSelectors.length > 1) {
            return lastSelector;
          }
          return sqkdSelectors[0];
        }

        let theSelector = selector;
        // Return closest ancestor squeaky selector if leaf/base selector misses squeaky modifiers
        if (selector.includes('-sqkd-')) {
          // Check if root selector is a tag
          let tagSelRoot = false;
          const endSelector = lastSelectorArr.pop();
          const flatSelArr = lastSelectorArr.reduceRight((memo, val, idx, theArr) => {
            if (val.includes('-sqkd-')) {
              const [nextAncestorSelector] = lastSelectorArr;
              if (nextAncestorSelector && !nextAncestorSelector.includes('-sqkd-')) {
                tagSelRoot = true;
                // Remove tag selectors
                const [sqSel] = val.match(/\.[\w-]+/);
                memo[idx] = sqSel; // eslint-disable-line no-param-reassign
              }
              // Break early from the loop.
              theArr.splice(0);
            }
            return memo.concat(val);
          }, [endSelector]);

          if (tagSelRoot) {
            // Memo insertion spliced tagless selector into array, so remove the original
            flatSelArr.pop();
          }
          theSelector = flatSelArr.reverse().join(' ');
        }
        return theSelector;
      }));

      // Log selectors that have been flattened top level
      rule.selectors.reduce((memo, sel) => {
        const selArr = compact(sel.replace(/[~+]/, '').split(' '));
        selArr.forEach((elSel) => {
          if (elSel.includes('-sqkd-')) {
            // Remove tag selectors that could be attached to squeaky selector.
            const sqkdSelectors = elSel.match(/\.[\w-]+/);
            // Account for multiple squeaky selectors attached.
            sqkdSelectors.forEach((sqkd) => {
              memo.push(sqkd);
            });
          }
        });

        return memo;
      }, flattenedSqkdSels);
    });

    // eslint-disable-next-line no-console
    console.log('\x1b[32m%s\x1b[0m',
      'The following squeaky selectors have been made top level:\n',
      uniq(flattenedSqkdSels));
  };
});

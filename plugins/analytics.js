const postcss = require('postcss');
const runShell = require('../helpers/run-shell');
const collectClasses = require('../helpers/collect-classes');
const getBaseSelector = require('../helpers/get-base-selector');


module.exports = postcss.plugin('squeakyAnalyticsPlugin', (options = {}) => {
  const { scssSheets } = options;
  const stylesheets = scssSheets.replace(/\n/g, ' ');

  return function main(css) {
    let allClasses = 0;
    let independentSelectors = 0;
    let theSelectors = [];

    css.walkRules((rule) => {
      rule.selectors.forEach((selector) => {
        let classList;
        if (selector.includes('.')) {
          classList = collectClasses(selector);
          allClasses += classList.length;
        }

        if (!selector.includes('-sqkd-')) {
          return selector;
        }

        const selectorInline = getBaseSelector(classList);

        theSelectors = theSelectors.concat(selectorInline);
        selectorInline.forEach((selClass) => {
          // Find uses of the base class selector in all stylesheets
          const search = runShell('sh', ['-c', `echo ${stylesheets} | xargs grep -inr "${selClass}[[:space:]{,]" | cut -d: -f1 | sort -u`]);
          const matchingSheets = search.split('\n').slice(0, -1);

          if (matchingSheets.length > 0) {
            console.log(`${selClass} appears in ${matchingSheets.join('\n')}`); // eslint-disable-line no-console
          } else {
            independentSelectors += 1;
            console.log(`${selClass} is only used here`); // eslint-disable-line no-console
          }
        });

        return selector;
      });
    });

    /* eslint-disable no-console */
    console.log(theSelectors);
    console.log(allClasses, 'all');
    console.log(theSelectors.length, 'total'); // squeaky selectors
    console.log(independentSelectors, 'clean'); // squeaky selectors whose base class have all been squeaky cleaned
    /* eslint-enable no-console */
    options.statsMap[options.scssPath] = { // eslint-disable-line no-param-reassign
      all: allClasses,
      clean: independentSelectors,
      total: theSelectors.length,
    };
    if (theSelectors.length === independentSelectors) {
      console.log(`${options.scssPath} can proceed to phase 2`); // eslint-disable-line no-console
    }
    return [];
  };
});

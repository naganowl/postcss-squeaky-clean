const postcss = require('postcss');
const compact = require('lodash.compact');
const difference = require('lodash.difference');
const intersection = require('lodash.intersection');
const uniq = require('lodash.uniq');
const findSelectorFiles = require('../helpers/find-selector-files');
const getFullSelectors = require('../helpers/get-full-selectors');
const getWhitelistFiles = require('../helpers/get-whitelist-files');
const squeakyFiles = require('../helpers/get-squeaky-files');
const runShell = require('../helpers/run-shell');

// Cache ancestor squeaky selector file list in case multiple leaf selectors share ancestor
const ancestorSelMap = {};
// Map squeaky selectors to it's associated rule object for chained/multiple selectors
const selectorNodeMap = {};

// Strings to decide the feature name for the stylesheet and whitelisted view files
let styleFeature;
let getFeatureName;

// Return squeaky selector entries to find squeaky ancestor
function filterSqkdSelectors(selectorArr) {
  return selectorArr.filter(selector =>
    // Filter out tag selectors that squeaky selectors could be targetting
    selector.includes('-sqkd-'));
}

// Helper function to log selector data on traversal
function logSelector(sArr, sel) {
  sArr.push(sel);
}

// Declarations are CSS prop/val pairs.
function isLeafNode(childNodes) {
  return childNodes.filter(childNode => ['decl', 'atrule'].includes(childNode.type)).length === childNodes.length;
}

// Parse specific leaf squeaky class selector devoid of spaces and sibling + parent references
function handleSingleSelector(sSel, selCallback) {
  if (/[~+]/.test(sSel)) {
    sSel.split(/[~+]/).forEach((pSel) => {
      const siblingSelector = filterSqkdSelectors(pSel.split(' ')).pop() || '';
      handleSingleSelector(siblingSelector, selCallback);
    });
  } else {
    const selectors = sSel.split(' ');
    // Find most specific level squeaky selector if there are multiple
    const rawTopSelector = filterSqkdSelectors(selectors).pop() || '';
    // Handle chained selectors at the leaf node
    const rawTopSelectors = rawTopSelector.replace(/:not\(.+?\)|:\w+$/g, '').split('.');
    rawTopSelectors.forEach((rtSel) => {
      // Ensure it's a chained squeaky class it's a part of
      if (rtSel && rtSel.includes('-sqkd-')) {
        const topSelector = `.${rtSel}`.replace(/[^\w.-]/g, '');
        selCallback(topSelector);
      }
    });
  }
}

// Given array of class selectors, pull out the squeaky class selectors without tags
function extractClassSelectors(nodeSelectors) {
  return uniq(nodeSelectors).reduce((memo, sel) => {
    const selArr = sel.split(' ');
    selArr.forEach((elSel) => {
      if (elSel.includes('-sqkd-')) {
        // Remove tag selectors that could be attached to squeaky selector.
        const sqkdSelectors = elSel.match(/\.[\w-]+/g);
        // Account for multiple squeaky selectors attached.
        sqkdSelectors.forEach((sSelector) => {
          memo.push(sSelector);
        });
      }
    });

    return memo;
  }, []);
}

// Find all parent (`&`) squeaky selectors.
function getRelatedSelectors(selRule) {
  const selectors = [];
  const sqkdRegExp = /\.([\w-]+sqkd[\w-]+)/g;
  const logHelper = logSelector.bind(null, selectors);
  let curRule = selRule;

  // Cheap test to see if there's potential at a related selector
  while (curRule && /&/.test(curRule.selector) && curRule.selector.includes('-sqkd-')) {
    let checkParent = false;

    // eslint-disable-next-line no-loop-func
    filterSqkdSelectors(curRule.selectors).forEach((parentSelector) => {
      const pSelArr = parentSelector.split(' ');
      // Check for parent reference
      if (parentSelector.indexOf('&.') === 0 && pSelArr.length === 1) {
        // FUTURE: Handle parent references in the middle of the selector
        const sqkdSelectors = parentSelector.match(sqkdRegExp);
        selectors.push(...sqkdSelectors);
        // As long as a single selector references the parent, need to check the parent.
        checkParent = true;
      // Edge case if parent is sibling of selector or contains pseudo-selector (such as `:hover`)
      } else if (/^&(?:\s+?[~+]|:\w+)/.test(parentSelector)) {
        // Take advantage of sibling check in helper
        handleSingleSelector(parentSelector, logHelper);
        checkParent = true;
      // Parent combinator exists however there is a squeaky selector as descendant
      } else {
        // Can be empty with a lack of squeaky selectors which is also handled below
        let hasSqueakyDescendant = false;
        // Detected squeaky descendant after chained selector
        handleSingleSelector(parentSelector, (sqSel) => {
          hasSqueakyDescendant = true;
          selectors.push(sqSel);
        });
        // Only climb if a squeaky selector is still missing
        if (hasSqueakyDescendant) {
          // Squeaky selector found, terminate search
          curRule = null;
        } else {
          checkParent = true;
        }
      }
    });

    if (checkParent) {
      curRule = curRule.parent;
    }
  }

  if (curRule) {
    // End of the parent chain, so current selector should be parsed as is
    curRule.selectors.forEach((cSel) => {
      handleSingleSelector(cSel, logHelper);
    });
  }

  return uniq(compact(selectors));
}

// Trim `theSelArr` of selectors starting with `thisSel` and all it's descendants
function ancestorsUntil(thisSel, theSelArr) {
  // Negative indices can happen with comma selectors
  const selIdx = Math.max(0, theSelArr.findIndex(arrEntry =>
    // Handle selector being in presence of a chained selector
    arrEntry.includes(thisSel)));
  return theSelArr.slice(0, selIdx);
}

// Obtain all individual squeaky ancestor selectors for a given selector
// Only a single ancestor entry is returned, however there can be multiple selectors connected
// `selList` is an array where each entry is an ancestor (or leaf) selector
// `curSel` is the leaf selector, usually the last entry of `selList` though there are exceptions
function getAncestors(curSel, selList) {
  return uniq(selList.reduce((aMemo, aSel) => {
    const collapseParents = aSel.replace(/\s&/g, '');
    // Assumes only one sibling combinator per selector
    const siblingMatch = collapseParents.match(/(.+?)[+~]/);
    // Trailing class for default to play well with the `slice` below
    const trimSiblings = (siblingMatch || [`${collapseParents} .foo`]).pop().trim();
    // Remove the other sibling in the case where there's a match
    const squeakyAncestorArr = filterSqkdSelectors(trimSiblings.split(' ').slice(0, -1));

    let ancestorSqueakySel;
    // Single entry ancestor arrays are already top level leaf nodes
    if (squeakyAncestorArr.length > 1) {
      if (siblingMatch) {
        // `reverse` mutates the original array
        squeakyAncestorArr.reverse();
        // Find the most descendant selector
        ([ancestorSqueakySel] = squeakyAncestorArr);
      } else {
        const prevAncestorArr = ancestorsUntil(curSel, squeakyAncestorArr).reverse();
        ([ancestorSqueakySel = ''] = prevAncestorArr);
      }
    } else if (siblingMatch && squeakyAncestorArr.length === 1) {
      ([ancestorSqueakySel] = squeakyAncestorArr);
    }

    if (ancestorSqueakySel) {
      let ancestorSelList = [];
      // Cleanse selectors of pseudo selectors
      handleSingleSelector(ancestorSqueakySel, logSelector.bind(null, ancestorSelList));
      // Separate tag selectors from the class selectors
      ancestorSelList = extractClassSelectors(ancestorSelList);
      aMemo.push(...ancestorSelList);
    }

    return aMemo;
  }, []));
}

// Return whitelist of files for each squeaky selector for removal from other files
// Also returns a list of ancestor selectors which will be queued up for cleaning
function getSelectorMap(selArr) {
  // For upcoming rounds of cleaning
  const ancestorSels = [];
  const selFileMap = selArr.reduce((memo, sel) => {
    const selRule = selectorNodeMap[sel];
    const allSelectors = getFullSelectors(selRule);
    const ancestorSqueakySels = getAncestors(sel, allSelectors);

    // Top level leaf nodes define their own whitelist files
    const selWhitelistFiles = getWhitelistFiles.find([sel]);
    let whitelistFiles = ancestorSqueakySels.length ? [] : selWhitelistFiles;
    ancestorSqueakySels.forEach((ancestorSqueakySel) => {
      // eslint-disable-next-line operator-linebreak
      const ancestorSelWhitelistFiles =
        ancestorSelMap[ancestorSqueakySel] || getWhitelistFiles.find([ancestorSqueakySel]);
      ancestorSelMap[ancestorSqueakySel] = ancestorSelWhitelistFiles;
      ancestorSels.push(ancestorSqueakySel);

      // These are present if the ancestor selector resides only in template files
      const { parentFiles } = ancestorSelWhitelistFiles;
      const leafFiles = findSelectorFiles.find([sel]);
      const ancFiles = findSelectorFiles.find([ancestorSqueakySel]);
      // The following are the only places the selectors are used if entries exist
      const sharedFiles = intersection(leafFiles, ancFiles);
      const leafParentFiles = intersection(leafFiles, parentFiles);

      if (leafParentFiles.length) {
        // Base selector belongs in the script file requiring the ancestor leaf file
        whitelistFiles = whitelistFiles.concat(difference(squeakyFiles, leafParentFiles));
      } else if (sharedFiles.length) {
        whitelistFiles = whitelistFiles.concat(difference(squeakyFiles, sharedFiles));
      } else {
        whitelistFiles = whitelistFiles.concat(ancestorSelWhitelistFiles);
      }
    });

    whitelistFiles = whitelistFiles.filter(selFile => getFeatureName(selFile) !== styleFeature);
    // Keying each selector to a list of files for
    memo[sel] = uniq(whitelistFiles); // eslint-disable-line no-param-reassign

    return memo;
  }, {});

  return { selFileMap, ancestorSels: uniq(ancestorSels) };
}

// Given a CSS rule, parse out the most specific selectors and add them to the
// passed in `collectedSelArr`.
function parseRuleSelectors(theRule, collectedSelArr) {
  if (theRule.selector.includes('-sqkd-')) {
    const composeHelper = logSelector.bind(null, collectedSelArr);
    // There could be multiple selector at the current level
    const filteredSqkSel = filterSqkdSelectors(theRule.selectors);
    const singleSqkSel = filteredSqkSel.filter(fSel => !/&/.test(fSel));
    // Related selectors will be grouped together in a single entry
    if (filteredSqkSel.length !== singleSqkSel) {
      // SCSS throws a compile error if `&` is used without a parent
      const relatedSelectors = getRelatedSelectors(theRule);
      relatedSelectors.forEach(composeHelper);
    }
    singleSqkSel.forEach((rSel) => {
      // Related selectors will be grouped together in a single entry
      handleSingleSelector(rSel, composeHelper);
    });
  }
}

module.exports = postcss.plugin('squeakyHeuristicPlugin', (opts = {}) => {
  const {
    directories, statsPath, filterInclude, filterExclude, commonInclude,
  } = opts;
  ({ getFeatureName, styleFeature } = opts);
  findSelectorFiles.init({ directories });
  getWhitelistFiles.init({
    directories, statsPath, filterInclude, filterExclude, commonInclude,
  });
  squeakyFiles.init({ directories });

  return function main(css) {
    let selectorArr = [];
    css.walkRules((rule) => {
      const filteredSel = filterSqkdSelectors(rule.selectors);
      // Map all selectors to associated rules for ancestor selector lookup
      const parsedClasses = extractClassSelectors(filteredSel);
      parsedClasses.forEach((ruSel) => {
        selectorNodeMap[ruSel] = rule;
      });

      // Find leaf level squeaky selectors
      if (isLeafNode(rule.nodes)) {
        parseRuleSelectors(rule, selectorArr);
      }
    });

    // Track the squeaky selectors visited.
    const selectorSet = new Set(selectorArr);
    while (selectorArr.length) {
      // Break down possible chained/multiple top level squeaky selectors.
      const expandedSelArr = extractClassSelectors(selectorArr);

      // Map raw stylesheet selectors to list of whitelisted files
      const { selFileMap, ancestorSels } = getSelectorMap(expandedSelArr);
      selectorArr = difference(ancestorSels, [...selectorSet]);
      ancestorSels.forEach(selectorSet.add, selectorSet);

      /* eslint-disable no-console */
      console.log('**********************Beginning replacement of following selectors**********************');
      console.log(selectorArr);
      Object.keys(selFileMap).forEach((sel) => {
        console.log(`Removing ${sel}`);
        console.log(runShell('sh', ['scripts/replace_selectors.sh', sel, selFileMap[sel]]));
      });
      console.log('**********************Ancestor selectors queued up**********************');
      console.log(ancestorSels);
      /* eslint-enable no-console */
    }
  };
});

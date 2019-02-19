const specificity = require('specificity');
const postcss = require('postcss');
const collectClasses = require('../helpers/collect-classes');
const getBaseSelector = require('../helpers/get-base-selector');
const getFullSelectors = require('../helpers/get-full-selectors');

// Selector string -> Map<String, ValMap> of CSS property strings to metadata for selector
// ValMap contains value for the given property and it's full selector, specificity + importance
// See ConflictsMap below for cases where multiple key/value pairs are detected for a given selector
let selectorPropMap;
// Object keying base selector string to a Conflict object (see below) tracking the CSS declarations
// which require file precedence intervention since the specificity of their declarations are equal.
let specMap;

// Helper function to evaluate the specificity of a file based off
// where it is in the option directory array
function valueAccumulator(aFile, filesOrDirectory, initVal = 0) {
  return filesOrDirectory.reduce((memo, val, idx, theArray) => {
    const isInDir = aFile.includes(val);
    if (isInDir) {
      // Break early since only one should be matched
      theArray.splice(1);
    }
    return memo + ((10 ** (idx + 1)) * isInDir);
  }, initVal);
}

// Heuristic function taking a file string and weighting it
// against specified array options to determine specificity
// based on the file precedence defined in said options
function fileValue(theFile) {
  // Can add exceptions that should take less precedence
  let primaryVal = valueAccumulator(theFile, [
    'common/',
    'styleguide/layout',
    'reset',
    'helper',
    'styleguide/',
    'internal/',
    'backbone/',
    'stylesheets/',
    'javascripts/',
  ]);

  // Exceptions that take more precedence
  primaryVal = valueAccumulator(theFile, ['styleguide/modules/tables/header-cell'], primaryVal);

  return primaryVal;
}

// Boolean of whether the second argument rule is more specific
function isFileOlder(newRule, oldRule) {
  const { file: newFile } = newRule;
  const { file: oldFile } = oldRule;

  if (newFile === oldFile) {
    return newRule.line < oldRule.line;
  }
  const newValue = fileValue(newFile);
  const oldValue = fileValue(oldFile);

  if (newValue === oldValue) {
    // Same top level directory, so use lexicographic sort
    return newFile < oldFile;
  }
  return newValue < oldValue;
}

// Compares two Conflict objects for a given selector string and returns
// whichever object has higher CSS specificity
function findSpecific(...args) {
  const [newValues, oldValues, baseSel] = args;
  let specificValues;
  const valueSpec = specificity.compare(newValues.specificity, oldValues.specificity);

  if (oldValues.important || valueSpec === -1) {
    specificValues = oldValues;
  } else {
    if (valueSpec === 0) {
      specMap[baseSel] = newValues;
      const fileOrder = +isFileOlder(newValues, oldValues);
      return args[fileOrder];
    }
    // Take into account specificity if both or neither are important
    specificValues = newValues;
  }

  return specificValues;
}

module.exports = postcss.plugin('squeakySpecificityPlugin', (options = {}) => {
  /* Selector string -> Map<String, Conflicts>, where Conflicts is a Map<String, Conflict>
  /* of CSS prop name strings to Conflict objects containing the conflicting value, full selector
  /*  and the most specific conflict object. */
  const { conflictsMap, specificityMap, scssPath } = options;
  selectorPropMap = new Map();
  specMap = specificityMap;
  return function main(css) {
    css.walkRules((rule) => {
      rule.selectors.forEach((selector) => {
        const lastSelector = selector.split(' ').pop();
        // Ensures a class selector is being checked
        if (!selector.includes('-sqkd-') || lastSelector.indexOf('.') !== 0) {
          return selector;
        }

        let classList;
        if (selector.includes('.')) {
          classList = collectClasses(selector);
        }

        const selectorInline = getBaseSelector(classList);

        // The last class selector in the selector chain is what might have conflicts
        const baseSelector = selectorInline.slice(-1)[0];
        const nodes = rule.nodes.slice(0);
        for (let i = 0; i < nodes.length; i += 1) {
          // TODO: Check non-squeaky base selectors for conflicts?
          const node = nodes[i];
          if (['comment', 'atrule'].includes(node.type)) {
            continue; // eslint-disable-line no-continue
          }
          const { prop, value, important } = node;
          // Skip over rules lacking prop/value pairs. Nested children rules will be visited later!
          if (prop) {
            const fullSelectors = getFullSelectors(rule);
            const fullSelector = fullSelectors.filter(fSel => fSel.includes(baseSelector))[0];
            const selectorSpecificity = specificity.calculate(fullSelector)[0].specificityArray;
            const valueMap = new Map([
              ['value', value],
              ['source', fullSelector],
              ['specificity', selectorSpecificity],
              ['important', important],
              ['file', scssPath],
              ['line', rule.source.start.line],
            ]);
            if (selectorPropMap.has(baseSelector)) {
              const propMap = selectorPropMap.get(baseSelector);

              if (propMap.has(prop)) {
                const valMap = propMap.get(prop);
                const origValues = {
                  value,
                  important,
                  source: fullSelector,
                  specificity: selectorSpecificity,
                  file: scssPath,
                  line: rule.source.start.line,
                };
                const conflictValues = {
                  value: valMap.get('value'),
                  source: valMap.get('source'),
                  specificity: valMap.get('specificity'),
                  important: valMap.get('important'),
                  file: valMap.get('file'),
                  line: valMap.get('line'),
                };
                const mostSpecific = findSpecific(origValues, conflictValues, baseSelector);
                /* eslint-disable no-console */
                console.log(`Conflict with ${prop}: ${value} with ${baseSelector}`);
                console.log(`Existing pair is ${valMap.get('value')} found in ${valMap.get('source')}`);
                /* eslint-enable no-console */

                if (origValues.source === conflictValues.source) {
                  continue; // eslint-disable-line no-continue
                }

                if (conflictsMap.has(baseSelector)) {
                  const conflicts = conflictsMap.get(baseSelector);
                  if (conflicts.has(prop)) {
                    const conflictForProp = conflicts.get(prop);
                    // Additional conflict with `prop`
                    conflictForProp.mostSpecific = findSpecific(
                      origValues, conflictForProp.mostSpecific, baseSelector,
                    );

                    if (origValues.source === conflictForProp.mostSpecific.source) {
                      continue; // eslint-disable-line no-continue
                    }

                    conflictForProp.values.push(origValues);
                  } else {
                    // New conflict with `prop` for `baseSelector`
                    conflicts.set(prop, { mostSpecific, values: [origValues, conflictValues] });
                  }
                } else {
                  // First conflict ever with `baseSelector`
                  conflictsMap.set(baseSelector, new Map([
                    [prop, { mostSpecific, values: [origValues, conflictValues] }],
                  ]));
                }
              } else {
                // Add new CSS prop/val pair for `baseSelector`
                propMap.set(prop, valueMap);
              }
            } else {
              // First prop/value pair for this `baseSelector`
              selectorPropMap.set(baseSelector, new Map([[prop, valueMap]]));
            }
          }
        }

        return selector;
      });
    });

    return [];
  };
});

const collectClasses = require('./collect-classes');

const ACTION_CLASSES = require('./action-classes');
const CONTROLLER_CLASSES = require('./controller-classes');

const BLACKLIST_CLASSES = [
  '.backgrid',
  '.backgrid-paginator',
  '.category',
  '.disabled',
  '.editable',
  '.has-items',
  '.item',
  '.mjs-nestedSortable-error',
  '.renderable',
  '.sort-caret',
  '.sortable',
  '.string-cell',
  '.username',
].concat([
  ...CONTROLLER_CLASSES,
  ...ACTION_CLASSES,
]);
const BLACKLIST_PREFIXES = [
  '.language-',
  '.select2',
  '.selectize',
  '.tdcss',
  '.tddcss',
  '.tipsy',
  '.ui-',
];

function blacklistedPrefix(classList) {
  // Loop over `classList` top level in order to return an offending selector.
  return classList.find((classSelector) => {
    return BLACKLIST_PREFIXES.find((prefix) => {
      return classSelector.indexOf(prefix) === 0;
    });
  });
}

/*
  Given a full (possibly) hierarchical selector, return the blacklisted class
  that matches or the full selector with a blacklisted prefix
*/
module.exports = function blacklistedClass(selectorName) {
  const selectorClasses = collectClasses(selectorName).map((selector) => {
    return `.${selector}`;
  });
  const hasPrefix = blacklistedPrefix(selectorClasses);
  return hasPrefix || BLACKLIST_CLASSES.find((className) => {
    return selectorClasses.includes(className);
  });
};

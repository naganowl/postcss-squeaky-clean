const collectClasses = require('./collect-classes');

let BLACKLIST_CLASSES;
let BLACKLIST_PREFIXES;

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
module.exports = {
  init: function(opts) {
    BLACKLIST_CLASSES = opts.BLACKLIST_CLASSES;
    BLACKLIST_PREFIXES = opts.BLACKLIST_PREFIXES;
  },
  find: function(selectorName) {
    const selectorClasses = collectClasses(selectorName).map((selector) => {
      return `.${selector}`;
    });
    const hasPrefix = blacklistedPrefix(selectorClasses);
    return hasPrefix || BLACKLIST_CLASSES.find((className) => {
      return selectorClasses.includes(className);
    });
  },
};

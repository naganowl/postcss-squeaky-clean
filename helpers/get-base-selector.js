/*
  Return unique instances of selectors clean of squeaky namespaces for analysis.
*/
module.exports = function getBaseSelector(selectorList) {
  return selectorList.filter((sel, pos, arr) =>
    // `uniq` the selectors
    arr.indexOf(sel) === pos).map(aClass =>
    // Get base class to see if it's used in other stylesheets
    aClass.replace(/-sqkd-\w+/g, ''));
};

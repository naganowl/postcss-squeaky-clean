/* eslint-disable no-console */

const difference = require('lodash.difference');
const uniq = require('lodash.uniq');
const findSelectorFiles = require('./find-selector-files');
const sourceFiles = require('./get-squeaky-files');

// Parsed from passed in JSON file generated via webpack
let moduleData;

// Arrays of RegExps to decide which types of files should be traversed.
// `filterInclude` takes precedence over `filterExclude`
let filterInclude;
let filterExclude;
// RegExp to filter down returned namespaced files
let sqkdExclude;

// RegExp for whitelist of paths to allow from CommonChunk modules
let commonInclude;

// Is it a legacy JS/Coffee/ECO file?
function isFilteredFile(filterFile) {
  // File can match any of these RegExps
  const fileIncludes = filterInclude.some(filt => filt.test(filterFile));
  // File should avoid matching any of these
  const fileExcludes = filterExclude.some(filt => filt.test(filterFile));
  return fileIncludes
    && !fileExcludes;
}

/*
  Given an array of selectors, find the top level files that use it and all
  descendant view files related to it.

  This is done by looping through all the files that reference the passed in selectors
  and for each file determine which parts of the app use it by analyzing the require tree
  that webpack provides to isolate the files that actually need the squekay selector so that
  the selector can be removed from all other files.
*/
module.exports = {
  init(opts) {
    const { directories, statsPath } = opts;
    // Default to any path/file without a filter
    ({ filterInclude = [], filterExclude = [], commonInclude = /.*/, sqkdExclude = /(?!)/ } = opts);

    try {
      // eslint-disable-next-line import/no-dynamic-require
      moduleData = typeof statsPath === 'string' ? require(statsPath) : statsPath; // eslint-disable-line global-require
      if (typeof moduleData === 'string') {
        moduleData = JSON.parse(moduleData);
      }

      findSelectorFiles.init({ directories });
      sourceFiles.init({ directories });
    } catch (e) {
      console.log('\x1b[31m%s\x1b[0m', 'Please run `webpack --json` first and try again!');
    }
  },
  find(selectorArr) {
    let parentFile;
    let sqkdFile;
    const parentFiles = [];
    let filesToCheck = findSelectorFiles.find(selectorArr).filter(selFile => !sqkdExclude.test(selFile));
    const firstLevel = filesToCheck.length;
    // Zero index is bookmarklet, similar to webpack config
    const { chunks, modules } = moduleData.children[1];
    const [commonChunks] = chunks.filter(chunk => chunk.names.includes('common-chunks'));

    let isLeafFile;
    // See if `module` is a part of the dependency chain for squeaky selectors
    const moduleCheck = function check(module) {
      // Check if `module` has been `require`/`import` from a squeaky file
      if (module.issuerName && module.issuerName.includes(sqkdFile)) {
        // Normalize path to be relative without dots
        const moduleName = module.name.replace(/^\.\//, '');
        console.log(moduleName);
        if (!filesToCheck.includes(moduleName) && isFilteredFile(moduleName)) {
          isLeafFile = false;
          filesToCheck.push(moduleName);
        }
      }
    };
    const findParent = function look(module) {
      return module.name.includes(sqkdFile);
    };

    const allModules = uniq(modules.concat(commonChunks.modules));
    // `for` loop to allow array to grow from file dependencies
    for (let idx = 0; idx < filesToCheck.length; idx += 1) {
      isLeafFile = true;
      sqkdFile = filesToCheck[idx];
      console.log(`Finding dependencies of: ${sqkdFile}`);
      console.log('--------------------------');
      // Check the parent references of each file
      allModules.forEach(moduleCheck);
      // Skip finding parents for spec files
      if (isLeafFile && /\.eco$/.test(sqkdFile)) {
        console.log('File lacks dependencies. Finding parent');
        // If dependencies were missing from the first loop, find what requires it
        [parentFile] = allModules.filter(findParent);
        if (parentFile) {
          parentFile = parentFile.issuerName.replace(/^\.\//, '');
        } else {
          throw new Error(`Dead file! Please remove ${sqkdFile}!`);
        }
        sqkdFile = parentFile;
        if (idx < firstLevel) {
          parentFiles.push(parentFile);
        }
        console.log(`Found parent file: ${parentFile}`);
        console.log('Finding dependencies');
        console.log('--------------------------');
        // Traverse tree with parent file since the original file is a leaf file
        allModules.forEach(moduleCheck);
      }
      console.log('\n');
    }

    // Array of modules that have been common chunked
    const commonPaths = commonChunks.modules.reduce((memo, commonChunk) => {
      const { identifier } = commonChunk;

      if (isFilteredFile(identifier)) {
        const [filePath] = identifier.match(commonInclude);
        memo.push(filePath);
      }

      return memo;
    }, []);
    filesToCheck = uniq(filesToCheck.concat(commonPaths));

    // Remove `filesToCheck` from `sourceFiles`
    const replaceFiles = difference(sourceFiles.find(), filesToCheck);

    // Help heuristic plugin narrow down files if ancestor selector is a leaf files
    // and it's parent file contains the base selector.
    if (parentFiles.length) {
      replaceFiles.parentFiles = parentFiles;
    }

    return replaceFiles;
  },
};

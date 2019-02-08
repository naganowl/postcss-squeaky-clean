#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const difference = require('lodash.difference');
const uniq = require('lodash.uniq');
const findAllFilesInDirectories = require('../helpers/find-all-files-in-directories.js');

// Add referenced squeaky selectors in `composes` use to passed in `selectorArr`
function extractComposeUses(selectorArr, sheetContents) {
  const composedSelectors = sheetContents.match(/composes:[\s\n]+?([\w\n\s-]+)/g);
  if (composedSelectors) {
    composedSelectors.reduce((memo, selectorValue) => {
      const refSels = selectorValue.split(/\s+/).filter((sel) => { return sel.includes('-sqkd-'); });
      // Mutate the original array
      memo.push(...refSels);
      return memo;
    }, selectorArr);
  }
}

function getSqueakyClassNames(filePath, contentFn, addClassDot) {
  const contents = fs.readFileSync(filePath, 'utf8');
  let regex = /[\w-]+-sqkd-\w+/g;
  if (addClassDot) {
    regex = /\.[\w-]+-sqkd-\w+/g;
  }

  // Perform other operations on stylesheet content for performance.
  if (typeof contentFn === 'function') {
    contentFn(contents);
  }

  const matches = contents.match(regex) || [];
  return matches.map((className) => {
    return className[0] === '.' ? className.slice(1) : className;
  });
}

function stylesheetReduceMethod(stylesheets, selArr, fileFn) {
  return uniq(stylesheets.reduce(((classNames, filePath) =>
    // Curry `composedSqueakyClassNames` to have squeaky selectors collected on file open.
    classNames.concat(getSqueakyClassNames(filePath, fileFn, true))
  ), selArr));
}

function parseCmdArgs() {
  const args = process.argv;
  const cwd = process.cwd();
  args[0] = null; // To simplify checks if flags are missing
  const directoriesPathIdx = args.indexOf('--directoriesPath');
  const pathRootIdx = args.indexOf('--pathRoot');
  const composeDirIdx = args.indexOf('--composeDir');

  const directoriesPath = args[directoriesPathIdx + 1];
  const pathRootVal = args[pathRootIdx + 1];
  const composeDir = args[composeDirIdx + 1];

  let directories;
  let pathRoot;

  if (directoriesPath && !path.isAbsolute(directoriesPath)) {
    directories = require(path.resolve(cwd, directoriesPath));
  }

  if (pathRootVal && !path.isAbsolute(pathRootVal)) {
    pathRoot = path.resolve(cwd, pathRootVal);
  }

  return { directories, pathRoot, composeDir };
}

const cmdArgs = parseCmdArgs()
const directoryPaths = require('../helpers/directory-paths.js');
directoryPaths.init(cmdArgs);
const baseDirectoryPaths = directoryPaths.calculate();

//
// Collect all defined squeaky cleaned class names

const cssFiles = findAllFilesInDirectories(baseDirectoryPaths, '.css');
console.log('css count', cssFiles.length);
const sassFiles = findAllFilesInDirectories(baseDirectoryPaths, '.scss');
console.log('sass count', sassFiles.length);

const stylesheetFiles = cssFiles.concat(sassFiles);
let composedSqueakyClassNames = [];
const composeFn = extractComposeUses.bind(undefined, composedSqueakyClassNames);
const definedSqueakyClassNames = stylesheetReduceMethod(stylesheetFiles, [], composeFn);

//
// Collect all used squeaky cleaned class names

const jsFiles = findAllFilesInDirectories(baseDirectoryPaths, '.js');
console.log('javascript count', jsFiles.length);
const coffeeFiles = findAllFilesInDirectories(baseDirectoryPaths, '.coffee');
console.log('coffee count', coffeeFiles.length);
const ecoFiles = findAllFilesInDirectories(baseDirectoryPaths, '.eco');
console.log('eco count', ecoFiles.length);
const rbFiles = findAllFilesInDirectories(baseDirectoryPaths, '.rb');
console.log('ruby count', rbFiles.length);
const erbFiles = findAllFilesInDirectories(baseDirectoryPaths, '.erb');
console.log('erb count', erbFiles.length);
const ejsFiles = findAllFilesInDirectories(baseDirectoryPaths, '.ejs');
console.log('ejs count', ejsFiles.length);

// To gather composed classes in React code
const feDirectories = directoryPaths.calculate(cmdArgs.composeDir);
const reactCssFiles = findAllFilesInDirectories(feDirectories, '.css');
console.log('react css count', reactCssFiles.length);
const reactSassFiles = findAllFilesInDirectories(feDirectories, '.scss');
console.log('react sass count', reactSassFiles.length);
const reactStylesheetFiles = reactCssFiles.concat(reactSassFiles);
composedSqueakyClassNames = stylesheetReduceMethod(reactStylesheetFiles, composedSqueakyClassNames, composeFn);

const nonStylesheetFiles = [
  ...jsFiles,
  ...coffeeFiles,
  ...ecoFiles,
  ...rbFiles,
  ...erbFiles,
  ...ejsFiles,
];
const usedSqueakyClassNames = uniq(nonStylesheetFiles.reduce(((classNames, filePath) =>
  classNames.concat(getSqueakyClassNames(filePath))
), []).concat(composedSqueakyClassNames));

//
// Get the difference and complain!

const a = difference(definedSqueakyClassNames, usedSqueakyClassNames);
const b = difference(usedSqueakyClassNames, definedSqueakyClassNames);
const unusedClassNames = uniq(a.concat(b)).sort();

console.log('UNUSED SQUEAKY CLASSNAMES', unusedClassNames);
if (unusedClassNames.length > 0) {
  console.log('\x1b[31m%s\x1b[0m', 'Please check the usage of the class name(s) mentioned above by running `node script/node/verify-sqkd-class-names.js` locally!');
}
process.exit(unusedClassNames.length);

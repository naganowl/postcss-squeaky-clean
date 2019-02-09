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
      const refSels = selectorValue.split(/\s+/).filter(sel => sel.includes('-sqkd-'));
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
  return matches.map(className => (className[0] === '.' ? className.slice(1) : className));
}

function stylesheetReduceMethod(stylesheets, selArr, fileFn) {
  return uniq(stylesheets.reduce(((classNames, filePath) =>
    // Curry `composedSqueakyClassNames` to have squeaky selectors collected on file open.
    classNames.concat(getSqueakyClassNames(filePath, fileFn, true))
  ), selArr));
}

function parseCmdArgs() {
  const args = [...process.argv];
  const cwd = process.cwd();
  args[0] = null; // To simplify checks if flags are missing
  const directoriesPathIdx = args.indexOf('--directoriesPath');
  const pathRootIdx = args.indexOf('--pathRoot');
  const composeDirIdx = args.indexOf('--composeDir');
  const extIdx = args.indexOf('--ext');

  const directoriesPath = args[directoriesPathIdx + 1];
  const pathRootVal = args[pathRootIdx + 1];
  const composeDir = args[composeDirIdx + 1];
  const ext = args[extIdx + 1];

  let directories;
  let pathRoot;

  if (directoriesPath && !path.isAbsolute(directoriesPath)) {
    directories = require(path.resolve(cwd, directoriesPath));
  }

  if (pathRootVal && !path.isAbsolute(pathRootVal)) {
    pathRoot = path.resolve(cwd, pathRootVal);
  }

  return {
    directories, pathRoot, composeDir, ext,
  };
}

const cmdArgs = parseCmdArgs();
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

const fileExts = cmdArgs.ext.split(',');
const nonStylesheetFiles = fileExts.reduce((memo, fileExt) => {
  const filesInDir = findAllFilesInDirectories(baseDirectoryPaths, `.${fileExt}`);
  console.log(`${fileExt} count`, filesInDir.length);
  return memo.concat(filesInDir);
}, []);

// To gather composed classes in React code
const feDirectories = directoryPaths.calculate(cmdArgs.composeDir);
const reactCssFiles = findAllFilesInDirectories(feDirectories, '.css');
console.log('react css count', reactCssFiles.length);
const reactSassFiles = findAllFilesInDirectories(feDirectories, '.scss');
console.log('react sass count', reactSassFiles.length);
const reactStylesheetFiles = reactCssFiles.concat(reactSassFiles);
composedSqueakyClassNames = stylesheetReduceMethod(reactStylesheetFiles, composedSqueakyClassNames, composeFn);

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

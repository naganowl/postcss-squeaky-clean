#!/usr/bin/env node

// node libraries
const fs = require('fs');
const path = require('path');
const glob = require('glob');

// PostCSS dependencies/plugins
const postcss = require('postcss');
const syntax = require('postcss-scss');
const squeakyCleanPlugin = require('squeaky-clean/plugins/clean');
const squeakyAnalyticsPlugin = require('squeaky-clean/plugins/analytics');

// Custom require files or inlined arrays for analysis
const directories = require('./helpers/directories');
const blacklistedClasses = require('./helpers/blacklisted-classes');
const scssSheets = require('./helpers/scss-sheets');

// Data structures for the `analysis` plugin
const statsMap = {};
const conflictsMap = new Map();

function isStylesheet(str) {
  return str.match(/\.((?:s)?css)$/);
}

function logAnalytics() {
  console.log(statsMap);
  let all = 0;
  let total = 0;
  let clean = 0;
  const squeakyFiles = Object.keys(statsMap);
  const stylesheets = scssSheets.split('\n').length + 1;
  squeakyFiles.forEach((key) => {
    const counts = statsMap[key];
    all += counts.all;
    total += counts.total;
    clean += counts.clean;
  });
  console.log('all class selectors', all);
  console.log('clean class selectors', clean);
  console.log('total squeaky class selectors', total);
  console.log('percentage of clean over total', (clean / (total || 1)) * 100);
  console.log('files processed', squeakyFiles.length);
  console.log('total stylesheets', stylesheets);
  console.log('percentage of files processed over total stylesheets', (squeakyFiles.length / stylesheets) * 100);
}

function writeStyles(scssPath, opts = {}) {
  const {
    useAnalytics
  } = opts;
  let writeFile = true;
  fs.readFile(scssPath, (err, scss) => {
    console.log(`\n\n${scssPath}`);
    let plugin;
    if (useAnalytics) {
      plugin = squeakyAnalyticsPlugin;
    } else {
      writeFile = true;
      plugin = squeakyCleanPlugin;
    }

    postcss([plugin({
      scssPath, statsMap, conflictsMap, directories, fileExts: 'js,coffee,eco,rb,erb,ejs', scssSheets, ...blacklistedClasses,
    })])
      .process(scss, { syntax })
      .then((result) => {
        if (useAnalytics) {
          logAnalytics();
        } else if (writeFile) {
          fs.writeFileSync(scssPath, result.content, 'utf8');
        }
      });
  });
}

function isSwitch(val) {
  return val.indexOf('--') === 0;
}

function getPaths(filePath) {
  const globPath = `./${filePath}/**/*.{css,scss}`;
  const match = isStylesheet(filePath);
  return match ? filePath : globPath;
}

// Main script to handle plugins. These can be split out individually for each plugin.
(function main() {
  let withDir;
  let useAnalytics = false;
  const args = process.argv.slice(2);

  args.forEach((val) => {
    if (isSwitch(val)) {
      // Guard against regex test once an analytics flag has been detected (to support `xargs` use)
      if (/analy(tics|ze)$/.test(val)) {
        useAnalytics = true;
      }
    } else {
      withDir = val;
    }
  });

  if (withDir) {
    // Push stylesheet and/or directory paths
    const stylesheets = args.reduce((accumulator, filePath) => {
      if (!isSwitch(filePath)) {
        // May be a stylesheet or a "globable" directory
        const stylePath = getPaths(filePath);
        const sheets = glob.sync(stylePath);
        return accumulator.concat(sheets);
      }
      return accumulator;
    }, []);
    const styleMethod = writeStyles;
    console.log('Processing the following stylesheets:');
    console.log(stylesheets);

    stylesheets.forEach((file) => {
      const absFile = path.join(__dirname, '..', '..', file);
      styleMethod(absFile, { useAnalytics });
    });
  } else {
    throw new Error('Please provide a path to a directory or stylesheet to be squeaky cleaned!');
  }
}());
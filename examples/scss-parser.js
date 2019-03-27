#!/usr/bin/env node

// node libraries
const fs = require('fs');
const path = require('path');
const glob = require('glob');

// PostCSS dependencies/plugins
const postcss = require('postcss');
const nested = require('postcss-nested');
const syntax = require('postcss-scss');
const squeakyCleanPlugin = require('postcss-squeaky-clean/plugins/clean');
const squeakyAnalyticsPlugin = require('postcss-squeaky-clean/plugins/analytics');
const squeakyHeuristicPlugin = require('postcss-squeaky-clean/plugins/heuristic');
const squeakySpecificityPlugin = require('postcss-squeaky-clean/plugins/specificity');

// Custom require files or inlined arrays for analysis
const directories = require('./helpers/directories');
const blacklistedClasses = require('./helpers/blacklisted-classes');
const scssSheets = require('./helpers/scss-sheets');

const statsPath = require('../../tmp/stats.json');

// Data structure for the `analysis` plugin
const statsMap = {};

// Data structures for the `specificity` plugin
const specificityMap = {};
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

function logSpecificity() {
  console.log(conflictsMap, 'These are conflicting properties and their values');
  console.log(specificityMap, 'These are selectors with specificity conflicts');
}

function writeStyles(scssPath, opts = {}) {
  const {
    useAnalytics,
    useHeuristic,
    useSpecificity,
  } = opts;
  let writeFile = true;
  fs.readFile(scssPath, (err, scss) => {
    console.log(`\n\n${scssPath}`);
    let plugin;
    if (useAnalytics) {
      plugin = squeakyAnalyticsPlugin;
    } else if (useHeuristic) {
      plugin = squeakyHeuristicPlugin;
    } else if (useSpecificity) {
      plugin = squeakySpecificityPlugin;
    } else {
      writeFile = true;
      plugin = squeakyCleanPlugin;
    }

    postcss([plugin({
      conflictsMap,
      directories,
      genericDir: [
        'common/',
        'styleguide/layout',
        'reset',
        'helper',
        'styleguide/',
        'internal/',
        'backbone/',
        'stylesheets/',
        'javascripts/',
      ],
      fileExts: 'js,coffee,eco,rb,erb,ejs',
      regExps: ['svg_?[iI]con.+?,.+?[\'"]'],
      scssPath,
      scssSheets,
      specificityMap,
      specificDir: [
        'styleguide/modules/tables/header-cell',
      ],
      commonInclude: /app\/.+$/,
      filterExclude: [/\.scss/, /\.erb/],
      filterInclude: [/app\/.+backbone\//],
      getFeatureName: function (filePath) {
        let pathMatch;

        if (/\.s?css$/.test(filePath)) {
          pathMatch = filePath.match(/stylesheets\/internal\/(?:features|pages)\/([\w-]+)/) ||
            filePath.match(/stylesheets\/internal\/([\w-]+)/) || [];
        } else {
          // JS/Coffee file
          pathMatch = filePath.match(/javascripts\/(?:entries|external)\/([\w-]+)/) ||
            filePath.match(/backbone\/features\/([\w-]+)/) || [];
        }

        return pathMatch[1];
      },
      sqkdExclude: /\.erb/,
      templateLeafInclude: /\.eco$/,
      whitelistExclude: '/styleguide',
      statsPath,
      statsMap,
      ...blacklistedClasses,
    })])
      .process(scss, { syntax })
      .then((result) => {
        if (useAnalytics) {
          logAnalytics();
        } else if (useSpecificity) {
          logSpecificity();
        } else if (writeFile) {
          fs.writeFileSync(scssPath, result.content, 'utf8');
        }
      });
  });
}

function flattenStyles(scssPath) {
  fs.readFile(scssPath, (err, scss) => {
    console.log(`\n\n${scssPath}`);

    postcss([nested, squeakyFlattenPlugin({ scssPath })])
      .process(scss, { syntax })
      .then((result) => {
        fs.writeFileSync(scssPath, result.content, 'utf8');
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
  let flattenFile = false;
  let useAnalytics = false;
  let useHeuristic = false;
  let useSpecificity = false;
  const args = process.argv.slice(2);

  args.forEach((val) => {
    if (isSwitch(val)) {
      flattenFile = /flatten/.test(val);
      useHeuristic = /heuristic/.test(val);
      // Guard against regex test once an analytics flag has been detected (to support `xargs` use)
      if (/analy(tics|ze)$/.test(val)) {
        useAnalytics = true;
      } else if (/specif(y|icity)$/.test(val)) {
        useSpecificity = true;
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
    const styleMethod = flattenFile ? flattenStyles : writeStyles;
    console.log('Processing the following stylesheets:');
    console.log(stylesheets);

    stylesheets.forEach((file) => {
      const absFile = path.join(__dirname, '..', '..', file);
      styleMethod(absFile, { useAnalytics, useSpecificity, useHeuristic });
    });
  } else {
    throw new Error('Please provide a path to a directory or stylesheet to be squeaky cleaned!');
  }
}());

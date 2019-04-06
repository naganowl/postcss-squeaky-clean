const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const postcss = require('postcss');
const uniq = require('lodash.uniq');
const findSelectorFiles = require('../helpers/find-selector-files');
const getBaseSelector = require('../helpers/get-base-selector');
const runShell = require('../helpers/run-shell');

// Reference all async promises in order to run code after they complete
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readPromises = [];
const writePromises = [];

// Passed in method to change how files are written
let fileWriter;

function isECOFnCall(opts) {
  // Different interpolation syntax is needed within a function declaration
  const { isEco, quoteMatch, line } = opts;
  const [textBeforeMatch] = quoteMatch;
  if (isEco && !textBeforeMatch.includes(')')) {
    // Check that the string is some argument (only or many) to function in ECO
    return new RegExp(`<%=[\\s@\\w,(]+?.*${textBeforeMatch.replace(/\)/, '\\)')}`).test(line);
  }

  return false;
}

/* Takes a variable declaration and decorates it with the proper
/* interpolation patterns. */
function declDecorate(opts = {}) {
  const { isEco, isCoffee, decl } = opts;

  if (isEco) {
    return `<%= ${decl} %>`;
  } if (isCoffee) {
    return `#{${decl}}`;
  }

  return `$\{${decl}\}`; // eslint-disable-line no-useless-escape
}

/* Takes the contents of a file and conditionally adds the proper
/* dependency line to add the dependent stylesheet. */
function includeStyleDep(opts = {}) {
  const {
    isEco, isCoffee, newContents, stylePath, stylesVariable, lastDepIdx,
  } = opts;
  const appStylePath = (stylePath.match(/app\/assets.+/) || [])[0];
  const coffeeDep = `${stylesVariable} = require('${appStylePath}')`;
  let styledContent;

  if (isCoffee) {
    styledContent = `${coffeeDep};`;
  } else if (isEco) {
    styledContent = `<% ${coffeeDep} %>`;
  } else {
    // JS file
    styledContent = `import ${stylesVariable} from '${appStylePath}';`;
  }

  let lineIdx = lastDepIdx;
  if (lineIdx) {
    // Allow first/only dependencies of a file to be added to the top
    lineIdx += 1;
  }

  return newContents.splice(lineIdx, 0, styledContent);
}

/* Analyzes a line from a source file to determine the most recent dependency
/* line index for the file the line belongs to. */
function trackDepLines(depOpts = {}) {
  const { isCoffee, isEco } = depOpts;
  const { line: styleLine, idx: styleIdx } = depOpts;
  let depIdx;
  if (isCoffee || isEco) {
    if (/=\s+require/.test(styleLine)) {
      depIdx = styleIdx;
    }
  // JS file
  } else if (/import.*\s+(?:from\s+)?.*['"];$/.test(styleLine)) {
    // Handle variable assignment/destructuring + standalone import statements
    depIdx = styleIdx;
  }

  return depIdx;
}

function quoteSwap(oldQuote, newQuote, theLine) {
  return theLine.replace(new RegExp(oldQuote, 'g'), newQuote);
}

// Detect if there's DOM manipulation with jQuery
function isJQInterp(line) {
  const jqRE = /=\s+?\$[(\s]+?(['"`])/;

  return line.match(jqRE);
}

/* Detect if jQuery elements are being created within the line
/* and set up quotes to properly allow for interpolation. */
function handleJQInterpLine(opts = {}) {
  const { line, isCoffee, quote } = opts;
  const [, jqQuote] = isJQInterp(line) || [];
  const replaceQuote = isCoffee ? '"' : '`';

  if (jqQuote && jqQuote !== replaceQuote) {
    if (isCoffee && quote === '"') {
      // Swap quotes so that double are outermost quotes
      const tempLine = quoteSwap("'", '`', line);
      const innerLine = quoteSwap('"', "'", tempLine);
      return quoteSwap('`', '"', innerLine);
    }
    return quoteSwap(jqQuote, replaceQuote, line);
  }

  return line;
}

// Ensures the string can be interpolated
function normalizeString(opts = {}) {
  const {
    isEco, isCoffee, line, quoteMatch,
  } = opts;
  const [quotedText, quote] = quoteMatch;
  const jqInterpLine = handleJQInterpLine({ line, isCoffee, quote });

  if (isCoffee || isECOFnCall({ isEco, quoteMatch, line })) {
    // Helper method already normalizes the quotes for jQuery interpolation
    if (jqInterpLine !== line) {
      return jqInterpLine;
    // Outermost quotes need to double for interpolation
    } if (quote === "'" && !isJQInterp(line)) {
      return quoteSwap("'", '"', jqInterpLine);
    }
  // ECO can always be interpolated
  } else if (!isEco) {
    // JS file
    if (jqInterpLine !== line) {
      return jqInterpLine;
    }
    if (quote && quote !== '`') {
      const unquotedText = quotedText.replace(new RegExp(quote, 'g'), '');
      const backtickSurround = new RegExp(`\`.*${unquotedText}.*\``).test(line);
      const quoteSurround = new RegExp(`'<.*${unquotedText}.*'`).test(line);
      const dblQuoteSurround = new RegExp(`"<.*${unquotedText}.*"`).test(line);
      const spaceSurround = new RegExp(`\\s<.*${unquotedText}.*`).test(line);
      if (!backtickSurround && !quoteSurround && !dblQuoteSurround && !spaceSurround) {
        return quoteSwap(quote, '`', jqInterpLine);
      }
    }
  }

  return jqInterpLine;
}

function handleDupeSels(sqkdArr) {
  const baseToSqkd = {};

  // Remove squeaky suffixes
  const baseSel = sqkdArr.map((arrSel) => {
    const sSel = arrSel.slice(1);
    const theBase = sSel.replace(/-sqkd-\w+/, '');
    const cleanSels = baseToSqkd[theBase];

    // Track mapping to help with possible replacements later
    if (cleanSels) {
      cleanSels.push(sSel);
    } else {
      baseToSqkd[theBase] = [sSel];
    }

    return theBase;
  });

  // List of all duplicate base selectors
  const dupeSel = baseSel.reduce((memo, bSel, sIdx, sArr) => {
    if (sArr.indexOf(bSel) !== sIdx && !memo.includes(bSel)) {
      memo.push(bSel);
    }

    return memo;
  }, []);

  // List of squeaky selectors to replace in all files
  const selToReplace = dupeSel.reduce((memo, dSel) => {
    memo.push(...baseToSqkd[dSel]);
    return memo;
  }, []);

  if (selToReplace.length > 1) {
    console.log('Handling duplicate base selectors...'); // eslint-disable-line no-console
  }

  const scriptPath = path.resolve(path.join(__dirname, '..', 'scripts', 'replace_selectors.sh'));
  runShell('sh', [scriptPath, selToReplace], { stdio: [null, 'inherit', null] });
  const newSels = runShell('cat', ['tmp/newSelectors']);
  runShell('rm', ['tmp/newSelectors']);

  // Update squeaky selectors for processing within the plugin so they are properly
  // extracted from view files that use it.
  newSels.split('\n').slice(0, -1).forEach((nSel) => {
    const selParts = nSel.split('-');
    const oldBaseSel = selParts[0].match(/([A-z]+?)\d+?/)[1];
    // Replace old squeaky selector with modified dupe indexed selector
    return sqkdArr.find((el, idx, arr) => { // eslint-disable-line array-callback-return
      if (el.includes(`${oldBaseSel}-${selParts.slice(1).join('-')}`)) {
        arr[idx] = `.${nSel}`; // eslint-disable-line no-param-reassign
      }
    });
  });
}

/* Replace squeaky selectors on a line by line basis across all
/* files that have squeaky selectors */
function extractSelectors(fileName, fileSelectors, stylePath) {
  const isCoffee = /\.coffee$/.test(fileName);
  const isEco = /\.eco$/.test(fileName);
  const onlyFile = (stylePath.match(/\/([\w-_]+)\.scss/) || [])[1];

  // Account for different stylesheet being imported
  const stylesVariable = runShell('grep', ['-Rin', 'styles =', fileName])
    ? `${fileName.match(/\/([\w_-]+)\.[\w_-]+$/)[1].replace(/-/g, '_')}_styles` : 'styles';
  // Each file is independent so changes can be made asynchronously
  const rPromise = readFileAsync(fileName, 'utf8');
  readPromises.push(rPromise);
  rPromise
    .then((contents) => {
      let lastDepIdx = 0;
      let addStyleDep = true;
      const newContents = contents.split('\n').map((line, idx) => {
        // Try and keep potential stylesheet dependency as last item for grouping's sake
        lastDepIdx = trackDepLines({
          line, idx, isCoffee, isEco,
        }) || lastDepIdx;
        let changedLine = line;

        // Stylesheet path reference is agnostic amongst file types
        if (new RegExp(`/${onlyFile}\\.scss`).test(line)) {
          addStyleDep = false;
        }

        // Format dependency declaration for the proper file type
        fileSelectors.forEach((theSelector) => {
          if (changedLine.includes(theSelector)) {
            const baseSelector = getBaseSelector([theSelector])[0];
            // Address object notation lint rule
            const decl = (baseSelector.includes('-'))
              ? `${stylesVariable}['${baseSelector}']` : `${stylesVariable}.${baseSelector}`;
            const singleSelectorRE = new RegExp(`(['"\`])${theSelector}['"\`]`);
            let styleDecl = declDecorate({ isEco, isCoffee, decl });
            const interpChar = '[\\w\\s.<>%=$@()-]';
            // Heading/leading selectors optional (in case squeaky selector is used standalone)
            const quoteMatch = changedLine.match(
              new RegExp(`(['"\`])(${interpChar}+?)?${theSelector}(${interpChar}+?)?['"\`#<]`),
            ) || [];
            const interpLine = normalizeString({
              isEco, isCoffee, line: changedLine, quoteMatch,
            });
            if (singleSelectorRE.test(quoteMatch[0])) {
              // Single use selector
              changedLine = interpLine.replace(singleSelectorRE, decl);
            } else {
              const coffeeInterp = /[#<]$/.test(quoteMatch[0]) && new RegExp(`<%=.+?${theSelector}`).test(changedLine) && !new RegExp(`<%=.+?>.+?${theSelector}.+?>`).test(changedLine);
              if (coffeeInterp || isECOFnCall({ isEco, quoteMatch, line: changedLine })) {
                // ECO double interpolation
                styleDecl = declDecorate({ isCoffee: true, decl });
              }

              changedLine = interpLine.replace(theSelector, styleDecl);
            }
          }
        });

        return changedLine;
      });

      // Avoid duplicate style dependency declarations
      if (addStyleDep) {
        includeStyleDep({
          isEco, isCoffee, newContents, stylePath, stylesVariable, lastDepIdx,
        });
      }

      const writeMethod = fileWriter || writeFileAsync;
      const promise = writeMethod(fileName, newContents.join('\n'));
      writePromises.push(promise);
      promise
        .then(() => {
          console.log(`${fileName} has been written`); // eslint-disable-line no-console
        })
        .catch((writeErr) => {
          throw writeErr;
        });
    });
}

/*
  Given a flattened squeaky stylesheet, find all occurrences of selectors
  in non-Ruby view files and extract them to reference their respective
  stylesheets to follow the CSS modules paradigm
*/
module.exports = postcss.plugin('squeakyExtractPlugin', (opts = {}) => {
  const { scssPath, directories, tmpStylePath = 'tmp/test.scss' } = opts;
  ({ fileWriter } = opts);

  findSelectorFiles.init({ directories });

  return function main(css) {
    const sqkdRegExp = /\.([\w-]+sqkd[\w-]+)/g;
    let sqkdSelectors = [];
    // Maps file name strings to an array of squeaky selectors found in them
    const fileMap = {};

    // Grab all the squeaky selectors
    css.walkRules((rule) => {
      rule.selectors.reduce((memo, selector) => {
        memo.push(...selector.match(sqkdRegExp));
        return memo;
      }, sqkdSelectors);
    });

    const rbSqkdSelectors = [];
    sqkdSelectors = uniq(sqkdSelectors);

    // Handle duplicates that slipped through other phases
    handleDupeSels(sqkdSelectors);
    runShell('cp', [scssPath, tmpStylePath]);

    // Map files to the selectors that are in them so files are opened once
    sqkdSelectors.forEach((sqkdSelector) => {
      console.log(`Analyzing ${sqkdSelector}`); // eslint-disable-line no-console
      findSelectorFiles.find(sqkdSelector).forEach((sqkdFile) => {
        if (/\.e?rb$/.test(sqkdFile)) {
          rbSqkdSelectors.push(sqkdSelector);
        } else {
          const fileSels = fileMap[sqkdFile];
          // Remove leading period in class selector
          const selStr = sqkdSelector.slice(1);
          if (fileSels) {
            fileMap[sqkdFile].push(selStr);
          } else {
            fileMap[sqkdFile] = [selStr];
          }
        }
      });
    });

    Object.keys(fileMap).forEach((theFile) => {
      console.log(`Opening ${theFile} for selector replacement`); // eslint-disable-line no-console
      extractSelectors(theFile, fileMap[theFile], scssPath);
    });

    return Promise.all(readPromises).then(() => {
      Promise.all(writePromises).then(() => {
        if (rbSqkdSelectors.length) {
          console.log('\x1b[31m%s\x1b[0m', // eslint-disable-line no-console
            'The following selectors are in ERB or Ruby files so should be removed/globalized:\n',
            '\x1b[37m\x1b[0m',
            uniq(rbSqkdSelectors));
        }

        // Temp file to workaround plugin from removing changes to the stylesheet at the end
        const replaceCmd = `sed -i "" "s/-sqkd-[a-z0-9]*//g" ${tmpStylePath}`;
        runShell('sh', ['-c', replaceCmd]);
        runShell('mv', [tmpStylePath, scssPath]);
      });
    });
  };
});

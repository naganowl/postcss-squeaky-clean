const fs = require('fs');
const md5 = require('md5');

const postcss = require('postcss');
const runShell = require('../helpers/run-shell');
const directories = require('../helpers/directories');
const blacklistedClass = require('../helpers/blacklisted-class');
const isIgnoredSelector = require('../helpers/is-ignored-selector');

function hasCommentException(cssRule) {
  return cssRule.nodes && cssRule.nodes.findIndex((n) => {
    return n.type === 'comment' && n.text.includes('squeaky-skip');
  }) !== -1;
}

function logIgnoredSelector(selector, lineNum) {
  console.log(`Ignored selector ${selector} detected on L${lineNum}`);
}

function addSelectorHash(opts, selector) {
  const { rule, css, theSelectors } = opts;
  const hasBlacklistedClass = blacklistedClass.find(selector);
  const hasException = hasCommentException(rule);
  if (isIgnoredSelector(selector) || selector.includes('-sqkd-') || hasBlacklistedClass || hasException) {
    const lineNumber = rule.source.start.line;
    if (hasException) {
      logIgnoredSelector(`${selector}, EXCEPTION`, lineNumber);
    }
    if (hasBlacklistedClass) {
      logIgnoredSelector(hasBlacklistedClass, lineNumber);
    }
    if (selector.includes('#{')) {
      logIgnoredSelector(selector, lineNumber);
    }
    return selector;
  }
  return selector.replace(/(\.([\w_-]+))/g, (match) => {
    const hash = md5(css).slice(0, 6);
    theSelectors.push({
      hash,
      onlyClass: match.split('.').pop(),
    });
    return `${match}-sqkd-${hash}`;
  });
}

// Walks the CSS looking for selectors that are not blacklisted,
// already sqk'd, actually a .klass, etc., and makes those selectors
// squeaky cleansed e.g. .foo-sqkd-HASH
function cleanCSSFile(css, theSelectors) {
  css.walkRules((rule) => {
    rule.walkDecls((rDecl) => {
      // Find SCSS variables that are class selectors
      if (/^\$.+[ckCK]lass_?[nN]ame$/.test(rDecl.prop)) {
        const selectorVal = rDecl.value.match(/['"](.+)['"]/)[1];
        // eslint-disable-next-line no-param-reassign
        rDecl.value = `"${addSelectorHash({ rule, css, theSelectors }, selectorVal)}"`;
      }
    });

    // eslint-disable-next-line no-param-reassign
    rule.selectors = rule.selectors.map(addSelectorHash.bind(null, { rule, css, theSelectors }));
  });
}

function findFilesWithClass(onlyClass) {
  const cmd = runShell('grep', ['-Rl', onlyClass].concat(directories));
  // `spawnSync` doesn't handle command flags (such as `--include`)
  let files = cmd.match(/.+(\.(coffee|eco|e?rb|jsx|e?js|scss))/g) || [];
  files = files.filter((fileName) => {
    return fileName.indexOf('styleguide') === -1;
  });
  return files;
}

// Takes cat'd contents of file and attemps to do replacements against regex matches.
// If anything's changed as a result, writes file w/the replaced contents.
function replaceContents(contents, onlyClass, hash, file) {
  // Note the prefix must be the parenthesized capture group 1 (e.g. 'composes: '), and
  // actualClasses the parenthesized capture group 2. (e.g. myclass-foo myclass-bar)
  const replacer = (classDeclaration, prefix, actualClasses, possibleSuffix) => {
    let suffix = possibleSuffix;
    // Last two arguments to `replace` function is `offset` and `string`.
    if (typeof suffix !== 'string') {
      suffix = '';
    }

    if (actualClasses.includes(`${onlyClass}-sqkd-${hash}`) || actualClasses.includes('\n')) {
      return prefix + actualClasses + suffix;
    }
    const newClasses = actualClasses.split(' ').map((theClass) => {
      if (theClass === onlyClass) {
        return `${theClass} ${theClass}-sqkd-${hash}`;
      }
      return theClass;
    }).join(' ');

    return prefix + newClasses + suffix;
  };

  const dynamicClassReplacer = (classFnBody) => {
    if (classFnBody.includes(`${onlyClass}-sqkd-${hash}`)) {
      return classFnBody;
    }

    return classFnBody.split('\n').map((fnLine) => {
      return fnLine.replace(new RegExp('(.+?[\'"])(.+?)([\'"])', 'g'), replacer);
    }).join('\n');
  };

  const ternaryReplacer = (fullLine, prefix, ternary, suffix) => {
    if (ternary.includes(`${onlyClass}-sqkd-${hash}`)) {
      return prefix + ternary + suffix;
    }

    return prefix + ternary.split(':').map((clause) => {
      return clause.replace(new RegExp('(.+?[\'"])(.+?)([\'"])', 'g'), replacer);
    }).join(':') + suffix;
  };

  const interpolationReplacer = (fullLine, prefix, interpolation, suffix) => {
    if (interpolation.includes(`${onlyClass}-sqkd-${hash}`)) {
      return prefix + interpolation + suffix;
    }
    return prefix + interpolation.replace(new RegExp('(.*?[\'"])(.+?)([\'"])', 'g'), replacer) + suffix;
  };

  const classSelectorCharacters = '[\\w\\s_-]';
  let replacedContents;
  // Only look for composition in scss, otherwise run the suite of regex replacers
  if (/\.scss$/.test(file)) {
    replacedContents = contents.replace(new RegExp(`(composes:\\s+)(${classSelectorCharacters}+)(?=from)`, 'g'), replacer);
  } else {
    replacedContents = contents.replace(new RegExp(`([cCk]lass(?:Names?|es)?[:=][^(:]+?)(\\w${classSelectorCharacters}+)`, 'g'), replacer);
    replacedContents = replacedContents.replace(new RegExp(`((?:(?:add|remove|toggle)Class(?:SVG)?)(?:\\s|\\()['"])(${classSelectorCharacters}+)`, 'g'), replacer);
    replacedContents = replacedContents.replace(new RegExp(`(svg_?[iI]con.+?,.+?['"])(\\w${classSelectorCharacters}+)`, 'g'), replacer);
    replacedContents = replacedContents.replace(new RegExp(`([cCk]lass(?:es)?.+?=>.+?)(\\w${classSelectorCharacters}*)`, 'g'), replacer);
    replacedContents = replacedContents.replace(new RegExp(`(class=['"]${classSelectorCharacters}+?<%=.+?['"])(\\w${classSelectorCharacters}+)(['"]\\s+(?:if|unless))`, 'g'), replacer);
    replacedContents = replacedContents.replace(new RegExp('(\\sclassName:\\s+->[\\n\\r]+)(.+[\\n\\r])+', 'g'), dynamicClassReplacer);
    replacedContents = replacedContents.replace(new RegExp(`([cC]lass(?:Names?)?\\s+?=.+?['"])(\\w${classSelectorCharacters}+?)(['"])`, 'g'), replacer);
  }

  if (/\.e?rb$/.test(file)) {
    replacedContents = replacedContents.replace(new RegExp('(:?class.*?=>?.+?<%=.+?\\s+?\\?)(.+?)(%>)', 'g'), ternaryReplacer);
    replacedContents = replacedContents.replace(new RegExp('(:?class.*?=>?.+?#{)(.+?)(})', 'g'), interpolationReplacer);
  }
  if (contents !== replacedContents) {
    fs.writeFileSync(file, replacedContents, 'utf8');
  }
}

// Takes the selectors list we've built and, for each:
// - finds files that have the class
// - replaces those selectors cleansed squeaky ones
function cleanSelectorsAcrossFiles(theSelectors) {
  theSelectors.forEach((fullSelector) => {
    const { onlyClass, hash } = fullSelector;
    console.log(onlyClass);

    const files = findFilesWithClass(onlyClass);
    files.forEach((file) => {
      const contents = runShell('cat', [file]);
      replaceContents(contents, onlyClass, hash, file);
    });
  });
}

module.exports = postcss.plugin('squeakyCleanPlugin', (options = {}) => {
  blacklistedClass.init({
    BLACKLIST_CLASSES: options.BLACKLIST_CLASSES,
    BLACKLIST_PREFIXES: options.BLACKLIST_PREFIXES,
  });

  return function (css) {
    const theSelectors = [];
    cleanCSSFile(css, theSelectors);
    cleanSelectorsAcrossFiles(theSelectors);
  };
});

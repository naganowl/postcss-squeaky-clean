const test = require('ava');
const postcss = require('postcss');
const plugin = require('../plugins/clean');

const pluginOpts = {
  BLACKLIST_CLASSES: ['.foo'],
  BLACKLIST_PREFIXES: ['.ui'],
  directories: [],
  fileExts: 'js,coffee,eco,rb,erb,ejs',
};

// Function helper to make our tests cleaner
// This runs our plugin
function run(t, input, callback, opts = pluginOpts) {
  return postcss([ plugin(opts) ]).process(input)
    .then(callback);
}

function extractSelector(cssBlock) {
  return cssBlock.match(/\.[\w-]+/)[0];
}

test('adds namespace to class selector', t => {
  const styles = '.a-class-selector { color: fuchsia }';
  return run(t, styles, (result) => {
    const sqkdSelector = extractSelector(result.css);
    t.regex(sqkdSelector, new RegExp(`${extractSelector(styles)}-sqkd-\\w+`));
  });
});

test('skips blacklisted classes', t => {
  const styles = '.foo { color: fuchsia }';
  return run(t, styles, (result) => {
    t.is(result.css, styles);
  });
});

test('skips blacklisted prefixes', t => {
  const styles = '.ui-button { color: fuchsia }';
  return run(t, styles, (result) => {
    t.is(result.css, styles);
  });
});

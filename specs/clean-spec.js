const mock = require('mock-fs');
const mockSpawn = require('mock-spawn');
const fs = require('fs');

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
function run(input, callback, opts = pluginOpts) {
  return postcss([plugin(opts)]).process(input)
    .then(callback);
}

function extractSelector(cssBlock) {
  return cssBlock.match(/\.[\w-]+/)[0];
}

function additionalSqkdSelector(fileStr) {
  // See https://stackoverflow.com/a/2823037 for more info
  return /\b(\w+-[\w-]+)\s+\1-sqkd-\w+\b/.test(fileStr);
}

beforeEach(() => {
  mock();
  mockSpawn();

  // eslint-disable-next-line global-require
  require('child_process').spawnSync = function ssMock(shellCmd) {
    const stdout = shellCmd === 'grep' ? ['dummy.js'] : '$el.addClass("a-class-selector")';
    return {
      stderr: '',
      stdout,
    };
  };
});

afterEach(() => {
  mock.restore();
});

describe('Squeaky clean plugin', () => {
  it('adds namespace to class selector', () => {
    const styles = '.a-class-selector { color: fuchsia }';
    return run(styles, (result) => {
      const sqkdSelector = extractSelector(result.css);
      const sqkdRE = new RegExp(`${extractSelector(styles)}-sqkd-\\w+`);
      expect(sqkdSelector).toMatch(sqkdRE);
      const fileContent = fs.readFileSync('dummy.js').toString();
      expect(fileContent).toMatch(sqkdRE);
      expect(additionalSqkdSelector(fileContent)).toBeTruthy();
    });
  });

  it('skips blacklisted classes', () => {
    const styles = '.foo { color: fuchsia }';
    return run(styles, (result) => {
      expect(result.css).toEqual(styles);
    });
  });

  it('skips blacklisted prefixes', () => {
    const styles = '.ui-button { color: fuchsia }';
    return run(styles, (result) => {
      expect(result.css).toEqual(styles);
    });
  });
});

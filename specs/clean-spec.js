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
const styles = '.a-class-selector { color: fuchsia }';

// Function helper to make our tests cleaner
// This runs our plugin and needs to be explicitly returned since it's a promise
function run(input, callback, opts = pluginOpts) {
  return postcss([plugin(opts)]).process(input)
    .then(callback);
}

function extractSelector(cssBlock) {
  return cssBlock.match(/\.[\w-]+/)[0];
}

// Check the specific `selStr` selector has been namespaced in `fileStr`
function additionalSqkdSelector(fileStr, selStr) {
  return new RegExp(`${selStr}\\s+${selStr}-sqkd-\\w+`).test(fileStr);
}

function checkContents() {
  it('adds a namespace to class selector', function () {
    return run(styles, (result) => {
      const baseSelector = extractSelector(styles).slice(1);
      const sqkdSelector = extractSelector(result.css);
      const sqkdRE = new RegExp(`${extractSelector(styles)}-sqkd-\\w+`);
      const fileContent = fs.readFileSync(this.viewFiles[0]).toString();

      expect(sqkdSelector).toMatch(sqkdRE); // the selector has been namespaced in stylesheet
      expect(fileContent).toMatch(sqkdRE); // the selector has been namespaced in view file
      // Check that there is at least one selector string that has been namespaced
      expect(fileContent).toMatch(/\b(\w+-[\w-]+)\s+\1-sqkd-\w+\b/);
      // view file contains both base selector and namespaced one
      expect(additionalSqkdSelector(fileContent, baseSelector)).toBeTruthy();
    });
  });
}

describe('Squeaky clean plugin', () => {
  beforeAll(function () {
    this.viewFiles = this.viewFiles || ['dummy.js'];
    this.fileContent = this.fileContent || '$el.addClass("a-class-selector")';
  });

  beforeEach(function () {
    mock();
    mockSpawn();

    // eslint-disable-next-line global-require
    require('child_process').spawnSync = (shellCmd) => {
      const stdout = shellCmd === 'grep' ? this.viewFiles : this.fileContent;
      return {
        stderr: '',
        stdout,
      };
    };
  });

  afterEach(() => {
    mock.restore();
  });

  checkContents();

  it('skips blacklisted classes', () => {
    const safeStyles = '.foo { color: fuchsia }';
    return run(safeStyles, (result) => {
      expect(result.css).toEqual(safeStyles);
    });
  });

  it('skips blacklisted prefixes', () => {
    const safeStyles = '.ui-button { color: fuchsia }';
    return run(safeStyles, (result) => {
      expect(result.css).toEqual(safeStyles);
    });
  });

  it('checks the proper directories', () => {
    let theDirectory;
    // eslint-disable-next-line global-require
    require('child_process').spawnSync = (shellCmd, cmdArgs) => {
      if (shellCmd === 'grep') {
        theDirectory = cmdArgs;
      }

      return {
        stderr: '',
        stdout: '',
      };
    };

    return run(styles, () => {
      expect(theDirectory[2]).toEqual('stylesheets');
    }, Object.assign({}, pluginOpts, { directories: ['stylesheets'] }));
  });

  describe('with a non-specified view file extension', () => {
    beforeAll(function () {
      this.viewFiles = ['dummy.ts'];
    });

    it('leaves the file alone', function () {
      return run(styles, () => {
        // File is written/modified only if it's been processed by the plugin.
        expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
      });
    });
  });

  describe('with a template view file', () => {
    beforeAll(function () {
      this.fileContent = '<div class="a-class-selector">';
    });

    checkContents();
  });
});

const mock = require('mock-fs');
const path = require('path');

const postcss = require('postcss');
const clonedeep = require('lodash.clonedeep');
const uniq = require('lodash.uniq');
const plugin = require('../plugins/heuristic');
const statsObj = require('../helpers/stats.json');

const pluginOpts = {
  commonInclude: /app\/.+$/,
  directories: [
    'app/assets',
    'app/views',
  ],
  filterExclude: [/\.scss/],
  filterInclude: [/app\/.+backbone\//],
  getFeatureName: feat => feat,
  scssPath: 'app/assets/stylesheets/table.scss',
  statsPath: './stats.json',
  templateLeafInclude: /\.eco$/,
};

const basicNestedStyles = `
  .foo-sqkd-deadbeef {
    color: fuchsia;

    a {
      border: 0;

      .bar-sqkd-fadedbabe {
        padding: 1px;
      }
    }
  }
`;

// Function helper to make our tests cleaner
// This runs our plugin and needs to be explicitly returned since it's a promise
function run(input, callback, opts = pluginOpts) {
  return postcss([plugin(opts)]).process(input)
    .then(callback);
}

// Helper method to pull out the selectors that are traversed
function analyzeSelectors(theStyles, callback) {
  return run(theStyles, () => {
    /* eslint-disable arrow-body-style, no-console */
    const leafSqkdSels = console.log.calls.allArgs().filter((logged) => {
      return logged.filter((entries) => {
        return typeof entries === 'string' && entries.includes('Removing');
      }).length;
    }).map((remSq) => {
      return remSq[0].match(/\.([\w-]+$)/)[1];
    });
    const ancestorSqkdSels = console.log.calls.allArgs().filter((logged) => {
      return logged.filter((entries) => {
        return typeof entries === 'object';
      }).length;
    }).reduce((memo, ancSel) => {
      return memo.concat(ancSel[0]);
    }, []);
    /* eslint-enable arrow-body-style, no-console */

    callback(leafSqkdSels, ancestorSqkdSels);
  });
}

// Detect if any sort of traversal up the file/module hierarchy occurred
function dependencyCheck(filterCB, expectCB, runOpts) {
  return run(basicNestedStyles, () => {
    // eslint-disable-next-line no-console
    const depLog = console.log.calls.allArgs().filter(logged => logged.filter(filterCB).length);
    expectCB(depLog);
  }, runOpts);
}

// Helper method to assert ancestral traversal is ignored
function ignoreFiles() {
  return dependencyCheck(entries => typeof entries === 'string' && entries.includes('Finding dependencies of:'),
    (depLog) => {
      const analyzedFiles = depLog.map((deps) => {
        const [depFile] = deps;
        return (depFile.match(/(\/\w+)+/) || ['dummy'])[0];
      });
      expect(uniq(analyzedFiles).length).toEqual(1);
    }, pluginOpts);
}

describe('Squeaky heuristic plugin', () => {
  beforeAll(function () {
    this.viewFiles = this.viewFiles || ['dummy.js'];
    this.fileName = this.fileName || 'app/assets/features/backbone/lightbox.coffee';
  });

  afterAll(function () {
    delete this.viewFiles;
    delete this.fileName;
  });

  beforeEach(function () {
    this.shellCalls = [];
    mock({
      'stats.json': JSON.stringify(statsObj),
    });

    /* eslint-disable global-require */
    this.spawnSync = require('child_process').spawnSync;
    require('child_process').spawnSync = (shellCmd, ...args) => {
      this.shellCalls.push([shellCmd, ...args]);
      const [, actualCmd = ''] = args[0];
      /* eslint-enable global-require */
      let stdout = shellCmd === 'grep' ? this.viewFiles : this.fileName;
      if (shellCmd === 'sh') {
        const subCmd = actualCmd.split(' ').shift();
        switch (subCmd) {
          case 'echo':
            stdout = this.findSelFiles || ['row.js', 'cell.js'].join('\n');
            break;
          case 'grep':
            stdout = this.getSqkdFiles || ['table.js', 'index.js', 'row.js', 'header.js', 'main.js'].join('\n');
            break;
          default:
            break;
        }
      }
      return {
        stderr: '',
        stdout,
      };
    };

    spyOn(console, 'log').and.callThrough();
  });

  afterEach(() => {
    // eslint-disable-next-line global-require
    require('child_process').spawnSync = this.spawnSync;
    mock.restore();
  });

  it('can detect ancestor-leaf relations', () => analyzeSelectors(basicNestedStyles, (remSqkdSels) => {
    expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
    expect(remSqkdSels).toContain('foo-sqkd-deadbeef');
  }));

  it('can detect top level selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels, ancSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('foo-sqkd-deadbeef');
      expect(ancSqkdSels.length).toEqual(0);
    });
  });

  it('can detect chained leaf selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        a {
          border: 0;

          .bar-sqkd-fadedbabe.baz-sqkd-beeffade {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('baz-sqkd-beeffade');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('baz-sqkd-beeffade'));
    });
  });

  it('can detect multiple selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef, .quux-sqkd-deafbeef {
        color: fuchsia;

        a {
          border: 0;

          .bar-sqkd-fadedbabe, .baz-sqkd-beeffade {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels, ancSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('baz-sqkd-beeffade');
      expect(ancSqkdSels).toContain('.foo-sqkd-deadbeef');
      expect(ancSqkdSels).toContain('.quux-sqkd-deafbeef');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('baz-sqkd-beeffade'));
      expect(remSqkdSels.indexOf('quux-sqkd-deafbeef')).toBeGreaterThan(remSqkdSels.indexOf('baz-sqkd-beeffade'));
    });
  });

  it('ignores pseudo-element selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        a {
          border: 0;

          .bar-sqkd-fadedbabe:not(.baz-sqkd-beeffade) {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels) => {
      expect(remSqkdSels).not.toContain('baz-sqkd-beeffade');
    });
  });

  it('can detect ancestral tag selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        a.baz-sqkd-beeffade {
          border: 0;

          img.bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels, ancSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(ancSqkdSels).toContain('.baz-sqkd-beeffade');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('baz-sqkd-beeffade'));
    });
  });

  it('can handle sibling combinators in leaf selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        a {
          border: 0;

          .bar-sqkd-fadedbabe ~ .baz-sqkd-beeffade {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('baz-sqkd-beeffade');
      expect(remSqkdSels).toContain('foo-sqkd-deadbeef');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('baz-sqkd-beeffade'));
    });
  });

  it('can handle parent combinators in leaf selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        .quux-sqkd-deafbeef {
          border: 0;

          &.bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels, ancSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('quux-sqkd-deafbeef');
      expect(remSqkdSels).toContain('foo-sqkd-deadbeef');
      expect(ancSqkdSels).not.toContain('.quux-sqkd-deafbeef');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('quux-sqkd-deafbeef'));
    });
  });

  it('can handle dangling parent combinators in leaf selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        .quux-sqkd-deafbeef {
          border: 0;

          & ~ .bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels, ancSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('quux-sqkd-deafbeef');
      expect(remSqkdSels).toContain('foo-sqkd-deadbeef');
      expect(ancSqkdSels).not.toContain('.quux-sqkd-deafbeef');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('quux-sqkd-deafbeef'));
    });
  });

  it('can handle dangling parent combinators with pseudo-selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        .quux-sqkd-deafbeef {
          border: 0;

          &:hover ~ .bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      }
    `;
    return analyzeSelectors(nestedStyles, (remSqkdSels, ancSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('quux-sqkd-deafbeef');
      expect(remSqkdSels).toContain('foo-sqkd-deadbeef');
      expect(ancSqkdSels).not.toContain('.quux-sqkd-deafbeef');
      expect(remSqkdSels.indexOf('foo-sqkd-deadbeef')).toBeGreaterThan(remSqkdSels.indexOf('quux-sqkd-deafbeef'));
    });
  });

  it('uses an absolute path to the replace script', function () {
    return run(basicNestedStyles, () => {
      const scriptPath = this.shellCalls.slice(-1)[0][1][0];
      expect(path.isAbsolute(scriptPath)).toBeTruthy();
    });
  });

  it('passes the stylesheet directory to the replace script', function () {
    const runOpts = Object.assign({}, pluginOpts, {
      whitelistExclude: '/stylesheets',
    });
    return run(basicNestedStyles, () => {
      const ssOpt = this.shellCalls.slice(-1)[0][1][3];
      expect(ssOpt).toEqual('/stylesheets');
    }, runOpts);
  });

  describe('with view files containing namespaced selectors', () => {
    beforeAll(function () {
      this.findSelFiles = ['body.js', 'footer.js'].join('\n');
    });

    afterAll(function () {
      delete this.findSelFiles;
    });

    it('checks them for their dependencies', () => dependencyCheck(entries => typeof entries === 'string' && entries.includes('Finding dependencies of:')
        && (entries.includes('body.js') || entries.includes('footer.js')),
    (depLog) => {
      expect(depLog.filter(log => log[0].includes('body.js')).length).toBeGreaterThan(0);
      expect(depLog.filter(log => log[0].includes('footer.js')).length).toBeGreaterThan(0);
    }, pluginOpts));
  });

  describe('with excluded view files containing namespaced selectors', () => {
    beforeAll(function () {
      this.findSelFiles = ['body.js', 'main.erb', 'footer.js'].join('\n');
      this.runOpts = Object.assign({}, pluginOpts, {
        sqkdExclude: /\.erb/,
      });
    });

    afterAll(function () {
      delete this.runOpts;
      delete this.findSelFiles;
    });

    it('checks them for their dependencies', function () {
      return dependencyCheck(entries => typeof entries === 'string' && entries.includes('Finding dependencies of:')
        && entries.includes('main.erb'),
      (depLog) => {
        expect(depLog.length).toEqual(0);
      }, this.runOpts);
    });
  });

  describe('with a common chunked view file containing the namespaced selector', () => {
    beforeAll(function () {
      this.fileName = './app/assets/javascripts/backbone/child.js';
      this.findSelFiles = this.fileName;
    });

    afterAll(function () {
      delete this.fileName;
      delete this.findSelFiles;
    });

    it('traverses parent file of filter arguments', () => dependencyCheck(entries => typeof entries === 'string' && entries.includes('Finding dependencies of:') && entries.includes('parent.js'),
      (depLog) => {
        expect(depLog.length).toBeGreaterThan(0);
      }, pluginOpts));
  });

  describe('with a common chunked excluded file containing the namespaced selector', () => {
    beforeAll(function () {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: [/frontend/],
        filterExclude: [/\.js/],
      });
      this.fileName = './frontend/features/apply-template/selectors/index.scss';
    });

    afterAll(function () {
      delete this.fileName;
      delete this.pluginOpts;
    });

    it('ignores any other file', () => ignoreFiles());
  });

  describe('with only common chunked included files containing the namespaced selector', () => {
    beforeAll(function () {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: [/backend/],
        filterExclude: undefined,
      });
    });

    afterAll(function () {
      delete this.pluginOpts;
    });

    it('ignores any other file without a match', () => ignoreFiles());
  });

  describe('without an include or exclude', () => {
    beforeAll(function () {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: undefined,
        filterExclude: undefined,
      });
    });

    afterAll(function () {
      delete this.pluginOpts;
    });

    it('ignores all other files', () => ignoreFiles());
  });

  describe('with a common include', () => {
    beforeAll(function () {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: [/frontend/],
        commonInclude: /index\.js/,
      });
    });

    afterAll(function () {
      delete this.pluginOpts;
    });

    it('removes matched path from ancestor', function () {
      return run(basicNestedStyles, () => {
        const lastReplace = this.shellCalls.slice(-1)[0][1];
        expect(lastReplace[0]).toContain('replace_selectors');
        expect(lastReplace[1]).toEqual('.foo-sqkd-deadbeef');
        expect(lastReplace[2]).not.toContain('index.js');
      }, this.pluginOpts);
    });
  });

  describe('with passed in directories', () => {
    beforeEach(() => postcss([plugin(pluginOpts)]).process(basicNestedStyles));

    it('checks inside them for namespaced files', function () {
      const grepCalls = this.shellCalls.filter(shellCall => shellCall[1][1].includes('grep'));
      const grepSqkd = grepCalls.slice(-1)[0][1][1];
      pluginOpts.directories.forEach((dir) => {
        expect(grepSqkd).toContain(dir);
      });
    });
  });

  describe('without a webpack JSON file', () => {
    beforeEach(() => {
      const runOpts = Object.assign({}, pluginOpts, { statsPath: '' });
      postcss([plugin(runOpts)]).process('input');
    });

    it('throws an error', () => {
      /* eslint-disable no-console */
      expect(console.log).toHaveBeenCalled();
      expect(console.log.calls.mostRecent().args.filter(logged => logged.includes('webpack --json')).length).toEqual(1);
      /* eslint-enable no-console */
    });
  });

  describe('with an unreferenced leaf template file', () => {
    beforeAll(function () {
      this.fileName = './app/assets/javascripts/backbone/child.eco';
      this.findSelFiles = this.fileName;
    });

    afterAll(function () {
      delete this.fileName;
      delete this.findSelFiles;
    });

    it('alerts to be removed', function () {
      return postcss([plugin(pluginOpts)]).process(basicNestedStyles)
        .then(() => {
          // Should fail rather than go into this case
          expect(true).toBeFalsy();
        }, (e) => {
          const { message } = e;
          expect(message).toContain('Dead file!');
          expect(message).toContain(this.fileName);
        });
    });
  });

  describe('with a referenced leaf template file', () => {
    beforeAll(function () {
      this.fileName = './app/assets/javascripts/backbone/row.eco';
      this.findSelFiles = this.fileName;
    });

    beforeEach(function () {
      const statsPath = clonedeep(statsObj);
      statsPath.children[1].modules = [{
        id: 1,
        name: './app/assets/javascripts/backbone/row.eco',
        index: 122,
        issuerId: 607,
        issuerName: './app/assets/javascripts/backbone/row.js',
      }];
      this.runOpts = Object.assign({}, pluginOpts, {
        statsPath,
      });
    });

    afterAll(function () {
      delete this.fileName;
      delete this.findSelFiles;
    });

    it('traverses the parent file', function () {
      return dependencyCheck(entries => typeof entries === 'string' && entries.includes('Found parent file') && entries.includes('row.js'),
        (depLog) => {
          expect(depLog.length).toBeGreaterThan(0);
        }, this.runOpts);
    });
  });

  describe('with namespaced files matching the stylesheet name', () => {
    beforeAll(function () {
      this.getSqkdFiles = ['main.js', 'index.js', 'header.js', 'item.js'].join('\n');
      this.pluginOpts = Object.assign({}, pluginOpts, {
        getFeatureName: featName => featName.split('.').shift(),
        scssPath: 'header.scss',
      });
    });

    afterAll(function () {
      delete this.getSqkdFiles;
      delete this.pluginOpts;
    });

    it('removes those matching files from the whitelist while keeping the rest', function () {
      return run(basicNestedStyles, () => {
        const lastReplace = this.shellCalls.slice(-1)[0][1];
        const [shellScript, selector, files] = lastReplace;
        expect(shellScript).toContain('replace_selectors');
        expect(selector).toEqual('.foo-sqkd-deadbeef');
        expect(files).not.toContain('header.js');
        expect(files).toContain('index.js');
        expect(files).toContain('main.js');
        expect(files).toContain('item.js');
        expect(files.length).toEqual(3);
      }, this.pluginOpts);
    });
  });
});

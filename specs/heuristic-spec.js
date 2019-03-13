const mock = require('mock-fs');

const postcss = require('postcss');
const uniq = require('lodash.uniq');
const plugin = require('../plugins/heuristic');

const pluginOpts = {
  directories: [
    'app/assets',
    'app/views',
  ],
  filterInclude: [/app\/.+backbone\//],
  filterExclude: [/\.scss/],
  scssPath: 'stylesheets/internal/table.scss',
  statsPath: './stats.json',
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

describe('Squeaky heuristic plugin', () => {
  beforeAll(function () {
    this.viewFiles = this.viewFiles || ['dummy.js'];
    this.fileName = this.fileName || 'app/assets/features/backbone/lightbox.coffee';
  });

  beforeEach(function () {
    this.shellCalls = [];
    mock({
      // eslint-disable-next-line global-require
      'stats.json': JSON.stringify(require('../helpers/stats.json')),
    });

    /* eslint-disable global-require */
    this.spawnSync = require('child_process').spawnSync;
    require('child_process').spawnSync = (shellCmd, ...args) => {
      this.shellCalls.push([shellCmd, ...args]);
      const [flag, actualCmd = ''] = args[0];
      /* eslint-enable global-require */
      let stdout = shellCmd === 'grep' ? this.viewFiles : this.fileName;
      if (shellCmd === 'sh') {
        const subCmd = actualCmd.split(' ').shift();
        switch (subCmd) {
          case 'echo':
            stdout = this.findSelFiles || ['row.js', 'cell.js'].join('\n');
            break;
          case 'grep':
            stdout = this.getSqkdFiles || ['table.js','index.js', 'row.js', 'header.js', 'main.js'].join('\n');
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

  it('can detect ancestor-leaf relations', () => {
    return analyzeSelectors(basicNestedStyles, (remSqkdSels) => {
      expect(remSqkdSels[0]).toEqual('bar-sqkd-fadedbabe');
      expect(remSqkdSels).toContain('foo-sqkd-deadbeef');
    });
  });

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

  describe('with a common chunked view file containing the namespaced selector', () => {
    beforeAll(function() {
      this.fileName = './app/assets/javascripts/backbone/child.js';
    });

    afterAll(function() {
      delete this.fileName;
    });

    it('traverses parent file of filter arguments', () => {
      return run(basicNestedStyles, () => {
        const depLog = console.log.calls.allArgs().filter((logged) => {
          return logged.filter((entries) => {
            return typeof entries === 'string' && entries.includes('Finding dependencies of:') && entries.includes('parent.js');
          }).length;
        });
        expect(depLog.length).toBeGreaterThan(0);
      });
    });
  });

  describe('with a common chunked excluded file containing the namespaced selector', () => {
    beforeAll(function() {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: [/frontend/],
        filterExclude: [/\.js/],
      });
      this.fileName = './frontend/features/apply-template/selectors/index.scss';
    });

    afterAll(function() {
      delete this.fileName;
      delete this.pluginOpts;
    });

    it('ignores any other file', function() {
      return run(basicNestedStyles, () => {
        const depLog = console.log.calls.allArgs().filter((logged) => {
          return logged.filter((entries) => {
            return typeof entries === 'string' && entries.includes('Finding dependencies of:');
          }).length;
        });
        const analyzedFiles = depLog.map((deps) => {
          const [depFile] = deps;
          return (depFile.match(/(\/\w+)+/) || ['dummy'])[0]
        });
        expect(uniq(analyzedFiles).length).toEqual(1);
      }, this.pluginOpts);
    });
  });

  describe('with only common chunked included files containing the namespaced selector', () => {
    beforeAll(function() {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: [/backend/],
        filterExclude: undefined,
      });
    });

    afterAll(function() {
      delete this.pluginOpts;
    });

    it('ignores any other file without a match', function() {
      return run(basicNestedStyles, () => {
        const depLog = console.log.calls.allArgs().filter((logged) => {
          return logged.filter((entries) => {
            return typeof entries === 'string' && entries.includes('Finding dependencies of:');
          }).length;
        });
        const analyzedFiles = depLog.map((deps) => {
          const [depFile] = deps;
          return (depFile.match(/(\/\w+)+/) || ['dummy'])[0]
        });
        expect(uniq(analyzedFiles).length).toEqual(1);
      }, this.pluginOpts);
    });
  });

  describe('without an include or exclude', () => {
    beforeAll(function() {
      this.pluginOpts = Object.assign({}, pluginOpts, {
        filterInclude: undefined,
        filterExclude: undefined,
      });
    });

    afterAll(function() {
      delete this.pluginOpts;
    });

    it('ignores all other files', function() {
      return run(basicNestedStyles, () => {
        const depLog = console.log.calls.allArgs().filter((logged) => {
          return logged.filter((entries) => {
            return typeof entries === 'string' && entries.includes('Finding dependencies of:');
          }).length;
        });
        const analyzedFiles = depLog.map((deps) => {
          const [depFile] = deps;
          return (depFile.match(/(\/\w+)+/) || ['dummy'])[0]
        });
        expect(uniq(analyzedFiles).length).toEqual(1);
      }, this.pluginOpts);
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
      expect(console.log.calls.mostRecent().args.filter(logged => logged.includes('webpack --json'))).toBeTruthy();
      /* eslint-enable no-console */
    });
  });
});

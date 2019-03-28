const mock = require('mock-fs');
const mockSpawn = require('mock-spawn');
const fs = require('fs');
const path = require('path');

const postcss = require('postcss');
const plugin = require('../plugins/extract');

const pluginOpts = {
  directories: [
    'app/assets',
    'app/views',
  ],
  scssPath: 'app/assets/stylesheets/table.scss',
};
const styles = '.bar-sqkd-fadedbabe { color: fuchsia }';

// Mock to workaround `mock-fs` failing to write files asynchronously
function fakePromise(cb) {
  return function (...args) {
    cb.apply(fs, args, () => {});
    return Promise.resolve(1);
  };
}

// Function helper to make our tests cleaner
// This runs our plugin and needs to be explicitly returned since it's a promise
function run(input, callback, opts = pluginOpts) {
  opts.fileWriter = fakePromise(fs.writeFileSync); // eslint-disable-line no-param-reassign
  return postcss([plugin(opts)]).process(input)
    .then(callback);
}

describe('Squeaky extract plugin', () => {
  beforeAll(function () {
    this.viewFiles = this.viewFiles || ['view.js'];
    this.fileContent = this.fileContent || '$el.addClass("bar-sqkd-fadedbabe")';
    this.fileObj = {
      'view.js': 'baz',
    };
  });

  beforeEach(function () {
    this.shellCalls = [];
    this.fileObj[this.viewFiles[0]] = this.fileContent;
    mock(this.fileObj);
    mockSpawn();

    /* eslint-disable global-require */
    this.spawnSync = require('child_process').spawnSync;
    require('child_process').spawnSync = (shellCmd, ...args) => {
      this.shellCalls.push([shellCmd, ...args]);
      const grepContent = args[0][1];
      /* eslint-enable global-require */
      let stdout;
      // Result of checking file for a stylesheet declaration
      if (shellCmd === 'grep' && grepContent.includes('styles =')) {
        stdout = this.styleCheck;
      } else {
        stdout = this.viewFiles;
      }
      return {
        stderr: '',
        stdout,
      };
    };
  });

  afterEach(() => {
    // eslint-disable-next-line global-require
    require('child_process').spawnSync = this.spawnSync;
    mock.restore();
  });

  it('extracts the namespace from the selector', function (done) {
    return run(styles, () => {
      const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
      expect(fileContent).not.toContain('-sqkd-');
      expect(fileContent).toContain('styles.bar');
    }).then(() => {
      done();
    });
  });

  it('removes the namespace from the stylesheet', function (done) {
    return run(styles, () => {
      const sedCmd = this.shellCalls.slice(-2, -1)[0][1][1];
      expect(sedCmd).toContain('sed');
      expect(sedCmd).toContain('/-sqkd-[a-z0-9]*/');
    }).then(() => {
      done();
    });
  });

  it('adds the stylesheet as a dependency', function (done) {
    return run(styles, () => {
      const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
      expect(fileContent).toContain('import styles from');
      expect(fileContent).toContain(pluginOpts.scssPath);
    }).then(() => {
      done();
    });
  });

  describe('with duplicate base selectors', () => {
    beforeEach(function () {
      this.dupeStyles = `
        .row-sqkd-beefbeef {
          color: fuchsia;
        }
        .row-sqkd-fadefade {
          border: 0;
        }
      `;
    });

    it('handles them with a shell script', function (done) {
      return run(this.dupeStyles, () => {
        const [scriptPath, sel, maybeArg] = this.shellCalls[0][1];
        expect(path.isAbsolute(scriptPath)).toBeTruthy();
        expect(scriptPath).toContain('replace_selector');
        expect(sel).toContain('row-sqkd-fadefade');
        expect(sel).toContain('row-sqkd-beefbeef');
        expect(maybeArg).toBeUndefined();
      }).then(() => {
        done();
      });
    });

    it('holds the result in an intermediary file', function (done) {
      return run(this.dupeStyles, () => {
        const cpCmd = this.shellCalls.filter(shCall => shCall[0] === 'cp');
        const [, cpArgs] = cpCmd[0];
        expect(cpArgs).toContain('tmp/test.scss');
        expect(cpArgs).toContain(pluginOpts.scssPath);
      }).then(() => {
        done();
      });
    });

    it('preserves all changes', function (done) {
      return run(this.dupeStyles, () => {
        const [shellCmd] = this.shellCalls.slice(-1);
        const [mvCmd, mvArgs] = shellCmd;
        expect(mvCmd).toEqual('mv');
        expect(mvArgs[0]).toEqual('tmp/test.scss');
        expect(mvArgs[1]).toEqual(pluginOpts.scssPath);
      }).then(() => {
        done();
      });
    });

    describe('with a different temporary path', () => {
      beforeEach(function () {
        this.runOpts = Object.assign({}, pluginOpts, {
          tmpStylePath: 'public/foo.css',
        });
      });

      it('holds the result in an intermediary file', function (done) {
        return run(this.dupeStyles, () => {
          const cpCmd = this.shellCalls.filter(shCall => shCall[0] === 'cp');
          const [, cpArgs] = cpCmd[0];
          expect(cpArgs).toContain('public/foo.css');
          expect(cpArgs).toContain(pluginOpts.scssPath);
        }, this.runOpts).then(() => {
          done();
        });
      });

      it('preserves all changes', function (done) {
        return run(this.dupeStyles, () => {
          const [shellCmd] = this.shellCalls.slice(-1);
          const [mvCmd, mvArgs] = shellCmd;
          expect(mvCmd).toEqual('mv');
          expect(mvArgs[0]).toEqual('public/foo.css');
          expect(mvArgs[1]).toEqual(pluginOpts.scssPath);
        }, this.runOpts).then(() => {
          done();
        });
      });
    });
  });
});

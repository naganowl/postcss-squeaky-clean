const mock = require('mock-fs');
const mockSpawn = require('mock-spawn');

const postcss = require('postcss');
const plugin = require('../plugins/analytics');

const pluginOpts = {
  scssPath: 'helpers.scss',
  scssSheets: 'app/assets/stylesheets',
};
const styles = '.a-class-selector-sqkd-deadbeef { color: fuchsia } .btn { color: peru }';

// Function helper to make our tests cleaner
// This runs our plugin and needs to be explicitly returned since it's a promise
function run(input, callback, opts = pluginOpts) {
  return postcss([plugin(opts)]).process(input)
    .then(callback);
}

describe('Squeaky analytics plugin', () => {
  beforeEach(function () {
    mock();
    mockSpawn();

    this.runOpts = Object.assign({}, pluginOpts, {
      statsMap: {},
    });

    // eslint-disable-next-line global-require
    require('child_process').spawnSync = (shellCmd, shellArgs) => {
      if (shellCmd === 'sh') {
        this.shellArgs = shellArgs;
      }

      return {
        stderr: '',
        stdout: '',
      };
    };
  });

  afterEach(() => {
    mock.restore();
  });

  it('reads the `scssSheets` option', function () {
    return run(styles, () => {
      expect(this.shellArgs[1]).toContain(this.runOpts.scssSheets);
      expect(this.shellArgs[1]).toContain('a-class-selector');
    }, this.runOpts);
  });

  it('tabulates the selectors correctly', function () {
    return run(styles, () => {
      expect(this.runOpts.statsMap[this.runOpts.scssPath].all).toEqual(2);
      expect(this.runOpts.statsMap[this.runOpts.scssPath].clean).toEqual(1);
      expect(this.runOpts.statsMap[this.runOpts.scssPath].total).toEqual(1);
    }, this.runOpts);
  });

  it('informs when a stylesheet can proceed to phase 2', function () {
    spyOn(console, 'log');

    return run(styles, () => {
      // eslint-disable-next-line no-console
      expect(console.log.calls.allArgs().filter(logged => logged.includes('phase 2'))).toBeTruthy();
    }, this.runOpts);
  });

  describe('with other squeaky selectors', () => {
    beforeEach(() => {
      // eslint-disable-next-line global-require
      require('child_process').spawnSync = () => ({
        stderr: '',
        stdout: ['sh', 'bar.scss'].join('\n'),
      });
    });

    it('reports selectors in other files', function () {
      spyOn(console, 'log');

      return run(styles, () => {
        // eslint-disable-next-line no-console
        expect(console.log.calls.allArgs().filter(logged => logged.includes('bar.scss'))).toBeTruthy();
      }, this.runOpts);
    });
  });
});

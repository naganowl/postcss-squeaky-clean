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

  afterAll(function () {
    delete this.viewFiles;
    delete this.fileContent;
    delete this.fileObj;
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
      expect(fileContent).toContain('(styles.bar)');
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

  describe('with an existing style dependency in a view file', () => {
    beforeAll(function () {
      this.styleCheck = true;
      this.viewFiles = ['/table-row.js'];
      this.fileContent = `
        import styles from 'app/assets/stylesheets/row.scss'
        $el.removeClass('bar-sqkd-fadedbabe');
      `;
    });

    afterAll(function () {
      delete this.viewFiles;
      delete this.styleCheck;
      delete this.fileContent;
    });

    it('creates another style dependency', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('table_row_styles.bar');
        expect(fileContent).toContain('import styles from');
        expect(fileContent).toContain('import table_row_styles from');
      }).then(() => {
        done();
      });
    });
  });

  describe('with a class selector in the middle of a string', () => {
    beforeAll(function () {
      this.fileContent = `
        $el.removeClass('hidden bar-sqkd-fadedbabe');
      `;
    });

    afterAll(function () {
      delete this.fileContent;
    });

    it('interpolates the declaration', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('`hidden ${styles.bar}`'); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with a multi-word namespaced class selector', () => {
    beforeAll(function () {
      this.multiStyles = '.lightbox-header-sqkd-deadcafe { color: peru }';
      this.fileContent = `
        $el.removeClass('hidden lightbox-header-sqkd-deadcafe');
      `;
    });

    afterAll(function () {
      delete this.multiStyles;
      delete this.fileContent;
    });

    it('references the module selector correctly', function (done) {
      return run(this.multiStyles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain("`hidden ${styles['lightbox-header']}`"); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with multiple namespaced class selectors on a line', () => {
    beforeAll(function () {
      this.multiStyles = `
        .foo-sqkd-deadbeef {
          color: peru;
        }
        .bar-sqkd-fadedbabe {
          border: 0;
        }
      `;
      this.fileContent = `
        $el.removeClass('hidden foo-sqkd-deadbeef text-center bar-sqkd-fadedbabe');
      `;
    });

    afterAll(function () {
      delete this.multiStyles;
      delete this.fileContent;
    });

    it('references the module selector correctly', function (done) {
      return run(this.multiStyles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('`hidden ${styles.foo} text-center ${styles.bar}`'); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with an HTML fragment without interpolation', () => {
    beforeAll(function () {
      this.fileContent = `
        $('table').append('<tr>' +
          '<td class="check select-row bar-sqkd-fadedbabe"></td>' +
        '</tr>');
      `;
    });

    afterAll(function () {
      delete this.fileContent;
    });

    it('leaves the quotes alone', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('\'<td class="check select-row ${styles.bar}"></td>\''); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with an HTML fragment without interpolation and outer double quotes', () => {
    beforeAll(function () {
      this.fileContent = `
        $('table').append('<tr>' +
          "<td class='check select-row bar-sqkd-fadedbabe'></td>" +
        '</tr>');
      `;
    });

    afterAll(function () {
      delete this.fileContent;
    });

    it('leaves the quotes alone', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('"<td class=\'check select-row ${styles.bar}\'></td>"'); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with an HTML fragment with interpolation', () => {
    beforeAll(function () {
      const id = 1;
      this.fileContent = `
        $('table').append('<tr>' +
          \`<td class="check select-row bar-sqkd-fadedbabe">${id}</td>\` +
        '</tr>');
      `;
    });

    afterAll(function () {
      delete this.fileContent;
    });

    it('leaves the quotes alone', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('`<td class="check select-row ${styles.bar}">1</td>`'); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with a multiline interpolated HTML fragment', () => {
    beforeAll(function () {
      const id = 2;
      this.fileContent = `
        $('table').append(\`<tr>
          <td class="check select-row bar-sqkd-fadedbabe">${id}</td>
        </tr>\`);
      `;
    });

    afterAll(function () {
      delete this.fileContent;
    });

    it('leaves the quotes alone', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('<td class="check select-row ${styles.bar}">2</td>'); // eslint-disable-line no-template-curly-in-string
      }).then(() => {
        done();
      });
    });
  });

  describe('with a CoffeeScript file', () => {
    beforeAll(function () {
      this.viewFiles = ['header.coffee'];
      this.fileContent = `
        $el.removeClass('hidden bar-sqkd-fadedbabe');
      `;
    });

    afterAll(function () {
      delete this.fileContent;
      delete this.viewFiles;
    });

    it('interpolates the declaration', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('"hidden #{styles.bar}"');
      }).then(() => {
        done();
      });
    });

    describe('with an existing style dependency and multi-word file', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.origFile = this.viewFiles;
        this.viewFiles = ['/header-row.coffee'];
        this.styleCheck = true;
        this.fileContent = `
          styles = require('app/assets/stylesheets/row.scss')
          $el.removeClass('bar-sqkd-fadedbabe');
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
        this.viewFiles = this.origFile;
        delete this.styleCheck;
      });

      it('creates another style dependency', function (done) {
        return run(styles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).not.toContain('-sqkd-');
          expect(fileContent).toContain('header_row_styles.bar');
          expect(fileContent).toContain('header_row_styles = require(');
        }).then(() => {
          done();
        });
      });

      describe('with a style dependency in the middle of the file', () => {
        beforeAll(function () {
          this.origContent = this.fileContent;
          this.fileContent = `
            styles = require('app/assets/stylesheets/row.scss')
            class RowView extends View
              template: require('app/assets/templates/row.eco')
              render: ->
                $el.removeClass('bar-sqkd-fadedbabe');
          `;
        });

        afterAll(function () {
          this.fileContent = this.origContent;
        });

        it('creates another style dependency', function (done) {
          return run(styles, () => {
            const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
            expect(fileContent.indexOf('header_row_styles = require(')).toBeLessThan(fileContent.indexOf('template: require'));
          }).then(() => {
            done();
          });
        });
      });
    });

    describe('with jQuery interpolation', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          $el = $('<div class="spinner bar-sqkd-fadedbabe">');
          $view.append($el)
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('properly interpolates the selector', function (done) {
        return run(styles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).toContain('$("<div class=\'spinner #{styles.bar}\'>")');
        }).then(() => {
          done();
        });
      });
    });
  });

  describe('with an ECO file', () => {
    beforeAll(function () {
      this.viewFiles = ['header.eco'];
      this.fileContent = `
        <div class="header bar-sqkd-fadedbabe"></div>
      `;
    });

    afterAll(function () {
      delete this.fileContent;
      delete this.viewFiles;
    });

    it('interpolates the declaration', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).not.toContain('-sqkd-');
        expect(fileContent).toContain('"header <%= styles.bar %>"');
      }).then(() => {
        done();
      });
    });

    it('adds the stylesheet as a dependency', function (done) {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).toContain('styles = require(');
        expect(fileContent).toContain(pluginOpts.scssPath);
      }).then(() => {
        done();
      });
    });

    describe('with a variable', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <a class='<%= @clearLinkClassName %> clear-link bar-sqkd-fadedbabe'></a>
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('interpolates the declaration', function (done) {
        return run(styles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).not.toContain('-sqkd-');
          expect(fileContent).toContain("'<%= @clearLinkClassName %> clear-link <%= styles.bar %>'");
        }).then(() => {
          done();
        });
      });
    });

    describe('with a namespaced selector as an argument to a function call', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <%= @svgIcon(iconAngleRight, 'icon-tiny bar-sqkd-fadedbabe icon-bold') %>
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('interpolates the declaration', function (done) {
        return run(styles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).not.toContain('-sqkd-');
          expect(fileContent).toContain(' "icon-tiny #{styles.bar} icon-bold"');
        }).then(() => {
          done();
        });
      });
    });

    describe('with a namespaced selector as an argument to a function call', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <span class="state-indicator <%= Utils.camel('super-state bar-sqkd-fadedbabe') %>"></span>
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('interpolates the declaration', function (done) {
        return run(styles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).not.toContain('-sqkd-');
          expect(fileContent).toContain('"state-indicator');
          expect(fileContent).toContain('"super-state #{styles.bar}"');
        }).then(() => {
          done();
        });
      });
    });

    describe('with a namespaced selector conditionally added', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <div class="selected-text <%= "hidden bar-sqkd-fadedbabe" unless @alreadySelected %>">
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('interpolates the declaration', function (done) {
        return run(styles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).not.toContain('-sqkd-');
          expect(fileContent).toContain('"selected-text');
          expect(fileContent).toContain('"hidden #{styles.bar}"');
        }).then(() => {
          done();
        });
      });
    });

    describe('with multiple namespaced selectors', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <div class="selected-text foo-sqkd-deadbeef <%= "hidden bar-sqkd-fadedbabe" unless @alreadySelected %>">
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('interpolates the declaration', function (done) {
        const multiStyles = `
          .bar-sqkd-fadedbabe {
            color: aliceblue;
          }
          .foo-sqkd-deadbeef {
            color: peru;
          }
        `;
        return run(multiStyles, () => {
          const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
          expect(fileContent).not.toContain('-sqkd-');
          expect(fileContent).toContain('<%= styles.foo %>');
          expect(fileContent).toContain('"hidden #{styles.bar}"');
        }).then(() => {
          done();
        });
      });
    });
  });
});

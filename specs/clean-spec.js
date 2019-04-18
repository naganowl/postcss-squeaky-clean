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

function checkContents(cssOpts) {
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
    }, cssOpts);
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

    /* eslint-disable global-require */
    this.spawnSync = require('child_process').spawnSync;
    require('child_process').spawnSync = (shellCmd) => {
      /* eslint-enable global-require */
      const stdout = shellCmd === 'grep' ? this.viewFiles : this.fileContent;
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

  afterAll(function () {
    delete this.viewFiles;
    delete this.fileContent;
  });

  checkContents();

  it('skips blacklisted classes', function () {
    const safeStyles = '.foo { color: fuchsia }';
    return run(safeStyles, (result) => {
      expect(result.css).toEqual(safeStyles);
      expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
    });
  });

  it('skips blacklisted prefixes', function () {
    const safeStyles = '.ui-button { color: fuchsia }';
    return run(safeStyles, (result) => {
      expect(result.css).toEqual(safeStyles);
      expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
    });
  });

  it('skips tag selectors', function () {
    const safeStyles = 'button { color: fuchsia }';
    return run(safeStyles, (result) => {
      expect(result.css).toEqual(safeStyles);
      expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
    });
  });

  it('skips exceptions', function () {
    const safeStyles = `
      .row { /* squeaky-skip */
        color: fuchsia
      }
    `;
    return run(safeStyles, (result) => {
      expect(result.css).toContain('row');
      expect(result.css).not.toContain('-sqkd-');
      expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
    });
  });

  it('namespaces pseudo elements', () => {
    const cssStyles = 'a:not(.a-class-selector) { color: fuchsia }';
    return run(cssStyles, (result) => {
      expect(result.css).toContain('(.a-class-selector-sqkd-');
    });
  });

  it('namespaces multiple eligible class selectors', () => {
    const cssStyles = 'a.link-selector:not(.a-class-selector) { color: fuchsia }';
    return run(cssStyles, (result) => {
      expect(result.css).toContain('link-selector-sqkd-');
      expect(result.css).toContain('(.a-class-selector-sqkd-');
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

    afterAll(function () {
      delete this.viewFiles;
    });

    it('leaves the file alone', function () {
      return run(styles, () => {
        // File is written/modified only if it's been processed by the plugin.
        expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
      });
    });
  });

  describe('with a class name variable', () => {
    beforeAll(function () {
      this.fileContent = 'rowClassName = "a-class-selector"';
    });

    checkContents();
  });

  describe('with an underscore class name variable', () => {
    beforeAll(function () {
      this.fileContent = 'row_class = "a-class-selector"';
    });

    checkContents();
  });

  describe('with a ternary operation', () => {
    beforeAll(function () {
      this.fileContent = "table_class = @disabled ? 'a-class-selector' : ''";
    });

    checkContents();
  });

  describe('with a CoffeeScript conditional', () => {
    beforeAll(function () {
      this.fileContent = 'className = if @options.legacy then "a-class-selector" else "old"';
    });

    checkContents();
  });

  describe('with a function returning a string', () => {
    beforeAll(function () {
      this.fileContent = 'colClassName: -> "a-class-selector #{super}"';
    });

    checkContents();
  });

  describe('with CoffeeScript-style function interpolation', () => {
    beforeAll(function () {
      this.fileContent = `
        className: ->
          viewClassName = "#{super} a-class-selector"
      `;
    });

    checkContents();
  });

  describe('with a value string that has interpolation', () => {
    beforeAll(function () {
      this.fileContent = 'cellClassName: "a-class-selector #{Row.prototype::classProp}"';
    });

    checkContents();
  });

  describe('with an eligible array of strings as part of an argument', () => {
    beforeAll(function () {
      this.fileContent = 'autocompleter = new Autocompleter(url: "/link", extraClassName: ["a-class-selector"])';
    });

    checkContents();
  });

  describe('with a function value that has the selector as a string argument', () => {
    beforeAll(function () {
      this.fileContent = '{ label: "Submitted At", cell: Backgrid.Extension.MomentCell.extend(className: "a-class-selector"), editable: false, sortable: false }';
    });

    checkContents();
  });

  describe('with a nested function call with an eligible string selector', () => {
    beforeAll(function () {
      this.fileContent = '@$(".todos-item").tipsy(Utils.getTipsyOptions(className: "a-class-selector"))';
    });

    checkContents();
  });

  describe('with a Ruby hash key value pair', () => {
    beforeAll(function () {
      this.fileContent = ':class => "a-class-selector"';
    });

    checkContents();
  });

  describe('with a Ruby hash key value pair string interpolated', () => {
    beforeAll(function () {
      this.fileContent = '#{f.text_field form_field, :class => "a-class-selector #{opts[:class]}}';
    });

    checkContents();
  });

  describe('with a Ruby hash key value pair assignment', () => {
    beforeAll(function () {
      this.fileContent = 'opts_hash = {:message => ", :class => "a-class-selector"}';
    });

    checkContents();
  });

  describe('with a conditional method call with a hash that is string value eligible', () => {
    beforeAll(function () {
      this.fileContent = 'html_options.merge!({:class => "a-class-selector"}) if tab[:selected]';
    });

    checkContents();
  });

  describe('with Object hash interpolation with string as eligible value', () => {
    beforeAll(function () {
      this.fileContent = 'html << render( :locals => {:row_class => "row #{@expanded ? "a-class-selector" : "}"})';
    });

    checkContents();
  });

  describe('with markup containing eligible string as an argument', () => {
    beforeAll(function () {
      this.fileContent = 'link_to "<span class="a-class-selector #{opts.enabled}">#{text}</span>".html_safe, url, link_options';
    });

    checkContents();
  });

  describe('with object hash syntax', () => {
    beforeAll(function () {
      this.fileContent = '{ :title => "Hello", :title_class => "a-class-selector" }';
    });

    checkContents();
  });

  describe('with a template view file', () => {
    beforeAll(function () {
      this.fileContent = '<div class="a-class-selector">';
    });

    checkContents();
  });

  describe('with an interpolated template view file', () => {
    beforeAll(function () {
      this.fileContent = '<div class="a-class-selector another-class-selector <%= @aVariable unless @finished %>">';
    });

    checkContents();
  });

  describe('with a conditional template view file', () => {
    beforeAll(function () {
      this.fileContent = '<div class="first-selector <%= "a-class-selector" if @condition %>">';
    });

    checkContents();
  });

  describe('with an invocation passing in an object eligible key', () => {
    beforeAll(function () {
      this.fileContent = "<%- require('template-file')({firstClasses: 'a-class-selector'}) %>";
    });

    checkContents();
  });

  describe('with a template function call', () => {
    beforeAll(function () {
      this.fileContent = "<%= a_helper(:helper_text => 'Help!', :helper_class => 'a-class-selector') %>";
    });

    checkContents();
  });

  describe('with a multi argument template function call', () => {
    beforeAll(function () {
      this.fileContent = '<%= standard_button "Submit", :id => "submit", :button_class => "a-class-selector" %>';
    });

    checkContents();
  });

  describe('with conditional in template markup', () => {
    beforeAll(function () {
      this.viewFiles = ['list.erb'];
      this.fileContent = '<li class="item <%= deleted? ? "deleted a-class-selector" : " %>">';
    });

    checkContents();
  });

  describe('with generic namespace selectors', () => {
    beforeEach(function () {
      this.genericStyles = `
        .column {
          float: right;
        }
      `;
    });

    describe('with JSX properties referencing selectors to be namespaced', () => {
      beforeAll(function () {
        this.viewFiles = ['table.js'];
        this.fileContent = `
          <TableRow>
            {this.props.columns.map(column => (
              <TableCell
                className={column.className || this.props.cellClassName}
              >
              </TableCell>
            ))}
          </TableRow>
        `;
      });

      afterAll(function () {
        delete this.viewFiles;
        delete this.fileContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });

    describe('inlined with other JSX properties', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <TableRow key={column.id} className={column.className || this.props.columnClassName} data-selector={column.selector}>
          </TableRow>
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });

    describe('with a property sharing the same name as selector', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          columns.map(column => ({ ...column, className: column.archived ? styles.archived : null }))
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });

    describe('with ECO interpolation', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          <td title="<%= title.replace(/"/g, "'") %>" class='<%= column.value.toLowerCase() %>-attribute<%= if column.disableSelectRow? then ' no-select' else '' %>'>
          <td class='<%= column.value.toLowerCase() %>-custom<%= if column.disableSelectRow? then ' no-select' else '' %>'>
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });

    describe('with an instance property name', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          _buildSidePanel: ->
            className: @column.get('sidePanelClass')
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });

    describe('with a property key', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          className: '',
          column: undefined,
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });

    describe('with a variable hash reference', () => {
      beforeAll(function () {
        this.origContent = this.fileContent;
        this.fileContent = `
          iconClassName: icon_class_name,
          additionalClasses: column[:additionalClasses] || '',
        `;
      });

      afterAll(function () {
        this.fileContent = this.origContent;
      });

      it('avoids changing the view file', function () {
        return run(this.genericStyles, (result) => {
          expect(result.css).toContain('column-sqkd');
          expect(fs.existsSync(this.viewFiles[0])).toBeFalsy();
        });
      });
    });
  });

  describe('with a composed stylesheet', () => {
    const composeOpts = Object.assign({}, pluginOpts, { fileExts: 'scss' });

    beforeAll(function () {
      this.viewFiles = ['helpers.scss'];
      this.fileContent = "composes: a-class-selector from 'app/assets/stylesheets/utils.scss';";
    });

    checkContents(composeOpts);

    it('adds to the composed styles', function () {
      return run(styles, () => {
        const fileContent = fs.readFileSync(this.viewFiles[0]).toString();
        expect(fileContent).toMatch(/composes:\sa-class-selector\sa-class-selector-sqkd-\w+/);
      }, composeOpts);
    });
  });

  describe('with a custom RegExp', () => {
    const reOpts = Object.assign({}, pluginOpts, { regExps: ['svg_?[iI]con.+?,.+?[\'"]'] });

    beforeAll(function () {
      this.fileContent = '<%- templateHelpers.svgIcon(@iconName, "a-class-selector #{@className}") %>';
    });

    checkContents(reOpts);
  });
});

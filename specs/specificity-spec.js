const postcss = require('postcss');
const plugin = require('../plugins/specificity');

const pluginOpts = {
  scssPath: 'helpers.scss',
};
const styles = '.icon-sqkd-deadbeef { color: fuchsia } .std-btn-sqkd-beefdead .icon-sqkd-fadebeef { color: peru }';

// Function helper to make our tests cleaner
// This runs our plugin and needs to be explicitly returned since it's a promise
function run(input, callback, opts = pluginOpts) {
  return postcss([plugin(opts)]).process(input)
    .then(callback);
}

describe('Squeaky specificity plugin', () => {
  beforeEach(function () {
    this.runOpts = Object.assign({}, pluginOpts, {
      conflictsMap: new Map(),
      specificityMap: {},
    });
  });

  it('detects selector conflicts', function () {
    return run(styles, () => {
      expect(this.runOpts.conflictsMap.has('icon')).toBeTruthy();
      const confMap = this.runOpts.conflictsMap.get('icon');
      expect(confMap.has('color')).toBeTruthy();
      const confObj = confMap.get('color');
      const { mostSpecific } = confObj;
      expect(mostSpecific.value).toEqual('peru');
      expect(mostSpecific.source).toEqual('.std-btn-sqkd-beefdead .icon-sqkd-fadebeef');
      expect(confObj.values.length).toEqual(2);
    }, this.runOpts);
  });

  it('accounts for line positioning of selectors', function () {
    const specStyles = `
      .icon-sqkd-deadbeef {
        color: fuchsia;
      }
      .icon-sqkd-fadebeef {
        color: aliceblue;
      }
    `;
    return run(specStyles, () => {
      const confMap = this.runOpts.conflictsMap.get('icon');
      const confObj = confMap.get('color');
      const { mostSpecific } = confObj;
      expect(mostSpecific.value).toEqual('aliceblue');
      expect(mostSpecific.source).toEqual('.icon-sqkd-fadebeef');
    }, this.runOpts);
  });

  it('detects multiple conflicts', function () {
    const specStyles = `
      .icon-sqkd-deadbeef {
        color: fuchsia;
        height: 10px;
        border: 0;
      }
      .icon-sqkd-fadebeef {
        color: aliceblue;
        border: 10px;
      }
    `;
    return run(specStyles, () => {
      const confMap = this.runOpts.conflictsMap.get('icon');
      expect(confMap.has('border')).toBeTruthy();
      expect(confMap.has('height')).toBeFalsy();
      let confObj = confMap.get('color');
      let { mostSpecific } = confObj;
      expect(mostSpecific.value).toEqual('aliceblue');
      expect(mostSpecific.source).toEqual('.icon-sqkd-fadebeef');
      confObj = confMap.get('border');
      ({ mostSpecific } = confObj);
      expect(mostSpecific.value).toEqual('10px');
      expect(mostSpecific.source).toEqual('.icon-sqkd-fadebeef');
    }, this.runOpts);
  });

  it('ranks important declarations higher', function () {
    const specStyles = `
      .icon-sqkd-deadbeef {
        color: fuchsia !important;
      }
      .icon-sqkd-fadebeef {
        color: aliceblue;
      }
    `;
    return run(specStyles, () => {
      const confMap = this.runOpts.conflictsMap.get('icon');
      const confObj = confMap.get('color');
      const { mostSpecific } = confObj;
      expect(mostSpecific.important).toBeTruthy();
      expect(mostSpecific.value).toEqual('fuchsia');
      expect(mostSpecific.source).toEqual('.icon-sqkd-deadbeef');
    }, this.runOpts);
  });

  describe('with an existing conflict', () => {
    beforeEach(function () {
      const selObj = {
        value: 'orange',
        important: false,
        source: '.icon-sqkd-fadedbee',
        specificity: this.specificity || [0, 1, 1, 0],
        file: this.file || 'common/shared.scss',
        line: 1,
      };
      this.runOpts.conflictsMap = new Map([
        ['icon', new Map([
          ['color', {
            mostSpecific: selObj,
            values: [selObj],
          }],
        ]),
        ]]);
    });

    it('defaults to favor the generic specific selector', function () {
      return run(styles, () => {
        const confMap = this.runOpts.conflictsMap.get('icon');
        const confObj = confMap.get('color');
        const { mostSpecific } = confObj;
        expect(mostSpecific.important).toBeFalsy();
        expect(mostSpecific.value).toEqual('orange');
        expect(mostSpecific.source).toEqual('.icon-sqkd-fadedbee');
      }, this.runOpts);
    });

    describe('with equal non-important specificity', () => {
      beforeAll(function () {
        this.specificity = [0, 0, 2, 0];
      });

      afterAll(function () {
        delete this.specificity;
      });

      it('chooses the further file selector', function () {
        return run(styles, () => {
          const confMap = this.runOpts.conflictsMap.get('icon');
          const confObj = confMap.get('color');
          const { mostSpecific } = confObj;
          expect(mostSpecific.important).toBeFalsy();
          expect(mostSpecific.value).toEqual('peru');
          expect(mostSpecific.source).toEqual('.std-btn-sqkd-beefdead .icon-sqkd-fadebeef');
        }, this.runOpts);
      });

      it('tracks the current style as a specificity conflict', function () {
        return run(styles, () => {
          const { specificity, value, source } = this.runOpts.specificityMap.icon;
          expect(specificity).toEqual(this.specificity);
          expect(value).toEqual('peru');
          expect(source).toEqual('.std-btn-sqkd-beefdead .icon-sqkd-fadebeef');
        }, this.runOpts);
      });
    });

    describe('in a more specific file with equal non-important specificity', () => {
      beforeAll(function () {
        this.file = 'styleguide/modules/tables/header-cell';
        this.specificity = [0, 0, 2, 0];
      });

      afterAll(function () {
        delete this.file;
        delete this.specificity;
      });

      it('chooses the further file selector', function () {
        return run(styles, () => {
          const confMap = this.runOpts.conflictsMap.get('icon');
          const confObj = confMap.get('color');
          const { mostSpecific } = confObj;
          expect(mostSpecific.important).toBeFalsy();
          expect(mostSpecific.value).toEqual('orange');
          expect(mostSpecific.source).toEqual('.icon-sqkd-fadedbee');
        }, this.runOpts);
      });
    });
  });
});

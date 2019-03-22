const postcss = require('postcss');
const nested = require('postcss-nested');
const syntax = require('postcss-scss');
const plugin = require('../plugins/flatten');

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
function run(input, callback) {
  // Needs `postcss-nested` and `postcss-scss`
  return postcss([nested, plugin])
    .process(input, { syntax })
    .then(callback);
}

// Compare CSS lines after normalizing whitespace on each line
function checkStyles(returnedCss, expectedCss) {
  const retArr = returnedCss.split('\n');
  const expectArr = expectedCss.split('\n');

  retArr.forEach((retLine, idx) => {
    expect(retLine.trim()).toEqual(expectArr[idx].trim());
  });
}

describe('Squeaky flatten plugin', () => {
  it('flattens squeaky selectors', () => run(basicNestedStyles, (result) => {
    const flatStyles = `
        .foo-sqkd-deadbeef {
          /* Specificity: 0,0,1,0 (1)  */
          color: fuchsia !important;
        }
        .foo-sqkd-deadbeef a {
          /* Specificity: 0,0,1,1 (1)  */
          border: 0;
        }
        .bar-sqkd-fadedbabe {
          /* Specificity: 0,0,2,1 (1)  */
          padding: 1px !important;
        }
      `;
    checkStyles(result.css, flatStyles);
  }));

  it('adds specificity comments', () => run(basicNestedStyles, (result) => {
    expect(result.css).toContain('Specificity: 0,0,1,0 (1)');
  }));

  it('makes squeaky leaf selector properties important', () => run(basicNestedStyles, (result) => {
    expect(result.css).toContain('color: fuchsia !important;');
    expect(result.css).not.toContain('border: 0 !important;');
  }));

  it('logs the squeaky selectors it makes top level', () => {
    spyOn(console, 'log').and.callThrough();
    return run(basicNestedStyles, () => {
      /* eslint-disable arrow-body-style, no-console */
      const flattenedSqkdSels = console.log.calls.allArgs().filter((logged) => {
        return logged.filter((entries) => {
          return typeof entries === 'object';
        });
      })[0][2];
      expect(flattenedSqkdSels).toContain('.foo-sqkd-deadbeef');
      expect(flattenedSqkdSels).toContain('.bar-sqkd-fadedbabe');
    });
  });
});

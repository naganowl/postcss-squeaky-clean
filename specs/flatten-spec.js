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

// Helper to detect the namespaced selectors logged as flattened
function checkSelectorLog(theStyles, callback) {
  spyOn(console, 'log').and.callThrough();
  return run(theStyles, () => {
    /* eslint-disable arrow-body-style, no-console */
    const flatSqkdSelArr = console.log.calls.allArgs().filter((logged) => {
      return logged.filter((entries) => {
        return typeof entries === 'object';
      });
    })[0][2];

    callback(flatSqkdSelArr);
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

  it('ignores selectors without any style properties', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        a.baz-sqkd-beeffade {
          .bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      }
    `;

    return run(nestedStyles, (result) => {
      const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          .bar-sqkd-fadedbabe {
            /* Specificity: 0,0,3,1 (1)  */
            padding: 1px !important;
          }
        `;
      checkStyles(result.css, flatStyles);
    });
  });

  it('trims ancestor tag selectors of squeaky selectors', () => {
    const nestedStyles = `
      h1 {
        color: fuchsia;

        a.baz-sqkd-beeffade {
          btn {
            padding: 1px;
          }
        }
      }
    `;

    return run(nestedStyles, (result) => {
      const flatStyles = `
          h1 {
            /* Specificity: 0,0,0,1 (1)  */
            color: fuchsia;
          }
          .baz-sqkd-beeffade btn {
            /* Specificity: 0,0,1,3 (1)  */
            padding: 1px;
          }
        `;
      checkStyles(result.css, flatStyles);
    });
  });

  it('removes tag selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        button.bar-sqkd-fadedbabe {
          padding: 1px;
        }
      }
    `;

    return run(nestedStyles, (result) => {
      const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          .bar-sqkd-fadedbabe {
            /* Specificity: 0,0,2,1 (1)  */
            padding: 1px !important;
          }
        `;
      checkStyles(result.css, flatStyles);
    });
  });

  it('handles multiple namespaced selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        .baz-sqkd-beeffade.bar-sqkd-fadedbabe {
          padding: 1px;
        }
      }
    `;

    return run(nestedStyles, (result) => {
      const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          .baz-sqkd-beeffade.bar-sqkd-fadedbabe {
            /* Specificity: 0,0,3,0 (1)  */
            padding: 1px !important;
          }
        `;
      checkStyles(result.css, flatStyles);
    });
  });

  it('handles nested placeholder selectors', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        %baz {
          padding: 1px;
        }
      }
    `;

    return run(nestedStyles, (result) => {
      const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          %baz {
            /* Specificity: 0,0,1,1 (1)  */
            padding: 1px;
          }
        `;
      checkStyles(result.css, flatStyles);
    });
  });

  it('handles namespaced pseudo-element states', () => {
    const nestedStyles = `
      .foo-sqkd-deadbeef {
        color: fuchsia;

        button:hover {
          padding: 1px;
        }
      }
    `;

    return run(nestedStyles, (result) => {
      const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          .foo-sqkd-deadbeef button:hover {
            /* Specificity: 0,0,2,1 (1)  */
            padding: 1px;
          }
        `;
      checkStyles(result.css, flatStyles);
    });
  });

  it('adds specificity comments', () => run(basicNestedStyles, (result) => {
    expect(result.css).toContain('Specificity: 0,0,1,0 (1)');
  }));

  it('makes squeaky leaf selector properties important', () => run(basicNestedStyles, (result) => {
    expect(result.css).toContain('color: fuchsia !important;');
    expect(result.css).not.toContain('border: 0 !important;');
  }));

  it('logs the squeaky selectors it makes top level', () => {
    return checkSelectorLog(basicNestedStyles, (flattenedSqkdSels) => {
      expect(flattenedSqkdSels).toContain('.foo-sqkd-deadbeef');
      expect(flattenedSqkdSels).toContain('.bar-sqkd-fadedbabe');
    });
  });

  describe('with comma separated namespaced selectors', () => {
    beforeEach(function () {
      this.commaStyles = `
        .foo-sqkd-deadbeef, .baz-sqkd-beeffade {
          color: fuchsia;

          .bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      `;
    });

    it('handles comma separated namespaced selectors', function () {
      return run(this.commaStyles, (result) => {
        const flatStyles = `
            .foo-sqkd-deadbeef, .baz-sqkd-beeffade {
              /* Specificity: 0,0,1,0 (2)  */
              color: fuchsia !important;
            }
            .bar-sqkd-fadedbabe {
              /* Specificity: 0,0,2,0 (2)  */
              padding: 1px !important;
            }
          `;
        checkStyles(result.css, flatStyles);
      });
    });

    it('accounts for them in specificity comments', function () {
      return run(this.commaStyles, (result) => {
        expect(result.css).toContain('Specificity: 0,0,1,0 (2)');
      });
    });
  });

  describe('with comma separated differing specificity namespaced selectors', () => {
    beforeEach(function () {
      this.commaStyles = `
        .foo-sqkd-deadbeef {
          color: fuchsia;

          btn.baz-sqkd-beeffade, .bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      `;
    });

    it('handles comma separated namespaced selectors', function () {
      return run(this.commaStyles, (result) => {
        const flatStyles = `
            .foo-sqkd-deadbeef {
              /* Specificity: 0,0,1,0 (1)  */
              color: fuchsia !important;
            }
            .baz-sqkd-beeffade, .bar-sqkd-fadedbabe {
              /* Specificity: 0,0,2,1; 0,0,2,0  */
              padding: 1px !important;
            }
          `;
        checkStyles(result.css, flatStyles);
      });
    });

    it('accounts for both specificities', function () {
      return run(this.commaStyles, (result) => {
        expect(result.css).toContain('Specificity: 0,0,2,1; 0,0,2,0');
      });
    });
  });

  describe('with sibling namespaced selectors', () => {
    beforeEach(function () {
      this.commaStyles = `
        .foo-sqkd-deadbeef {
          color: fuchsia;

          .baz-sqkd-beeffade ~ .bar-sqkd-fadedbabe {
            padding: 1px;
          }
        }
      `;
    });

    it('handles flattening the styles', function () {
      return run(this.commaStyles, (result) => {
        const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          .baz-sqkd-beeffade ~ .bar-sqkd-fadedbabe {
            /* Specificity: 0,0,3,0 (1)  */
            padding: 1px;
          }
        `;
        checkStyles(result.css, flatStyles);
      });
    });

    it('logs the squeaky selectors it makes top level', function () {
      return checkSelectorLog(this.commaStyles, (flattenedSqkdSels) => {
        expect(flattenedSqkdSels).toContain('.foo-sqkd-deadbeef');
        expect(flattenedSqkdSels).toContain('.bar-sqkd-fadedbabe');
        expect(flattenedSqkdSels).toContain('.baz-sqkd-beeffade');
      });
    });

    it('keeps the sibling values un-important', function () {
      return run(this.commaStyles, (result) => {
        expect(result.css).toContain('padding: 1px;');
      });
    });
  });

  describe('with pseudo-element namespaced selectors', () => {
    beforeEach(function () {
      this.pseudoStyles = `
        .foo-sqkd-deadbeef {
          color: fuchsia;

          .row-header:not(.baz-sqkd-beeffade):not(.bar-sqkd-fadedbabe) {
            padding: 1px;
          }
        }
      `;
    });

    it('handles flattening the styles', function () {
      return run(this.pseudoStyles, (result) => {
        const flatStyles = `
          .foo-sqkd-deadbeef {
            /* Specificity: 0,0,1,0 (1)  */
            color: fuchsia !important;
          }
          .row-header:not(.baz-sqkd-beeffade):not(.bar-sqkd-fadedbabe) {
            /* Specificity: 0,0,4,0 (1)  */
            padding: 1px;
          }
        `;
        checkStyles(result.css, flatStyles);
      });
    });

    it('logs the squeaky selectors it makes top level', function () {
      return checkSelectorLog(this.pseudoStyles, (flattenedSqkdSels) => {
        expect(flattenedSqkdSels).toContain('.foo-sqkd-deadbeef');
        expect(flattenedSqkdSels).toContain('.row-header');
        expect(flattenedSqkdSels).not.toContain('.bar-sqkd-fadedbabe');
        expect(flattenedSqkdSels).not.toContain('.baz-sqkd-beeffade');
      });
    });

    it('keeps the pseudo-element selector values un-important', function () {
      return run(this.pseudoStyles, (result) => {
        expect(result.css).toContain('padding: 1px;');
      });
    });
  });
});

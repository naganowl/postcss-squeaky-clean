module.exports = {
  env: {
    jasmine: true,
  },
  rules: {
    'func-names': 'off',
    'import/no-extraneous-dependencies': [
      'off',
      {'devDependencies': ['**/*.spec.js']
    }],
  },
};

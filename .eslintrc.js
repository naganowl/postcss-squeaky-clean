module.exports = {
  extends: 'airbnb',
  env: {
    jasmine: true,
  },
  rules: {
    'implicit-arrow-linebreak': 'off',
    'import/no-extraneous-dependencies': [
      'off',
      {'devDependencies': ['**/*.spec.js']
    }],
  },
};

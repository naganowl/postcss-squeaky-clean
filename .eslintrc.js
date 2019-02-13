module.exports = {
  extends: 'airbnb',
  rules: {
    'implicit-arrow-linebreak': 'off',
    'import/no-extraneous-dependencies': [
      'off',
      {'devDependencies': ['**/*.spec.js']
    }],
  },
};

/** @type {import('jest').Config} */
module.exports = {
  roots: ['<rootDir>/lib', '<rootDir>/scripts'],
  testMatch: ['**/__tests__/**/*.(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/control-center/.next/'],
  modulePathIgnorePatterns: ['/control-center/.next/'],
};

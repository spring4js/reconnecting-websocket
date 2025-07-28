module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/'],
  testRegex: [
    //'(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
    //'(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
    'test[/\\\\].+test\\.ts$',
  ],
  collectCoverage: true, // 统计覆盖率
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/python/*.ts', 'src/python/biz/*.ts', 'src/python/walker/*.ts'],
  coverageReporters: ['lcov', 'text', 'html'],
}

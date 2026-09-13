module.exports = {
    roots: ['<rootDir>/tests', '<rootDir>/__mocks__'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
    testEnvironment: 'jsdom',
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    modulePathIgnorePatterns: ['<rootDir>/(?:.*/)?(?:\\.worktrees|worktrees|\\.codex|\\.git)/'],
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/(?:.*/)?(?:\\.worktrees|worktrees|\\.codex|\\.git)/'],
};

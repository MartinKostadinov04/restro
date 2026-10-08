// @restro/core/apply: everything in core that writes to the database. A separate entry point so
// that `@restro/core` stays free of I/O (the shell, the faces and the browser import that one).
// Rule 1: only files in this folder may import `@restro/db/write`.
export * from './provision'

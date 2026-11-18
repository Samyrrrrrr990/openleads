/**
 * @zory/core — the Zory interface layer.
 *
 * This package is the part of Zory that is not a product surface. It has no
 * React, no DOM and no network: it is the typed description of an interface,
 * the structured commands that change one, and the machinery that keeps those
 * changes reversible, validatable and serialisable.
 *
 * Three surfaces build on it. Zory Studio edits a project graph in the cloud,
 * Zory Local edits one that lives in a repository, and Zory Layer patches an
 * interface somebody else shipped. They share this vocabulary rather than
 * three incompatible ones, which is the whole reason it is a package.
 *
 * Everything here is open source under Apache-2.0.
 */

// The project graph: what an interface is.
export * from './graph/types';
export * from './graph/ids';
export * from './graph/factory';
export * from './graph/selectors';
export * from './graph/instances';
export * from './graph/migrations';
export * from './graph/theme';

// Commands: how an interface changes.
export * from './commands/types';
export * from './commands/apply';
export * from './commands/factories';
export * from './commands/validate';
export * from './commands/describe';

// History: how a change is taken back.
export * from './history/history';

// Motion: how an interface moves, as data rather than as animation code.
export * from './motion/types';
export * from './motion/css';

// Layer: patching an interface that Zory did not build.
export * from './layer/types';
export * from './layer/target';
export * from './layer/apply';

// Auditing: questions the graph can answer without a browser.
export * from './audit/rules';

// Diffing: what changed about an interface, rather than about its source.
export * from './diff/diff';

// The interface of a repository Zory did not write. Read-only, and honest
// about what it could not read.
export * from './interface/types';
export * from './interface/audit';
export * from './interface/diff';

// Protocol: how Zory Local talks to a Zory surface.
export * from './protocol/types';

// Plans and entitlements: what a given account is allowed to do.
export * from './billing/plans';
export * from './billing/entitlements';
export * from './billing/team';

// The source engine: reading and editing React that Zory did not write.

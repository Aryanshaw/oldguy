// Types for lib/node-floor.cjs, which stays plain JavaScript so any Node can load it.

// One plain sentence when oldguy cannot run on this Node or from this folder, or null when all is well.
export declare function nodeProblem(version: string, dir: string): string | null;

// The oldest Node oldguy supports, as major.minor.patch.
export declare const NODE_FLOOR: string;

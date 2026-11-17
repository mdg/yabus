import { username } from '#lib/identity.ts';
import { createReplicator, type Replicator } from './replicator.ts';

let instance: Replicator | null = null;

/** The one replicator for this page load. It outlives individual views, so pending sends finish. */
export function getReplicator(): Replicator {
	return (instance ??= createReplicator({ username }));
}

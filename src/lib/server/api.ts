import { error } from '@sveltejs/kit';
import { StorageError } from './storage.ts';

/** Turns storage errors into HTTP errors. Anything else is a real bug and is rethrown. */
export function toHttpError(e: unknown): never {
	if (e instanceof StorageError) error(e.status as 400 | 403, e.message);
	throw e;
}

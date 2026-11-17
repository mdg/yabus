import { closeLoop, openLoop } from './loop.ts';
import type { RouteCollection, RouteKind } from './types.ts';

export interface MetadataPatch {
	number?: string;
	name?: string;
	color?: string;
	kind?: RouteKind;
}

/**
 * Returns a copy of the route with the route-level fields changed on every path (they are
 * duplicated onto each path feature and must always agree).
 *
 * Changing the kind adjusts the waypoints so the route stays valid:
 * - to a loop, a closing waypoint is added on top of the first one;
 * - to point-to-point, the closing waypoint is removed.
 * A loop has a single path, so a route with a return path cannot become a loop.
 *
 * Rebuild the geometry afterwards when the kind changed, since the waypoints changed.
 */
export function applyMetadata(route: RouteCollection, patch: MetadataPatch): RouteCollection {
	let features = route.features;

	if (patch.kind !== undefined && patch.kind !== features[0].properties.kind) {
		const toLoop = patch.kind === 'loop';
		if (toLoop && features.length > 1) throw new Error('A loop has a single path.');
		features = features.map((f) => ({
			...f,
			properties: {
				...f.properties,
				waypoints: toLoop
					? closeLoop(f.properties.waypoints)
					: openLoop(f.properties.waypoints)
			}
		}));
	}

	const fields: MetadataPatch = {};
	if (patch.number !== undefined) fields.number = patch.number;
	if (patch.name !== undefined) fields.name = patch.name;
	if (patch.color !== undefined) fields.color = patch.color;
	if (patch.kind !== undefined) fields.kind = patch.kind;

	return {
		...route,
		features: features.map((f) => ({ ...f, properties: { ...f.properties, ...fields } }))
	};
}

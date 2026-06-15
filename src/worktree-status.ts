/**
 * Whether `git status --porcelain` output reports any change to a tracked file.
 * Untracked entries (`??`) are ignored — they do not block rewording.
 */
export function hasTrackedChanges(status: string): boolean {
	return status
		.split('\n')
		.some((line) => line !== '' && !line.startsWith('??'));
}

const EXTENSION_PATH_MARKER = '/scripts/extensions/';

/**
 * Resolve the SillyTavern extension identifier from the loaded entry module URL.
 * This keeps template loading compatible with both the upstream and fork folder names.
 * @param {string | URL} moduleUrl
 * @returns {string}
 */
export function resolveExtensionTemplatePath(moduleUrl) {
    const directoryPath = decodeURIComponent(new URL('.', moduleUrl).pathname).replace(/\/+$/, '');
    const markerIndex = directoryPath.lastIndexOf(EXTENSION_PATH_MARKER);
    if (markerIndex < 0) {
        throw new Error('Could not resolve the Summaryception extension directory.');
    }

    const extensionPath = directoryPath.slice(markerIndex + EXTENSION_PATH_MARKER.length);
    if (!extensionPath) {
        throw new Error('Summaryception extension directory is empty.');
    }
    return extensionPath;
}

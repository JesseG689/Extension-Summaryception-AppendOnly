import { describe, expect, it } from 'vitest';

import { resolveExtensionTemplatePath } from '../src/foundation/extension-path.js';

describe('resolveExtensionTemplatePath', () => {
    it.each(['Extension-Summaryception', 'Extension-Summaryception-AppendOnly'])(
        'supports the %s installation folder',
        (folder) => {
            const moduleUrl = `https://localhost/scripts/extensions/third-party/${folder}/index.js`;

            expect(resolveExtensionTemplatePath(moduleUrl)).toBe(`third-party/${folder}`);
        },
    );
});

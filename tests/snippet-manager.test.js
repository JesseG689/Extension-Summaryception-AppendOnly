import { expect, it } from 'vitest';

import { updateSnippetTextAt } from '../src/features/snippet-manager.js';
import { installSummaryContext, makeSummaryStore } from './test-helpers.js';

it('removes stale datetime metadata when a Layer 0 edit reports unknown', async () => {
    const snippet = {
        text: '[NARRATIVE]\nOld.\n\n[STATE]\ncurrent_date_time: 2024-01-02 14 Tue',
        currentDateTime: '2024-01-02 14 Tue',
        sourceMessageIds: ['source'],
    };
    installSummaryContext({
        metadata: {
            summaryception: makeSummaryStore({ layers: [[snippet]] }),
        },
    });

    await expect(
        updateSnippetTextAt(0, 0, '[NARRATIVE]\nUpdated.\n\n[STATE]\ncurrent_date_time: unknown'),
    ).resolves.toEqual({ status: 'updated' });
    expect(snippet).not.toHaveProperty('currentDateTime');
});

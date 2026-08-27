import { expect, it } from 'vitest';

import { processSummarizerResponse } from '../src/core/summarizer-pipeline.js';
import { installSummaryContext, makeSummarySettings } from './test-helpers.js';

it('stores unknown when Layer 0 returns a non-schema calendar value', async () => {
    const settings = makeSummarySettings({ layer0SummaryTokenTarget: 280 });
    installSummaryContext({
        settings,
        getTokenCountAsync: async (text) => String(text).trim().split(/\s+/).filter(Boolean).length,
    });
    const narrative = Array.from({ length: 55 }, (_, index) => `word${index}`).join(' ');
    const result = await processSummarizerResponse(
        `[NARRATIVE]\n${narrative}\n\n[STATE]\ncurrent_date_time: 312-07-14 23`,
        settings,
        { kind: 'regenerate', sourceRange: [0, 14] },
    );

    expect(result.status).toBe('success');
    expect(result.text).toContain('current_date_time: unknown');
    expect(result.text).not.toContain('current_date_time: 312-07-14 23');
});

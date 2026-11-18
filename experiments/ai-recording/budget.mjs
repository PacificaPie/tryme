import { fail, LIMITS } from './contract.mjs';

// Reservation is charged before dispatch and never released on timeout/failure.
// Estimates are NOT provider invoices. Local mock runs always have actualUsd=0.
export class Budget {
  constructor({ capUsd = 0, price = { input: 0, output: 0 }, mode = 'mock' } = {}) {
    if (!Number.isFinite(capUsd) || capUsd < 0 || !['mock', 'paid'].includes(mode)
      || ![price.input, price.output].every(n => Number.isFinite(n) && n >= 0)) throw fail('INVALID_BUDGET');
    this.capUsd = capUsd; this.price = price; this.mode = mode;
    this.reservedUsd = 0; this.events = [];
  }
  reserve({ inputTokens, outputTokens }) {
    if (this.events.length >= LIMITS.calls || ![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw fail('BUDGET_LIMIT');
    const usd = (inputTokens * this.price.input + outputTokens * this.price.output) / 1e6;
    if (this.reservedUsd + usd > this.capUsd + 1e-12 || (this.mode === 'paid' && usd <= 0)) throw fail('BUDGET_LIMIT');
    this.reservedUsd += usd;
    const event = { call: this.events.length + 1, inputTokensReserved: inputTokens, outputTokensReserved: outputTokens,
      reservedUsd: usd, status: 'pending', actualUsd: this.mode === 'mock' ? 0 : null };
    this.events.push(event); return event;
  }
  finish(event, usage) {
    if (!usage || ![usage.inputTokens, usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) {
      event.status = 'usage-unknown'; throw fail('USAGE_UNKNOWN');
    }
    event.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    event.estimatedUsd = (usage.inputTokens * this.price.input + usage.outputTokens * this.price.output) / 1e6;
    event.status = 'complete';
    if (usage.inputTokens > event.inputTokensReserved || usage.outputTokens > event.outputTokensReserved) {
      event.status = 'over-reservation'; throw fail('USAGE_LIMIT');
    }
  }
}

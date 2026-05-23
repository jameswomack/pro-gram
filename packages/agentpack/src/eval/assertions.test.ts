import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@jameswomack/mluxe';
import { evaluateAssertion } from './assertions.js';

function traj(messages: ChatMessage[]): ChatMessage[] { return messages; }

describe('evaluateAssertion', () => {
  const sample = traj([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'c1',
        type: 'function',
        function: { name: 'stats__lookup_player', arguments: JSON.stringify({ name: 'Bobby Witt Jr.', season: 2025 }) },
      }],
    },
    { role: 'tool', tool_call_id: 'c1', name: 'stats__lookup_player', content: '{"wOBA":"0.350"}' },
    { role: 'assistant', content: 'Bobby Witt Jr. posted a wOBA of .350.' },
  ]);

  it('contains is case-insensitive across all assistant messages', () => {
    expect(evaluateAssertion({ contains: 'WOBA' }, sample).pass).toBe(true);
  });
  it('notContains', () => {
    expect(evaluateAssertion({ notContains: 'batting average' }, sample).pass).toBe(true);
    expect(evaluateAssertion({ notContains: 'wOBA' }, sample).pass).toBe(false);
  });
  it('finalContains only checks the last assistant message', () => {
    expect(evaluateAssertion({ finalContains: 'Bobby Witt' }, sample).pass).toBe(true);
  });
  it('regex', () => {
    expect(evaluateAssertion({ regex: '\\.\\d{3}' }, sample).pass).toBe(true);
  });
  it('toolCalled / toolNotCalled', () => {
    expect(evaluateAssertion({ toolCalled: 'stats__lookup_player' }, sample).pass).toBe(true);
    expect(evaluateAssertion({ toolNotCalled: 'almanac__current_celestial_time' }, sample).pass).toBe(true);
    expect(evaluateAssertion({ toolCalled: 'almanac__current_celestial_time' }, sample).pass).toBe(false);
  });
  it('toolArgsContain matches substring on strings, exact on primitives', () => {
    expect(evaluateAssertion(
      { toolArgsContain: { tool: 'stats__lookup_player', args: { name: 'Bobby Witt' } } },
      sample,
    ).pass).toBe(true);
    expect(evaluateAssertion(
      { toolArgsContain: { tool: 'stats__lookup_player', args: { season: 2025 } } },
      sample,
    ).pass).toBe(true);
    expect(evaluateAssertion(
      { toolArgsContain: { tool: 'stats__lookup_player', args: { season: 2024 } } },
      sample,
    ).pass).toBe(false);
  });
  it('minAssistantTurns', () => {
    expect(evaluateAssertion({ minAssistantTurns: 2 }, sample).pass).toBe(true);
    expect(evaluateAssertion({ minAssistantTurns: 3 }, sample).pass).toBe(false);
  });

  const widgetSample = traj([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'show me Witt' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'w1',
        type: 'function',
        function: { name: 'widget__player_card', arguments: JSON.stringify({ player: 'Bobby Witt Jr.', wOBA: 0.350 }) },
      }],
    },
    { role: 'tool', tool_call_id: 'w1', name: 'widget__player_card', content: '[widget player_card rendered] ...' },
    { role: 'assistant', content: "Here's Witt — note the synthetic data flag." },
  ]);

  it('widgetEmitted / widgetNotEmitted', () => {
    expect(evaluateAssertion({ widgetEmitted: 'player_card' }, widgetSample).pass).toBe(true);
    expect(evaluateAssertion({ widgetEmitted: 'chart_summary' }, widgetSample).pass).toBe(false);
    expect(evaluateAssertion({ widgetNotEmitted: 'chart_summary' }, widgetSample).pass).toBe(true);
  });

  it('widgetArgsContain matches subset', () => {
    expect(evaluateAssertion(
      { widgetArgsContain: { widget: 'player_card', args: { player: 'Bobby Witt' } } },
      widgetSample,
    ).pass).toBe(true);
    expect(evaluateAssertion(
      { widgetArgsContain: { widget: 'player_card', args: { player: 'Aaron Judge' } } },
      widgetSample,
    ).pass).toBe(false);
  });
});

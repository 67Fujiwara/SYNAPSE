import common from './common.md';
import immersionHigh from './immersion-high.md';
import immersionMedium from './immersion-medium.md';
import immersionLow from './immersion-low.md';
import modeDaily from './mode-daily.md';
import modeBusiness from './mode-business.md';
import modeMyWork from './mode-mywork.md';
import modeFree from './mode-free.md';
import scenarioGenerator from './scenario-generator.md';
import type { Immersion, Mode } from '../../shared/types';

const IMMERSION: Record<Immersion, string> = {
  high: immersionHigh,
  medium: immersionMedium,
  low: immersionLow,
};

const MODE: Record<Mode, string> = {
  daily: modeDaily,
  business: modeBusiness,
  mywork: modeMyWork,
  free: modeFree,
};

/**
 * Build the conversation system prompt.
 * Order is stable (common -> immersion -> mode -> scenario) so the cached
 * prefix survives across turns; the scenario is the only per-session part.
 */
export function buildChatSystem(mode: Mode, immersion: Immersion, scenario?: string): string {
  const parts = [common.trim(), IMMERSION[immersion].trim(), MODE[mode].trim()];
  if (mode === 'mywork' && scenario) parts.push(`# Scenario details\n${scenario.trim()}`);
  return parts.join('\n\n');
}

export const SCENARIO_GENERATOR_SYSTEM = scenarioGenerator.trim();

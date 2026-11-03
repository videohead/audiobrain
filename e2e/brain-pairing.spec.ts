import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { GraphDocument, OperatorDefinition } from '../src/graph/types';
const catalog = JSON.parse(readFileSync(new URL('../contracts/operator-catalog.json', import.meta.url), 'utf8')) as { operators: OperatorDefinition[] };
function getDefaultParams(kind: string) {
  const definition = catalog.operators.find(operator => operator.kind === kind);
  if (!definition) throw new Error('Missing production operator');
  return Object.fromEntries(Object.entries(definition.params).map(([id, parameter]) => [id, parameter.defaultValue]));
}

const companionUrl = process.env.VIDEO_BRAIN_BASE_URL;
test('AudioBrain and VideoBrain exchange real graph controls through the pairing UI', async ({ page }) => {
  test.skip(!companionUrl, 'Set VIDEO_BRAIN_BASE_URL to a running companion with the AudioBrain panel.');
  if (!companionUrl) return;
  const project = JSON.parse(readFileSync(new URL('../presets/morphazoid-shapes.json', import.meta.url), 'utf8')) as GraphDocument;
  project.id = 'real-brain-pairing';
  project.nodes.find(node => node.id === 'geometry')!.params.curvature = .15;
  project.nodes.push(
    { id: 'brain-value', kind: 'control.constant', position: { x: 200, y: 900 }, params: { ...getDefaultParams('control.constant'), value: 0.75 } },
    { id: 'brain-output', kind: 'io.brain.out', position: { x: 500, y: 900 }, params: getDefaultParams('io.brain.out') },
    { id: 'brain-input', kind: 'io.brain.in', position: { x: -100, y: 900 }, params: { ...getDefaultParams('io.brain.in'), name: 'video' } },
  );
  project.edges.push(
    { id: 'brain-value-output', source: { nodeId: 'brain-value', portId: 'value' }, target: { nodeId: 'brain-output', portId: 'value' } },
    { id: 'brain-input-curvature', source: { nodeId: 'brain-input', portId: 'value' }, target: { nodeId: 'geometry', portId: 'curvature' } },
  );
  project.performance.widgets.push({ id: 'brain-send-value', kind: 'param', target: { nodePath: ['brain-value'], paramId: 'value' }, layout: { x: 0, y: 16, w: 4, h: 1 } });
  await page.goto('/');
  await page.getByLabel('Import AudioBrain JSON').setInputFiles({ name: 'brain-pairing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByLabel('Videobrain URL').fill(companionUrl);
  const [video] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Open and pair Videobrain' }).click()]);
  const panel = video.getByRole('region', { name: 'AudioBrain connection' });
  await expect(panel).toBeVisible();
  await panel.getByRole('combobox', { name: 'Mapping 1 parameter' }).selectOption(JSON.stringify(['pad', 'x']));
  await panel.getByRole('button', { name: 'Add mapping' }).click();
  await panel.getByRole('textbox', { name: 'Mapping 2 channel' }).fill('audiobrain-v1/video');
  await panel.getByRole('combobox', { name: 'Mapping 2 parameter' }).selectOption(JSON.stringify(['pad', 'y']));
  await panel.getByRole('button', { name: 'Pair AudioBrain' }).click();
  await expect(panel.getByRole('status')).toHaveText('Connected');
  const videoX = video.getByRole('slider', { name: 'XY Pad X', exact: true });
  await expect(videoX).toHaveValue('0.75');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const incoming = page.getByTestId('widget-curvature');
  await expect(incoming.locator('.wired-hint')).toContainText('0.5');
  await expect(incoming.getByRole('slider', { name: 'Curvature', exact: true })).toHaveValue('0.15');
  await page.getByTestId('widget-brain-send-value').getByRole('slider', { name: 'Value', exact: true }).fill('0.25');
  await expect(videoX).toHaveValue('0.25');
  await video.getByRole('slider', { name: 'XY Pad Y', exact: true }).fill('0.8');
  await expect(incoming.locator('.wired-hint')).toContainText('0.8');
  await expect(page.locator('.transport .audio-button')).toHaveText('Enable audio');
  await page.screenshot({ path: test.info().outputPath('audiobrain-paired.png') });
  await video.screenshot({ path: test.info().outputPath('videobrain-paired.png') });
  await video.close();
  await expect(incoming.locator('.wired-hint')).toContainText('0.15');
});

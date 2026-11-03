import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as AudioModule from '../src/audio/AudioRack';
import type * as EvaluationModule from '../src/runtime/GraphEvaluator';
import type * as GraphModule from '../src/graph';

let server: ViteDevServer;
let sourceBase: string;
let cacheDir: string;
test.beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'audiobrain-offline-vite-'));
  server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  sourceBase = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await server?.close(); if (cacheDir) await rm(cacheDir, { recursive: true, force: true }); });

test('all Morphazoid flows render finite real samples and honor gain and output wiring', async ({ page }) => {
  await page.goto(sourceBase);
  const results = await page.evaluate(async (base) => {
    const { AudioRack } = await import(`${base}/src/audio/AudioRack.ts`) as typeof AudioModule;
    const { GraphEvaluator } = await import(`${base}/src/runtime/GraphEvaluator.ts`) as typeof EvaluationModule;
    const { compileGraph, PRESETS } = await import(`${base}/src/graph/index.ts`) as typeof GraphModule;
    const render = async (index: number, gainOffset = 0, disconnected = false) => {
      const document = structuredClone(PRESETS[index]);
      const gain = document.nodes.find((node) => node.id === 'gain')!;
      gain.params.db = Number(gain.params.db) + gainOffset;
      if (disconnected) { document.nodes = document.nodes.filter((node) => node.kind !== 'audio.output'); document.edges = document.edges.filter((edge) => edge.target.nodeId !== 'out'); }
      const graph = compileGraph(document), evaluator = new GraphEvaluator(graph);
      const context = new OfflineAudioContext(2, 96_000, 48_000), rack = new AudioRack(context);
      const nodes = graph.nodes.filter(({ definition }) => ['audio', 'analysis'].includes(definition.runtime.domain)).map(({ node }) => ({ id: node.id, kind: node.kind }));
      const edges = graph.nodes.flatMap(({ node, inputs }) => Object.values(inputs).filter((input) => input.type === 'audio.block').map((input) => ({ source: input.sourceNodeId, target: node.id })));
      rack.applyPlan(nodes, edges); rack.setPlaying(true);
      for (let time = 0; time < 2; time += 0.025) {
        const result = evaluator.evaluate({ time, start: time, end: time + 0.025, levels: {}, controls: new Map(), midiNotes: new Map() });
        for (const node of result.audio) {
          rack.update(node.id, node.params, time);
          if (node.voices) rack.continuous(node.id, node.voices, time, Number(node.params.character) || 0);
          for (const note of node.notes ?? []) rack.note(node.id, note, note.time, Number(node.params.decay) || 0.6);
        }
      }
      const buffer = await context.startRendering();
      let sum = 0, peak = 0, finite = true;
      for (let channel = 0; channel < 2; channel++) for (const sample of buffer.getChannelData(channel)) { finite &&= Number.isFinite(sample); sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      rack.dispose(); return { title: document.title, rms: Math.sqrt(sum / buffer.length / 2), peak, finite };
    };
    const audible = [];
    for (let index = 0; index < PRESETS.length; index++) audible.push(await render(index));
    return { audible, quieter: await render(0, -20), disconnected: await render(0, 0, true) };
  }, sourceBase);
  console.log(JSON.stringify(results));
  for (const render of results.audible) {
    expect(render.finite).toBe(true); expect(render.rms).toBeGreaterThan(0.001); expect(render.peak).toBeLessThan(0.5);
  }
  expect(results.quieter.rms).toBeLessThan(results.audible[0].rms * 0.2);
  expect(results.disconnected.rms).toBe(0);
});

test('Shapes synth, notes and FM drums render distinct real sound and release old modes', async ({ page }) => {
  await page.goto(sourceBase);
  const results = await page.evaluate(async (base) => {
    const { AudioRack } = await import(`${base}/src/audio/AudioRack.ts`) as typeof AudioModule;
    const { GraphEvaluator } = await import(`${base}/src/runtime/GraphEvaluator.ts`) as typeof EvaluationModule;
    const { compileGraph, PRESETS } = await import(`${base}/src/graph/index.ts`) as typeof GraphModule;
    const render = async (mode: 'continuous' | 'notes' | 'triggers', stop = false) => {
      const document = structuredClone(PRESETS[0]);
      document.nodes.find(node => node.kind === 'shapes.reader')!.params = { ...document.nodes.find(node => node.kind === 'shapes.reader')!.params, heads: 1, rateHz: 1, divisions: 1 };
      document.nodes.find(node => node.kind === 'shapes.mapping')!.params.playingMode = mode;
      document.nodes.find(node => node.kind === 'audio.gain')!.params.db = -9;
      const graph = compileGraph(document), evaluator = new GraphEvaluator(graph);
      const context = new OfflineAudioContext(2, 96_000, 24_000), rack = new AudioRack(context);
      rack.applyPlan(graph.nodes.filter(({ definition }) => ['audio', 'analysis'].includes(definition.runtime.domain)).map(({ node }) => ({ id: node.id, kind: node.kind })), graph.nodes.flatMap(({ node, inputs }) => Object.values(inputs).filter(input => input.type === 'audio.block').map(input => ({ source: input.sourceNodeId, target: node.id }))));
      rack.setPlaying(true);
      let eventCount = 0;
      for (let time = 0; time < 4; time += 0.025) {
        const result = evaluator.evaluate({ time, start: time, end: time + 0.025, levels: {}, controls: new Map(), midiNotes: new Map() });
        for (const node of result.audio) {
          rack.update(node.id, node.params, time);
          if (node.voices) rack.continuous(node.id, node.voices, time, Number(node.params.character) || 0);
          if (!stop || time < 1) for (const note of node.notes ?? []) { rack.note(node.id, note, note.time, Number(node.params.decay) || 0.6); eventCount++; }
          if (stop && time >= 1 && node.kind === 'voice.continuous') rack.update(node.id, { ...node.params, shapeMode: 'continuous' }, time);
        }
      }
      const buffer = await context.startRendering();
      const data = buffer.getChannelData(0);
      let energy = 0, peak = 0, lateEnergy = 0, deltaEnergy = 0;
      for (let index = 0; index < data.length; index++) {
        const sample = data[index];
        if (!Number.isFinite(sample)) throw new Error('Nonfinite rendered sample.');
        energy += sample * sample; peak = Math.max(peak, Math.abs(sample));
        if (index > 60_000) lateEnergy += sample * sample;
        if (index) deltaEnergy += (sample - data[index - 1]) ** 2;
      }
      rack.dispose();
      return { rms: Math.sqrt(energy / data.length), peak, lateRms: Math.sqrt(lateEnergy / 36_000), roughness: deltaEnergy / Math.max(energy, 1e-9), eventCount };
    };
    return { synth: await render('continuous'), notes: await render('notes'), drums: await render('triggers'), released: await render('triggers', true) };
  }, sourceBase);
  for (const result of [results.synth, results.notes, results.drums]) {
    expect(result.rms).toBeGreaterThan(0.003);
    expect(result.peak).toBeLessThan(0.9);
  }
  expect(results.synth.eventCount).toBe(0);
  expect(results.notes.eventCount).toBeGreaterThan(8);
  expect(results.drums.eventCount).toBe(results.notes.eventCount);
  expect(Math.abs(results.drums.roughness / results.notes.roughness - 1)).toBeGreaterThan(0.25);
  expect(results.released.lateRms).toBeLessThan(0.00001);
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../graph';
import { controller } from '../control/controller';
import { ControllersPanel } from './ControllersPanel';

const project = PRESETS[0]!;
let cleanup: () => void;
beforeEach(() => {
  localStorage.clear();
  cleanup = controller.initialize({ setPlaying: () => undefined, getSnapshot: () => ({ playing: false }) as never, reset: () => undefined, panic: () => undefined });
});
afterEach(() => {
  cleanup();
  for (const { id } of controller.snapshot().mappings) controller.remove(id);
  vi.restoreAllMocks();
});

describe('ControllersPanel (provisional UI)', () => {
  it('states that it is incomplete and points to the research document', () => {
    render(<ControllersPanel project={project} />);
    expect(screen.getByRole('note')).toHaveTextContent(/Incomplete/);
    expect(screen.getByRole('note')).toHaveTextContent('CENTRAL_CONTROL.md');
  });
  it('saves a transport mapping and lists it', async () => {
    const user = userEvent.setup();
    render(<ControllersPanel project={project} />);
    await user.type(screen.getByLabelText('Mapping ID'), 'stop');
    await user.type(screen.getByLabelText('Name'), 'Stop all');
    await user.selectOptions(screen.getByLabelText('Action'), 'transport');
    await user.selectOptions(screen.getByLabelText('Transport command'), 'panic');
    await user.click(screen.getByRole('button', { name: /Save mapping/ }));
    expect(controller.snapshot().mappings).toEqual([{ id: 'stop', name: 'Stop all', action: { type: 'transport', command: 'panic' } }]);
    expect(await screen.findByText('Stop all')).toBeInTheDocument();
  });
  it('saves a numeric parameter mapping using the parameter range', async () => {
    const user = userEvent.setup();
    render(<ControllersPanel project={project} />);
    await user.type(screen.getByLabelText('Mapping ID'), 'vol');
    await user.type(screen.getByLabelText('Name'), 'Volume');
    await user.selectOptions(screen.getByLabelText('Node'), 'gain');
    await user.selectOptions(screen.getByLabelText('Parameter'), 'db');
    await user.click(screen.getByRole('button', { name: /Save mapping/ }));
    expect(controller.snapshot().mappings[0]?.action).toEqual({ type: 'parameter', nodeId: 'gain', paramId: 'db', mode: 'absolute', low: -60, high: 0 });
  });
  it('imports a mappings file, reporting skipped actions and that controllers are disarmed', async () => {
    const user = userEvent.setup();
    render(<ControllersPanel project={project} />);
    const text = JSON.stringify({ format: 'brain.mappings', version: 1, mappings: [
      { id: 'a', name: 'A', action: { type: 'transport', command: 'pause' } },
      { id: 'b', name: 'B', action: { type: 'source', nodeId: 'r', mode: 'advance', index: 0 } },
    ] });
    await user.upload(screen.getByLabelText('Import mappings file'), new File([text], 'm.json', { type: 'application/json' }));
    expect(await screen.findByText(/Imported 1 mapping\. Controllers are disarmed\./)).toBeInTheDocument();
    expect(screen.getByText(/AudioBrain has no "source" action/)).toBeInTheDocument();
  });
  it('shows the controller error for an invalid file', async () => {
    const user = userEvent.setup();
    render(<ControllersPanel project={project} />);
    await user.upload(screen.getByLabelText('Import mappings file'), new File(['{"format":"nope"}'], 'm.json', { type: 'application/json' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a brain.mappings file.');
  });
});

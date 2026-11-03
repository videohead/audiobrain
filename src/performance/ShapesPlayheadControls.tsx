import { useId } from 'react';
import { Pin, RotateCcw } from 'lucide-react';
import { getOperatorDefinition, parameterList, type GraphDocument, type GraphNode, type ParameterEntry } from '../graph';
import type { NodeSnapshot } from '../runtime/AudioBrainRuntime';
import { useProjectStore } from '../store';
import { ParameterControl } from '../components/ParameterControl';
import { shapesHeadColor } from './shapesPresentation';
import './ShapesPlayheadControls.css';

interface ShapesPlayheadControlsProps {
  node: GraphNode;
  project: GraphDocument;
  snapshot?: NodeSnapshot;
  compact?: boolean;
  onPin?: () => void;
}

const choiceLabel: Record<string, string> = {
  points: 'Point', line: 'Line', radar: 'Radar', inherit: 'Use main reader',
  forward: 'Forward', reverse: 'Reverse', loop: 'Loop', pingpong: 'Ping-pong',
  vertical: 'Vertical', horizontal: 'Horizontal',
};
const wrapPhase = (value: number, period = 1) => ((value % period) + period) % period;

/** All controls edit the reader node's registry-defined parameters; no view state is saved. */
export function ShapesPlayheadControls({ node, project, snapshot, compact, onPin }: ShapesPlayheadControlsProps) {
  const store = useProjectStore();
  const unique = useId();
  const definition = getOperatorDefinition(node.kind);
  const parameters = new Map(parameterList(definition).map((parameter) => [parameter.id, parameter]));
  const savedValue = (id: string) => node.params[id] ?? parameters.get(id)?.defaultValue ?? 0;
  const liveNumber = (id: string) => snapshot?.params?.[id] ?? Number(savedValue(id));
  const wired = (id: string) => project.edges.some((edge) => edge.target.nodeId === node.id && edge.target.portId === id);
  const headParameter = parameters.get('heads');
  const count = Math.max(1, Math.min(headParameter?.type === 'number' ? headParameter.max : 12, Math.round(liveNumber('heads'))));
  const period = savedValue('motion') === 'pingpong' ? 2 : 1;
  const setValue = (id: string, value: number | string | boolean) => store.setNodeParam(node.id, id, value);
  const enumControl = (id: string, label?: string) => {
    const parameter = parameters.get(id);
    if (parameter?.type !== 'select') return null;
    return <label className="playhead-choice" key={id}>
      <span>{label ?? parameter.label}</span>
      <select aria-label={label ?? parameter.label} value={String(savedValue(id))} onChange={(event) => setValue(id, event.target.value)}>
        {parameter.options.map((option) => <option key={option.value} value={option.value}>{choiceLabel[option.value] ?? option.label}</option>)}
      </select>
    </label>;
  };
  const numericControl = (id: string, label?: string) => {
    const parameter = parameters.get(id);
    if (!parameter || parameter.type !== 'number') return null;
    const displayParameter: ParameterEntry = label ? { ...parameter, label } : parameter;
    return <ParameterControl key={id} nodeId={node.id} parameter={displayParameter} value={savedValue(id)}
      liveValue={snapshot?.params?.[id]} wired={wired(id)} onChange={(value) => setValue(id, value)}
      onBegin={store.beginGesture} onEnd={store.endGesture} compact={compact} />;
  };
  const spaceHeads = (align = false) => {
    const token = `head-spacing:${node.id}:${unique}`;
    store.beginGesture(token);
    for (let index = 0; index < count; index += 1) {
      const id = `head${index + 1}Phase`;
      if (!wired(id)) setValue(id, align ? Number(wrapPhase(-index / count, period).toFixed(4)) : 0);
    }
    store.endGesture(token);
  };
  return <div className={`shapes-playhead-controls nodrag nopan nowheel ${compact ? 'compact' : ''}`}
    onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <header className="playheads-heading"><div><strong>{node.label ?? 'Playheads'}</strong><span>{count} independent readers</span></div>
      {onPin && <button type="button" className="pin-button" onClick={onPin} aria-label="Add Playheads to performance"><Pin size={14} /></button>}
    </header>
    <div className="playheads-global-controls">
      {enumControl('reader', 'Main reader')}
      {numericControl('heads', 'Playhead count')}
      {enumControl('motion', 'Motion')}
      {enumControl('direction', 'All heads direction')}
      {numericControl('rateHz', 'Playhead speed')}
      {numericControl('phaseOffset', 'All heads phase')}
    </div>
    <div className="playheads-spacing-actions"><span>Relative positions in one cycle</span>
      <button type="button" onClick={() => spaceHeads()}><RotateCcw size={11} />Even spacing</button>
      <button type="button" onClick={() => spaceHeads(true)}>Align heads</button>
    </div>
    <div className="playheads-list">
      {Array.from({ length: count }, (_, index) => {
        const head = index + 1;
        const phaseId = `head${head}Phase`;
        const phaseParameter = parameters.get(phaseId);
        const phase = wrapPhase(index / count + liveNumber(phaseId), period);
        const phaseToken = `head-phase:${node.id}:${head}:${unique}`;
        const liveReader = snapshot?.readers?.find((reader) => reader.headIndex === index);
        const override = String(savedValue(`head${head}Reader`));
        const readerType = override === 'inherit' ? String(savedValue('reader')) : override;
        const actualDirection = liveReader?.direction ?? (savedValue(`head${head}Direction`) === savedValue('direction') ? 1 : -1);
        return <fieldset className="playhead-row" key={head} style={{ '--head-color': shapesHeadColor(index) } as React.CSSProperties}>
          <legend><span className="playhead-number">{head}</span>Playhead {head}<span className="playhead-live-direction">{actualDirection === -1 ? '← Reverse' : 'Forward →'}</span></legend>
          <div className="playhead-row-options">
            {enumControl(`head${head}Reader`, `Playhead ${head} reader`)}
            {enumControl(`head${head}Direction`, `Playhead ${head} direction`)}
            {readerType === 'line' && enumControl(`head${head}Axis`, `Playhead ${head} line axis`)}
          </div>
          {phaseParameter && phaseParameter.type === 'number' && <label className="playhead-phase">
            <span>Relative phase <output>{(phase / period * 100).toFixed(1)}%</output></span>
            <input type="range" min={0} max={period} step={phaseParameter.step} value={Number(phase.toFixed(4))}
              aria-label={`Playhead ${head} relative phase`} aria-valuetext={`${(phase / period * 100).toFixed(1)}% of the ${period === 2 ? 'out-and-back ' : ''}reader cycle`}
              disabled={wired(phaseId)}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); store.beginGesture(phaseToken); }}
              onPointerUp={() => store.endGesture(phaseToken)} onPointerCancel={() => store.endGesture(phaseToken)} onLostPointerCapture={() => store.endGesture(phaseToken)}
              onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) store.beginGesture(phaseToken); }}
              onKeyUp={() => store.endGesture(phaseToken)} onBlur={() => store.endGesture(phaseToken)}
              onChange={(event) => setValue(phaseId, Number(wrapPhase(Number(event.target.value) - index / count, period).toFixed(4)))} />
            {wired(phaseId) && <small>Wire controls this head’s position.</small>}
          </label>}
        </fieldset>;
      })}
    </div>
    <p className="playheads-help">Each head can use its own reader and direction. Directions are relative to “All heads direction”. Point follows the contour; Line and Radar sound every intersection.</p>
  </div>;
}

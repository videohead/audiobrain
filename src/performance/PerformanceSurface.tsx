import { useRef, type PointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Grip, Maximize2, Minimize2, X } from 'lucide-react';
import { GRAPH_LIMITS, getOperatorDefinition, getParameter, type GraphDocument } from '../graph';
import type { RuntimeSnapshot } from '../runtime/AudioBrainRuntime';
import { useProjectStore } from '../store';
import { ParameterControl } from '../components/ParameterControl';
import { InstrumentView } from './InstrumentView';
import { ShapesPlayheadControls } from './ShapesPlayheadControls';

interface PerformanceSurfaceProps { snapshot: RuntimeSnapshot; arrange?: boolean; compact?: boolean }
type Widget = GraphDocument['performance']['widgets'][number];

export function PerformanceSurface({ snapshot, arrange, compact }: PerformanceSurfaceProps) {
  const store = useProjectStore();
  const grid = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; x: number; y: number; layout: Widget['layout']; pointerId: number; resize: boolean } | null>(null);
  const project = store.document;
  const end = () => { if (gesture.current) store.endGesture(`layout:${gesture.current.id}`); gesture.current = null; };
  const begin = (event: PointerEvent<HTMLButtonElement>, widget: Widget, resize = false) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: widget.id, x: event.clientX, y: event.clientY, layout: widget.layout, pointerId: event.pointerId, resize };
    store.beginGesture(`layout:${widget.id}`);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || !grid.current) return;
    const cellWidth = grid.current.getBoundingClientRect().width / project.performance.columns;
    const cellHeight = Number.parseFloat(getComputedStyle(grid.current).gridAutoRows) + 8;
    const dx = Math.round((event.clientX - current.x) / cellWidth);
    const dy = Math.round((event.clientY - current.y) / cellHeight);
    const layout = current.resize ? { ...current.layout, w: Math.max(1, Math.min(project.performance.columns - current.layout.x, current.layout.w + dx)), h: Math.max(1, Math.min(GRAPH_LIMITS.maxRows - current.layout.y, current.layout.h + dy)) }
      : { ...current.layout, x: Math.max(0, Math.min(project.performance.columns - current.layout.w, current.layout.x + dx)), y: Math.max(0, Math.min(GRAPH_LIMITS.maxRows - current.layout.h, current.layout.y + dy)) };
    store.moveWidget(current.id, layout);
  };
  return <div className={`performance-surface ${arrange ? 'arranging' : ''} ${compact ? 'compact' : ''}`}>
    {arrange && <div className="arrange-help">Drag a handle to move. Use the corner to resize. Controls still play the instrument.</div>}
    <div className="performance-grid" ref={grid} style={{ '--columns': project.performance.columns } as React.CSSProperties}>
      {project.performance.widgets.map((widget) => {
        const target = project.nodes.find((node) => node.id === widget.target.nodePath[0]);
        const definition = target && getOperatorDefinition(target.kind);
        const parameter = widget.kind === 'param' ? definition && getParameter(definition, widget.target.paramId) : undefined;
        const nodeSnapshot = target ? snapshot.nodes[target.id] : undefined;
        const meterValue = Math.max(0, Math.min(1, nodeSnapshot?.level ?? nodeSnapshot?.value ?? 0));
        const isView = widget.kind === 'view';
        const isPlayheads = isView && target?.kind === 'shapes.reader' && widget.target.viewId === 'playheads';
        return <section key={widget.id} className={`surface-widget widget-${widget.kind} ${isPlayheads ? 'widget-playheads' : ''} ${!target ? 'missing-widget' : ''}`}
          aria-label={parameter?.label ?? target?.label ?? definition?.title ?? 'Missing control'}
          data-widget-node={target?.id}
          data-testid={`widget-${widget.id}`} style={{ gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`, gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}` }}>
          {arrange && <div className="widget-arrange-bar">
            <button type="button" className="widget-drag" aria-label={`Move ${widget.id}`} onPointerDown={(event) => begin(event, widget)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}><Grip size={14} /></button>
            <span>{parameter?.label ?? target?.label ?? definition?.title ?? widget.id}</span>
            <button type="button" aria-label={`Remove ${widget.id} from performance`} onClick={() => store.removeWidget(widget.id)}><X size={12} /></button>
          </div>}
          {!target ? <p>Source removed. Undo to restore this control.</p> : widget.kind === 'param' && parameter ? <ParameterControl nodeId={target.id} parameter={parameter}
            value={target.params[parameter.id] ?? parameter.defaultValue} liveValue={nodeSnapshot?.params?.[parameter.id]} onChange={(value) => store.setNodeParam(target.id, parameter.id, value)}
            onBegin={store.beginGesture} onEnd={store.endGesture}
            wired={project.edges.some((edge) => edge.target.nodeId === target.id && edge.target.portId === parameter.id)} />
            : isPlayheads ? <ShapesPlayheadControls node={target} project={project} snapshot={nodeSnapshot} compact={compact} />
            : isView ? <InstrumentView node={target} project={project} snapshot={nodeSnapshot} compact={compact} onShowPlayheads={() => {
              const edge = project.edges.find((candidate) => candidate.target.nodeId === target.id && candidate.target.portId === 'features');
              const reader = project.nodes.find((candidate) => candidate.id === edge?.source.nodeId && candidate.kind === 'shapes.reader');
              if (!reader) return;
              store.pinView(reader.id, 'playheads');
              requestAnimationFrame(() => grid.current?.querySelector(`[data-widget-node="${CSS.escape(reader.id)}"].widget-playheads`)?.scrollIntoView({ behavior: 'auto', block: 'nearest' }));
            }} />
            : widget.kind === 'meter' ? <div className="level-widget"><div><span>Output level</span><output>{meterValue > 0.0001 ? `${(20 * Math.log10(meterValue)).toFixed(1)} dBFS` : '−∞ dBFS'}</output></div>
              <meter min={0} max={1} value={meterValue} aria-label="Output level" /><div className="meter-ticks"><span>−60</span><span>−24</span><span>−12</span><span>0</span></div></div>
              : <p>Binding unavailable</p>}
          {arrange && <div className="widget-layout-actions">
            {([{ icon: ArrowLeft, x: -1, y: 0, label: 'left' }, { icon: ArrowRight, x: 1, y: 0, label: 'right' }, { icon: ArrowUp, x: 0, y: -1, label: 'up' }, { icon: ArrowDown, x: 0, y: 1, label: 'down' }]).map(({ icon: Icon, x, y, label }) => <button type="button" key={label} aria-label={`Move ${widget.id} ${label}`} onClick={() => store.moveWidget(widget.id, { ...widget.layout, x: Math.max(0, Math.min(project.performance.columns - widget.layout.w, widget.layout.x + x)), y: Math.max(0, Math.min(GRAPH_LIMITS.maxRows - widget.layout.h, widget.layout.y + y)) })}><Icon size={11} /></button>)}
            <button type="button" aria-label={`Shrink ${widget.id}`} onClick={() => store.moveWidget(widget.id, { ...widget.layout, w: Math.max(1, widget.layout.w - 1), h: Math.max(1, widget.layout.h - 1) })}><Minimize2 size={11} /></button>
            <button type="button" className="widget-resize" aria-label={`Resize ${widget.id}`} onClick={(event) => { if (event.detail === 0) store.moveWidget(widget.id, { ...widget.layout, w: Math.min(project.performance.columns - widget.layout.x, widget.layout.w + 1), h: Math.min(GRAPH_LIMITS.maxRows - widget.layout.y, widget.layout.h + 1) }); }} onPointerDown={(event) => begin(event, widget, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}><Maximize2 size={11} /></button>
          </div>}
        </section>;
      })}
    </div>
    {project.performance.widgets.length === 0 && <div className="surface-empty"><Grip size={28} /><h3>Make room to play.</h3><p>Pin a control or instrument view from any node to build your performance surface.</p></div>}
  </div>;
}

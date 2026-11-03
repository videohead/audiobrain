import { useId, useRef, useState, type PointerEvent } from 'react';
import { getOperatorDefinition, getParameter, type GraphDocument, type GraphNode, type ParameterEntry } from '../graph';
import type { NodeSnapshot } from '../runtime/AudioBrainRuntime';
import { useProjectStore } from '../store';
import { shapesHeadColor } from './shapesPresentation';
import { pointHitsShape, shapePhaseAdjustment, shapePhaseAtPoint, wrapShapePhase, type ViewPoint } from './shapesGestures';
import './InstrumentView.css';

interface InstrumentViewProps { node: GraphNode; project: GraphDocument; snapshot?: NodeSnapshot; compact?: boolean; onShowPlayheads?: () => void }
type NumericParameter = Extract<ParameterEntry, { type: 'number' }>;
interface BoundParameter { target: GraphNode; parameter: NumericParameter; value: number; wired: boolean }
type ShapeTool = 'playheads' | 'move' | 'rotation' | 'curvature';
type ViewDrag = { pointerId: number; start: ViewPoint; x: number; mode: ShapeTool | 'linear' | 'scrub'; binding?: BoundParameter; second?: BoundParameter; headIndex?: number; startAngle?: number };

export function InstrumentView({ node, project, snapshot, compact, onShowPlayheads }: InstrumentViewProps) {
  const store = useProjectStore();
  const unique = useId().replaceAll(':', '');
  const drag = useRef<ViewDrag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<ShapeTool>('playheads');
  const geometry = snapshot?.geometry;
  const points = new Map(geometry?.points.map((point) => [point.id, point]) ?? []);
  const features = snapshot?.features ?? [];
  const isShape = node.kind === 'view.shapes';
  const isGraph = node.kind === 'view.graph';
  const resolveParameter = (targetId?: string, parameterId?: string): BoundParameter | undefined => {
    const target = project.nodes.find((candidate) => candidate.id === targetId);
    const parameter = target && getParameter(getOperatorDefinition(target.kind), parameterId);
    if (!target || !parameter || parameter.type !== 'number') return undefined;
    return { target, parameter, value: Number(target.params[parameter.id] ?? parameter.defaultValue), wired: project.edges.some((edge) => edge.target.nodeId === target.id && edge.target.portId === parameter.id) };
  };
  const resolveIntent = (id?: string) => {
    const binding = id ? node.viewBindings?.[id] : Object.values(node.viewBindings ?? {})[0];
    return resolveParameter(binding?.nodePath[0], binding?.paramId);
  };
  const bound = resolveIntent(isShape ? tool === 'playheads' ? 'scrub' : tool === 'move' ? 'moveX' : tool : undefined);
  const numeric = bound?.parameter;
  const value = bound?.value ?? 0;
  const wired = isShape && tool === 'move' ? Boolean(bound?.wired && resolveIntent('moveY')?.wired) : bound?.wired ?? false;
  const readerEdge = project.edges.find((edge) => edge.target.nodeId === node.id && edge.target.portId === 'features');
  const readerNode = project.nodes.find((candidate) => candidate.id === readerEdge?.source.nodeId && candidate.kind === 'shapes.reader');
  const token = `view:${node.id}:${unique}`;
  const label = node.label ?? (isShape ? 'Shape contour' : isGraph ? 'Graph topology' : 'L-System branches');
  const setValue = (binding: BoundParameter | undefined, next: number) => {
    if (!binding || binding.wired) return;
    const { parameter, target } = binding;
    const snapped = parameter.min + Math.round((next - parameter.min) / parameter.step) * parameter.step;
    store.setNodeParam(target.id, parameter.id, Math.min(parameter.max, Math.max(parameter.min, Number(snapped.toFixed(6)))));
  };
  const release = () => { drag.current = null; store.endGesture(token); };
  const pointerPoint = (event: { clientX: number; clientY: number }): ViewPoint => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: -local.y };
  };
  const moveHead = (headIndex: number, point: ViewPoint) => {
    const reader = snapshot?.readers?.find((candidate) => candidate.headIndex === headIndex);
    const binding = resolveParameter(readerNode?.id, `head${headIndex + 1}Phase`);
    if (!geometry || !reader || !binding || binding.wired) return;
    const phase = shapePhaseAtPoint(geometry, reader, point);
    const pingpong = readerNode?.params.motion === 'pingpong';
    setValue(binding, shapePhaseAdjustment(reader, binding.value, phase, pingpong));
  };
  const scrubHeads = (binding: BoundParameter, point: ViewPoint) => {
    const first = snapshot?.readers?.find((reader) => reader.headIndex === 0);
    const headPhase = resolveParameter(readerNode?.id, 'head1Phase')?.value ?? 0;
    const period = readerNode?.params.motion === 'pingpong' ? 2 : 1;
    const desired = Math.max(0, Math.min(1, (point.x + 1.25) / 2.5)) * period;
    const clock = first ? first.travel - binding.value - headPhase : 0;
    setValue(binding, ((desired - clock) % period + period) % period);
  };
  const beginHead = (event: PointerEvent<SVGGElement>, headIndex: number) => {
    if (tool !== 'playheads' || resolveParameter(readerNode?.id, `head${headIndex + 1}Phase`)?.wired) return;
    event.preventDefault(); event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: pointerPoint(event), x: event.clientX, mode: 'playheads', headIndex };
    store.beginGesture(token);
  };
  const sliderRole = numeric && (!isShape || tool === 'curvature' || tool === 'rotation');
  const caption = !isShape ? numeric ? `Drag · ${numeric.label.toLowerCase()}` : 'Live view'
    : tool === 'playheads' ? 'Drag a head · shape scrubs · outside rotates' : tool === 'move' ? 'Drag shape · arrow keys move' : `Drag · ${tool === 'rotation' ? 'rotate shape' : 'curvature'}`;
  return <div className={`instrument-view ${isShape ? 'shape-instrument-view' : ''} ${compact ? 'compact' : ''}`}>
    {isShape && <div className="shape-view-tools" role="toolbar" aria-label="Shape gesture">
      {(['playheads', 'move', 'rotation', 'curvature'] as const).map((candidate) => <button type="button" key={candidate} aria-pressed={tool === candidate}
        disabled={candidate !== 'playheads' && !resolveIntent(candidate === 'move' ? 'moveX' : candidate)}
        onClick={() => { release(); setTool(candidate); }}>{candidate === 'rotation' ? 'Rotate' : candidate.charAt(0).toUpperCase() + candidate.slice(1)}</button>)}
      {readerNode && onShowPlayheads && <button type="button" className="show-playhead-controls" aria-label="Show playhead controls" onClick={onShowPlayheads}>Controls ↓</button>}
    </div>}
    <svg ref={svgRef} viewBox="-1.25 -1.25 2.5 2.5" preserveAspectRatio="xMidYMid meet"
      aria-label={sliderRole ? `${label}, drag to change ${numeric.label}` : `${label}${isShape ? `, ${tool} tool` : ''}`}
      role={sliderRole ? 'slider' : isShape ? 'group' : 'img'} tabIndex={numeric || isShape ? 0 : undefined} aria-disabled={wired || undefined}
      aria-valuemin={sliderRole ? numeric.min : undefined} aria-valuemax={sliderRole ? numeric.max : undefined} aria-valuenow={sliderRole ? value : undefined} aria-valuetext={sliderRole ? `${value}${numeric.unit ? ` ${numeric.unit}` : ''}` : undefined}
      onPointerDown={(event) => {
        const point = pointerPoint(event);
        let mode: ViewDrag['mode'] = isShape ? tool : 'linear';
        if (isShape && tool === 'playheads') mode = geometry && pointHitsShape(geometry, point) ? 'scrub' : 'rotation';
        const binding = isShape ? resolveIntent(mode === 'scrub' ? 'scrub' : mode === 'move' ? 'moveX' : mode) : bound;
        if (!binding || (binding.wired && (mode !== 'move' || resolveIntent('moveY')?.wired))) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const origin = geometry?.origin ?? { x: 0, y: 0 };
        drag.current = { x: event.clientX, start: point, binding, second: resolveIntent('moveY'), mode, pointerId: event.pointerId, startAngle: Math.atan2(point.y - origin.y, point.x - origin.x) };
        store.beginGesture(token);
        if (mode === 'scrub') scrubHeads(binding, point);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const point = pointerPoint(event);
        if (current.headIndex !== undefined) { moveHead(current.headIndex, point); return; }
        const binding = current.binding;
        if (!binding || (binding.wired && current.mode !== 'move')) return;
        if (current.mode === 'move') {
          setValue(binding, binding.value + point.x - current.start.x);
          setValue(current.second, (current.second?.value ?? 0) + point.y - current.start.y);
        } else if (current.mode === 'rotation') {
          const origin = geometry?.origin ?? { x: 0, y: 0 };
          const angle = Math.atan2(point.y - origin.y, point.x - origin.x) - (current.startAngle ?? 0);
          // Canonical source rotation increases clockwise in its canvas coordinates.
          setValue(binding, ((binding.value - Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI + 180) % 360 + 360) % 360 - 180);
        } else if (current.mode === 'scrub') {
          const currentBinding = resolveIntent('scrub');
          if (currentBinding) scrubHeads(currentBinding, point);
        }
        else setValue(binding, binding.value + (event.clientX - current.x) / Math.max(event.currentTarget.getBoundingClientRect().width, 1) * (binding.parameter.max - binding.parameter.min));
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
      onKeyDown={(event) => {
        if (!bound || wired || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); store.beginGesture(token);
        const binding = isShape && tool === 'move' && ['ArrowUp', 'ArrowDown'].includes(event.key) ? resolveIntent('moveY') : bound;
        if (!binding) return;
        setValue(binding, event.key === 'Home' ? binding.parameter.min : event.key === 'End' ? binding.parameter.max : binding.value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1) * binding.parameter.step * (event.shiftKey ? 10 : 1));
      }} onKeyUp={() => store.endGesture(token)}>
      <defs>
        <pattern id={`grid-${unique}`} width="0.25" height="0.25" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.006" fill="#36404a" /></pattern>
        <radialGradient id={`glow-${unique}`}><stop offset="0" stopColor={isShape ? '#69f2bd' : '#65ddff'} stopOpacity=".08" /><stop offset="1" stopColor="#080a0f" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="-1.3" y="-1.3" width="2.6" height="2.6" fill={`url(#grid-${unique})`} />
      <circle r="1.15" fill={`url(#glow-${unique})`} />
      <path d="M-1.1 0H1.1 M0-1.1V1.1" stroke="#333b45" strokeWidth=".004" strokeDasharray=".02 .04" />
      {isShape && snapshot?.readers?.map((reader) => <g key={reader.id} data-testid={`reader-${reader.headIndex + 1}`}
        onPointerDown={(event) => beginHead(event, reader.headIndex)}
        data-reader-type={reader.type} data-phase={reader.phase} data-direction={reader.direction}>
        <title>{`Playhead ${reader.headIndex + 1}: ${reader.type === 'points' ? 'point' : reader.type}, ${reader.direction === -1 ? 'reverse' : 'forward'}`}</title>
        {reader.type !== 'points' && reader.start && reader.end && <><line data-reader-glyph={reader.type}
          x1={reader.start.x} y1={-reader.start.y} x2={reader.end.x} y2={-reader.end.y}
          stroke={shapesHeadColor(reader.headIndex)} strokeWidth=".008" strokeOpacity=".55" strokeDasharray=".025 .035" />
          <line x1={reader.start.x} y1={-reader.start.y} x2={reader.end.x} y2={-reader.end.y} stroke="transparent" strokeWidth=".065" cursor={tool === 'playheads' ? 'grab' : undefined} />
        </>}
      </g>)}
      {geometry?.segments.map((segment) => {
        const from = points.get(segment.from); const to = points.get(segment.to);
        if (!from || !to) return null;
        return <line key={segment.id} x1={from.x} y1={-from.y} x2={to.x} y2={-to.y}
          stroke={isShape ? '#e8c46b' : isGraph ? '#7089af' : '#8bd7b4'} strokeWidth={isShape ? '.01' : '.007'} strokeOpacity={isShape ? '.9' : '.7'} />;
      })}
      {isGraph && geometry?.points.map((point) => <g key={point.id}><circle cx={point.x} cy={-point.y} r=".045" fill="#141b29" stroke="#a88cff" strokeWidth=".009" /><circle cx={point.x} cy={-point.y} r=".013" fill="#e8e1ff" /></g>)}
      {features.slice(0, 128).map((feature, index) => {
        const color = isShape ? shapesHeadColor(feature.headIndex ?? index) : '#d8ff5f';
        const headIndex = feature.headIndex ?? index;
        const firstContact = feature.headIndex === undefined || features.findIndex((candidate) => candidate.headIndex === feature.headIndex) === index;
        const headBinding = isShape ? resolveParameter(readerNode?.id, `head${headIndex + 1}Phase`) : undefined;
        const interactive = isShape && firstContact && tool === 'playheads' && headBinding;
        const liveReader = snapshot?.readers?.find((reader) => reader.headIndex === headIndex);
        return <g key={`${feature.id}-${index}`} data-reader-contact={isShape ? headIndex + 1 : undefined}
          role={interactive ? 'slider' : undefined} tabIndex={interactive ? 0 : undefined} aria-disabled={interactive && headBinding.wired || undefined}
          aria-label={interactive ? `Playhead ${headIndex + 1} position` : undefined} aria-valuemin={interactive ? 0 : undefined} aria-valuemax={interactive ? 1 : undefined}
          aria-valuenow={interactive ? liveReader?.phase ?? 0 : undefined} aria-valuetext={interactive ? `${Math.round((liveReader?.phase ?? 0) * 100)}% of contour cycle` : undefined}
          onPointerDown={isShape ? (event) => beginHead(event, headIndex) : undefined}
          onKeyDown={(event) => {
            if (!interactive || headBinding.wired || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation(); store.beginGesture(token);
            const period = readerNode?.params.motion === 'pingpong' ? 2 : 1;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? period - .0001 : headBinding.value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1) * (event.shiftKey ? .05 : .01);
            setValue(headBinding, period === 1 ? wrapShapePhase(next) : ((next % 2) + 2) % 2);
          }} onKeyUp={() => store.endGesture(token)}>
          {isShape && <circle className="shape-head-hit-target" cx={feature.x} cy={-feature.y} r=".09" fill="transparent" cursor={tool === 'playheads' ? 'grab' : undefined} />}
          <circle cx={feature.x} cy={-feature.y} r=".075" fill={color} opacity=".13" />
          <circle cx={feature.x} cy={-feature.y} r=".025" fill={isShape ? '#fff3d6' : color} stroke={isShape ? color : undefined} strokeWidth={isShape ? '.009' : undefined} />
          {isShape && firstContact
            && <text x={feature.x + .047} y={-feature.y - .038} fill={color} stroke="#0b1018" strokeWidth=".014" paintOrder="stroke" fontSize=".067" fontFamily="ui-monospace, monospace" pointerEvents="none">{(feature.headIndex ?? index) + 1}</text>}
        </g>;
      })}
    </svg>
    <div className="view-caption"><span>{label}</span><span>{wired ? `${numeric?.label ?? 'Parameter'} controlled by wire` : caption}</span></div>
    {!geometry && <span className="view-empty">Connect geometry to this view</span>}
  </div>;
}

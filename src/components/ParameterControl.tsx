import { useId } from 'react';
import { Pin } from 'lucide-react';
import type { ParameterEntry } from '../graph';

type Parameter = ParameterEntry;
const choiceLabels: Record<string, string> = { continuous: 'Synth', notes: 'Notes', triggers: 'Drums / triggers' };

export interface ParameterControlProps {
  nodeId: string;
  parameter: Parameter;
  value: number | string | boolean;
  liveValue?: number;
  wired?: boolean;
  onChange: (value: number | string | boolean) => void;
  onBegin?: (token: string) => void;
  onEnd?: (token: string) => void;
  onPin?: () => void;
  compact?: boolean;
}

function formatValue(value: number | string | boolean, unit = ''): string {
  if (typeof value !== 'number') return String(value);
  const number = Math.abs(value) >= 100 ? value.toFixed(0) : Number(value.toFixed(3)).toString();
  return `${number}${unit ? ` ${unit}` : ''}`;
}

export function ParameterControl({ nodeId, parameter, value, liveValue, wired, onChange, onBegin, onEnd, onPin, compact }: ParameterControlProps) {
  const inputId = useId();
  const gesture = `${nodeId}:${parameter.id}:${inputId}`;
  const unit = parameter.type === 'number' ? parameter.unit ?? '' : '';
  return (
    <div className={`parameter-control nodrag nopan nowheel ${compact ? 'compact' : ''} ${wired ? 'is-wired' : ''}`}
      onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <div className="parameter-heading">
        <label htmlFor={inputId}>{parameter.label}</label>
        <output htmlFor={inputId}>{formatValue(value, unit)}</output>
        {onPin && <button className="pin-button" type="button" onClick={onPin} aria-label={`Add ${parameter.label} to performance`} title="Add to performance"><Pin size={12} /></button>}
      </div>
      {parameter.type === 'number' ? (
        <input id={inputId} type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={Number(value)}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onBegin?.(gesture); }}
          onPointerUp={() => onEnd?.(gesture)} onPointerCancel={() => onEnd?.(gesture)} onLostPointerCapture={() => onEnd?.(gesture)}
          onKeyDown={(event) => { event.stopPropagation(); if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) onBegin?.(gesture); }}
          onKeyUp={() => onEnd?.(gesture)} onBlur={() => onEnd?.(gesture)}
          onChange={(event) => onChange(Number(event.target.value))} />
      ) : parameter.type === 'select' ? (
        <select id={inputId} value={String(value)} onChange={(event) => onChange(event.target.value)}>
          {parameter.options.map((option) => <option key={option.value} value={option.value}>{parameter.id === 'playingMode' ? choiceLabels[option.value] ?? option.label : option.label}</option>)}
        </select>
      ) : parameter.type === 'boolean' ? (
        <input id={inputId} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
      ) : (
        <input id={inputId} className="text-parameter" type="text" value={String(value)} maxLength={parameter.maxLength}
          onFocus={() => onBegin?.(gesture)} onBlur={() => onEnd?.(gesture)}
          onKeyDown={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value)} />
      )}
      {wired && <span className="wired-hint">Wire controls live value{liveValue !== undefined ? ` · ${formatValue(liveValue, unit)}` : ''}. Saved value retained.</span>}
    </div>
  );
}

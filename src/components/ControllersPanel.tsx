import { useRef, useState, useSyncExternalStore } from 'react';
import { Download, Plus, Radio, Trash2, Upload } from 'lucide-react';
import { getOperatorDefinition, type GraphDocument, type ParameterDefinition, type ParameterValue } from '../graph';
import { controller, type ControlMapping } from '../control/controller';
import type { ControlAction } from '../control/actions';

const MAX_IMPORT_BYTES = 262144;
type Mode = 'absolute' | 'set' | 'toggle' | 'momentary';
type Command = 'play' | 'pause' | 'toggle' | 'reset' | 'panic';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** http(s) origin of the relay, derived from the Companion bridge URL (ws -> http, wss -> https). */
function relayBaseUrl(bridgeUrl: string): string {
  try {
    const url = new URL(bridgeUrl);
    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
  } catch { return 'http://127.0.0.1:8934'; }
}

function ValueInput({ label, parameter, value, onChange }: { label: string; parameter: ParameterDefinition; value: ParameterValue; onChange: (value: ParameterValue) => void }) {
  if (parameter.type === 'enum') {
    return <label className="connection-field">{label}<select value={String(value)} onChange={(event) => onChange(event.target.value)}>{parameter.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>;
  }
  if (parameter.type === 'text') return null;
  return <label className="connection-field">{label}<input type="number" min={parameter.min} max={parameter.max} step={parameter.step} value={Number(value)} onChange={(event) => onChange(event.target.valueAsNumber)} required /></label>;
}

export function ControllersPanel({ project }: { project: GraphDocument }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'parameter' | 'transport'>('parameter');
  const [nodeId, setNodeId] = useState('');
  const [paramId, setParamId] = useState('');
  const [mode, setMode] = useState<Mode>('absolute');
  const [low, setLow] = useState<ParameterValue>(0);
  const [high, setHigh] = useState<ParameterValue>(1);
  const [command, setCommand] = useState<Command>('toggle');
  const [address, setAddress] = useState('ws://127.0.0.1:8934/control-ws');
  const [token, setToken] = useState('');
  const node = project.nodes.find((candidate) => candidate.id === nodeId);
  const parameters = node ? getOperatorDefinition(node.kind).params.filter((candidate) => candidate.type !== 'text') : [];
  const parameter = parameters.find((candidate) => candidate.id === paramId);

  const selectParameter = (next: string) => {
    setParamId(next);
    const selected = parameters.find((candidate) => candidate.id === next);
    if (!selected) return;
    if (selected.type === 'enum') { setLow(selected.choices[0] ?? ''); setHigh(selected.choices.at(-1) ?? ''); setMode('toggle'); }
    else { setLow(selected.min); setHigh(selected.max); setMode('absolute'); }
  };
  const save = () => {
    const action: ControlAction = type === 'transport' ? { type, command } : { type, nodeId, paramId, mode, low, high };
    controller.save({ id, name, action });
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setNotice('That file is too large to be a mappings file.'); return; }
    const result = controller.importMappings(await file.text());
    setNotice(result ? `Imported ${result.imported} mapping${result.imported === 1 ? '' : 's'}. Controllers are disarmed.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}` : null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return <div className="connections-content controllers-content">
    <p className="connection-note controllers-incomplete" role="note"><strong>Incomplete.</strong> This panel is a provisional interface for the shared controller in <code>../brain-control</code>. Centralized control and remote learn are still being researched, so expect this UI to change. See <code>brain-control/docs/CENTRAL_CONTROL.md</code>.</p>
    <div className="connection-status"><label><input type="checkbox" checked={state.armed} onChange={(event) => controller.arm(event.target.checked)} /> Armed</label>
      <span role="status">MIDI: {state.midiState} · Companion: {state.bridgeState}</span></div>
    {state.error ? <p className="connection-error" role="alert">{state.error}</p> : null}
    <p className="connection-note">Controllers change node parameters and the transport. They do nothing until armed, and are disarmed when you switch windows or change the graph.</p>
    <div className="connection-card"><h3>MIDI</h3>
      <button className="secondary-button" onClick={() => { if (state.midiState === 'Enabled' || state.midiState === 'Requesting') controller.disableMidi(); else void controller.enableMidi(); }}><Radio size={14} />{state.midiState === 'Enabled' || state.midiState === 'Requesting' ? 'Disable controller MIDI' : 'Enable controller MIDI'}</button>
      {state.devices.length > 0 ? <p>Inputs: {state.devices.map((device) => device.name).join(', ')}</p> : null}
      {state.learning ? <p role="status">Learning: {state.learning} <button className="subtle-button" onClick={() => controller.learn(null)}>Cancel</button></p> : null}
    </div>
    <div className="connection-card"><h3>Bitfocus Companion / Stream Deck</h3>
      <form onSubmit={(event) => { event.preventDefault(); controller.connect(address, token); setToken(''); }}>
        <label className="connection-field">Relay URL<input type="url" value={address} onChange={(event) => setAddress(event.target.value)} required /></label>
        <label className="connection-field">Relay key<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label>
        <button type="submit" className="secondary-button" disabled={state.bridgeState !== 'Disconnected'}>Connect</button>
        <button type="button" className="subtle-button" onClick={controller.disconnect} disabled={state.bridgeState === 'Disconnected'}>Disconnect</button>
      </form>
    </div>
    <div className="connection-card"><h3>Mappings</h3>
      <div className="controller-actions">
        <button type="button" className="secondary-button" disabled={state.mappings.length === 0} onClick={() => { download('audiobrain-mappings.json', controller.exportMappings(__APP_VERSION__)); setNotice(null); }}><Download size={14} />Export mappings</button>
        <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={14} />Import mappings</button>
        <button type="button" className="secondary-button" disabled={state.mappings.length === 0} onClick={() => { download('audiobrain-remote-requests.json', controller.exportRemoteRequests(relayBaseUrl(address))); setNotice(null); }}><Download size={14} />Companion requests</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="Import mappings file" onChange={(event) => { void importFile(event.target.files?.[0]); }} />
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {state.mappings.length === 0 ? <p>No mappings yet.</p> : state.mappings.map((mapping) => <MappingRow key={mapping.id} mapping={mapping} midiEnabled={state.midiState === 'Enabled'} />)}
    </div>
    <div className="connection-card"><h3>Add / replace mapping</h3>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label className="connection-field">Mapping ID<input value={id} pattern="[a-zA-Z0-9_-]{1,64}" maxLength={64} onChange={(event) => setId(event.target.value)} required /></label>
        <label className="connection-field">Name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="connection-field">Action<select value={type} onChange={(event) => { setType(event.target.value as typeof type); setNodeId(''); setParamId(''); }}><option value="parameter">Parameter</option><option value="transport">Transport</option></select></label>
        {type === 'transport' ? <label className="connection-field">Transport command<select value={command} onChange={(event) => setCommand(event.target.value as Command)}>
          {(['play', 'pause', 'toggle', 'reset', 'panic'] as const).map((choice) => <option key={choice} value={choice}>{choice === 'panic' ? 'panic (stop all sound)' : choice}</option>)}</select></label> : <>
          <label className="connection-field">Node<select value={nodeId} onChange={(event) => { setNodeId(event.target.value); setParamId(''); }} required><option value="">Select node</option>
            {project.nodes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label ?? candidate.id} ({candidate.kind})</option>)}</select></label>
          <label className="connection-field">Parameter<select value={paramId} onChange={(event) => selectParameter(event.target.value)} required><option value="">Select parameter</option>
            {parameters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label>
          <label className="connection-field">Behavior<select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
            {parameter && parameter.type !== 'enum' ? <option value="absolute">Absolute value</option> : null}<option value="set">Set on press</option><option value="toggle">Toggle</option><option value="momentary">Momentary</option></select></label>
          {parameter ? <><ValueInput label="Low / off" parameter={parameter} value={low} onChange={setLow} /><ValueInput label="High / on" parameter={parameter} value={high} onChange={setHigh} /></> : null}
        </>}
        <button type="submit" className="secondary-button"><Plus size={14} />Save mapping</button>
      </form>
    </div>
  </div>;
}

function MappingRow({ mapping, midiEnabled }: { mapping: ControlMapping; midiEnabled: boolean }) {
  const action = mapping.action.type === 'transport' ? mapping.action.command : `${mapping.action.nodeId} · ${mapping.action.paramId} · ${mapping.action.mode}`;
  return <div className="controller-mapping"><div><strong>{mapping.name}</strong> <code>{mapping.id}</code> <span>{action}</span><br />
    <span>{mapping.midi ? `${mapping.midi.deviceName ?? (mapping.midi.deviceId || 'unassigned')} · Ch ${mapping.midi.channel} · ${mapping.midi.type.toUpperCase()} ${mapping.midi.number}` : 'No MIDI binding'}</span>
    {mapping.osc ? <span>{` · OSC ${mapping.osc.address} (saved; AudioBrain receives OSC through OSC Input nodes)`}</span> : null}</div>
    <button className="secondary-button" disabled={!midiEnabled} onClick={() => controller.learn(mapping.id)}>Learn</button>
    <button className="icon-button" title={`Delete ${mapping.name}`} aria-label={`Delete ${mapping.name}`} onClick={() => controller.remove(mapping.id)}><Trash2 size={14} /></button></div>;
}

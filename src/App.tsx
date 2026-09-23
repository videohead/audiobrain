import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Activity, ArrowUpRight, AudioLines, ChevronDown, CircleHelp, Copy, Download, Expand, FolderOpen, FilePlus2, Grip, LayoutGrid, Network, Pause, Pencil, Pin, Play, Plus, Radio, Redo2, RotateCcw, Search, Square, Trash2, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { GRAPH_LIMITS, OPERATOR_DEFINITIONS, PRESETS, getOperatorDefinition, createId, parseGraphDocument, serializeGraphDocument } from './graph';
import { projectStore, useProjectStore } from './store';
import { AudioBrainRuntime } from './runtime/AudioBrainRuntime';
import { GraphEditor } from './components/GraphEditor';
import { ParameterControl } from './components/ParameterControl';
import { RuntimeContext } from './components/RuntimeContext';
import { DeviceActions } from './components/DeviceActions';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { ViewBindings } from './components/ViewBindings';
import { nodePresentation } from './components/presentation';
import { PerformanceSurface } from './performance/PerformanceSurface';
import { ShapesPlayheadControls } from './performance/ShapesPlayheadControls';
import { PresetLibrary } from './components/PresetLibrary';
import { PRESET_LIBRARY_ENTRIES, buildPresetGraph, exportPresetDefinition, graphPresetDefinition, serializePresetDefinition, parsePresetDefinition, reconstructPreset } from './presets';

type Mode = 'graph' | 'arrange' | 'perform';

export function App() {
  const store = useProjectStore();
  const { undo, redo } = store;
  const [runtime] = useState(() => new AudioBrainRuntime());
  const snapshot = useSyncExternalStore((listener) => runtime.subscribe(listener), () => runtime.getSnapshot());
  const [mode, setMode] = useState<Mode>('graph');
  const [search, setSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'help' | 'connections' | 'rename' | 'presets' | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [presetBusyId, setPresetBusyId] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const presetRequest = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const fullscreen = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = store.document.nodes.find((node) => node.id === store.selection);
  const definition = selected && getOperatorDefinition(selected.kind);
  const run = (operation: Promise<unknown>) => { void operation.catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error))); };
  const closeDialog = () => { presetRequest.current += 1; setPresetBusyId(null); setPresetError(null); setDialog(null); };

  useEffect(() => { runtime.setProject(store.document); }, [runtime, store.document]);
  useEffect(() => () => { void runtime.dispose(); }, [runtime]);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [dialog]);

  const save = () => {
    const blob = new Blob([serializeGraphDocument(store.document)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = `${store.document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.audiobrain.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Project exported with its performance layout.');
  };

  const saveCurrentPreset = () => {
    try {
      const json = serializePresetDefinition(graphPresetDefinition(store.document));
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `${store.document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.audiobrain-preset.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setPresetError(error instanceof Error ? error.message : String(error)); }
  };

  const applyPreset = (id: string, action: 'load' | 'add') => {
    const request = ++presetRequest.current;
    setPresetBusyId(id); setPresetError(null);
    void buildPresetGraph(id).then(project => {
      if (request !== presetRequest.current) return;
      const applied = action === 'load' ? store.loadProject(project) : store.addInstrument(project);
      if (applied) { closeDialog(); setNotice(action === 'add' ? 'Instrument added with independent object identities and controls.' : null); }
      else setPresetError(projectStore.getState().error ?? 'This preset could not be applied to the current project.');
    }).catch((error: unknown) => { if (request === presetRequest.current) setPresetError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (request === presetRequest.current) setPresetBusyId(null); });
  };

  const exportPreset = (id: string) => {
    const request = ++presetRequest.current;
    setPresetBusyId(id); setPresetError(null);
    void exportPresetDefinition(id).then(definition => {
      if (request !== presetRequest.current) return;
      const blob = new Blob([definition], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${id.replace(/[^a-z0-9_.-]+/gi, '-')}.audiobrain-preset.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch((error: unknown) => { if (request === presetRequest.current) setPresetError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (request === presetRequest.current) setPresetBusyId(null); });
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const editable = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, button, [role="slider"], [contenteditable="true"]'));
      if (editable || dialogRef.current?.open) return;
      if (event.code === 'Space') { event.preventDefault(); runtime.setPlaying(!runtime.getSnapshot().playing); }
      if (event.key === 'Escape') { runtime.panic(); setMode('graph'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [runtime, undo, redo]);

  const filtered = OPERATOR_DEFINITIONS.filter((operator) => `${operator.title} ${operator.kind} ${operator.description}`.toLowerCase().includes(search.toLowerCase()));
  const categories = [...new Set(filtered.map((operator) => nodePresentation(operator.kind).category))];
  const audioOn = snapshot.audioState === 'running';
  const summary = store.error ?? snapshot.diagnostics[0] ?? notice;

  return <RuntimeContext.Provider value={runtime}><div className={`studio-shell mode-${mode}`} ref={fullscreen}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><AudioLines size={23} /></span><div><strong>AUDIOBRAIN</strong><span>MORPHAZOID INSTRUMENT TOOLKIT</span></div><span className="version-tag">{__APP_VERSION__}</span></div>
      <div className="mode-switch" role="group" aria-label="Workspace mode">
        <button className={mode === 'graph' ? 'active' : ''} onClick={() => setMode('graph')}><Network size={14} /> Graph</button>
        <button className={mode === 'arrange' ? 'active' : ''} onClick={() => setMode('arrange')}><Grip size={14} /> Arrange</button>
        <button className={mode === 'perform' ? 'active' : ''} onClick={() => setMode('perform')}><LayoutGrid size={14} /> Perform</button>
      </div>
      <div className="topbar-actions"><button className="icon-button" title="New instrument" aria-label="New instrument" onClick={() => { store.loadProject({ documentType: 'audiobrain.project', schemaVersion: 1, id: createId('project'), title: 'Untitled Morphazoid', nodes: [], edges: [], performance: { version: 1, columns: 12, widgets: [] } }); setNotice(null); setMode('graph'); }}><FilePlus2 size={17} /></button><button className="icon-button" title="Import project" aria-label="Import project" onClick={() => importInput.current?.click()}><FolderOpen size={17} /></button>
        <button className="icon-button" title="Export project" aria-label="Export project" onClick={save}><Download size={17} /></button>
        <button className="icon-button" title="Help" aria-label="Help" onClick={() => setDialog('help')}><CircleHelp size={17} /></button>
      </div>
    </header>
    <div className="projectbar">
      <div className="preset-select"><span className="eyebrow">INSTRUMENT</span><label className="sr-only" htmlFor="preset-picker">Instrument preset</label><select id="preset-picker" value={PRESETS.some((preset) => preset.id === store.document.id) ? store.document.id : ''}
        onChange={(event) => { const preset = PRESETS.find((item) => item.id === event.target.value); if (preset) { store.loadProject(preset); store.selectNode(null); setNotice(null); } }}>
        {!PRESETS.some((preset) => preset.id === store.document.id) && <option value="">{store.document.title}</option>}
        {PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
      </select><ChevronDown size={13} /></div>
      <div className="project-actions"><button className="subtle-button" onClick={() => setDialog('presets')}><FolderOpen size={14} /> Presets</button><button className="icon-button" aria-label="Rename instrument" title="Rename instrument" onClick={() => { setDraftTitle(store.document.title); setDialog('rename'); }}><Pencil size={14} /></button><button className="icon-button" aria-label="Undo" disabled={!store.canUndo} onClick={store.undo}><Undo2 size={15} /></button><button className="icon-button" aria-label="Redo" disabled={!store.canRedo} onClick={store.redo}><Redo2 size={15} /></button><span className="saved-label">{store.persistenceState === 'saved' ? 'Saved locally' : store.persistenceState === 'pending' ? 'Saving…' : 'Export to keep changes'}</span></div>
      <div className="transport">
        <button className={`play-button ${snapshot.playing ? 'playing' : ''}`} aria-label={snapshot.playing ? 'Pause transport' : 'Play transport'} onClick={() => runtime.setPlaying(!snapshot.playing)}>{snapshot.playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="icon-button" aria-label="Reset transport" title="Reset transport" onClick={() => runtime.reset()}><RotateCcw size={14} /></button>
        <output className="transport-time">{Math.floor(snapshot.time / 60).toString().padStart(2, '0')}:{Math.floor(snapshot.time % 60).toString().padStart(2, '0')}<span> / {snapshot.beat.toFixed(1)} beats</span></output>
        <button className={`audio-button ${audioOn ? 'enabled' : ''}`} onClick={() => run(audioOn ? runtime.stopAudio() : runtime.startAudio())} disabled={snapshot.audioState === 'starting'}>
          {audioOn ? <Volume2 size={15} /> : <VolumeX size={15} />}{audioOn ? 'Audio on' : snapshot.audioState === 'starting' ? 'Starting…' : 'Enable audio'}</button>
        <button className="panic-button" onClick={() => runtime.panic()} aria-label="Panic — stop all sound" title="Panic — stop all sound"><Square size={13} /></button>
      </div>
    </div>
    <main className="workspace">
      {mode === 'graph' && <>
        {libraryOpen && <aside className="operator-library"><header><span className="eyebrow">NODE LIBRARY</span><span className="count-badge">{OPERATOR_DEFINITIONS.length}</span></header>
          <div className="library-search"><Search size={14} /><input aria-label="Search nodes" placeholder="Find a node…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="library-content">{categories.map((category) => <section key={category}><h2>{category}</h2>{filtered.filter((operator) => nodePresentation(operator.kind).category === category).map((operator) => {
            const meta = nodePresentation(operator.kind); const Icon = meta.icon;
            return <button type="button" key={operator.kind} className="library-node" title={operator.description} onClick={() => store.addNode(operator.kind)} style={{ '--node-accent': meta.color } as React.CSSProperties}><Icon size={15} /><span>{operator.title}</span><Plus size={12} /></button>;
          })}</section>)}{filtered.length === 0 && <p className="empty-search">No matching nodes.</p>}</div>
          <footer><span className="morph-symbol">m</span><p>Strange ideas.<br /><strong>Connected sounds.</strong></p></footer>
        </aside>}
        <section className="graph-panel"><div className="panel-heading"><button className="subtle-button" onClick={() => setLibraryOpen(!libraryOpen)}><Network size={14} /> Signal graph</button><span>{store.document.nodes.length} nodes · {store.document.edges.length} connections</span><button className="icon-button" aria-label="Show node library" onClick={() => setLibraryOpen(!libraryOpen)}><Plus size={14} /></button></div>
          <GraphEditor key={store.document.id} />
        </section>
      </>}
      <section className={`performance-panel ${mode !== 'graph' ? 'expanded' : ''}`}>
        <div className="panel-heading"><span className="panel-title"><Activity size={14} /> Performance</span><span className="live-badge"><i className={snapshot.playing ? 'live' : ''} /> {snapshot.playing ? 'RUNNING' : 'READY'}</span><button className="icon-button" aria-label="Fullscreen performance" title="Fullscreen performance" onClick={() => { setMode('perform'); if (fullscreen.current?.requestFullscreen) run(fullscreen.current.requestFullscreen()); }}><Expand size={14} /></button></div>
        <div className="performance-heading"><span className="eyebrow">{mode === 'arrange' ? 'YOUR PERFORMANCE LAYOUT' : 'GEOMETRY → MUSIC → SOUND'}</span><h1>{store.document.title}</h1><p>{mode === 'arrange' ? 'Give your instrument its own space.' : 'A graphic you can play. A graph you can change.'}</p></div>
        <PerformanceSurface snapshot={snapshot} arrange={mode === 'arrange'} compact={mode === 'graph'} />
        {mode === 'graph' && selected && definition && <div className="inspector"><header><div><span className="eyebrow">INSPECTOR</span><h2>{selected.label ?? definition.title}</h2></div><button className="icon-button" aria-label={`Duplicate ${selected.label ?? definition.title}`} title="Duplicate object" onClick={() => store.duplicateNode(selected.id)}><Copy size={14} /></button><button className="icon-button danger" aria-label={`Delete ${definition.title}`} onClick={() => store.removeNode(selected.id)}><Trash2 size={14} /></button></header><p>{definition.description}</p><label className="object-identity">Object name<input aria-label="Object name" key={`${selected.id}:${selected.label ?? ''}`} defaultValue={selected.label ?? ''} placeholder={definition.title} maxLength={96} onBlur={event => store.renameNode(selected.id, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><code>Stable ID: {selected.id}</code></label><DeviceActions kind={selected.kind} />
          {selected.kind === 'shapes.reader' ? <ShapesPlayheadControls node={selected} project={store.document} snapshot={snapshot.nodes[selected.id]} onPin={() => store.pinView(selected.id, 'playheads')} /> : definition.params.map((parameter) => <ParameterControl key={parameter.id} nodeId={selected.id} parameter={parameter} value={selected.params[parameter.id] ?? parameter.default} liveValue={snapshot.nodes[selected.id]?.params?.[parameter.id]}
            onChange={(value) => store.setParameter(selected.id, parameter.id, value)} onBegin={store.beginGesture} onEnd={store.endGesture}
            wired={store.document.edges.some((edge) => edge.target.nodeId === selected.id && edge.target.portId === parameter.id)} onPin={() => store.pinParameter(selected.id, parameter.id)} />)}
          <ViewBindings node={selected} /><div className="inspector-ports">{definition.inputs.map((port) => <span key={port.id}>{port.label}<code>{port.type}</code></span>)}</div>
        </div>}
        {mode === 'graph' && !selected && <div className="performance-tip"><Pin size={14} /><p>Pin any node control to this surface.<br /><button onClick={() => setMode('arrange')}>Arrange your instrument <ArrowUpRight size={12} /></button></p></div>}
      </section>
    </main>
    {summary && <div className="notice" role={store.error ? 'alert' : 'status'}><span>{summary}</span><button aria-label="Dismiss message" onClick={() => { setNotice(null); store.clearError(); }}><X size={13} /></button></div>}
    <footer className="statusbar"><span><i className={`status-dot ${audioOn ? 'live' : ''}`} />{audioOn ? 'Audio engine running' : 'Audio off'}<span className="status-detail"> · {snapshot.voiceCount} voices</span></span><span className="local-status">LOCAL FIRST · NO ACCOUNT NEEDED</span><button onClick={() => setDialog('connections')}><Radio size={12} /> Connections</button></footer>
    <input ref={importInput} type="file" accept=".json,application/json" className="sr-only" aria-label="Import AudioBrain JSON" onChange={(event) => {
      const file = event.target.files?.[0]; if (!file) return;
      if (file.size > GRAPH_LIMITS.maxJsonBytes) { setNotice('Project exceeds the 1 MiB limit.'); event.target.value = ''; return; }
      run(file.text().then((text) => { const value = JSON.parse(text) as unknown; const isPreset = value !== null && typeof value === 'object' && 'documentType' in value && value.documentType === 'audiobrain.instrument-preset'; const project = isPreset ? reconstructPreset(parsePresetDefinition(value)) : parseGraphDocument(value); if (store.loadProject(project)) setNotice(isPreset ? 'Preset rebuilt with its saved settings and layout.' : 'Project imported.'); })); event.target.value = '';
    }} />
    <dialog className={`app-dialog${dialog === 'presets' ? ' preset-library-dialog' : ''}`} ref={dialogRef} onCancel={closeDialog} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <header><h2>{dialog === 'help' ? 'A little strange. Very playable.' : dialog === 'rename' ? 'Name your instrument' : dialog === 'presets' ? 'Morphazoid presets' : 'Connections'}</h2><button className="icon-button" aria-label="Close dialog" onClick={closeDialog}><X size={18} /></button></header>
      {dialog === 'help' ? <div className="help-content"><p>AudioBrain turns Morphazoid instruments into connected, reusable parts.</p><ol><li>Open Presets to load Shapes, L-Systems, or Graphs, or add another independent instrument.</li><li>Enable audio, then press Play. Audio and transport are separate.</li><li>Drag the instrument graphic or move a slider. Each gesture changes the same controls shown in the graph.</li><li>Pin a node control, choose Arrange, and move or resize it. Perform locks the layout.</li><li>Connect compatible ports to change the instrument. Select an edge and press Delete to disconnect it.</li></ol><p>Shapes Playheads controls choose point, line, or radar readers, count, direction, and relative positions. In Graph, select a Shapes Reader and pin Playheads if your saved layout does not yet include it. Curvature defaults to zero in new presets; your saved values are preserved.</p><p>Select any node to name or duplicate it in the Inspector. Stable IDs keep cables, controls, and saved state attached to the right object.</p><p>Space plays or pauses outside a control. Escape stops sounding voices. Your project saves in this browser; Export makes a portable copy with its performance layout.</p><p>Microphone and MIDI require their own explicit enable action. OSC needs a compatible WebSocket gateway. These device connections are never stored in a project.</p><a href={`${import.meta.env.BASE_URL}storybook/`} target="_blank" rel="noreferrer">Explore the component catalog <ArrowUpRight size={13} /></a></div>
        : null}
      {dialog === 'presets' && <><div className="preset-library-tools"><button className="secondary-button" onClick={saveCurrentPreset}><Download size={13} />Export current as preset</button><button className="secondary-button" onClick={() => { closeDialog(); importInput.current?.click(); }}><FolderOpen size={13} />Import preset or project</button></div><PresetLibrary entries={PRESET_LIBRARY_ENTRIES} onLoad={id => applyPreset(id, 'load')} onAdd={id => applyPreset(id, 'add')} onExport={exportPreset} busyId={presetBusyId} error={presetError} /></>}
      {dialog === 'rename' && <form className="help-content" onSubmit={event => { event.preventDefault(); if (draftTitle.trim()) { store.setTitle(draftTitle.trim()); setDialog(null); } }}><label className="connection-field">Instrument name<input value={draftTitle} onChange={event => setDraftTitle(event.target.value)} maxLength={96} required /></label><button className="secondary-button" type="submit" disabled={!draftTitle.trim()}>Save name</button></form>}
      <div hidden={dialog !== 'connections'}><ConnectionsPanel runtime={runtime} snapshot={snapshot} project={store.document} /></div>
    </dialog>
  </div></RuntimeContext.Provider>;
}

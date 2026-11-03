import { createAutosave, type PersistenceState } from '@brain/control/store/autosave';
import { createHistory } from '@brain/control/store/history';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  PRESETS, GRAPH_LIMITS, cloneGraphDocument, createId, createNode, getOperatorDefinition, getParameter,
  normalizeNodeParams, normalizeParamValue, parseGraphDocument, parseWidgetLayout, serializeGraphDocument, tryCompileGraph, validateConnection,
  type ConnectionValidation, type GraphDocument, type GraphEndpoint, type GraphParams, type GraphPosition, type GraphParamValue, type WidgetLayout, type PerformanceWidget,
} from '../graph';

export const PROJECT_STORAGE_KEY = 'audiobrain.project.v1';
export type { PersistenceState } from '@brain/control/store/autosave';
export type ProjectImportResult = { ok: true } | { ok: false; error: string };
export interface ProjectStoreState {
  document: GraphDocument;
  revision: number;
  selectedNodeId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  error: string | null;
  persistenceState: PersistenceState;
  setNodeParam: (nodeId: string, paramId: string, value: GraphParamValue) => boolean;
  setTitle: (title: string) => void;
  addNode: (kind: string, position?: GraphPosition, params?: GraphParams) => string | null;
  duplicateNode: (id: string) => string | null;
  renameNode: (id: string, label: string) => void;
  deleteNode: (id: string) => void;
  connect: (source: GraphEndpoint, target: GraphEndpoint) => ConnectionValidation;
  disconnect: (edgeId: string) => void;
  moveNode: (id: string, position: GraphPosition) => void;
  selectNode: (id: string | null) => void;
  importProject: (value: unknown) => ProjectImportResult;
  exportProject: () => string;
  addInstrument: (document: GraphDocument) => boolean;
  undo: () => void;
  redo: () => void;
  beginGesture: (id?: string) => void;
  endGesture: (id?: string) => void;
  pinParameter: (nodeId: string, paramId: string) => void;
  pinView: (nodeId: string, viewId: string) => void;
  removeWidget: (id: string) => void;
  moveWidget: (id: string, layout: WidgetLayout) => void;
  bindView: (nodeId: string, intentId: string, targetNodeId: string, paramId: string) => void;
  clearError: () => void;
}
export interface ProjectStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface CreateProjectStoreOptions { initialDocument?: GraphDocument; storage?: ProjectStorage | null; autosaveDelayMs?: number; historyLimit?: number }
export interface ProjectStoreApi extends StoreApi<ProjectStoreState> { flushPersistence: () => boolean; dispose: () => void }
function browserStorage(): ProjectStorage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The project could not be updated'; }
export function createProjectStore(options: CreateProjectStoreOptions = {}): ProjectStoreApi {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const storageUnavailable = options.storage === undefined && typeof window !== 'undefined' && storage === null;
  let initial = cloneGraphDocument(options.initialDocument ?? PRESETS[0]!);
  let startupError: string | null = storageUnavailable ? 'Local autosave is unavailable. Export the project JSON to keep your work.' : null;
  if (storage && !options.initialDocument) {
    try {
      const saved = storage.getItem(PROJECT_STORAGE_KEY);
      if (saved) initial = parseGraphDocument(saved);
    } catch (error) { startupError = `Saved project could not be restored: ${errorMessage(error)}`; }
  }
  initial = parseGraphDocument(initial);
  // Shared engines from @brain/control: undo/redo with gesture grouping, and debounced autosave.
  const history = createHistory<GraphDocument>({ limit: options.historyLimit, clone: cloneGraphDocument });
  const autosave = createAutosave({
    save: storage ? () => { storage.setItem(PROJECT_STORAGE_KEY, serializeGraphDocument(store.getState().document)); } : null,
    delayMs: options.autosaveDelayMs ?? 300,
    onState: (persistenceState, message) => store.setState(message === undefined ? { persistenceState } : { persistenceState, error: `Autosave failed: ${message}` }),
  });
  const store = createStore<ProjectStoreState>()((set, get) => {
    const counts = () => history.counts();
    const diagnostic = (document: GraphDocument): string | null => { const result = tryCompileGraph(document); return result.ok ? null : result.issues.map(issue => issue.message).join('\n'); };
    const commit = (document: GraphDocument, selectedNodeId = get().selectedNodeId): boolean => {
      try {
        const normalized = parseGraphDocument(document);
        if (!history.commit(get().document, normalized)) return true;
        set({ document: normalized, revision: get().revision + 1, selectedNodeId, ...counts(), error: diagnostic(normalized), persistenceState: storage ? 'pending' : storageUnavailable ? 'failed' : 'saved' });
        autosave.schedule(); return true;
      } catch (error) { set({ error: errorMessage(error) }); return false; }
    };
    const pin = (nodeId: string, kind: PerformanceWidget['kind'], targetId: string) => {
      const document = cloneGraphDocument(get().document);
      if (document.performance.widgets.length >= GRAPH_LIMITS.maxWidgets) { set({ error: `At most ${GRAPH_LIMITS.maxWidgets} performance controls can be pinned` }); return; }
      const field = kind === 'param' ? 'paramId' : kind === 'view' ? 'viewId' : 'portId';
      if (document.performance.widgets.some(widget => widget.kind === kind && widget.target.nodePath[0] === nodeId && widget.target[field] === targetId)) return;
      const w = Math.min(kind === 'view' ? 8 : 4, document.performance.columns);
      const h = kind === 'view' ? 6 : 1;
      let layout: WidgetLayout | undefined;
      for (let y = 0; y <= GRAPH_LIMITS.maxRows - h && !layout; y++) {
        for (let x = 0; x <= document.performance.columns - w && !layout; x++) {
          if (document.performance.widgets.every(({ layout: b }) => !(x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y))) layout = { x, y, w, h };
        }
      }
      if (!layout) { set({ error: 'The performance surface is full' }); return; }
      document.performance.widgets.push({ id: createId('widget'), kind, target: { nodePath: [nodeId], [field]: targetId }, layout });
      commit(document);
    };
    return {
      document: initial, revision: 0, selectedNodeId: null, ...counts(), error: startupError ?? diagnostic(initial), persistenceState: startupError ? 'failed' : 'saved',
      setNodeParam(nodeId, paramId, value) {
        try {
          const document = cloneGraphDocument(get().document);
          const node = document.nodes.find(node => node.id === nodeId);
          if (!node) throw new Error(`Missing node ${nodeId}`);
          const parameter = getParameter(getOperatorDefinition(node.kind), paramId);
          if (!parameter) throw new Error(`Unknown parameter ${paramId}`);
          node.params[paramId] = normalizeParamValue(parameter, value, paramId);
          // Choosing an event mode in an older Synth patch also supplies its
          // missing optional event cable. Existing input ownership is preserved.
          if (node.kind === 'shapes.mapping' && paramId === 'playingMode' && value !== 'continuous') {
            for (const edge of [...document.edges]) {
              if (edge.source.nodeId !== nodeId || edge.source.portId !== 'voices' || edge.target.portId !== 'voices') continue;
              const bank = document.nodes.find(candidate => candidate.id === edge.target.nodeId && candidate.kind === 'voice.continuous');
              if (bank && !document.edges.some(candidate => candidate.target.nodeId === bank.id && candidate.target.portId === 'notes')) {
                document.edges.push({ id: createId('edge'), source: { nodeId, portId: 'notes' }, target: { nodeId: bank.id, portId: 'notes' } });
              }
            }
          }
          return commit(document);
        } catch (error) { set({ error: errorMessage(error) }); return false; }
      },
      setTitle(title) { commit({ ...get().document, title }); },
      addNode(kind, position, params) {
        try {
          const node = createNode(kind, position ?? { x: 100 + get().document.nodes.length * 24, y: 80 + get().document.nodes.length * 24 });
          if (params) node.params = normalizeNodeParams(kind, { ...node.params, ...params });
          return commit({ ...get().document, nodes: [...get().document.nodes, node] }, node.id) ? node.id : null;
        } catch (error) { set({ error: errorMessage(error) }); return null; }
      },
      duplicateNode(id) {
        const document = cloneGraphDocument(get().document);
        const source = document.nodes.find(node => node.id === id);
        if (!source) { set({ error: `Missing node ${id}` }); return null; }
        const copy = structuredClone(source);
        copy.id = createId('node');
        const base = source.label ?? getOperatorDefinition(source.kind).title;
        let suffix = 2;
        do { copy.label = `${base.slice(0, 85)} ${suffix++}`; } while (document.nodes.some(node => node.label === copy.label));
        copy.position = { x: source.position.x + 48, y: source.position.y + 48 };
        for (const binding of Object.values(copy.viewBindings ?? {})) if (binding.nodePath[0] === id) binding.nodePath = [copy.id];
        document.nodes.push(copy);
        for (const origin of document.presetOrigins ?? []) if (origin.nodeIds.includes(id)) origin.nodeIds.push(copy.id);
        return commit(document, copy.id) ? copy.id : null;
      },
      renameNode(id, label) {
        const document = cloneGraphDocument(get().document);
        const node = document.nodes.find(node => node.id === id);
        if (!node) { set({ error: `Missing node ${id}` }); return; }
        if (label.trim()) node.label = label.trim(); else delete node.label;
        commit(document);
      },
      deleteNode(id) {
        const document = cloneGraphDocument(get().document);
        document.nodes = document.nodes.filter(node => node.id !== id);
        document.edges = document.edges.filter(edge => edge.source.nodeId !== id && edge.target.nodeId !== id);
        document.performance.widgets = document.performance.widgets.filter(widget => widget.target.nodePath[0] !== id);
        if (document.presetOrigins) document.presetOrigins = document.presetOrigins.map(origin => ({ ...origin, nodeIds: origin.nodeIds.filter(nodeId => nodeId !== id) })).filter(origin => origin.nodeIds.length > 0);
        for (const node of document.nodes) if (node.viewBindings) for (const [intent, binding] of Object.entries(node.viewBindings)) if (binding.nodePath[0] === id) delete node.viewBindings[intent];
        commit(document, get().selectedNodeId === id ? null : get().selectedNodeId);
      },
      connect(source, target) {
        const validation = validateConnection(get().document, source, target);
        if (!validation.valid) { set({ error: validation.message ?? 'That connection is not valid.' }); return validation; }
        return commit({ ...get().document, edges: [...get().document.edges, { id: createId('edge'), source, target }] }) ? validation : { valid: false, message: get().error ?? 'The project could not be updated.' };
      },
      disconnect(edgeId) { commit({ ...get().document, edges: get().document.edges.filter(edge => edge.id !== edgeId) }); },
      moveNode(id, position) { commit({ ...get().document, nodes: get().document.nodes.map(node => node.id === id ? { ...node, position } : node) }); },
      selectNode(id) { set({ selectedNodeId: id === null || get().document.nodes.some(node => node.id === id) ? id : null }); },
      importProject(value) {
        history.endGesture();
        try {
          const document = parseGraphDocument(value);
          const result = tryCompileGraph(document);
          // An unfinished draft can omit an input; corrupt topology must not
          // replace the current instrument during an import.
          if (!result.ok) {
            const fatal = result.issues.filter(issue => issue.code !== 'required-input');
            if (fatal.length) throw new Error(fatal.map(issue => issue.message).join('\n'));
          }
          return commit(document, null) ? { ok: true } : { ok: false, error: get().error ?? 'The project could not be updated' };
        } catch (error) { const message = errorMessage(error); set({ error: message }); return { ok: false, error: message }; }
      },
      exportProject() { return serializeGraphDocument(get().document); },
      addInstrument(source) {
        try {
          const addition = parseGraphDocument(source);
          const document = cloneGraphDocument(get().document);
          const ids = new Map(addition.nodes.map(node => [node.id, createId('node')]));
          const y = document.nodes.reduce((max, node) => Math.max(max, node.position.y + 420), 0);
          const row = document.performance.widgets.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);
          const instance = document.nodes.filter(node => node.kind === addition.nodes[0]?.kind).length + 1;
          for (const node of addition.nodes) {
            node.id = ids.get(node.id)!;
            node.label = `${(node.label ?? getOperatorDefinition(node.kind).title).slice(0, 85)} ${instance}`;
            node.position.y += y;
            for (const binding of Object.values(node.viewBindings ?? {})) binding.nodePath = [ids.get(binding.nodePath[0])!];
          }
          for (const edge of addition.edges) { edge.id = createId('edge'); edge.source.nodeId = ids.get(edge.source.nodeId)!; edge.target.nodeId = ids.get(edge.target.nodeId)!; }
          for (const widget of addition.performance.widgets) { widget.id = createId('widget'); widget.target.nodePath = [ids.get(widget.target.nodePath[0])!]; widget.layout.y += row; }
          if (addition.presetOrigins?.length) document.presetOrigins = [...document.presetOrigins ?? [], ...addition.presetOrigins.map(origin => ({ ...origin, instanceId: createId('preset-instance'), nodeIds: origin.nodeIds.map(id => ids.get(id)!) }))];
          document.nodes.push(...addition.nodes); document.edges.push(...addition.edges); document.performance.widgets.push(...addition.performance.widgets);
          return commit(document, addition.nodes[0]?.id ?? null);
        } catch (error) { set({ error: errorMessage(error) }); return false; }
      },
      beginGesture(id) { history.beginGesture(get().document, id); },
      endGesture(id) { history.endGesture(id); },
      undo() { const document = history.undo(get().document); if (!document) return; set({ document, revision: get().revision + 1, selectedNodeId: null, ...counts(), error: diagnostic(document), persistenceState: storage ? 'pending' : storageUnavailable ? 'failed' : 'saved' }); autosave.schedule(); },
      redo() { const document = history.redo(get().document); if (!document) return; set({ document, revision: get().revision + 1, selectedNodeId: null, ...counts(), error: diagnostic(document), persistenceState: storage ? 'pending' : storageUnavailable ? 'failed' : 'saved' }); autosave.schedule(); },
      pinParameter(nodeId, paramId) { pin(nodeId, 'param', paramId); },
      pinView(nodeId, viewId) { pin(nodeId, 'view', viewId); },
      removeWidget(id) { commit({ ...get().document, performance: { ...get().document.performance, widgets: get().document.performance.widgets.filter(widget => widget.id !== id) } }); },
      moveWidget(id, layout) {
        try {
          const normalized = parseWidgetLayout(layout, get().document.performance.columns);
          commit({ ...get().document, performance: { ...get().document.performance, widgets: get().document.performance.widgets.map(widget => widget.id === id ? { ...widget, layout: normalized } : widget) } });
        } catch (error) { set({ error: errorMessage(error) }); }
      },
      bindView(nodeId, intentId, targetNodeId, paramId) {
        commit({ ...get().document, nodes: get().document.nodes.map(node => node.id === nodeId ? { ...node, viewBindings: { ...node.viewBindings, [intentId]: { nodePath: [targetNodeId], paramId } } } : node) });
      },
      clearError() { set({ error: null }); },
    };
  });
  return Object.assign(store, { flushPersistence: () => autosave.flush(), dispose: () => autosave.dispose() });
}
export const projectStore = createProjectStore();
export const useProjectStore = <T = ProjectStoreState>(selector: (state: ProjectStoreState) => T = (state) => state as unknown as T): T => useStore(projectStore, selector);

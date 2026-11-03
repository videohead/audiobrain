import type { ParamDefinition, ParamDefinitions, ParamValue, ParamValues } from '@brain/control/graph/params';
import type { PresetOrigin } from '../presets/types';

export type {
  BooleanParamDefinition,
  NumberParamDefinition,
  SelectParamDefinition,
  SelectParamOption,
  StringParamDefinition,
} from '@brain/control/graph/params';

export type GraphParamValue = ParamValue;
export type GraphParams = ParamValues;
export type OperatorParamDefinition = ParamDefinition;
export type GraphPosition = { x: number; y: number };
export type GraphEndpoint = { nodeId: string; portId: string };
export type ParameterTarget = { nodePath: [string]; paramId: string };
export interface GraphNode {
  id: string;
  label?: string;
  kind: string;
  position: GraphPosition;
  params: GraphParams;
  viewBindings?: Record<string, ParameterTarget>;
}
export interface GraphEdge { id: string; source: GraphEndpoint; target: GraphEndpoint }
export interface WidgetLayout { x: number; y: number; w: number; h: number }
export interface PerformanceWidget {
  id: string;
  kind: 'param' | 'view' | 'meter';
  target: { nodePath: [string]; paramId?: string; viewId?: string; portId?: string };
  layout: WidgetLayout;
}
export interface GraphDocument {
  documentType: 'audiobrain.project';
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  learningGoal?: string;
  capabilityNotes?: string[];
  presetOrigins?: PresetOrigin[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  performance: { version: 1; columns: number; widgets: PerformanceWidget[] };
}
export type SignalType = 'transport.state' | 'geometry.path' | 'geometry.features' | 'music.voices' | 'event.feature' | 'event.note' | 'geometry.graph' | 'audio.block' | 'control.f32' | 'text.utf8';
export interface PortDefinition { id: string; label: string; type: SignalType; schemaVersion: number; required?: boolean }
export interface ViewDefinition { id: string; label: string; intents: { id: string; label: string; paramType: OperatorParamDefinition['type'] }[] }
export interface OperatorDefinition {
  kind: string;
  title: string;
  description: string;
  runtime: { status: string; domain: string; clock: string };
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: ParamDefinitions;
  views: ViewDefinition[];
  demandRoot: 'view' | 'monitor' | 'audio-output' | 'external-output' | null;
}
export type NodeKind = string;
export const GRAPH_SCHEMA_VERSION = 1;

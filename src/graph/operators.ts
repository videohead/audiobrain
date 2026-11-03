import catalog from '../../contracts/operator-catalog.json';
import { defaultParams } from '@brain/control/graph/params';
import type { GraphParams, OperatorDefinition, OperatorParamDefinition } from './types';

// This JSON is the public catalog and the single definition of each operator.
export const OPERATOR_DEFINITIONS = catalog.operators as unknown as OperatorDefinition[];
export const OPERATOR_CATALOG_VERSION = 5;
export const GRAPH_LIMITS = { ...catalog.limits, maxJsonBytes: 1024 * 1024 };
export const NODE_KINDS = OPERATOR_DEFINITIONS.map(({ kind }) => kind);
const operators = new Map(OPERATOR_DEFINITIONS.map((operator) => [operator.kind, operator]));
export function getOperatorDefinition(kind: string): OperatorDefinition {
  const definition = operators.get(kind);
  if (!definition) throw new Error(`Unknown operator kind: ${kind}`);
  return definition;
}
export function getDefaultParams(kind: string): GraphParams {
  return defaultParams(getOperatorDefinition(kind).params);
}
/** Whether a view gesture can drive a parameter. Gestures are continuous, so a whole-number parameter does not qualify as a `number`. */
export function intentAccepts(intent: { paramType: OperatorParamDefinition['type'] }, parameter: OperatorParamDefinition): boolean {
  return parameter.type === intent.paramType && !(parameter.type === 'number' && parameter.integer === true);
}
/** A parameter definition together with its ID, for components that render or edit one parameter. */
export type ParameterEntry = OperatorParamDefinition & { id: string };
/** The named parameter of an operator, or undefined. IDs come from untrusted documents, so only own properties count. */
export function getParameter(definition: OperatorDefinition, id: string | undefined): ParameterEntry | undefined {
  return id !== undefined && Object.hasOwn(definition.params, id) ? { ...(definition.params[id] as OperatorParamDefinition), id } : undefined;
}
/** A definition's parameters as a list, in catalog order, each carrying its ID. */
export function parameterList(definition: OperatorDefinition): ParameterEntry[] {
  return Object.entries(definition.params).map(([id, parameter]) => ({ ...parameter, id }));
}

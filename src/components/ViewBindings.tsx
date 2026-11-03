import { getOperatorDefinition, intentAccepts, parameterList, type GraphNode } from '../graph';
import { useProjectStore } from '../store';

export function ViewBindings({ node }: { node: GraphNode }) {
  const store = useProjectStore();
  const definition = getOperatorDefinition(node.kind);
  const intents = definition.views.flatMap(view => view.intents);
  if (!intents.length) return null;
  return <div className="view-bindings"><h3>Graphic gestures</h3>{intents.map(intent => {
    const target = node.viewBindings?.[intent.id];
    const candidates = store.document.nodes.flatMap(candidate => parameterList(getOperatorDefinition(candidate.kind))
      .filter(param => intentAccepts(intent, param))
      .map(param => ({ node: candidate, param })));
    return <label className="connection-field" key={intent.id}>{intent.label}<select aria-label={`${intent.label} target`}
      value={target ? JSON.stringify([target.nodePath[0], target.paramId]) : ''}
      onChange={event => {
        const candidate = candidates.find(item => JSON.stringify([item.node.id, item.param.id]) === event.target.value);
        if (candidate) store.bindView(node.id, intent.id, candidate.node.id, candidate.param.id);
      }}>
      {!target && <option value="">Choose a parameter</option>}
      {candidates.map(candidate => <option key={JSON.stringify([candidate.node.id, candidate.param.id])} value={JSON.stringify([candidate.node.id, candidate.param.id])}>{candidate.node.label ?? getOperatorDefinition(candidate.node.kind).title} · {candidate.param.label} ({candidate.node.id})</option>)}
    </select></label>;
  })}</div>;
}

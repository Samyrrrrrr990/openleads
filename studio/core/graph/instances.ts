/**
 * Resolving instances into ordinary nodes.
 *
 * An instance is a reference: it holds no children, and what renders beneath
 * it is its definition read through that instance's overrides. That is the
 * right shape for editing, and the wrong shape for anything that has to hand
 * out a finished graph — export, and detaching an instance on purpose.
 *
 * `flattenInstances` does that resolution once, producing a project with no
 * instances left in it and no references to any definition. Ids are minted
 * fresh, so two instances of one definition become two independent subtrees
 * rather than two aliases of the same one.
 */

import type { ComponentDef, ElementNode, NodeId, Project } from './types';
import { newNodeId } from './ids';
import { applyOverride } from './selectors';

/**
 * Expands one instance into concrete nodes.
 *
 * Returns the nodes and the id the instance should be replaced by. The
 * definition's root takes the instance's own place in its parent, so an
 * instance leaves no wrapper element behind in exported markup.
 */
function expand(
  instance: ElementNode,
  def: ComponentDef,
  parentId: NodeId | null,
): { nodes: ElementNode[]; rootId: NodeId } {
  const idMap = new Map<NodeId, NodeId>();
  for (const id of Object.keys(def.nodes)) idMap.set(id, newNodeId());

  const nodes: ElementNode[] = [];
  for (const [defId, defNode] of Object.entries(def.nodes)) {
    const id = idMap.get(defId)!;
    const resolved = applyOverride(
      defNode,
      instance.overrides?.[defId],
      id,
      defNode.parentId ? (idMap.get(defNode.parentId) ?? null) : null,
      defNode.children.map((childId) => idMap.get(childId)!).filter(Boolean),
    );
    // The definition's root inherits the instance's position and name.
    if (defId === def.rootId) {
      resolved.parentId = parentId;
      resolved.name = instance.name || resolved.name;
    }
    nodes.push(resolved);
  }

  return { nodes, rootId: idMap.get(def.rootId)! };
}

/**
 * A copy of `project` with every instance replaced by the nodes it stood for.
 *
 * An instance whose definition is missing is dropped rather than left
 * dangling: it renders as nothing in the editor, and exporting an empty
 * element that used to be something is more confusing than exporting nothing.
 */
export function flattenInstances(project: Project): Project {
  const hasInstances = Object.values(project.nodes).some((node) => node.kind === 'instance');
  if (!hasInstances) return project;

  const nodes: Record<NodeId, ElementNode> = {};
  for (const [id, node] of Object.entries(project.nodes)) {
    if (node.kind !== 'instance') nodes[id] = { ...node, children: [...node.children] };
  }

  for (const node of Object.values(project.nodes)) {
    if (node.kind !== 'instance') continue;
    const def = node.componentId ? project.components?.[node.componentId] : undefined;
    const parent = node.parentId ? nodes[node.parentId] : undefined;
    const at = parent ? parent.children.indexOf(node.id) : -1;

    if (!def || !def.nodes[def.rootId]) {
      if (parent && at >= 0) parent.children.splice(at, 1);
      continue;
    }

    const { nodes: expanded, rootId } = expand(node, def, node.parentId);
    for (const child of expanded) nodes[child.id] = child;
    if (parent && at >= 0) parent.children.splice(at, 1, rootId);
  }

  return { ...project, nodes, components: {} };
}

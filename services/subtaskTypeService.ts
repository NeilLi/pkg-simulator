import { SubtaskType } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3011';

export async function createSubtaskType(params: {
  snapshotId: number;
  name: string;
  defaultParams?: any;
}): Promise<SubtaskType> {
  const response = await fetch(`${API_BASE_URL}/api/subtask-types`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to create subtask type (${response.status})`);
  }

  return await response.json();
}

export async function cloneSubtaskTypes(params: {
  sourceSnapshotId: number;
  targetSnapshotId: number;
  existingSubtaskTypes: SubtaskType[];
}): Promise<SubtaskType[]> {
  const source = params.existingSubtaskTypes.filter(st => st.snapshotId === params.sourceSnapshotId);
  const targetNames = new Set(
    params.existingSubtaskTypes
      .filter(st => st.snapshotId === params.targetSnapshotId)
      .map(st => st.name)
  );

  const created: SubtaskType[] = [];
  for (const subtask of source) {
    if (targetNames.has(subtask.name)) continue;
    const cloned = await createSubtaskType({
      snapshotId: params.targetSnapshotId,
      name: subtask.name,
      defaultParams: subtask.defaultParams || {},
    });
    created.push(cloned);
    targetNames.add(subtask.name);
  }
  return created;
}

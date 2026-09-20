/* FrameChoreo's browser-independent display model. */
(function (root) {
  'use strict';
  function indexStory(data) {
    if (!data || data.format !== 'framechoreo.story' || data.schema_version !== 1) {
      throw new Error('Unsupported story format');
    }
    return new Map(data.steps.map(step => [step.id, step]));
  }
  function scenes(data) {
    const steps = indexStory(data), result = [];
    for (const id of data.timeline) {
      const step = steps.get(id);
      if (!step) throw new Error('Missing timeline step');
      if (step.operation === 'group_sum') {
        const groupingStep = {...step, presentation: {...(step.presentation || {}), note: ''}};
        result.push({kind: 'group', step: groupingStep, table: steps.get(step.parents[0])});
        result.push({kind: 'sum', step, table: step});
      } else result.push({kind: step.operation, step, table: step});
    }
    return result;
  }
  function traceCell(data, reference, limit = 10000) {
    const steps = indexStory(data), pending = [reference], result = [];
    let visited = 0;
    while (pending.length) {
      if (++visited > limit * Math.max(1, data.steps.length)) {
        throw new Error('This value has too many ancestors to display. Select an earlier step.');
      }
      const ref = pending.pop(), step = steps.get(ref.step);
      const row = step && step.rows[ref.row];
      if (!row || !step.columns.includes(ref.column)) throw new Error('Invalid cell reference');
      if (step.operation === 'source') {
        result.push({source: step.name, step: step.id, row: ref.row, column: ref.column,
          cell: row.cells[step.columns.indexOf(ref.column)]});
        if (result.length > limit) throw new Error('This value has too many source cells to display.');
      } else {
        const refs = Object.prototype.hasOwnProperty.call(row.cell_parents, ref.column)
          ? row.cell_parents[ref.column] : [];
        for (let i = refs.length - 1; i >= 0; i--) pending.push(refs[i]);
      }
    }
    return result;
  }
  function rowKey(stepId, position) { return stepId + ':' + position; }
  function groupTitle(scene, groupIndex) {
    const row = scene.step.rows[groupIndex];
    return scene.step.parameters.by.map(key =>
      key + ': ' + row.cells[scene.step.columns.indexOf(key)].display).join(' · ');
  }
  function orderedRows(scene) {
    if (scene.kind !== 'group') return scene.table.rows;
    const positions = scene.step.parameters.groups.flatMap(g => g.input_rows);
    const seen = new Set(positions);
    return positions.map(i => scene.table.rows[i]).concat(scene.table.rows.filter(r => !seen.has(r.position)));
  }
  function description(scene) {
    const p = scene.step.parameters;
    if (scene.kind === 'source') return 'Recorded input';
    if (scene.kind === 'filter') return 'filter_rows(predicate)';
    if (scene.kind === 'merge') return 'merge(on=' + JSON.stringify(p.on) + ', how=' + JSON.stringify(p.how) + ', validate=' + JSON.stringify(p.validate) + ')';
    const group = 'groupby(' + JSON.stringify(p.by) + ', dropna=' + (p.dropna ? 'True' : 'False') + ', sort=' + (p.sort ? 'True' : 'False') + ')';
    return scene.kind === 'group' ? group : group + '[' + JSON.stringify(p.value) + '].sum(min_count=' + p.min_count + ')';
  }
  const api = {indexStory, scenes, traceCell, rowKey, groupTitle, orderedRows, description};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FrameChoreoModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

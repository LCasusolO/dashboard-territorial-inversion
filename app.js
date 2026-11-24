'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const data = window.DASHBOARD_DATA;
  const maps = window.DASHBOARD_MAP;
  const regionFields = [3, 4, 5, 6, 7];
  const recordFields = [9, 10, 11, 12, 13];
  const size = 10;
  const storageKey = 'atlas-territorial-edits-v1';
  const number = new Intl.NumberFormat('es-PE');
  const sortText = (a, b) => a.localeCompare(b, 'es', { numeric: true });
  const phaseLabel = value => (value || '').replace(/^\s*•\s*/, '');
  const textKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function displayMessage(text) {
    $('app-message').hidden = !text;
    $('app-message').textContent = text;
  }

  if (!data?.rows?.length) {
    displayMessage('No se pudo cargar la base de inversión. Verifica que data.js esté junto al HTML.');
    return;
  }
  const regions = [...new Set(data.rows.map(row => row[2]))].sort(sortText);
  const sourceByCode = new Map(data.rows.map(row => [row[0], row]));
  const sourceByRegion = new Map(regions.map(region => [region, data.rows.find(row => row[2] === region)]));
  const state = { region: regions.includes('Loreto') ? 'Loreto' : regions[0], package: '', page: 0 };
  let edits = { records: {}, profiles: {} };
  let editTarget;
  const mapControls = new Map();

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(text, click, className = 'button quiet') {
    const element = node('button', text, className);
    element.type = 'button';
    element.addEventListener('click', click);
    return element;
  }

  function validateEdits(input) {
    const result = { records: {}, profiles: {} };
    for (const [kind, keys, fields] of [
      ['records', sourceByCode, recordFields],
      ['profiles', sourceByRegion, regionFields],
    ]) {
      if (!input?.[kind] || typeof input[kind] !== 'object' || Array.isArray(input[kind])) {
        throw new Error('El archivo no tiene el formato de una copia de este dashboard.');
      }
      for (const [key, values] of Object.entries(input[kind])) {
        if (!keys.has(key) || !values || typeof values !== 'object' || Array.isArray(values)) {
          throw new Error('La copia contiene un código o una región que no figura en esta base.');
        }
        const patch = {};
        for (const [field, value] of Object.entries(values)) {
          if (!fields.includes(Number(field)) || typeof value !== 'string' || value.length > 12000) {
            throw new Error('La copia contiene un campo no editable o un texto demasiado largo.');
          }
          patch[Number(field)] = value;
        }
        if (Object.keys(patch).length) result[kind][key] = patch;
      }
    }
    return result;
  }

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) edits = validateEdits(JSON.parse(saved));
  } catch {
    displayMessage('No se pudo recuperar la copia local. Puedes importar un respaldo en Exportar base.');
  }

  function persist(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      edits = next;
      return 'Cambios guardados en este navegador.';
    } catch {
      edits = next;
      return 'Cambios aplicados a esta sesión. Este navegador no pudo guardarlos. Exporta una copia para conservarlos.';
    }
  }

  function getRows() {
    return data.rows.map(source => {
      const record = edits.records[source[0]];
      const profile = edits.profiles[source[2]];
      if (!record && !profile) return source;
      return source.map((value, field) => record?.[field] ?? profile?.[field] ?? value);
    });
  }

  function options(select, values, all, selected = select.value) {
    const first = new Option(all, '');
    select.replaceChildren(first, ...values.map(value => new Option(value, value)));
    select.value = values.includes(selected) ? selected : '';
  }

  function setRegion(region) {
    state.region = region;
    state.package = '';
    state.page = 0;
    render();
  }

  function setupMap() {
    if (!maps?.features?.length) {
      $('map').append(node('p', 'Mapa no disponible. Elige una región en el selector.'));
      return;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 540 600');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Departamentos del Perú');
    const labels = [];
    for (const feature of [...maps.features].sort((a, b) => Number(regions.includes(a.name)) - Number(regions.includes(b.name)))) {
      const area = document.createElementNS(ns, 'g');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('class', 'geometry');
      path.setAttribute('d', feature.path);
      path.setAttribute('fill-rule', 'evenodd');
      area.append(path);
      if (regions.includes(feature.name)) {
        area.setAttribute('class', 'map-region');
        area.setAttribute('role', 'button');
        area.setAttribute('tabindex', '0');
        area.setAttribute('aria-label', feature.name);
        area.dataset.region = feature.name;
        const select = () => setRegion(feature.name);
        area.addEventListener('click', select);
        area.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
          }
        });
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('class', 'map-label');
        label.setAttribute('x', feature.labelX);
        label.setAttribute('y', feature.labelY);
        label.setAttribute('aria-hidden', 'true');
        label.textContent = feature.name;
        labels.push(label);
        mapControls.set(feature.name, area);
      } else {
        area.setAttribute('aria-hidden', 'true');
      }
      svg.append(area);
    }
    svg.append(...labels);
    $('map').append(svg);
    if (maps.source?.url) {
      const link = node('a', maps.source.title || 'Fuente cartográfica');
      link.href = maps.source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      $('map-source').append('Límites departamentales · ', link, maps.source.date ? ' · ' + maps.source.date : '');
    }
  }

  function disclosure(label, value, scope) {
    const details = node('details');
    const summary = node('summary', label);
    if (scope) summary.append(node('span', scope, 'scope'));
    details.append(summary, node('p', value || 'Sin información en la fuente.', 'source-text'));
    return details;
  }

  function excerpt(value) {
    if (!value) return '';
    const line = value.split('\n').map(part => part.trim())
      .find(part => part.length > 43 && !part.endsWith(':')) || value;
    if (line.length <= 182) return line;
    const boundary = line.lastIndexOf(' ', 180);
    return line.slice(0, boundary > 120 ? boundary : 180) + '…';
  }

  function renderProfile() {
    const area = $('profile');
    const source = sourceByRegion.get(state.region);
    $('profile-title').textContent = state.region || 'Cinco regiones fronterizas';
    $('edit-profile').hidden = !source;
    if (!source) {
      area.replaceChildren(node('p', 'Selecciona un departamento en el mapa para consultar su eje, municipalidades, brechas y potencialidades.', 'muted'));
      return;
    }
    const fields = source.map((value, field) => edits.profiles[state.region]?.[field] ?? value);
    const intro = node('div', undefined, 'profile-content');
    intro.append(node('h3', fields[3]), node('p', fields[7], 'source-text'));
    for (const [title, index, scope] of [
      ['Brechas', 5, data.scopes?.[state.region]],
      ['Potencialidades', 6, null],
    ]) {
      const details = disclosure(title, fields[index], scope);
      const preview = node('p', excerpt(fields[index]), 'excerpt');
      details.addEventListener('toggle', () => { preview.hidden = details.open; });
      intro.append(details, preview);
    }
    intro.append(disclosure('Municipalidades vinculadas', fields[4]));
    area.replaceChildren(intro);
  }

  function statRows(target, items, action) {
    const max = Math.max(1, ...items.map(([, count]) => count));
    const chart = items.map(([label, count, annotation]) => {
      const bar = node('div', undefined, 'stat-row');
      const caption = action ? button(label, () => action(label), '') : node('span', label);
      if (action) caption.setAttribute('aria-pressed', String(label === state.region));
      if (annotation) caption.title = annotation;
      const track = node('div', undefined, 'track');
      track.setAttribute('aria-hidden', 'true');
      const fill = node('span');
      fill.style.width = (count / max * 100) + '%';
      track.append(fill);
      bar.append(caption, track, node('strong', number.format(count)));
      return bar;
    });
    target.replaceChildren(...chart);
  }

  function counts(rows, field, transform = value => value) {
    const result = new Map();
    for (const row of rows) {
      const key = transform(row[field]) || 'Sin dato';
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  }

  function renderPackages(rows) {
    const keys = new Map();
    for (const row of rows) {
      if (!row[8]) continue;
      const key = packageKey(row);
      const packageRows = keys.get(key) ?? [];
      packageRows.push(row);
      keys.set(key, packageRows);
    }
    if (state.package && !keys.has(state.package)) state.package = '';
    const order = [...keys].sort(([, left], [, right]) => sortText(left[0][2] + left[0][8], right[0][2] + right[0][8]));
    const list = order.map(([key, entries]) => {
      const first = entries[0];
      const label = state.region ? first[8] : first[2] + ' · ' + first[8];
      const control = button(label, () => {
        state.package = state.package === key ? '' : key;
        state.page = 0;
        render();
        [...$('packages').querySelectorAll('button')].find(item => item.dataset.package === key)?.focus();
      }, 'button package-button');
      control.setAttribute('aria-pressed', String(key === state.package));
      control.dataset.package = key;
      control.append(node('strong', number.format(entries.length)));
      return control;
    });
    $('packages').replaceChildren(...list);
    const selected = keys.get(state.package)?.[0] ?? (state.region ? order[0]?.[1]?.[0] : null);
    if (!selected) {
      $('package-detail').replaceChildren(node('p', 'Elige un paquete para consultar sus brechas y las inversiones complementarias.', 'muted'));
      return;
    }
    const [heading, guidance] = [
      node('h3', selected[8]),
      node('p', state.package ? 'Los registros se filtran por este paquete.' : 'Selecciona un paquete para filtrar sus registros.', 'muted'),
    ];
    $('package-detail').replaceChildren(heading, guidance,
      disclosure('Brecha o potencialidad sin inversión', selected[15]),
      disclosure('Inversión complementaria sugerida', selected[16]),
      disclosure('Resultado territorial esperado', selected[14]));
    $('package-detail').querySelector('details').open = true;
  }

  function packageKey(row) {
    return JSON.stringify([row[2], row[8]]);
  }

  function renderRecords() {
    const rows = getRows().filter(row => (!state.region || row[2] === state.region) && (!state.package || packageKey(row) === state.package));
    options($('municipality'), [...new Set(rows.map(row => row[10]).filter(Boolean))].sort(sortText), 'Todas');
    options($('phase'), [...new Set(rows.map(row => phaseLabel(row[12])).filter(Boolean))].sort(sortText), 'Todas');
    options($('type'), [...new Set(rows.map(row => row[1]).filter(Boolean))].sort(sortText), 'Todos');
    const query = textKey($('search').value.trim()).split(/\s+/).filter(Boolean);
    const filtered = rows.filter(row => {
      const label = textKey(row[1] + ' ' + row[0]);
      return query.every(part => label.includes(part)) &&
        (!$('municipality').value || row[10] === $('municipality').value) &&
        (!$('phase').value || phaseLabel(row[12]) === $('phase').value) &&
        (!$('type').value || row[1] === $('type').value);
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / size));
    state.page = Math.min(state.page, pageCount - 1);
    $('results-count').textContent = number.format(filtered.length) + (filtered.length === 1 ? ' registro' : ' registros');
    $('page').textContent = 'Página ' + (state.page + 1) + ' de ' + pageCount;
    $('prev').disabled = state.page === 0;
    $('next').disabled = state.page >= pageCount - 1;
    const entries = filtered.slice(state.page * size, (state.page + 1) * size).map(row => {
      const tr = node('tr');
      const label = row[1] + ' ' + row[0];
      const edit = button('Ver y editar', () => openEditor('records', row[0]));
      edit.setAttribute('aria-label', 'Ver y editar ' + label);
      const action = node('td');
      action.append(edit);
      tr.append(...[row[0], row[1], row[10], row[11], phaseLabel(row[12])].map(value => node('td', value || '—')), action);
      return tr;
    });
    if (!entries.length) {
      const tr = node('tr');
      const cell = node('td', 'No se encontraron registros con estos filtros.');
      cell.colSpan = 6;
      tr.append(cell);
      entries.push(tr);
    }
    $('rows').replaceChildren(...entries);
  }

  function render() {
    const rows = getRows();
    const selected = state.region ? rows.filter(row => row[2] === state.region) : rows;
    const types = counts(selected, 1);
    for (const [id, value] of [
      ['kpi-total', selected.length], ['kpi-cui', types.get('CUI')],
      ['kpi-idea', types.get('Idea')], ['kpi-snip', types.get('SNIP')],
    ]) $(id).textContent = number.format(value ?? 0);
    $('region').value = state.region;
    for (const [region, area] of mapControls) area.setAttribute('aria-pressed', String(region === state.region));
    $('map-reset').disabled = !state.region;
    renderProfile();
    statRows($('comparison'), regions.map(region => {
      const records = rows.filter(row => row[2] === region);
      const totals = counts(records, 1);
      return [region, records.length, ['CUI', 'Idea', 'SNIP'].map(type => type + ' ' + (totals.get(type) ?? 0)).join(' · ')];
    }), region => {
      setRegion(region);
      [...$('comparison').querySelectorAll('button')].find(item => item.textContent === region)?.focus();
    });
    $('phase-context').textContent = state.region || 'Cinco regiones fronterizas';
    statRows($('phases'), [...counts(selected, 12, phaseLabel)].sort((a,b) => b[1] - a[1] || sortText(a[0], b[0])));
    renderPackages(selected);
    renderRecords();
  }

  function openEditor(kind, key) {
    const isProfile = kind === 'profiles';
    const original = (isProfile ? sourceByRegion : sourceByCode).get(key);
    editTarget = { kind, key, original };
    $('editor-title').textContent = isProfile ? 'Editar ficha de ' + key : 'Editar ' + original[1] + ' ' + key;
    $('editor-note').textContent = isProfile
      ? 'Los cambios de la ficha se aplican a los registros de esta región en la exportación.'
      : 'Región · ' + original[2] + '\nPaquete · ' + (original[8] || 'Sin paquete') + '\nReferencia · ' + (original[17] || 'Sin referencia');
    $('editor-note').classList.add('source-text');
    $('editor-status').textContent = isProfile ? '' : [
      ['Resultado territorial del paquete', original[14]],
      ['Brecha sin inversión del paquete', original[15]],
      ['Idea complementaria del paquete', original[16]],
    ].filter(([, value]) => value).map(([label, value]) => label + ' · ' + value).join('\n\n');
    $('editor-status').classList.add('source-text');
    const fields = (isProfile ? regionFields : recordFields).map(field => {
      const wrapper = node('div', undefined, 'edit-field');
      const label = node('label', data.headers[field]);
      label.htmlFor = 'edit-' + field;
      const control = node([9, 10, 12].includes(field) ? 'input' : 'textarea');
      control.id = label.htmlFor;
      control.name = String(field);
      control.maxLength = 12000;
      control.value = edits[kind][key]?.[field] ?? original[field] ?? '';
      wrapper.append(label, control);
      return wrapper;
    });
    $('editor-fields').replaceChildren(...fields);
    $('editor').showModal();
  }

  $('editor-form').addEventListener('submit', event => {
    event.preventDefault();
    const { kind, key, original } = editTarget;
    const patch = {};
    for (const [field, value] of new FormData(event.currentTarget)) {
      if (value !== (original[field] ?? '')) patch[field] = value;
    }
    const next = { ...edits, [kind]: { ...edits[kind] } };
    if (Object.keys(patch).length) next[kind][key] = patch;
    else delete next[kind][key];
    const message = persist(next);
    $('editor').close();
    render();
    displayMessage(message);
    if (kind === 'profiles') $('edit-profile').focus();
    else {
      const label = 'Ver y editar ' + original[1] + ' ' + key;
      const match = [...$('rows').querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label);
      (match ?? $('search')).focus();
    }
  });

  function download(filename, mime, body) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const link = node('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  $('export-csv').addEventListener('click', () => {
    const csv = [data.headers, ...getRows()].map(row => row.map(csvCell).join(',')).join('\r\n');
    download('base-territorial.csv', 'text/csv;charset=utf-8', '\uFEFF' + csv);
  });
  $('export-json').addEventListener('click', () => {
    download('base-territorial.json', 'application/json', JSON.stringify({ version: 1, ...data, rows: getRows(), edits }, null, 2));
  });
  $('import-confirm').addEventListener('click', async () => {
    const file = $('import-json').files[0];
    if (!file) {
      $('import-status').textContent = 'Selecciona una copia JSON.';
      return;
    }
    try {
      const content = JSON.parse(await file.text());
      if (content.version !== 1) throw new Error('La versión de la copia no es compatible.');
      const next = validateEdits(content.edits);
      $('import-status').textContent = persist(next);
      render();
    } catch (error) {
      $('import-status').textContent = error.message;
    }
  });

  options($('region'), regions, 'Todas las regiones', state.region);
  $('region').addEventListener('change', event => setRegion(event.target.value));
  $('map-reset').addEventListener('click', () => { setRegion(''); $('region').focus(); });
  $('edit-profile').addEventListener('click', () => openEditor('profiles', state.region));
  for (const id of ['search', 'municipality', 'phase', 'type']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
    state.page = 0;
    renderRecords();
  });
  $('clear-filters').addEventListener('click', () => {
    for (const id of ['search', 'municipality', 'phase', 'type']) $(id).value = '';
    state.package = '';
    state.page = 0;
    render();
  });
  $('prev').addEventListener('click', () => { state.page -= 1; renderRecords(); });
  $('next').addEventListener('click', () => { state.page += 1; renderRecords(); });
  for (const id of ['export-top', 'export-records']) $(id).addEventListener('click', () => $('exports').showModal());
  for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => control.closest('dialog').close());

  setupMap();
  render();
})();

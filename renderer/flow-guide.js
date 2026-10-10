/* Apresentação progressiva do fluxo. Não altera os serviços nem os eventos de execução. */
(() => {
  'use strict';

  const main = document.querySelector('main');
  const sections = main ? Array.from(main.querySelectorAll(':scope > .card')) : [];
  if (sections.length !== 5 || !document.getElementById('operationSummary')) return;

  const byId = (id) => document.getElementById(id);
  const make = (tag, className, label) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const steps = [
    { name: 'Conexões', subtitle: 'Base44 e GitHub' },
    { name: 'Produto', subtitle: 'Projeto e pasta' },
    { name: 'Entrega', subtitle: 'Pacote e escopo' },
    { name: 'Destino', subtitle: 'Repositório seguro' },
    { name: 'Acompanhar', subtitle: 'Execução e aceite' },
  ];

  let current = 0;
  let expanded = false;
  let userNavigated = false;
  let focusedExecution = false;
  let queued = false;
  const navButtons = [];

  document.body.classList.add('bridge-guided');
  sections.forEach((section, index) => {
    section.classList.add('bridge-flow-section');
    section.dataset.flowSection = String(index + 1);
  });

  const guide = make('section', 'bridge-guide');
  guide.setAttribute('aria-label', 'Guia de execução');
  const top = make('div', 'bridge-guide-top');
  const heading = make('div', 'bridge-guide-heading');
  heading.append(make('span', 'eyebrow', 'Seu caminho até o GitHub'));
  heading.append(make('h2', '', 'Uma etapa de cada vez'));
  const description = make('p', '', 'Configure a operação, acompanhe a execução e consulte o resultado.');
  heading.append(description);
  const toggle = make('button', 'secondary bridge-mode-button', 'Mostrar todas as etapas');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  top.append(heading, toggle);
  const nav = make('nav', 'bridge-step-nav');
  nav.setAttribute('aria-label', 'Navegação pelas etapas');
  steps.forEach((step, index) => {
    const button = make('button', 'bridge-step');
    button.type = 'button';
    button.setAttribute('aria-label', 'Ir para etapa ' + (index + 1) + ': ' + step.name);
    button.append(make('span', 'bridge-step-number', String(index + 1)));
    const label = make('span', 'bridge-step-copy');
    label.append(make('strong', '', step.name), make('small', '', step.subtitle));
    button.append(label);
    const state = make('span', 'bridge-step-state', 'Pendente');
    button.append(state);
    button.addEventListener('click', () => goTo(index, true));
    navButtons.push({ button, state });
    nav.append(button);
  });
  const bottom = make('div', 'bridge-guide-bottom');
  const hint = make('p', 'bridge-guide-hint');
  hint.setAttribute('aria-live', 'polite');
  const controls = make('div', 'bridge-guide-controls');
  const previous = make('button', 'ghost', 'Etapa anterior');
  const next = make('button', 'secondary', 'Próxima etapa');
  previous.type = 'button';
  next.type = 'button';
  previous.addEventListener('click', () => goTo(current - 1, true));
  next.addEventListener('click', () => goTo(current + 1, true));
  controls.append(previous, next);
  bottom.append(hint, controls);
  guide.append(top, nav, bottom);
  byId('operationSummary').insertAdjacentElement('afterend', guide);

  // O processamento deve aparecer ao lado das ações, e não entre as opções comerciais.
  const pipeline = byId('pipeline');
  const execution = sections[4];
  const executionHeading = execution.querySelector('.section-heading');
  if (pipeline && executionHeading) executionHeading.insertAdjacentElement('afterend', pipeline);

  // Informações complementares continuam disponíveis, porém não ocupam a tela inicialmente.
  function fold(target, title) {
    if (!target || target.closest('.bridge-fold')) return;
    const details = make('details', 'bridge-fold');
    const summary = make('summary', '', title);
    target.parentNode.insertBefore(details, target);
    details.append(summary, target);
  }
  fold(sections[2].querySelector('.delivery-definition'), 'Ver detalhes, entregáveis e limites do pacote');
  fold(sections[3].querySelector('.info-box.secure'), 'Como o repositório e o histórico são protegidos');

  const decision = byId('operationDecision');
  if (decision) {
    const groups = Array.from(decision.querySelectorAll('.decision-section'));
    for (const group of groups) {
      if (group.querySelector('.decision-table-wrap')) fold(group, 'Consultar matriz de escopo e evidências');
      else if (group.querySelector('.evolution-grid')) fold(group, 'Consultar caminhos para evolução futura');
    }
  }

  function ready() {
    const base44 = byId('base44Status')?.classList.contains('connected');
    const github = byId('githubStatus')?.classList.contains('connected');
    const githubCanDeliver = github && byId('githubLogin')?.disabled;
    const project = Boolean(byId('project')?.value);
    const directory = Boolean(byId('output')?.value);
    const pkg = Boolean(byId('deliveryPackage')?.value && byId('targetProfile')?.value);
    const owner = Boolean(byId('owner')?.value);
    const repo = byId('repoChoice')?.value;
    const repoSelected = Boolean(repo && (repo !== '__new__' || byId('repoName')?.value.trim()));
    const authorized = Boolean(byId('authorization')?.checked);
    const running = !byId('cancel')?.disabled;
    const summary = byId('operationSummary');
    const delivered = Boolean(summary?.classList.contains('success') &&
      byId('operationSummaryTitle')?.textContent === 'Entrega concluída');
    const attention = Boolean(summary?.classList.contains('error') ||
      summary?.classList.contains('attention'));

    return [
      { kind: base44 && githubCanDeliver ? 'done' : base44 || github ? 'partial' : 'waiting',
        label: base44 && githubCanDeliver ? 'Conectado' : base44 || github ? 'Conferir' : 'Pendente',
        hint: !base44 ? 'Conecte sua conta Base44 para listar os projetos.' :
          !github ? 'Conecte o GitHub para escolher onde publicar.' :
          !githubCanDeliver ? 'Conclua a autorização do GitHub para publicar com segurança.' :
          'Conexões prontas. Avance para escolher o projeto.' },
      { kind: project && directory ? 'done' : project || directory ? 'partial' : 'waiting',
        label: project && directory ? 'Definido' : 'Pendente',
        hint: !project ? 'Selecione o projeto que será preservado e migrado.' :
          !directory ? 'Escolha a pasta onde os arquivos e checkpoints serão salvos.' :
          'Projeto e pasta definidos. Avance para revisar o pacote.' },
      { kind: pkg ? 'done' : 'waiting', label: pkg ? 'Definido' : 'Pendente',
        hint: 'Confirme o pacote e a arquitetura de destino. Os itens do escopo devem refletir o que será homologado.' },
      { kind: owner && repoSelected && authorized ? 'done' : owner || repoSelected || authorized ? 'partial' : 'waiting',
        label: owner && repoSelected && authorized ? 'Autorizado' : 'Conferir',
        hint: !owner ? 'Escolha a conta GitHub que receberá o projeto.' :
          !repoSelected ? 'Escolha um repositório existente ou informe o nome do novo.' :
          !authorized ? 'Revise a comparação e confirme a autorização do proprietário.' :
          'Destino autorizado. Agora você pode iniciar a operação.' },
      { kind: running ? 'running' : delivered ? 'done' : attention ? 'partial' : 'waiting',
        label: running ? 'Executando' : delivered ? 'Entrega gerada' : attention ? 'Atenção' : 'A iniciar',
        hint: running ? 'Acompanhe as cinco fases abaixo. Os registros técnicos ficam em “Ver detalhes técnicos”.' :
          delivered ? 'A entrega foi gerada. Confira o resultado, os próximos passos e as homologações pendentes.' :
          attention ? 'Confira a mensagem de resultado, corrija a pendência e continue do checkpoint quando disponível.' :
          'Use o botão de execução nesta etapa. O original e o histórico serão preservados.' },
    ];
  }

  function goTo(index, initiatedByUser) {
    current = Math.max(0, Math.min(steps.length - 1, index));
    if (initiatedByUser) userNavigated = true;
    render();
    if (initiatedByUser) guide.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function render() {
    const statuses = ready();
    if (!userNavigated && current === 0 && statuses[0].kind === 'done') current = 1;
    const processing = statuses[4].kind === 'running';
    if (processing && !focusedExecution) {
      focusedExecution = true;
      current = 4;
      expanded = false;
    }
    if (!processing) focusedExecution = false;

    document.body.classList.toggle('bridge-guided', !expanded);
    document.body.classList.toggle('bridge-all', expanded);
    sections.forEach((section, index) => {
      const selected = index === current;
      section.classList.toggle('flow-active', selected);
      section.setAttribute('aria-label', 'Etapa ' + (index + 1) + ': ' + steps[index].name);
    });
    navButtons.forEach(({ button, state }, index) => {
      const status = statuses[index];
      button.className = 'bridge-step ' + status.kind + (index === current ? ' active' : '');
      button.setAttribute('aria-current', index === current && !expanded ? 'step' : 'false');
      state.textContent = status.label;
    });
    heading.querySelector('h2').textContent = expanded ? 'Visão completa da operação' :
      'Etapa ' + (current + 1) + ' de 5 · ' + steps[current].name;
    description.textContent = expanded
      ? 'Todas as opções estão visíveis. O passo a passo continua disponível sem perder os dados preenchidos.'
      : steps[current].subtitle;
    hint.textContent = statuses[current].hint;
    toggle.textContent = expanded ? 'Voltar ao passo a passo' : 'Mostrar todas as etapas';
    toggle.setAttribute('aria-pressed', String(expanded));
    previous.hidden = expanded || current === 0;
    next.hidden = expanded || current === 4;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; render(); });
  }

  toggle.addEventListener('click', () => { expanded = !expanded; userNavigated = true; render(); });
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
  window.addEventListener('focus', schedule);
  for (const id of ['base44Status', 'githubStatus', 'githubLogin', 'project', 'owner',
    'repoChoice', 'repoSyncStatus', 'result', 'operationSummary', 'resumeCard', 'completedCard']) {
    const node = byId(id);
    if (node) new MutationObserver(schedule).observe(node, {
      attributes: true, childList: true, characterData: true, subtree: true,
    });
  }
  if (pipeline) new MutationObserver(schedule).observe(pipeline, {
    attributes: true, childList: true, subtree: true,
  });
  render();
})();

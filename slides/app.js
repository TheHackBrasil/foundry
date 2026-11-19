(() => {
  'use strict';

  const slides = [...document.querySelectorAll('.slide')];
  const total = slides.length;
  const progress = document.getElementById('progress-line');
  const pageCurrent = document.getElementById('page-current');
  const notesPanel = document.getElementById('notes-panel');
  const notesInput = document.getElementById('notes-input');
  const notesGuidance = document.getElementById('notes-guidance');
  const overview = document.getElementById('overview');
  const overviewGrid = document.getElementById('overview-grid');
  const notePrompts = [
    'ABERTURA (até 45 segundos)\n“Obrigado por separar esse tempo. Estamos pesquisando logística para o HackBrasil e queremos ouvir como é a operação real. Nosso objetivo hoje é aprender, inclusive descobrir onde nossas hipóteses estão erradas.”\n\nEvitar: apresentar solução antes de entender a rotina.',
    'CONTEXTO DE PESQUISA\nA Enviagora já apresenta publicamente fulfillment, WMS, visibilidade e integrações. Não presumir que a dor seja falta de conexão básica.\n\nPergunta: Mesmo com sistemas integrados, o que continua exigindo intervenção manual?',
    'PERGUNTAS ABERTAS\n1. Conte o último problema que vocês tiveram de investigar manualmente.\n2. Como descobriram? Quem atuou? Em quais sistemas?\n3. Qual a frequência e o impacto aproximados?\n4. O que muda quando depende de outra empresa?\n\nPeça um caso concreto e siga a sequência real dos acontecimentos.',
    'HIPÓTESE DE FRAGMENTAÇÃO (mostrar só se houver tempo)\nA simulação usa dados fictícios e não descreve a Enviagora.\n\nPerguntas: Isso acontece? Em quais interfaces? Quais dados são difíceis de reconciliar? Que ferramentas já resolveram essa dor?',
    'HIPÓTESE DE EVENTOS COMPARTILHADOS\nNão propor blockchain como resposta fechada. APIs, webhooks, filas e trilhas de auditoria são alternativas.\n\nPerguntas: Qual o maior obstáculo: padrão de dados, acesso, responsabilidade, confiança, custo ou incentivo das partes?\nO que faria essa ideia ser inútil?',
    'HIPÓTESE ALTERNATIVA: SIMULAÇÃO DO CD\nFalar do gêmeo digital apenas se o convidado tiver contexto e tempo.\n\nPerguntas: Quais decisões diárias ainda são feitas no “feeling”? Há dados bons o suficiente para simular? Quem teria de confiar e agir na recomendação?',
    'FECHAMENTO\n“Se você estivesse no nosso lugar, qual problema escolheria investigar primeiro?”\n\nPeça: indicação de outro perfil para ouvir, permissão para checar uma hipótese depois e exemplo de caso ou métrica que possa ser compartilhada sem confidencialidade.\n\nRegistre a principal evidência que contraria nossa tese.'
  ];
  const storagePrefix = 'foundry-enviagora-2026-notes-';
  let current = 0;

  const parseInitialSlide = () => {
    const match = window.location.hash.match(/^#s-(\d+)$/);
    return match ? Math.max(0, Math.min(total - 1, Number(match[1]) - 1)) : 0;
  };

  const getNote = (idx) => {
    try { return window.localStorage.getItem(storagePrefix + (idx + 1)) || ''; }
    catch { return ''; }
  };
  const setNote = (idx, value) => {
    try { window.localStorage.setItem(storagePrefix + (idx + 1), value); }
    catch { /* Site remains usable when storage is blocked. */ }
  };

  const updateNotes = () => {
    notesGuidance.textContent = notePrompts[current];
    notesInput.value = getNote(current);
  };

  const go = (index, updateHash = true) => {
    const next = Math.max(0, Math.min(total - 1, index));
    if (next !== current) setNote(current, notesInput.value);
    current = next;
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.inert = !active;
      slide.querySelectorAll('video').forEach(video => active ? video.play().catch(() => {}) : video.pause());
    });
    pageCurrent.textContent = String(current + 1).padStart(2, '0');
    progress.style.width = `${(current + 1) / total * 100}%`;
    document.getElementById('prev-btn').disabled = current === 0;
    document.getElementById('next-btn').disabled = current === total - 1;
    if (updateHash) history.replaceState(null, '', `#s-${current + 1}`);
    updateNotes();
    if (overview.classList.contains('open')) closeOverview();
  };

  const toggleNotes = (force) => {
    const open = force === undefined ? !notesPanel.classList.contains('open') : force;
    notesPanel.classList.toggle('open', open);
    notesPanel.setAttribute('aria-hidden', String(!open));
    if (open) { updateNotes(); notesInput.focus(); }
    else document.getElementById('notes-btn').focus();
  };
  const closeOverview = () => {
    overview.classList.remove('open');
    overview.setAttribute('aria-hidden', 'true');
  };
  const toggleOverview = (force) => {
    const open = force === undefined ? !overview.classList.contains('open') : force;
    overview.classList.toggle('open', open);
    overview.setAttribute('aria-hidden', String(!open));
    if (open) {
      toggleNotes(false);
      overview.querySelector('.overview-tile')?.focus();
    }
  };

  document.getElementById('prev-btn').addEventListener('click', () => go(current - 1));
  document.getElementById('next-btn').addEventListener('click', () => go(current + 1));
  document.getElementById('notes-btn').addEventListener('click', () => toggleNotes());
  document.getElementById('notes-close').addEventListener('click', () => toggleNotes(false));
  document.getElementById('overview-btn').addEventListener('click', () => toggleOverview());
  document.getElementById('overview-close').addEventListener('click', closeOverview);
  document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.getElementById('presentation').requestFullscreen?.().catch(() => {});
  });
  notesInput.addEventListener('input', () => setNote(current, notesInput.value));

  document.getElementById('export-notes').addEventListener('click', () => {
    setNote(current, notesInput.value);
    const content = ['# The Foundry | Conversa com a Enviagora', '18 de novembro de 2026', 'Rafael Born', ''];
    slides.forEach((slide, i) => {
      content.push(`## ${String(i + 1).padStart(2, '0')} — ${slide.dataset.title}`, '', getNote(i).trim() || '_Sem anotações._', '');
    });
    const file = new Blob([content.join('\n')], { type:'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'The-Foundry-Notas-Conversa-Enviagora.md';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  slides.forEach((slide, idx) => {
    const tile = document.createElement('button');
    tile.className = 'overview-tile';
    tile.type = 'button';
    const number = document.createElement('span');
    number.textContent = String(idx + 1).padStart(2,'0');
    const title = document.createElement('strong');
    title.textContent = slide.dataset.title;
    const subtitle = document.createElement('small');
    subtitle.textContent = idx > 2 && idx < 6 ? 'HIPÓTESE OPCIONAL' : 'CONVERSA / PESQUISA';
    tile.append(number, title, subtitle);
    tile.addEventListener('click', () => go(idx));
    overviewGrid.append(tile);
  });

  document.addEventListener('keydown', (event) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (event.key === 'Escape') {
      closeOverview(); toggleNotes(false);
      return;
    }
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {event.preventDefault(); go(current + 1);}
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {event.preventDefault(); go(current - 1);}
    if (event.key.toLowerCase() === 'n') {event.preventDefault(); toggleNotes();}
    if (event.key.toLowerCase() === 'o') {event.preventDefault(); toggleOverview();}
    if (event.key.toLowerCase() === 'f') {event.preventDefault(); document.getElementById('fullscreen-btn').click();}
    if (/^[1-7]$/.test(event.key)) {event.preventDefault(); go(Number(event.key) - 1);}
  });
  window.addEventListener('hashchange', () => go(parseInitialSlide(), false));

  // One example, two visual states. These values are fictional, not Enviagora data.
  const board = document.getElementById('fragment-board');
  const switchFragmentation = (mode) => {
    board.dataset.mode = mode;
    board.querySelectorAll('.frag-tab').forEach(button => {
      const active = button.dataset.state === mode;
      button.classList.toggle('current', active);
      button.setAttribute('aria-pressed', String(active));
    });
    board.querySelectorAll('[data-split][data-shared]').forEach(element => {
      element.textContent = element.dataset[mode];
    });
    board.querySelector('.frag-centre').textContent = mode === 'shared' ? '✓' : '?';
    document.getElementById('frag-verdict-label').textContent = mode === 'shared' ? 'UMA TRILHA CONSISTENTE.' : 'QUAL É O ESTADO REAL?';
    document.getElementById('frag-verdict-copy').textContent = mode === 'shared' ? 'Hipótese: eventos acessíveis entre parceiros.' : 'Visões parciais podem exigir conciliação manual.';
    document.getElementById('frag-verdict-icon').textContent = mode === 'shared' ? '✓' : '✕';
  };
  board.querySelectorAll('.frag-tab').forEach(button => button.addEventListener('click', () => switchFragmentation(button.dataset.state)));

  const scenarios = {
    truck:'O que mudar na fila de docas e na sequência de separação?',
    team:'Como redistribuir tarefas sem comprometer a expedição?',
    urgent:'O que priorizar sem atrasar todos os outros pedidos?'
  };
  document.querySelectorAll('.op-case').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.op-case').forEach(sibling => {
      const active = sibling === button;
      sibling.classList.toggle('selected', active);
      sibling.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('op-question').textContent = scenarios[button.dataset.case];
  }));

  go(parseInitialSlide(), false);
})();

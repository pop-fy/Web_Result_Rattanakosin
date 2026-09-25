(() => {
  'use strict';
  let data;
  let assetMap = new Map();
  let rows = [];

  const meta = {
    social: { label: 'Social', color: '#10b8c8' },
    chat: { label: 'Chat', color: '#8069e8' },
    mail: { label: 'Mail', color: '#e8a832' },
    quiz: { label: 'Quiz', color: '#27a971' }
  };
  const extensionOf = name => String(name || '').split('.').pop().toLowerCase();
  const isImage = asset => asset && (String(asset.type || '').startsWith('image/') || ['png','jpg','jpeg','gif','webp'].includes(extensionOf(asset.name)));
  const isPdf = asset => asset && (asset.type === 'application/pdf' || extensionOf(asset.name) === 'pdf');
  const $ = id => document.getElementById(id);
  const state = { channel: 'all', search: '', org: '', sender: '', role: '', date: '', from: '', to: '', limit: 80 };
  const quizState = { search: '', question: '', org: '', limit: 100 };
  const formatNumber = n => new Intl.NumberFormat('th-TH').format(n);
  const timeOf = value => value ? value.slice(11, 16) : '—';
  const dateOf = value => value ? value.slice(0, 10) : '';
  const dateLabel = value => new Intl.DateTimeFormat('th-TH', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${value}T00:00:00`));
  const dateTimeLabel = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }).format(date);
  };
  const unique = (items, selector) => new Set(items.map(selector).filter(Boolean)).size;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function syncFilterState() {
    state.search = $('search').value;
    state.org = $('org-filter').value;
    state.sender = $('sender-filter').disabled ? '' : $('sender-filter').value;
    state.role = $('role-filter').value;
    state.date = $('date-filter').value;
    state.from = $('time-from').value;
    state.to = $('time-to').value;
  }

  function filteredRows() {
    syncFilterState();
    const needle = state.search.toLocaleLowerCase('th');
    return rows.filter(r => {
      const time = timeOf(r.timestamp);
      return (state.channel === 'all' || r.channel === state.channel)
        && (!state.org || r.org === state.org)
        && (!state.sender || r.person === state.sender)
        && (!state.role || r.participantRole === state.role)
        && (!state.date || dateOf(r.timestamp) === state.date)
        && (!state.from || time >= state.from)
        && (!state.to || time <= state.to)
        && (!needle || [r.org, r.person, r.position, r.content, r.attachment, r['reply to'], r['reply to bank'], r['reply to subject']].some(v => String(v || '').toLocaleLowerCase('th').includes(needle)));
    });
  }

  function setOptions(select, values) {
    values.sort((a, b) => a.localeCompare(b, 'th')).forEach(value => {
      const option = el('option', '', value);
      option.value = value;
      select.append(option);
    });
  }

  function setDateOptions(select, values) {
    values.sort().forEach(value => {
      const option = el('option', '', dateLabel(value));
      option.value = value;
      select.append(option);
    });
  }

  function updateEventDate(dates) {
    if (!dates.length) return;
    const first = new Date(`${dates[0]}T00:00:00`);
    const last = new Date(`${dates[dates.length - 1]}T00:00:00`);
    const sameMonth = first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth();
    $('event-day').textContent = dates.length === 1 ? first.getDate() : (sameMonth ? `${first.getDate()}–${last.getDate()}` : dates.length);
    $('event-month').firstChild.textContent = dates.length === 1 || sameMonth ? first.toLocaleDateString('th-TH', { month:'long' }) : ' วันในกรอบเวลา';
    $('event-year').textContent = dates.length === 1 || sameMonth ? first.toLocaleDateString('th-TH', { year:'numeric' }) : `${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])}`;
  }

  function updateSenderOptions() {
    const select = $('sender-filter');
    state.sender = '';
    select.length = 1;
    select.disabled = state.channel !== 'mail';
    if (select.disabled) return;
    const senders = rows.filter(row => row.channel === 'mail' && (!state.org || row.org === state.org)).map(row => row.person).filter(Boolean);
    setOptions(select, [...new Set(senders)]);
    select.value = '';
  }

  function updateTimeBounds() {
    const times = rows.filter(row => !state.date || dateOf(row.timestamp) === state.date).map(row => timeOf(row.timestamp)).filter(time => time !== '—').sort();
    const from = $('time-from');
    const to = $('time-to');
    from.min = to.min = state.date && times.length ? times[0] : '00:00';
    from.max = to.max = state.date && times.length ? times[times.length - 1] : '23:59';
  }

  function resetFilters(render = true) {
    Object.assign(state, { channel:'all', search:'', org:'', sender:'', role:'', date:'', from:'', to:'', limit:80 });
    Object.assign(quizState, { search:'', question:'', org:'', limit:100 });
    $('search').value = ''; $('org-filter').value = ''; $('sender-filter').value = ''; $('role-filter').value = '';
    $('date-filter').value = ''; $('time-from').value = ''; $('time-to').value = '';
    $('quiz-search').value = ''; $('quiz-question-filter').value = ''; $('quiz-org-filter').value = '';
    updateSenderOptions();
    updateTimeBounds();
    [...$('channel-tabs').children].forEach(child => child.classList.toggle('active', child.dataset.channel === 'all'));
    if (render) { renderQuizDetails(); renderTable(); }
  }

  function renderMetrics(items = rows) {
    $('metric-events').textContent = formatNumber(items.length);
    $('metric-orgs').textContent = formatNumber(unique(items.filter(r => r.org !== 'Command Center'), r => r.org));
    $('metric-people').textContent = formatNumber(unique(items, r => r.person));
    $('metric-files').textContent = formatNumber(items.filter(r => r.attachment).length);
  }

  function renderChannelChart(items = rows) {
    const chart = $('channel-chart');
    chart.replaceChildren();
    const counts = Object.keys(meta).map(channel => [channel, items.filter(r => r.channel === channel).length]);
    const max = Math.max(...counts.map(([, count]) => count), 1);
    counts.forEach(([channel, count]) => {
      const row = el('div', 'bar-row');
      row.append(el('span', '', meta[channel].label));
      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${count / max * 100}%`;
      fill.style.background = meta[channel].color;
      track.append(fill);
      row.append(track, el('strong', '', formatNumber(count)));
      chart.append(row);
    });
    $('channel-total').textContent = `${formatNumber(items.length)} รายการ`;
  }

  function renderTopOrgs(items = rows) {
    const counts = new Map();
    items.filter(r => !['Command Center', 'BOT'].includes(r.org)).forEach(r => counts.set(r.org, (counts.get(r.org) || 0) + 1));
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const list = $('top-orgs');
    list.replaceChildren();
    top.forEach(([org, count], index) => {
      const item = el('li');
      item.append(el('span', 'rank-number', String(index + 1).padStart(2, '0')), el('span', '', org), el('span', 'rank-count', formatNumber(count)));
      list.append(item);
    });
  }

  function renderTimeChart(items = rows) {
    const chart = $('time-chart');
    chart.replaceChildren();
    const timestamps = items.map(item => Date.parse(item.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!timestamps.length) { $('timeline-range').textContent = 'ไม่พบข้อมูล'; return; }
    const min = timestamps[0];
    const maxTime = timestamps[timestamps.length - 1];
    const steps = [600000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000];
    const step = steps.find(value => Math.ceil((maxTime - min) / value) <= 30) || 86400000;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(maxTime / step) * step;
    const buckets = Array.from({ length: Math.max(1, Math.floor((end - start) / step) + 1) }, (_, index) => ({ time: start + index * step, count: 0 }));
    timestamps.forEach(timestamp => buckets[Math.min(buckets.length - 1, Math.floor((timestamp - start) / step))].count++);
    const max = Math.max(...buckets.map(bucket => bucket.count), 1);
    const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
    buckets.forEach((bucket, index) => {
      const column = el('div', 'time-column');
      const bar = el('div', 'time-bar');
      bar.style.height = `${Math.max(2, bucket.count / max * 100)}%`;
      bar.dataset.label = `${dateTimeLabel(bucket.time)} · ${formatNumber(bucket.count)} รายการ`;
      column.append(bar);
      if (index % tickEvery === 0) {
        const tick = new Date(bucket.time);
        const label = (maxTime - min) > 86400000 ? `${tick.toLocaleDateString('th-TH', { day:'numeric', month:'short' })} ${tick.toTimeString().slice(0,5)}` : tick.toTimeString().slice(0,5);
        column.append(el('span', 'time-tick', label));
      }
      chart.append(column);
    });
    $('timeline-range').textContent = `${dateTimeLabel(min)} – ${dateTimeLabel(maxTime)}`;
  }

  function openImage(path, caption) {
    $('dialog-image').src = path;
    $('dialog-image').alt = caption;
    $('dialog-caption').textContent = caption;
    $('image-dialog').showModal();
  }

  function socialDetail(row) {
    const wrapper = el('div', 'social-detail');
    const isComment = Boolean(row['reply to'] || row['reply to bank'] || row['reply to subject']);
    wrapper.append(el('span', `social-kind ${isComment ? 'comment' : 'post'}`, isComment ? 'ความคิดเห็น' : 'โพสต์'));
    wrapper.append(el('p', 'social-message', row.message || '—'));
    if (isComment) {
      const context = el('div', 'reply-context');
      const target = [row['reply to'], row['reply to bank']].filter(Boolean).join(' · ');
      context.append(el('strong', '', target ? `ตอบกลับ ${target}` : 'ตอบกลับโพสต์'));
      if (row['reply to subject']) {
        const subject = el('p', '', row['reply to subject']);
        subject.title = row['reply to subject'];
        context.append(subject);
      }
      wrapper.append(context);
    }
    return wrapper;
  }

  function renderStory() {
    const story = data.channels.mail.filter(r => r.bank === 'Command Center' && /^Inject\s+\d/.test(r.message || '')).slice(0, 5);
    const grid = $('story-grid');
    grid.replaceChildren();
    story.forEach((record, index) => {
      const card = el('article', 'story-card');
      const asset = assetMap.get(`mail/${record.attachment}`.toLowerCase());
      if (isImage(asset)) {
        const image = el('img', 'story-image');
        image.src = asset.path;
        image.alt = `ภาพประกอบ ${record.message.split(':')[0]}`;
        image.loading = 'lazy';
        image.addEventListener('click', () => openImage(asset.path, record.attachment));
        card.append(image);
      }
      const content = el('div', 'story-content');
      const title = (record.message || '').split(':')[0];
      content.append(el('span', 'story-step', `STEP ${index + 1} · ${dateTimeLabel(record.time)}`), el('h3', '', title), el('p', '', record.message.slice(title.length + 1)));
      card.append(content);
      grid.append(card);
    });
  }

  function renderTable() {
    const items = filteredRows();
    renderMetrics(items);
    renderChannelChart(items);
    renderTopOrgs(items);
    renderTimeChart(items);
    $('result-count').textContent = `พบ ${formatNumber(items.length)} รายการ`;
    const body = $('activity-body');
    body.replaceChildren();
    items.slice(0, state.limit).forEach(r => {
      const tr = el('tr');
      tr.append(el('td', '', dateTimeLabel(r.timestamp)));
      const channelCell = el('td');
      channelCell.append(el('span', `channel-badge channel-${r.channel}`, meta[r.channel].label));
      tr.append(channelCell);
      const senderCell = el('td', 'sender');
      senderCell.append(el('strong', '', r.org), el('small', '', `${r.person} · ${r.participantRole}`));
      const detailCell = el('td', 'detail');
      if (r.channel === 'social') detailCell.append(socialDetail(r));
      else detailCell.textContent = r.content || '—';
      tr.append(senderCell, detailCell);
      const attachmentCell = el('td');
      if (isImage(r.attachmentAsset)) {
        const button = el('button', 'attachment-button', 'เปิดภาพ');
        button.addEventListener('click', () => openImage(r.attachmentAsset.path, r.attachment));
        attachmentCell.append(button);
      } else if (r.attachmentAsset) {
        const link = el('a', 'attachment-button', isPdf(r.attachmentAsset) ? 'เปิด PDF' : 'เปิด/ดาวน์โหลด');
        link.href = r.attachmentAsset.path;
        if (isPdf(r.attachmentAsset)) { link.target = '_blank'; link.rel = 'noopener'; }
        else link.download = r.attachment;
        attachmentCell.append(link);
      } else if (r.attachment) attachmentCell.textContent = r.attachment;
      else attachmentCell.textContent = '—';
      tr.append(attachmentCell);
      body.append(tr);
    });
    $('empty-state').hidden = items.length > 0;
    $('load-more').hidden = state.limit >= items.length;
  }

  function renderQuiz() {
    const groups = new Map();
    data.channels.quiz.forEach(r => {
      const key = r.quiz || 'ไม่ระบุคำถาม';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const grid = $('quiz-grid');
    grid.replaceChildren();
    [...groups].forEach(([question, answers], index) => {
      const card = el('article', 'quiz-card');
      card.append(el('span', 'quiz-number', `QUESTION ${String(index + 1).padStart(2, '0')}`), el('h3', '', question));
      const stat = el('div', 'quiz-stat');
      const left = el('span', '', 'คำตอบ');
      left.prepend(el('strong', '', `${formatNumber(answers.length)} `));
      const right = el('span', '', `${formatNumber(unique(answers, a => a.bank))} หน่วยงาน`);
      stat.append(left, right);
      card.append(stat);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = 'กรองตารางตามข้อนี้';
      const selectQuestion = () => {
        quizState.question = question;
        quizState.limit = 100;
        $('quiz-question-filter').value = question;
        renderQuizDetails();
        document.querySelector('.quiz-detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      card.addEventListener('click', selectQuestion);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') selectQuestion(); });
      grid.append(card);
    });
  }

  function filteredQuizRows() {
    const needle = quizState.search.toLocaleLowerCase('th');
    return data.channels.quiz.filter(row => {
      return (!quizState.question || row.quiz === quizState.question)
        && (!quizState.org || row.bank === quizState.org)
        && (!needle || [row.bank, row.position, row.name, row.role, row.quiz, row['answer choice'], row['answer text']]
          .some(value => String(value || '').toLocaleLowerCase('th').includes(needle)));
    });
  }

  function renderQuizDetails() {
    const answers = filteredQuizRows();
    const body = $('quiz-body');
    body.replaceChildren();
    answers.slice(0, quizState.limit).forEach(answer => {
      const tr = el('tr');
      const choice = (answer['answer choice'] || '—').replace(/,([A-Z]\.\s)/g, '\n$1');
      tr.append(
        el('td', '', dateTimeLabel(answer['answer time'])),
        el('td', '', answer.quiz || '—'),
        el('td', '', answer.bank || '—'),
        el('td', '', answer.position || '—'),
        el('td', '', answer.name || '—'),
        el('td', '', answer.role || '—'),
        el('td', 'quiz-answer-choice', choice),
        el('td', 'quiz-answer-text', answer['answer text'] || '—')
      );
      body.append(tr);
    });
    $('quiz-result-count').textContent = `พบ ${formatNumber(answers.length)} คำตอบ`;
    $('quiz-empty-state').hidden = answers.length > 0;
    $('quiz-load-more').hidden = quizState.limit >= answers.length;
  }

  function bindEvents() {
    $('search').addEventListener('input', event => { state.search = event.target.value; state.limit = 80; renderTable(); });
    $('org-filter').addEventListener('change', event => { state.org = event.target.value; state.limit = 80; updateSenderOptions(); renderTable(); });
    $('sender-filter').addEventListener('change', event => { state.sender = event.target.value; state.limit = 80; renderTable(); });
    $('role-filter').addEventListener('change', event => { state.role = event.target.value; state.limit = 80; renderTable(); });
    $('date-filter').addEventListener('change', event => {
      state.date = event.target.value; state.from = ''; state.to = ''; state.limit = 80;
      $('time-from').value = ''; $('time-to').value = '';
      updateTimeBounds(); renderTable();
    });
    $('time-from').addEventListener('change', event => { state.from = event.target.value; renderTable(); });
    $('time-to').addEventListener('change', event => { state.to = event.target.value; renderTable(); });
    $('channel-tabs').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      state.channel = button.dataset.channel;
      updateSenderOptions();
      state.limit = 80;
      [...$('channel-tabs').children].forEach(child => child.classList.toggle('active', child === button));
      renderTable();
    });
    $('load-more').addEventListener('click', () => { state.limit += 80; renderTable(); });
    $('reset-filter').addEventListener('click', () => resetFilters());
    $('image-dialog').querySelector('.dialog-close').addEventListener('click', () => $('image-dialog').close());
    $('image-dialog').addEventListener('click', event => { if (event.target === $('image-dialog')) $('image-dialog').close(); });
    $('menu-button').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
    document.querySelectorAll('.sidebar a').forEach(link => link.addEventListener('click', () => document.querySelector('.sidebar').classList.remove('open')));
    $('quiz-search').addEventListener('input', event => { quizState.search = event.target.value; quizState.limit = 100; renderQuizDetails(); });
    $('quiz-question-filter').addEventListener('change', event => { quizState.question = event.target.value; quizState.limit = 100; renderQuizDetails(); });
    $('quiz-org-filter').addEventListener('change', event => { quizState.org = event.target.value; quizState.limit = 100; renderQuizDetails(); });
    $('quiz-load-more').addEventListener('click', () => { quizState.limit += 100; renderQuizDetails(); });
  }

  function loadData(next) {
    if (!next?.channels || !['social','chat','mail','quiz'].every(channel => Array.isArray(next.channels[channel]))) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
    if (data) data.assets.filter(asset => String(asset.path).startsWith('blob:')).forEach(asset => URL.revokeObjectURL(asset.path));
    data = next;
    assetMap = new Map(data.assets.map(asset => [`${asset.channel}/${asset.name}`.toLowerCase(), asset]));
    rows = Object.entries(data.channels).flatMap(([channel, records]) => records.map((record, index) => ({
      ...record,
      channel,
      index,
      timestamp: record.time || record['answer time'] || '',
      org: record.bank || 'ไม่ระบุ',
      person: record.name || 'ไม่ระบุ',
      participantRole: record.role || record['bank role'] || 'ไม่ระบุ',
      content: channel === 'quiz' ? [record.quiz, record['answer text'] || record['answer choice']].filter(Boolean).join(' — ') : (record.message || ''),
      attachmentAsset: record.attachment ? assetMap.get(`${channel}/${record.attachment}`.toLowerCase()) : null
    }))).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    $('org-filter').length = 1; $('role-filter').length = 1; $('date-filter').length = 1;
    $('quiz-question-filter').length = 1; $('quiz-org-filter').length = 1;
    setOptions($('org-filter'), [...new Set(rows.map(row => row.org).filter(Boolean))]);
    setOptions($('role-filter'), [...new Set(rows.map(row => row.participantRole).filter(Boolean))]);
    const availableDates = [...new Set(rows.map(row => dateOf(row.timestamp)).filter(Boolean))].sort();
    setDateOptions($('date-filter'), availableDates);
    updateEventDate(availableDates);
    setOptions($('quiz-question-filter'), [...new Set(data.channels.quiz.map(row => row.quiz).filter(Boolean))]);
    setOptions($('quiz-org-filter'), [...new Set(data.channels.quiz.map(row => row.bank).filter(Boolean))]);
    resetFilters(false);
    $('source-name').textContent = data.source;
    renderStory();
    renderQuiz();
    renderQuizDetails();
    renderTable();
  }

  bindEvents();
  window.loadCyberdrillData = loadData;
  loadData({ source:'ยังไม่ได้อัปโหลด ZIP', assets:[], schedule:[], channels:{ social:[], chat:[], mail:[], quiz:[] } });
})();
